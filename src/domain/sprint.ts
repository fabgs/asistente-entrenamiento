import { formatCountdown, formatSpeedKmh, formatSprintTime, NBSP } from './format';
import { distanceM } from './gps';

/**
 * Sprints (PLAN.md §6.8): a beep starts each sprint and the athlete taps «Parar» when they stop.
 * The whole state of a session is its list of laps; at most the last one is open, and an open lap
 * whose start is still ahead is a start waiting for its beep.
 */
export interface SprintPlan {
  kind: 'sprint';
  sprints: number;
  restSec: number;
  /** Seconds of count before each beep (1.5.0): from «Empezar sprint» or skipping the rest, and the last ones of every rest. */
  leadSec: number;
  /** Metres of the straight, when the athlete knows them (1.5.0): shown next to what the GPS measures, never to correct it. */
  straightM: number | null;
}

export const DEFAULT_SPRINT_PLAN: SprintPlan = { kind: 'sprint', sprints: 6, restSec: 90, leadSec: 5, straightM: null };
export const SPRINTS_RANGE = [1, 20] as const;
export const REST_RANGE_S = [30, 600] as const;
/** The count before the beep: 5 s as always, up to 30 to leave the phone and get set. */
export const LEAD_RANGE_S = [5, 30] as const;
export const STRAIGHT_RANGE_M = [10, 400] as const;

/** From «Empezar sprint» (or skipping the rest) to the beep, and the count shown before every beep. */
export const leadMs = (plan: SprintPlan) => plan.leadSec * 1000;
/** «Parar» is ignored this long after the beep: a second tap of the one that started it. */
export const ARM_MS = 600;
/** «Parar» before this is a false start: the sprint does not count. */
export const FALSE_START_MS = 3_000;
/** A sprint running this long was probably not stopped. */
export const FORGOTTEN_MS = 60_000;

export type SprintQuality = 'good' | 'weak' | 'none';

export interface Lap {
  /** Epoch ms of the beep; in the future while the start is pending. */
  startAt: number;
  /** null while running or pending. */
  stopAt: number | null;
  /** Measured from the GPS when the session finishes. */
  distanceM: number | null;
  topSpeedMs: number | null;
  /** null = not measured yet. */
  quality: SprintQuality | null;
}

export interface SprintFix {
  t: number;
  lat: number;
  lon: number;
  accuracy: number | null;
  /** Doppler speed from the GPS, m/s; Android gives 0 when it does not know. */
  speed: number | null;
  /** When the background task stored it (diagnosis of clock skew and delays). */
  receivedAt: number | null;
}

export interface SprintMeasure {
  distanceM: number | null;
  topSpeedMs: number | null;
  quality: SprintQuality;
  /** The fixes after the stop have arrived (or waiting for them is over). */
  settled: boolean;
}

export const SPRINT_MAX_ACCURACY_M = 20;
export const GOOD_ACCURACY_M = 8;
export const MAX_HUMAN_SPEED_MS = 12.5;
/** Android reports a speed of 0 when it does not know it. */
export const UNKNOWN_DOPPLER_MS = 0.1;
/** Below this, walking or standing: no burst, and the end of the sprint. */
export const BURST_MS = 2;
export const MAX_GAP_MS = 2_500;
export const MAX_POSITIONAL_SHARE = 0.3;
export const TOP_SPEED_TAIL_MS = 1_000;
export const SETTLE_TIMEOUT_MS = 5_000;
/** How late the fix times run behind the clock of the taps; calibrated on a measured track. */
export const GPS_LAG_MS = 0;
export const LAP_FIXES_MARGIN_MS = 3_000;
export const STALE_FIX_MS = 4_000;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, Math.round(v)));

/** The stored plan, or null if it is not a sprint plan. Out-of-range numbers are brought into range. */
export function parseSprintPlan(json: string | null): SprintPlan | null {
  if (!json) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (p?.kind !== 'sprint' || !isNumber(p.sprints) || !isNumber(p.restSec)) return null;
  return {
    kind: 'sprint',
    sprints: clamp(p.sprints, SPRINTS_RANGE),
    restSec: clamp(p.restSec, REST_RANGE_S),
    // Plans stored before the 1.5.0 have neither: the count of always and no straight.
    leadSec: isNumber(p.leadSec) ? clamp(p.leadSec, LEAD_RANGE_S) : DEFAULT_SPRINT_PLAN.leadSec,
    straightM: isNumber(p.straightM) && p.straightM > 0 ? clamp(p.straightM, STRAIGHT_RANGE_M) : null,
  };
}

