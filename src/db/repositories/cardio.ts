import { parsePlan, type CardioPlan, type CardioTracking } from '@/domain/cardioPlan';
import type { IsoWeekday } from '@/domain/types';
import { int, type Db } from '../db';

export interface CardioActivity {
  id: number;
  weekday: IsoWeekday;
  name: string;
  target: string | null;
  intensity: string | null;
  notes: string | null;
  tracking: CardioTracking;
  plan: CardioPlan | null;
}

type CardioRow = Omit<CardioActivity, 'plan'> & { plan: string | null };

const toActivity = (row: CardioRow): CardioActivity => ({ ...row, plan: parsePlan(row.plan) });

export async function listCardio(db: Db): Promise<CardioActivity[]> {
  const rows = await db.getAllAsync<CardioRow>(
    `SELECT id, weekday, name, target, intensity, notes, tracking, plan FROM cardio_activity
     WHERE archived = 0 ORDER BY weekday, position, id`,
  );
  return rows.map(toActivity);
}

export async function getCardio(db: Db, id: number): Promise<CardioActivity | null> {
  const row = await db.getFirstAsync<CardioRow>(
    'SELECT id, weekday, name, target, intensity, notes, tracking, plan FROM cardio_activity WHERE id = ?',
    id,
  );
  return row ? toActivity(row) : null;
}

export async function cardioForWeekday(db: Db, weekday: IsoWeekday): Promise<CardioActivity[]> {
  return (await listCardio(db)).filter((c) => c.weekday === weekday);
}

/** Activity ids marked as done on a date. */
export async function cardioDoneOn(db: Db, date: string): Promise<Set<number>> {
  return new Set((await cardioLogOn(db, date)).keys());
}

export interface CardioDone {
  value: string | null;
  sessionId: number | null;
}

/** What was done on a date, by activity id: the result ("5,2 km · 58 min") and its session. */
export async function cardioLogOn(db: Db, date: string): Promise<Map<number, CardioDone>> {
  const rows = await db.getAllAsync<{ activity_id: number; value: string | null; session_id: number | null }>(
    'SELECT activity_id, value, session_id FROM cardio_log WHERE date = ? AND activity_id IS NOT NULL AND done = 1',
    date,
  );
  return new Map(rows.map((r) => [r.activity_id, { value: r.value, sessionId: r.session_id }]));
}

export async function setCardioDone(
  db: Db,
  date: string,
  activity: CardioActivity,
  done: boolean,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO cardio_log (date, activity_id, name, done) VALUES (?, ?, ?, ?)
     ON CONFLICT(date, activity_id) DO UPDATE SET done = excluded.done`,
    date,
    activity.id,
    activity.name,
    int(done),
  );
}

export interface CardioFields {
  name: string;
  target: string | null;
  intensity: string | null;
  notes: string | null;
  tracking?: CardioTracking;
  plan?: CardioPlan | null;
}

export async function addCardio(db: Db, weekday: IsoWeekday, fields: CardioFields): Promise<number> {
  const row = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cardio_activity WHERE weekday = ?',
    weekday,
  );
  const result = await db.runAsync(
    `INSERT INTO cardio_activity (weekday, name, target, intensity, notes, position, tracking, plan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    weekday,
    fields.name,
    fields.target,
    fields.intensity,
    fields.notes,
    row?.next ?? 0,
    fields.tracking ?? 'check',
    fields.plan ? JSON.stringify(fields.plan) : null,
  );
  return result.lastInsertRowId;
}

export async function updateCardio(db: Db, id: number, fields: CardioFields): Promise<void> {
  await db.runAsync(
    'UPDATE cardio_activity SET name = ?, target = ?, intensity = ?, notes = ? WHERE id = ?',
    fields.name,
    fields.target,
    fields.intensity,
    fields.notes,
    id,
  );
  if (fields.tracking) {
    await db.runAsync(
      'UPDATE cardio_activity SET tracking = ?, plan = ? WHERE id = ?',
      fields.tracking,
      fields.plan ? JSON.stringify(fields.plan) : null,
      id,
    );
  }
}

/** What `updateCardio` writes, as the activity has it now (a plan only for the timer). */
export function cardioFieldsOf(activity: CardioActivity): Required<CardioFields> {
  return {
    name: activity.name,
    target: activity.target,
    intensity: activity.intensity,
    notes: activity.notes,
    tracking: activity.tracking,
    plan: activity.tracking === 'timer' ? activity.plan : null,
  };
}

/**
 * True when both save the same activity: texts as the editor saves them (trimmed, empty as none)
 * and plans field by field.
 */
export function sameCardioFields(a: Required<CardioFields>, b: Required<CardioFields>): boolean {
  const text = (s: string | null) => s?.trim() || null;
  const plan = (p: CardioPlan | null) => (p ? JSON.stringify(Object.entries(p).sort(([x], [y]) => x.localeCompare(y))) : null);
  return (
    a.name.trim() === b.name.trim() &&
    text(a.target) === text(b.target) &&
    text(a.intensity) === text(b.intensity) &&
    text(a.notes) === text(b.notes) &&
    a.tracking === b.tracking &&
    plan(a.plan) === plan(b.plan)
  );
}

/** Hides the activity; days already marked as done keep their log. */
export async function archiveCardio(db: Db, id: number): Promise<void> {
  await db.runAsync('UPDATE cardio_activity SET archived = 1 WHERE id = ?', id);
}

/** Brings back an activity just removed (the «Deshacer» of «Actividad quitada»). */
export async function unarchiveCardio(db: Db, id: number): Promise<void> {
  await db.runAsync('UPDATE cardio_activity SET archived = 0 WHERE id = ?', id);
}
