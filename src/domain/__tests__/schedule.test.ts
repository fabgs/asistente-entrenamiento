import {
  ALL_DONE_MESSAGES,
  allDoneMessage,
  buildDailyMessage,
  dateOfWeekday,
  isoToExpoWeekday,
  isoWeekdayOf,
  localDateString,
  parseLocalDate,
  pickerStartDate,
  today,
  weekdaysLabel,
} from '../schedule';

describe('weekday conventions', () => {
  it('converts ISO weekdays to expo-notifications weekdays (1 = Sunday)', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => isoToExpoWeekday(d as 1))).toEqual([2, 3, 4, 5, 6, 7, 1]);
  });

  it('reads the ISO weekday of a date', () => {
    expect(isoWeekdayOf(new Date(2026, 10, 1))).toBe(7); // Sunday 1 Nov 2026
    expect(isoWeekdayOf(new Date(2026, 10, 2))).toBe(1);
  });

  it('finds a weekday in past weeks', () => {
    const sunday = new Date(2026, 10, 1);
    expect(localDateString(dateOfWeekday(sunday, 1, 0))).toBe('2026-10-26');
    expect(localDateString(dateOfWeekday(sunday, 5, 1))).toBe('2026-10-23');
    expect(localDateString(dateOfWeekday(new Date(2026, 10, 2), 7, 1))).toBe('2026-11-01');
  });
});

describe('date helpers', () => {
  it('round-trips local dates', () => {
    expect(localDateString(parseLocalDate('1995-06-25'))).toBe('1995-06-25');
    expect(localDateString(today(new Date(2026, 10, 1, 23, 59)))).toBe('2026-11-01');
  });

  it('opens the picker at the value or some years back', () => {
    const now = new Date(2026, 10, 1);
    expect(localDateString(pickerStartDate('1995-06-25', 25, now))).toBe('1995-06-25');
    expect(localDateString(pickerStartDate(null, 25, now))).toBe('2001-01-01');
  });
});

describe('buildDailyMessage', () => {
  it('lists cardio and strength for a training day', () => {
    expect(
      buildDailyMessage({
        weekday: 1,
        routines: [{ name: 'Día 1: Torso', exerciseCount: 7 }],
        cardio: [
          { name: 'Caminar', target: '5 km' },
          { name: 'Bici estática', target: '30 min' },
        ],
      }),
    ).toEqual({
      title: 'Lunes · Día 1: Torso',
      body: 'Caminar 5 km · Bici estática 30 min · 7 ejercicios de fuerza',
    });
  });

  it('uses the cardio as headline without strength', () => {
    expect(
      buildDailyMessage({
        weekday: 3,
        routines: [],
        cardio: [{ name: 'Sprints + Bouncing', target: '15 min' }],
      }).title,
    ).toBe('Miércoles · Sprints + Bouncing');
  });

  it('handles an empty day', () => {
    expect(buildDailyMessage({ weekday: 7, routines: [], cardio: [] })).toEqual({
      title: 'Domingo · Descanso',
      body: 'Día libre',
    });
  });
});

describe('allDoneMessage', () => {
  it('keeps one message all day and changes it the next day', () => {
    expect(allDoneMessage('2026-11-04')).toBe(allDoneMessage('2026-11-04'));
    expect(allDoneMessage('2026-11-05')).not.toBe(allDoneMessage('2026-11-04'));
  });

  it('goes through every message in a week', () => {
    const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
    expect(new Set(week.map(allDoneMessage)).size).toBe(ALL_DONE_MESSAGES.length);
  });
});

describe('weekdaysLabel', () => {
  it('lists the days in Spanish', () => {
    expect(weekdaysLabel([1])).toBe('Lunes');
    expect(weekdaysLabel([1, 4])).toBe('Lunes y jueves');
    expect(weekdaysLabel([1, 2, 4, 5])).toBe('Lunes, martes, jueves y viernes');
    expect(weekdaysLabel([])).toBe('Sin día');
  });
});