const sprintsCount = (n: number) => `${n} ${n === 1 ? 'sprint' : 'sprints'}`;

/** «6 sprints · descanso 1:30», and «· recta 60 m» when it is known. */
export const describeSprintPlan = (p: SprintPlan) =>
  `${sprintsCount(p.sprints)} · descanso ${formatCountdown(p.restSec * 1000)}${p.straightM !== null ? ` · recta ${p.straightM}${NBSP}m` : ''}`;

/** «Sprint 4 de 6», or «Sprint 7» for one beyond the plan. */
export const sprintLabel = (n: number, p: SprintPlan) => (n <= p.sprints ? `Sprint ${n} de ${p.sprints}` : `Sprint ${n}`);

const round = (v: number | null, decimals: number) => (v === null ? null : Math.round(v * 10 ** decimals) / 10 ** decimals);

/** `[[startAt, stopAt, distance, top speed, quality], …]`, distances to 0,1 m and speeds to 0,01 m/s. */
export function encodeLaps(laps: Lap[]): string {
  return JSON.stringify(laps.map((l) => [l.startAt, l.stopAt, round(l.distanceM, 1), round(l.topSpeedMs, 2), l.quality]));
}

const QUALITIES: readonly unknown[] = ['good', 'weak', 'none'];

/** Invalid or missing → no laps. Sorted by start; an open lap that is not the last one is dropped. */
export function decodeLaps(json: string | null): Lap[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const laps = raw
    .filter((r): r is unknown[] => Array.isArray(r) && isNumber(r[0]))
    .map(
      (r): Lap => ({
        startAt: r[0] as number,
        stopAt: isNumber(r[1]) ? r[1] : null,
        distanceM: isNumber(r[2]) ? r[2] : null,
        topSpeedMs: isNumber(r[3]) ? r[3] : null,
        quality: QUALITIES.includes(r[4]) ? (r[4] as SprintQuality) : null,
      }),
    )
    .sort((a, b) => a.startAt - b.startAt);
  return laps.filter((l, i) => l.stopAt !== null || i === laps.length - 1);
}

export type SprintState =
  | { kind: 'ready'; number: number }
  | { kind: 'waiting'; number: number; goAt: number; restFrom: number | null }
  | { kind: 'running'; number: number; startAt: number; forgotten: boolean }
  | { kind: 'done'; count: number };

const closedOf = (laps: Lap[]) => laps.filter((l) => l.stopAt !== null);
const openOf = (laps: Lap[]) => {
  const last = laps.at(-1);
  return last && last.stopAt === null ? last : null;
};
const pendingLap = (startAt: number): Lap => ({ startAt, stopAt: null, distanceM: null, topSpeedMs: null, quality: null });

export function sprintState(plan: SprintPlan, laps: Lap[], now: number): SprintState {
  const open = openOf(laps);
  const closed = closedOf(laps);
  if (open && open.startAt > now) {
    return { kind: 'waiting', number: closed.length + 1, goAt: open.startAt, restFrom: closed.at(-1)?.stopAt ?? null };
  }
  if (open) return { kind: 'running', number: closed.length + 1, startAt: open.startAt, forgotten: now - open.startAt > FORGOTTEN_MS };
  if (closed.length >= plan.sprints) return { kind: 'done', count: closed.length };
  return { kind: 'ready', number: closed.length + 1 };
}

/** Ready → a start after the count; during a rest → the start moves to a count from now, only if that is sooner. */
export function goNow(plan: SprintPlan, laps: Lap[], now: number): Lap[] | null {
  const state = sprintState(plan, laps, now);
  const lead = leadMs(plan);
  if (state.kind === 'ready') return [...laps, pendingLap(now + lead)];
  if (state.kind === 'waiting' && state.goAt - now > lead) return [...laps.slice(0, -1), pendingLap(now + lead)];
  return null;
}

/** Waiting → the pending start goes away. */
export function cancelGo(plan: SprintPlan, laps: Lap[], now: number): Lap[] | null {
  return sprintState(plan, laps, now).kind === 'waiting' ? laps.slice(0, -1) : null;
}

