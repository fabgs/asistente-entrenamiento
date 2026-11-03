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
  type IconName,
} from '@/components/ui';
import { listCardio, type CardioActivity } from '@/db/repositories/cardio';
import { listRoutines, setRoutineOnWeekday, type Routine } from '@/db/repositories/routines';
import { describePlan, PLAN_KIND_LABEL, type CardioTracking } from '@/domain/cardioPlan';
import { ISO_WEEKDAYS, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { reschedule, useOnDataChanged, useSavedAtOnce } from '@/hooks/editing';
import { colors, spacing } from '@/theme';

const TRACKING_ICON: Record<CardioTracking, IconName> = {
  gps: 'walk',
  timer: 'timer-outline',
  check: 'check-circle-outline',
};

// cardio/actividad/[id] is new: until the dev server regenerates the typed routes, its links are cast.
const activityHref = (id: number | 'nueva', day?: IsoWeekday) =>
  (day ? `/cardio/actividad/${id}?dia=${day}` : `/cardio/actividad/${id}`) as Href;

/** "Caminar · 5 km" */
const activityTitle = (a: CardioActivity) => (a.target ? `${a.name} · ${a.target}` : a.name);

/** Intensity, or the timer plan, and the notes (as on Hoy). */
function activityDetails(a: CardioActivity): string | undefined {
  const plan =
    a.tracking === 'timer' && a.plan
      ? a.plan.kind === 'liss'
        ? PLAN_KIND_LABEL.liss
        : `${PLAN_KIND_LABEL[a.plan.kind]} · ${describePlan(a.plan)}`
      : a.intensity;
  return [plan, a.notes].filter(Boolean).join(' · ') || undefined;
}

/** The whole week's cardio or, with `?dia=N` (ISO weekday), that day: its routines and its cardio. */
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

  const activities = (weekday: IsoWeekday) => (
    <ListGroup inset={72}>
      {data.cardio
        .filter((a) => a.weekday === weekday)
        .map((a) => (
          <ListRow
            key={a.id}
            left={<RowIcon name={TRACKING_ICON[a.tracking]} />}
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
