import type { Db } from '../db';
import { setCardioDone, cardioForWeekday } from '../repositories/cardio';
import { addTrackPoints, finishCardioSession, startCardioSession, type NewPoint } from '../repositories/cardioSessions';
import {
  cardioEntries,
  cardioHistory,
  exerciseSessions,
  exercisesWithHistory,
  exerciseWeightChanges,
  workoutHistory,
} from '../repositories/progress';
import { listRoutines, listSlots, type Slot } from '../repositories/routines';
import {
  deleteFinishedSession,
  deleteSet,
  finishSession,
  getSession,
  listSets,
  logSet,
  refreshRecommendations,
  setSessionTitle,
  startSession,
  updateSetReps,
  updateSetWeight,
} from '../repositories/sessions';
import { getSettings, toProgressionSettings } from '../repositories/settings';
import { applyChange, listChangesForSession, listOpenChanges } from '../repositories/weightChanges';
import { importSeed } from '../seed';
import { DEMO_SEED as SEED } from '../demoSeed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0);

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, SEED, NOW);
  return db;
}

async function remoSlot(db: Db): Promise<Slot> {
  const routine = (await listRoutines(db))[0];
  return (await listSlots(db, routine.id)).find((s) => s.exerciseName === 'Remo con barra (90º)')!;
}

/** Trains the remo in a new session and finishes it. */
async function trainRemo(db: Db, reps: number[], at: Date): Promise<number> {
  const slot = await remoSlot(db);
  const sessionId = await startSession(db, slot.routineId, at);
  for (const [i, r] of reps.entries()) await logSet(db, sessionId, slot, r, at.getTime() + i);
  await finishSession(db, sessionId, toProgressionSettings(await getSettings(db)), at.getTime() + 100);
  return sessionId;
}

describe('exercise history', () => {
  it('lists the sessions of an exercise newest first, Excel ones included', async () => {
    const db = await seededDb();
    const slot = await remoSlot(db);
    const sessionId = await trainRemo(db, [11, 11, 10], NOW);

    const sessions = await exerciseSessions(db, slot.exerciseId);
    expect(sessions[0]).toMatchObject({
      sessionId,
      routineName: 'Día 1: Torso (Empuje Pesado + Tirón Volumen)',
      imported: false,
      sets: [
        { weightKg: 35, reps: 11 },
        { weightKg: 35, reps: 11 },
        { weightKg: 35, reps: 10 },
      ],
    });
    expect(sessions.slice(1).every((s) => s.imported)).toBe(true);
  });

  it('summarizes exercises that have history', async () => {
    const db = await seededDb();
    const overview = await exercisesWithHistory(db);
    expect(overview.find((e) => e.name === 'Fondos en paralelas lastrados')).toMatchObject({
      sessions: 2,
      topWeightKg: 15,
    });
    expect(overview.find((e) => e.name === 'Dominadas pronas')?.topWeightKg).toBeNull();
  });

  it('lists decided weight changes of the exercise', async () => {
    const db = await seededDb();
    const slot = await remoSlot(db);
    const change = (await listOpenChanges(db)).find((c) => c.slotId === slot.id)!;
    await applyChange(db, change.id, 5);
    expect(await exerciseWeightChanges(db, slot.exerciseId)).toMatchObject([
      { fromKg: 35, toKg: 37.5, status: 'applied', routineName: expect.stringContaining('Día 1') },
    ]);
  });
});

describe('editing a finished session', () => {
  it('recomputes the recommendation after correcting reps', async () => {
    const db = await seededDb();
    const slot = await remoSlot(db);
    const sessionId = await trainRemo(db, [11, 11, 11], NOW);
    expect((await listOpenChanges(db)).some((c) => c.slotId === slot.id)).toBe(false);

    for (const set of await listSets(db, sessionId)) await updateSetReps(db, set.id, 14);
    await refreshRecommendations(db, sessionId, toProgressionSettings(await getSettings(db)));
    expect((await listChangesForSession(db, sessionId)).filter((c) => c.status === 'pending')).toMatchObject([
      { slotId: slot.id, toKg: 37.5 },
    ]);
  });

  it('keeps an already applied recommendation', async () => {
    const db = await seededDb();
    const sessionId = await trainRemo(db, [14, 14, 14], NOW);
    const change = (await listChangesForSession(db, sessionId))[0];
    await applyChange(db, change.id, 5);

    for (const set of await listSets(db, sessionId)) await updateSetReps(db, set.id, 8);
    await refreshRecommendations(db, sessionId, toProgressionSettings(await getSettings(db)));
    expect((await listChangesForSession(db, sessionId)).map((c) => c.status)).toEqual(['applied']);
  });

  it('does not touch recommendations when a newer session exists', async () => {
    const db = await seededDb();
    const older = await trainRemo(db, [11, 11, 11], NOW);
    await trainRemo(db, [14, 14, 14], new Date(2026, 10, 9, 7, 0));
    const openBefore = await listOpenChanges(db);

    for (const set of await listSets(db, older)) await updateSetReps(db, set.id, 6);
    await refreshRecommendations(db, older, toProgressionSettings(await getSettings(db)));
    expect(await listOpenChanges(db)).toEqual(openBefore);
  });

  it('drops the recommendation when every set of the exercise is deleted', async () => {
    const db = await seededDb();
    const sessionId = await trainRemo(db, [14, 14, 14], NOW);
    for (const set of await listSets(db, sessionId)) await deleteSet(db, set.id);
    await refreshRecommendations(db, sessionId, toProgressionSettings(await getSettings(db)));
    expect((await listChangesForSession(db, sessionId)).map((c) => c.status)).toEqual(['expired']);
  });

  it('corrects the weight of a set', async () => {
    const db = await seededDb();
    const sessionId = await trainRemo(db, [11], NOW);
    const [set] = await listSets(db, sessionId);
    await updateSetWeight(db, set.id, 40);
    expect((await listSets(db, sessionId))[0].weightKg).toBe(40);
  });

  it('deletes a session and drops its open recommendations', async () => {
    const db = await seededDb();
    const slot = await remoSlot(db);
    const sessionId = await trainRemo(db, [14, 14, 14], NOW);
    expect((await listOpenChanges(db)).some((c) => c.sessionId === sessionId)).toBe(true);

    await deleteFinishedSession(db, sessionId);
    expect(await getSession(db, sessionId)).toBeNull();
    expect(await listSets(db, sessionId)).toEqual([]);
    expect((await listOpenChanges(db)).some((c) => c.slotId === slot.id && c.sessionId === null)).toBe(false);
  });
});

