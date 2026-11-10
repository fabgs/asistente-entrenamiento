import { cardioPool } from '@/domain/cardioPool';
import { DEFAULT_SPRINT_PLAN } from '@/domain/sprint';
import type { Db } from '../db';
import { DEMO_SEED as SEED } from '../demoSeed';
import { exportBackup, restoreBackup } from '../maintenance';
import { MIGRATIONS } from '../migrations';
import { addCardio, cardioForWeekday, cardioLogOn, getCardio, listCardio, setCardioDone, type CardioActivity } from '../repositories/cardio';
import {
  addTrackPoints,
  cardioSessionsOn,
  discardCardioSession,
  finishCardioSession,
  finishSprintSession,
  getCardioSession,
  setSprintStraight,
  startCardioSession,
  type NewPoint,
} from '../repositories/cardioSessions';
import { getSlot, listRoutines, listSlots, type Slot } from '../repositories/routines';
import { finishSession, logSet, startSession } from '../repositories/sessions';
import { getSettings, toProgressionSettings } from '../repositories/settings';
import { applyChange, listOpenChanges, setSlotWeightManually, undoChange } from '../repositories/weightChanges';
import { importSeed } from '../seed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 2, 7, 0);
const T0 = NOW.getTime();
const TODAY = '2026-11-02';
const DAY = 24 * 3_600_000;
const DEG_PER_M = 1 / 111_195;

async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, SEED, NOW);
  return db;
}

/** Fixes walking north at 1.4 m/s every 3 s. */
function walk(t0: number, seconds: number): NewPoint[] {
  const points: NewPoint[] = [];
  for (let s = 0; s <= seconds; s += 3) {
    points.push({ t: t0 + s * 1000, lat: 40.4 + s * 1.4 * DEG_PER_M, lon: -3.7, accuracy: 5, speed: 1.4, altitude: 650 });
  }
  return points;
}

const byName = (all: CardioActivity[], name: string, weekday: number | null) => all.find((a) => a.name === name && a.weekday === weekday)!;

/** A finished walk of `seconds`, started `offsetMs` after T0. */
async function walked(db: Db, activity: CardioActivity, offsetMs: number, seconds: number): Promise<number> {
  const id = await startCardioSession(db, activity, T0 + offsetMs);
  await addTrackPoints(db, walk(T0 + offsetMs, seconds));
  await finishCardioSession(db, id, T0 + offsetMs + seconds * 1000);
  return id;
}

describe('cardio «sin día» (migration 14)', () => {
  it('migrates a database of version 13: every activity keeps its day', async () => {
    const db = await createTestDb({ upTo: 13 });
    await db.runAsync(`INSERT INTO cardio_activity (weekday, name, tracking) VALUES (3, 'Caminar', 'gps')`);
    await db.execAsync(MIGRATIONS[13]);
    const columns = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(cardio_activity)')).map((c) => c.name);
    expect(columns).toContain('no_day');
    expect(await listCardio(db)).toMatchObject([{ name: 'Caminar', weekday: 3 }]);
  });

  it('adds an activity of no day: after those of the week, in its own order, on no weekday', async () => {
    const db = await seededDb();
    const fields = { name: 'Nadar', target: '1 km', intensity: null, notes: null, tracking: 'check' as const };
    const swim = await addCardio(db, null, fields);
    const row = await addCardio(db, null, { ...fields, name: 'Remo' });
    const monday = await addCardio(db, 1, { ...fields, name: 'Estirar' });

    expect(await getCardio(db, swim)).toMatchObject({ name: 'Nadar', weekday: null });
    const all = await listCardio(db);
    expect(all.slice(-2).map((a) => [a.name, a.weekday])).toEqual([
      ['Nadar', null],
      ['Remo', null],
    ]);
    // Its filler weekday (the column cannot be empty) puts it on no day, and Monday's count is its own.
    for (const day of [1, 2, 3, 4, 5, 6, 7] as const) {
      expect((await cardioForWeekday(db, day)).map((a) => a.id)).not.toContain(swim);
    }
    expect((await cardioForWeekday(db, 1)).at(-1)).toMatchObject({ id: monday, name: 'Estirar' });
    const positions = await db.getAllAsync<{ id: number; position: number }>('SELECT id, position FROM cardio_activity WHERE no_day = 1 ORDER BY id');
    expect(positions).toEqual([
      { id: swim, position: 0 },
      { id: row, position: 1 },
    ]);
    // In «Hacer otro cardio» every day, after what was done today.
    expect(cardioPool(all, 1, new Map()).map((e) => e.activity.name)).toContain('Nadar');
  });

  it('goes in the copy, and a copy from before restores with every activity on its day', async () => {
    const db = await seededDb();
    const swim = await addCardio(db, null, { name: 'Nadar', target: null, intensity: null, notes: null, tracking: 'gps' });
    const backup = await exportBackup(db);
    await restoreBackup(db, backup);
    expect((await getCardio(db, swim))?.weekday).toBeNull();

    const old = structuredClone(backup);
    old.schemaVersion = 13;
    for (const row of old.tables.cardio_activity as Record<string, unknown>[]) delete row.no_day;
    await restoreBackup(db, old);
    // Without the mark it is the weekday the column holds: nothing a 1.4.x copy could have.
    expect((await listCardio(db)).every((a) => a.weekday !== null)).toBe(true);
  });
});

