import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatDuration, formatSprintTime, NBSP } from '@/domain/format';
import type { LatLon } from '@/domain/gps';
import { splitUnit } from '@/domain/progress';
import {
  bestSprint,
  gpsTopSpeed,
  lapRows,
  sprintSummary,
  straightSpeedMs,
  type Lap,
  type LapRow,
  type SprintMeasure,
  type SprintPlan,
} from '@/domain/sprint';
import { colors, spacing } from '@/theme';
import { RouteMap } from './RouteMap';
import { AppText, ListGroup, ListRow, ROW_ICON_INSET, RowIcon, Section, Stat, StatRow } from './ui';

/** Always with its decimal («24,0»): the speeds of a column line up and read as measured alike. */
const kmh = (ms: number) => (Math.round(ms * 36) / 10).toFixed(1).replace('.', ',');

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

/** Speed of a sprint over the straight, «18,5 km/h». */
export const straightSpeed = (straightM: number, timeMs: number) => `${kmh(straightSpeedMs(straightM, timeMs))}${NBSP}km/h`;

/**
 * The sprints as a table (PLAN.md §6.8, 1.5.2). The time is what counts and the best one is green.
 * With a straight: number, time, speed over it («Media», in km/h) and the metres the GPS measured;
 * without one: number, time and what the GPS measured. The GPS is always in grey: over 30 m it is
 * rough, and it is there to be checked. `onPickLast` makes the last row tappable (live: to remove it).
 */
export function SprintTable({ rows, straightM = null, onPickLast }: { rows: LapRow[]; straightM?: number | null; onPickLast?: () => void }) {
  const { bestTimeIndex } = sprintSummary(rows);
  const withStraight = straightM !== null;
  return (
    <ListGroup>
      <View style={styles.head}>
        <AppText variant="label" style={styles.number}>
          #
        </AppText>
        <AppText variant="label" style={styles.time}>
          Tiempo
        </AppText>
        <AppText variant="label" style={withStraight ? styles.mean : styles.metres}>
          {withStraight ? 'Media' : 'Metros'}
        </AppText>
        <AppText variant="label" style={styles.last}>
          {withStraight ? 'GPS' : 'Vel. máx.'}
        </AppText>
      </View>
      {rows.map((row, i) => {
        const best = rows.length >= 2 && i === bestTimeIndex;
        const last = i === rows.length - 1;
        const mean = withStraight ? kmh(straightSpeedMs(straightM, row.timeMs)) : null;
        return (
          <Pressable
            key={row.number}
            disabled={!(onPickLast && last)}
            onPress={onPickLast}
            android_ripple={onPickLast && last ? { color: colors.pressed } : undefined}
            style={styles.row}
            accessible
            accessibilityRole={onPickLast && last ? 'button' : undefined}
            accessibilityLabel={
              mean !== null
                ? `Sprint ${row.number}: ${formatSprintTime(row.timeMs)}, ${mean} kilómetros por hora, GPS ${sprintMetres(row)}${best ? ', el mejor' : ''}`
                : `Sprint ${row.number}: ${formatSprintTime(row.timeMs)}, GPS ${sprintMetres(row)}, ${sprintSpeed(row)}${best ? ', el mejor' : ''}`
            }>
            <AppText variant="bodySm" weight="600" tabular style={styles.number}>
              {row.number}
            </AppText>
            <AppText variant="rowValue" weight={best ? '700' : '600'} tabular style={[styles.time, best && { color: colors.primary }]}>
              {formatSprintTime(row.timeMs)}
            </AppText>
            {mean !== null ? (
              <AppText variant="rowValue" tabular style={styles.mean}>
                {mean}
              </AppText>
            ) : (
              <AppText variant="bodySm" tabular style={[styles.metres, styles.gps]}>
                {sprintMetres(row)}
              </AppText>
            )}
            <AppText variant="bodySm" tabular style={[styles.last, styles.gps]}>
              {withStraight ? sprintMetres(row) : sprintSpeed(row)}
            </AppText>
          </Pressable>
        );
      })}
    </ListGroup>
  );
}

/**
 * The figures of some sprints: the best time, big, and with a straight the speed it means
 * (straight ÷ time); without one, how many and the time of the session. Nothing of the GPS.
 */
export function SprintStats({ rows, straightM = null, totalMs }: { rows: LapRow[]; straightM?: number | null; totalMs?: number }) {
  const best = bestSprint(rows, straightM);
  const time = best ? splitUnit(formatSprintTime(best.timeMs)) : null;
  return (
    <StatRow>
      <Stat label="Mejor" value={time?.value ?? '–'} unit={time?.unit} caption={best ? `sprint ${best.number}` : undefined} big />
      {/* «km/h» under the figure: next to it, it does not fit in a third of the width. */}
      {best?.speedMs != null ? <Stat label="Vel. media" value={kmh(best.speedMs)} caption="km/h" /> : null}
      <Stat label="Sprints" value={String(rows.length)} />
      {best?.speedMs == null && totalMs !== undefined ? <Stat label="Tiempo" value={formatDuration(totalMs)} /> : null}
    </StatRow>
  );
}

