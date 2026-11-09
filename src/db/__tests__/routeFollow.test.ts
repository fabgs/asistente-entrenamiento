import { encodeRoute, type LatLon } from '@/domain/gps';
import { parseGpx } from '@/domain/gpx';
import { routeLengthM } from '@/domain/routes';
import { LOOP, LOOP_DETOUR, walkAlong, type Corner } from '@/domain/__tests__/routeFixtures';
import type { Db } from '../db';
import { DEMO_SEED } from '../demoSeed';
import { exportBackup, restoreBackup } from '../maintenance';
import { MIGRATIONS } from '../migrations';
import { listCardio, type CardioActivity } from '../repositories/cardio';
import {
  finishCardioSession,
  getCardioSession,
  setFollowRoute,
  startCardioSession,
  storeTrackPoints,
  type NewPoint,
} from '../repositories/cardioSessions';
import { deleteRoute, followedRoute, getRoute, importGpxRoute, linkToRepeatedRoute, routeList, saveWalkAsRoute } from '../repositories/routes';
import { getSettings, updateSettings } from '../repositories/settings';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const T0 = new Date(2026, 10, 9, 9, 0).getTime();

async function seeded(): Promise<{ db: Db; caminar: CardioActivity }> {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, new Date(T0));
  const caminar = (await listCardio(db)).find((a) => a.name === 'Caminar' && a.weekday === 1)!;
  return { db, caminar };
}

/** Fixes walking through `corners` at 1.4 m/s, one every 3 s from `t0`. */
const fixesAlong = (corners: Corner[], t0: number, seed = 2): NewPoint[] =>
  walkAlong(corners, { step: 4.2, drift: 0, seed }).map((p, i) => ({ ...p, t: t0 + i * 3000, accuracy: 5, speed: 1.4, altitude: null }));

/** A finished walk along `corners` on day `day` of November. */
async function addWalk(db: Db, corners: Corner[], day: number, seed = 2): Promise<number> {
  const route = [walkAlong(corners, { seed })];
  const startedAt = new Date(2026, 10, day, 9, 0).getTime();
  const { lastInsertRowId } = await db.runAsync(
    `INSERT INTO cardio_session (name, date, tracking, status, started_at, finished_at, paused_ms, distance_m, route)
     VALUES ('Caminar', ?, 'gps', 'finished', ?, ?, 0, ?, ?)`,
    `2026-11-${String(day).padStart(2, '0')}`,
    startedAt,
    startedAt + 20 * 60_000,
    routeLengthM(route),
    encodeRoute(route),
  );
  return lastInsertRowId;
}

/** Feeds the fixes to the session two at a time, as the GPS task gets them; the events, in order. */
async function feed(db: Db, fixes: NewPoint[]): Promise<string[]> {
  const events: string[] = [];
  for (let i = 0; i < fixes.length; i += 2) {
    const chunk = fixes.slice(i, i + 2);
    const { follow } = await storeTrackPoints(db, chunk, chunk.at(-1)!.t + 1000);
    if (follow?.event) events.push(follow.event);
  }
  return events;
}

const gpx = (points: LatLon[], ele: (i: number) => number | null) =>
  `<gpx><trk><name>Pico</name><trkseg>${points
    .map((p, i) => `<trkpt lat="${p.lat}" lon="${p.lon}">${ele(i) === null ? '' : `<ele>${ele(i)}</ele>`}</trkpt>`)
    .join('')}</trkseg></trk></gpx>`;

