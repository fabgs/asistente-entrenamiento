import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  AddRow,
  AppText,
  CheckMark,
  ListGroup,
  ListRow,
  Loading,
  RowIcon,
  Screen,
  Section,
  cardioIcon,
} from '@/components/ui';
import { listCardio, type CardioActivity } from '@/db/repositories/cardio';
import { listRoutines, setRoutineOnWeekday, type Routine } from '@/db/repositories/routines';
import { trackingDetails } from '@/domain/cardioPlan';
import { ISO_WEEKDAYS, NO_DAY_PARAM, WEEKDAY_NAMES, weekdaysLabel } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { reschedule, useOnDataChanged, useSavedAtOnce } from '@/hooks/editing';
import { colors, spacing } from '@/theme';

// cardio/actividad/[id] is new: until the dev server regenerates the typed routes, its links are cast.
const activityHref = (id: number | 'nueva', day?: IsoWeekday | null) =>
  (day !== undefined ? `/cardio/actividad/${id}?dia=${day ?? NO_DAY_PARAM}` : `/cardio/actividad/${id}`) as Href;

/** "Caminar · 5 km" */
const activityTitle = (a: CardioActivity) => (a.target ? `${a.name} · ${a.target}` : a.name);

/** Intensity, or the plan of the timer or the sprints, and the notes (as on Hoy). */
const activityDetails = (a: CardioActivity) => [trackingDetails(a), a.notes].filter(Boolean).join(' · ') || undefined;

/**
 * The whole week's cardio (each day's and, at the end, the activities «sin día», 1.5.0) or, with
 * `?dia=N` (ISO weekday), that day: its routines and its cardio.
 */
export default function CardioScreen() {
  const { dia } = useLocalSearchParams<{ dia?: string }>();
  const day = ISO_WEEKDAYS.find((d) => String(d) === dia);
  const { data, reload } = useLoader(async (db) => ({ cardio: await listCardio(db), routines: await listRoutines(db) }));
  // «Deshacer» after removing an activity brings it back while this list is on view.
  useOnDataChanged(reload);
  const header = day ? <Stack.Screen options={{ title: WEEKDAY_NAMES[day] }} /> : null;

  if (!data) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }

  // `weekday` null: those of no day, to do when one feels like it (from «Hacer otro cardio»).
  const activities = (weekday: IsoWeekday | null) => (
    <ListGroup inset={72}>
      {data.cardio
        .filter((a) => a.weekday === weekday)
        .map((a) => (
          <ListRow
            key={a.id}
            left={<RowIcon name={cardioIcon(a.name, a.tracking)} />}
            title={activityTitle(a)}
            subtitle={activityDetails(a)}
            onPress={() => router.push(activityHref(a.id))}
          />
        ))}
      <AddRow title="Añadir actividad" onPress={() => router.push(activityHref('nueva', weekday))} />
    </ListGroup>
  );

  if (!day) {
    return (
      <Screen>
        {ISO_WEEKDAYS.map((weekday) => (
          <Section key={weekday} label={WEEKDAY_NAMES[weekday]}>
            {activities(weekday)}
          </Section>
        ))}
        <Section label={weekdaysLabel([])}>
          {activities(null)}
          {data.cardio.some((a) => a.weekday === null) ? null : (
            <AppText variant="caption">Para cuando apetezca. Salen en Hoy, en «Hacer otro cardio».</AppText>
          )}
        </Section>
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      {data.routines.length > 0 ? (
        <Section label="Rutinas">
          <ListGroup inset={72}>
            {data.routines.map((routine) => (
              <RoutineOnDay key={routine.id} routine={routine} day={day} onSaved={reload} />
            ))}
          </ListGroup>
        </Section>
      ) : null}
      <Section label="Cardio">{activities(day)}</Section>
    </Screen>
  );
}

/** A routine of the day editor: the whole row ticks it on or off, and it saves at once. */
function RoutineOnDay({ routine, day, onSaved }: { routine: Routine; day: IsoWeekday; onSaved: () => Promise<void> }) {
  const db = useDb();
  const [on, setOn] = useSavedAtOnce(routine.weekdays.includes(day), async (next) => {
    await setRoutineOnWeekday(db, routine.id, day, next);
    reschedule(db);
    await onSaved();
  });
  return (
    <Pressable
      onPress={() => setOn(!on)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      android_ripple={{ color: colors.pressed }}
      style={styles.row}>
      <View style={styles.check}>
        <CheckMark done={on} />
      </View>
      <AppText variant="rowTitle" numberOfLines={2} style={styles.flex}>
        {routine.name}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Same measures as a ListRow, which cannot say it is a checkbox.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  check: { width: 40, alignItems: 'center' },
});
