import type { IsoWeekday } from '@/domain/types';
import { bool, int, type Db } from '../db';

export interface CardioActivity {
  id: number;
  weekday: IsoWeekday;
  name: string;
  target: string | null;
  intensity: string | null;
  notes: string | null;
}

export async function listCardio(db: Db): Promise<CardioActivity[]> {
  return db.getAllAsync<CardioActivity>(
    `SELECT id, weekday, name, target, intensity, notes FROM cardio_activity
     WHERE archived = 0 ORDER BY weekday, position, id`,
  );
}

export async function cardioForWeekday(db: Db, weekday: IsoWeekday): Promise<CardioActivity[]> {
  return (await listCardio(db)).filter((c) => c.weekday === weekday);
}

/** Activity ids marked as done on a date. */
export async function cardioDoneOn(db: Db, date: string): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ activity_id: number; done: number }>(
    'SELECT activity_id, done FROM cardio_log WHERE date = ? AND activity_id IS NOT NULL',
    date,
  );
  return new Set(rows.filter((r) => bool(r.done)).map((r) => r.activity_id));
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
