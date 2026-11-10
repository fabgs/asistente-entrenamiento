import { formatNumber, NBSP } from './format';
import { distanceM, type LatLon } from './gps';

/**
 * Following a saved route on a walk (PLAN.md §6.8, 1.4.9): where on the route the walker is, and
 * whether they have left it, with hysteresis so that a bend, a bad fix or the GPS drift do not
 * alert. Pure: the GPS task runs it on each batch of fixes and stores the state in the session.
 */

/** A fix counts only with this accuracy or better; the rest are ignored (R1). */
export const GOOD_ACCURACY_M = 20;
/** Closer than this is on the route (R3, R5)… */
export const ON_M = 25;
/** …and farther than this, off it (R4); in between nothing changes. */
export const OFF_M = 40;
const ON_READINGS = 2;
const OFF_READINGS = 3;
/** A longer gap between good fixes (a pause, no signal) restarts the counts (R2). */
const STREAK_GAP_MS = 30_000;
/** Where the walker may be since the last progress: a little back, and ahead what can be walked (R6). */
const WINDOW_BACK_M = 60;
const WINDOW_AHEAD_M = 150;
const MAX_SPEED_MS = 4;
const WALK_SPEED_MS = 1.4;
/** Places on the route this close in distance are a tie, settled by the expected progress. */
const TIE_M = 10;
/** Walked this far one way from where the route was joined, that is its direction (R9). */
const DIRECTION_M = 100;
/** This close to the end, the route is done: no more alerts (R10). */
const END_M = 50;
/** One reminder, this long after leaving the route and this much farther (R11). */
export const REMINDER_MS = 3 * 60_000;
const REMINDER_EXTRA_M = 50;
/** Fixes older than this are late news: the state moves on, but nobody is alerted (R12). */
const STALE_MS = 60_000;

const M_PER_DEG = 111_195;

/** A route (or the same, back to front) in flat metres, with the metres walked to each point. */
interface Path {
  xs: Float64Array;
  ys: Float64Array;
  /** Metres along the route; the joint between two segments adds nothing. */
  along: Float64Array;
}

export interface FollowLine {
  forward: Path;
  backward: Path;
  /** Metres of the route, without the joints between its segments. */
  total: number;
  /** Start and end within 200 m: a loop or an out-and-back. */
  closes: boolean;
  origin: LatLon;
  cos: number;
}

const CLOSES_M = 200;

function pathOf(points: { x: number; y: number; segment: number }[]): Path {
  const path: Path = { xs: new Float64Array(points.length), ys: new Float64Array(points.length), along: new Float64Array(points.length) };
  let along = 0;
  for (const [i, p] of points.entries()) {
    if (i > 0 && points[i - 1].segment === p.segment) along += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
    path.xs[i] = p.x;
    path.ys[i] = p.y;
    path.along[i] = along;
  }
  return path;
}

/**
 * The route in metres around its start. Segments are joined by a straight joint that counts for the
 * distance to the route but adds no progress, so the total is the route's distance.
 */
export function buildFollowLine(segments: LatLon[][]): FollowLine {
  const kept = segments.filter((s) => s.length > 0);
  const origin = kept[0]?.[0] ?? { lat: 0, lon: 0 };
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  const points = kept.flatMap((s, segment) =>
    s.map((p) => ({ x: (p.lon - origin.lon) * cos * M_PER_DEG, y: (p.lat - origin.lat) * M_PER_DEG, segment })),
  );
  const forward = pathOf(points);
  const backward = pathOf([...points].reverse());
  const first = kept[0]?.[0];
  const last = kept.at(-1)?.at(-1);
  return {
    forward,
    backward,
    total: forward.along.length > 0 ? forward.along[forward.along.length - 1] : 0,
    closes: !!first && !!last && distanceM(first, last) <= CLOSES_M,
    origin,
    cos,
  };
}

interface Projection {
  distance: number;
  along: number;
}

