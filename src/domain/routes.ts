import { formatClock, formatNumber, NBSP } from './format';
import { distanceM, pathLengthM, type LatLon } from './gps';
import { countOf } from './progress';
import { fixed } from './walkStats';

/**
 * Whether a walk repeats a saved route (PLAN.md §13, fase 25): a cheap filter on where it starts and
 * ends and how long it is, and then its shape on a grid of cells about the size of the GPS error.
 */

/** Start and end of a walk this close to those of a route (either way round) may be the same route. */
export const ENDPOINT_RADIUS_M = 200;
/** How much the distances of the same route may differ (GPS, a corner cut). */
export const SAME_DISTANCE_TOLERANCE = 0.15;
/** A variant may be this much longer or shorter (a detour). */
export const VARIANT_DISTANCE_TOLERANCE = 0.35;
/** Side of the cells a route is drawn on. */
export const CELL_M = 25;
/** Share of each route lying on the other (with one cell of margin) from which they are the same. */
export const SAME_OVERLAP = 0.85;
/** From this share and below SAME_OVERLAP, one is a variant of the other. */
export const VARIANT_OVERLAP = 0.5;
/** Points each route is reduced to when telling its direction. */
const DIRECTION_POINTS = 60;
/**
 * The other direction must fit this much better, and by more than a cell, to be taken: an
 * out-and-back on one street fits both ways within the GPS error.
 */
const DIRECTION_MARGIN = 0.7;

export type RouteMatchKind = 'same' | 'reverse' | 'variant' | 'none';

export interface RouteMatch {
  kind: RouteMatchKind;
  /** Walked the other way round (also for a variant). */
  reversed: boolean;
  /** Smaller of the two shares, 0–1. */
  overlap: number;
}

const NO_MATCH: RouteMatch = { kind: 'none', reversed: false, overlap: 0 };

interface XY {
  x: number;
  y: number;
}

const M_PER_DEG = 111_195;

/** Flat metres around `origin`: plenty for a few kilometres. */
function projector(origin: LatLon): (p: LatLon) => XY {
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  return (p) => ({ x: (p.lon - origin.lon) * cos * M_PER_DEG, y: (p.lat - origin.lat) * M_PER_DEG });
}

const nonEmpty = (segments: LatLon[][]) => segments.filter((s) => s.length > 0);

export const routeLengthM = (segments: LatLon[][]) => segments.reduce((sum, s) => sum + pathLengthM(s), 0);

export function routeEnds(segments: LatLon[][]): { start: LatLon; end: LatLon } | null {
  const kept = nonEmpty(segments);
  if (kept.length === 0) return null;
  return { start: kept[0][0], end: kept.at(-1)!.at(-1)! };
}

const cellKey = ({ x, y }: XY) => `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`;

/**
 * Points every third of a cell along the route, so no cell is skipped, each with the metres it
 * stands for. A pause's gap is not walked.
 */
function walkSteps(segments: LatLon[][], project: (p: LatLon) => XY, visit: (p: XY, metres: number) => void): void {
  for (const segment of segments) {
    const points = segment.map(project);
    if (points.length > 0) visit(points[0], 0);
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(length / (CELL_M / 3)));
      for (let k = 1; k <= steps; k++) visit({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }, length / steps);
    }
  }
}

function cellsOf(segments: LatLon[][], project: (p: LatLon) => XY): Set<string> {
  const cells = new Set<string>();
  walkSteps(segments, project, (p) => cells.add(cellKey(p)));
  return cells;
}

/** Whether `cells` has a cell at most one cell away from `cell` (the GPS error). */
function nearCells(cell: string, cells: Set<string>): boolean {
  const [x, y] = cell.split(',').map(Number);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) if (cells.has(`${x + dx},${y + dy}`)) return true;
  }
  return false;
}

/** Share of the cells of `a` that have a cell of `b` at most one cell away. */
function coverage(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let near = 0;
  for (const cell of a) if (nearCells(cell, b)) near++;
  return near / a.size;
}

