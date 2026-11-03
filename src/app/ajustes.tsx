import * as Application from 'expo-application';
import { useState } from 'react';
import { View } from 'react-native';
import { BackupSection, DevModeSection, SettingSwitch } from '@/components/DataSettings';
import { Sheet } from '@/components/Sheet';
import {
  AppText,
  Button,
  DurationField,
  Icon,
  ListGroup,
  ListRow,
  Loading,
  RowIcon,
  Screen,
  Section,
  TimeField,
  type IconName,
} from '@/components/ui';
import type { Db } from '@/db/db';
import { getSettings, updateSettings, type Settings } from '@/db/repositories/settings';
import { formatCountdown } from '@/domain/format';
import { useDb, useLoader } from '@/hooks/data';
import { githubToken } from '@/services/backup';
import { rescheduleDailyReminders } from '@/services/dailyReminder';
import {
  countScheduledNotifications,
  getPermissionState,
  openBatteryOptimizationSettings,
  openNotificationSettings,
  openOverlaySettings,
  requestExactAlarmPermission,
  requestNotificationPermission,
  type PermissionState,
} from '@/services/notifications';
import { colors, spacing } from '@/theme';

interface Loaded {
  settings: Settings;
  permissions: PermissionState;
  scheduled: number;
  hasToken: boolean;
}

const load = async (db: Db): Promise<Loaded> => ({
  settings: await getSettings(db),
  permissions: await getPermissionState(),
  scheduled: await countScheduledNotifications(),
  hasToken: (await githubToken.get()) !== null,
});

/** Everything is saved as soon as it changes (PLAN.md §8). */
export default function SettingsScreen() {
  const { data, reload } = useLoader(load);
  // Restoring a copy replaces the settings under the controls: they start again from the database.
  const [generation, setGeneration] = useState(0);
  if (!data) return <Loading />;

  const replaced = async () => {
    await reload();
    setGeneration((g) => g + 1);
  };
  return <SettingsList key={generation} data={data} reload={reload} onReplaced={replaced} />;
}

function SettingsList({ data, reload, onReplaced }: { data: Loaded; reload: () => Promise<void>; onReplaced: () => Promise<void> }) {
  const db = useDb();
  // The controls own their values while the screen is open; `data` brings permissions and backup state.
  const [settings, setSettings] = useState(data.settings);
  const [restOpen, setRestOpen] = useState(false);

  const save = async (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    await updateSettings(db, patch);
  };
  const saveReminder = async (patch: Partial<Settings>) => {
    await save(patch);
    await rescheduleDailyReminders(db);
    await reload();
  };

  return (
    <Screen>
      <Section label="Entrenamiento">
        <ListGroup>
          <ListRow
            title="Descanso entre series"
            right={formatCountdown(settings.restSecondsDefault * 1000)}
            onPress={() => setRestOpen(true)}
          />
          <SettingSwitch
            label="Pantalla siempre encendida"
            subtitle="Durante el entreno"
            value={settings.keepAwake}
            onValueChange={(keepAwake) => save({ keepAwake })}
          />
          <SettingSwitch
            label="Burbuja flotante"
            subtitle="Con el descanso, cuando sales de la app"
            value={settings.restOverlay}
            onValueChange={(restOverlay) => save({ restOverlay })}
          />
        </ListGroup>
      </Section>

      <Section label="Recordatorio diario">
        <ListGroup>
          <SettingSwitch
            label="Avisar cada día"
            value={settings.dailyReminderEnabled}
            onValueChange={(dailyReminderEnabled) => saveReminder({ dailyReminderEnabled })}
          />
          {settings.dailyReminderEnabled ? (
            <TimeField
              label="Hora del aviso"
              value={settings.dailyReminderTime}
              onChange={(dailyReminderTime) => saveReminder({ dailyReminderTime })}
            />
          ) : null}
        </ListGroup>
      </Section>

      <Permissions permissions={data.permissions} scheduled={data.scheduled} bubble={settings.restOverlay} onChanged={reload} />

      <BackupSection
        settings={data.settings}
        hasToken={data.hasToken}
        devMode={settings.devMode}
        onChanged={reload}
        onReplaced={onReplaced}
      />

      <DevModeSection enabled={settings.devMode} onChange={(devMode) => save({ devMode })} />

      <AppText variant="caption" style={{ textAlign: 'center' }}>
        Entreno v{Application.nativeApplicationVersion ?? '?'}
      </AppText>

      <Sheet visible={restOpen} title="Descanso entre series" onClose={() => setRestOpen(false)}>
        <DurationField value={settings.restSecondsDefault} onChange={(restSecondsDefault) => save({ restSecondsDefault })} />
        <Button size="lg" title="Listo" onPress={() => setRestOpen(false)} />
      </Sheet>
    </Screen>
  );
}

