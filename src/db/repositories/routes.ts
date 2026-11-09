import { activeMs, decodeRoute, decodeSamples, encodeRoute, type LatLon } from '@/domain/gps';
import {
  bestRouteMatch,
  exclusionOf,
  routeCloses,
  routeMatch,
  routeQuestion,
  routeRecords,
  visitLines,
  type RouteMatch,
  type RouteRelation,
  type RouteTime,
} from '@/domain/routes';
import { walkSnapshot } from '@/domain/walkStats';
import type { Db } from '../db';

/** A saved route (Mis rutas, PLAN.md §6.8): its own copy of the line of the walk it came from. */
export interface SavedRoute {
  id: number;
  name: string;
  source: 'walk' | 'gpx';
  segments: LatLon[][];
  distanceM: number;
  /** Metres climbed; null without altitude. */
  climbM: number | null;
  createdAt: number;
}

interface RouteRow {
  id: number;
  name: string;
  source: 'walk' | 'gpx';
  path: string;
  distance_m: number;
  climb_m: number | null;
  created_at: number;
}

const toRoute = (r: RouteRow): SavedRoute => ({
  id: r.id,
  name: r.name,
  source: r.source,
  segments: decodeRoute(r.path),
  distanceM: r.distance_m,
  climbM: r.climb_m,
  createdAt: r.created_at,
});

/** A finished walk, with what matching and comparing it needs. */
interface WalkRow {
  id: number;
  date: string;
  started_at: number;
  finished_at: number;
  paused_ms: number;
  distance_m: number | null;
  route: string | null;
  route_id: number | null;
  route_relation: RouteRelation | null;
  route_declined: number;
}

const WALK_COLUMNS = 'id, date, started_at, finished_at, paused_ms, distance_m, route, route_id, route_relation, route_declined';
const FINISHED_WALK = `status = 'finished' AND tracking = 'gps' AND route IS NOT NULL`;

const walkTime = (w: WalkRow) =>
  activeMs({ startedAt: w.started_at, finishedAt: w.finished_at, pausedAt: null, pausedMs: w.paused_ms }, w.finished_at);

function toTime(w: WalkRow, route: SavedRoute): RouteTime {
  const relation = w.route_relation ?? 'same';
  return {
    sessionId: w.id,
    startedAt: w.started_at,
    date: w.date,
    activeMs: walkTime(w),
    distanceM: w.distance_m,
    relation,
    exclusion: exclusionOf(decodeRoute(w.route), route.segments, relation),
  };
}

export async function listRoutes(db: Db): Promise<SavedRoute[]> {
  return (await db.getAllAsync<RouteRow>('SELECT * FROM route ORDER BY id')).map(toRoute);
}

export async function getRoute(db: Db, id: number): Promise<SavedRoute | null> {
  const row = await db.getFirstAsync<RouteRow>('SELECT * FROM route WHERE id = ?', id);
  return row ? toRoute(row) : null;
}

async function getWalk(db: Db, sessionId: number): Promise<WalkRow | null> {
  return db.getFirstAsync<WalkRow>(`SELECT ${WALK_COLUMNS} FROM cardio_session WHERE id = ? AND ${FINISHED_WALK}`, sessionId);
}

/** Every walk linked to the route, as its screens compare them. */
export async function routeTimes(db: Db, route: SavedRoute): Promise<RouteTime[]> {
  const walks = await db.getAllAsync<WalkRow>(
    `SELECT ${WALK_COLUMNS} FROM cardio_session WHERE route_id = ? AND ${FINISHED_WALK} ORDER BY started_at`,
    route.id,
  );
  return walks.map((w) => toTime(w, route));
}

export async function routeCount(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM route'))?.n ?? 0;
}

/** A row of Mis rutas: the route, how many times and when it was last walked, and its best time. */
export interface RouteListItem {
  route: SavedRoute;
  count: number;
  lastDate: string | null;
  lastAt: number | null;
  bestMs: number | null;
}

/** Mis rutas: the one walked last first; those never walked at the end, the newest first. */
export async function routeList(db: Db): Promise<RouteListItem[]> {
  const items: RouteListItem[] = [];
  for (const route of await listRoutes(db)) {
    const times = await routeTimes(db, route);
    const last = times.at(-1) ?? null;
    items.push({
      route,
      count: times.length,
      lastDate: last?.date ?? null,
      lastAt: last?.startedAt ?? null,
      bestMs: routeRecords(times, routeCloses(route.segments)).best?.activeMs ?? null,
    });
  }
  return items.sort((a, b) =>
    a.lastAt !== null && b.lastAt !== null
      ? b.lastAt - a.lastAt
      : a.lastAt !== null
        ? -1
        : b.lastAt !== null
          ? 1
          : b.route.createdAt - a.route.createdAt,
  );
}

/** Links the walk to the route; `declined` goes back to 0. */
export async function linkWalk(db: Db, sessionId: number, routeId: number, relation: RouteRelation): Promise<void> {
  await db.runAsync(
    'UPDATE cardio_session SET route_id = ?, route_relation = ?, route_declined = 0 WHERE id = ?',
    routeId,
    relation,
    sessionId,
  );
}

/** «Quitar de la ruta»: the walk is not asked about again. Returns what it was, for «Deshacer». */
export async function unlinkWalk(db: Db, sessionId: number): Promise<{ routeId: number; relation: RouteRelation } | null> {
  const walk = await db.getFirstAsync<{ route_id: number | null; route_relation: RouteRelation | null }>(
    'SELECT route_id, route_relation FROM cardio_session WHERE id = ?',
    sessionId,
  );
  await db.runAsync('UPDATE cardio_session SET route_id = NULL, route_relation = NULL, route_declined = 1 WHERE id = ?', sessionId);
  return walk?.route_id ? { routeId: walk.route_id, relation: walk.route_relation ?? 'same' } : null;
}

