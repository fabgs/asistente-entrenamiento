import { NBSP } from './format';
import { distanceM, type LatLon } from './gps';
import { calendarDaysBetween } from './muscles';
import { countOf } from './progress';
import { formatRecordDate } from './records';
import { CELL_M } from './routes';

/**
 * Mapa de calor (PLAN.md §6.8, 1.4.10): the paths walked, redder the more they are walked. Pure.
 * The ground is a grid of 25 m cells; each walk counts once in the cells its line passes within
 * 10 m of (there and back along a street, or two laps, is still one walk). «Últimos 30 días» weighs
 * each walk by how recent it is, so a path left alone fades back to grey; «Siempre» counts them all.
 * What is drawn is one line per path, with the trace of the latest walk that went along it.
 */

export type HeatMode = 'recent' | 'always';

export const HEAT_MODES: { value: HeatMode; label: string }[] = [
  { value: 'recent', label: 'Últimos 30 días' },
  { value: 'always', label: 'Siempre' },
];

/** A walk weighs 1 today and nothing from this many days on, in a straight line. */
export const HEAT_WINDOW_DAYS = 30;
/** Heat (the sum of the weights) from which a path is at levels 2, 3 and 4: once a week, two to four times a week, five or more. */
export const RECENT_CUTS = [1.5, 3.3, 10] as const;
/** In «Siempre», the share of the most walked path from which a path is at levels 2, 3 and 4. */
const ALWAYS_SHARES = [0.1, 0.2, 0.6] as const;

/** A walk counts in the cells within this of its line: two passes along a street add up, a parallel street 35 m away never does. */
const MARGIN_M = 10;
/** The line is looked at every this many metres. */
const STEP_M = 5;
/** Two fixes further apart than this are not joined: a gap in the recording, not a path. */
const JOIN_MAX_M = 60;
/** A shorter recording is not a walk. */
const MIN_WALK_M = 100;
/**
 * A path already has its line where one was drawn within about this (a finer grid than the cells:
 * the GPS of two walks along one street differs by more than the margin, and each would leave its
 * own stray line).
 */
const COVER_M = 15;
const COVER_CELL_M = 5;
/** A place the walker covered this far back along the walk is a path they have come back to. */
const OWN_TRAIL_M = 60;
/** Two new stretches this close are one (standing at a light, the GPS wanders inside a cell). */
const BRIDGE_M = 40;
/** A new stretch shorter than this is a stray end of the GPS: not drawn. */
const MIN_STRETCH_M = 40;
/** A new stretch runs this far over the path it joins, so the lines meet. */
const OVERLAP_M = 25;
/** A change of level shorter than this does not split a line. */
const MIN_LEVEL_RUN_M = 50;
const SIMPLIFY_M = 3;
/** The map opens on what was walked this close to where the latest walk started. */
const HOME_RADIUS_M = 10_000;

const M_PER_DEG = 111_195;

export interface HeatWalk {
  id: number;
  /** Local date, YYYY-MM-DD. */
  date: string;
  startedAt: number;
  segments: LatLon[][];
}

export interface HeatCell {
  /** Different walks through the cell, ever. */
  n: number;
  /** Those of the last 30 days, and the sum of their weights. */
  recent: number;
  heat: number;
  /** Date of the latest one. */
  last: string;
  /** The last walk counted in it, so each one counts once. */
  walk: number;
}

/**
 * Points of a line in flat metres around the first walk, with the metres walked to each one. Plain
 * arrays: a thousand walks are a million points, and an object for each would take seconds.
 */
interface Track {
  xs: number[];
  ys: number[];
  along: number[];
}

/** What is being built: walks are added the latest first (`addHeatWalks`). */
export interface PathHeat {
  today: string;
  origin: LatLon | null;
  cos: number;
  cells: Map<number, HeatCell>;
  /** Squares of COVER_CELL_M that already have a line near: which walk drew it and how far along it. */
  covered: Map<number, { walk: number; along: number }>;
  /** The lines to draw: one per path. */
  stretches: Track[];
  walks: number;
  /** Where the latest walk started. */
  home: LatLon | null;
}

