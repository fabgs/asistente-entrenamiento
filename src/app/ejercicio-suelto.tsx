import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Fragment, useState } from 'react';
import { showDialog } from '@/components/Dialog';
import { SearchField } from '@/components/SearchField';
import { Card, Divider, EmptyState, ExerciseIcon, ListRow, Loading, Screen, useBusy } from '@/components/ui';
import { listExercises, type Exercise } from '@/db/repositories/exercises';
import { allExerciseMuscles } from '@/db/repositories/muscles';
import { listSlotsByIds, looseSlotFor } from '@/db/repositories/routines';
import { addLooseExercise, getActiveSession, getSession, listSets, openNextSet, startLooseSession } from '@/db/repositories/sessions';
import { normalizeForSearch } from '@/domain/format';
import { matchesExercise, muscleLabel } from '@/domain/muscles';
import { looseSlotIds } from '@/domain/workoutMachine';
import { useDb, useLoader } from '@/hooks/data';

/** Alphabetical without minding accents, as in the catalog. */
const byName = (a: Exercise, b: Exercise) => {
  const [x, y] = [normalizeForSearch(a.name), normalizeForSearch(b.name)];
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Picks any exercise of the catalog to do on its own (PLAN.md §6.4, «Ejercicio suelto»). One in a
 * routine keeps that routine's weight and prescription; one in none gets its own slot (looseSlotFor).
 * With `sesion`, it adds another one to that loose workout.
 */
export default function LooseExerciseScreen() {
  const { sesion } = useLocalSearchParams<{ sesion?: string }>();
  const sessionId = sesion ? Number(sesion) : null;
  const db = useDb();
  const [query, setQuery] = useState('');
  const [, run] = useBusy();

  const { data } = useLoader(async (db) => {
    let taken: number[] = [];
    if (sessionId !== null) {
      const session = await getSession(db, sessionId);
      if (session) {
        const slots = await listSlotsByIds(db, looseSlotIds(await listSets(db, sessionId), session.currentSlotId));
        taken = slots.map((s) => s.exerciseId);
      }
    }
    return { exercises: await listExercises(db), taken: new Set(taken), muscles: await allExerciseMuscles(db) };
  });

  const title = sessionId === null ? 'Ejercicio suelto' : 'Añadir otro ejercicio';
  if (!data) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <Loading />
      </>
    );
  }

  const wanted = query.trim();
  const visible = data.exercises
    .filter((e) => !data.taken.has(e.id) && matchesExercise(wanted, e.name, data.muscles.get(e.id)))
    .sort(byName);

  const pick = (exercise: Exercise) =>
    run(async () => {
      const slotId = await looseSlotFor(db, exercise);
      if (sessionId !== null) {
        await addLooseExercise(db, sessionId, slotId);
        router.back();
        return;
      }
      const id = await startLooseSession(db, slotId, new Date());
      if (id !== null) {
        router.replace(`/workout/${id}`);
        return;
      }
      const active = await getActiveSession(db);
      if (!active) return;
      showDialog('Hay un entreno en curso', 'Termínalo antes de empezar otro.', [
        {
          text: 'Ver entreno',
          onPress: async () => {
            await openNextSet(db, active.id);
            router.replace(`/workout/${active.id}`);
          },
        },
        { text: 'Cancelar', style: 'cancel' },
      ]);
    })();

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <SearchField value={query} onChangeText={setQuery} />
      {visible.length === 0 ? (
        wanted ? (
          <EmptyState icon="magnify" title="Ningún ejercicio coincide" />
        ) : (
          <EmptyState icon="dumbbell" title="No quedan ejercicios" text="Todos los del catálogo ya están en este entreno." />
        )
      ) : (
        <Card flush>
          {visible.map((exercise, i) => {
            const muscles = data.muscles.get(exercise.id);
            return (
              <Fragment key={exercise.id}>
                {i > 0 ? <Divider inset={72} /> : null}
                <ListRow
                  onPress={() => pick(exercise)}
                  left={<ExerciseIcon muscles={muscles} />}
                  title={exercise.name}
                  subtitle={muscles?.primary.length ? muscles.primary.map(muscleLabel).join(', ') : 'Sin músculos'}
                />
              </Fragment>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}