/** «No» to the question about a route (true), or «Deshacer» (false). */
export async function setRouteDeclined(db: Db, sessionId: number, declined: boolean): Promise<void> {
  await db.runAsync('UPDATE cardio_session SET route_declined = ? WHERE id = ?', declined ? 1 : 0, sessionId);
}

/** The route a walk repeats best, among all the saved ones. */
async function repeatedRoute(db: Db, walk: WalkRow): Promise<{ route: SavedRoute; match: RouteMatch } | null> {
  const segments = decodeRoute(walk.route);
  const found = bestRouteMatch((await listRoutes(db)).map((route) => ({ item: route, match: routeMatch(segments, route.segments) })));
  return found ? { route: found.item, match: found.match } : null;
}

/**
 * At the end of a walk: linked by itself to the route it repeats the same way or back. A variant
 * waits for the question on its screen. Returns the route it was linked to.
 */
export async function linkToRepeatedRoute(db: Db, sessionId: number): Promise<number | null> {
  const walk = await getWalk(db, sessionId);
  if (!walk || walk.route_id !== null || walk.route_declined) return null;
  const found = await repeatedRoute(db, walk);
  if (!found || found.match.kind === 'variant' || found.match.kind === 'none') return null;
  await linkWalk(db, sessionId, found.route.id, found.match.kind);
  return found.route.id;
}

/**
 * «Guardar como ruta»: a copy of the walk's line, distance and climb, linked to the walk and to
 * every other walk without a route that repeats it the same way or back (variants are asked about
 * on their screens). Returns the route and how many walks it has.
 */
export async function saveWalkAsRoute(db: Db, sessionId: number, name: string, now = Date.now()): Promise<{ routeId: number; count: number }> {
  const session = await db.getFirstAsync<{
    route: string | null;
    distance_m: number | null;
    samples: string | null;
    started_at: number;
    finished_at: number | null;
    paused_ms: number;
  }>(`SELECT route, distance_m, samples, started_at, finished_at, paused_ms FROM cardio_session WHERE id = ? AND ${FINISHED_WALK}`, sessionId);
  const segments = decodeRoute(session?.route ?? null);
  if (!session || segments.flat().length < 2) throw new Error('This walk has no route to save');
  const walk = walkSnapshot(
    {
      startedAt: session.started_at,
      finishedAt: session.finished_at,
      pausedAt: null,
      pausedMs: session.paused_ms,
      distanceM: session.distance_m,
      route: session.route,
      samples: decodeSamples(session.samples),
    },
    null,
    0,
  );
  let routeId = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `INSERT INTO route (name, source, path, distance_m, climb_m, created_at) VALUES (?, 'walk', ?, ?, ?, ?)`,
      name.trim(),
      encodeRoute(segments),
      walk.numbers.distanceM,
      walk.numbers.climbM,
      now,
    );
    routeId = result.lastInsertRowId;
    await linkWalk(db, sessionId, routeId, 'same');
    const others = await db.getAllAsync<WalkRow>(
      `SELECT ${WALK_COLUMNS} FROM cardio_session WHERE ${FINISHED_WALK} AND route_id IS NULL AND id <> ?`,
      sessionId,
    );
    for (const other of others) {
      const match = routeMatch(decodeRoute(other.route), segments);
      if (match.kind === 'same' || match.kind === 'reverse') await linkWalk(db, other.id, routeId, match.kind);
    }
  });
  const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cardio_session WHERE route_id = ?', routeId);
  return { routeId, count: count?.n ?? 1 };
}

/** An empty name leaves it as it was. */
export async function renameRoute(db: Db, id: number, name: string): Promise<void> {
  if (!name.trim()) return;
  await db.runAsync('UPDATE route SET name = ? WHERE id = ?', name.trim(), id);
}

/** Its walks stay, without a route. */
export async function deleteRoute(db: Db, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE cardio_session SET route_id = NULL, route_relation = NULL WHERE route_id = ?', id);
    await db.runAsync('DELETE FROM route WHERE id = ?', id);
  });
}

/** What the screen of a walk shows about routes: the one it is linked to, or a question about one. */
export type WalkRoute =
  | { kind: 'linked'; routeId: number; name: string; first: string; second: string | null }
  | { kind: 'question'; routeId: number; name: string; relation: RouteRelation; title: string; detail: string | null }
  | null;

/**
 * The route of a finished walk, with its line («3.ª vez · 2:10 más rápido que tu mejor»); without
 * one and not declined, the route it seems to repeat, to ask. Computed when opening: nothing is written.
 */
export async function walkRoute(db: Db, sessionId: number): Promise<WalkRoute> {
  const walk = await getWalk(db, sessionId);
  if (!walk) return null;
  if (walk.route_id !== null) {
    const route = await getRoute(db, walk.route_id);
    if (!route) return null;
    const times = await routeTimes(db, route);
    const time = times.find((t) => t.sessionId === sessionId);
    if (!time) return null;
    return { kind: 'linked', routeId: route.id, name: route.name, ...visitLines(time, times, routeCloses(route.segments)) };
  }
  if (walk.route_declined) return null;
  const found = await repeatedRoute(db, walk);
  const relation = found?.match.kind;
  if (!found || !relation || relation === 'none') return null;
  const { route, match } = found;
  return {
    kind: 'question',
    routeId: route.id,
    name: route.name,
    relation,
    ...routeQuestion(route.name, match, walk.distance_m ?? 0, route.distanceM),
  };
}