describe('the same cardio twice in a day', () => {
  it('lists every session finished today, in order, with its result', async () => {
    const db = await seededDb();
    const all = await listCardio(db);
    const caminar = byName(all, 'Caminar', 1);
    const morning = await walked(db, caminar, 0, 300);
    const evening = await walked(db, caminar, 10 * 3_600_000, 120);
    await setCardioDone(db, TODAY, byName(all, 'Bici estática', 1), true);
    // One in progress and one of another day are not of «Hecho».
    await startCardioSession(db, caminar, T0 + 11 * 3_600_000);
    await walked(db, caminar, DAY, 60);

    expect(await cardioSessionsOn(db, TODAY)).toEqual([
      { id: morning, activityId: caminar.id, title: 'Caminar', tracking: 'gps', result: '420 m · 5 min' },
      { id: evening, activityId: caminar.id, title: 'Caminar', tracking: 'gps', result: '168 m · 2 min' },
    ]);
    expect(await cardioSessionsOn(db, '2026-11-01')).toEqual([]);
  });

  it('keeps the day done when one of two sessions is deleted, pointing its log to the one left', async () => {
    const db = await seededDb();
    const caminar = byName(await listCardio(db), 'Caminar', 1);
    const morning = await walked(db, caminar, 0, 300);
    const evening = await walked(db, caminar, 10 * 3_600_000, 120);
    expect((await cardioLogOn(db, TODAY)).get(caminar.id)).toEqual({ value: '168 m · 2 min', sessionId: evening });

    await discardCardioSession(db, evening);
    expect((await cardioLogOn(db, TODAY)).get(caminar.id)).toEqual({ value: '420 m · 5 min', sessionId: morning });
    expect((await cardioSessionsOn(db, TODAY)).map((s) => s.id)).toEqual([morning]);
    // The last one takes the day's log with it.
    await discardCardioSession(db, morning);
    expect((await cardioLogOn(db, TODAY)).has(caminar.id)).toBe(false);
  });

  it('deleting the earlier of two leaves the log on the later one', async () => {
    const db = await seededDb();
    const caminar = byName(await listCardio(db), 'Caminar', 1);
    const morning = await walked(db, caminar, 0, 300);
    const evening = await walked(db, caminar, 10 * 3_600_000, 120);
    await discardCardioSession(db, morning);
    expect((await cardioLogOn(db, TODAY)).get(caminar.id)).toEqual({ value: '168 m · 2 min', sessionId: evening });
  });

  it('a walk checked off without recording it has no result, and recording it later fills the same row', async () => {
    const db = await seededDb();
    const caminar = byName(await listCardio(db), 'Caminar', 1);
    await setCardioDone(db, TODAY, caminar, true);
    expect((await cardioLogOn(db, TODAY)).get(caminar.id)).toEqual({ value: null, sessionId: null });
    expect(await cardioSessionsOn(db, TODAY)).toEqual([]);

    const id = await walked(db, caminar, 3_600_000, 300);
    expect((await cardioLogOn(db, TODAY)).get(caminar.id)).toEqual({ value: '420 m · 5 min', sessionId: id });
    const rows = await db.getAllAsync('SELECT id FROM cardio_log WHERE date = ? AND activity_id = ?', TODAY, caminar.id);
    expect(rows).toHaveLength(1);
  });
});

