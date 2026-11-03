import { router, useNavigation } from 'expo-router';
import { Fragment, useCallback, useLayoutEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { showPrompt } from '@/components/Dialog';
import { RoutineCard } from '@/components/RoutineCard';
import {
  AppText,
  Button,
  Card,
  Divider,
  EmptyState,
  IconButton,
  ListGroup,
  ListRow,
  Loading,
  Screen,
} from '@/components/ui';
import { listCardio, type CardioActivity } from '@/db/repositories/cardio';
import { listExercises } from '@/db/repositories/exercises';
import { createRoutine, listRoutines, listSlots, type Slot } from '@/db/repositories/routines';
import { listOpenChanges } from '@/db/repositories/weightChanges';
import { ISO_WEEKDAYS, WEEKDAY_NAMES } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { queueWrite, reschedule } from '@/hooks/editing';
import { colors, spacing } from '@/theme';

const cardioLabel = (c: CardioActivity) => (c.target ? `${c.name} ${c.target}` : c.name);

export default function RoutinesScreen() {
  const db = useDb();
  const navigation = useNavigation();
  const { data, reload } = useLoader(async (db) => {
    const routines = await listRoutines(db);
    const slots = new Map<number, Slot[]>();
    for (const r of routines) slots.set(r.id, await listSlots(db, r.id));
    return {
      routines,
      slots,
      cardio: await listCardio(db),
      openChanges: await listOpenChanges(db),
      exerciseCount: (await listExercises(db)).length,
    };
  });

  // Nothing is created until the name is confirmed (D29).
  const newRoutine = useCallback(async () => {
    const name = await showPrompt('Nueva rutina', { value: '', placeholder: 'Día 5: Full body', confirm: 'Crear' });
    if (name === null) return;
    const id = await queueWrite(() => createRoutine(db, name.trim() || 'Nueva rutina'));
    reschedule(db);
    router.push(`/rutina/${id}`);
  }, [db]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerAction}>
          <IconButton icon="plus" label="Nueva rutina" onPress={newRoutine} />
        </View>
      ),
    });
  }, [navigation, newRoutine]);

  if (!data) return <Loading />;

  return (
    <Screen>
      <Card flush>
        <View style={styles.weekHead}>
          <AppText variant="heading" style={styles.flex}>
            Semana
          </AppText>
          <Button kind="text" title="Editar cardio" onPress={() => router.push('/cardio')} />
        </View>
        {ISO_WEEKDAYS.map((day, i) => {
          const strength = data.routines.filter((r) => r.weekdays.includes(day)).map((r) => r.name);
          const cardio = data.cardio
            .filter((c) => c.weekday === day)
            .map(cardioLabel)
            .join(' · ');
          return (
            <Fragment key={day}>
              {i > 0 ? <Divider inset={72} /> : null}
              <ListRow
                onPress={() => router.push({ pathname: '/cardio', params: { dia: String(day) } })}
                left={
                  <View style={styles.day}>
                    <AppText variant="control" style={styles.muted}>
                      {WEEKDAY_NAMES[day].slice(0, 3)}
                    </AppText>
                  </View>
                }
                title={
                  strength.length > 0 || cardio ? (
                    strength.join(' + ') || cardio
                  ) : (
                    <AppText variant="rowTitle" style={styles.muted}>
                      Descanso
                    </AppText>
                  )
                }
                subtitle={strength.length > 0 && cardio ? cardio : undefined}
                titleLines={1}
              />
            </Fragment>
          );
        })}
      </Card>

      {data.routines.length === 0 ? (
        <EmptyState
          icon="dumbbell"
          title="Sin rutinas todavía"
          text="Crea tu primera rutina y añádele ejercicios del catálogo."
          action={
            <View style={styles.emptyAction}>
              <Button kind="secondary" icon="plus" title="Nueva rutina" onPress={newRoutine} />
            </View>
          }
        />
      ) : (
        <View style={styles.cards}>
          {data.routines.map((routine) => (
            <RoutineCard
              key={routine.id}
              mode="routines"
              routine={routine}
              slots={data.slots.get(routine.id) ?? []}
              openChanges={data.openChanges}
              onChanged={reload}
              onEdit={() => router.push(`/rutina/${routine.id}`)}
              onOpenSlot={(slot) => router.push(`/slot/${slot.id}`)}
            />
          ))}
        </View>
      )}

      <ListGroup>
        <ListRow title="Catálogo de ejercicios" right={String(data.exerciseCount)} onPress={() => router.push('/ejercicios')} />
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The tab header has no inset of its own: 4 + the 12 inside the button = the 16 dp margin.
  headerAction: { marginRight: spacing.xs },
  flex: { flex: 1 },
  weekHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  day: { width: 40 },
  muted: { color: colors.muted },
  cards: { gap: spacing.sm },
  emptyAction: { alignSelf: 'stretch', marginTop: spacing.sm },
});
