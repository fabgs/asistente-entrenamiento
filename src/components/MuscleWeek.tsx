import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MuscleWeekData } from '@/db/repositories/muscles';
import type { MuscleMapMode } from '@/db/repositories/settings';
import {
  calendarDaysBetween,
  formatDaysAgo,
  formatSetsOfPlan,
  MUSCLE_KEYS,
  muscleLabel,
  muscleLevels,
  RECENT_DAYS,
  recencyLevels,
  setsPerMuscle,
  totalSets,
  type LastWorked,
  type Muscle,
  type MuscleSets,
} from '@/domain/muscles';
import type { Sex } from '@/domain/nutrition';
import { countOf } from '@/domain/progress';
import { colors, spacing } from '@/theme';
import { BodyMap, HEAT } from './BodyMap';
import { AppText, Card, ListGroup, ListRow, Row, RowIcon, Section, Segmented } from './ui';

/** Of each body (scale 0,6): front and back side by side fit a 360 dp screen inside a card. */
const MAP_WIDTH = 120;

/** Opens the exercises whose sets count nowhere: straight to its editor when there is only one. */
export function openUnmapped(ids: number[]): void {
  if (ids.length === 1) router.push(`/ejercicio/${ids[0]}`);
  else router.push({ pathname: '/ejercicios', params: { sinMusculos: ids.join(',') } });
}

/** The amber row of exercises without muscles, or nothing. */
export function UnmappedRow({ ids }: { ids: number[] }) {
  if (ids.length === 0) return null;
  return (
    <ListRow
      left={<RowIcon name="alert-outline" color={colors.warning} />}
      title={`${countOf(ids.length, 'ejercicio', 'ejercicios')} sin músculos`}
      subtitle="Sus series no cuentan"
      onPress={() => openUnmapped(ids)}
    />
  );
}

const MODES: { value: MuscleMapMode; label: string }[] = [
  { value: 'week', label: 'Esta semana' },
  { value: 'days', label: 'Últimos días' },
];

/**
 * Perfil's «Músculos» (PLAN.md §6.9), in two modes: «Esta semana», the body painted by the sets done
 * since Monday, and «Últimos días» (1.4.7), by the days since each muscle last worked. Under it, a
 * line that is the legend or the reading of the muscle tapped, and the way to the detail.
 */
export function MuscleWeekSection({
  week,
  sex,
  today,
  mode,
  onModeChange,
}: {
  week: MuscleWeekData;
  sex: Sex;
  today: string;
  mode: MuscleMapMode;
  onModeChange: (mode: MuscleMapMode) => void;
}) {
  const [selected, setSelected] = useState<Muscle[] | null>(null);
  const doneTotal = totalSets(week.done);
  const plannedTotal = totalSets(week.planned);

  if (doneTotal === 0 && plannedTotal === 0 && week.lastWorkout === null) {
    return (
      <Section label="Músculos">
        <ListGroup>
          <ListRow
            left={<RowIcon name="human" color={colors.muted} />}
            title="Sin rutinas todavía"
            subtitle="Crea una para ver tu semana"
            onPress={() => router.navigate('/rutinas')}
          />
        </ListGroup>
      </Section>
    );
  }

  const done = setsPerMuscle(week.done, week.musclesOf);
  const planned = setsPerMuscle(week.planned, week.musclesOf);
  const recency = recencyLevels(week.lastWorked, today);
  const toggle = (muscles: Muscle[]) => setSelected((s) => (s?.[0] === muscles[0] ? null : muscles));
  const days = mode === 'days';
  const lastWorkout =
    week.lastWorkout !== null ? `Último entreno ${formatDaysAgo(calendarDaysBetween(week.lastWorkout, today)).toLowerCase()}` : undefined;

  return (
    <Section label="Músculos" right={days ? lastWorkout : formatSetsOfPlan(doneTotal, plannedTotal, true)}>
      <Card>
        <Segmented options={MODES} value={mode} onChange={onModeChange} />
        <BodyMap
          levels={days ? recency : muscleLevels(done)}
          sex={sex}
          width={MAP_WIDTH}
          selected={selected?.[0] ?? null}
          onPress={toggle}
        />
        <View style={styles.slot}>
          {selected ? (
            days ? (
              <DaysReading muscles={selected} lastWorked={week.lastWorked} today={today} />
            ) : (
              <Reading muscles={selected} done={done} planned={planned} />
            )
          ) : days ? (
            MUSCLE_KEYS.some((m) => recency[m] > 0) ? (
              <HeatLegend
                from={`Hace ${RECENT_DAYS} días`}
                to="Hoy"
                levels={[1, 2, 3, 4]}
                label={`Días desde que entrenaste cada músculo, de hace ${RECENT_DAYS} días a hoy; sin color, ${RECENT_DAYS + 1} días o más`}
              />
            ) : (
              <AppText variant="secondary" style={styles.center}>
                {`Nada en los últimos ${RECENT_DAYS} días`}
              </AppText>
            )
          ) : doneTotal === 0 && week.lastWeek > 0 ? (
            <AppText variant="secondary" style={styles.center}>
              {`Semana pasada: ${countOf(week.lastWeek, 'serie', 'series')}`}
            </AppText>
          ) : (
            <HeatLegend />
          )}
        </View>
      </Card>
      <ListGroup>
        <UnmappedRow ids={week.unmapped} />
        <ListRow title="Series por músculo" onPress={() => router.push('/musculos')} />
      </ListGroup>
    </Section>
  );
}

