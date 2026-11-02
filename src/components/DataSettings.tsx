import { router } from 'expo-router';
import { useState } from 'react';
import type { Backup } from '@/db/maintenance';
import type { SeedData } from '@/db/seedTypes';
import { updateSettings, type Settings } from '@/db/repositories/settings';
import { formatAgo, formatLongDate } from '@/domain/format';
import { useDb } from '@/hooks/data';
import {
  backupToGithub,
  downloadFromGithub,
  githubToken,
  pickBackupFile,
  resetToSeed,
  restoreFrom,
  shareBackupFile,
} from '@/services/backup';
import { colors } from '@/theme';
import { showDialog } from './Dialog';
import { AppText, Button, Card, Divider, Row, SwitchRow, TextField } from './ui';

// Only development builds bundle the Excel data: `__DEV__` is false in a release build, so the
// bundler drops this branch and the require with it.
const loadDemoSeed: (() => SeedData) | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => (require('@/db/demoSeed') as typeof import('@/db/demoSeed')).DEMO_SEED
  : null;

export function DevModeCard({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const db = useDb();

  const toggle = async (value: boolean) => {
    await updateSettings(db, { devMode: value });
    onChanged();
  };

  const reset = (seed?: SeedData) =>
    showDialog(
      'Reiniciar datos',
      seed
        ? 'Se borrará todo y se cargarán los datos de prueba (rutinas, cardio, dieta e historial del Excel).'
        : 'Se borrará todo (entrenos, rutinas, dieta, pesos y perfil) y la app quedará como recién instalada, solo con los catálogos de ejercicios y alimentos. Se mantiene la configuración de la copia en GitHub para poder restaurarla.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar todo',
          style: 'destructive',
          onPress: async () => {
            await resetToSeed(db, undefined, seed);
            router.replace('/');
          },
        },
      ],
    );

  return (
    <Card style={enabled ? { borderColor: colors.warning } : undefined}>
      <AppText variant="heading">Modo pruebas</AppText>
      <SwitchRow label="Borrar los datos al instalar una versión nueva" value={enabled} onValueChange={toggle} />
      <AppText variant="small">
        {enabled
          ? 'Activo: al instalar un APK nuevo se borra todo y la app queda como recién instalada. Apágalo ANTES de instalar una versión nueva si quieres conservar tus datos.'
          : 'Desactivado: tus datos se conservan al actualizar la app.'}
      </AppText>
      <Button kind="danger" title="Reiniciar datos ahora" onPress={() => reset()} />
      {loadDemoSeed ? (
        <Button kind="secondary" title="Cargar datos de prueba (Excel)" onPress={() => reset(loadDemoSeed!())} />
      ) : null}
    </Card>
  );
}

function confirmRestore(backup: Backup): Promise<boolean> {
  return new Promise((resolve) =>
    showDialog(
      'Restaurar copia',
      `Se reemplazarán TODOS los datos actuales por la copia del ${formatLongDate(new Date(backup.exportedAt))}.`,
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Restaurar', style: 'destructive', onPress: () => resolve(true) },
      ],
    ),
  );
}

export function BackupCard({
  settings,
  hasToken,
  onChanged,
}: {
  settings: Settings;
  hasToken: boolean;
  onChanged: () => void;
}) {
  const db = useDb();
  const [owner, setOwner] = useState(settings.backupOwner ?? '');
  const [repo, setRepo] = useState(settings.backupRepo ?? '');
  const [path, setPath] = useState(settings.backupPath ?? 'entreno-backup.json');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (task: () => Promise<string | null>) => async () => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await task();
      if (text) setMessage({ ok: true, text });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const restore = async (backup: Backup | null) => {
    if (!backup || !(await confirmRestore(backup))) return null;
    await restoreFrom(db, backup);
    return 'Datos restaurados.';
  };

  const saveGithub = run(async () => {
    await updateSettings(db, {
      backupOwner: owner.trim() || null,
      backupRepo: repo.trim() || null,
      backupPath: path.trim() || null,
    });
    if (token.trim()) {
      await githubToken.set(token);
      setToken('');
    }
    return 'Configuración guardada.';
  });

  return (
    <Card>
      <AppText variant="heading">Copia de seguridad</AppText>
      <AppText variant="small">
        Un fichero con todos tus datos. Puedes guardarlo en Drive, enviártelo por Telegram, etc.
      </AppText>
      <Row>
        <Button
          title="Exportar"
          disabled={busy}
          onPress={run(async () => {
            await shareBackupFile(db);
            return null;
          })}
        />
        <Button
          kind="secondary"
          title="Importar fichero"
          disabled={busy}
          onPress={run(async () => restore(await pickBackupFile()))}
        />
      </Row>

      <Divider />
      <AppText variant="heading">Copia automática en GitHub</AppText>
      <AppText variant="small">
        Una vez al día y al terminar cada entreno, en un repositorio privado tuyo. Cada copia queda como una versión.
        {settings.devMode ? ' Con el modo pruebas activo no se hacen copias automáticas.' : ''}
      </AppText>
      <TextField label="Usuario de GitHub" value={owner} onChangeText={setOwner} placeholder="usuario" />
      <TextField label="Repositorio privado" value={repo} onChangeText={setRepo} placeholder="entreno-backup" />
      <TextField label="Fichero" value={path} onChangeText={setPath} placeholder="entreno-backup.json" />
      <TextField
        label={hasToken ? 'Token (guardado; escribe uno nuevo para cambiarlo)' : 'Token de acceso'}
        value={token}
        onChangeText={setToken}
        placeholder={hasToken ? '••••••••' : 'github_pat_…'}
        secure
      />
      <Button title="Guardar configuración" disabled={busy} onPress={saveGithub} />
      <Row>
        <Button
          kind="secondary"
          title="Subir copia ahora"
          disabled={busy}
          onPress={run(async () => {
            await backupToGithub(db);
            return 'Copia subida a GitHub.';
          })}
        />
        <Button
          kind="secondary"
          title="Restaurar de GitHub"
          disabled={busy}
          onPress={run(async () => restore(await downloadFromGithub(db)))}
        />
      </Row>
      <AppText variant="small">
        {settings.lastBackupAt ? `Última copia en GitHub: ${formatAgo(settings.lastBackupAt)}` : 'Aún no se ha subido ninguna copia.'}
      </AppText>
      {settings.lastBackupError ? (
        <AppText variant="small" style={{ color: colors.danger }}>
          Último error: {settings.lastBackupError}
        </AppText>
      ) : null}
      {message ? (
        <AppText style={{ color: message.ok ? colors.primary : colors.danger }}>{message.text}</AppText>
      ) : null}
      {hasToken ? (
        <Button
          kind="ghost"
          title="Olvidar el token"
          disabled={busy}
          onPress={run(async () => {
            await githubToken.clear();
            return 'Token borrado del móvil.';
          })}
        />
      ) : null}
    </Card>
  );
}