/**
 * The straight of some sprints (1.5.2): its map when it was marked there (and the path of each
 * sprint, in a finished session) over the row that says its metres and opens the screen to mark it.
 * Without one, the row asks for it: it is what the speeds come from.
 */
export function StraightCard({
  plan,
  onPress,
  mapHeight,
  traces = [],
  elsewhere = false,
  children,
}: {
  plan: SprintPlan;
  onPress?: () => void;
  mapHeight: number;
  /** More rows of the same group (the plan, on the first screen of the sprints). */
  children?: ReactNode;
  /** The path of each sprint by the GPS chip, drawn over the straight. */
  traces?: LatLon[][];
  /** The athlete is nowhere near the straight marked: it is from another day's place. */
  elsewhere?: boolean;
}) {
  const ends = plan.straightEnds;
  const marked = plan.straightM !== null;
  const hasMap = ends !== null || traces.length > 0;
  return (
    <ListGroup inset={ROW_ICON_INSET}>
      {hasMap ? (
        <RouteMap
          segments={ends ? [[ends.start, ends.end]] : []}
          traces={traces}
          height={mapHeight}
          rounded={false}
          exactFit
          maxScale={4}
          fitPadding={28}
          detail={2}
          onPress={onPress}
          label={onPress ? 'Marcar la recta en el mapa' : 'Mapa de la recta'}
        />
      ) : null}
      <ListRow
        onPress={onPress}
        left={<RowIcon name="ruler" color={marked ? colors.text : colors.warning} tint={marked ? undefined : colors.warningTint} />}
        title={marked ? 'Recta' : 'Marcar la recta'}
        subtitle={
          !marked ? (
            'Para medir la velocidad'
          ) : elsewhere ? (
            <AppText variant="secondary" numberOfLines={1} style={{ color: colors.warning }}>
              Marcada en otro sitio
            </AppText>
          ) : undefined
        }
        right={marked ? `${plan.straightM}${NBSP}m` : undefined}
      />
      {children}
    </ListGroup>
  );
}

/** What the figures of the table mean, in small print. */
export function SprintNotes({ rows, straightM }: { rows: LapRow[]; straightM: number | null }) {
  const summary = sprintSummary(rows);
  const top = gpsTopSpeed(rows, straightM);
  return (
    <View style={{ gap: spacing.xs }}>
      {straightM !== null ? (
        <AppText variant="caption">Media: km/h, recta ÷ tiempo.{summary.anyGps ? ' GPS: los metros que midió.' : ''}</AppText>
      ) : summary.anyGps ? (
        <AppText variant="caption">Tiempo: del pitido a Parar. Metros y velocidad, del GPS.</AppText>
      ) : (
        <AppText variant="caption">Sin GPS: solo se midió el tiempo, del pitido a Parar.</AppText>
      )}
      {summary.anyWeak ? <AppText variant="caption">≈: GPS débil en ese sprint.</AppText> : null}
      {straightM !== null && top ? (
        <AppText variant="caption">
          Vel. máx. del GPS: {top.weak ? `≈${NBSP}` : ''}
          {kmh(top.speedMs)}
          {NBSP}km/h
        </AppText>
      ) : null}
    </View>
  );
}

/** A finished sprints session: its figures, its straight on the map, every sprint and what the numbers mean. */
export function SprintDetails({
  laps,
  plan,
  totalMs,
  measures,
  traces = [],
  onStraight,
}: {
  laps: Lap[];
  plan: SprintPlan;
  totalMs?: number;
  measures?: (SprintMeasure | null)[];
  traces?: LatLon[][];
  /** Opens the screen that marks the straight. */
  onStraight?: () => void;
}) {
  const rows = lapRows(laps, measures);
  if (rows.length === 0) return <AppText variant="caption">Sin sprints guardados.</AppText>;
  return (
    <>
      <SprintStats rows={rows} straightM={plan.straightM} totalMs={totalMs} />
      <StraightCard plan={plan} onPress={onStraight} mapHeight={160} traces={traces} />
      <Section label="Sprints">
        <SprintTable rows={rows} straightM={plan.straightM} />
        <SprintNotes rows={rows} straightM={plan.straightM} />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: spacing.lg, gap: spacing.sm },
  number: { width: 24 },
  time: { width: 68 },
  metres: { width: 64 },
  mean: { width: 56 },
  last: { flex: 1, textAlign: 'right' },
  gps: { color: colors.muted },
});
