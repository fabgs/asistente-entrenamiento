import { formatCountdown, formatSprintTime, NBSP } from './format';
import { distanceM, type LatLon } from './gps';

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
  /**
   * Metres of the straight every sprint is run on, when the athlete knows them (1.5.0). Since the
   * 1.5.2 they are what the session's speeds come from: a straight and a time are worth more than
   * the GPS of a phone over 30 m.
   */
  straightM: number | null;
  /** Its two ends, when it was marked on the map (1.5.2): `straightM` is then the metres between them. */
  straightEnds: StraightEnds | null;
}

export interface StraightEnds {
  start: LatLon;
  end: LatLon;
}

export const DEFAULT_SPRINT_PLAN: SprintPlan = { kind: 'sprint', sprints: 6, restSec: 90, leadSec: 5, straightM: null, straightEnds: null };
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
  /**
   * Straight from the GPS chip (1.5.2). Without it, the fix is Android's fused location, which
   * smooths for someone walking: in a sprint its speed stays near 2 m/s and it runs 2–3 s behind.
   */
  gnss?: boolean;
  /** How far the chip trusts its Doppler speed, m/s. */
  speedAccuracy?: number | null;
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
/** Fixes kept before the beep of each sprint, and after its stop: the curve of a phone runs late and the tail shows how much. */
export const LAP_FIXES_MARGIN_MS = 3_000;
export const LAP_FIXES_TAIL_MS = 8_000;
export const STALE_FIX_MS = 4_000;
/** A sample this far above (or below) both its neighbours is a glitch, not a stride. */
export const SPIKE_MS = 2.5;
/** The speed that says the athlete is off, and how long after the beep a real start takes to reach it. */
export const ONSET_SPEED_MS = 1.5;
export const ONSET_MS = 600;
/** The most the curve is taken to run behind the beep; beyond it, the athlete just started late. */
export const MAX_CURVE_LAG_MS = 1_500;
/** The speed curve and the positions must tell the same distance: within 5 m or a quarter. */
export const MISMATCH_M = 5;
export const MISMATCH_SHARE = 0.25;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parsePlace(v: unknown): LatLon | null {
  const p = v as { lat?: unknown; lon?: unknown } | null;
  return p && isNumber(p.lat) && isNumber(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? { lat: p.lat, lon: p.lon } : null;
}

function parseEnds(v: unknown): StraightEnds | null {
  const ends = v as { start?: unknown; end?: unknown } | null;
  const start = parsePlace(ends?.start);
  const end = parsePlace(ends?.end);
  return start && end ? { start, end } : null;
}

const SIX_DECIMALS = 1e6;
const place = (p: LatLon): LatLon => ({ lat: Math.round(p.lat * SIX_DECIMALS) / SIX_DECIMALS, lon: Math.round(p.lon * SIX_DECIMALS) / SIX_DECIMALS });

/**
 * A straight marked on the map: its ends (to 0,1 m) and the whole metres between them, or null when
 * they are closer or farther than a straight can be.
 */
export function markedStraight(start: LatLon, end: LatLon): Pick<SprintPlan, 'straightM' | 'straightEnds'> | null {
  const ends = { start: place(start), end: place(end) };
  const metres = Math.round(distanceM(ends.start, ends.end));
  return metres >= STRAIGHT_RANGE_M[0] && metres <= STRAIGHT_RANGE_M[1] ? { straightM: metres, straightEnds: ends } : null;
}
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
  const straightM = isNumber(p.straightM) && p.straightM > 0 ? clamp(p.straightM, STRAIGHT_RANGE_M) : null;
  return {
    kind: 'sprint',
    sprints: clamp(p.sprints, SPRINTS_RANGE),
    restSec: clamp(p.restSec, REST_RANGE_S),
    // Plans stored before the 1.5.0 have neither: the count of always and no straight.
    leadSec: isNumber(p.leadSec) ? clamp(p.leadSec, LEAD_RANGE_S) : DEFAULT_SPRINT_PLAN.leadSec,
    straightM,
    // The ends only mean something with their metres.
    straightEnds: straightM === null ? null : parseEnds(p.straightEnds),
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

/**
 * The fixes to measure a sprint with: the chip's when they cover it, otherwise the fused ones
 * (a build without the native module, or the chip's listener lost with its process).
 */
function pickSource(fixes: SprintFix[], a: number, b: number): { fixes: SprintFix[]; gnss: boolean } {
  const gnss = fixes.filter((f) => f.gnss);
  const inside = gnss.filter((f) => f.t > a && f.t < b).length;
  if (inside >= 3 && (b - a) / inside <= MAX_GAP_MS) return { fixes: gnss, gnss: true };
  return { fixes: fixes.filter((f) => !f.gnss), gnss: false };
}

/**
 * Speed of each fix: Doppler when it is believable, from the positions otherwise. A sample far
 * above or below both neighbours is brought to the nearer one; a median would also shave the top
 * of a short sprint, whose peak is a single fix.
 */
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
    const prev = raw[i - 1]?.v;
    const next = raw[i + 1]?.v;
    let m = p.v;
    if (prev !== undefined && next !== undefined) {
      const high = Math.max(prev, next);
      const low = Math.min(prev, next);
      m = p.v > high + SPIKE_MS ? high : p.v < low - SPIKE_MS ? low : p.v;
    } else if (prev !== undefined || next !== undefined) {
      // The first and the last fix have one neighbour: nothing says a drop is a glitch, only a jump.
      m = Math.min(p.v, (prev ?? next)! + SPIKE_MS);
    }
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
 * How far the speed curve runs behind the beep: a start takes about `ONSET_MS` to show, and a curve
 * that takes off later than that is the receiver's filter (or the athlete, late: so it is capped).
 * Nothing when the athlete was already moving at the beep.
 */
function curveLag(series: Speeded[], startAt: number, stopAt: number): number {
  const from = series.filter((p) => p.t <= startAt).at(-1);
  if (from && from.m >= ONSET_SPEED_MS) return 0;
  const window = series.filter((p) => p.t >= (from?.t ?? startAt) && p.t <= stopAt);
  for (let i = 1; i < window.length; i++) {
    const a = window[i - 1];
    const b = window[i];
    if (a.m < ONSET_SPEED_MS && b.m >= ONSET_SPEED_MS) {
      const onset = a.t + ((ONSET_SPEED_MS - a.m) / (b.m - a.m)) * (b.t - a.t);
      return Math.min(MAX_CURVE_LAG_MS, Math.max(0, onset - startAt - ONSET_MS));
    }
  }
  return 0;
}

/** Where the athlete was at `t`, between the two fixes around it; null outside them. */
function positionAt(points: SprintFix[], t: number): { lat: number; lon: number } | null {
  const after = points.findIndex((p) => p.t >= t);
  if (after < 0) return null;
  const b = points[after];
  if (b.t === t || after === 0) return b.t - t <= MAX_GAP_MS ? b : null;
  const a = points[after - 1];
  const k = (t - a.t) / (b.t - a.t);
  return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k };
}

/**
 * Distance and top speed of one sprint, from the beep (`startAt`) to «Parar» (`stopAt`). The speed
 * curve is integrated with trapezoids and cut where it drops below walking after its peak, so the
 * steps after braking do not add. A curve that takes off late is read that much later (`curveLag`).
 * `quality` says how far to trust it (PLAN.md §6.8): never more than weak from the fused location,
 * nor when the positions tell another distance than the speeds.
 */
export function measureSprint(fixes: SprintFix[], startAt: number, stopAt: number, now: number): SprintMeasure {
  const source = pickSource(fixes, startAt, stopAt);
  const points = cleanFixes(source.fixes);
  const series = speedSeries(points);
  const lag = curveLag(series, startAt, stopAt);
  const a = startAt + lag;
  const b = stopAt + lag;
  const before = series.filter((p) => p.t <= a).at(-1);
  const inside = series.filter((p) => p.t > a && p.t < b);
  const after = series.find((p) => p.t >= b);
  const settled = series.some((p) => p.t >= b + TOP_SPEED_TAIL_MS) || now - stopAt >= SETTLE_TIMEOUT_MS;
  if (inside.length < 2) return { distanceM: null, topSpeedMs: null, quality: 'none', settled };

  const top = Math.max(...series.filter((p) => p.t >= a && p.t <= b + TOP_SPEED_TAIL_MS).map((p) => p.m));
  let distance = 0;
  let topSpeed: number | null = null;
  let mismatch = false;
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
    // A sprint is a straight line: from where it started to where it ended must be about as far.
    const from = positionAt(points, a);
    const to = positionAt(points, end);
    if (from && to) {
      const straight = distanceM(from, to);
      mismatch = Math.abs(distance - straight) > Math.max(MISMATCH_M, MISMATCH_SHARE * Math.max(distance, straight));
    }
  }

  const times = [before?.t ?? a, ...inside.map((p) => p.t), after?.t ?? b];
  const gap = times.some((t, i) => i > 0 && t - times[i - 1] > MAX_GAP_MS);
  const weak =
    !source.gnss ||
    mismatch ||
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

/** Speed over the straight: its metres by the time from the beep to «Parar» (1.5.2). */
export const straightSpeedMs = (straightM: number, timeMs: number): number => straightM / (timeMs / 1000);

/** The best time of some sprints and, with a straight, the speed it means; null without sprints. */
export function bestSprint(rows: readonly LapRow[], straightM: number | null): { number: number; timeMs: number; speedMs: number | null } | null {
  const { bestTimeIndex } = sprintSummary([...rows]);
  if (bestTimeIndex === null) return null;
  const best = rows[bestTimeIndex];
  return { number: best.number, timeMs: best.timeMs, speedMs: straightM === null ? null : straightSpeedMs(straightM, best.timeMs) };
}

/**
 * The top speed the GPS gave in a session, to say apart from the figures that count: null when
 * there is none or it is below the speed of the best sprint over the straight (then it is plainly
 * wrong: no one runs a straight faster on average than at their fastest).
 */
export function gpsTopSpeed(rows: readonly LapRow[], straightM: number | null): { speedMs: number; weak: boolean } | null {
  const { fastestIndex } = sprintSummary([...rows]);
  if (fastestIndex === null) return null;
  const fastest = rows[fastestIndex];
  const best = bestSprint(rows, straightM);
  if (best?.speedMs != null && fastest.topSpeedMs! < best.speedMs) return null;
  return { speedMs: fastest.topSpeedMs!, weak: fastest.quality !== 'good' };
}

/** How far from both ends of the straight a fix must be to say it was marked somewhere else. */
export const ELSEWHERE_M = 150;

/** Whether the athlete is (by a good fix) nowhere near the straight marked: another day's place. */
export function straightElsewhere(ends: StraightEnds | null, fix: (LatLon & { accuracy: number | null }) | null): boolean {
  if (!ends || !fix || fix.accuracy === null || fix.accuracy > SPRINT_MAX_ACCURACY_M) return false;
  return distanceM(fix, ends.start) > ELSEWHERE_M && distanceM(fix, ends.end) > ELSEWHERE_M;
}

/**
 * The path of each sprint on the map, from the beep to «Parar», only with fixes of the chip
 * (the fused ones ran 2–3 s behind and would draw another place). A sprint with fewer than two
 * has none.
 */
export function sprintTraces(laps: Lap[], lapFixes: SprintFix[][]): LatLon[][] {
  return closedOf(laps)
    .map((lap, i) =>
      (lapFixes[i] ?? [])
        .filter((f) => f.gnss && f.accuracy !== null && f.accuracy <= SPRINT_MAX_ACCURACY_M && f.t >= lap.startAt && f.t <= lap.stopAt!)
        .map(({ lat, lon }) => ({ lat, lon })),
    )
    .filter((trace) => trace.length >= 2);
}

/** Where some sprints were run: the middle (median) of their usable fixes, to open a map there. */
export function sprintsPlace(lapFixes: SprintFix[][]): LatLon | null {
  const usable = lapFixes.flat().filter((f) => f.accuracy !== null && f.accuracy <= SPRINT_MAX_ACCURACY_M);
  if (usable.length === 0) return null;
  return { lat: medianOf(usable.map((f) => f.lat)), lon: medianOf(usable.map((f) => f.lon)) };
}

/**
 * For Hoy and the history: «6 × 36 m · mejor 7,0 s» with a straight, «6 sprints · mejor 7,0 s»
 * without. Never what the GPS measured (until the 1.5.2, «máx. 30,6 km/h»): over 30 m it is rough.
 */
export function formatSprintResult(laps: Lap[], straightM: number | null = null): string {
  const summary = sprintSummary(lapRows(laps));
  const count = straightM === null ? sprintsCount(summary.count) : `${summary.count} × ${straightM}${NBSP}m`;
  return summary.bestTimeMs === null ? count : `${count} · mejor ${formatSprintTime(summary.bestTimeMs)}`;
}

/**
 * The fixes around each finished sprint, compact, so a session can be measured again later:
 * `[ms from the beep, lat·1e6, lon·1e6, accuracy·10, speed·100, ms it arrived late]`, and for the
 * chip's fixes (1.5.2) two more, `1` and the accuracy of the speed·100.
 */
export function encodeLapFixes(laps: Lap[], fixes: SprintFix[]): string {
  return JSON.stringify(
    laps
      .filter((l) => l.stopAt !== null)
      .map((l) =>
        fixes
          .filter((f) => f.t >= l.startAt - LAP_FIXES_MARGIN_MS && f.t <= l.stopAt! + LAP_FIXES_TAIL_MS)
          .map((f) => {
            const row = [
              f.t - l.startAt,
              Math.round(f.lat * 1e6),
              Math.round(f.lon * 1e6),
              f.accuracy === null ? null : Math.round(f.accuracy * 10),
              f.speed === null ? null : Math.round(f.speed * 100),
              f.receivedAt === null ? null : f.receivedAt - f.t,
            ];
            // The chip's fixes say so, with how far it trusts the speed; the fused ones stay as before the 1.5.2.
            return f.gnss ? [...row, 1, f.speedAccuracy == null ? null : Math.round(f.speedAccuracy * 100)] : row;
          }),
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
          ...(r[6] === 1 ? { gnss: true, speedAccuracy: isNumber(r[7]) ? r[7] / 100 : null } : {}),
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