export const emptyPathHeat = (today: string): PathHeat => ({
  today,
  origin: null,
  cos: 1,
  cells: new Map(),
  covered: new Map(),
  stretches: [],
  walks: 0,
  home: null,
});

/** The weight of a walk of `date` in «Últimos 30 días»: 1 today, 0,5 two weeks ago, 0 from 30 days. */
export function recencyWeight(date: string, today: string): number {
  const days = Math.max(0, calendarDaysBetween(date, today));
  return Math.max(0, 1 - days / HEAT_WINDOW_DAYS);
}

// One whole number per square of a grid, wherever on Earth it is from the first walk.
const gridKey = (cx: number, cy: number) => (cx + 1_048_576) * 2_097_152 + (cy + 1_048_576);
const cellKey = (x: number, y: number) => gridKey(Math.floor(x / CELL_M), Math.floor(y / CELL_M));
const coverKey = (x: number, y: number) => gridKey(Math.floor(x / COVER_CELL_M), Math.floor(y / COVER_CELL_M));

const toXY = (heat: PathHeat, p: LatLon) => ({
  x: (p.lon - heat.origin!.lon) * heat.cos * M_PER_DEG,
  y: (p.lat - heat.origin!.lat) * M_PER_DEG,
});

const toLatLon = (heat: PathHeat, x: number, y: number): LatLon => ({
  lat: heat.origin!.lat + y / M_PER_DEG,
  lon: heat.origin!.lon + x / (heat.cos * M_PER_DEG),
});

/** The walk as runs of points at most STEP_M apart; a pause or a gap in the fixes starts another run. */
function sample(heat: PathHeat, walk: HeatWalk): { runs: Track[]; length: number } {
  const runs: Track[] = [];
  let along = 0;
  for (const segment of walk.segments) {
    let run: Track = { xs: [], ys: [], along: [] };
    let px = 0;
    let py = 0;
    for (let i = 0; i < segment.length; i++) {
      const { x, y } = toXY(heat, segment[i]);
      const length = i === 0 ? 0 : Math.hypot(x - px, y - py);
      if (i > 0 && length <= JOIN_MAX_M) {
        const steps = Math.max(1, Math.ceil(length / STEP_M));
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          run.xs.push(px + (x - px) * t);
          run.ys.push(py + (y - py) * t);
          run.along.push(along + length * t);
        }
        along += length;
      } else {
        if (run.xs.length > 1) runs.push(run);
        run = { xs: [x], ys: [y], along: [along] };
      }
      px = x;
      py = y;
    }
    if (run.xs.length > 1) runs.push(run);
  }
  return { runs, length: along };
}

/**
 * Counts the walk once in every cell with some point within MARGIN_M of its line (four at most per
 * point). `seen` remembers the cells this walk has just counted in: a walker stays in the same few
 * for many points, and looking each one up in the map again is most of the work.
 */
function countWalk(heat: PathHeat, run: Track, walk: number, date: string, weight: number, seen: Float64Array): void {
  const reach2 = MARGIN_M * MARGIN_M;
  for (let i = 0; i < run.xs.length; i++) {
    const x = run.xs[i];
    const y = run.ys[i];
    const toX = Math.floor((x + MARGIN_M) / CELL_M);
    const toY = Math.floor((y + MARGIN_M) / CELL_M);
    for (let cx = Math.floor((x - MARGIN_M) / CELL_M); cx <= toX; cx++) {
      for (let cy = Math.floor((y - MARGIN_M) / CELL_M); cy <= toY; cy++) {
        // The closest point of the cell's square.
        const dx = x - Math.max(cx * CELL_M, Math.min(x, (cx + 1) * CELL_M));
        const dy = y - Math.max(cy * CELL_M, Math.min(y, (cy + 1) * CELL_M));
        if (dx * dx + dy * dy > reach2) continue;
        const key = gridKey(cx, cy);
        const slot = (cx * 31 + cy) & (seen.length - 1);
        if (seen[slot] === key) continue;
        seen[slot] = key;
        const cell = heat.cells.get(key);
        if (!cell) heat.cells.set(key, { n: 1, heat: weight, recent: weight > 0 ? 1 : 0, last: date, walk });
        else if (cell.walk !== walk) {
          cell.walk = walk;
          cell.n += 1;
          cell.heat += weight;
          if (weight > 0) cell.recent += 1;
          if (date > cell.last) cell.last = date;
        }
      }
    }
  }
}

