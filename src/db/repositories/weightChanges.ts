import type { Db } from '../db';

export type WeightChangeSource = 'progression' | 'manual' | 'import';
export type WeightChangeStatus = 'pending' | 'applied' | 'dismissed' | 'expired';

export interface WeightChange {
  id: number;
  slotId: number;
  sessionId: number | null;
  fromKg: number | null;
  toKg: number | null;
  reason: string;
  source: WeightChangeSource;
  status: WeightChangeStatus;
  createdAt: number;
  decidedAt: number | null;
}

const SELECT = `
  SELECT id, slot_id AS slotId, session_id AS sessionId, from_kg AS fromKg, to_kg AS toKg,
         reason, source, status, created_at AS createdAt, decided_at AS decidedAt
  FROM weight_change`;

export async function listPendingChanges(db: Db): Promise<WeightChange[]> {
  return db.getAllAsync<WeightChange>(`${SELECT} WHERE status = 'pending' ORDER BY id`);
}

export async function listChangesForSession(db: Db, sessionId: number): Promise<WeightChange[]> {
  return db.getAllAsync<WeightChange>(`${SELECT} WHERE session_id = ? ORDER BY id`, sessionId);
}

export async function getChange(db: Db, id: number): Promise<WeightChange | null> {
  return db.getFirstAsync<WeightChange>(`${SELECT} WHERE id = ?`, id);
}

async function expirePending(db: Db, slotId: number, now: number): Promise<void> {
  await db.runAsync(
    `UPDATE weight_change SET status = 'expired', decided_at = ? WHERE slot_id = ? AND status = 'pending'`,
    now,
    slotId,
  );
}

/** Stores a recommendation without touching the slot weight (PLAN.md §6.2). */
export async function createRecommendation(
  db: Db,
  r: {
    slotId: number;
    sessionId: number | null;
    fromKg: number | null;
    toKg: number | null;
    reason: string;
    source: WeightChangeSource;
    now: number;
  },
): Promise<number> {
  await expirePending(db, r.slotId, r.now);
  const result = await db.runAsync(
    `INSERT INTO weight_change (slot_id, session_id, from_kg, to_kg, reason, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    r.slotId,
    r.sessionId,
    r.fromKg,
    r.toKg,
    r.reason,
    r.source,
    r.now,
  );
  return result.lastInsertRowId;
}

export async function applyChange(db: Db, id: number, now = Date.now()): Promise<void> {
  const change = await getChange(db, id);
  if (!change || change.status !== 'pending') return;
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE routine_slot SET weight_kg = ? WHERE id = ?', change.toKg, change.slotId);
    await db.runAsync(
      `UPDATE weight_change SET status = 'applied', decided_at = ? WHERE id = ?`,
      now,
      id,
    );
  });
}

export async function dismissChange(db: Db, id: number, now = Date.now()): Promise<void> {
  await db.runAsync(
    `UPDATE weight_change SET status = 'dismissed', decided_at = ? WHERE id = ? AND status = 'pending'`,
    now,
    id,
  );
}

/** Reverts an applied recommendation and leaves it pending again. */
export async function undoChange(db: Db, id: number): Promise<void> {
  const change = await getChange(db, id);
  if (!change || change.status !== 'applied' || change.source === 'manual') return;
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE routine_slot SET weight_kg = ? WHERE id = ?', change.fromKg, change.slotId);
    await db.runAsync(
      `UPDATE weight_change SET status = 'pending', decided_at = NULL WHERE id = ?`,
      id,
    );
  });
}

export async function setSlotWeightManually(
  db: Db,
  slotId: number,
  weightKg: number | null,
  now = Date.now(),
): Promise<void> {
  const current = await db.getFirstAsync<{ weight_kg: number | null }>(
    'SELECT weight_kg FROM routine_slot WHERE id = ?',
    slotId,
  );
  if (!current || current.weight_kg === weightKg) return;
  await db.withTransactionAsync(async () => {
    await expirePending(db, slotId, now);
    await db.runAsync('UPDATE routine_slot SET weight_kg = ? WHERE id = ?', weightKg, slotId);
    await db.runAsync(
      `INSERT INTO weight_change (slot_id, session_id, from_kg, to_kg, reason, source, status, created_at, decided_at)
       VALUES (?, NULL, ?, ?, 'Cambio manual', 'manual', 'applied', ?, ?)`,
      slotId,
      current.weight_kg,
      weightKg,
      now,
      now,
    );
  });
}
