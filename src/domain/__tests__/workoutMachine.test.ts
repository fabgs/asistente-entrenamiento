import { nextPendingSlot, nextStep, setsDone, slotToOpen } from '../workoutMachine';

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

  it('does not count warm-up sets', () => {
    const warmups = [{ slotId: 1, isWarmup: true }, { slotId: 1, isWarmup: true }];
    expect(setsDone(1, [...warmups, ...done(1)])).toBe(1);
    expect(nextStep(slots, [...warmups, ...done(1)], [], 1)).toEqual({ kind: 'next_set', slotId: 1, setNumber: 2 });
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

describe('slotToOpen', () => {
  it('opens the first set of the first exercise when starting', () => {
    expect(slotToOpen(slots, [], [], null, false)).toBe(1);
  });

  it('opens the exercise in progress, or else the first one pending', () => {
    expect(slotToOpen(slots, done(3), [], 3, false)).toBe(3);
    expect(slotToOpen(slots, done(1, 1), [], null, false)).toBe(2);
    expect(slotToOpen(slots, done(1, 1), [2], 1, false)).toBe(3);
  });

  it('leaves the rest and a finished workout as they are', () => {
    expect(slotToOpen(slots, done(1), [], 1, true)).toBeNull();
    expect(slotToOpen(slots, done(1, 1, 2, 3, 3), [], 3, false)).toBeNull();
  });

  it('does not count warm-ups as sets done', () => {
    expect(slotToOpen(slots, [{ slotId: 1, isWarmup: true }, ...done(2)], [], null, false)).toBe(1);
  });
});