/** Marks as having a line the squares within COVER_M of a point just drawn. */
function cover(heat: PathHeat, x: number, y: number, walk: number, along: number): void {
  const toX = Math.floor((x + COVER_M) / COVER_CELL_M);
  const toY = Math.floor((y + COVER_M) / COVER_CELL_M);
  for (let cx = Math.floor((x - COVER_M) / COVER_CELL_M); cx <= toX; cx++) {
    for (let cy = Math.floor((y - COVER_M) / COVER_CELL_M); cy <= toY; cy++) {
      const dx = x - Math.max(cx * COVER_CELL_M, Math.min(x, (cx + 1) * COVER_CELL_M));
      const dy = y - Math.max(cy * COVER_CELL_M, Math.min(y, (cy + 1) * COVER_CELL_M));
      if (dx * dx + dy * dy > COVER_M * COVER_M) continue;
      const key = gridKey(cx, cy);
      if (!heat.covered.has(key)) heat.covered.set(key, { walk, along });
    }
  }
}

/** The new part of a run: what no line drawn so far goes along, as stretches (indices into the run). */
function newStretches(heat: PathHeat, run: Track, walk: number): [number, number][] {
  const { xs, ys, along } = run;
  const n = xs.length;
  const fresh = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const mark = heat.covered.get(coverKey(xs[i], ys[i]));
    if (mark && (mark.walk !== walk || along[i] - mark.along > OWN_TRAIL_M)) continue;
    fresh[i] = 1;
    cover(heat, xs[i], ys[i], walk, along[i]);
  }
  const spans: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!fresh[i]) continue;
    let end = i;
    while (end + 1 < n && fresh[end + 1]) end++;
    const last = spans.at(-1);
    // The GPS wandering in one place while standing does not cut the line.
    if (last && Math.hypot(xs[i] - xs[last[1]], ys[i] - ys[last[1]]) <= BRIDGE_M && along[i] - along[last[1]] <= 4 * BRIDGE_M) {
      last[1] = end;
    } else spans.push([i, end]);
    i = end;
  }
  return spans
    .filter(([from, to]) => along[to] - along[from] >= MIN_STRETCH_M)
    .map(([from, to]) => {
      // Over the path it leaves and the one it joins, so the two lines meet.
      let start = from;
      while (start > 0 && along[from] - along[start - 1] <= OVERLAP_M) start--;
      let end = to;
      while (end + 1 < n && along[end + 1] - along[to] <= OVERLAP_M) end++;
      return [start, end];
    });
}

/**
 * Adds walks to the map, the latest first (the line of a path is that of the latest walk along it).
 * Changes `heat`: built in batches so the screen can draw the last 30 days before the rest is read.
 */
