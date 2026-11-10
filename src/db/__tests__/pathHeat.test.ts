import { decodeRoute, encodeRoute } from '@/domain/gps';
import { addHeatWalks, emptyPathHeat, mostWalked } from '@/domain/pathHeat';
import { LOOP, walkAlong } from '@/domain/__tests__/routeFixtures';
import type { Db } from '../db';
import { wipeAllData } from '../maintenance';
import { getHeatMode, listHeatWalks, setHeatMode } from '../repositories/pathHeat';
import { createTestDb } from './testDb';

async function addSession(db: Db, day: number, over: { tracking?: string; status?: string; route?: string | null } = {}): Promise<number> {
  const startedAt = new Date(2026, 10, day, 9, 0).getTime();
  const route = over.route === undefined ? encodeRoute([walkAlong(LOOP, { seed: day })]) : over.route;
  const { lastInsertRowId } = await db.runAsync(
    `INSERT INTO cardio_session (name, date, tracking, status, started_at, finished_at, paused_ms, distance_m, route)
     VALUES ('Caminar', ?, ?, ?, ?, ?, 0, 1400, ?)`,
    `2026-11-${String(day).padStart(2, '0')}`,
    over.tracking ?? 'gps',
    over.status ?? 'finished',
    startedAt,
    startedAt + 1_200_000,
    route,
  );
  return lastInsertRowId;
}

describe('the heat map, from the database', () => {
  it('reads every finished walk with a line, the latest first, and nothing else', async () => {
    const db = await createTestDb();
    const first = await addSession(db, 1);
    const third = await addSession(db, 3);
    const second = await addSession(db, 2);
    await addSession(db, 4, { tracking: 'sprint' });
    await addSession(db, 5, { status: 'in_progress' });
    await addSession(db, 6, { route: null });
    await addSession(db, 7, { tracking: 'timer', route: null });

    const rows = await listHeatWalks(db);
    expect(rows.map((r) => r.id)).toEqual([third, second, first]);
    expect(rows[0]).toMatchObject({ date: '2026-11-03', startedAt: new Date(2026, 10, 3, 9, 0).getTime() });

    const heat = emptyPathHeat('2026-11-10');
    addHeatWalks(heat, rows.map((r) => ({ ...r, segments: decodeRoute(r.route) })));
    expect(heat.walks).toBe(3);
    expect(mostWalked(heat)).toBe(3);
  });

  it('remembers the mode on the phone, also after a reset of the data', async () => {
    const db = await createTestDb();
    expect(await getHeatMode(db)).toBe('recent');
    await setHeatMode(db, 'always');
    expect(await getHeatMode(db)).toBe('always');
    await wipeAllData(db);
    expect(await getHeatMode(db)).toBe('always');
    await setHeatMode(db, 'recent');
    expect(await getHeatMode(db)).toBe('recent');
  });
});
