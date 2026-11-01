import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { AppText, Button, Card, Chip, Loading, Row, Screen, Stepper, SwitchRow, TextField } from '@/components/ui';
import {
  archiveExercise,
  createExercise,
  exerciseNameTaken,
  getExercise,
  updateExercise,
  type Exercise,
} from '@/db/repositories/exercises';
import { addSlot } from '@/db/repositories/routines';
import { getSettings } from '@/db/repositories/settings';
import { EXERCISE_TYPE_LABEL, formatEquipment, formatKg } from '@/domain/format';
import type { ExerciseType } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { rescheduleDailyReminders } from '@/services/dailyReminder';
import { colors } from '@/theme';

const EMPTY: Exercise = { id: 0, name: '', type: 'external', equipment: null, incrementKg: null, notes: null };

/** Create (`id = nuevo`) or edit an exercise of the catalog. */
export default function ExerciseEditorScreen() {
  const { id, pickFor } = useLocalSearchParams<{ id: string; pickFor?: string }>();
  const isNew = id === 'nuevo';
  const { data } = useLoader(async (db) => ({
    exercise: isNew ? EMPTY : await getExercise(db, Number(id)),
    defaultIncrement: (await getSettings(db)).defaultIncrementKg,
  }));

  if (!data) return <Loading />;
  if (!data.exercise) {
    return (
      <Screen>
        <AppText>No se encontró el ejercicio.</AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Nuevo ejercicio' : 'Editar ejercicio' }} />
      <ExerciseForm
        exercise={data.exercise}
        isNew={isNew}
        defaultIncrement={data.defaultIncrement}
        pickFor={pickFor ? Number(pickFor) : null}
      />
    </Screen>
  );
}

function ExerciseForm({
  exercise,
  isNew,
  defaultIncrement,
  pickFor,
}: {
  exercise: Exercise;
  isNew: boolean;
  defaultIncrement: number;
  pickFor: number | null;
}) {
  const db = useDb();
  const [name, setName] = useState(exercise.name);
  const [type, setType] = useState<ExerciseType>(exercise.type);
  const [equipment, setEquipment] = useState(formatEquipment(exercise.equipment) ?? '');
  const [ownIncrement, setOwnIncrement] = useState(exercise.incrementKg !== null);
  const [increment, setIncrement] = useState(exercise.incrementKg ?? defaultIncrement);
  const [notes, setNotes] = useState(exercise.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Ponle un nombre');
    if (await exerciseNameTaken(db, trimmed, isNew ? undefined : exercise.id)) {
      return setError('Ya hay un ejercicio con ese nombre');
    }
    const fields = {
      name: trimmed,
      type,
      equipment: equipment.trim() || null,
      incrementKg: ownIncrement ? increment : null,
      notes: notes.trim() || null,
    };
    try {
      if (!isNew) {
        await updateExercise(db, exercise.id, fields);
        router.back();
        return;
      }
      const id = await createExercise(db, fields);
      if (pickFor === null) {
        router.back();
        return;
      }
      const slotId = await addSlot(db, pickFor, { id, type });
      await rescheduleDailyReminders(db);
      // Leave the picker behind: back to whoever asked for the exercise, then straight into its settings.
      router.back();
      router.replace(`/slot/${slotId}`);
    } catch {
      setError('No se pudo guardar: ese nombre lo usa un ejercicio archivado');
    }
  };

  const archive = () =>
    Alert.alert('Archivar ejercicio', 'Dejará de salir en el catálogo. Las rutinas que lo usan y su historial no cambian.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Archivar',
        style: 'destructive',
        onPress: async () => {
          await archiveExercise(db, exercise.id);
          router.back();
        },
      },
    ]);

  return (
    <>
      <Card>
        <TextField label="Nombre" value={name} onChangeText={setName} placeholder="Press militar" />
        <AppText variant="small">Tipo</AppText>
        <Row>
          {(['external', 'bodyweight'] as const).map((t) => (
            <Chip key={t} label={EXERCISE_TYPE_LABEL[t]} selected={type === t} onPress={() => setType(t)} />
          ))}
        </Row>
        <TextField label="Material (opcional)" value={equipment} onChangeText={setEquipment} placeholder="barra, mancuernas…" />
        <SwitchRow
          label={`Incremento propio (por defecto ${formatKg(defaultIncrement)})`}
          value={ownIncrement}
          onValueChange={setOwnIncrement}
        />
        {ownIncrement ? (
          <Stepper decimal value={increment} onChange={setIncrement} step={0.5} min={0.25} format={formatKg} />
        ) : null}
        <TextField label="Notas (opcional)" value={notes} onChangeText={setNotes} multiline />
        {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
        <Button title={isNew && pickFor !== null ? 'Crear y añadir a la rutina' : 'Guardar'} onPress={save} />
      </Card>
      {!isNew ? <Button kind="danger" title="Archivar ejercicio" onPress={archive} /> : null}
    </>
  );
}
