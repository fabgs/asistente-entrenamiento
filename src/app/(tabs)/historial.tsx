import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { RouteRowThumbnail } from '@/components/RouteMap';
import {
  Button,
  Divider,
  EmptyState,
  ExerciseIcon,
  Figure,
  ListGroup,
  ListRow,
  Loading,
  ROW_ICON_INSET,
  RowIcon,
  SectionLabel,
  Segmented,
  SubtitleLines,
  cardioIcon,
} from '@/components/ui';
import {
  cardioEntries,
  exercisesWithHistory,
  workoutHistory,
  type CardioEntry,
  type ExerciseOverview,
} from '@/db/repositories/progress';
import { allExerciseMuscles } from '@/db/repositories/muscles';
import { routeCount } from '@/db/repositories/routes';
import type { SessionSummaryRow } from '@/db/repositories/sessions';
import { formatClock, formatDuration, formatKg, formatMetres, formatShortDate, formatSpeedKmh, formatTimeOfDay, workoutTitle } from '@/domain/format';
import { decodeRoute } from '@/domain/gps';
import type { ExerciseMuscles } from '@/domain/muscles';
import { capitalize, countOf, formatDayMonth, formatMonth, groupByMonth, splitUnit } from '@/domain/progress';
import { useLoader } from '@/hooks/data';
import { colors, radius, spacing } from '@/theme';

type HistoryView = 'entrenos' | 'ejercicios' | 'cardio';

const VIEWS: { value: HistoryView; label: string }[] = [
  { value: 'entrenos', label: 'Entrenos' },
  { value: 'ejercicios', label: 'Ejercicios' },
  { value: 'cardio', label: 'Cardio' },
];

// Remembered while the app is open: History opens on the last view used.
let lastView: HistoryView = 'entrenos';

type Item =
  | { kind: 'workout'; key: string; session: SessionSummaryRow }
  | { kind: 'exercise'; key: string; exercise: ExerciseOverview; muscles: ExerciseMuscles | undefined }
  | { kind: 'cardio'; key: string; entry: CardioEntry };

interface MonthSection {
  key: string;
  title: string;
  count: string;
  first: boolean;
  data: Item[];
}

interface HistoryData {
  workouts: SessionSummaryRow[];
  exercises: ExerciseOverview[];
  muscles: Map<number, ExerciseMuscles>;
  cardio: CardioEntry[];
  routes: number;
}

/** One section per month, newest first, with how many items it holds («12 entrenos»). */
function monthSections<T>(
  items: T[],
  dateOf: (item: T) => string,
  toItem: (item: T) => Item,
  noun: [string, string],
): MonthSection[] {
  return groupByMonth(items, dateOf).map((group, i) => ({
    key: group.month,
    title: formatMonth(group.month),
    count: countOf(group.items.length, ...noun),
    first: i === 0,
    data: group.items.map(toItem),
  }));
}

function sectionsFor(view: HistoryView, data: HistoryData): MonthSection[] {
  switch (view) {
    case 'entrenos':
      return monthSections(
        data.workouts,
        (s) => s.date,
        (s) => ({ kind: 'workout', key: `w${s.id}`, session: s }),
        ['entreno', 'entrenos'],
      );
    case 'ejercicios':
      // An exercise goes in the month it was last done.
      return monthSections(
        data.exercises,
        (e) => e.lastDate,
        (e) => ({ kind: 'exercise', key: `e${e.id}`, exercise: e, muscles: data.muscles.get(e.id) }),
        ['ejercicio', 'ejercicios'],
      );
    case 'cardio':
      return monthSections(data.cardio, (c) => c.date, (c) => ({ kind: 'cardio', key: c.key, entry: c }), ['sesión', 'sesiones']);
  }
}