export type StopOutcome =
  | { kind: 'ignored' }
  | { kind: 'false-start'; laps: Lap[] }
  | { kind: 'stopped'; laps: Lap[]; number: number; timeMs: number; last: boolean };

/**
 * «Parar» at `at`: too soon is ignored, before 3 s it is a false start, otherwise the sprint closes.
 * With a `button` (a volume key or the notification, 1.5.0) a stop before 3 s is ignored instead: a
 * squeeze of the phone on the way out must not take the sprint away unseen. `now` is when the stop
 * is applied: a button's press may be read late, and if by then the rest would already be over (or
 * inside its count), no start is left pending and the athlete starts the next one.
 */
export function stopLap(plan: SprintPlan, laps: Lap[], at: number, { now = at, button = false }: { now?: number; button?: boolean } = {}): StopOutcome {
  const state = sprintState(plan, laps, at);
  if (state.kind !== 'running') return { kind: 'ignored' };
  const timeMs = at - state.startAt;
  if (timeMs < ARM_MS) return { kind: 'ignored' };
  if (timeMs < FALSE_START_MS) return button ? { kind: 'ignored' } : { kind: 'false-start', laps: laps.slice(0, -1) };
  const closed = [...laps.slice(0, -1), { ...laps[laps.length - 1], stopAt: at }];
  const last = state.number >= plan.sprints;
  const restEnd = at + plan.restSec * 1000;
  return {
    kind: 'stopped',
    laps: last || restEnd < now + leadMs(plan) ? closed : [...closed, pendingLap(restEnd)],
    number: state.number,
    timeMs,
    last,
  };
}

/** ±30 s during a rest; never closer than the count before the beep. */
export function shiftRest(plan: SprintPlan, laps: Lap[], deltaSec: number, now: number): Lap[] | null {
  const state = sprintState(plan, laps, now);
  const lead = leadMs(plan);
  if (state.kind !== 'waiting' || state.goAt - now <= lead) return null;
  return [...laps.slice(0, -1), pendingLap(Math.max(state.goAt + deltaSec * 1000, now + lead))];
}

/** Removes the last finished sprint (not while one runs); with none left, the pending start goes too. */
export function dropLastClosed(plan: SprintPlan, laps: Lap[], now: number): Lap[] | null {
  if (sprintState(plan, laps, now).kind === 'running') return null;
  let index = laps.length - 1;
  while (index >= 0 && laps[index].stopAt === null) index--;
  if (index < 0) return null;
  const rest = laps.filter((_, i) => i !== index);
  return closedOf(rest).length === 0 ? [] : rest;
}

/** Removes the sprint that is running (one that was never stopped). */
export function dropOpen(plan: SprintPlan, laps: Lap[], now: number): Lap[] | null {
  return sprintState(plan, laps, now).kind === 'running' ? laps.slice(0, -1) : null;
}

/** After the planned sprints, one more: after the usual rest, or after the count if that is already over. */
export function extraSprint(plan: SprintPlan, laps: Lap[], now: number): Lap[] | null {
  if (sprintState(plan, laps, now).kind !== 'done') return null;
  const lastStop = closedOf(laps).at(-1)?.stopAt ?? now;
  return [...laps, pendingLap(Math.max(lastStop + plan.restSec * 1000, now + leadMs(plan)))];
}

/** On finishing: a sprint running long enough closes now; a shorter one or a pending start goes. */
export function closeForFinish(laps: Lap[], at: number): Lap[] {
  const open = openOf(laps);
  if (!open) return laps;
  const rest = laps.slice(0, -1);
  return open.startAt <= at && at - open.startAt >= FALSE_START_MS ? [...rest, { ...open, stopAt: at }] : rest;
}

interface Speeded {
  t: number;
  m: number;
  accuracy: number;
  positional: boolean;
}

