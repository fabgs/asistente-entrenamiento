import { encodeRoute, encodeSamples, type LatLon } from '@/domain/gps';
import { routeLengthM } from '@/domain/routes';
import { LINE, LOOP, LOOP_DETOUR, OUT_AND_BACK, reversed, walkAlong, type Corner } from '@/domain/__tests__/routeFixtures';
import type { Db } from '../db';
import { exportBackup, parseBackup, restoreBackup, wipeAllData } from '../maintenance';
import { MIGRATIONS } from '../migrations';
import { discardCardioSession } from '../repositories/cardioSessions';
import { addPhoto, listRoutePhotos } from '../repositories/photos';
import {
  deleteRoute,
  getRoute,
  linkToRepeatedRoute,
  linkWalk,
  renameRoute,
  routeCount,
  routeList,
  routeTimes,
  saveWalkAsRoute,
  setRouteDeclined,
  unlinkWalk,
  walkRoute,
} from '../repositories/routes';
import { DEMO_SEED } from '../demoSeed';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 9, 12, 0).getTime();
const MIN = 60_000;

/** A finished walk on day `day` of November along `corners`, `minutes` long. */
async function addWalk(
  db: Db,
  corners: Corner[],
  { day = 1, minutes = 20, seed = 2, segments, altitude = false }: { day?: number; minutes?: number; seed?: number; segments?: LatLon[][]; altitude?: boolean } = {},
): Promise<number> {
  const route = segments ?? [walkAlong(corners, { seed })];
  const startedAt = new Date(2026, 10, day, 9, 0).getTime();
  const samples = altitude ? encodeSamples([0, 1, 2, 3, 4, 5, 6].map((i) => ({ s: i * 60, d: i * 200, a: 50 + i * 6 }))) : null;
  const { lastInsertRowId } = await db.runAsync(
    `INSERT INTO cardio_session (name, date, tracking, status, started_at, finished_at, paused_ms, distance_m, route, samples)
     VALUES ('Caminar', ?, 'gps', 'finished', ?, ?, 0, ?, ?, ?)`,
    `2026-11-${String(day).padStart(2, '0')}`,
    startedAt,
    startedAt + minutes * MIN,
    routeLengthM(route),
    encodeRoute(route),
    samples,
  );
  return lastInsertRowId;
}

const linkOf = (db: Db, id: number) =>
  db.getFirstAsync<{ route_id: number | null; route_relation: string | null; route_declined: number }>(
    'SELECT route_id, route_relation, route_declined FROM cardio_session WHERE id = ?',
    id,
  );