interface Check {
  /** Name in the details: «Notificaciones · Activado». */
  name: string;
  ok: boolean | null;
  /** Row shown when it fails: what to do and why. */
  fix: string;
  why: string;
  icon: IconName;
  run: () => Promise<unknown>;
}

async function allowNotifications(): Promise<void> {
  // Once denied for good, Android no longer asks: the app's notification settings are the way.
  if (!(await requestNotificationPermission())) await openNotificationSettings();
}

/** What the alarms need; the bubble's permission only counts when the bubble is on. */
function permissionChecks(p: PermissionState, bubble: boolean): Check[] {
  const checks: Check[] = [
    {
      name: 'Notificaciones',
      ok: p.notifications,
      fix: 'Permitir notificaciones',
      why: 'Sin ellas no suena el fin del descanso',
      icon: 'bell-cog-outline',
      run: allowNotifications,
    },
    {
      name: 'Alarmas exactas',
      ok: p.exactAlarms,
      fix: 'Permitir alarmas exactas',
      why: 'Sin ellas el descanso puede sonar tarde',
      icon: 'alarm',
      run: requestExactAlarmPermission,
    },
    {
      name: 'Batería sin restricciones',
      ok: p.batteryUnrestricted,
      fix: 'Quitar la optimización de batería',
      why: p.batteryUnrestricted === null ? 'Comprueba que Entreno no tenga restricciones' : 'Puede retrasar los avisos',
      icon: 'battery-heart-variant',
      run: openBatteryOptimizationSettings,
    },
  ];
  if (bubble) {
    checks.push({
      name: 'Burbuja flotante',
      ok: p.overlay,
      fix: 'Permitir la burbuja flotante',
      why: 'Si se abre una lista de apps, busca Entreno',
      icon: 'picture-in-picture-bottom-right-outline',
      run: openOverlaySettings,
    });
  }
  return checks;
}

function Permissions({
  permissions,
  scheduled,
  bubble,
  onChanged,
}: {
  permissions: PermissionState;
  scheduled: number;
  bubble: boolean;
  onChanged: () => Promise<void>;
}) {
  const [details, setDetails] = useState(false);
  const checks = permissionChecks(permissions, bubble);
  const failing = checks.filter((c) => c.ok !== true);
  // Most fixes open Android's settings and coming back reloads the screen; this covers the rest.
  const fix = (check: Check) => async () => {
    await check.run();
    await onChanged();
  };

  return (
    <Section label="Avisos y permisos">
      <ListGroup inset={72}>
        {failing.length === 0 ? (
          <ListRow
            left={<RowIcon name="check-circle" color={colors.primary} />}
            title="Todo listo para que suenen los avisos"
            subtitle="Ver detalles"
            onPress={() => setDetails(true)}
          />
        ) : (
          failing.map((check) => (
            <ListRow
              key={check.name}
              left={
                check.ok === false ? (
                  <RowIcon name="alert-circle" color={colors.warning} />
                ) : (
                  <RowIcon name={check.icon} color={colors.muted} />
                )
              }
              title={check.fix}
              subtitle={check.why}
              onPress={fix(check)}
            />
          ))
        )}
      </ListGroup>

      <Sheet visible={details} title="Avisos y permisos" onClose={() => setDetails(false)}>
        <View style={{ marginHorizontal: -spacing.lg }}>
          <ListGroup>
            {checks.map((check) => (
              <ListRow
                key={check.name}
                title={check.name}
                right={<Status ok={check.ok} />}
                onPress={check.ok === true ? undefined : fix(check)}
                chevron={false}
              />
            ))}
            <ListRow title="Avisos programados" right={String(scheduled)} />
            <ListRow
              left={<RowIcon name="bell-cog-outline" />}
              title="Ajustes de notificaciones del sistema"
              onPress={openNotificationSettings}
            />
          </ListGroup>
        </View>
      </Sheet>
    </Section>
  );
}

/** «Activado» or «Falta», with its icon: the colour is never the only sign. */
function Status({ ok }: { ok: boolean | null }) {
  const [icon, color, text]: [IconName, string, string] =
    ok === true
      ? ['check-circle', colors.primary, 'Activado']
      : ok === false
        ? ['alert-circle', colors.warning, 'Falta']
        : ['help-circle-outline', colors.muted, 'Sin comprobar'];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Icon name={icon} size={20} color={color} />
      <AppText variant="bodySm">{text}</AppText>
    </View>
  );
}
