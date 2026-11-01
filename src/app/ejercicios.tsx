import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText, Button, Loading, Screen, TextField } from '@/components/ui';
import { listExercises, type Exercise } from '@/db/repositories/exercises';
import { addSlot } from '@/db/repositories/routines';
import { EXERCISE_TYPE_LABEL, formatEquipment, normalizeForSearch } from '@/domain/format';
import { useDb, useLoader } from '@/hooks/data';
import { rescheduleDailyReminders } from '@/services/dailyReminder';
import { colors, spacing } from '@/theme';

/** Exercise catalog. With `pickFor` (a routine id), tapping an exercise adds it to that routine. */
export default function ExercisesScreen() {
  const { pickFor } = useLocalSearchParams<{ pickFor?: string }>();
  const routineId = pickFor ? Number(pickFor) : null;
  const db = useDb();
  const [query, setQuery] = useState('');
  const { data } = useLoader((db) => listExercises(db));

  if (!data) return <Loading />;

  const visible = data.filter((e) => normalizeForSearch(e.name).includes(normalizeForSearch(query.trim())));

  const choose = async (exercise: Exercise) => {
    if (routineId === null) {
      router.push(`/ejercicio/${exercise.id}`);
      return;
    }
    const slotId = await addSlot(db, routineId, exercise);
    await rescheduleDailyReminders(db);
    router.replace(`/slot/${slotId}`);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: routineId === null ? 'Ejercicios' : 'Añadir ejercicio' }} />
      <TextField label="Buscar" value={query} onChangeText={setQuery} placeholder="Remo, sentadilla…" />
      <Button
        kind="secondary"
        title="Crear ejercicio nuevo"
        onPress={() =>
          router.push({ pathname: '/ejercicio/[id]', params: { id: 'nuevo', ...(pickFor ? { pickFor } : {}) } })
        }
      />
      {visible.map((exercise) => (
        <Pressable key={exercise.id} style={styles.row} onPress={() => choose(exercise)}>
          <AppText>{exercise.name}</AppText>
          <AppText variant="small">
            {EXERCISE_TYPE_LABEL[exercise.type]}
            {formatEquipment(exercise.equipment) ? ` · ${formatEquipment(exercise.equipment)}` : ''}
          </AppText>
        </Pressable>
      ))}
      {visible.length === 0 ? <AppText variant="muted">Ningún ejercicio coincide.</AppText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 2,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
