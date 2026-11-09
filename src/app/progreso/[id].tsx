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
  MuscleTags,
  RowIcon,
  Screen,
  Section,
  Segmented,
  Stat,
  StatRow,
  Tag,
} from '@/components/ui';
import { getExercise } from '@/db/repositories/exercises';
import { getExerciseMuscles } from '@/db/repositories/muscles';
import { exerciseRest, exerciseSessions, exerciseUnit, exerciseWeightChanges, type ExerciseWeightChange } from '@/db/repositories/progress';
import { formatKg, formatNumber, formatSetGroups, formatSetValues, formatShortDate, NBSP } from '@/domain/format';
import { capitalize, computeRecords, distinctRecords, formatDayMonth, oneRepMaxRecord, sessionOneRepMax, summarize } from '@/domain/progress';
import { localDateString } from '@/domain/schedule';
import { formatRest } from '@/domain/workoutTimes';
import { useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

type ChartMetric = 'weight' | 'reps' | 'oneRepMax';

const METRICS: { value: ChartMetric; label: string }[] = [
  { value: 'weight', label: 'Peso' },
  { value: 'reps', label: 'Reps' },
  { value: 'oneRepMax', label: '1RM' },
];

// Remembered while the app is open: every exercise opens on the last chart looked at.
let lastMetric: ChartMetric = 'weight';

const formatReps = (reps: number) => `${formatNumber(reps, 0)}${NBSP}reps`;
const formatMinutesValue = (minutes: number) => `${formatNumber(minutes, 1)}${NBSP}min`;

/** Dividers of rows with an icon start at the text: 16 + the 40 dp RowIcon + 16. */
const ICON_ROW_INSET = spacing.lg + 40 + spacing.lg;

/** Progress of one exercise across all routines (PLAN.md §6.6). */
export default function ExerciseProgressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseId = Number(id);
  const [metric, setMetricState] = useState<ChartMetric>(lastMetric);

  const { data } = useLoader(async (db) => ({
    exercise: await getExercise(db, exerciseId),
    muscles: await getExerciseMuscles(db, exerciseId),
    sessions: await exerciseSessions(db, exerciseId),
    changes: await exerciseWeightChanges(db, exerciseId),
    unit: await exerciseUnit(db, exerciseId),
    rest: await exerciseRest(db, exerciseId),
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

  const { exercise, muscles, sessions, changes, unit, rest } = data;
  // A hold counts seconds and a walk with weight steps: «Tiempo» and «7 min», not «420 reps».
  const amountLabel = unit === 'seconds' ? 'Tiempo' : unit === 'steps' ? 'Pasos' : 'Reps';
  const formatAmount = unit === 'reps' ? formatReps : (value: number) => formatSetValues([value], unit);
  const bodyweight = exercise.type === 'bodyweight';
  const records = distinctRecords(computeRecords(sessions, exercise.pair));
  const chronological = [...sessions]
    .reverse()
    .map((s) => ({ label: formatShortDate(s.date), ...summarize(s.sets, exercise.pair), oneRepMax: sessionOneRepMax(s.sets)?.kg ?? null }));
  const hasWeight = chronological.some((s) => s.topWeightKg > 0);
  // Only with a load: the ballast of a bodyweight exercise is not what one lifts.
  const oneRepMaxes = bodyweight ? [] : chronological.flatMap((s) => (s.oneRepMax === null ? [] : [{ label: s.label, value: s.oneRepMax }]));
  const oneRepMax = bodyweight ? null : oneRepMaxRecord(sessions);
  const metrics = oneRepMaxes.length >= 2 ? METRICS : METRICS.filter((m) => m.value !== 'oneRepMax');
  // Minutes of practice plot in minutes, so the axis reads 0, 10, 20 instead of 16:40 and 33:20.
  const inMinutes = unit === 'seconds' && chronological.some((c) => c.totalReps >= 120);
  const metricOptions = metrics.map((m) => (m.value === 'reps' ? { ...m, label: amountLabel } : m));
  const pairPrefix = exercise.pair ? `2${NBSP}×${NBSP}` : '';
  // Bodyweight work without ballast only has reps to show.
  const shown: ChartMetric = !hasWeight ? 'reps' : metrics.some((m) => m.value === metric) ? metric : 'weight';

  return (
    <Screen>
      <Stack.Screen options={{ title: exercise.name }} />
      <MuscleTags muscles={muscles} />

      {sessions.length === 0 ? (
        <EmptyState
          icon="chart-line"
          title="Sin sesiones todavía"
          text="Aquí verás tu progreso cuando termines un entreno con este ejercicio."
        />
      ) : null}

      {chronological.length >= 2 ? (
        <Card>
          {hasWeight ? <Segmented options={metricOptions} value={shown} onChange={setMetric} /> : null}
          {shown === 'oneRepMax' ? (
            <LineChart
              key="oneRepMax"
              title={exercise.pair ? '1RM estimado de cada mancuerna' : '1RM estimado por sesión'}
              points={oneRepMaxes}
              format={formatKg}
            />
          ) : shown === 'weight' ? (
            <LineChart
              key="weight"
              title={exercise.pair ? 'Peso de cada mancuerna por sesión' : 'Peso de trabajo por sesión'}
              points={chronological.map((s) => ({ label: s.label, value: s.topWeightKg }))}
              format={formatKg}
            />
          ) : (
            <LineChart
              key="reps"
              title={unit === 'seconds' ? 'Tiempo por sesión' : unit === 'steps' ? 'Pasos por sesión' : 'Repeticiones por sesión'}
              points={chronological.map((s) => ({ label: s.label, value: inMinutes ? s.totalReps / 60 : s.totalReps }))}
              format={inMinutes ? formatMinutesValue : formatAmount}
            />
          )}
        </Card>
      ) : sessions.length === 1 ? (
        <AppText variant="caption">Con dos sesiones verás aquí tu evolución.</AppText>
      ) : null}

      {records.maxWeight || records.maxReps || records.maxVolume ? (
        <Section label="Récords">
          {oneRepMax ? (
            <StatRow>
              <Stat
                label="1RM estimado"
                value={`${pairPrefix}${formatNumber(oneRepMax.kg)}`}
                unit="kg"
                caption={`De ${formatKg(oneRepMax.fromKg)} × ${oneRepMax.reps} · ${formatShortDate(oneRepMax.date)} · Fórmula de Epley`}
              />
            </StatRow>
          ) : null}
          <StatRow>
            {records.maxWeight ? (
              <Stat
                label="Mejor peso"
                value={`${pairPrefix}${formatNumber(records.maxWeight.kg)}`}
                unit="kg"
                caption={`× ${records.maxWeight.reps} · ${formatShortDate(records.maxWeight.date)}`}
              />
            ) : null}
            {records.maxReps ? (
              <Stat
                label={unit === 'seconds' ? 'Más tiempo' : unit === 'steps' ? 'Más pasos' : 'Más reps'}
                value={unit === 'reps' ? String(records.maxReps.reps) : formatSetValues([records.maxReps.reps], unit)}
                unit={unit === 'reps' ? 'reps' : undefined}
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
          {/* Measured since 1.4.7: with two timed workouts, the rest is a figure and not one day. */}
          {rest.medianMs !== null && rest.sessions >= 2 ? (
            <StatRow>
              <Stat
                label="Descanso entre series"
                value={formatRest(rest.medianMs)}
                caption={[
                  `Mediana de las últimas ${rest.sessions} sesiones`,
                  rest.planSeconds !== null ? `plan ${formatRest(rest.planSeconds * 1000)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </StatRow>
          ) : null}
        </Section>
      ) : null}

      {sessions.length > 0 ? (
        <Section label="Sesiones">
          <ListGroup>
            {sessions.map((s) => (
              <ListRow
                key={s.sessionId}
                title={formatSetGroups(s.sets, bodyweight, exercise.pair, unit)}
                subtitle={[capitalize(formatDayMonth(s.date)), s.title ?? s.routineName ?? 'Ejercicio suelto'].filter(Boolean).join(' · ')}
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
