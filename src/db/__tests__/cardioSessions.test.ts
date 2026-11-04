import { DEFAULT_PLANS } from '@/domain/cardioPlan';
import { decodeRoute } from '@/domain/gps';
import { DEFAULT_SPRINT_PLAN, encodeLaps, type Lap } from '@/domain/sprint';
import type { Db } from '../db';
import { exportBackup, restoreBackup } from '../maintenance';
import { MIGRATIONS, migrate } from '../migrations';
import { cardioLogOn, listCardio, setCardioDone, updateCardio, type CardioActivity } from '../repositories/cardio';
import {
  addTrackPoints,
  discardCardioSession,
  finishCardioSession,
  getActiveCardioSession,
  getCardioSession,
  finishSprintSession,
  lastTrackPoint,
  listSprintFixes,
  listTrackPoints,
  setSprintLaps,
  pauseCardioSession,
  resumeCardioSession,
  startCardioSession,
  type NewPoint,
} from '../repositories/cardioSessions';
import { cardioHistory } from '../repositories/progress';
import { finishSession, finishedSessionsOn, logSet, startSession } from '../repositories/sessions';
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
    // Recorded with the HIIT timer until 1.3.3; sprints since migration 8.
    expect(byName(all, 'Sprints + Bouncing', 3)).toMatchObject({ tracking: 'sprint', plan: null, sprint: DEFAULT_SPRINT_PLAN });
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
    expect(all.filter((a) => a.tracking === 'timer').map((a) => a.plan?.kind)).toEqual(['liss', 'miss']);
    expect(all.filter((a) => a.tracking === 'sprint').map((a) => a.sprint)).toEqual([DEFAULT_SPRINT_PLAN, DEFAULT_SPRINT_PLAN]);
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
    expect((await cardioLogOn(db, '2026-11-02')).get(caminar.id)).toEqual({ value: '840 m · 10 min', sessionId: id });
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
    expect((await cardioLogOn(db, '2026-11-02')).get(bici.id)?.value).toBe('30 min');
  });

  it('finishing while paused ends at the pause', async () => {
    const db = await seededDb();
    const bici = byName(await listCardio(db), 'Bici estática', 1);
    const id = await startCardioSession(db, bici, T0);
    await pauseCardioSession(db, id, T0 + 20 * 60_000);
    await finishCardioSession(db, id, T0 + 60 * 60_000);
    expect((await getCardioSession(db, id))!.finishedAt).toBe(T0 + 20 * 60_000);
    expect((await cardioLogOn(db, '2026-11-02')).get(bici.id)?.value).toBe('20 min');
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
      ['Caminar', '420 m · 5 min', morning],
      ['Caminar', '168 m · 2 min', evening],
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

  it('turns the HIIT sprints of a backup older than 8 into sprints', async () => {
    const db = await seededDb();
    const backup = await exportBackup(db);
    backup.schemaVersion = 7;
    for (const row of backup.tables.cardio_activity!) {
      if (row.tracking === 'sprint') {
        row.tracking = 'timer';
        row.plan = JSON.stringify(DEFAULT_PLANS.hiit);
      }
    }
    await restoreBackup(db, backup);
    expect(byName(await listCardio(db), 'Sprints + Bouncing', 6)).toMatchObject({ tracking: 'sprint', sprint: DEFAULT_SPRINT_PLAN });
  });
});

