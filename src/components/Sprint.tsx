import { Pressable, StyleSheet, View } from 'react-native';
import { formatDuration, formatMetres, formatNumber, formatSprintTime, NBSP } from '@/domain/format';
import { splitUnit } from '@/domain/progress';
import { comparisonCaption, lapRows, sprintSummary, straightComparison, type Lap, type LapRow, type SprintMeasure } from '@/domain/sprint';
import { colors, spacing } from '@/theme';
import { AppText, ListGroup, Section, Stat, StatRow } from './ui';

const kmh = (ms: number) => formatNumber(ms * 3.6, 1);

/** Metres of a sprint: «76 m», «≈ 76 m» when the GPS was weak, «…» while measuring, «–» without GPS. */
export function sprintMetres(row: LapRow): string {
  if (!row.settled) return '…';
  if (row.quality === 'none' || row.distanceM === null) return '–';
  return `${row.quality === 'weak' ? `≈${NBSP}` : ''}${Math.round(row.distanceM)}${NBSP}m`;
}

/** Top speed of a sprint: «30,6 km/h», «≈ 30,6 km/h», «…» or «–». */
export function sprintSpeed(row: LapRow): string {
  if (!row.settled) return '…';
  if (row.quality === 'none' || row.topSpeedMs === null) return '–';
  return `${row.quality === 'weak' ? `≈${NBSP}` : ''}${kmh(row.topSpeedMs)}${NBSP}km/h`;
}

/**
 * The sprints as a table: number, time, metres and top speed, the fastest in green. `onPickLast`
 * makes the last row tappable (live: to remove it).
 */
export function SprintTable({ rows, onPickLast }: { rows: LapRow[]; onPickLast?: () => void }) {
  const { fastestIndex } = sprintSummary(rows);
  const withSpeed = rows.filter((r) => r.topSpeedMs !== null).length;
  return (
    <ListGroup>
      <View style={styles.head}>
        <AppText variant="label" style={styles.number}>
          #
        </AppText>
        <AppText variant="label" style={styles.time}>
          Tiempo
        </AppText>
        <AppText variant="label" style={styles.metres}>
          Metros
        </AppText>
        <AppText variant="label" style={styles.speed}>
          Vel. máx.
        </AppText>
      </View>
      {rows.map((row, i) => {
        const fastest = withSpeed >= 2 && i === fastestIndex;
        const last = i === rows.length - 1;
        return (
          <Pressable
            key={row.number}
            disabled={!(onPickLast && last)}
            onPress={onPickLast}
            android_ripple={onPickLast && last ? { color: colors.pressed } : undefined}
            style={styles.row}
            accessible
            accessibilityRole={onPickLast && last ? 'button' : undefined}
            accessibilityLabel={`Sprint ${row.number}: ${formatSprintTime(row.timeMs)}, ${sprintMetres(row)}, ${sprintSpeed(row)}${fastest ? ', el más rápido' : ''}`}>
            <AppText variant="bodySm" weight="600" tabular style={styles.number}>
              {row.number}
            </AppText>
            <AppText variant="rowValue" tabular style={styles.time}>
              {formatSprintTime(row.timeMs)}
            </AppText>
            <AppText variant="bodySm" tabular style={styles.metres}>
              {sprintMetres(row)}
            </AppText>
            <AppText
              variant="rowValue"
              weight={fastest ? '700' : '600'}
              tabular
              style={[styles.speed, fastest && { color: colors.primary }]}>
              {sprintSpeed(row)}
            </AppText>
          </Pressable>
        );
      })}
    </ListGroup>
  );
}

/**
 * The figures of some sprints: with GPS, the top speed (big), the metres and how many; without it,
 * the best time, how many and the time of the session.
 */
export function SprintStats({ rows, totalMs }: { rows: LapRow[]; totalMs?: number }) {
  const summary = sprintSummary(rows);
  const metres = summary.totalDistanceM === null ? null : splitUnit(formatMetres(summary.totalDistanceM));
  if (summary.topSpeedMs !== null && summary.fastestIndex !== null) {
    return (
      <StatRow>
        {/* «km/h» under the figure: next to it, it does not fit in a third of the width. Which
            sprint it was is the green row of the table. */}
        <Stat label="Vel. máx." value={kmh(summary.topSpeedMs)} caption="km/h" big />
        <Stat label="Metros" value={metres?.value ?? '–'} unit={metres?.unit} />
        <Stat label="Sprints" value={String(summary.count)} />
      </StatRow>
    );
  }
  const best = summary.bestTimeMs === null ? null : splitUnit(formatSprintTime(summary.bestTimeMs));
  return (
    <StatRow>
      <Stat
        label="Mejor"
        value={best?.value ?? '–'}
        unit={best?.unit}
        caption={summary.bestTimeIndex === null ? undefined : `sprint ${rows[summary.bestTimeIndex].number}`}
        big
      />
      <Stat label="Sprints" value={String(summary.count)} />
      {totalMs !== undefined ? <Stat label="Tiempo" value={formatDuration(totalMs)} /> : null}
    </StatRow>
  );
}

/**
 * The straight the athlete wrote down next to what the GPS measured (PLAN.md §6.8, 1.5.0): two
 * figures in plain text, so the GPS's does not read as corrected. Nothing without a straight.
 */
export function StraightStats({ rows, straightM }: { rows: LapRow[]; straightM: number | null }) {
  const comparison = straightComparison(rows, straightM);
  if (!comparison) return null;
  const { gps } = comparison;
  return (
    <View style={{ gap: spacing.xs }}>
      <StatRow>
        <Stat label="Recta" value={String(comparison.straightM)} unit="m" caption={gps ? undefined : comparisonCaption(comparison)} />
        {gps ? <Stat label="GPS" value={String(gps.medianM)} unit="m" caption={comparisonCaption(comparison)} /> : null}
      </StatRow>
      <AppText variant="caption">Recta: lo que apuntaste. No cambia los metros ni la velocidad.</AppText>
    </View>
  );
}

/** A finished sprints session: its figures, every sprint and what the numbers mean. */
export function SprintDetails({
  laps,
  totalMs,
  measures,
  straightM = null,
}: {
  laps: Lap[];
  totalMs?: number;
  measures?: (SprintMeasure | null)[];
  /** The straight written down in the plan of the session, if any. */
  straightM?: number | null;
}) {
  const rows = lapRows(laps, measures);
  const summary = sprintSummary(rows);
  if (rows.length === 0) return <AppText variant="caption">Sin sprints guardados.</AppText>;
  return (
    <>
      <SprintStats rows={rows} totalMs={totalMs} />
      <Section label="Sprints">
        <SprintTable rows={rows} />
        <View style={{ gap: spacing.xs }}>
          {summary.anyGps ? (
            <AppText variant="caption">Tiempo: del pitido a Parar. Metros y velocidad, del GPS.</AppText>
          ) : (
            <AppText variant="caption">Sin GPS: solo se midió el tiempo, del pitido a Parar.</AppText>
          )}
          {summary.anyWeak ? <AppText variant="caption">≈: GPS débil en ese sprint.</AppText> : null}
        </View>
        <StraightStats rows={rows} straightM={straightM} />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: spacing.lg, gap: spacing.sm },
  number: { width: 24 },
  time: { width: 64 },
  metres: { width: 64 },
  speed: { flex: 1, textAlign: 'right' },
});
