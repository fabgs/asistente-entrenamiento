import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { showDialog } from '@/components/Dialog';
import { SearchField } from '@/components/SearchField';
import { AppText, EmptyState, ListGroup, ListRow, Loading, Screen, Section, useBusy } from '@/components/ui';
import { allExerciseMuscles } from '@/db/repositories/muscles';
import { isBodyweight, listRoutines, listSlots, type Routine, type Slot } from '@/db/repositories/routines';
import { addLooseExercise, getActiveSession, getSession, listSets, openNextSet, startLooseSession } from '@/db/repositories/sessions';
import { formatLoad, formatTarget } from '@/domain/format';
import { matchesExercise } from '@/domain/muscles';
import { looseSlotIds } from '@/domain/workoutMachine';
import { useDb, useLoader } from '@/hooks/data';

/**
 * Picks an exercise of any routine to do on its own (PLAN.md §6.4, «Ejercicio suelto»), with its
 * weight and prescription. With `sesion`, it adds another one to that loose workout.
 */
export default function LooseExerciseScreen() {
  const { sesion } = useLocalSearchParams<{ sesion?: string }>();
  const sessionId = sesion ? Number(sesion) : null;
  const db = useDb();
  const [query, setQuery] = useState('');
  const [, run] = useBusy();

  const { data } = useLoader(async (db) => {
    const routines = await listRoutines(db);
    const slots = new Map<number, Slot[]>();
    for (const r of routines) slots.set(r.id, await listSlots(db, r.id));
    let taken: number[] = [];
    if (sessionId !== null) {
      const session = await getSession(db, sessionId);
      if (session) taken = looseSlotIds(await listSets(db, sessionId), session.currentSlotId);
    }
    return { routines, slots, taken: new Set(taken), muscles: await allExerciseMuscles(db) };
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
  const sections: { routine: Routine; slots: Slot[] }[] = data.routines
    .map((routine) => ({
      routine,
      slots: (data.slots.get(routine.id) ?? []).filter(
        (s) => !data.taken.has(s.id) && matchesExercise(wanted, s.exerciseName, data.muscles.get(s.exerciseId)),
      ),
    }))
    .filter((s) => s.slots.length > 0);

  const pick = (slot: Slot) =>
    run(async () => {
      if (sessionId !== null) {
        await addLooseExercise(db, sessionId, slot.id);
        router.back();
        return;
      }
      const id = await startLooseSession(db, slot.id, new Date());
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

  const nothing =
    sessionId === null
      ? { title: 'Sin ejercicios todavía', text: 'Añade ejercicios a tus rutinas para poder hacer uno suelto.' }
      : { title: 'No quedan ejercicios', text: 'Todos los ejercicios de tus rutinas ya están en este entreno.' };

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <SearchField value={query} onChangeText={setQuery} />
      {sections.length === 0 ? (
        wanted ? (
          <EmptyState icon="magnify" title="Ningún ejercicio coincide" />
        ) : (
          <EmptyState icon="dumbbell" title={nothing.title} text={nothing.text} />
        )
      ) : (
        sections.map(({ routine, slots }) => (
          <Section key={routine.id} label={routine.name}>
            <ListGroup>
              {slots.map((slot) => (
                <ListRow
                  key={slot.id}
                  title={slot.exerciseName}
                  subtitle={`${slot.sets} × ${formatTarget(slot.target, slot.unit, slot.perSide)}`}
                  right={
                    <AppText variant="rowValue" tabular>
                      {formatLoad(slot.weightKg, isBodyweight(slot), slot.exercisePair)}
                    </AppText>
                  }
                  onPress={() => pick(slot)}
                />
              ))}
            </ListGroup>
          </Section>
        ))
      )}
    </Screen>
  );
}