export function addHeatWalks(heat: PathHeat, walks: readonly HeatWalk[]): void {
  for (const walk of walks) {
    const first = walk.segments.find((s) => s.length > 0)?.[0];
    if (!first) continue;
    if (!heat.origin) {
      heat.origin = first;
      heat.cos = Math.cos((first.lat * Math.PI) / 180);
    }
    const { runs, length } = sample(heat, walk);
    if (length < MIN_WALK_M || runs.length === 0) continue;
    if (!heat.home) heat.home = first;
    const index = heat.walks++;
    const weight = recencyWeight(walk.date, heat.today);
    const seen = new Float64Array(64).fill(-1);
    for (const run of runs) countWalk(heat, run, index, walk.date, weight, seen);
    for (const run of runs) {
      for (const [from, to] of newStretches(heat, run, index)) {
        heat.stretches.push({ xs: run.xs.slice(from, to + 1), ys: run.ys.slice(from, to + 1), along: run.along.slice(from, to + 1) });
      }
    }
  }
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** How a path is drawn: its level and, for a lone walk fading out (level 1), how much of its colour is left (0,1–1). */
export interface HeatTone {
  level: HeatLevel;
  fade: number;
}

/**
 * «Últimos 30 días»: nothing in 30 days is the grey net (0); a lone walk fades from level 1 to grey
 * as it gets old; then once a week, two to four times a week and five or more.
 */
export function recentTone(heat: number): HeatTone {
  if (heat <= 0) return { level: 0, fade: 1 };
  if (heat < 1) return { level: 1, fade: Math.max(0.1, Math.round(heat * 10) / 10) };
  const level = heat < RECENT_CUTS[0] ? 1 : heat < RECENT_CUTS[1] ? 2 : heat < RECENT_CUTS[2] ? 3 : 4;
  return { level, fade: 1 };
}

/**
 * «Siempre»: the walks from which a path is at levels 2, 3 and 4, relative to the most walked one, so
 * the scale is not used up in two months: 7 walks → 2 · 3 · 5; 300 → 30 · 60 · 180.
 */
export function alwaysCuts(most: number): [number, number, number] {
  const c2 = Math.max(2, Math.ceil(ALWAYS_SHARES[0] * most));
  const c3 = Math.max(c2 + 1, Math.ceil(ALWAYS_SHARES[1] * most));
  const c4 = Math.max(c3 + 1, Math.ceil(ALWAYS_SHARES[2] * most));
  return [c2, c3, c4];
}

export function alwaysTone(n: number, cuts: readonly [number, number, number]): HeatTone {
  return { level: n >= cuts[2] ? 4 : n >= cuts[1] ? 3 : n >= cuts[0] ? 2 : 1, fade: 1 };
}

/** The most walks through one cell. */
export const mostWalked = (heat: PathHeat) => {
  let most = 0;
  for (const cell of heat.cells.values()) if (cell.n > most) most = cell.n;
  return most;
};

/** Douglas–Peucker: the indices of the points of `from`…`to` that keep the line within SIMPLIFY_M of itself. */
function simplify(track: Track, from: number, to: number): number[] {
  const { xs, ys } = track;
  const keep = new Uint8Array(to - from + 1);
  keep[0] = 1;
  keep[to - from] = 1;
  const stack: [number, number][] = [[from, to]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const length2 = dx * dx + dy * dy;
    let far = -1;
    let most = SIMPLIFY_M;
    for (let i = a + 1; i < b; i++) {
      const t = length2 > 0 ? Math.max(0, Math.min(1, ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / length2)) : 0;
      const d = Math.hypot(xs[i] - xs[a] - t * dx, ys[i] - ys[a] - t * dy);
      if (d > most) {
        most = d;
        far = i;
      }
    }
    if (far < 0) continue;
    keep[far - from] = 1;
    stack.push([a, far], [far, b]);
  }
  const kept: number[] = [];
  for (let i = from; i <= to; i++) if (keep[i - from]) kept.push(i);
  return kept;
}

export interface HeatLine extends HeatTone {
  points: LatLon[];
}

/**
 * The lines of the map in a mode: each path cut where its level changes (a change shorter than 50 m
 * does not cut it) and thinned. In «Siempre» there is no level 0.
 */
export function heatLines(heat: PathHeat, mode: HeatMode): HeatLine[] {
  const cuts = alwaysCuts(mostWalked(heat));
  const toneOf = (x: number, y: number): HeatTone => {
    const c = heat.cells.get(cellKey(x, y));
    if (!c) return { level: mode === 'recent' ? 0 : 1, fade: 1 };
    return mode === 'recent' ? recentTone(c.heat) : alwaysTone(c.n, cuts);
  };
  const same = (a: HeatTone, b: HeatTone) => a.level === b.level && a.fade === b.fade;
  const lines: HeatLine[] = [];
  for (const stretch of heat.stretches) {
    const last = stretch.xs.length - 1;
    // Runs of one tone, each from its first point.
    const runs: { from: number; tone: HeatTone }[] = [];
    for (let i = 0; i <= last; i++) {
      const tone = toneOf(stretch.xs[i], stretch.ys[i]);
      if (runs.length === 0 || !same(runs[runs.length - 1].tone, tone)) runs.push({ from: i, tone });
    }
    // A short run takes the tone of the one before it (the first, of the one after).
    const pieces: { from: number; tone: HeatTone }[] = [];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const end = i + 1 < runs.length ? runs[i + 1].from : last;
      const short = stretch.along[end] - stretch.along[run.from] < MIN_LEVEL_RUN_M;
      if (pieces.length > 0 && (short || same(pieces[pieces.length - 1].tone, run.tone))) continue;
      if (short && i + 1 < runs.length) runs[i + 1] = { from: run.from, tone: runs[i + 1].tone };
      else pieces.push(run);
    }
    for (let i = 0; i < pieces.length; i++) {
      // Up to the first point of the next piece, so the two touch.
      const end = i + 1 < pieces.length ? pieces[i + 1].from : last;
      const kept = simplify(stretch, pieces[i].from, end);
      if (kept.length > 1) lines.push({ ...pieces[i].tone, points: kept.map((k) => toLatLon(heat, stretch.xs[k], stretch.ys[k])) });
    }
  }
  return lines;
}

