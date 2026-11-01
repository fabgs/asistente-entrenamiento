import {
  formatCountdown,
  formatAgo,
  formatDateWithYear,
  formatEquipment,
  formatKg,
  formatLoad,
  formatLongDate,
  formatShortDate,
  formatNumber,
  formatTarget,
  parseDecimal,
  parseDuration,
} from '../format';

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

  it('formats long dates in Spanish with only the first letter capitalized', () => {
    expect(formatLongDate(new Date(2026, 10, 1))).toBe('Domingo 1 de noviembre');
  });

  it('parses typed numbers with comma or dot', () => {
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal(' 15 ')).toBe(15);
    expect(parseDecimal('12,')).toBe(12);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('-3')).toBeNull();
  });

  it('parses typed durations', () => {
    expect(parseDuration('2:30')).toBe(150);
    expect(parseDuration('0:45')).toBe(45);
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('2:')).toBeNull();
    expect(parseDuration('2:75')).toBeNull();
  });

  it('formats dates with the year', () => {
    expect(formatDateWithYear('1995-06-25')).toBe('25 de junio de 1995');
  });

  it('labels equipment codes from the Excel', () => {
    expect(formatEquipment('barra_z')).toBe('Barra Z');
    expect(formatEquipment('peso_corporal')).toBeNull();
    expect(formatEquipment('polea')).toBe('polea');
    expect(formatEquipment(null)).toBeNull();
  });

  it('formats elapsed time in Spanish', () => {
    const now = new Date(2026, 10, 1, 12, 0).getTime();
    expect(formatAgo(now - 2 * 60 * 60 * 1000, now)).toBe('hace alrededor de 2 horas');
    expect(formatAgo(now - 3 * 24 * 60 * 60 * 1000, now)).toBe('hace 3 días');
  });

  it('formats short dates', () => {
    expect(formatShortDate('2026-10-12')).toBe('12 oct');
    expect(formatShortDate('2026-01-05')).toBe('5 ene');
  });

  it('formats targets', () => {
    expect(formatTarget({ kind: 'range', min: 8, max: 12 }, 'reps', true)).toBe('8–12 reps por lado');
    expect(formatTarget({ kind: 'fixed', reps: 20 }, 'steps', false)).toBe('20 pasos');
    expect(formatTarget({ kind: 'failure', minus: 1 }, 'reps', false)).toBe('Al fallo −1');
  });
});