/** `count` points evenly spaced along the route, pauses joined (only its shape matters here). */
function resample(points: XY[], count: number): XY[] {
  if (points.length < 2) return points;
  const steps = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = steps.reduce((sum, s) => sum + s, 0);
  if (total === 0) return [points[0]];
  const out: XY[] = [];
  let i = 0;
  let walked = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    while (i < steps.length - 1 && walked + steps[i] < target) walked += steps[i++];
    const f = steps[i] > 0 ? Math.min(1, Math.max(0, (target - walked) / steps[i])) : 0;
    out.push({ x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f });
  }
  return out;
}

/** Mean distance between two routes followed in order (dynamic time warping): low when they go the same way. */
function orderedGap(a: XY[], b: XY[]): number {
  let prev = new Float64Array(b.length + 1).fill(Infinity);
  prev[0] = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Float64Array(b.length + 1).fill(Infinity);
    for (let j = 1; j <= b.length; j++) {
      const cost = Math.hypot(a[i - 1].x - b[j - 1].x, a[i - 1].y - b[j - 1].y);
      cur[j] = cost + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length] / (a.length + b.length);
}

/**
 * Whether `walk` repeats `route`: `same`, `reverse` (the same, the other way round), `variant` (they
 * share between half and most of their way: the user decides) or `none`. A loop or an out-and-back
 * passes the start and end filter both ways round; then the order in which the walk visits the
 * route tells the direction, and an out-and-back on the same path stays `same`.
 */
export function routeMatch(walk: LatLon[][], route: LatLon[][]): RouteMatch {
  const walkEnds = routeEnds(walk);
  const routeEnd = routeEnds(route);
  if (!walkEnds || !routeEnd) return NO_MATCH;
  const near = (a: LatLon, b: LatLon) => distanceM(a, b) <= ENDPOINT_RADIUS_M;
  const forward = near(walkEnds.start, routeEnd.start) && near(walkEnds.end, routeEnd.end);
  const backward = near(walkEnds.start, routeEnd.end) && near(walkEnds.end, routeEnd.start);
  if (!forward && !backward) return NO_MATCH;

  const walkM = routeLengthM(walk);
  const routeM = routeLengthM(route);
  if (routeM === 0) return NO_MATCH;
  const difference = Math.abs(walkM - routeM) / routeM;
  if (difference > VARIANT_DISTANCE_TOLERANCE) return NO_MATCH;

  const project = projector(routeEnd.start);
  const walkCells = cellsOf(nonEmpty(walk), project);
  const routeCells = cellsOf(nonEmpty(route), project);
  const overlap = Math.min(coverage(walkCells, routeCells), coverage(routeCells, walkCells));
  if (overlap < VARIANT_OVERLAP) return { ...NO_MATCH, overlap };

  let reversed = !forward;
  if (forward && backward) {
    const walkLine = resample(nonEmpty(walk).flat().map(project), DIRECTION_POINTS);
    const routeLine = resample(nonEmpty(route).flat().map(project), DIRECTION_POINTS);
    const ahead = orderedGap(walkLine, routeLine);
    const back = orderedGap(walkLine, [...routeLine].reverse());
    reversed = back < DIRECTION_MARGIN * ahead && ahead - back > CELL_M;
  }
  const same = overlap >= SAME_OVERLAP && difference <= SAME_DISTANCE_TOLERANCE;
  return { kind: same ? (reversed ? 'reverse' : 'same') : 'variant', reversed, overlap };
}

export type RouteRelation = 'same' | 'reverse' | 'variant';

/** Start and end of the route close together: a loop or an out-and-back. */
export function routeCloses(route: LatLon[][]): boolean {
  const ends = routeEnds(route);
  return !!ends && distanceM(ends.start, ends.end) <= ENDPOINT_RADIUS_M;
}

/** The route a walk repeats: one walked the same way or back wins over a variant, then the larger overlap. */
export function bestRouteMatch<T>(candidates: { item: T; match: RouteMatch }[]): { item: T; match: RouteMatch } | null {
  const rank = (m: RouteMatch) => (m.kind === 'variant' ? 1 : 0);
  const found = candidates
    .filter((c) => c.match.kind !== 'none')
    .sort((a, b) => rank(a.match) - rank(b.match) || b.match.overlap - a.match.overlap);
  return found[0] ?? null;
}

/**
 * Farther than this from the route's start or end, with this much unrecorded between pauses or
 * this much off the route, a walk does not compete for the best time: it would make it false.
 */
export const OFF_ROUTE_M = 100;

