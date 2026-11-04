export interface PlannedSlot {
  slotId: number;
  sets: number;
}

export interface DoneSet {
  slotId: number | null;
  /** Warm-ups never count as done sets. */
  isWarmup?: boolean;
}

export type NextStep =
  | { kind: 'next_set'; slotId: number; setNumber: number }
  | { kind: 'next_exercise'; slotId: number }
  | { kind: 'finished' };

export function setsDone(slotId: number, sets: DoneSet[]): number {
  return sets.filter((s) => s.slotId === slotId && !s.isWarmup).length;
}

export function isSlotComplete(slot: PlannedSlot, sets: DoneSet[]): boolean {
  return setsDone(slot.slotId, sets) >= slot.sets;
}

/**
 * First incomplete, non-skipped slot after `afterSlotId` in routine order,
 * wrapping around so earlier slots that were left behind are offered too.
 */
export function nextPendingSlot(
  slots: PlannedSlot[],
  sets: DoneSet[],
  skipped: number[],
  afterSlotId: number | null,
): number | null {
  const start = afterSlotId === null ? 0 : slots.findIndex((s) => s.slotId === afterSlotId) + 1;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[(start + i) % slots.length];
    if (slot.slotId === afterSlotId || skipped.includes(slot.slotId)) continue;
    if (!isSlotComplete(slot, sets)) return slot.slotId;
  }
  return null;
}

/** What comes after finishing a set of `currentSlotId`. */
export function nextStep(
  slots: PlannedSlot[],
  sets: DoneSet[],
  skipped: number[],
  currentSlotId: number,
): NextStep {
  const current = slots.find((s) => s.slotId === currentSlotId);
  if (current && !isSlotComplete(current, sets)) {
    return { kind: 'next_set', slotId: currentSlotId, setNumber: setsDone(currentSlotId, sets) + 1 };
  }
  const next = nextPendingSlot(slots, sets, skipped, currentSlotId);
  return next === null ? { kind: 'finished' } : { kind: 'next_exercise', slotId: next };
}

/**
 * What «Empezar rutina» and «Continuar entreno» open: the set of the exercise in progress or else of
 * the first pending one (SET_INPUT). null leaves the workout as it is: resting, or nothing left to do.
 */
export function slotToOpen(
  slots: PlannedSlot[],
  sets: DoneSet[],
  skipped: number[],
  current: number | null,
  resting: boolean,
): number | null {
  if (resting) return null;
  const inProgress = slots.find((s) => s.slotId === current);
  if (inProgress && !isSlotComplete(inProgress, sets)) return inProgress.slotId;
  return nextPendingSlot(slots, sets, skipped, null);
}

/**
 * The exercises of a loose session (no routine), in order: the slots of its sets (warm-ups
 * included) by their first set, then the one being done if it has no sets yet. A slot left without
 * sets is no longer part of it: that is how «not adding it» works.
 */
export function looseSlotIds(sets: DoneSet[], current: number | null): number[] {
  const ids: number[] = [];
  for (const s of sets) if (s.slotId !== null && !ids.includes(s.slotId)) ids.push(s.slotId);
  if (current !== null && !ids.includes(current)) ids.push(current);
  return ids;
}