const median3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/** Fixes sorted, without repeated times, inaccurate ones or isolated jumps. */
function cleanFixes(fixes: SprintFix[]): SprintFix[] {
  const sorted = [...fixes].sort((a, b) => a.t - b.t);
  const unique = sorted.filter((f, i) => i === 0 || f.t !== sorted[i - 1].t);
  const accurate = unique.filter((f) => f.accuracy !== null && f.accuracy <= SPRINT_MAX_ACCURACY_M);
  const tooFast = (a: SprintFix, b: SprintFix) => distanceM(a, b) / Math.max(0.001, Math.abs(b.t - a.t) / 1000) > MAX_HUMAN_SPEED_MS;
  return accurate.filter((f, i) => {
    if (i === 0 || i === accurate.length - 1) return true;
    return !(tooFast(accurate[i - 1], f) && tooFast(f, accurate[i + 1]));
  });
}

/** Speed of each fix (Doppler when it is believable, from the positions otherwise), then a median of 3. */
function speedSeries(points: SprintFix[]): Speeded[] {
  const raw = points
    .map((p, i) => {
      const prev = points[i - 1];
      const next = points[i + 1];
      const a = prev ?? p;
      const b = next ?? p;
      const pos = a === b || b.t === a.t ? 0 : distanceM(a, b) / ((b.t - a.t) / 1000);
      const dopplerOk = p.speed !== null && p.speed <= MAX_HUMAN_SPEED_MS && !(p.speed <= UNKNOWN_DOPPLER_MS && pos >= BURST_MS);
      return { t: p.t, v: dopplerOk ? p.speed! : pos, accuracy: p.accuracy ?? 0, positional: !dopplerOk };
    })
    .filter((p) => p.v <= MAX_HUMAN_SPEED_MS);
  return raw.map((p, i) => {
    const prev = raw[i - 1];
    const next = raw[i + 1];
    const m = prev && next ? median3(prev.v, p.v, next.v) : prev || next ? Math.min(p.v, (prev ?? next).v) : p.v;
    return { t: p.t, m, accuracy: p.accuracy, positional: p.positional };
  });
}

type CurvePoint = { t: number; m: number };
const lerp = (a: CurvePoint, b: CurvePoint, t: number) => (b.t === a.t ? a.m : a.m + ((b.m - a.m) * (t - a.t)) / (b.t - a.t));

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Distance and top speed of one sprint, from the beep (`startAt`) to «Parar» (`stopAt`). The speed
 * curve is integrated with trapezoids and cut where it drops below walking after its peak, so the
 * steps after braking do not add. `quality` says how far to trust it (PLAN.md §6.8).
 */
export function measureSprint(fixes: SprintFix[], startAt: number, stopAt: number, now: number, lagMs = GPS_LAG_MS): SprintMeasure {
  const series = speedSeries(cleanFixes(fixes));
  const a = startAt + lagMs;
  const b = stopAt + lagMs;
  const before = series.filter((p) => p.t <= a).at(-1);
  const inside = series.filter((p) => p.t > a && p.t < b);
  const after = series.find((p) => p.t >= b);
  const settled = series.some((p) => p.t >= b + TOP_SPEED_TAIL_MS) || now - stopAt >= SETTLE_TIMEOUT_MS;
  if (inside.length < 2) return { distanceM: null, topSpeedMs: null, quality: 'none', settled };

  const top = Math.max(...series.filter((p) => p.t >= a && p.t <= b + TOP_SPEED_TAIL_MS).map((p) => p.m));
  let distance = 0;
  let topSpeed: number | null = null;
  if (top >= BURST_MS) {
    topSpeed = top;
    // The first fix at the top speed of the sprint, and the first one after it back to walking.
    const insideTop = Math.max(...inside.map((p) => p.m));
    const peak = inside.findIndex((p) => p.m === insideTop);
    const tail = inside.findIndex((p, i) => i > peak && p.m < BURST_MS);
    const end = tail < 0 ? b : inside[tail].t;
    const curve: CurvePoint[] = [
      { t: a, m: before ? lerp(before, inside[0], a) : 0 },
      ...inside,
      { t: b, m: after ? lerp(inside[inside.length - 1], after, b) : 0 },
    ];
    for (let i = 1; i < curve.length && curve[i - 1].t < end; i++) {
      const from = curve[i - 1];
      const to = curve[i].t <= end ? curve[i] : { t: end, m: lerp(from, curve[i], end) };
      distance += ((from.m + to.m) / 2) * ((to.t - from.t) / 1000);
    }
  }

  const times = [before?.t ?? a, ...inside.map((p) => p.t), after?.t ?? b];
  const gap = times.some((t, i) => i > 0 && t - times[i - 1] > MAX_GAP_MS);
  const weak =
    medianOf(inside.map((p) => p.accuracy)) > GOOD_ACCURACY_M ||
    gap ||
    inside.filter((p) => p.positional).length > MAX_POSITIONAL_SHARE * inside.length ||
    (!after && settled);
  return { distanceM: distance, topSpeedMs: topSpeed, quality: weak ? 'weak' : 'good', settled };
}

