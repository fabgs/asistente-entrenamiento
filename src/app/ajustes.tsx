import { useState } from 'react';
import { Switch } from 'react-native';
import { BackupCard, DevModeCard } from '@/components/DataSettings';
import { AppText, Button, Card, Divider, Loading, Row, Screen, Stepper } from '@/components/ui';
import { getSettings, updateSettings, type Settings } from '@/db/repositories/settings';
import { formatCountdown, parseDuration } from '@/domain/format';
import { useDb, useLoader } from '@/hooks/data';
import { githubToken } from '@/services/backup';
import { rescheduleDailyReminders, sendTestReminder } from '@/services/dailyReminder';
import {
  countScheduledNotifications,
  getPermissionState,
  openBatteryOptimizationSettings,
  openNotificationSettings,
  openOverlaySettings,
  requestExactAlarmPermission,
  type PermissionState,
  requestNotificationPermission,
} from '@/services/notifications';
import { scheduleTestRest } from '@/services/restTimer';
import { colors } from '@/theme';

const pad = (n: number) => String(n).padStart(2, '0');

export default function SettingsScreen() {
  const { data, reload } = useLoader(async (db) => ({
    settings: await getSettings(db),
    permissions: await getPermissionState(),
    scheduled: await countScheduledNotifications(),
    hasToken: (await githubToken.get()) !== null,
  }));

  if (!data) return <Loading />;

  return (
    <Screen>
      <SettingsForm key={formKey(data.settings)} settings={data.settings} onSaved={reload} />
      <Diagnostics
        permissions={data.permissions}
        scheduled={data.scheduled}
        overlayEnabled={data.settings.restOverlay}
        onChanged={reload}
      />
      <BackupCard key={backupKey(data.settings)} settings={data.settings} hasToken={data.hasToken} onChanged={reload} />
      <DevModeCard enabled={data.settings.devMode} onChanged={reload} />
    </Screen>
  );
}

// Remount forms only when their own saved values change, not on every settings update.
const formKey = (s: Settings) =>
  [s.restSecondsDefault, s.dailyReminderEnabled, s.dailyReminderTime, s.keepAwake, s.restOverlay].join('|');
const backupKey = (s: Settings) => [s.backupOwner, s.backupRepo, s.backupPath].join('|');

function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const db = useDb();
  const [rest, setRest] = useState(settings.restSecondsDefault);
  const [enabled, setEnabled] = useState(settings.dailyReminderEnabled);
  const [initialHour, initialMinute] = settings.dailyReminderTime.split(':').map(Number);
  const [hour, setHour] = useState(initialHour);
  const [minute, setMinute] = useState(initialMinute);
  const [keepAwake, setKeepAwake] = useState(settings.keepAwake);
  const [restOverlay, setRestOverlay] = useState(settings.restOverlay);

  const save = async () => {
    await updateSettings(db, {
      restSecondsDefault: rest,
      dailyReminderEnabled: enabled,
      dailyReminderTime: `${pad(hour)}:${pad(minute)}`,
      keepAwake,
      restOverlay,
    });
    await rescheduleDailyReminders(db);
    onSaved();
  };

  return (
    <Card>
      <AppText variant="heading">Entrenamiento</AppText>
      <AppText variant="small">Descanso entre series (toca el tiempo para escribirlo en segundos)</AppText>
      <Stepper
        value={rest}
        onChange={setRest}
        step={15}
        min={15}
        format={(s) => formatCountdown(s * 1000)}
        parse={parseDuration}
        toText={String}
      />
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText>Pantalla siempre encendida</AppText>
        <Switch value={keepAwake} onValueChange={setKeepAwake} trackColor={{ true: colors.primary }} />
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText style={{ flex: 1 }}>Burbuja flotante con el descanso al salir de la app</AppText>
        <Switch value={restOverlay} onValueChange={setRestOverlay} trackColor={{ true: colors.primary }} />
      </Row>
      <Divider />
      <AppText variant="heading">Recordatorio diario</AppText>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText>Avisarme cada día</AppText>
        <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.primary }} />
      </Row>
      <AppText variant="small">Hora</AppText>
      <Stepper value={hour} onChange={(h) => setHour((h + 24) % 24)} min={-1} format={pad} />
      <AppText variant="small">Minutos</AppText>
      <Stepper value={minute} onChange={(m) => setMinute((m + 60) % 60)} step={5} min={-5} format={pad} />
      <Button title="Guardar ajustes" onPress={save} />
    </Card>
  );
}

function Diagnostics({
  permissions,
  scheduled,
  overlayEnabled,
  onChanged,
}: {
  permissions: PermissionState;
  scheduled: number;
  overlayEnabled: boolean;
  onChanged: () => void;
}) {
  const db = useDb();
  const after = (fn: () => Promise<unknown>) => async () => {
    await fn();
    onChanged();
  };

  return (
    <Card>
      <AppText variant="heading">Diagnóstico de avisos</AppText>
      <Status label="Notificaciones" ok={permissions.notifications} />
      {!permissions.notifications ? (
        <Button kind="secondary" title="Permitir notificaciones" onPress={after(requestNotificationPermission)} />
      ) : null}
      <Status label="Alarmas exactas" ok={permissions.exactAlarms} />
      {!permissions.exactAlarms ? (
        <Button kind="secondary" title="Permitir alarmas exactas" onPress={after(requestExactAlarmPermission)} />
      ) : null}
      <Status label="Mostrar sobre otras apps (burbuja)" ok={permissions.overlay} />
      {!permissions.overlay ? (
        <Button kind="secondary" title="Permitir la burbuja flotante" onPress={after(openOverlaySettings)} />
      ) : null}
      <AppText variant="small">
        Para que el descanso suene siempre a su hora, quita la optimización de batería de la app.
      </AppText>
      <Button kind="secondary" title="Optimización de batería" onPress={openBatteryOptimizationSettings} />
      <Button kind="secondary" title="Ajustes de notificaciones del sistema" onPress={openNotificationSettings} />
      <Divider />
      <Button title="Probar descanso (10 s)" onPress={after(() => scheduleTestRest(overlayEnabled))} />
      <Button kind="secondary" title="Probar recordatorio (5 s)" onPress={after(() => sendTestReminder(db))} />
      <AppText variant="small">Notificaciones programadas: {scheduled}</AppText>
    </Card>
  );
}

function Status({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <AppText>{label}</AppText>
      <AppText style={{ color: ok ? colors.primary : colors.danger, fontWeight: '700' }}>{ok ? 'Sí' : 'No'}</AppText>
    </Row>
  );
}
