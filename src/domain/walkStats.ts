import { formatClock } from './format';
import {
  activeMs,
  altitudeProfile,
  buildSamples,
  decodeRoute,
  elevationChange,
  paceMinPerKm,
  summarizeTrack,
  type LatLon,
  type TrackPoint,
  type TrackSample,
} from './gps';

export type DistanceUnit = 'km' | 'm';

/** Figures of a walk that can take the big spot of its screen. */
export type WalkMetric = 'distance' | 'time' | 'pace' | 'speed' | 'avgPace' | 'avgSpeed' | 'climb';

const WALK_METRICS: WalkMetric[] = ['distance', 'time', 'pace', 'speed', 'avgPace', 'avgSpeed', 'climb'];

export const isWalkMetric = (value: string): value is WalkMetric => (WALK_METRICS as string[]).includes(value);

/** After the walk there is no current pace or speed: the average stands in for it. */
export function finishedMetric(metric: WalkMetric): WalkMetric {
  return metric === 'pace' ? 'avgPace' : metric === 'speed' ? 'avgSpeed' : metric;
}

export type BoardMode = 'live' | 'finished';

const GRID: Record<BoardMode, WalkMetric[]> = {
  live: ['time', 'pace', 'speed', 'avgPace', 'avgSpeed', 'climb'],
  finished: ['time', 'avgPace', 'avgSpeed', 'climb'],
};

/**
 * The big figure and the cells under it. Every figure has its own cell; the one in the big spot
 * leaves the distance in its place, so the others never move.
 */
export function gridMetrics(hero: WalkMetric, mode: BoardMode): { hero: WalkMetric; cells: WalkMetric[] } {
  const big = mode === 'finished' ? finishedMetric(hero) : hero;
  return { hero: big, cells: GRID[mode].map((m) => (m === big ? 'distance' : m)) };
}

/** Below this the pace and speed are only noise. */
const MIN_PACE_DISTANCE_M = 50;

export interface WalkNumbers {
  distanceM: number;
  activeMs: number;
  /** Over the last seconds, while recording; missing while paused. */
  currentSpeedMs?: number;
  /** Metres climbed; null without altitude. */
  climbM: number | null;
}

export interface MetricText {
  label: string;
  value: string;
  unit: string;
}

const SPOKEN_UNIT: Record<string, string> = {
  km: 'kilómetros',
  m: 'metros',
  '/km': 'por kilómetro',
  'km/h': 'kilómetros por hora',
};
const CLOCK_WORDS = [
  ['hora', 'horas'],
  ['minuto', 'minutos'],
  ['segundo', 'segundos'],
] as const;

/** What a screen reader says: «Ritmo, 11 minutos 32 segundos por kilómetro». */
export function spokenMetric({ label, value, unit }: MetricText): string {
  if (value === '–') return `${label}, sin datos`;
  const clock = value.split(':').map(Number);
  const spoken =
    clock.length > 1
      ? clock
          .map((v, i) => [v, CLOCK_WORDS.slice(-clock.length)[i]] as const)
          .filter(([v], i, all) => v > 0 || (i === all.length - 1 && all.every(([x]) => x === 0)))
          .map(([v, [one, many]]) => `${v} ${v === 1 ? one : many}`)
          .join(' ')
      : value;
  return [`${label}, ${spoken}`, SPOKEN_UNIT[unit]].filter(Boolean).join(' ');
}

const LABEL: Record<WalkMetric, string> = {
  distance: 'Distancia',
  time: 'Tiempo',
  pace: 'Ritmo',
  speed: 'Velocidad',
  avgPace: 'Ritmo medio',
  avgSpeed: 'Vel. media',
  climb: 'Desnivel +',
};

/** Fixed decimals with a comma: 5.1 → "5,10". */
export const fixed = (value: number, decimals: number) => value.toFixed(decimals).replace('.', ',');

/** "5,14 km" or "5142 m"; from five digits on, thousands are separated with a thin space. */
export function formatDistance(metres: number, unit: DistanceUnit): { value: string; unit: string } {
  if (unit === 'km') return { value: fixed(metres / 1000, 2), unit: 'km' };
  const whole = String(Math.round(metres));
  return { value: whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : whole, unit: 'm' };
}

/** What a walk screen needs from a GPS session, finished or being recorded. */
export interface WalkSource {
  startedAt: number;
  finishedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  distanceM: number | null;
  route: string | null;
  samples: TrackSample[];
}

export interface WalkSnapshot {
  segments: LatLon[][];
  samples: TrackSample[];
  numbers: WalkNumbers;
}

/**
 * Route, profile and figures of a walk: from its stored route and profile once finished, or from
 * the fixes recorded so far (`points`) while it is being recorded.
 */
export function walkSnapshot(session: WalkSource, points: TrackPoint[] | null, now: number): WalkSnapshot {
  const climb = (samples: TrackSample[]) => {
    const profile = altitudeProfile(samples);
    return profile.length > 1 ? elevationChange(profile).gain : null;
  };
  if (points) {
    const track = summarizeTrack(points, now);
    const samples = track.segments.length ? buildSamples(track.segments, session.startedAt) : [];
    return {
      segments: track.segments,
      samples,
      numbers: {
        distanceM: track.distanceM,
        activeMs: activeMs(session, now),
        currentSpeedMs: session.pausedAt === null ? track.currentSpeedMs : undefined,
        climbM: climb(samples),
      },
    };
  }
  return {
    segments: decodeRoute(session.route),
    samples: session.samples,
    numbers: {
      distanceM: session.distanceM ?? 0,
      activeMs: activeMs(session, session.finishedAt ?? session.startedAt),
      climbM: climb(session.samples),
    },
  };
}

/** «–» for the pace and speed while paused or before the first 50 m, and for the climb without altitude. */
export function walkMetric(metric: WalkMetric, n: WalkNumbers, unit: DistanceUnit): MetricText {
  const enough = n.distanceM >= MIN_PACE_DISTANCE_M;
  const average = enough && n.activeMs > 0 ? n.distanceM / (n.activeMs / 1000) : null;
  const current = enough ? n.currentSpeedMs : undefined;
  const label = LABEL[metric];
  switch (metric) {
    case 'distance':
      return { label, ...formatDistance(n.distanceM, unit) };
    case 'time':
      return { label, value: formatClock(n.activeMs), unit: '' };
    case 'pace':
      return { label, value: (current !== undefined && paceMinPerKm(current)) || '–', unit: '/km' };
    case 'speed':
      return { label, value: current === undefined ? '–' : fixed(current * 3.6, 1), unit: 'km/h' };
    case 'avgPace':
      return { label, value: (average !== null && paceMinPerKm(average)) || '–', unit: '/km' };
    case 'avgSpeed':
      return { label, value: average === null ? '–' : fixed(average * 3.6, 1), unit: 'km/h' };
    case 'climb':
      return { label, value: n.climbM === null ? '–' : String(Math.round(n.climbM)), unit: 'm' };
  }
}
