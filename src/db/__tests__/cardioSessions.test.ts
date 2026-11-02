import { DEFAULT_PLANS } from '@/domain/cardioPlan';
import { decodeRoute } from '@/domain/gps';
import type { Db } from '../db';
import { exportBackup, restoreBackup } from '../maintenance';
import { migrate } from '../migrations';
import { cardioLogOn, listCardio, setCardioDone, updateCardio, type CardioActivity } from '../repositories/cardio';
import {
  addTrackPoints,
  discardCardioSession,
  finishCardioSession,
  getActiveCardioSession,
  getCardioSession,
  listTrackPoints,
  pauseCardioSession,
  resumeCardioSession,
  startCardioSession,
  type NewPoint,
} from '../repositories/cardioSessions';
import { cardioHistory } from '../repositories/progress';
import { finishSession, finishedRoutinesOn, logSet, startSession } from '../repositories/sessions';
import { listRoutines, listSlots } from '../repositories/routines';
import { getSettings, toProgressionSettings } from '../repositories/settings';
import { importSeed } from '../seed';
import { DEMO_SEED as SEED } from '../demoSeed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0);
const T0 = NOW.getTime();
const DEG_PER_M = 1 / 111_195;

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, SEED, NOW);
  return db;
}

/** Fixes walking north at 1.4 m/s every 3 s, starting `fromM` metres from the origin. */
function walk(t0: number, seconds: number, fromM = 0): NewPoint[] {
  const points: NewPoint[] = [];
  for (let s = 0; s <= seconds; s += 3) {
    points.push({
      t: t0 + s * 1000,
      lat: 40.4 + (fromM + s * 1.4) * DEG_PER_M,
      lon: -3.7,
      accuracy: 5,
      speed: 1.4,
      altitude: 650 + s / 10,
    });
  }
  return points;
}

const byName = (all: CardioActivity[], name: string, weekday: number) =>
  all.find((a) => a.name === name && a.weekday === weekday)!;