/** Why a walk of a route does not compete for its best time. */
export interface Exclusion {
  kind: 'start' | 'end' | 'gap' | 'off';
  /** Rounded to 10 m. */
  m: number;
}

const round10 = (m: number) => Math.round(m / 10) * 10;

/** Metres of the walk farther than a cell or so from the route: a detour, or a spur and back. */
function metresOffRoute(walk: LatLon[][], route: LatLon[][], project: (p: LatLon) => XY): number {
  const routeCells = cellsOf(route, project);
  let off = 0;
  walkSteps(walk, project, (p, metres) => {
    if (!nearCells(cellKey(p), routeCells)) off += metres;
  });
  return off;
}

/** The first reason, if any, why a walk linked to a route does not compete for its best time. Variants never do. */
export function exclusionOf(walk: LatLon[][], route: LatLon[][], relation: RouteRelation): Exclusion | null {
  const walkEnds = routeEnds(walk);
  const routeEnd = routeEnds(route);
  if (relation === 'variant' || !walkEnds || !routeEnd) return null;
  const [from, to] = relation === 'reverse' ? [routeEnd.end, routeEnd.start] : [routeEnd.start, routeEnd.end];
  const start = distanceM(walkEnds.start, from);
  if (start > OFF_ROUTE_M) return { kind: 'start', m: round10(start) };
  const end = distanceM(walkEnds.end, to);
  if (end > OFF_ROUTE_M) return { kind: 'end', m: round10(end) };
  const kept = nonEmpty(walk);
  let gap = 0;
  for (let i = 1; i < kept.length; i++) gap += distanceM(kept[i - 1].at(-1)!, kept[i][0]);
  if (gap > OFF_ROUTE_M) return { kind: 'gap', m: round10(gap) };
  const off = metresOffRoute(kept, nonEmpty(route), projector(routeEnd.start));
  if (off > OFF_ROUTE_M) return { kind: 'off', m: round10(off) };
  return null;
}

/** One walk of a route, as its screens compare it. */
export interface RouteTime {
  sessionId: number;
  startedAt: number;
  date: string;
  /** Without pauses: the «Tiempo» of the walk. */
  activeMs: number;
  distanceM: number | null;
  relation: RouteRelation;
  /** Why it does not compete for the best; null for a variant (it never does) and for one that does. */
  exclusion: Exclusion | null;
}

export const competes = (t: RouteTime) => t.relation !== 'variant' && t.exclusion === null;

/**
 * Walks that compete with each other: on a route that closes, the same way and back together; on
 * one from a place to another, back only with back (its climbs are the descents).
 */
const groupOf = (t: RouteTime, closes: boolean) => (t.relation === 'reverse' && !closes ? 'reverse' : 'main');

/** Differences smaller than this are the taps of the start and the end, not the walker. */
export const SAME_TIME_MS = 15_000;

export interface Comparison {
  /** Negative: faster. */
  diffMs: number;
  /** Against the best of two or more earlier walks, or the only earlier one. */
  against: 'best' | 'other';
}

/** Against the best of the earlier walks that compete with it: a later, faster walk does not change what an earlier one says. */
export function compareWithEarlier(time: RouteTime, times: RouteTime[], closes: boolean): Comparison | null {
  if (!competes(time)) return null;
  const earlier = times.filter(
    (t) => t.sessionId !== time.sessionId && t.startedAt < time.startedAt && competes(t) && groupOf(t, closes) === groupOf(time, closes),
  );
  if (earlier.length === 0) return null;
  const best = Math.min(...earlier.map((t) => t.activeMs));
  return { diffMs: time.activeMs - best, against: earlier.length === 1 ? 'other' : 'best' };
}

/** «3.ª vez»: the walks of any kind done before it, plus one. */
export const ordinalOf = (time: RouteTime, times: RouteTime[]) =>
  1 + times.filter((t) => t.sessionId !== time.sessionId && t.startedAt < time.startedAt).length;

const EXCLUSION_TEXT: Record<Exclusion['kind'], (m: string) => string> = {
  start: (m) => `empieza a ${m}`,
  end: (m) => `acaba a ${m}`,
  gap: (m) => `${m} sin grabar`,
  off: (m) => `${m} fuera de la ruta`,
};

