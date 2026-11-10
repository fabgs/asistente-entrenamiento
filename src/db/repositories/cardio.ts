import { parsePlan, type CardioPlan, type CardioTracking } from '@/domain/cardioPlan';
import { parseSprintPlan, type SprintPlan } from '@/domain/sprint';
import type { IsoWeekday } from '@/domain/types';
import { int, type Db } from '../db';

export interface CardioActivity {
  id: number;
  /** Null for an activity «sin día» (1.5.0): of no weekday, offered in «Hacer otro cardio». */
  weekday: IsoWeekday | null;
  name: string;
  target: string | null;
  intensity: string | null;
  notes: string | null;
  tracking: CardioTracking;
  /** The timer plan (tracking 'timer'). */
  plan: CardioPlan | null;
  /** The sprints plan (tracking 'sprint'), stored in the same column. */
  sprint: SprintPlan | null;
}

type CardioRow = Omit<CardioActivity, 'plan' | 'sprint' | 'weekday'> & { plan: string | null; weekday: IsoWeekday; noDay: number };

const COLUMNS = 'id, weekday, no_day AS noDay, name, target, intensity, notes, tracking, plan';

const toActivity = ({ noDay, ...row }: CardioRow): CardioActivity => ({
  ...row,
  // The weekday stored with `no_day` is a filler for the column's CHECK.
  weekday: noDay ? null : row.weekday,
  plan: parsePlan(row.plan),
  sprint: row.tracking === 'sprint' ? parseSprintPlan(row.plan) : null,
});

const planJson = (fields: CardioFields) => {
  const plan = fields.tracking === 'sprint' ? fields.sprint : fields.plan;
  return plan ? JSON.stringify(plan) : null;
};

/** The weekly cardio in its order: each day's, then the activities «sin día». */
export async function listCardio(db: Db): Promise<CardioActivity[]> {
  const rows = await db.getAllAsync<CardioRow>(
    `SELECT ${COLUMNS} FROM cardio_activity WHERE archived = 0 ORDER BY no_day, weekday, position, id`,
  );
  return rows.map(toActivity);
}

export async function getCardio(db: Db, id: number): Promise<CardioActivity | null> {
  const row = await db.getFirstAsync<CardioRow>(`SELECT ${COLUMNS} FROM cardio_activity WHERE id = ?`, id);
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
  sprint?: SprintPlan | null;
}

/** A new activity at the end of its day, or of those «sin día» (`weekday` null). */
export async function addCardio(db: Db, weekday: IsoWeekday | null, fields: CardioFields): Promise<number> {
  const row =
    weekday === null
      ? await db.getFirstAsync<{ next: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cardio_activity WHERE no_day = 1')
      : await db.getFirstAsync<{ next: number }>(
          'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cardio_activity WHERE no_day = 0 AND weekday = ?',
          weekday,
        );
  const result = await db.runAsync(
    `INSERT INTO cardio_activity (weekday, no_day, name, target, intensity, notes, position, tracking, plan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    weekday ?? 1,
    weekday === null ? 1 : 0,
    fields.name,
    fields.target,
    fields.intensity,
    fields.notes,
    row?.next ?? 0,
    fields.tracking ?? 'check',
    planJson(fields),
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
      planJson(fields),
      id,
    );
  }
}

/** What `updateCardio` writes, as the activity has it now (a plan only for the timer or the sprints). */
export function cardioFieldsOf(activity: CardioActivity): Required<CardioFields> {
  return {
    name: activity.name,
    target: activity.target,
    intensity: activity.intensity,
    notes: activity.notes,
    tracking: activity.tracking,
    plan: activity.tracking === 'timer' ? activity.plan : null,
    sprint: activity.tracking === 'sprint' ? activity.sprint : null,
  };
}

/**
 * True when both save the same activity: texts as the editor saves them (trimmed, empty as none)
 * and plans field by field.
 */
export function sameCardioFields(a: Required<CardioFields>, b: Required<CardioFields>): boolean {
  const text = (s: string | null) => s?.trim() || null;
  const plan = (p: CardioPlan | SprintPlan | null) => (p ? JSON.stringify(Object.entries(p).sort(([x], [y]) => x.localeCompare(y))) : null);
  return (
    a.name.trim() === b.name.trim() &&
    text(a.target) === text(b.target) &&
    text(a.intensity) === text(b.intensity) &&
    text(a.notes) === text(b.notes) &&
    a.tracking === b.tracking &&
    plan(a.plan) === plan(b.plan) &&
    plan(a.sprint) === plan(b.sprint)
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
