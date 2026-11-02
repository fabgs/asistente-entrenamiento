import * as Application from 'expo-application';
import { useState } from 'react';
import { BackupCard, DevModeCard } from '@/components/DataSettings';
import { AppText, Button, Card, Divider, DurationField, Loading, Row, Screen, SwitchRow, TimeField } from '@/components/ui';
import { getSettings, updateSettings, type Settings } from '@/db/repositories/settings';
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
  type PermissionState,
  requestNotificationPermission,
} from '@/services/notifications';
import { colors } from '@/theme';

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
      <Diagnostics permissions={data.permissions} scheduled={data.scheduled} onChanged={reload} />
      <BackupCard key={backupKey(data.settings)} settings={data.settings} hasToken={data.hasToken} onChanged={reload} />
      <DevModeCard enabled={data.settings.devMode} onChanged={reload} />
      <AppText variant="small" style={{ textAlign: 'center' }}>
        Entreno v{Application.nativeApplicationVersion ?? '?'}
      </AppText>
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
  const [time, setTime] = useState(settings.dailyReminderTime);
  const [keepAwake, setKeepAwake] = useState(settings.keepAwake);
  const [restOverlay, setRestOverlay] = useState(settings.restOverlay);

  const save = async () => {
    await updateSettings(db, {
      restSecondsDefault: rest,
      dailyReminderEnabled: enabled,
      dailyReminderTime: time,
      keepAwake,
      restOverlay,
    });
    await rescheduleDailyReminders(db);
    onSaved();
  };

  return (
    <Card>
      <AppText variant="heading">Entrenamiento</AppText>
      <AppText variant="small">Descanso entre series (toca el tiempo para escribirlo)</AppText>
      <DurationField value={rest} onChange={setRest} />
      <SwitchRow label="Pantalla siempre encendida" value={keepAwake} onValueChange={setKeepAwake} />
      <SwitchRow label="Burbuja flotante con el descanso al salir de la app" value={restOverlay} onValueChange={setRestOverlay} />
      <Divider />
      <AppText variant="heading">Recordatorio diario</AppText>
      <SwitchRow label="Avisarme cada día" value={enabled} onValueChange={setEnabled} />
      {enabled ? <TimeField label="Hora del aviso" value={time} onChange={setTime} /> : null}
      <Button title="Guardar ajustes" onPress={save} />
    </Card>
  );
}

function Diagnostics({
  permissions,
  scheduled,
  onChanged,
}: {
  permissions: PermissionState;
  scheduled: number;
  onChanged: () => void;
}) {
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
        <>
          <Button kind="secondary" title="Permitir la burbuja flotante" onPress={after(openOverlaySettings)} />
          <AppText variant="small">Si se abre una lista de apps, busca Entreno y permítelo.</AppText>
        </>
      ) : null}
      <AppText variant="small">
        Para que el descanso suene siempre a su hora, quita la optimización de batería de la app.
      </AppText>
      <Button kind="secondary" title="Optimización de batería" onPress={openBatteryOptimizationSettings} />
      <Button kind="secondary" title="Ajustes de notificaciones del sistema" onPress={openNotificationSettings} />
      <AppText variant="small">Notificaciones programadas: {scheduled}</AppText>
    </Card>
  );
}

function Status({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Row between>
      <AppText style={{ flex: 1 }}>{label}</AppText>
      <AppText style={{ color: ok ? colors.primary : colors.danger, fontWeight: '700' }}>{ok ? 'Sí' : 'No'}</AppText>
    </Row>
  );
}
