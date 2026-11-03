import { warmupProposal } from '../warmup';

describe('warmupProposal', () => {
  it('ramps 50 % × 10, 70 % × 5 and 85 % × 3, rounded down to the plate step', () => {
    expect(warmupProposal(0, 35, 2.5)).toEqual({ weightKg: 17.5, reps: 10 });
    expect(warmupProposal(1, 35, 2.5)).toEqual({ weightKg: 22.5, reps: 5 }); // 24,5 → 22,5
    expect(warmupProposal(2, 35, 2.5)).toEqual({ weightKg: 27.5, reps: 3 }); // 29,75 → 27,5
    expect(warmupProposal(3, 35, 2.5)).toEqual({ weightKg: 27.5, reps: 3 });
  });

  it('repeats the warm-up done last time in the same place', () => {
    const lastTime = [
      { weightKg: 20, reps: 8 },
      { weightKg: 30, reps: 4 },
    ];
    expect(warmupProposal(0, 35, 2.5, lastTime)).toEqual({ weightKg: 20, reps: 8 });
    expect(warmupProposal(1, 35, 2.5, lastTime)).toEqual({ weightKg: 30, reps: 4 });
    expect(warmupProposal(2, 35, 2.5, lastTime)).toEqual({ weightKg: 27.5, reps: 3 });
  });

  it('handles body weight, exact steps and no step', () => {
    expect(warmupProposal(0, 0, 2.5)).toEqual({ weightKg: 0, reps: 10 });
    expect(warmupProposal(0, 40, 2.5)).toEqual({ weightKg: 20, reps: 10 });
    expect(warmupProposal(1, 10, 0)).toEqual({ weightKg: 7, reps: 5 });
  });
});