/** «No cuenta para el mejor: empieza a 150 m». */
export const exclusionText = (e: Exclusion) => `No cuenta para el mejor: ${EXCLUSION_TEXT[e.kind](`${e.m}${NBSP}m`)}`;

const RELATION_SUFFIX: Record<RouteRelation, string> = { same: '', reverse: ' · al revés', variant: ' · variante' };

/**
 * The row of a walk's route: «3.ª vez · al revés» and, under it, how it went against the earlier
 * ones («2:10 más rápido que tu mejor», «Igual que la otra vez») or why it does not compete.
 */
export function visitLines(time: RouteTime, times: RouteTime[], closes: boolean): { first: string; second: string | null } {
  const first = `${ordinalOf(time, times)}.ª vez${RELATION_SUFFIX[time.relation]}`;
  if (time.exclusion) return { first, second: exclusionText(time.exclusion) };
  const comparison = compareWithEarlier(time, times, closes);
  if (!comparison) return { first, second: null };
  const against = comparison.against === 'best' ? 'tu mejor' : 'la otra vez';
  const { diffMs } = comparison;
  if (Math.abs(diffMs) < SAME_TIME_MS) return { first, second: `Igual que ${against}` };
  return { first, second: `${formatClock(Math.abs(diffMs))} más ${diffMs < 0 ? 'rápido' : 'lento'} que ${against}` };
}

/** Best and latest of the walks that compete in the route's own direction, and those walks in order for its chart. */
export function routeRecords(times: RouteTime[], closes: boolean): { best: RouteTime | null; last: RouteTime | null; chart: RouteTime[] } {
  const chart = times.filter((t) => competes(t) && groupOf(t, closes) === 'main').sort((a, b) => a.startedAt - b.startedAt);
  const best = chart.reduce<RouteTime | null>((b, t) => (!b || t.activeMs < b.activeMs ? t : b), null);
  return { best, last: chart.at(-1) ?? null, chart };
}

/** «5,14 km». */
export const routeKm = (metres: number) => `${fixed(metres / 1000, 2)}${NBSP}km`;

/**
 * «5,14 km · desnivel +48 m» (`short`: «5,14 km · +48 m», for a row with a figure beside it),
 * without the climb when the GPS gave no altitude.
 */
export const routeFacts = (distanceM: number, climbM: number | null, short = false) =>
  climbM === null
    ? routeKm(distanceM)
    : `${routeKm(distanceM)} · ${short ? '' : 'desnivel '}+${Math.round(climbM)}${NBSP}m`;

/** The name offered when saving a walk as a route: its own title, or «Ruta de 5,1 km». */
export const defaultRouteName = (title: string | null, distanceM: number) =>
  title?.trim() || `Ruta de ${formatNumber(distanceM / 1000, 1)}${NBSP}km`;

/** The question about a walk that seems to repeat a route, with the overlap of a variant. */
export function routeQuestion(name: string, match: RouteMatch, walkM: number, routeM: number): { title: string; detail: string | null } {
  if (match.kind === 'variant') {
    return {
      title: `¿Es una variante de «${name}»?`,
      detail: `Coincide el ${Math.round(match.overlap * 100)}${NBSP}% del recorrido · ${routeKm(walkM)} frente a ${routeKm(routeM)}`,
    };
  }
  return { title: match.kind === 'reverse' ? `¿Es tu ruta «${name}», al revés?` : `¿Es tu ruta «${name}»?`, detail: null };
}

/** For «Seguir una ruta»: the one walked or saved most recently first (a GPX just imported, on top). */
export function recentFirst<T extends { lastAt: number | null; route: { createdAt: number } }>(items: T[]): T[] {
  const when = (item: T) => Math.max(item.lastAt ?? 0, item.route.createdAt);
  return [...items].sort((a, b) => when(b) - when(a));
}

/** «4 veces · la última el 9 nov», «1 vez · el 9 nov» or «Sin caminatas». */
export function timesLine(count: number, lastDate: string | null): string {
  if (count === 0 || !lastDate) return 'Sin caminatas';
  // «9 nov» never split over two lines.
  const date = lastDate.replaceAll(' ', NBSP);
  return count === 1 ? `1 vez · el ${date}` : `${countOf(count, 'vez', 'veces')} · la última el ${date}`;
}
