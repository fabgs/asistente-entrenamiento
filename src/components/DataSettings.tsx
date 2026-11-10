import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import type { Db } from '@/db/db';
import type { Backup } from '@/db/maintenance';
import type { SeedData } from '@/db/seedTypes';
import { updateSettings, type Settings } from '@/db/repositories/settings';
import { WrongPasswordError } from '@/domain/backupCipher';
import { formatAgo, formatBytes, formatDateWithYear } from '@/domain/format';
import { localDateString } from '@/domain/schedule';
import { useDb } from '@/hooks/data';
import { deleteUnusedPhotos } from '@/services/photos';
import {
  backupToGithub,
  downloadFromGithub,
  githubTarget,
  githubToken,
  openBackup,
  PasswordNeededError,
  type OpenedBackup,
  pickBackupFile,
  resetToSeed,
  restoreFrom,
  shareBackupFile,
} from '@/services/backup';
import { colors, spacing, switchThumb } from '@/theme';
import { showDialog, showPrompt, showSnackbar } from './Dialog';
import { AppText, Button, Card, Icon, ListGroup, ListRow, RowIcon, Section, Tag, TextField } from './ui';

// Only development builds bundle the Excel data: `__DEV__` is false in a release build, so the
// bundler drops this branch and the require with it.
const loadDemoSeed: (() => SeedData) | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => (require('@/db/demoSeed') as typeof import('@/db/demoSeed')).DEMO_SEED
  : null;
const addDemoWalk: ((db: Db) => Promise<number>) | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (db) => (require('@/db/demoWalk') as typeof import('@/db/demoWalk')).addDemoWalk(db)
  : null;
const addDemoSprints: ((db: Db) => Promise<number>) | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (db) => (require('@/db/demoSprints') as typeof import('@/db/demoSprints')).addDemoSprints(db)
  : null;

const DEFAULT_BACKUP_PATH = 'entreno-backup.json';

/** A setting that switches on and off, as a row of a ListGroup: the whole row toggles. */
export function SettingSwitch({
  label,
  subtitle,
  value,
  onValueChange,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      android_ripple={{ color: colors.pressed }}
      style={[styles.row, subtitle ? styles.twoLines : null]}>
      <View style={styles.rowText}>
        <AppText variant="rowTitle">{label}</AppText>
        {subtitle ? <AppText variant="secondary">{subtitle}</AppText> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        thumbColor={value ? switchThumb.on : switchThumb.off}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </Pressable>
  );
}

/** Title of a row that destroys something: red, with its icon on the left. */
const dangerTitle = (text: string) => (
  <AppText variant="rowTitle" style={{ color: colors.danger }}>
    {text}
  </AppText>
);

const Spinner = () => <ActivityIndicator color={colors.primary} />;

export function DevModeSection({ enabled, onChange }: { enabled: boolean; onChange: (value: boolean) => void }) {
  const db = useDb();

  const reset = (seed?: SeedData) =>
    showDialog(
      seed ? '¿Cargar los datos de prueba?' : '¿Reiniciar los datos?',
      seed
        ? 'Se borra todo y se cargan las rutinas, el cardio, la dieta y el historial del Excel.'
        : 'Se borra todo: entrenos, rutinas, dieta, pesos y perfil. La app queda como recién instalada, con los catálogos de ejercicios y alimentos. La configuración de la copia en GitHub se mantiene.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: seed ? 'Borrar y cargar' : 'Borrar todo',
          style: 'destructive',
          onPress: async () => {
            await resetToSeed(db, undefined, seed);
            router.dismissTo('/');
          },
        },
      ],
    );

  return (
    <Section label="Modo pruebas" right={enabled ? <Tag label="Activo" tone="warning" icon="flask-outline" /> : undefined}>
      <ListGroup>
        <SettingSwitch
          label="Borrar los datos al instalar una versión nueva"
          subtitle={enabled ? 'Apágalo antes de instalar si quieres conservar tus datos' : undefined}
          value={enabled}
          onValueChange={onChange}
        />
        <ListRow
          left={<RowIcon name="trash-can-outline" color={colors.danger} />}
          title={dangerTitle('Reiniciar datos ahora')}
          onPress={() => reset()}
          chevron={false}
        />
        {loadDemoSeed ? (
          <ListRow
            left={<RowIcon name="database-import-outline" />}
            title="Cargar datos de prueba (Excel)"
            onPress={() => reset(loadDemoSeed!())}
            chevron={false}
          />
        ) : null}
        {addDemoWalk ? (
          <ListRow
            left={<RowIcon name="walk" />}
            title="Añadir caminata de prueba"
            onPress={async () => router.push(`/cardio-sesion/${await addDemoWalk!(db)}`)}
          />
        ) : null}
        {addDemoSprints ? (
          <ListRow
            left={<RowIcon name="run-fast" />}
            title="Añadir sprints de prueba"
            onPress={async () => router.push(`/cardio-sesion/${await addDemoSprints!(db)}`)}
          />
        ) : null}
        {__DEV__ ? (
          <ListRow left={<RowIcon name="palette-outline" />} title="Catálogo de componentes" onPress={() => router.push('/dev/componentes')} />
        ) : null}
      </ListGroup>
    </Section>
  );
}