/** A measure per lap; null for the open one. */
export function measureLaps(fixes: SprintFix[], laps: Lap[], now: number): (SprintMeasure | null)[] {
  return laps.map((l) => (l.stopAt === null ? null : measureSprint(fixes, l.startAt, l.stopAt, now)));
}

export function withMeasures(laps: Lap[], measures: (SprintMeasure | null)[]): Lap[] {
  return laps.map((l, i) => {
    const m = measures[i];
    return m ? { ...l, distanceM: m.distanceM, topSpeedMs: m.topSpeedMs, quality: m.quality } : l;
  });
}

export interface LapRow {
  number: number;
  timeMs: number;
  distanceM: number | null;
  topSpeedMs: number | null;
  quality: SprintQuality | null;
  settled: boolean;
}

/** The finished sprints, numbered; with `measures` (live) instead of what was stored at the end. */
export function lapRows(laps: Lap[], measures?: (SprintMeasure | null)[]): LapRow[] {
  const rows: LapRow[] = [];
  laps.forEach((l, i) => {
    if (l.stopAt === null) return;
    const m = measures?.[i];
    rows.push({
      number: rows.length + 1,
      timeMs: l.stopAt - l.startAt,
      distanceM: m ? m.distanceM : l.distanceM,
      topSpeedMs: m ? m.topSpeedMs : l.topSpeedMs,
      quality: m ? m.quality : l.quality,
      settled: m ? m.settled : true,
    });
  });
  return rows;
}

export interface SprintSummary {
  count: number;
  topSpeedMs: number | null;
  fastestIndex: number | null;
  bestTimeMs: number | null;
  bestTimeIndex: number | null;
  totalDistanceM: number | null;
  anyWeak: boolean;
  anyGps: boolean;
}

export function sprintSummary(rows: LapRow[]): SprintSummary {
  let fastestIndex: number | null = null;
  let bestTimeIndex: number | null = null;
  rows.forEach((r, i) => {
    if (r.topSpeedMs !== null && (fastestIndex === null || r.topSpeedMs > rows[fastestIndex].topSpeedMs!)) fastestIndex = i;
    if (bestTimeIndex === null || r.timeMs < rows[bestTimeIndex].timeMs) bestTimeIndex = i;
  });
  const distances = rows.map((r) => r.distanceM).filter((d): d is number => d !== null);
  return {
    count: rows.length,
    topSpeedMs: fastestIndex === null ? null : rows[fastestIndex].topSpeedMs,
    fastestIndex,
    bestTimeMs: bestTimeIndex === null ? null : rows[bestTimeIndex].timeMs,
    bestTimeIndex,
    totalDistanceM: distances.length > 0 ? distances.reduce((sum, d) => sum + d, 0) : null,
    anyWeak: rows.some((r) => r.quality === 'weak'),
    anyGps: rows.some((r) => r.quality === 'good' || r.quality === 'weak'),
  };
}

/** Sprints with a good GPS the straight needs to be compared with: with fewer, one odd reading would be the answer. */
export const COMPARISON_MIN_SPRINTS = 3;

/** The straight the athlete wrote down next to what the GPS measured (1.5.0): nothing is corrected. */
export interface StraightComparison {
  straightM: number;
  /** The median of the sprints with a good GPS, in whole metres, and how many they were; null with too few. */
  gps: { medianM: number; diffM: number; count: number } | null;
}

/**
 * «Si lo sé, que lo estime también, pero así compara»: the length written down and the median of
 * what the GPS measured in the sprints it measured well. Worked out when read, never stored, so a
 * better measurement later (1.5.1) changes it by itself. Null without a straight.
 */