/** Where `x, y` falls on segment `i` of `path`: its fraction and the squared distance to it. */
function onSegment(path: Path, i: number, x: number, y: number): { t: number; d2: number } {
  const ax = path.xs[i];
  const ay = path.ys[i];
  const dx = path.xs[i + 1] - ax;
  const dy = path.ys[i + 1] - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
  const ex = x - (ax + t * dx);
  const ey = y - (ay + t * dy);
  return { t, d2: ex * ex + ey * ey };
}

/** First segment whose end is at or past `lo` metres (the metres never go down). */
function firstSegment(path: Path, lo: number): number {
  let a = 0;
  let b = path.along.length - 1;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (path.along[mid] < lo) a = mid + 1;
    else b = mid;
  }
  return Math.max(0, a - 1);
}

/** The closest place on each segment of `path` within [lo, hi] metres (all of it by default). */
function projections(path: Path, x: number, y: number, lo = -Infinity, hi = Infinity): Projection[] {
  const found: Projection[] = [];
  const n = path.xs.length;
  if (n === 1) return [{ distance: Math.sqrt((x - path.xs[0]) ** 2 + (y - path.ys[0]) ** 2), along: 0 }];
  for (let i = lo === -Infinity ? 0 : firstSegment(path, lo); i < n - 1 && path.along[i] <= hi; i++) {
    const { t, d2 } = onSegment(path, i, x, y);
    const along = path.along[i] + t * (path.along[i + 1] - path.along[i]);
    if (along >= lo && along <= hi) found.push({ distance: Math.sqrt(d2), along });
  }
  return found;
}

