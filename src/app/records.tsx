import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import {
  AppText,
  EmptyState,
  ExerciseIcon,
  Figure,
  ListGroup,
  ListRow,
  Loading,
  ROW_ICON_INSET,
  Screen,
  Section,
  Stat,
  StatRow,
} from '@/components/ui';
import { allExerciseMuscles } from '@/db/repositories/muscles';
import { loadRecords, type ExerciseRecordRow } from '@/db/repositories/records';
import { formatClock, formatDateWithYear, formatMinutes, formatNumber } from '@/domain/format';
import type { ExerciseMuscles } from '@/domain/muscles';
import { countOf } from '@/domain/progress';
import { formatRecordDate, recordReading } from '@/domain/records';
import { localDateString } from '@/domain/schedule';
import { formatOverPlan, formatRest } from '@/domain/workoutTimes';
import { useLoader } from '@/hooks/data';

/**
 * Récords (PLAN.md §6.6, 1.4.7), from Perfil: totals of all time and by year, the best set of each
 * exercise of the routines, the times of the workouts and the walks. With `?otros=1`, the best set
 * of the exercises in no routine. No celebrations: the date of a record says if it is recent.
 */
export default function RecordsScreen() {
  const { otros } = useLocalSearchParams<{ otros?: string }>();
  const { data } = useLoader(async (db) => {
    const today = localDateString(new Date());
    return { today, records: await loadRecords(db, today), muscles: await allExerciseMuscles(db) };
  });

  if (!data) return <Loading />;
  const { today, records, muscles } = data;

  if (otros === '1') {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Otros ejercicios' }} />
        <ExerciseRecords rows={records.others} muscles={muscles} today={today} />
      </Screen>
    );
  }

  const { totals, years, times, walks } = records;
  if (totals.workouts === 0) {
    return (
      <Screen>
        <EmptyState icon="chart-box-outline" title="Sin entrenos todavía" text="Tus totales y récords salen al terminar el primero." />
      </Screen>
    );
  }

  const hasTimes = times.routines.length > 0 || times.warmup !== null || times.rests.medianMs !== null;

  return (
    <Screen>
      <Section label="Totales">
        <StatRow>
          <Stat label="Entrenos" value={formatNumber(totals.workouts, 0)} />
          <Stat label="Series" value={formatNumber(totals.sets, 0)} />
          <Stat label="Reps" value={formatNumber(totals.reps, 0)} />
        </StatRow>
        {totals.since ? (
          <AppText variant="caption">
            {[`Desde el ${formatDateWithYear(totals.since)}`, totals.imported > 0 ? countOf(totals.imported, 'importado', 'importados') : null]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
        ) : null}
      </Section>

      {years.length > 0 ? (
        <Section label="Por año">
          <ListGroup>
            {years.map((y) => (
              <ListRow
                key={y.year}
                title={y.year}
                subtitle={`${countOf(y.workouts, 'entreno', 'entrenos')} · ${formatNumber(y.sets, 0)} ${y.sets === 1 ? 'serie' : 'series'}`}
                right={<Figure value={formatNumber(y.perWeek, 1)} caption="por semana" />}
              />
            ))}
          </ListGroup>
        </Section>
      ) : null}

      {records.routines.length > 0 || records.others.length > 0 ? (
        <Section label="Tus rutinas">
          <ExerciseRecords rows={records.routines} muscles={muscles} today={today}>
            {records.others.length > 0 ? (
              <ListRow
                title="Otros ejercicios"
                right={String(records.others.length)}
                onPress={() => router.push({ pathname: '/records', params: { otros: '1' } })}
              />
            ) : null}
          </ExerciseRecords>
        </Section>
      ) : null}

      {hasTimes ? (
        <Section label="Tiempos">
          <ListGroup>
            {times.routines.map((r) => (
              <ListRow
                key={r.id}
                title={r.name}
                subtitle={`Mediana de ${countOf(r.count, 'entreno', 'entrenos')}`}
                right={formatMinutes(r.medianMs)}
              />
            ))}
            {times.warmup ? (
              <ListRow title="Calentamiento" subtitle={`Mediana de ${times.warmup.count}`} right={formatMinutes(times.warmup.medianMs)} />
            ) : null}
            {times.rests.medianMs !== null ? (
              <ListRow
                title="Descanso entre series"
                subtitle={
                  <AppText variant="secondary">
                    {[`Mediana de ${formatNumber(times.rests.count, 0)}`, times.rests.overPlanMs !== null ? formatOverPlan(times.rests.overPlanMs) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                }
                right={formatRest(times.rests.medianMs)}
              />
            ) : null}
          </ListGroup>
          {times.since ? <AppText variant="caption">{`Descansos y calentamiento desde el ${formatRecordDate(times.since, today)}`}</AppText> : null}
        </Section>
      ) : null}

      {walks.map((walk) => (
        <Section key={walk.name + walk.since} label={walk.name}>
          <ListGroup>
            <ListRow
              title="Total"
              subtitle={`${countOf(walk.count, 'vez', 'veces')} desde el ${formatRecordDate(walk.since, today)}`}
              right={<Figure value={formatNumber(walk.totalM / 1000, 1)} unit="km" />}
            />
            {walk.longest ? (
              <ListRow
                title="Más larga"
                subtitle={formatRecordDate(walk.longest.date, today)}
                right={<Figure value={formatNumber(walk.longest.distanceM / 1000, 1)} unit="km" />}
                onPress={() => router.push(`/cardio-sesion/${walk.longest!.sessionId}`)}
              />
            ) : null}
            {walk.bestKm ? (
              <ListRow
                title="Mejor km"
                subtitle={formatRecordDate(walk.bestKm.date, today)}
                right={<Figure value={formatClock(Math.round(walk.bestKm.seconds) * 1000)} unit="/km" />}
                onPress={() => router.push(`/cardio-sesion/${walk.bestKm!.sessionId}`)}
              />
            ) : null}
          </ListGroup>
        </Section>
      ))}
    </Screen>
  );
}

/** One row per exercise with its best set; each opens its progress. */
function ExerciseRecords({
  rows,
  muscles,
  today,
  children,
}: {
  rows: ExerciseRecordRow[];
  muscles: Map<number, ExerciseMuscles>;
  today: string;
  children?: ReactNode;
}) {
  return (
    <ListGroup inset={ROW_ICON_INSET}>
      {rows.map((row) => {
        const { figure, subtitle } = recordReading({ ...row, bodyweight: row.type === 'bodyweight' }, today);
        return (
          <ListRow
            key={row.exerciseId}
            left={<ExerciseIcon muscles={muscles.get(row.exerciseId)} />}
            title={row.name}
            subtitle={
              // «8 reps · 12 mar 2025 · ahora lastre 15 kg · Importado» does not fit in one line (three with the large font).
              subtitle ? (
                <AppText variant="secondary" numberOfLines={3}>
                  {subtitle}
                </AppText>
              ) : undefined
            }
            right={<Figure {...figure} />}
            onPress={() => router.push(`/progreso/${row.exerciseId}`)}
          />
        );
      })}
      {children}
    </ListGroup>
  );
}
