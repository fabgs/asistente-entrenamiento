export interface PlannedSlot {
  slotId: number;
  sets: number;
}

export interface DoneSet {
  slotId: number | null;
}

export type NextStep =
  | { kind: 'next_set'; slotId: number; setNumber: number }
  | { kind: 'next_exercise'; slotId: number }
  | { kind: 'finished' };

export function setsDone(slotId: number, sets: DoneSet[]): number {
  return sets.filter((s) => s.slotId === slotId).length;
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