const EMPTY: Record<HistoryView, { title: string; text: string }> = {
  entrenos: { title: 'Sin entrenos todavía', text: 'Aquí verás cada entreno que termines.' },
  ejercicios: { title: 'Sin ejercicios todavía', text: 'Aquí verás cómo progresas en cada ejercicio que entrenes.' },
  cardio: { title: 'Sin cardio todavía', text: 'Aquí verás tus caminatas y el cardio que marques en Hoy.' },
};

/** Entrenos · Ejercicios · Cardio, each as rows grouped by month (PLAN.md §6.6). */
export default function HistoryScreen() {
  const [view, setViewState] = useState<HistoryView>(lastView);
  const { data } = useLoader(
    async (db): Promise<HistoryData> => ({
      workouts: await workoutHistory(db),
      exercises: await exercisesWithHistory(db),
      muscles: await allExerciseMuscles(db),
      cardio: await cardioEntries(db),
      routes: await routeCount(db),
    }),
  );

  const setView = (next: HistoryView) => {
    lastView = next;
    setViewState(next);
  };

  if (!data) return <Loading />;
  const sections = sectionsFor(view, data);

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Segmented options={VIEWS} value={view} onChange={setView} />
      </View>
      <SectionList
        key={view}
        sections={sections}
        keyExtractor={(item) => item.key}
        renderSectionHeader={({ section }) => (
          <View style={[styles.monthHeader, section.first && { paddingTop: 0 }]}>
            <SectionLabel right={section.count}>{section.title}</SectionLabel>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View style={[styles.groupRow, index === 0 && styles.groupTop, index === section.data.length - 1 && styles.groupBottom]}>
            <HistoryRow item={item} />
          </View>
        )}
        ItemSeparatorComponent={RowSeparator}
        ListHeaderComponent={
          // Mis rutas lives with the walks, from the first one (PLAN.md §6.8).
          view === 'cardio' && data.cardio.some((c) => c.kind === 'gps') ? <RoutesRow count={data.routes} /> : undefined
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <View style={{ flex: 1 }} />
            <EmptyState
              icon="history"
              title={EMPTY[view].title}
              text={EMPTY[view].text}
              action={<Button kind="secondary" title="Ir a Hoy" onPress={() => router.navigate('/')} />}
            />
            <View style={{ flex: 2 }} />
          </View>
        }
        stickySectionHeadersEnabled={false}
        initialNumToRender={12}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

function HistoryRow({ item }: { item: Item }) {
  switch (item.kind) {
    case 'workout':
      return <WorkoutRow session={item.session} />;
    case 'exercise':
      return <ExerciseRow exercise={item.exercise} muscles={item.muscles} />;
    case 'cardio':
      return <CardioRow entry={item.entry} />;
  }
}

const dayOf = (iso: string) => capitalize(formatDayMonth(iso));

function WorkoutRow({ session }: { session: SessionSummaryRow }) {
  const facts = [
    dayOf(session.date),
    countOf(session.setCount, 'serie', 'series'),
    session.finishedAt !== null && !session.imported ? formatDuration(session.finishedAt - session.startedAt) : null,
    // In the subtitle, not as a tag on the right: there it left the long routine names unreadable.
    session.imported ? 'Importado' : null,
    session.routineId === null ? 'Suelto' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // A title of your own keeps the routine underneath, so you still know which one it was. Not for
  // an imported one: its routine is just where the old notes are kept («Importado» says enough).
  const routine =
    !session.imported && session.title && session.routineName && session.title !== session.routineName ? session.routineName : null;
  // One line: routine names are long, and two-line rows would leave only five entrenos on screen.
  return (
    <ListRow
      title={workoutTitle(session)}
      titleLines={1}
      subtitle={routine ? <SubtitleLines lines={[facts, routine]} /> : facts}
      left={<RowIcon name="dumbbell" />}
      onPress={() => router.push(`/workout/resumen/${session.id}`)}
    />
  );
}

function ExerciseRow({ exercise, muscles }: { exercise: ExerciseOverview; muscles: ExerciseMuscles | undefined }) {
  return (
    <ListRow
      left={<ExerciseIcon muscles={muscles} />}
      title={exercise.name}
      subtitle={`${countOf(exercise.sessions, 'sesión', 'sesiones')} · ${formatShortDate(exercise.lastDate)}`}
      right={exercise.topWeightKg ? <TextFigure text={formatKg(exercise.topWeightKg)} caption="máx." /> : undefined}
      onPress={() => router.push(`/progreso/${exercise.id}`)}
    />
  );
}

/** The way into Mis rutas, over the months of the cardio. */
function RoutesRow({ count }: { count: number }) {
  return (
    <View style={styles.routes}>
      <ListGroup inset={ROW_ICON_INSET}>
        <ListRow
          title="Mis rutas"
          subtitle={count === 0 ? 'Ninguna todavía' : undefined}
          left={<RowIcon name="map-marker-path" />}
          right={count > 0 ? String(count) : undefined}
          onPress={() => router.push('/mis-rutas')}
        />
      </ListGroup>
    </View>
  );
}

function CardioRow({ entry }: { entry: CardioEntry }) {
  // Decoded once per row, not on every render: a long walk is thousands of points.
  const segments = useMemo(() => decodeRoute(entry.route), [entry.route]);
  const thumbnail = segments.flat().length >= 2 ? segments : null;

  const day = dayOf(entry.date);
  if (entry.kind === 'check' || entry.sessionId === null) {
    return (
      <ListRow
        title={entry.name}
        subtitle={`${day} · ${entry.value ?? 'Hecho'}`}
        left={<RowIcon name={cardioIcon(entry.activity, 'check')} color={colors.muted} />}
      />
    );
  }
  const sessionId = entry.sessionId;
  const active = entry.activeMs ?? 0;
  return (
    <ListRow
      title={entry.name}
      subtitle={entry.startedAt !== null ? `${day} · ${formatTimeOfDay(entry.startedAt)}` : day}
      left={
        thumbnail ? (
          <RouteRowThumbnail segments={thumbnail} />
        ) : (
          <RowIcon name={cardioIcon(entry.activity, entry.kind)} />
        )
      }
      right={
        entry.sprint ? (
          entry.sprint.topSpeedMs !== null ? (
            <TextFigure text={formatSpeedKmh(entry.sprint.topSpeedMs)} caption={countOf(entry.sprint.count, 'sprint', 'sprints')} />
          ) : (
            countOf(entry.sprint.count, 'sprint', 'sprints')
          )
        ) : entry.distanceM !== null ? (
          <TextFigure text={formatMetres(entry.distanceM)} caption={formatClock(active)} />
        ) : (
          formatDuration(active)
        )
      }
      onPress={() => router.push(`/cardio-sesion/${sessionId}`)}
    />
  );
}

/** A figure on the right of a row, with its unit smaller and a caption under it. */
/** A figure written as text («5,2 km»), split into value and unit for `Figure`. */
const TextFigure = ({ text, caption }: { text: string; caption: string }) => <Figure {...splitUnit(text)} caption={caption} />;

/** Hairline between rows, starting where the text of the row above starts. */
function RowSeparator({ leadingItem }: { leadingItem?: Item }) {
  return (
    <View style={styles.separatorBox}>
      <Divider inset={spacing.lg + leadingWidth(leadingItem)} />
    </View>
  );
}

/** RowIcon is a 40 dp circle; route thumbnails take the same width. */
const ROW_ICON_SIZE = 40;

const leadingWidth = (item: Item | undefined) => (!item || item.kind === 'exercise' ? 0 : ROW_ICON_SIZE + spacing.lg);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  monthHeader: { paddingTop: spacing.xl, paddingBottom: spacing.sm },
  groupRow: { backgroundColor: colors.card, overflow: 'hidden' },
  groupTop: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  groupBottom: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  separatorBox: { backgroundColor: colors.card },
  routes: { paddingBottom: spacing.xl },
  emptyBox: { flex: 1 },
});
