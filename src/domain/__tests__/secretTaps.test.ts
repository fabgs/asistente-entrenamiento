import { addTap, TAP_GAP_MS, tapOutcome, tapsLeftText, type Taps } from '../secretTaps';

const tapsAt = (times: number[]): Taps[] => {
  const out: Taps[] = [];
  let taps: Taps | null = null;
  for (const t of times) {
    taps = addTap(taps, t);
    out.push(taps);
  }
  return out;
};

describe('seven taps on the version', () => {
  it('counts down from the third tap and toggles on the seventh', () => {
    const outcomes = tapsAt([0, 300, 600, 900, 1200, 1500, 1800]).map(tapOutcome);
    expect(outcomes).toEqual([
      { kind: 'none' },
      { kind: 'none' },
      { kind: 'left', left: 4 },
      { kind: 'left', left: 3 },
      { kind: 'left', left: 2 },
      { kind: 'left', left: 1 },
      { kind: 'toggle' },
    ]);
  });

  it('starts again after a pause', () => {
    const taps = tapsAt([0, 300, 600, 900, 900 + TAP_GAP_MS + 1]);
    expect(taps.at(-1)!.count).toBe(1);
    expect(tapOutcome(taps.at(-1)!)).toEqual({ kind: 'none' });
  });

  it('starts again after toggling, so an eighth tap does not toggle back', () => {
    const taps = tapsAt([0, 100, 200, 300, 400, 500, 600, 700]);
    expect(tapOutcome(taps[6])).toEqual({ kind: 'toggle' });
    expect(taps[7].count).toBe(1);
  });

  it('says how many taps are left', () => {
    expect(tapsLeftText(3)).toBe('Faltan 3 toques');
    expect(tapsLeftText(1)).toBe('Falta 1 toque');
  });
});
