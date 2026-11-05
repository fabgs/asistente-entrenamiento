import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Fragment, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SearchField } from '@/components/SearchField';
import { Button, Card, Divider, EmptyState, ExerciseIcon, HeaderButton, ListGroup, ListRow, Loading, RowIcon, Screen } from '@/components/ui';
import { listArchivedExercises, listExercises, type Exercise } from '@/db/repositories/exercises';
import { allExerciseMuscles } from '@/db/repositories/muscles';
import { addSlot } from '@/db/repositories/routines';
import { normalizeForSearch } from '@/domain/format';
import { hasMuscles, matchesExercise, muscleLabel } from '@/domain/muscles';
import { useDb, useLoader } from '@/hooks/data';
import { queueWrite, reschedule } from '@/hooks/editing';
import { spacing } from '@/theme';

/** Alphabetical without minding accents (SQLite's NOCASE would put "Á" after "Z"). */
const byName = (a: Exercise, b: Exercise) => {
  const [x, y] = [normalizeForSearch(a.name), normalizeForSearch(b.name)];
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Exercise catalog. With `pickFor` (a routine id), tapping an exercise adds it to that routine; with
 * `sinMusculos` (ids), only those of them still without muscles (from «N ejercicios sin músculos»);
 * with `archivados`, the archived ones, which open their editor to look at them or bring them back.
 */
export default function ExercisesScreen() {
  const { pickFor, sinMusculos, archivados } = useLocalSearchParams<{ pickFor?: string; sinMusculos?: string; archivados?: string }>();
  const routineId = pickFor ? Number(pickFor) : null;
  const onlyIds = sinMusculos ? sinMusculos.split(',').map(Number) : null;
  const archivedOnly = archivados === '1';
  const db = useDb();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const { data } = useLoader(async (db) => {
    const archived = await listArchivedExercises(db);
    return { exercises: archivedOnly ? archived : await listExercises(db), archivedCount: archived.length, muscles: await allExerciseMuscles(db) };
  });

  const create = (name?: string) =>
    router.push({
      pathname: '/ejercicio/[id]',
      params: { id: 'nuevo', ...(pickFor ? { pickFor } : {}), ...(name ? { nombre: name } : {}) },
    });
  const header = (
    <Stack.Screen
      options={{
        title: onlyIds ? 'Sin músculos' : archivedOnly ? 'Archivados' : routineId === null ? 'Ejercicios' : 'Añadir ejercicio',
        headerRight:
          onlyIds || archivedOnly ? undefined : () => <HeaderButton icon="plus" label="Nuevo ejercicio" onPress={() => create()} />,
      }}
    />
  );

  if (!data) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }

  const wanted = query.trim();
  const visible = data.exercises
    .filter((e) => !onlyIds || (onlyIds.includes(e.id) && !hasMuscles(data.muscles.get(e.id))))
    .filter((e) => matchesExercise(wanted, e.name, data.muscles.get(e.id)))
    .sort(byName);

  const choose = async (exercise: Exercise) => {
    if (routineId === null) {
      router.push(`/ejercicio/${exercise.id}`);
      return;
    }
    if (adding) return;
    setAdding(true);
    try {
      const slotId = await queueWrite(() => addSlot(db, routineId, exercise));
      reschedule(db);
      router.replace(`/slot/${slotId}`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Screen>
      {header}
      <SearchField value={query} onChangeText={setQuery} />
      {visible.length === 0 && onlyIds ? (
        <EmptyState icon="check-circle-outline" title="Ya tienen músculos" text="Sus series cuentan en tu semana." />
      ) : visible.length === 0 && archivedOnly ? (
        <EmptyState
          icon={wanted ? 'magnify' : 'archive-outline'}
          title={wanted ? 'Ningún ejercicio coincide' : 'No hay ejercicios archivados'}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={wanted ? 'magnify' : 'dumbbell'}
          title={wanted ? 'Ningún ejercicio coincide' : 'Sin ejercicios todavía'}
          action={
            <View style={styles.emptyAction}>
              <Button
                kind="secondary"
                icon="plus"
                title={wanted ? `Crear «${query.trim()}»` : 'Nuevo ejercicio'}
                onPress={() => create(wanted ? query.trim() : undefined)}
              />
            </View>
          }
        />
      ) : (
        // Alphabetical, each with the icon of its movement and its main muscles underneath.
        <Card flush>
          {visible.map((exercise, i) => {
            const muscles = data.muscles.get(exercise.id);
            return (
              <Fragment key={exercise.id}>
                {i > 0 ? <Divider inset={72} /> : null}
                <ListRow
                  onPress={() => choose(exercise)}
                  left={<ExerciseIcon muscles={muscles} />}
                  title={exercise.name}
                  subtitle={muscles?.primary.length ? muscles.primary.map(muscleLabel).join(', ') : 'Sin músculos'}
                />
              </Fragment>
            );
          })}
        </Card>
      )}
      {/* Archived: out of the catalog and the pickers, with their history; from here they come back. */}
      {routineId === null && !onlyIds && !archivedOnly && !wanted && data.archivedCount > 0 ? (
        <ListGroup>
          <ListRow
            left={<RowIcon name="archive-outline" />}
            title="Ejercicios archivados"
            right={String(data.archivedCount)}
            onPress={() => router.push({ pathname: '/ejercicios', params: { archivados: '1' } })}
          />
        </ListGroup>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyAction: { alignSelf: 'stretch', marginTop: spacing.sm },
});
