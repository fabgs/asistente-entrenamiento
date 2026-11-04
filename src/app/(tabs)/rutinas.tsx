import { router, useNavigation } from 'expo-router';
import { Fragment, useCallback, useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { showPrompt } from '@/components/Dialog';
import { RoutineCard } from '@/components/RoutineCard';
import {
  AppText,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  Loading,
  Screen,
  type IconName,
} from '@/components/ui';
import { listCardio, type CardioActivity } from '@/db/repositories/cardio';
import { listExercises } from '@/db/repositories/exercises';
import { allExerciseMuscles } from '@/db/repositories/muscles';
import { createRoutine, listRoutines, listSlots, type Routine, type Slot } from '@/db/repositories/routines';
import { listOpenChanges } from '@/db/repositories/weightChanges';
import { ISO_WEEKDAYS, isoWeekdayOf, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { queueWrite, reschedule } from '@/hooks/editing';
import { colors, radius, spacing } from '@/theme';

const cardioLabel = (c: CardioActivity) => (c.target ? `${c.name} ${c.target}` : c.name);

/** «X» for miércoles, as Spanish calendars write it. */
const DAY_LETTER: Record<IsoWeekday, string> = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' };

// Folded at first and remembered while the app is open, like the routine cards.
let weekUnfolded = false;

const openDay = (day: IsoWeekday) => router.push({ pathname: '/cardio', params: { dia: String(day) } });

interface DayPlan {
  day: IsoWeekday;
  strength: string[];
  cardio: string;
}

export default function RoutinesScreen() {
  const db = useDb();
  const navigation = useNavigation();
  const { data, reload } = useLoader(async (db) => {
    const routines = await listRoutines(db);
    const slots = new Map<number, Slot[]>();
    for (const r of routines) slots.set(r.id, await listSlots(db, r.id));
    return {
      today: isoWeekdayOf(new Date()),
      routines,
      slots,
      cardio: await listCardio(db),
      openChanges: await listOpenChanges(db),
      muscles: await allExerciseMuscles(db),
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
      <WeekCard today={data.today} days={weekPlan(data.routines, data.cardio)} />

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
              muscles={data.muscles}
              onChanged={reload}
              onEdit={() => router.push(`/rutina/${routine.id}`)}
              onOpenSlot={(slot) => router.push(`/slot/${slot.id}`)}
            />
          ))}
        </View>
      )}

      <ListGroup>
        <ListRow title="Series por músculo" onPress={() => router.push('/musculos')} />
        <ListRow title="Catálogo de ejercicios" right={String(data.exerciseCount)} onPress={() => router.push('/ejercicios')} />
      </ListGroup>
    </Screen>
  );
}

function weekPlan(routines: Routine[], cardio: CardioActivity[]): DayPlan[] {
  return ISO_WEEKDAYS.map((day) => ({
    day,
    strength: routines.filter((r) => r.weekdays.includes(day)).map((r) => r.name),
    cardio: cardio
      .filter((c) => c.weekday === day)
      .map(cardioLabel)
      .join(' · '),
  }));
}

/**
 * The week: folded, a strip with a letter and an icon per day (today stands out); unfolded, a row
 * per day with what it has. Either way, tapping a day opens its editor.
 */
function WeekCard({ today, days }: { today: IsoWeekday; days: DayPlan[] }) {
  const [expanded, setExpanded] = useState(weekUnfolded);
  const toggle = () => {
    weekUnfolded = !expanded;
    setExpanded(!expanded);
  };
  return (
    <Card flush>
      <View style={styles.weekHead}>
        <Pressable
          onPress={toggle}
          style={styles.weekToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityHint="Muestra u oculta lo que toca cada día">
          <AppText variant="heading">Semana</AppText>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={24} color={colors.muted} />
        </Pressable>
        <Button kind="text" title="Editar cardio" onPress={() => router.push('/cardio')} />
      </View>
      {expanded ? (
        days.map(({ day, strength, cardio }, i) => (
          <Fragment key={day}>
            {i > 0 ? <Divider inset={72} /> : null}
            <ListRow
              onPress={() => openDay(day)}
              left={
                <View style={styles.day}>
                  <AppText variant="control" style={day === today ? styles.today : styles.muted}>
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
        ))
      ) : (
        <View style={styles.strip}>
          {days.map((plan) => (
            <DayCell key={plan.day} plan={plan} today={plan.day === today} />
          ))}
        </View>
      )}
    </Card>
  );
}

/** One day of the folded week: strength, cardio only or rest. */
function DayCell({ plan, today }: { plan: DayPlan; today: boolean }) {
  const { day, strength, cardio } = plan;
  const busy = strength.length > 0 || !!cardio;
  const icon: IconName = strength.length > 0 ? 'dumbbell' : cardio ? 'run' : 'sofa-outline';
  const what = [strength.join(' + '), cardio].filter(Boolean).join(' · ') || 'Descanso';
  return (
    <Pressable
      onPress={() => openDay(day)}
      android_ripple={{ color: colors.pressed }}
      style={[styles.cell, today && styles.cellToday]}
      accessibilityRole="button"
      accessibilityLabel={`${WEEKDAY_NAMES[day]}${today ? ', hoy' : ''}: ${what}`}
      accessibilityHint="Abre el editor del día">
      <AppText variant="label" weight={today ? '600' : '500'} style={today ? styles.today : undefined}>
        {DAY_LETTER[day]}
      </AppText>
      <Icon name={icon} size={22} color={busy ? colors.text : colors.disabledText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The tab header has no inset of its own: 4 + the 12 inside the button = the 16 dp margin.
  headerAction: { marginRight: spacing.xs },
  flex: { flex: 1 },
  weekHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  weekToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48 },
  day: { width: 40 },
  muted: { color: colors.muted },
  today: { color: colors.primary },
  strip: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  cell: { flex: 1, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, borderRadius: radius.md, overflow: 'hidden' },
  cellToday: { backgroundColor: colors.primaryTint },
  cards: { gap: spacing.sm },
  emptyAction: { alignSelf: 'stretch', marginTop: spacing.sm },
});
