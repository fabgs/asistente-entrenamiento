import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { showActions, showDialog, showSnackbar } from '@/components/Dialog';
import { AppText, BottomBar, Button, Card, HeaderButton, Loading, Screen, TextField } from '@/components/ui';
import { getSettings } from '@/db/repositories/settings';
import { MIN_PASSWORD_LENGTH, passwordProblem } from '@/domain/backupCipher';
import { useDb, useLoader } from '@/hooks/data';
import {
  backupToGithub,
  clearBackupPassword,
  githubTarget,
  githubToken,
  hasBackupPassword,
  setBackupPassword,
} from '@/services/backup';

/** The password that encrypts the copies before they leave the phone (PLAN.md §9). */
export default function BackupPasswordScreen() {
  const db = useDb();
  const { data } = useLoader(async (db) => {
    const settings = await getSettings(db);
    return {
      encrypted: await hasBackupPassword(),
      // In test mode nothing is uploaded on its own: it would replace the real copy with test data.
      upload: !settings.devMode && githubTarget(settings) !== null && (await githubToken.get()) !== null,
    };
  });
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [saving, setSaving] = useState(false);
  if (!data) return <Loading />;

  const problem = passwordProblem(password, repeated);
  // Says what is wrong only once both fields have something to compare.
  const error = repeated && problem ? problem : undefined;

  const save = async () => {
    setSaving(true);
    try {
      await setBackupPassword(password);
    } catch (e) {
      setSaving(false);
      showSnackbar(e instanceof Error ? e.message : String(e));
      return;
    }
    if (data.upload) {
      try {
        await backupToGithub(db);
        showSnackbar('Contraseña guardada y copia cifrada subida');
      } catch {
        showSnackbar('Contraseña guardada. La copia no se pudo subir: súbela desde Ajustes');
      }
    } else {
      showSnackbar('Contraseña guardada');
    }
    router.back();
  };

  const stopEncrypting = () =>
    showDialog(
      '¿Dejar de cifrar las copias?',
      'Las próximas copias saldrán del móvil sin cifrar. Las que ya están cifradas seguirán pidiendo su contraseña.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Dejar de cifrar',
          style: 'destructive',
          onPress: async () => {
            await clearBackupPassword();
            showSnackbar('Las copias ya no se cifran');
            router.back();
          },
        },
      ],
    );

  return (
    <Screen
      footer={
        <BottomBar>
          <Button
            size="lg"
            title={saving ? 'Preparando la clave…' : 'Guardar'}
            disabled={problem !== null || saving}
            onPress={save}
            style={{ flex: 1 }}
          />
        </BottomBar>
      }>
      <Stack.Screen
        options={{
          title: data.encrypted ? 'Cambiar la contraseña' : 'Cifrar las copias',
          headerRight: data.encrypted
            ? () => (
                <HeaderButton
                  icon="dots-vertical"
                  label="Más acciones"
                  onPress={() =>
                    showActions([{ text: 'Dejar de cifrar', icon: 'lock-open-variant-outline', destructive: true, onPress: stopEncrypting }])
                  }
                />
              )
            : undefined,
        }}
      />
      <Card>
        <AppText variant="body">
          Las copias se cifran en el móvil antes de subirlas a GitHub o de exportarlas: fuera de él solo se ven datos ilegibles.
        </AppText>
        <AppText variant="secondary">
          Para restaurarlas en otro móvil hará falta esta contraseña. Si la olvidas, nadie puede recuperarlas: guárdala en tu gestor de contraseñas.
        </AppText>
        <AppText variant="secondary">
          {data.encrypted
            ? 'Las copias nuevas usarán la contraseña nueva; las de antes se siguen abriendo con la anterior.'
            : 'Las copias que ya están en GitHub no cambian: siguen sin cifrar en el historial del repositorio.'}
        </AppText>
      </Card>
      <TextField
        label={data.encrypted ? 'Contraseña nueva' : 'Contraseña'}
        value={password}
        onChangeText={setPassword}
        help={`Al menos ${MIN_PASSWORD_LENGTH} caracteres. Mejor una frase que solo sepas tú.`}
        secure
        autoFocus
      />
      <TextField label="Repítela" value={repeated} onChangeText={setRepeated} error={error} secure />
    </Screen>
  );
}