function confirmDeleteUnused(count: number, onDelete: () => Promise<void>): void {
  showDialog(
    count === 1 ? '¿Borrar la foto sin sesión?' : `¿Borrar las ${count} fotos sin sesión?`,
    'Son imágenes de fotos que ya no están en ninguna sesión: se quitaron en pruebas o se restauró una copia sin ellas. Restaurar una copia que las tenga las recupera; borradas, ya no.',
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await onDelete();
          showSnackbar(count === 1 ? 'Foto borrada' : 'Fotos borradas');
        },
      },
    ],
  );
}

function confirmRestore(backup: Backup): Promise<boolean> {
  const date = formatDateWithYear(localDateString(new Date(backup.exportedAt)));
  return new Promise((resolve) =>
    showDialog('¿Restaurar la copia?', `Todos tus datos se sustituyen por los de la copia del ${date}.`, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Restaurar', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Opens a copy, asking for its password while it is encrypted and none opens it; null if cancelled. */
async function openAskingPassword(text: string): Promise<OpenedBackup | null> {
  let password: string | undefined;
  let message = 'Escribe la contraseña con la que se cifró.';
  for (;;) {
    try {
      return await openBackup(text, password);
    } catch (e) {
      if (!(e instanceof PasswordNeededError || e instanceof WrongPasswordError)) throw e;
      if (e instanceof WrongPasswordError) message = 'No es esa. Prueba otra vez.';
      const typed = await showPrompt('Copia cifrada', { value: '', message, secure: true, confirm: 'Abrir' });
      if (typed === null) return null;
      password = typed;
    }
  }
}

type Task = 'export' | 'import' | 'upload' | 'restore';

/**
 * Backup to a file and to GitHub (PLAN.md §9). `settings` must be fresh from the database:
 * `onChanged` reloads them after an upload, `onReplaced` after restoring a copy.
 */
export function BackupSection({
  settings,
  hasToken,
  encrypted,
  devMode,
  github,
  unusedPhotos,
  onChanged,
  onReplaced,
}: {
  settings: Settings;
  hasToken: boolean;
  /** Copies leave the phone encrypted with the user's password. */
  encrypted: boolean;
  devMode: boolean;
  /** The copy in GitHub: only with the admin options (exporting a file is for everyone). */
  github: boolean;
  /** Pictures no session uses any more (tests, a copy restored without them). */
  unusedPhotos: { files: string[]; bytes: number };
  onChanged: () => Promise<void>;
  onReplaced: () => Promise<void>;
}) {
  const db = useDb();
  const [busy, setBusy] = useState<Task | null>(null);
  const [editing, setEditing] = useState(false);
  const target = githubTarget(settings);

  const run = async (task: Task, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(task);
    try {
      await work();
    } catch (e) {
      showSnackbar(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (text: string | null) => {
    const opened = text === null ? null : await openAskingPassword(text);
    if (!opened || !(await confirmRestore(opened.backup))) return;
    await restoreFrom(db, opened);
    await onReplaced();
    showSnackbar('Datos restaurados');
  };

  const upload = (): Promise<void> =>
    run('upload', async () => {
      try {
        await backupToGithub(db);
        showSnackbar('Copia subida a GitHub');
      } catch {
        // The reason stays in the «Última copia» row.
        showSnackbar('No se pudo subir la copia', { label: 'Reintentar', onPress: upload });
      } finally {
        await onChanged();
      }
    });

  const busyIcon = (task: Task) => (busy === task ? <Spinner /> : undefined);

  const toggleForm = (
    <Icon name={editing ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
  );

  return (
    <Section label="Copia de seguridad">
      <ListGroup inset={72}>
        <ListRow
          left={<RowIcon name="export-variant" />}
          title="Exportar copia"
          right={busyIcon('export')}
          onPress={() => run('export', () => shareBackupFile(db))}
          chevron={false}
          disabled={!!busy}
        />
        <ListRow
          left={<RowIcon name="file-import-outline" />}
          title="Importar copia"
          right={busyIcon('import')}
          onPress={() => run('import', async () => restore(await pickBackupFile()))}
          chevron={false}
          disabled={!!busy}
        />
      </ListGroup>

      <ListGroup inset={72}>
        {encrypted ? (
          <ListRow
            left={<RowIcon name="lock-check-outline" color={colors.primary} />}
            title="Copias cifradas"
            subtitle="Salen del móvil cifradas"
            onPress={() => router.push('/cifrado')}
          />
        ) : (
          <ListRow
            left={<RowIcon name="lock-open-variant-outline" color={colors.warning} />}
            title="Cifrar las copias"
            subtitle="Ahora salen del móvil sin cifrar"
            onPress={() => router.push('/cifrado')}
          />
        )}
      </ListGroup>

      {unusedPhotos.files.length > 0 ? (
        <ListGroup inset={72}>
          <ListRow
            left={<RowIcon name="image-off-outline" />}
            title="Fotos sin sesión"
            subtitle={`${unusedPhotos.files.length === 1 ? '1 imagen' : `${unusedPhotos.files.length} imágenes`} · ${formatBytes(unusedPhotos.bytes)}`}
            onPress={() => confirmDeleteUnused(unusedPhotos.files.length, () => deleteUnusedPhotos(db).then(onChanged))}
            chevron={false}
          />
        </ListGroup>
      ) : null}

      {!github ? null : target ? (
        <ListGroup inset={72}>
          <ListRow left={<RowIcon name="github" />} title="Repositorio" subtitle={`${target.owner}/${target.repo}`} />
          <LastBackupRow settings={settings} hasToken={hasToken} devMode={devMode} onFix={() => setEditing(true)} />
          <ListRow
            left={<RowIcon name="cloud-upload-outline" />}
            title="Subir ahora"
            right={busyIcon('upload')}
            onPress={upload}
            chevron={false}
            disabled={!!busy || !hasToken}
          />
          <ListRow
            left={<RowIcon name="cloud-download-outline" />}
            title="Restaurar…"
            right={busyIcon('restore')}
            onPress={() => run('restore', async () => restore(await downloadFromGithub(db)))}
            chevron={false}
            disabled={!!busy || !hasToken}
          />
          <ListRow
            left={<RowIcon name="cog-outline" />}
            title="Cambiar configuración"
            right={toggleForm}
            onPress={() => setEditing(!editing)}
            chevron={false}
          />
        </ListGroup>
      ) : (
        <ListGroup inset={72}>
          <ListRow
            left={<RowIcon name="cloud-upload-outline" />}
            title="Copia automática en GitHub"
            subtitle="Una vez al día, en un repositorio privado tuyo"
            right={toggleForm}
            onPress={() => setEditing(!editing)}
            chevron={false}
          />
        </ListGroup>
      )}

      {github && editing ? (
        <GithubForm
          settings={settings}
          hasToken={hasToken}
          onDone={async (message) => {
            setEditing(false);
            await onChanged();
            showSnackbar(message);
          }}
        />
      ) : null}
    </Section>
  );
}

function LastBackupRow({
  settings,
  hasToken,
  devMode,
  onFix,
}: {
  settings: Settings;
  hasToken: boolean;
  devMode: boolean;
  onFix: () => void;
}) {
  const automatic = devMode ? 'En modo pruebas no se hacen copias automáticas' : undefined;
  if (!hasToken) {
    return (
      <ListRow
        left={<RowIcon name="alert-circle" color={colors.warning} />}
        title="Falta el token de acceso"
        subtitle="Escríbelo en Cambiar configuración"
        onPress={onFix}
        chevron={false}
      />
    );
  }
  if (settings.lastBackupError) {
    return (
      <ListRow
        left={<RowIcon name="alert-circle" color={colors.danger} />}
        title="No se pudo subir la última copia"
        subtitle={
          <AppText variant="secondary" numberOfLines={3}>
            {settings.lastBackupError}
          </AppText>
        }
      />
    );
  }
  if (settings.lastBackupAt) {
    return (
      <ListRow
        left={<RowIcon name="check-circle" color={colors.primary} />}
        title={`Última copia · ${formatAgo(settings.lastBackupAt)}`}
        subtitle={automatic}
      />
    );
  }
  return <ListRow left={<RowIcon name="history" />} title="Aún no hay ninguna copia" subtitle={automatic} />;
}

/** Where the copy goes and the token; «Guardar» saves and folds it back into its rows. */
function GithubForm({
  settings,
  hasToken,
  onDone,
}: {
  settings: Settings;
  hasToken: boolean;
  onDone: (message: string) => void;
}) {
  const db = useDb();
  const saved = {
    owner: settings.backupOwner ?? '',
    repo: settings.backupRepo ?? '',
    path: settings.backupPath ?? DEFAULT_BACKUP_PATH,
  };
  const [owner, setOwner] = useState(saved.owner);
  const [repo, setRepo] = useState(saved.repo);
  const [path, setPath] = useState(saved.path);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const changed =
    owner.trim() !== saved.owner || repo.trim() !== saved.repo || path.trim() !== saved.path || token.trim() !== '';

  const save = async () => {
    setSaving(true);
    try {
      await updateSettings(db, {
        backupOwner: owner.trim() || null,
        backupRepo: repo.trim() || null,
        backupPath: path.trim() || null,
      });
      if (token.trim()) await githubToken.set(token);
      onDone('Cambios guardados');
    } catch (e) {
      showSnackbar(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const forget = async () => {
    await githubToken.clear();
    onDone('Token borrado del móvil');
  };

  return (
    <Card>
      <TextField label="Usuario de GitHub" value={owner} onChangeText={setOwner} placeholder="usuario" autoCapitalize="none" />
      <TextField label="Repositorio privado" value={repo} onChangeText={setRepo} placeholder="entreno-backup" autoCapitalize="none" />
      <TextField label="Fichero" value={path} onChangeText={setPath} placeholder={DEFAULT_BACKUP_PATH} autoCapitalize="none" />
      <TextField
        label="Token de acceso"
        value={token}
        onChangeText={setToken}
        placeholder={hasToken ? '••••••••' : 'github_pat_…'}
        help={hasToken ? 'Ya hay uno guardado: escribe otro solo para cambiarlo' : undefined}
        secure
      />
      <Button size="lg" title="Guardar" disabled={!changed || saving} onPress={save} />
      {hasToken ? <Button kind="text" title="Olvidar el token" disabled={saving} onPress={forget} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  twoLines: { minHeight: 72 },
  rowText: { flex: 1, gap: 2 },
});