/** Metres to the closest place of the whole path, without building anything (it runs on every fix). */
function nearestDistance(path: Path, x: number, y: number): number {
  const { xs, ys } = path;
  const n = xs.length;
  if (n === 1) return Math.sqrt((x - xs[0]) * (x - xs[0]) + (y - ys[0]) * (y - ys[0]));
  let best = Infinity;
  for (let i = 0; i < n - 1; i++) {
    const ax = xs[i];
    const ay = ys[i];
    const dx = xs[i + 1] - ax;
    const dy = ys[i + 1] - ay;
    const length2 = dx * dx + dy * dy;
    let t = length2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / length2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - ax - t * dx;
    const ey = y - ay - t * dy;
    const d2 = ex * ex + ey * ey;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Of the places within `TIE_M` of the closest, the one nearest to `target` metres along. */
function pick(found: Projection[], target: number, within = Infinity): Projection | null {
  const best = Math.min(...found.map((f) => f.distance));
  if (!(best <= within)) return null;
  return found.filter((f) => f.distance < best + TIE_M).reduce((a, b) => (Math.abs(b.along - target) < Math.abs(a.along - target) ? b : a));
}

/** Progress along one direction of the route. */
interface Track {
  /** Metres along this direction. */
  p: number;
  /** Where this track joined (or rejoined) the route, to tell the direction (R9). */
  from: number;
  /** When `p` last moved forward or was set, for the window (R6). */
  at: number;
  /** Close fixes in a row outside the window: two make it rejoin (R7). */
  far: number;
}

export type FollowStatus = 'approach' | 'on' | 'off' | 'done';

/** What is stored in the session (`cardio_session.follow_state`), as JSON. */
export interface FollowState {
  v: 1;
  status: FollowStatus;
  /** 1 the way the route was saved, -1 back to front, 0 not known yet (both are followed). */
  dir: 1 | -1 | 0;
  /** The direction taken until one is known, and on a tie. */
  initial: 1 | -1;
  forward: Track | null;
  backward: Track | null;
  /** Good fixes in a row closer than ON_M, and farther than OFF_M. */
  inN: number;
  outN: number;
  /** The last fix looked at, of any quality, and the last good one. */
  lastT: number | null;
  lastGoodT: number | null;
  /** Metres to the route at the last good fix. */
  gap: number | null;
  /** When the walker left the route, and how far they were then. */
  offAt: number | null;
  offGap: number | null;
  /** Whether this time off the route was alerted, and reminded. */
  alerted: boolean;
  reminded: boolean;
}

export interface FollowFix extends LatLon {
  t: number;
  accuracy: number | null;
}

export type FollowEvent = 'off' | 'reminder' | 'back';

export const initialFollowState = (): FollowState => ({
  v: 1,
  status: 'approach',
  dir: 0,
  initial: 1,
  forward: null,
  backward: null,
  inN: 0,
  outN: 0,
  lastT: null,
  lastGoodT: null,
  gap: null,
  offAt: null,
  offGap: null,
  alerted: false,
  reminded: false,
});

export function parseFollowState(json: string | null): FollowState | null {
  if (!json) return null;
  try {
    const state = JSON.parse(json) as FollowState;
    return state?.v === 1 ? state : null;
  } catch {
    return null;
  }
}

/** The track of the direction being shown: the known one, or the initial one until then. */
const shownTrack = (s: FollowState) => ((s.dir || s.initial) === 1 ? s.forward : s.backward);

/** Moves a track with a close fix: within its window, or rejoining after two close fixes outside it. */
function moveTrack(track: Track, path: Path, x: number, y: number, t: number, distance: number): Track {
  const seconds = Math.max(0, (t - track.at) / 1000);
  const lo = track.p - WINDOW_BACK_M;
  const hi = track.p + WINDOW_AHEAD_M + MAX_SPEED_MS * seconds;
  const place = pick(projections(path, x, y, lo, hi), track.p + WALK_SPEED_MS * seconds, OFF_M);
  if (place) {
    return { ...track, p: place.along, at: place.along > track.p ? t : track.at, far: 0 };
  }
  if (distance >= ON_M) return { ...track, far: 0 };
  if (track.far + 1 < ON_READINGS) return { ...track, far: track.far + 1 };
  const rejoin = pick(projections(path, x, y), track.p)!;
  return { p: rejoin.along, from: rejoin.along, at: t, far: 0 };
}

/** Joins the route: the place with the fewest metres among those closer than ON_M (R8). */
function join(path: Path, x: number, y: number, t: number): Track {
  const close = projections(path, x, y).filter((f) => f.distance < ON_M);
  const along = Math.min(...close.map((f) => f.along));
  return { p: along, from: along, at: t, far: 0 };
}

const toXY = (line: FollowLine, p: LatLon) => ({
  x: (p.lon - line.origin.lon) * line.cos * M_PER_DEG,
  y: (p.lat - line.origin.lat) * M_PER_DEG,
});

/** Metres from `p` to the closest place of the whole route. */
export function distanceToRoute(line: FollowLine, p: LatLon): number {
  const { x, y } = toXY(line, p);
  return nearestDistance(line.forward, x, y);
}

/** One good fix through the rules R2–R10. */
function stepFix(line: FollowLine, state: FollowState, fix: FollowFix): FollowState {
  const s = { ...state };
  const { x, y } = toXY(line, fix);
  const distance = nearestDistance(line.forward, x, y);
  if (s.lastGoodT !== null && fix.t - s.lastGoodT > STREAK_GAP_MS) {
    s.inN = 0;
    s.outN = 0;
    if (s.forward) s.forward = { ...s.forward, far: 0 };
    if (s.backward) s.backward = { ...s.backward, far: 0 };
  }
  s.lastGoodT = fix.t;
  s.gap = distance;
  if (s.status === 'done') return s;

  if (s.status === 'approach') {
    s.inN = distance < ON_M ? s.inN + 1 : 0;
    if (s.inN < ON_READINGS) return s;
    s.status = 'on';
    s.inN = 0;
    s.forward = join(line.forward, x, y, fix.t);
    s.backward = join(line.backward, x, y, fix.t);
    // From one place to another, the end it is joined closer to says the way; a loop starts its own way.
    const toStart = Math.hypot(x - line.forward.xs[0], y - line.forward.ys[0]);
    const toEnd = Math.hypot(x - line.backward.xs[0], y - line.backward.ys[0]);
    s.initial = !line.closes && toEnd < toStart ? -1 : 1;
    return s;
  }

  // Until the direction is known both are followed; then only that one is left.
  if (s.forward) s.forward = moveTrack(s.forward, line.forward, x, y, fix.t, distance);
  if (s.backward) s.backward = moveTrack(s.backward, line.backward, x, y, fix.t, distance);
  if (s.dir === 0) {
    const ahead = !!s.forward && s.forward.p - s.forward.from >= DIRECTION_M;
    const back = !!s.backward && s.backward.p - s.backward.from >= DIRECTION_M;
    if (ahead || back) {
      s.dir = ahead && back ? s.initial : ahead ? 1 : -1;
      if (s.dir === 1) s.backward = null;
      else s.forward = null;
    }
  }

  if (s.status === 'on') {
    s.outN = distance > OFF_M ? s.outN + 1 : 0;
    if (s.outN >= OFF_READINGS) {
      s.status = 'off';
      s.outN = 0;
      s.inN = 0;
      s.offAt = fix.t;
      s.offGap = distance;
    }
  } else if (s.status === 'off') {
    if (distance < ON_M) s.inN += 1;
    else if (distance > OFF_M) s.inN = 0;
    if (s.inN >= ON_READINGS) {
      s.status = 'on';
      s.inN = 0;
      s.offAt = null;
      s.offGap = null;
    }
  }
  const track = shownTrack(s);
  if (s.status === 'on' && track && s.dir !== 0 && track.p >= line.total - END_M) s.status = 'done';
  return s;
}

/**
 * Runs a batch of fixes (as they reach the GPS task) through the rules and says whether to alert.
 * At most one event per batch, from where the batch leaves the walker (R12); none with the alert
 * off (R13) or when the last fix is older than STALE_MS, which then waits for the next fresh batch.
 */
export function followStep(
  line: FollowLine,
  previous: FollowState | null,
  fixes: FollowFix[],
  now: number,
  alertOn: boolean,
): { state: FollowState; event: FollowEvent | null } {
  let state = previous ?? initialFollowState();
  for (const fix of [...fixes].sort((a, b) => a.t - b.t)) {
    if (state.lastT !== null && fix.t <= state.lastT) continue;
    state = { ...state, lastT: fix.t };
    if (fix.accuracy === null || fix.accuracy > GOOD_ACCURACY_M) continue;
    state = stepFix(line, state, fix);
  }
  const fresh = state.lastT !== null && now - state.lastT <= STALE_MS;
  let event: FollowEvent | null = null;
  if (state.status === 'off') {
    if (!state.alerted && alertOn && fresh) {
      event = 'off';
      state = { ...state, alerted: true };
    } else if (
      state.alerted &&
      !state.reminded &&
      alertOn &&
      fresh &&
      state.offAt !== null &&
      state.lastT! - state.offAt >= REMINDER_MS &&
      (state.gap ?? 0) >= (state.offGap ?? 0) + REMINDER_EXTRA_M
    ) {
      event = 'reminder';
      state = { ...state, reminded: true };
    }
  } else if (state.alerted) {
    if (!alertOn) state = { ...state, alerted: false, reminded: false };
    else if (fresh) {
      event = 'back';
      state = { ...state, alerted: false, reminded: false };
    }
  }
  return { state, event };
}

export type FollowViewKind = 'waiting' | 'approach' | 'on' | 'off' | 'done';

export interface FollowView {
  kind: FollowViewKind;
  /** Metres along the route and left of it (on, done), or to the route (approach, off). */
  doneM: number;
  leftM: number;
  gapM: number;
  totalM: number;
}

/** What the screen shows of a followed route: where on it, how far from it. */
export function followView(state: FollowState | null, line: FollowLine): FollowView {
  const totalM = line.total;
  const track = state ? shownTrack(state) : null;
  const doneM = state?.status === 'done' ? totalM : Math.min(totalM, Math.max(0, track?.p ?? 0));
  const base = { doneM, leftM: totalM - doneM, gapM: state?.gap ?? 0, totalM };
  if (!state || state.gap === null) return { ...base, kind: 'waiting' };
  return { ...base, kind: state.status === 'approach' ? 'approach' : state.status };
}

/**
 * What is left of a followed route, to draw it (1.4.10): the part behind the walker goes away as
 * they walk it, the same metres the line under the figures counts. All of it until the way round is
 * known (hiding the wrong half would hide what is ahead), and nothing once at its end. `segments`
 * are the ones `line` was built from.
 */
export function routeAhead(segments: LatLon[][], line: FollowLine, state: FollowState | null): LatLon[][] {
  if (!state || state.status === 'approach' || state.dir === 0) return segments;
  if (state.status === 'done') return [];
  const track = shownTrack(state);
  if (!track) return segments;
  // In metres the way the route was saved: from the walker to its end, or from its start to the walker.
  const lo = state.dir === 1 ? track.p : -Infinity;
  const hi = state.dir === 1 ? Infinity : line.total - track.p;
  const ahead: LatLon[][] = [];
  let along = 0;
  for (const segment of segments) {
    const kept: LatLon[] = [];
    for (let i = 0; i + 1 < segment.length; i++) {
      const a = toXY(line, segment[i]);
      const b = toXY(line, segment[i + 1]);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const from = Math.max(lo, along);
      const to = Math.min(hi, along + length);
      if (length > 0 && from < to) {
        const cut = (m: number): LatLon => {
          const t = (m - along) / length;
          return t <= 0
            ? segment[i]
            : t >= 1
              ? segment[i + 1]
              : { lat: segment[i].lat + t * (segment[i + 1].lat - segment[i].lat), lon: segment[i].lon + t * (segment[i + 1].lon - segment[i].lon) };
        };
        if (kept.length === 0) kept.push(cut(from));
        kept.push(cut(to));
      }
      along += length;
    }
    if (kept.length > 1) ahead.push(kept);
  }
  return ahead;
}

/** «60 m» (to tens) under a kilometre, «2,3 km» from there. */
export function shortDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres / 10) * 10}${NBSP}m` : `${formatNumber(metres / 1000, 1)}${NBSP}km`;
}

const km = (metres: number) => formatNumber(Math.round(metres / 100) / 10, 1);

/** The line under the figures while following «Ver hormigas». */
export function followText(view: FollowView, name: string): string {
  switch (view.kind) {
    case 'waiting':
      return `${name} · ${km(view.totalM)}${NBSP}km`;
    case 'approach':
      return `A ${shortDistance(view.gapM)} de la ruta`;
    case 'on':
      return `${km(view.doneM)} de ${km(view.totalM)}${NBSP}km · quedan ${km(view.leftM)}`;
    case 'off':
      return `Fuera de la ruta · a ${shortDistance(view.gapM)}`;
    case 'done':
      return `Final de la ruta · ${km(view.totalM)}${NBSP}km`;
  }
}

/** Title and text of the notification of an event. */
export function followNotice(event: FollowEvent, view: FollowView, name: string): { title: string; body: string } {
  switch (event) {
    case 'off':
      return { title: 'Te has salido de la ruta', body: `Estás a ${shortDistance(view.gapM)} de «${name}».` };
    case 'reminder':
      return { title: 'Sigues fuera de la ruta', body: `Estás a ${shortDistance(view.gapM)} de «${name}».` };
    case 'back':
      return { title: 'De vuelta en la ruta', body: `Quedan ${km(view.leftM)}${NBSP}km de «${name}».` };
  }
}
