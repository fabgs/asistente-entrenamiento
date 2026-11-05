import {
  loadFigure,
  spokenPrescription,
  formatSprintTime,
  workoutTitle,
  formatCardioResult,
  formatClock,
  formatCountdown,
  formatAgo,
  formatDateWithYear,
  formatDuration,
  formatMinutes,
  formatSetGroups,
  formatSetValues,
  formatTimeRange,
  formatEquipment,
  formatKg,
  formatLoad,
  isPairEquipment,
  formatLongDate,
  formatMetres,
  formatShortDate,
  formatSpeedKmh,
  formatNumber,
  formatTarget,
  capitalizeFirst,
  normalizeForSearch,
  spokenTarget,
  parseDecimal,
  parseDuration,
} from '../format';

describe('format', () => {
  it('keeps a figure and its unit together and groups thousands from five digits', () => {
    expect(formatKg(10)).toBe('10 kg');
    expect(formatMetres(5140)).toBe('5,14 km');
    expect(formatSpeedKmh(1.45)).toBe('5,2 km/h');
    expect(formatKg(10250)).toBe('10 250 kg');
    expect(formatNumber(1900)).toBe('1900');
    expect(formatNumber(-12345.5)).toBe('-12 345,5');
    expect(formatLoad(0, false)).toBe('Sin carga');
  });

  it('uses a decimal comma', () => {
    expect(formatNumber(14.6667, 1)).toBe('14,7');
    expect(formatKg(37.5)).toBe('37,5 kg');
    expect(formatKg(40)).toBe('40 kg');
  });

  it('labels loads', () => {
    expect(formatLoad(15, true)).toBe('Lastre 15 kg');
    expect(formatLoad(0, true)).toBe('Peso corporal');
    expect(formatLoad(null, true)).toBe('Peso corporal');
    expect(formatLoad(35, false)).toBe('35 kg');
    expect(formatLoad(10, false, true)).toBe('2 × 10 kg');
    expect(formatLoad(0, false, true)).toBe('Sin carga');
    expect(isPairEquipment('mancuernas')).toBe(true);
    expect(isPairEquipment(' Mancuernas ')).toBe(true);
    expect(isPairEquipment('mancuerna')).toBe(false);
    expect(isPairEquipment(null)).toBe(false);
  });

  it('formats the rest countdown', () => {
    expect(formatCountdown(150_000)).toBe('2:30');
    expect(formatCountdown(59_001)).toBe('1:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });

  it('formats long dates in Spanish with only the first letter capitalized', () => {
    expect(formatLongDate(new Date(2026, 10, 1))).toBe('Domingo, 1 de noviembre');
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

  it('normalizes text for accent-insensitive search', () => {
    expect(normalizeForSearch('Plátano')).toBe('platano');
    expect(normalizeForSearch('Arándanos')).toContain('arandanos');
  });

  it('formats targets', () => {
    expect(formatTarget({ kind: 'range', min: 8, max: 12 }, 'reps', true)).toBe('8–12 reps por lado');
    expect(formatTarget({ kind: 'fixed', reps: 20 }, 'steps', false)).toBe('20 pasos');
    expect(formatTarget({ kind: 'failure', minus: 1 }, 'reps', false)).toBe('al fallo −1');
  });

  it('starts a line with a capital and reads targets aloud', () => {
    expect(capitalizeFirst('al fallo −1')).toBe('Al fallo −1');
    expect(capitalizeFirst('10–12 reps')).toBe('10–12 reps');
    expect(capitalizeFirst('')).toBe('');
    expect(spokenTarget({ kind: 'range', min: 10, max: 12 }, 'reps', false)).toBe('de 10 a 12 repeticiones');
    expect(spokenTarget({ kind: 'fixed', reps: 1 }, 'seconds', false)).toBe('1 segundo');
    expect(spokenTarget({ kind: 'fixed', reps: 20 }, 'steps', false)).toBe('20 pasos');
    expect(spokenTarget({ kind: 'failure', minus: 0 }, 'reps', false)).toBe('al fallo');
    expect(spokenTarget({ kind: 'failure', minus: 1 }, 'reps', false)).toBe('al fallo menos 1');
    expect(spokenTarget({ kind: 'range', min: 8, max: 10 }, 'reps', true)).toBe('de 8 a 10 repeticiones por lado');
  });

  it('formats cardio clock, distance and speed', () => {
    expect(formatClock(245_000)).toBe('4:05');
    expect(formatClock(52 * 60_000 + 10_000)).toBe('52:10');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatMetres(850.4)).toBe('850 m');
    expect(formatMetres(5234)).toBe('5,23 km');
    expect(formatSpeedKmh(1.4)).toBe('5 km/h');
    expect(formatSpeedKmh(1.5)).toBe('5,4 km/h');
  });

  it('formats the result of a cardio session', () => {
    expect(formatCardioResult(5234, 58 * 60_000)).toBe('5,23 km · 58 min');
    expect(formatCardioResult(null, 30 * 60_000)).toBe('30 min');
  });

  it('formats durations, in seconds below a minute', () => {
    expect(formatDuration(20_000)).toBe('20 s');
    expect(formatDuration(59_600)).toBe('1 min');
    expect(formatDuration(100 * 60_000)).toBe('1 h 40 min');
    expect(formatDuration(60 * 60_000)).toBe('1 h');
    expect(
      formatSetGroups(
        [
          { weightKg: 35, reps: 15 },
          { weightKg: 35, reps: 15 },
          { weightKg: 37.5, reps: 12 },
        ],
        false,
      ),
    ).toBe('35 kg × 15, 15 · 37,5 kg × 12');
    expect(formatSetGroups([{ weightKg: null, reps: 10 }, { weightKg: 0, reps: 9 }], true)).toBe('Peso corporal × 10, 9');
    expect(formatSetGroups([{ weightKg: 10, reps: 12 }, { weightKg: 10, reps: 11 }], false, true)).toBe('2 × 10 kg × 12, 11');
    // Sets of time or steps say their unit, not «× 420».
    expect(formatSetGroups([{ weightKg: null, reps: 420 }], true, false, 'seconds')).toBe('Peso corporal × 7\u00A0min');
    expect(formatSetGroups([{ weightKg: 32, reps: 45 }, { weightKg: 32, reps: 45 }], false, false, 'seconds')).toBe('32\u00A0kg × 45, 45\u00A0s');
    expect(formatMinutes(1000)).toBe('0 min');
    expect(formatTimeRange(new Date(2026, 10, 3, 9, 20).getTime(), new Date(2026, 10, 3, 10, 19).getTime())).toBe('9:20–10:19');
  });
});

describe('formatSprintTime', () => {
  it('truncates to tenths like a stopwatch', () => {
    expect(formatSprintTime(12_449)).toBe('12,4\u00A0s');
    expect(formatSprintTime(9_999)).toBe('9,9\u00A0s');
    expect(formatSprintTime(10_000)).toBe('10,0\u00A0s');
    expect(formatSprintTime(62_340)).toBe('1:02,3');
    expect(formatSprintTime(0)).toBe('0,0\u00A0s');
  });
});

describe('workoutTitle', () => {
  const base = { title: null, routineName: null, looseFirst: null, looseCount: 0 };
  it('names a workout by its title, its routine or its first loose exercise', () => {
    expect(workoutTitle({ ...base, title: 'Pierna fuerte', routineName: 'Día 2' })).toBe('Pierna fuerte');
    expect(workoutTitle({ ...base, routineName: 'Día 2: Pierna y Core' })).toBe('Día 2: Pierna y Core');
    expect(workoutTitle({ ...base, looseFirst: 'Remo con barra (90º)', looseCount: 1 })).toBe('Remo con barra (90º)');
    expect(workoutTitle({ ...base, looseFirst: 'Remo con barra (90º)', looseCount: 0 })).toBe('Remo con barra (90º)');
    expect(workoutTitle({ ...base, looseFirst: 'Remo con barra (90º)', looseCount: 3 })).toBe('Remo con barra (90º) y 2 más');
    expect(workoutTitle(base)).toBe('Entreno');
  });
});

describe('loads and prescriptions of an exercise row', () => {
  it('writes the load as a figure, with «lastre» under the ballast, and nothing without a load', () => {
    expect(loadFigure(35, false)).toEqual({ value: '35', unit: 'kg' });
    expect(loadFigure(37.5, false)).toEqual({ value: '37,5', unit: 'kg' });
    expect(loadFigure(10, false, true)).toEqual({ value: '2 × 10', unit: 'kg' });
    expect(loadFigure(15, true)).toEqual({ value: '15', unit: 'kg', caption: 'lastre' });
    expect(loadFigure(null, true)).toBeNull();
    expect(loadFigure(0, true)).toBeNull();
    expect(loadFigure(null, false)).toBeNull();
  });

  it('says the prescription in words for TalkBack', () => {
    expect(spokenPrescription(3, { kind: 'range', min: 5, max: 8 }, 'reps', false)).toBe('3 series, de 5 a 8 repeticiones');
    expect(spokenPrescription(3, { kind: 'failure', minus: 1 }, 'reps', false)).toBe('3 series, al fallo menos 1');
    expect(spokenPrescription(1, { kind: 'fixed', reps: 20 }, 'steps', true)).toBe('1 serie, 20 pasos por lado');
  });
});

describe('formatSetValues', () => {
  it('writes reps as they are', () => {
    expect(formatSetValues([12, 10])).toBe('12, 10');
  });

  it('writes seconds, or minutes from two minutes on', () => {
    expect(formatSetValues([45, 40], 'seconds')).toBe('45, 40\u00A0s');
    expect(formatSetValues([90], 'seconds')).toBe('90\u00A0s');
    expect(formatSetValues([420, 300], 'seconds')).toBe('7, 5\u00A0min');
    expect(formatSetValues([750, 90], 'seconds')).toBe('12:30, 1:30\u00A0min');
  });

  it('writes steps with their word', () => {
    expect(formatSetValues([20, 20], 'steps')).toBe('20, 20\u00A0pasos');
  });
});
