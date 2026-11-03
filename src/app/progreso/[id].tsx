import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LineChart } from '@/components/LineChart';
import {
  AppText,
  Card,
  EmptyState,
  ListGroup,
  ListRow,
  Loading,
  RowIcon,
  Screen,
  Section,
  Segmented,
  Stat,
  StatRow,
  Tag,
} from '@/components/ui';
import { getExercise } from '@/db/repositories/exercises';
import { exerciseSessions, exerciseWeightChanges, type ExerciseWeightChange } from '@/db/repositories/progress';
import { formatKg, formatNumber, formatSetGroups, formatShortDate, NBSP } from '@/domain/format';
import { capitalize, computeRecords, distinctRecords, formatDayMonth, summarize } from '@/domain/progress';
import { localDateString } from '@/domain/schedule';
import { useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

type ChartMetric = 'weight' | 'reps';

const METRICS: { value: ChartMetric; label: string }[] = [
  { value: 'weight', label: 'Peso' },
  { value: 'reps', label: 'Reps' },
];

// Remembered while the app is open: every exercise opens on the last chart looked at.
let lastMetric: ChartMetric = 'weight';

const formatReps = (reps: number) => `${formatNumber(reps, 0)}${NBSP}reps`;

/** Dividers of rows with an icon start at the text: 16 + the 40 dp RowIcon + 16. */
const ICON_ROW_INSET = spacing.lg + 40 + spacing.lg;

/** Progress of one exercise across all routines (PLAN.md §6.6). */
export default function ExerciseProgressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseId = Number(id);
  const [metric, setMetricState] = useState<ChartMetric>(lastMetric);

  const { data } = useLoader(async (db) => ({
    exercise: await getExercise(db, exerciseId),
    sessions: await exerciseSessions(db, exerciseId),
    changes: await exerciseWeightChanges(db, exerciseId),
  }));

  const setMetric = (next: ChartMetric) => {
    lastMetric = next;
    setMetricState(next);
  };

  if (!data) return <Loading />;
  if (!data.exercise) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="No se encontró el ejercicio" />
      </Screen>
    );
  }

  const { exercise, sessions, changes } = data;
  const bodyweight = exercise.type === 'bodyweight';
  const records = distinctRecords(computeRecords(sessions, exercise.pair));
  const chronological = [...sessions]
    .reverse()
    .map((s) => ({ label: formatShortDate(s.date), ...summarize(s.sets, exercise.pair) }));
  const hasWeight = chronological.some((s) => s.topWeightKg > 0);
  // Bodyweight work without ballast only has reps to show.
  const shown: ChartMetric = hasWeight ? metric : 'reps';

  return (
    <Screen>
      <Stack.Screen options={{ title: exercise.name }} />

      {sessions.length === 0 ? (
        <EmptyState
          icon="chart-line"
          title="Sin sesiones todavía"
          text="Aquí verás tu progreso cuando termines un entreno con este ejercicio."
        />
      ) : null}

      {chronological.length >= 2 ? (
        <Card>
          {hasWeight ? <Segmented options={METRICS} value={shown} onChange={setMetric} /> : null}
          {shown === 'weight' ? (
            <LineChart
              key="weight"
              title={exercise.pair ? 'Peso de cada mancuerna por sesión' : 'Peso de trabajo por sesión'}
              points={chronological.map((s) => ({ label: s.label, value: s.topWeightKg }))}
              format={formatKg}
            />
          ) : (
            <LineChart
              key="reps"
              title="Repeticiones por sesión"
              points={chronological.map((s) => ({ label: s.label, value: s.totalReps }))}
              format={formatReps}
            />
          )}
        </Card>
      ) : sessions.length === 1 ? (
        <AppText variant="caption">Con dos sesiones verás aquí tu evolución.</AppText>
      ) : null}

      {records.maxWeight || records.maxReps || records.maxVolume ? (
        <Section label="Récords">
          <StatRow>
            {records.maxWeight ? (
              <Stat
                label="Mejor peso"
                value={`${exercise.pair ? `2${NBSP}×${NBSP}` : ''}${formatNumber(records.maxWeight.kg)}`}
                unit="kg"
                caption={`× ${records.maxWeight.reps} · ${formatShortDate(records.maxWeight.date)}`}
              />
            ) : null}
            {records.maxReps ? (
              <Stat
                label="Más reps"
                value={String(records.maxReps.reps)}
                unit="reps"
                caption={
                  records.maxReps.kg > 0
                    ? `${formatKg(records.maxReps.kg)} · ${formatShortDate(records.maxReps.date)}`
                    : formatShortDate(records.maxReps.date)
                }
              />
            ) : null}
            {records.maxVolume ? (
              <Stat
                label="Mayor volumen"
                value={formatNumber(records.maxVolume.kg, 0)}
                unit="kg"
                caption={formatShortDate(records.maxVolume.date)}
              />
            ) : null}
          </StatRow>
        </Section>
      ) : null}

      {sessions.length > 0 ? (
        <Section label="Sesiones">
          <ListGroup>
            {sessions.map((s) => (
              <ListRow
                key={s.sessionId}
                title={formatSetGroups(s.sets, bodyweight, exercise.pair)}
                subtitle={[capitalize(formatDayMonth(s.date)), s.title ?? s.routineName].filter(Boolean).join(' · ')}
                right={
                  s.imported ? (
                    // The Tag aligns itself to the start; wrapped, it stays centred in the row.
                    <View>
                      <Tag label="Importado" />
                    </View>
                  ) : undefined
                }
                onPress={() => router.push(`/workout/resumen/${s.sessionId}`)}
              />
            ))}
          </ListGroup>
        </Section>
      ) : null}

      {changes.length > 0 ? (
        <Section label="Cambios de peso">
          <ListGroup inset={ICON_ROW_INSET}>
            {changes.map((c) => (
              <ChangeRow key={c.id} change={c} />
            ))}
          </ListGroup>
        </Section>
      ) : null}
    </Screen>
  );
}

/** A decided suggestion or a weight changed by hand, as a row of the log. */
function ChangeRow({ change }: { change: ExerciseWeightChange }) {
  const from = change.fromKg ?? 0;
  const to = change.toKg ?? 0;
  const up = to > from;
  const applied = change.status === 'applied';
  const how = !applied ? `Sugería ${formatKg(to)}` : change.source === 'manual' ? 'Cambio manual' : 'Sugerencia aplicada';
  const day = formatDayMonth(localDateString(new Date(change.decidedAt ?? change.createdAt)));
  return (
    <ListRow
      title={applied ? `De ${formatNumber(from)} a ${formatKg(to)}` : `Se mantuvo en ${formatKg(from)}`}
      subtitle={`${how} · ${day} · ${change.routineName}`}
      left={
        applied ? (
          <RowIcon name={up ? 'arrow-up-bold' : 'arrow-down-bold'} color={up ? colors.up : colors.down} />
        ) : (
          <RowIcon name="equal" color={colors.muted} />
        )
      }
    />
  );
}