/**
 * The muscles of one workout, in its summary: the same ramp as «Esta semana», so a big session reads
 * against a week of 10 or more sets per muscle. Tapping a region reads its sets.
 */
export function SessionMusclesSection({ sets, sex }: { sets: MuscleSets; sex: Sex }) {
  const [selected, setSelected] = useState<Muscle[] | null>(null);
  const toggle = (muscles: Muscle[]) => setSelected((s) => (s?.[0] === muscles[0] ? null : muscles));
  return (
    <Section label="Músculos">
      <Card>
        <BodyMap levels={muscleLevels(sets)} sex={sex} width={MAP_WIDTH} selected={selected?.[0] ?? null} onPress={toggle} />
        <View style={styles.slot}>
          {selected ? <Reading muscles={selected} done={sets} /> : <HeatLegend label="Series de este entreno, de ninguna a 10 o más" />}
        </View>
      </Card>
    </Section>
  );
}

/** What a tapped region holds: one muscle, or the two the drawing puts together. */
function Reading({ muscles, done, planned }: { muscles: Muscle[]; done: MuscleSets; planned?: MuscleSets }) {
  return (
    <View style={styles.reading}>
      {muscles.map((m) => (
        <Row key={m} between>
          <AppText variant="rowTitle">{muscleLabel(m)}</AppText>
          <AppText variant="rowValue" tabular>
            {formatSetsOfPlan(done[m], planned?.[m] ?? 0, true)}
          </AppText>
        </Row>
      ))}
    </View>
  );
}

/**
 * When each muscle last worked, for «Últimos días»: «Ayer», or «Ayer, como secundario» when that
 * day it only helped; «Sin series» if it never worked.
 */
function DaysReading({ muscles, lastWorked, today }: { muscles: Muscle[]; lastWorked: Partial<Record<Muscle, LastWorked>>; today: string }) {
  return (
    <View style={styles.reading}>
      {muscles.map((m) => {
        const last = lastWorked[m];
        return (
          <Row key={m} between>
            <AppText variant="rowTitle">{muscleLabel(m)}</AppText>
            <AppText variant="rowValue" tabular>
              {last
                ? `${formatDaysAgo(calendarDaysBetween(last.date, today))}${last.secondaryOnly ? ', como secundario' : ''}`
                : 'Sin series'}
            </AppText>
          </Row>
        );
      })}
    </View>
  );
}

/**
 * The ramp of the body map between two words: by default from nothing to «10 o más» sets this week,
 * the start of the 10–20 range. In «Últimos días», from 3 days ago to today, without the grey of
 * nothing (no colour is 4 days or more), in the same direction so the ramp does not flip.
 */
export function HeatLegend({
  label = 'Series esta semana, de ninguna a 10 o más',
  from = '0',
  to = '10 o más series',
  levels = [0, 1, 2, 3, 4],
  ramp = HEAT,
}: {
  label?: string;
  from?: string;
  to?: string;
  levels?: number[];
  /** The colours of the levels: those of the body map, or those of the paths in the heat map. */
  ramp?: readonly string[];
}) {
  return (
    <View style={styles.legend} accessible accessibilityLabel={label}>
      <AppText variant="caption">{from}</AppText>
      <View style={styles.swatches}>
        {levels.map((level) => (
          <View key={level} style={[styles.swatch, { backgroundColor: ramp[level] }]} />
        ))}
      </View>
      <AppText variant="caption">{to}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  // Two lines of reading, so the card does not jump when a muscle is tapped.
  slot: { minHeight: 48, justifyContent: 'center' },
  reading: { gap: spacing.xs },
  center: { textAlign: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  swatches: { flexDirection: 'row', gap: 3 },
  swatch: { width: 22, height: 10, borderRadius: 2 },
});