describe('following a route in the database', () => {
  it('migrates a database of version 12', async () => {
    const db = await createTestDb({ upTo: 12 });
    await db.execAsync(MIGRATIONS[12]);
    const columns = async (table: string) => (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
    expect(await columns('cardio_session')).toEqual(expect.arrayContaining(['follow_route_id', 'follow_state']));
    expect(await columns('settings')).toContain('route_alert');
  });

  it('alerts on the way out and back while storing the fixes, and keeps the state in the session', async () => {
    const { db, caminar } = await seeded();
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP, 1), 'Manzana', T0);
    const id = await startCardioSession(db, caminar, T0, routeId);
    expect(await getCardioSession(db, id)).toMatchObject({ followRouteId: routeId, followState: null });

    // The detour takes the parallel street 150 m away: some 6 min off the route, so one reminder.
    expect(await feed(db, fixesAlong(LOOP_DETOUR, T0))).toEqual(['off', 'reminder', 'back']);
    const session = (await getCardioSession(db, id))!;
    expect(session.followState).toMatchObject({ status: 'done', dir: 1 });
    // The fixes are stored as always.
    expect((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cardio_point WHERE session_id = ?', id))!.n).toBeGreaterThan(300);

    await finishCardioSession(db, id, T0 + 3_600_000);
    expect(await getCardioSession(db, id)).toMatchObject({ followRouteId: routeId, followState: null });
    // A variant of the route it followed: linked without asking.
    expect(await linkToRepeatedRoute(db, id)).toBe(routeId);
    expect(await db.getFirstAsync('SELECT route_relation FROM cardio_session WHERE id = ?', id)).toEqual({ route_relation: 'variant' });
    expect((await followedRoute(db, id))!.name).toBe('Manzana');
  });

  it('says nothing with the alert off', async () => {
    const { db, caminar } = await seeded();
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP, 1), 'Manzana', T0);
    expect((await getSettings(db)).routeAlert).toBe(true);
    await updateSettings(db, { routeAlert: false });
    await startCardioSession(db, caminar, T0, routeId);
    expect(await feed(db, fixesAlong(LOOP_DETOUR, T0))).toEqual([]);
  });

  it('stops following, and follows again with the state it had', async () => {
    const { db, caminar } = await seeded();
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP, 1), 'Manzana', T0);
    const id = await startCardioSession(db, caminar, T0);
    const fixes = fixesAlong(LOOP, T0);
    await feed(db, fixes.slice(0, 20));
    expect((await getCardioSession(db, id))!.followState).toBeNull();

    await setFollowRoute(db, id, routeId);
    await feed(db, fixes.slice(20, 60));
    const state = (await getCardioSession(db, id))!.followState!;
    expect(state.status).toBe('on');
    await setFollowRoute(db, id, null);
    expect(await getCardioSession(db, id)).toMatchObject({ followRouteId: null, followState: null });
    expect((await storeTrackPoints(db, fixes.slice(60, 62), fixes[61].t)).follow).toBeNull();
    await setFollowRoute(db, id, routeId, state);
    expect((await getCardioSession(db, id))!.followState).toEqual(state);
  });

  it('turns a walk that follows a deleted route into a free walk', async () => {
    const { db, caminar } = await seeded();
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP, 1), 'Manzana', T0);
    const id = await startCardioSession(db, caminar, T0, routeId);
    await feed(db, fixesAlong(LOOP, T0).slice(0, 20));
    await deleteRoute(db, routeId);
    expect(await getCardioSession(db, id)).toMatchObject({ followRouteId: null, followState: null });
  });

  it('imports a GPX as a route, with its climb when most points have it, and links the walks that repeat it', async () => {
    const { db } = await seeded();
    const walk = await addWalk(db, LOOP, 1);
    const points = walkAlong(LOOP, { seed: 3, step: 10 });
    const withEle = parseGpx(gpx(points, (i) => 60 + 20 * Math.sin((Math.PI * i) / points.length)));
    const { routeId, count } = await importGpxRoute(db, withEle, 'Pico del Águila', T0);
    expect(count).toBe(1);
    const route = (await getRoute(db, routeId))!;
    expect(route).toMatchObject({ name: 'Pico del Águila', source: 'gpx' });
    expect(route.distanceM).toBeCloseTo(1400, -2);
    expect(route.climbM).toBeGreaterThan(15);
    expect(await db.getFirstAsync('SELECT route_id FROM cardio_session WHERE id = ?', walk)).toEqual({ route_id: routeId });

    const fewEle = parseGpx(gpx(points, (i) => (i < 10 ? 60 : null)));
    const other = await importGpxRoute(db, fewEle, 'Sin altura', T0 + 1);
    expect((await getRoute(db, other.routeId))!.climbM).toBeNull();
    expect(other.count).toBe(0);
    // Never walked: the newest at the end of Mis rutas.
    expect((await routeList(db)).map((i) => i.route.name)).toEqual(['Pico del Águila', 'Sin altura']);
  });

  it('restores a backup of version 12, without anything followed', async () => {
    const { db, caminar } = await seeded();
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP, 1), 'Manzana', T0);
    const id = await startCardioSession(db, caminar, T0, routeId);
    await finishCardioSession(db, id, T0 + 60_000);
    const backup = await exportBackup(db, new Date(T0));
    backup.tables.cardio_session = backup.tables.cardio_session!.map(({ follow_route_id: _r, follow_state: _s, ...row }) => row);
    backup.tables.settings = backup.tables.settings!.map(({ route_alert: _a, ...row }) => row);
    await restoreBackup(db, { ...backup, schemaVersion: 12 });
    expect(await getCardioSession(db, id)).toMatchObject({ followRouteId: null, followState: null });
    expect((await getSettings(db)).routeAlert).toBe(true);
  });
});
