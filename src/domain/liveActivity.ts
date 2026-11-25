import { cardioSport, type CardioSport } from './cardioSport';
import { formatClock, formatMetres, NBSP } from './format';
import { activeMs } from './gps';
import { walkMetric, type WalkNumbers } from './walkStats';

/**
 * What the iOS Live Activity shows of a walk being recorded (1.5.7): the lock screen and the Dynamic
 * Island, outside the app. The time is counted by iOS itself from `activeStart`; the rest is text
 * the GPS task refreshes every few seconds.
 */
export interface LiveCardio {
  /** When the walk would have started without its pauses (epoch ms): iOS counts the time from here. */
  activeStart: number;
  paused: boolean;
  /** While paused, the time as it stopped («12:34»). */
  still: string | null;
  title: string;
  body: string;
  /** The distance, next to the time. */
  metric: string;
  /** SF Symbol. */
  symbol: string;
}

const SPORT_SYMBOL: Record<CardioSport, string> = {
  walk: 'figure.walk',
  run: 'figure.run',
  hike: 'figure.hiking',
  bike: 'figure.outdoor.cycle',
  swim: 'figure.pool.swim',
  row: 'figure.rower',
};

interface WalkSession {
  name: string;
  title: string | null;
  startedAt: number;
  finishedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
}

/** The walk as the Live Activity tells it; `numbers` null before its first fixes. */
export function liveWalk(session: WalkSession, numbers: WalkNumbers | null, now: number): LiveCardio {
  const active = activeMs(session, now);
  const paused = session.pausedAt !== null;
  const pace = numbers ? walkMetric('avgPace', numbers, 'km').value : '–';
  return {
    activeStart: now - active,
    paused,
    still: paused ? formatClock(active) : null,
    title: session.title || session.name,
    body: paused ? 'En pausa' : pace === '–' ? 'Grabando la ruta' : `Ritmo medio ${pace}${NBSP}/km`,
    metric: formatMetres(numbers?.distanceM ?? 0),
    symbol: paused ? 'pause.circle' : SPORT_SYMBOL[cardioSport(session.name) ?? 'walk'],
  };
}
