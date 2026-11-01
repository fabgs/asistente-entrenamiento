import { formatCountdown, formatKg, formatLoad, formatNumber, formatTarget } from '../format';

describe('format', () => {
  it('uses a decimal comma', () => {
    expect(formatNumber(14.6667, 1)).toBe('14,7');
    expect(formatKg(37.5)).toBe('37,5 kg');
    expect(formatKg(40)).toBe('40 kg');
  });

  it('labels loads', () => {
    expect(formatLoad(15, true)).toBe('Lastre 15 kg');
    expect(formatLoad(0, true)).toBe('Peso corporal');
    expect(formatLoad(null, true)).toBe('Peso corporal');
    expect(formatLoad(35, false)).toBe('35 kg');
  });

  it('formats the rest countdown', () => {
    expect(formatCountdown(150_000)).toBe('2:30');
    expect(formatCountdown(59_001)).toBe('1:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });

  it('formats targets', () => {
    expect(formatTarget({ kind: 'range', min: 8, max: 12 }, 'reps', true)).toBe('8–12 reps por lado');
    expect(formatTarget({ kind: 'fixed', reps: 20 }, 'steps', false)).toBe('20 pasos');
    expect(formatTarget({ kind: 'failure', minus: 1 }, 'reps', false)).toBe('Al fallo −1');
  });
});
