import type {
  ExerciseType,
  IsoWeekday,
  ProgressionKind,
  RepTarget,
  RepUnit,
  SlotRule,
} from '@/domain/types';
import { bool, type Db } from '../db';

export interface Routine {
  id: number;
  name: string;
  position: number;
  weekdays: IsoWeekday[];
}

export interface Slot {
  id: number;
  routineId: number;
  exerciseId: number;
  exerciseName: string;
  exerciseType: ExerciseType;
  exerciseIncrementKg: number | null;
  position: number;
  weightKg: number | null;
  sets: number;
  target: RepTarget;
  perSide: boolean;
  unit: RepUnit;
  progression: ProgressionKind;
  allowDecrease: boolean;
  incrementKg: number | null;
  restSeconds: number | null;
  note: string | null;
}

interface SlotRow {
  id: number;
  routine_id: number;
  exercise_id: number;
  exercise_name: string;
  exercise_type: ExerciseType;
  exercise_increment_kg: number | null;
  position: number;
  weight_kg: number | null;
  sets: number;
  target_kind: RepTarget['kind'];
  rep_min: number | null;
  rep_max: number | null;
  fixed_reps: number | null;
  failure_minus: number | null;
  per_side: number;
  unit: RepUnit;
  progression: ProgressionKind;
  allow_decrease: number;
  increment_kg: number | null;
  rest_seconds: number | null;
  note: string | null;
}

const SLOT_SELECT = `
  SELECT s.*, e.name AS exercise_name, e.type AS exercise_type, e.increment_kg AS exercise_increment_kg
  FROM routine_slot s JOIN exercise e ON e.id = s.exercise_id`;

function targetOf(row: SlotRow): RepTarget {
  switch (row.target_kind) {
    case 'range':
      return { kind: 'range', min: row.rep_min ?? 0, max: row.rep_max ?? 0 };
    case 'fixed':
      return { kind: 'fixed', reps: row.fixed_reps ?? 0 };
    case 'failure':
      return { kind: 'failure', minus: row.failure_minus ?? 0 };
  }
}

function toSlot(row: SlotRow): Slot {
  return {
    id: row.id,
    routineId: row.routine_id,
    exerciseId: row.exercise_id,
    exerciseName: row.exercise_name,
    exerciseType: row.exercise_type,
    exerciseIncrementKg: row.exercise_increment_kg,
    position: row.position,
    weightKg: row.weight_kg,
    sets: row.sets,
    target: targetOf(row),
    perSide: bool(row.per_side),
    unit: row.unit,
    progression: row.progression,
    allowDecrease: bool(row.allow_decrease),
    incrementKg: row.increment_kg,
    restSeconds: row.rest_seconds,
    note: row.note,
  };
}

/** Columns for target_kind, rep_min, rep_max, fixed_reps, failure_minus. */
export function targetColumns(t: RepTarget): [string, number | null, number | null, number | null, number | null] {
  switch (t.kind) {
    case 'range':
      return ['range', t.min, t.max, null, null];
    case 'fixed':
      return ['fixed', null, null, t.reps, null];
    case 'failure':
      return ['failure', null, null, null, t.minus];
  }
}

export function slotRule(slot: Slot): SlotRule {
  return {
    sets: slot.sets,
    target: slot.target,
    progression: slot.progression,
    allowDecrease: slot.allowDecrease,
    incrementKg: slot.incrementKg,
    weightKg: slot.weightKg,
  };
}

export const isBodyweight = (slot: Slot) => slot.exerciseType === 'bodyweight';

async function attachWeekdays(db: Db, rows: Omit<Routine, 'weekdays'>[]): Promise<Routine[]> {
  const days = await db.getAllAsync<{ routine_id: number; weekday: IsoWeekday }>(
    'SELECT routine_id, weekday FROM routine_weekday ORDER BY weekday',
  );
  return rows.map((r) => ({
    ...r,
    weekdays: days.filter((d) => d.routine_id === r.id).map((d) => d.weekday),
  }));
}

export async function listRoutines(db: Db): Promise<Routine[]> {
  const rows = await db.getAllAsync<Omit<Routine, 'weekdays'>>(
    'SELECT id, name, position FROM routine WHERE archived = 0 ORDER BY position, id',
  );
  return attachWeekdays(db, rows);
}

export async function getRoutine(db: Db, id: number): Promise<Routine | null> {
  const row = await db.getFirstAsync<Omit<Routine, 'weekdays'>>(
    'SELECT id, name, position FROM routine WHERE id = ?',
    id,
  );
  return row ? (await attachWeekdays(db, [row]))[0] : null;
}

export async function routinesForWeekday(db: Db, weekday: IsoWeekday): Promise<Routine[]> {
  return (await listRoutines(db)).filter((r) => r.weekdays.includes(weekday));
}

export async function listSlots(db: Db, routineId: number): Promise<Slot[]> {
  const rows = await db.getAllAsync<SlotRow>(
    `${SLOT_SELECT} WHERE s.routine_id = ? AND s.archived = 0 ORDER BY s.position, s.id`,
    routineId,
  );
  return rows.map(toSlot);
}

export async function getSlot(db: Db, slotId: number): Promise<Slot | null> {
  const row = await db.getFirstAsync<SlotRow>(`${SLOT_SELECT} WHERE s.id = ?`, slotId);
  return row ? toSlot(row) : null;
}
