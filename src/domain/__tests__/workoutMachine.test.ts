import { nextPendingSlot, nextStep } from '../workoutMachine';

const slots = [
  { slotId: 1, sets: 2 },
  { slotId: 2, sets: 1 },
  { slotId: 3, sets: 2 },
];
const done = (...ids: number[]) => ids.map((slotId) => ({ slotId }));

describe('nextStep', () => {
  it('continues with the next set of the same exercise', () => {
    expect(nextStep(slots, done(1), [], 1)).toEqual({ kind: 'next_set', slotId: 1, setNumber: 2 });
  });

  it('moves to the next exercise once all sets are done', () => {
    expect(nextStep(slots, done(1, 1), [], 1)).toEqual({ kind: 'next_exercise', slotId: 2 });
  });

  it('wraps around to exercises left behind', () => {
    expect(nextStep(slots, done(3, 3), [], 3)).toEqual({ kind: 'next_exercise', slotId: 1 });
  });

  it('ignores skipped exercises', () => {
    expect(nextStep(slots, done(1, 1), [2], 1)).toEqual({ kind: 'next_exercise', slotId: 3 });
  });

  it('finishes when everything is done', () => {
    expect(nextStep(slots, done(1, 1, 2, 3, 3), [], 3)).toEqual({ kind: 'finished' });
  });

  it('counts extra sets without breaking the flow', () => {
    expect(nextStep(slots, done(2, 2), [], 2)).toEqual({ kind: 'next_exercise', slotId: 3 });
  });
});

describe('nextPendingSlot', () => {
  it('starts from the first exercise', () => {
    expect(nextPendingSlot(slots, [], [], null)).toBe(1);
  });

  it('returns null when nothing is pending', () => {
    expect(nextPendingSlot(slots, done(1, 1, 2), [3], null)).toBeNull();
  });
});