describe('cardio tracking', () => {
  it('infers how each seeded activity is tracked', async () => {
    const all = await listCardio(await seededDb());
    expect(byName(all, 'Caminar', 1)).toMatchObject({ tracking: 'gps', plan: null });
    expect(byName(all, 'Bici estática', 1)).toMatchObject({ tracking: 'timer', plan: { kind: 'liss', minutes: 30 } });
    expect(byName(all, 'Bici estática', 4)).toMatchObject({ tracking: 'timer', plan: DEFAULT_PLANS.miss });
    expect(byName(all, 'Sprints + Bouncing', 3)).toMatchObject({ tracking: 'timer', plan: DEFAULT_PLANS.hiit });
    expect(byName(all, 'Descanso / Caminar', 7).tracking).toBe('gps');
  });

  it('upgrades the cardio of an existing database in the migration', async () => {
    const db = await createTestDb({ upTo: 3 });
    for (const [i, c] of SEED.cardio.entries()) {
      await db.runAsync(
        'INSERT INTO cardio_activity (weekday, name, target, intensity, notes, position) VALUES (?, ?, ?, ?, ?, ?)',
        c.weekday,
        c.name,
        c.target,
        c.intensity,
        c.notes,
        i,
      );
    }
    await migrate(db);
    const all = await listCardio(db);
    expect(all.filter((a) => a.tracking === 'gps')).toHaveLength(5);
    expect(all.filter((a) => a.tracking === 'timer').map((a) => a.plan?.kind)).toEqual(['liss', 'hiit', 'miss', 'hiit']);
  });

  it('records a walk with a pause and keeps only the compressed route', async () => {
    const db = await seededDb();
    const caminar = byName(await listCardio(db), 'Caminar', 1);
    const id = await startCardioSession(db, caminar, T0);

    expect(await addTrackPoints(db, walk(T0, 300))).toBe(101); // 420 m
    await pauseCardioSession(db, id, T0 + 300_000);
    // Nothing is stored while paused.
    expect(await addTrackPoints(db, walk(T0 + 300_000, 60, 420))).toBe(0);
    await resumeCardioSession(db, id, T0 + 600_000);
    // Resumed 1 km further on: that gap is not counted.
    await addTrackPoints(db, walk(T0 + 600_000, 300, 1420));

    const points = await listTrackPoints(db, id);
    expect(new Set(points.map((p) => p.segment))).toEqual(new Set([0, 1]));

    await finishCardioSession(db, id, T0 + 900_000);
    const session = (await getCardioSession(db, id))!;
    expect(session.status).toBe('finished');
    expect(session.distanceM).toBeCloseTo(840, -1);
    expect(decodeRoute(session.route)).toHaveLength(2);
    // Profile for the charts: 10 min of activity (the pause left out), climbing 60 m.
    expect(session.samples.at(-1)).toMatchObject({ s: 600, d: 840, a: 680 });
    expect(session.samples[0].a).toBe(650);
    expect(await listTrackPoints(db, id)).toEqual([]);
    expect(await getActiveCardioSession(db)).toBeNull();

    // 15 min minus a 5 min pause.
    expect((await cardioLogOn(db, '2026-11-02')).get(caminar.id)).toEqual({ value: '840 m · 10 min', sessionId: id });
  });

  it('ignores cached fixes from before the start', async () => {
    const db = await seededDb();
    await startCardioSession(db, byName(await listCardio(db), 'Caminar', 1), T0);
    expect(await addTrackPoints(db, walk(T0 - 60_000, 30))).toBe(0);
  });

  it('logs a timer session with its active time and a snapshot of the plan', async () => {
    const db = await seededDb();
    const bici = byName(await listCardio(db), 'Bici estática', 4);
    const id = await startCardioSession(db, bici, T0);
    await updateCardio(db, bici.id, { ...bici, plan: DEFAULT_PLANS.liss });
    expect((await getCardioSession(db, id))!.plan).toEqual(DEFAULT_PLANS.miss);

    await finishCardioSession(db, id, T0 + 30 * 60_000);
    expect((await cardioLogOn(db, '2026-11-02')).get(bici.id)?.value).toBe('30 min');
  });

  it('finishing while paused ends at the pause', async () => {
    const db = await seededDb();
    const bici = byName(await listCardio(db), 'Bici estática', 1);
    const id = await startCardioSession(db, bici, T0);
    await pauseCardioSession(db, id, T0 + 20 * 60_000);
    await finishCardioSession(db, id, T0 + 60 * 60_000);
    expect((await getCardioSession(db, id))!.finishedAt).toBe(T0 + 20 * 60_000);
    expect((await cardioLogOn(db, '2026-11-02')).get(bici.id)?.value).toBe('20 min');
  });

  it('lists every session in the history, even two walks on the same day', async () => {
    const db = await seededDb();
    const all = await listCardio(db);
    const caminar = byName(all, 'Caminar', 1);
    const morning = await startCardioSession(db, caminar, T0);
    await addTrackPoints(db, walk(T0, 300));
    await finishCardioSession(db, morning, T0 + 300_000);
    const evening = await startCardioSession(db, caminar, T0 + 36_000_000);
    await addTrackPoints(db, walk(T0 + 36_000_000, 120));
    await finishCardioSession(db, evening, T0 + 36_120_000);
    // The bike only checked off, no session.
    await setCardioDone(db, '2026-11-02', byName(all, 'Bici estática', 1), true);

    const [today] = await cardioHistory(db);
    expect(today.date).toBe('2026-11-02');
    expect(today.activities.map((a) => [a.name, a.value, a.sessionId])).toEqual([
      ['Bici estática', null, null],
      ['Caminar', '420 m · 5 min', morning],
      ['Caminar', '168 m · 2 min', evening],
    ]);
    expect(today.activities[1].route).not.toBeNull();
    // Today's log points at the latest walk.
    expect((await cardioLogOn(db, '2026-11-02')).get(caminar.id)?.sessionId).toBe(evening);
  });

  it('discards a session and its points', async () => {
    const db = await seededDb();
    const id = await startCardioSession(db, byName(await listCardio(db), 'Caminar', 1), T0);
    await addTrackPoints(db, walk(T0, 30));
    await discardCardioSession(db, id);
    expect(await getCardioSession(db, id)).toBeNull();
    expect(await listTrackPoints(db, id)).toEqual([]);
  });

  it('backs up finished sessions and restores them', async () => {
    const db = await seededDb();
    const caminar = byName(await listCardio(db), 'Caminar', 1);
    const id = await startCardioSession(db, caminar, T0);
    await addTrackPoints(db, walk(T0, 120));
    await finishCardioSession(db, id, T0 + 120_000);
    // A walk in progress when the backup is restored: its points must not block the wipe.
    const running = await startCardioSession(db, caminar, T0 + 200_000);
    await addTrackPoints(db, walk(T0 + 200_000, 30));

    const backup = await exportBackup(db);
    expect(backup.tables.cardio_session).toHaveLength(2);
    await restoreBackup(db, backup);
    expect((await getCardioSession(db, id))!.route).not.toBeNull();
    expect(await listTrackPoints(db, running)).toEqual([]);
  });

  it('gives old backups the inferred tracking', async () => {
    const db = await seededDb();
    const backup = await exportBackup(db);
    backup.schemaVersion = 3;
    for (const row of backup.tables.cardio_activity!) {
      delete row.tracking;
      delete row.plan;
    }
    await restoreBackup(db, backup);
    expect(byName(await listCardio(db), 'Caminar', 2).tracking).toBe('gps');
  });
});

describe('routines done today', () => {
  it('lists the routines finished on a date', async () => {
    const db = await seededDb();
    const routine = (await listRoutines(db))[0];
    const slot = (await listSlots(db, routine.id))[0];
    const id = await startSession(db, routine.id, NOW);
    await logSet(db, id, slot, 10, T0 + 60_000);
    expect((await finishedRoutinesOn(db, '2026-11-02')).size).toBe(0);
    await finishSession(db, id, toProgressionSettings(await getSettings(db)), T0 + 3_600_000);
    const done = await finishedRoutinesOn(db, '2026-11-02');
    expect(done.get(routine.id)).toMatchObject({ id, setCount: 1 });
    // Imported sessions from the Excel do not count as done.
    expect((await finishedRoutinesOn(db, '2026-10-26')).size).toBe(0);
  });
});

it('migrates cleanly twice', async () => {
  const db = await createTestDb();
  await migrate(db);
  expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(4);
});
