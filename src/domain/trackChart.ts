import { formatNumber, NBSP } from './format';
import { altitudeProfile, elevationChange, kmSplits, speedSeries, type TrackSample } from './gps';
import { formatDistance, type DistanceUnit } from './walkStats';

export type TrackMetric = 'speed' | 'pace' | 'altitude';

/** One point of a walk chart: active seconds, metres so far and the value (null = gap). */
export interface SeriesPoint {
  s: number;
  d: number;
  value: number | null;
}

/** Slower than this (2 km/h) the pace is standing around, not walking: the chart leaves a gap. */
export const MIN_PACE_SPEED_MS = 0.55;

/**
 * Values to chart along the walk: speed in km/h and altitude in metres (both smoothed), and pace
 * in minutes per km, with gaps while stopped.
 */
export function trackSeries(samples: TrackSample[], metric: TrackMetric): SeriesPoint[] {
  if (metric === 'altitude') return altitudeProfile(samples).map((p) => ({ s: p.s, d: p.d, value: p.a }));
  const at = new Map(samples.map((x) => [x.s, x.d]));
  return speedSeries(samples).map(({ s, speed }) => ({
    s,
    d: at.get(s) ?? 0,
    value: metric === 'speed' ? speed * 3.6 : speed >= MIN_PACE_SPEED_MS ? 1000 / speed / 60 : null,
  }));
}

export interface Range {
  min: number;
  max: number;
}

/**
 * Zooms the visible range by `factor` (> 1 zooms in) keeping `anchor` (a value inside the view) at
 * the same place on screen, never wider than `full` nor narrower than `minSpan`.
 */
export function zoomRange(view: Range, full: Range, factor: number, anchor: number, minSpan: number): Range {
  const fullSpan = full.max - full.min;
  const span = Math.min(fullSpan, Math.max(Math.min(minSpan, fullSpan), (view.max - view.min) / factor));
  const ratio = view.max > view.min ? (anchor - view.min) / (view.max - view.min) : 0.5;
  return clampRange({ min: anchor - ratio * span, max: anchor - ratio * span + span }, full);
}

/** Moves the visible range by `delta` without leaving `full`. */
export function panRange(view: Range, full: Range, delta: number): Range {
  return clampRange({ min: view.min + delta, max: view.max + delta }, full);
}

function clampRange(view: Range, full: Range): Range {
  const span = Math.min(view.max - view.min, full.max - full.min);
  const min = Math.min(Math.max(view.min, full.min), full.max - span);
  return { min, max: min + span };
}

export const isZoomed = (view: Range, full: Range) => view.max - view.min < (full.max - full.min) * 0.999;

/** Index of the point closest to `x` (points sorted by `x`). */
export function nearestIndex<T>(points: T[], x: number, key: (p: T) => number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(points[mid]) < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(key(points[lo - 1]) - x) <= Math.abs(key(points[lo]) - x)) return lo - 1;
  return lo;
}

/**
 * Range of the y axis: from the 2nd to the 98th percentile plus 8 %, so a GPS spike is cut at the
 * edge instead of flattening the whole line. With few values, all of them.
 */
export function percentileRange(values: number[]): Range {
  if (values.length === 0) return { min: 0, max: 1 };
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 10) return { min: sorted[0], max: sorted[sorted.length - 1] };
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.ceil(sorted.length * 0.98) - 1];
  const pad = (hi - lo) * 0.08;
  return { min: Math.max(0, lo - pad), max: hi + pad };
}

/** One mark per km (every 500, 200 or 100 m when zoomed in); only the last one carries the unit. */
export function distanceTicks(view: Range, unit: DistanceUnit): { d: number; label: string }[] {
  const span = view.max - view.min;
  const step = [1000, 500, 200, 100].find((s) => span / s >= 2.5) ?? 100;
  const ticks: number[] = [];
  for (let d = Math.ceil(view.min / step) * step; d <= view.max; d += step) ticks.push(d);
  return ticks.map((d, i) => {
    const text = unit === 'm' ? formatDistance(d, 'm').value : formatNumber(d / 1000, 1);
    return { d, label: i === ticks.length - 1 ? `${text}${NBSP}${unit}` : text };
  });
}

/** A figure over the chart: its label and its value in the unit of the metric (null = no data). */
export interface ChartStat {
  label: string;
  value: number | null;
}

/**
 * The two figures over the chart with nothing selected: the average pace and the fastest full km,
 * the average and the top speed (95th percentile, so a GPS jump does not count), or the metres
 * climbed and descended. `average` (distance and active time) keeps the averages equal to the
 * figures of the walk; without it they come from the samples.
 */
export function chartSummary(
  metric: TrackMetric,
  samples: TrackSample[],
  average?: { distanceM: number; activeMs: number },
): [ChartStat, ChartStat] {
  if (metric === 'altitude') {
    const profile = altitudeProfile(samples);
    const change = profile.length > 1 ? elevationChange(profile) : null;
    return [
      { label: 'Subida', value: change?.gain ?? null },
      { label: 'Bajada', value: change?.loss ?? null },
    ];
  }
  const last = samples[samples.length - 1];
  const speedMs = average
    ? average.activeMs > 0
      ? average.distanceM / (average.activeMs / 1000)
      : 0
    : last && last.s > 0
      ? last.d / last.s
      : 0;
  if (metric === 'speed') {
    const speeds = trackSeries(samples, 'speed')
      .map((p) => p.value)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const top = speeds.length === 0 ? null : speeds[Math.max(0, Math.ceil(speeds.length * 0.95) - 1)];
    return [
      { label: 'Velocidad media', value: speedMs * 3.6 },
      { label: 'Máxima', value: top },
    ];
  }
  const fullKms = kmSplits(samples).filter((s) => s.distanceM === 1000);
  const bestS = fullKms.length > 0 ? Math.min(...fullKms.map((s) => s.seconds)) : null;
  return [
    { label: 'Ritmo medio', value: speedMs > 0.3 ? 1000 / speedMs / 60 : null },
    { label: 'Mejor km', value: bestS === null ? null : bestS / 60 },
  ];
}
