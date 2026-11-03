import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { showActions, showDialog } from '@/components/Dialog';
import { FormRow } from '@/components/FormRow';
import {
  AppText,
  BottomBar,
  Button,
  EmptyState,
  HeaderButton,
  ListGroup,
  ListRow,
  Loading,
  NumberRow,
  Screen,
  Segmented,
  SwitchRow,
  TextField,
} from '@/components/ui';
import {
  archiveExercise,
  createExercise,
  exerciseNameTaken,
  getExercise,
  updateExercise,
  type Exercise,
  type ExerciseFields,
} from '@/db/repositories/exercises';
import { exerciseSessions } from '@/db/repositories/progress';
import { addSlot } from '@/db/repositories/routines';
import { getSettings } from '@/db/repositories/settings';
import { formatEquipment, formatKg, formatSetGroups } from '@/domain/format';
import type { ExerciseType } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { queueWrite, reschedule, useSaveGuard } from '@/hooks/editing';
import { spacing } from '@/theme';

const EMPTY: Exercise = { id: 0, name: '', type: 'external', equipment: null, incrementKg: null, notes: null, pair: false };

const TYPES: { value: ExerciseType; label: string }[] = [
  { value: 'external', label: 'Carga externa' },
  { value: 'bodyweight', label: 'Peso corporal' },
];

/**
 * Create (`id = nuevo`, optionally with `nombre`) or edit an exercise of the catalog. With `pickFor`
 * (a routine id), the new exercise is also added to that routine.
 */
export default function ExerciseEditorScreen() {
  const { id, pickFor, nombre } = useLocalSearchParams<{ id: string; pickFor?: string; nombre?: string }>();
  const isNew = id === 'nuevo';
  const { data } = useLoader(async (db) => {
    const exercise = isNew ? { ...EMPTY, name: nombre ?? '' } : await getExercise(db, Number(id));
    const last = exercise && !isNew ? ((await exerciseSessions(db, exercise.id))[0] ?? null) : null;
    return {
      exercise,
      lastTime: last ? formatSetGroups(last.sets, exercise?.type === 'bodyweight', exercise?.pair) : null,
      defaultIncrement: (await getSettings(db)).defaultIncrementKg,
    };
  });

  if (!data) {
    return (
      <>
        <Stack.Screen options={{ title: isNew ? 'Nuevo ejercicio' : 'Editar ejercicio' }} />
        <Loading />
      </>
    );
  }
  if (!data.exercise) {
    return (
      <Screen>
        <EmptyState icon="dumbbell" title="Este ejercicio ya no existe" />
      </Screen>
    );
  }
  return (
    <ExerciseForm
      key={data.exercise.id}
      exercise={data.exercise}
      isNew={isNew}
      lastTime={data.lastTime}
      defaultIncrement={data.defaultIncrement}
      pickFor={pickFor ? Number(pickFor) : null}
    />
  );
}

function ExerciseForm({
  exercise,
  isNew,
  lastTime,
  defaultIncrement,
  pickFor,
}: {
  exercise: Exercise;
  isNew: boolean;
  lastTime: string | null;
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
  const [pair, setPair] = useState(exercise.pair);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fields: ExerciseFields = {
    name: name.trim(),
    type,
    equipment: equipment.trim() || null,
    incrementKg: ownIncrement ? increment : null,
    notes: notes.trim() || null,
    // Only weights can be held in two hands.
    pair: type === 'external' && pair,
  };
  // As the form would save it, so that an untouched exercise is not "changed".
  const initial: ExerciseFields = {
    name: exercise.name.trim(),
    type: exercise.type,
    equipment: formatEquipment(exercise.equipment)?.trim() || null,
    incrementKg: exercise.incrementKg,
    notes: exercise.notes?.trim() || null,
    pair: exercise.type === 'external' && exercise.pair,
  };
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  const canSave = fields.name !== '' && (isNew || dirty);

  /** Saves; for a new exercise picked for a routine, also adds it and returns its slot. */
  const save = async (): Promise<number | boolean> => {
    if (!fields.name) {
      setError('Ponle un nombre');
      return false;
    }
    if (await exerciseNameTaken(db, fields.name, isNew ? undefined : exercise.id)) {
      setError('Ya hay un ejercicio con ese nombre');
      return false;
    }
    try {
      return await queueWrite(async () => {
        if (!isNew) {
          await updateExercise(db, exercise.id, fields);
          return true;
        }
        const id = await createExercise(db, fields);
        return pickFor === null ? true : addSlot(db, pickFor, { id, type });
      });
    } catch {
      setError('No se pudo guardar: prueba con otro nombre');
      return false;
    } finally {
      if (isNew && pickFor !== null) reschedule(db);
    }
  };
  const leave = useSaveGuard(dirty, async () => (await save()) !== false);

  const submit = async () => {
    setSaving(true);
    try {
      const saved = await save();
      if (saved === false) return;
      leave();
      // Picked for a routine: straight into its settings, leaving the picker behind.
      if (typeof saved === 'number') router.replace(`/slot/${saved}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    showDialog('¿Borrar el ejercicio?', 'Desaparece del catálogo. Las rutinas que lo usan y su historial no cambian.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await queueWrite(() => archiveExercise(db, exercise.id));
          leave();
        },
      },
    ]);

  return (
    <Screen
      footer={
        <BottomBar>
          <Button
            size="lg"
            title={isNew && pickFor !== null ? 'Añadir a la rutina' : 'Guardar'}
            disabled={!canSave || saving}
            onPress={submit}
            style={styles.flex}
          />
        </BottomBar>
      }>
      <Stack.Screen
        options={{
          title: isNew ? 'Nuevo ejercicio' : 'Editar ejercicio',
          headerRight: isNew
            ? undefined
            : () => (
                <HeaderButton
                  icon="dots-vertical"
                  label="Más acciones"
                  onPress={() =>
                    showActions([{ text: 'Borrar ejercicio', icon: 'trash-can-outline', destructive: true, onPress: remove }])
                  }
                />
              ),
        }}
      />
      <View style={styles.fields}>
        <TextField
          label="Nombre"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError(null);
          }}
          placeholder="Press militar"
          error={error ?? undefined}
        />
        <View style={styles.field}>
          <AppText variant="label">Tipo</AppText>
          <Segmented options={TYPES} value={type} onChange={setType} />
        </View>
        <TextField label="Material" value={equipment} onChangeText={setEquipment} placeholder="Barra, mancuernas…" />
      </View>

      <ListGroup>
        {type === 'external' ? (
          <FormRow>
            <SwitchRow
              label="Dos mancuernas"
              subtitle="El peso es el de cada una"
              value={pair}
              onValueChange={setPair}
            />
          </FormRow>
        ) : null}
        <FormRow>
          <SwitchRow
            label="Incremento propio"
            subtitle={`Por defecto ${formatKg(defaultIncrement)}`}
            value={ownIncrement}
            onValueChange={setOwnIncrement}
          />
        </FormRow>
        {ownIncrement ? (
          <FormRow>
            <NumberRow label="Incremento" value={increment} onChange={setIncrement} step={0.5} min={0.5} format={formatKg} />
          </FormRow>
        ) : null}
      </ListGroup>

      <TextField label="Notas" value={notes} onChangeText={setNotes} multiline />

      {lastTime ? (
        <ListGroup>
          <ListRow
            title="Últimas sesiones"
            subtitle={lastTime}
            onPress={() => router.push(`/progreso/${exercise.id}`)}
          />
        </ListGroup>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fields: { gap: spacing.lg },
  field: { gap: 6 },
});