describe('the straight of a sprints session', () => {
  it('is kept in the copy of the plan of the session, also once finished, and taken away with null', async () => {
    const db = await seededDb();
    const sprints = byName(await listCardio(db), 'Sprints + Bouncing', 3);
    const id = await startCardioSession(db, sprints, T0);
    expect((await getCardioSession(db, id))!.sprint).toEqual(DEFAULT_SPRINT_PLAN);

    await setSprintStraight(db, id, 60);
    expect((await getCardioSession(db, id))!.sprint).toEqual({ ...DEFAULT_SPRINT_PLAN, straightM: 60 });
    // The activity is not touched: it is of this session.
    expect((await getCardio(db, sprints.id))!.sprint).toEqual(DEFAULT_SPRINT_PLAN);

    await finishSprintSession(db, id, T0 + 600_000, [], null);
    await setSprintStraight(db, id, 80);
    expect((await getCardioSession(db, id))!.sprint!.straightM).toBe(80);
    await setSprintStraight(db, id, null);
    expect((await getCardioSession(db, id))!.sprint!.straightM).toBeNull();

    // Not a sprints session: nothing to write.
    const walkId = await walked(db, byName(await listCardio(db), 'Caminar', 1), DAY, 60);
    await setSprintStraight(db, walkId, 60);
    expect((await getCardioSession(db, walkId))!.sprint).toBeNull();
  });
});

describe('the deload, from the database', () => {
  /** A finished workout `days` after NOW with those reps of the slot. */
  async function workout(db: Db, routineId: number, slot: Slot, days: number, reps: number[]): Promise<number> {
    const at = new Date(T0 + days * DAY);
    const id = await startSession(db, routineId, at);
    for (const [i, r] of reps.entries()) await logSet(db, id, slot, r, at.getTime() + (i + 1) * 60_000);
    await finishSession(db, id, toProgressionSettings(await getSettings(db)), at.getTime() + 3_600_000);
    return id;
  }

  it('after three sessions that go nowhere, leaves a suggestion of more than one increment that is applied and undone', async () => {
    const db = await seededDb();
    const routine = (await listRoutines(db))[0];
    const remo = (await listSlots(db, routine.id)).find((s) => s.exerciseName.startsWith('Remo con barra'))!;
    // 60 kg on 10–12 reps: within the range, the same three times.
    await setSlotWeightManually(db, remo.id, 60);
    const slot = (await getSlot(db, remo.id))!;
    const open = async () => (await listOpenChanges(db)).find((c) => c.slotId === slot.id);

    await workout(db, routine.id, slot, 1, [11, 11, 10]);
    expect(await open()).toBeUndefined();
    await workout(db, routine.id, slot, 2, [11, 11, 10]);
    expect(await open()).toBeUndefined();
    const third = await workout(db, routine.id, slot, 3, [11, 10, 10]);
    const change = (await open())!;
    expect(change).toMatchObject({
      sessionId: third,
      fromKg: 60,
      toKg: 55,
      status: 'pending',
      reason: 'Tres sesiones seguidas sin mejorar las reps: descarga para volver a subir',
    });

    await applyChange(db, change.id, T0 + 4 * DAY);
    expect((await getSlot(db, slot.id))!.weightKg).toBe(55);
    await undoChange(db, change.id);
    expect((await getSlot(db, slot.id))!.weightKg).toBe(60);
    expect((await open())?.status).toBe('pending');
  });

  it('ignored, it does not come back at the next session, only three flat ones later', async () => {
    const db = await seededDb();
    const routine = (await listRoutines(db))[0];
    const remo = (await listSlots(db, routine.id)).find((s) => s.exerciseName.startsWith('Remo con barra'))!;
    await setSlotWeightManually(db, remo.id, 60);
    const slot = (await getSlot(db, remo.id))!;
    const openTo = async () => (await listOpenChanges(db)).find((c) => c.slotId === slot.id)?.toKg ?? null;
    const flat = [11, 11, 10];

    for (const day of [1, 2, 3]) await workout(db, routine.id, slot, day, flat);
    expect(await openTo()).toBe(55);
    // The fourth and the fifth expire it and suggest nothing; the sixth brings it back.
    await workout(db, routine.id, slot, 4, flat);
    expect(await openTo()).toBeNull();
    await workout(db, routine.id, slot, 5, flat);
    expect(await openTo()).toBeNull();
    await workout(db, routine.id, slot, 6, flat);
    expect(await openTo()).toBe(55);
  });
});