/** The corners of what the map opens on: what was walked near where the latest walk started. */
export function heatFrame(heat: PathHeat): { min: LatLon; max: LatLon } | null {
  if (!heat.home) return null;
  const home = toXY(heat, heat.home);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { xs, ys } of heat.stretches) {
    for (let i = 0; i < xs.length; i++) {
      if (Math.hypot(xs[i] - home.x, ys[i] - home.y) > HOME_RADIUS_M) continue;
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (ys[i] < minY) minY = ys[i];
      if (ys[i] > maxY) maxY = ys[i];
    }
  }
  return minX <= maxX ? { min: toLatLon(heat, minX, minY), max: toLatLon(heat, maxX, maxY) } : null;
}

/** The cell of a point of the map, or the most walked of those around it (a tap lands next to the line). */
export function heatCellAt(heat: PathHeat, p: LatLon): HeatCell | null {
  if (!heat.origin) return null;
  const { x, y } = toXY(heat, p);
  const own = heat.cells.get(cellKey(x, y));
  if (own) return own;
  let best: HeatCell | null = null;
  for (const dx of [-MARGIN_M, 0, MARGIN_M]) {
    for (const dy of [-MARGIN_M, 0, MARGIN_M]) {
      const cell = heat.cells.get(cellKey(x + dx, y + dy));
      if (cell && (!best || cell.n > best.n)) best = cell;
    }
  }
  return best;
}

/** «hoy», «ayer», «el 9 nov», «el 3 oct 2025». */
function whenText(date: string, today: string): string {
  const days = calendarDaysBetween(date, today);
  // «9 nov» does not break between the day and the month.
  return days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `el ${formatRecordDate(date, today).replace(' ', NBSP)}`;
}

/**
 * What a tapped path says: «12 caminatas en 30 días · la última ayer», «Ninguna en 30 días · la última
 * el 3 oct», «37 caminatas · la última el 9 nov». Always the real number of walks, never the weight.
 */
export function heatReading(cell: HeatCell, mode: HeatMode, today: string): string {
  const when = whenText(cell.last, today);
  if (mode === 'always') return cell.n === 1 ? `1 caminata · ${when}` : `${cell.n} caminatas · la última ${when}`;
  if (cell.recent === 0) return `Ninguna en 30${NBSP}días · la última ${when}`;
  return cell.recent === 1 ? `1 caminata en 30${NBSP}días · ${when}` : `${cell.recent} caminatas en 30${NBSP}días · la última ${when}`;
}

/** The two ends of the legend: «Una vez … Casi a diario», «1 caminata … 180 o más». */
export function heatLegend(heat: PathHeat, mode: HeatMode): { low: string; high: string } {
  if (mode === 'recent') return { low: 'Una vez', high: 'Casi a diario' };
  return { low: countOf(1, 'caminata', 'caminatas'), high: `${alwaysCuts(mostWalked(heat))[2]} o más` };
}

/** Whether any path was walked in the last 30 days: otherwise the map is all grey and says so. */
export const hasRecentHeat = (heat: PathHeat) => {
  for (const cell of heat.cells.values()) if (cell.recent > 0) return true;
  return false;
};

/** Metres of line drawn, for tests and diagnostics. */
export const heatLineLength = (lines: readonly HeatLine[]) =>
  lines.reduce((sum, line) => sum + line.points.slice(1).reduce((d, p, i) => d + distanceM(line.points[i], p), 0), 0);