export function straightComparison(rows: readonly Pick<LapRow, 'distanceM' | 'quality'>[], straightM: number | null): StraightComparison | null {
  if (straightM === null) return null;
  const good = rows
    .filter((r) => r.quality === 'good' && r.distanceM !== null)
    .map((r) => r.distanceM!)
    .sort((a, b) => a - b);
  if (good.length < COMPARISON_MIN_SPRINTS) return { straightM, gps: null };
  const mid = good.length >> 1;
  const medianM = Math.round(good.length % 2 === 1 ? good[mid] : (good[mid - 1] + good[mid]) / 2);
  return { straightM, gps: { medianM, diffM: medianM - straightM, count: good.length } };
}

/** Under the GPS figure: «2 m menos · 5 sprints», «3 m más · 4 sprints», «Igual · 6 sprints»; or why there is none. */
export function comparisonCaption(comparison: StraightComparison): string {
  const { gps } = comparison;
  if (!gps) return 'Pocos sprints con buen GPS para comparar';
  const difference = gps.diffM === 0 ? 'Igual' : `${Math.abs(gps.diffM)}${NBSP}m ${gps.diffM < 0 ? 'menos' : 'más'}`;
  return `${difference} · ${sprintsCount(gps.count)}`;
}

/** For Hoy and the history: «6 sprints · máx. 30,6 km/h», or «6 sprints · mejor 11,8 s» without GPS. */
export function formatSprintResult(laps: Lap[]): string {
  const summary = sprintSummary(lapRows(laps));
  const count = sprintsCount(summary.count);
  if (summary.topSpeedMs !== null) return `${count} · máx. ${formatSpeedKmh(summary.topSpeedMs)}`;
  if (summary.bestTimeMs !== null) return `${count} · mejor ${formatSprintTime(summary.bestTimeMs)}`;
  return count;
}

/** The fixes around each finished sprint, compact, so a session can be measured again later. */
export function encodeLapFixes(laps: Lap[], fixes: SprintFix[]): string {
  return JSON.stringify(
    laps
      .filter((l) => l.stopAt !== null)
      .map((l) =>
        fixes
          .filter((f) => f.t >= l.startAt - LAP_FIXES_MARGIN_MS && f.t <= l.stopAt! + LAP_FIXES_MARGIN_MS)
          .map((f) => [
            f.t - l.startAt,
            Math.round(f.lat * 1e6),
            Math.round(f.lon * 1e6),
            f.accuracy === null ? null : Math.round(f.accuracy * 10),
            f.speed === null ? null : Math.round(f.speed * 100),
            f.receivedAt === null ? null : f.receivedAt - f.t,
          ]),
      ),
  );
}

export function decodeLapFixes(json: string | null, laps: Lap[]): SprintFix[][] {
  const closed = closedOf(laps);
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : [];
  } catch {
    return closed.map(() => []);
  }
  if (!Array.isArray(raw)) return closed.map(() => []);
  return closed.map((l, i) => {
    const rows: unknown = raw[i];
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r): r is (number | null)[] => Array.isArray(r) && isNumber(r[0]) && isNumber(r[1]) && isNumber(r[2]))
      .map((r) => {
        const t = l.startAt + (r[0] as number);
        return {
          t,
          lat: (r[1] as number) / 1e6,
          lon: (r[2] as number) / 1e6,
          accuracy: isNumber(r[3]) ? r[3] / 10 : null,
          speed: isNumber(r[4]) ? r[4] / 100 : null,
          receivedAt: isNumber(r[5]) ? t + r[5] : null,
        };
      });
  });
}

export type SprintGps = { state: 'off' | 'searching' | 'unusable' | 'weak' | 'good'; accuracyM: number | null };

/** What the GPS can do for the sprints right now, for the pill in the header. */
export function sprintGps(last: { t: number; accuracy: number | null; receivedAt: number | null } | null, gpsOn: boolean, now: number): SprintGps {
  if (!gpsOn) return { state: 'off', accuracyM: null };
  if (!last || now - (last.receivedAt ?? last.t) > STALE_FIX_MS) return { state: 'searching', accuracyM: null };
  const accuracyM = last.accuracy === null ? null : Math.round(last.accuracy);
  if (last.accuracy === null || last.accuracy > SPRINT_MAX_ACCURACY_M) return { state: 'unusable', accuracyM };
  return { state: last.accuracy > GOOD_ACCURACY_M ? 'weak' : 'good', accuracyM };
}