describe('Mis rutas in the database', () => {
  it('migrates a database of version 11', async () => {
    const db = await createTestDb({ upTo: 11 });
    const walk = await addWalk(db, LOOP);
    await db.execAsync(MIGRATIONS[11]);
    const columns = async (table: string) => (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
    expect(await columns('route')).toEqual(['id', 'name', 'source', 'path', 'distance_m', 'climb_m', 'created_at']);
    expect(await columns('cardio_session')).toEqual(expect.arrayContaining(['route_id', 'route_relation', 'route_declined']));
    expect(await linkOf(db, walk)).toEqual({ route_id: null, route_relation: null, route_declined: 0 });
  });

  it('saves a walk as a route with its own line, distance and climb', async () => {
    const db = await createTestDb();
    const walk = await addWalk(db, LOOP, { altitude: true });
    const { routeId, count } = await saveWalkAsRoute(db, walk, '  Ver hormigas ', NOW);
    expect(count).toBe(1);
    const route = (await getRoute(db, routeId))!;
    expect(route).toMatchObject({ name: 'Ver hormigas', source: 'walk', createdAt: NOW });
    expect(route.distanceM).toBeCloseTo(1400, -2);
    expect(route.climbM).toBeGreaterThan(20);
    expect(route.segments[0]).toHaveLength(walkAlong(LOOP, { seed: 2 }).length);
    expect(await linkOf(db, walk)).toEqual({ route_id: routeId, route_relation: 'same', route_declined: 0 });
    // Without altitude, no climb.
    const flat = await saveWalkAsRoute(db, await addWalk(db, LINE), 'Al río', NOW);
    expect((await getRoute(db, flat.routeId))!.climbM).toBeNull();
  });

  it('links on saving the walks that repeat it the same way or back, not variants nor walks of another route', async () => {
    const db = await createTestDb();
    const same = await addWalk(db, LOOP, { day: 1, seed: 3 });
    const back = await addWalk(db, reversed(LOOP), { day: 2, seed: 4 });
    const variant = await addWalk(db, LOOP_DETOUR, { day: 3 });
    const elsewhere = await addWalk(db, LINE, { day: 4 });
    const taken = await addWalk(db, LOOP, { day: 5, seed: 5 });
    const other = await saveWalkAsRoute(db, elsewhere, 'Al río', NOW);
    await linkWalk(db, taken, other.routeId, 'variant');
    // Saving links even a walk whose question was answered «No».
    await setRouteDeclined(db, same, true);
    const origin = await addWalk(db, LOOP, { day: 6 });

    const { routeId, count } = await saveWalkAsRoute(db, origin, 'Manzana', NOW);
    expect(count).toBe(3);
    expect(await linkOf(db, same)).toEqual({ route_id: routeId, route_relation: 'same', route_declined: 0 });
    expect(await linkOf(db, back)).toMatchObject({ route_id: routeId, route_relation: 'reverse' });
    expect(await linkOf(db, variant)).toMatchObject({ route_id: null });
    expect(await linkOf(db, taken)).toMatchObject({ route_id: other.routeId });
    expect(await linkOf(db, elsewhere)).toMatchObject({ route_id: other.routeId });
    expect(() => saveWalkAsRoute(db, 999, 'Nada', NOW)).rejects.toThrow();
  });

  it('links a walk that repeats a route when it ends, and asks about a variant', async () => {
    const db = await createTestDb();
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP, { day: 1 }), 'Manzana', NOW);

    const again = await addWalk(db, LOOP, { day: 2, seed: 6 });
    expect(await linkToRepeatedRoute(db, again)).toBe(routeId);
    const back = await addWalk(db, reversed(LOOP), { day: 3, seed: 7 });
    expect(await linkToRepeatedRoute(db, back)).toBe(routeId);
    expect(await linkOf(db, back)).toMatchObject({ route_relation: 'reverse' });

    const variant = await addWalk(db, LOOP_DETOUR, { day: 4 });
    expect(await linkToRepeatedRoute(db, variant)).toBeNull();
    expect(await walkRoute(db, variant)).toMatchObject({
      kind: 'question',
      routeId,
      relation: 'variant',
      title: '¿Es una variante de «Manzana»?',
    });
    const elsewhere = await addWalk(db, LINE, { day: 5 });
    expect(await linkToRepeatedRoute(db, elsewhere)).toBeNull();
    expect(await walkRoute(db, elsewhere)).toBeNull();
  });

  it('«Sí» links the variant, «No» stops asking and «Deshacer» asks again', async () => {
    const db = await createTestDb();
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP, { day: 1 }), 'Manzana', NOW);
    const variant = await addWalk(db, LOOP_DETOUR, { day: 2 });

    await setRouteDeclined(db, variant, true);
    expect(await walkRoute(db, variant)).toBeNull();
    await setRouteDeclined(db, variant, false);
    expect(await walkRoute(db, variant)).toMatchObject({ kind: 'question' });

    await linkWalk(db, variant, routeId, 'variant');
    expect(await walkRoute(db, variant)).toEqual({ kind: 'linked', routeId, name: 'Manzana', first: '2.ª vez · variante', second: null });
  });

  it('«Quitar de la ruta» unlinks it without asking again, and «Deshacer» links it back', async () => {
    const db = await createTestDb();
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP, { day: 1 }), 'Manzana', NOW);
    const again = await addWalk(db, LOOP, { day: 2, seed: 6 });
    await linkToRepeatedRoute(db, again);

    const was = await unlinkWalk(db, again);
    expect(was).toEqual({ routeId, relation: 'same' });
    expect(await linkOf(db, again)).toEqual({ route_id: null, route_relation: null, route_declined: 1 });
    expect(await walkRoute(db, again)).toBeNull();
    // Nor is it linked again by itself.
    expect(await linkToRepeatedRoute(db, again)).toBeNull();
    await linkWalk(db, again, was!.routeId, was!.relation);
    expect(await walkRoute(db, again)).toMatchObject({ kind: 'linked', first: '2.ª vez' });
  });

  it('says how each walk went against the earlier ones', async () => {
    const db = await createTestDb();
    const first = await addWalk(db, LOOP, { day: 1, minutes: 20 });
    const { routeId } = await saveWalkAsRoute(db, first, 'Manzana', NOW);
    const second = await addWalk(db, LOOP, { day: 2, minutes: 18, seed: 3 });
    const third = await addWalk(db, LOOP, { day: 3, minutes: 19, seed: 4 });
    const late = await addWalk(db, [[-150, 0], ...LOOP], { day: 4, minutes: 15, seed: 5 });
    for (const walk of [second, third, late]) await linkToRepeatedRoute(db, walk);

    expect(await walkRoute(db, first)).toEqual({ kind: 'linked', routeId, name: 'Manzana', first: '1.ª vez', second: null });
    expect(await walkRoute(db, second)).toMatchObject({ second: '2:00 más rápido que la otra vez' });
    expect(await walkRoute(db, third)).toMatchObject({ first: '3.ª vez', second: '1:00 más lento que tu mejor' });
    // 150 m before the start, plus the GPS drift of both walks.
    expect(await walkRoute(db, late)).toMatchObject({ first: '4.ª vez', second: expect.stringMatching(/^No cuenta para el mejor: empieza a 1[4-8]0 m$/) });
    const times = await routeTimes(db, (await getRoute(db, routeId))!);
    expect(times.map((t) => t.sessionId)).toEqual([first, second, third, late]);
  });

  it('deleting the route leaves its walks; deleting the walk it came from leaves the route', async () => {
    const db = await createTestDb();
    const origin = await addWalk(db, LOOP, { day: 1 });
    const { routeId } = await saveWalkAsRoute(db, origin, 'Manzana', NOW);
    const again = await addWalk(db, LOOP, { day: 2, seed: 3 });
    await linkToRepeatedRoute(db, again);

    const before = (await getRoute(db, routeId))!;
    await discardCardioSession(db, origin);
    expect(await getRoute(db, routeId)).toEqual(before);
    expect(await routeTimes(db, before)).toHaveLength(1);

    await deleteRoute(db, routeId);
    expect(await getRoute(db, routeId)).toBeNull();
    expect(await linkOf(db, again)).toEqual({ route_id: null, route_relation: null, route_declined: 0 });
  });

  it('renames a route, but not to nothing', async () => {
    const db = await createTestDb();
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP), 'Manzana', NOW);
    await renameRoute(db, routeId, ' Vuelta a la manzana ');
    await renameRoute(db, routeId, '   ');
    expect((await getRoute(db, routeId))!.name).toBe('Vuelta a la manzana');
  });

  it('lists Mis rutas by the last walk, those never walked at the end', async () => {
    const db = await createTestDb();
    const loop = await saveWalkAsRoute(db, await addWalk(db, LOOP, { day: 1, minutes: 20 }), 'Manzana', NOW);
    await linkToRepeatedRoute(db, await addWalk(db, LOOP, { day: 2, minutes: 18, seed: 3 }));
    const line = await saveWalkAsRoute(db, await addWalk(db, LINE, { day: 3 }), 'Al río', NOW);
    const gone = await addWalk(db, OUT_AND_BACK, { day: 4 });
    const empty = await saveWalkAsRoute(db, gone, 'Calle larga', NOW + 1);
    await discardCardioSession(db, gone);

    const list = await routeList(db);
    expect(list.map((i) => i.route.id)).toEqual([line.routeId, loop.routeId, empty.routeId]);
    expect(list[1]).toMatchObject({ count: 2, lastDate: '2026-11-02', bestMs: 18 * MIN });
    expect(list[2]).toMatchObject({ count: 0, lastDate: null, bestMs: null });
    expect(await routeCount(db)).toBe(3);
  });

  it('shows the photos of every walk of a route', async () => {
    const db = await createTestDb();
    const origin = await addWalk(db, LOOP, { day: 1 });
    const { routeId } = await saveWalkAsRoute(db, origin, 'Manzana', NOW);
    const again = await addWalk(db, LOOP, { day: 2, seed: 3 });
    await linkToRepeatedRoute(db, again);
    const elsewhere = await addWalk(db, LINE, { day: 3 });
    const shot = (file: string) => ({ file, width: 4, height: 3, takenAt: null, place: { lat: 41.36, lon: 2.15 } });
    await addPhoto(db, { kind: 'cardio', id: origin }, shot('a.jpg'), NOW);
    await addPhoto(db, { kind: 'cardio', id: again }, shot('b.jpg'), NOW + 1);
    await addPhoto(db, { kind: 'cardio', id: elsewhere }, shot('c.jpg'), NOW + 2);
    expect((await listRoutePhotos(db, routeId)).map((p) => p.file)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('keeps routes and their walks in the backup', async () => {
    const db = await createTestDb();
    // A backup needs the profile and the settings.
    await importSeed(db, DEMO_SEED, new Date(NOW));
    const { routeId } = await saveWalkAsRoute(db, await addWalk(db, LOOP, { day: 1 }), 'Manzana', NOW);
    const again = await addWalk(db, reversed(LOOP), { day: 2, seed: 3 });
    await linkToRepeatedRoute(db, again);
    const variant = await addWalk(db, LOOP_DETOUR, { day: 3 });
    await setRouteDeclined(db, variant, true);
    const route = await getRoute(db, routeId);

    const backup = parseBackup(JSON.stringify(await exportBackup(db, new Date(NOW))));
    await wipeAllData(db);
    await restoreBackup(db, backup);
    expect(await getRoute(db, routeId)).toEqual(route);
    expect(await linkOf(db, again)).toEqual({ route_id: routeId, route_relation: 'reverse', route_declined: 0 });
    expect(await linkOf(db, variant)).toMatchObject({ route_id: null, route_declined: 1 });
  });

  it('restores a backup of version 11, without routes', async () => {
    const db = await createTestDb();
    await importSeed(db, DEMO_SEED, new Date(NOW));
    const walk = await addWalk(db, LOOP);
    await saveWalkAsRoute(db, walk, 'Manzana', NOW);
    const backup = await exportBackup(db, new Date(NOW));
    delete backup.tables.route;
    backup.tables.cardio_session = backup.tables.cardio_session!.map(
      ({ route_id: _id, route_relation: _relation, route_declined: _declined, ...row }) => row,
    );
    await restoreBackup(db, { ...backup, schemaVersion: 11 });
    expect(await routeCount(db)).toBe(0);
    expect(await linkOf(db, walk)).toEqual({ route_id: null, route_relation: null, route_declined: 0 });
  });
});