describe('workout history', () => {
  it('lists every finished workout newest first, with its title and sets', async () => {
    const db = await seededDb();
    const sessionId = await trainRemo(db, [11, 11, 10], NOW);
    await setSessionTitle(db, sessionId, 'Remo con Ana');

    const history = await workoutHistory(db);
    expect(history[0]).toMatchObject({
      id: sessionId,
      title: 'Remo con Ana',
      routineName: 'Día 1: Torso (Empuje Pesado + Tirón Volumen)',
      imported: false,
      setCount: 3,
    });
    expect(history.slice(1).every((s) => s.imported)).toBe(true);
    expect(history.map((s) => s.startedAt)).toEqual([...history.map((s) => s.startedAt)].sort((a, b) => b - a));
    expect((await exerciseSessions(db, (await remoSlot(db)).exerciseId))[0].title).toBe('Remo con Ana');
  });
});

/** Fixes walking north at 1.4 m/s every 3 s. */
function walkPoints(t0: number, seconds: number): NewPoint[] {
  const points: NewPoint[] = [];
  for (let s = 0; s <= seconds; s += 3) {
    points.push({ t: t0 + s * 1000, lat: 40.4 + (s * 1.4) / 111_195, lon: -3.7, accuracy: 5, speed: 1.4, altitude: 650 });
  }
  return points;
}

describe('cardio history', () => {
  it('groups the activities done per day, newest first', async () => {
    const db = await seededDb();
    const [walk, bike] = await cardioForWeekday(db, 1);
    await setCardioDone(db, '2026-10-26', walk, true);
    await setCardioDone(db, '2026-11-02', walk, true);
    await setCardioDone(db, '2026-11-02', bike, true);
    await setCardioDone(db, '2026-11-02', bike, false);

    const checked = { name: 'Caminar', kind: 'check', value: null, sessionId: null, route: null, startedAt: null, activeMs: null };
    expect(await cardioHistory(db)).toMatchObject([
      { date: '2026-11-02', activities: [checked] },
      { date: '2026-10-26', activities: [checked] },
    ]);
  });

  it('lists each walk with its start, distance and active time, the latest first', async () => {
    const db = await seededDb();
    const [walk, bike] = await cardioForWeekday(db, 1);
    const t0 = NOW.getTime();
    const morning = await startCardioSession(db, walk, t0);
    await addTrackPoints(db, walkPoints(t0, 300));
    await finishCardioSession(db, morning, t0 + 300_000);
    const evening = await startCardioSession(db, walk, t0 + 36_000_000);
    await addTrackPoints(db, walkPoints(t0 + 36_000_000, 120));
    await finishCardioSession(db, evening, t0 + 36_120_000);
    await setCardioDone(db, '2026-11-02', bike, true);
    await setCardioDone(db, '2026-10-26', walk, true);

    const entries = await cardioEntries(db);
    expect(entries.map((e) => [e.date, e.name, e.kind, e.sessionId])).toEqual([
      ['2026-11-02', 'Caminar', 'gps', evening],
      ['2026-11-02', 'Caminar', 'gps', morning],
      ['2026-11-02', 'Bici estática', 'check', null],
      ['2026-10-26', 'Caminar', 'check', null],
    ]);
    expect(entries[1]).toMatchObject({ startedAt: t0, activeMs: 300_000, key: `s${morning}` });
    expect(entries[1].distanceM).toBeCloseTo(420, -1);
    expect(entries[1].route).not.toBeNull();
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
  });
});