describe('sprints', () => {
  const lap = (startAt: number, stopAt: number | null): Lap => ({ startAt, stopAt, distanceM: null, topSpeedMs: null, quality: null });

  it('stores the fixes of a sprints session with their Doppler speed and arrival time', async () => {
    const db = await seededDb();
    const sprints = byName(await listCardio(db), 'Sprints + Bouncing', 3);
    const id = await startCardioSession(db, sprints, T0);
    const session = (await getCardioSession(db, id))!;
    expect(session).toMatchObject({ tracking: 'sprint', sprint: DEFAULT_SPRINT_PLAN, laps: [], lapsJson: '[]' });
    const fix: NewPoint = { t: T0 + 1000, lat: 40.4, lon: -3.7, accuracy: 4, speed: 7.5, altitude: null, receivedAt: T0 + 1400 };
    expect(await addTrackPoints(db, [fix])).toBe(1);
    expect(await listSprintFixes(db, id, T0, T0 + 2000)).toEqual([
      { t: T0 + 1000, lat: 40.4, lon: -3.7, accuracy: 4, speed: 7.5, receivedAt: T0 + 1400 },
    ]);
    expect(await lastTrackPoint(db, id)).toEqual({ t: T0 + 1000, accuracy: 4, receivedAt: T0 + 1400 });
  });

  it('writes the laps only once for the two taps of a double tap', async () => {
    const db = await seededDb();
    const id = await startCardioSession(db, byName(await listCardio(db), 'Sprints + Bouncing', 3), T0);
    const next = encodeLaps([lap(T0 + 5000, null)]);
    expect(await setSprintLaps(db, id, '[]', next)).toBe(true);
    expect(await setSprintLaps(db, id, '[]', next)).toBe(false);
    expect((await getCardioSession(db, id))!.laps).toEqual([lap(T0 + 5000, null)]);
  });

  it('finishes with the measured laps, the result on Hoy and no points left', async () => {
    const db = await seededDb();
    const sprints = byName(await listCardio(db), 'Sprints + Bouncing', 3);
    const id = await startCardioSession(db, sprints, T0);
    await addTrackPoints(db, [{ t: T0 + 6000, lat: 40.4, lon: -3.7, accuracy: 4, speed: 8, altitude: null }]);
    const laps: Lap[] = [
      { ...lap(T0 + 5000, T0 + 17_000), distanceM: 76.04, topSpeedMs: 8.5, quality: 'good' },
      { ...lap(T0 + 107_000, T0 + 118_800), distanceM: null, topSpeedMs: null, quality: 'none' },
    ];
    await finishSprintSession(db, id, T0 + 200_000, laps, '[[],[]]');
    const done = (await getCardioSession(db, id))!;
    expect(done).toMatchObject({ status: 'finished', finishedAt: T0 + 200_000, route: null });
    expect(done.distanceM).toBeCloseTo(76, 0);
    expect(done.laps).toEqual([{ ...laps[0], distanceM: 76 }, laps[1]]);
    expect(await listTrackPoints(db, id)).toEqual([]);
    expect((await cardioLogOn(db, '2026-11-02')).get(sprints.id)?.value).toBe('2 sprints · máx. 30,6\u00A0km/h');
    const [entry] = (await cardioHistory(db)).flatMap((d) => d.activities).filter((a) => a.kind === 'sprint');
    expect(entry).toMatchObject({ sessionId: id, value: '2 sprints · máx. 30,6\u00A0km/h', sprint: { count: 2, topSpeedMs: 8.5, bestTimeMs: 11_800 } });
  });
});

describe('routines done today', () => {
  it('lists the routines finished on a date', async () => {
    const db = await seededDb();
    const routine = (await listRoutines(db))[0];
    const slot = (await listSlots(db, routine.id))[0];
    const id = await startSession(db, routine.id, NOW);
    await logSet(db, id, slot, 10, T0 + 60_000);
    expect(await finishedSessionsOn(db, '2026-11-02')).toEqual([]);
    await finishSession(db, id, toProgressionSettings(await getSettings(db)), T0 + 3_600_000);
    const done = await finishedSessionsOn(db, '2026-11-02');
    expect(done).toMatchObject([{ id, routineId: routine.id, setCount: 1, looseFirst: null, looseCount: 0 }]);
    // Imported sessions from the Excel do not count as done.
    expect(await finishedSessionsOn(db, '2026-10-26')).toEqual([]);
  });
});

it('migrates cleanly twice', async () => {
  const db = await createTestDb();
  await migrate(db);
  expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(MIGRATIONS.length);
});

describe('cardio of another day', () => {
  it('is checked off today like today\'s', async () => {
    const db = await seededDb();
    const sprints = byName(await listCardio(db), 'Sprints + Bouncing', 3);
    await setCardioDone(db, '2026-11-02', sprints, true);
    expect((await cardioLogOn(db, '2026-11-02')).get(sprints.id)).toEqual({ value: null, sessionId: null });
  });

  it('deleting a finished session takes its log of the day with it', async () => {
    const db = await seededDb();
    const caminar = byName(await listCardio(db), 'Caminar', 1);
    const id = await startCardioSession(db, caminar, T0);
    await addTrackPoints(db, walk(T0, 300));
    await finishCardioSession(db, id, T0 + 300_000);
    expect((await cardioLogOn(db, '2026-11-02')).has(caminar.id)).toBe(true);
    await discardCardioSession(db, id);
    expect((await cardioLogOn(db, '2026-11-02')).has(caminar.id)).toBe(false);
    expect((await cardioHistory(db)).flatMap((d) => d.activities)).toEqual([]);
  });
});
