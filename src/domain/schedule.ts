import type { IsoWeekday } from './types';

export const WEEKDAY_NAMES: Record<IsoWeekday, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

export const ISO_WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export function isoWeekdayOf(date: Date): IsoWeekday {
  const day = date.getDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

/** expo-notifications weekly triggers use 1 = Sunday … 7 = Saturday. */
export function isoToExpoWeekday(iso: IsoWeekday): number {
  return iso === 7 ? 1 : iso + 1;
}

export function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Date of the given ISO weekday in the week that is `weeksAgo` weeks before `today`'s week. */
export function dateOfWeekday(today: Date, weekday: IsoWeekday, weeksAgo: number): Date {
  const result = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  result.setDate(result.getDate() - (isoWeekdayOf(today) - 1) + (weekday - 1) - 7 * weeksAgo);
  return result;
}

export interface DayPlan {
  weekday: IsoWeekday;
  routines: { name: string; exerciseCount: number }[];
  cardio: { name: string; target: string | null }[];
}

export function buildDailyMessage(day: DayPlan): { title: string; body: string } {
  const dayName = WEEKDAY_NAMES[day.weekday];
  const headline =
    day.routines.map((r) => r.name).join(' + ') ||
    day.cardio.map((c) => c.name).join(' + ') ||
    'Descanso';
  const parts = [
    ...day.cardio.map((c) => (c.target ? `${c.name} ${c.target}` : c.name)),
    ...day.routines.map((r) => `${r.exerciseCount} ejercicios de fuerza`),
  ];
  return {
    title: `${dayName} · ${headline}`,
    body: parts.length > 0 ? parts.join(' · ') : 'Día libre',
  };
}

/** Local Date for a 'YYYY-MM-DD' string. */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Today at local midnight. */
export function today(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Where a date picker opens: the current value, or 1 January `yearsAgo` years back. */
export function pickerStartDate(value: string | null, yearsAgo: number, now = new Date()): Date {
  return value ? parseLocalDate(value) : new Date(now.getFullYear() - yearsAgo, 0, 1);
}

/** Said on Hoy when everything planned for the day is done; one a day, in turn. */
export const ALL_DONE_MESSAGES = [
  '¡Enhorabuena, lo has hecho genial!',
  'Buen trabajo. Hoy has cumplido.',
  'Un día más sumado. Así se progresa.',
  'Hecho. Ahora toca descansar y comer bien.',
  'La constancia es lo que cuenta. ¡Bien hecho!',
  '¡Gran entreno! Mañana, más.',
  'Objetivo del día cumplido.',
] as const;

/** The message for a local date (YYYY-MM-DD): the same all day, a different one the next. */
export function allDoneMessage(isoDate: string): string {
  const day = Math.round(parseLocalDate(isoDate).getTime() / 86_400_000);
  return ALL_DONE_MESSAGES[((day % ALL_DONE_MESSAGES.length) + ALL_DONE_MESSAGES.length) % ALL_DONE_MESSAGES.length];
}

/** "Lunes", "Lunes y jueves", "Lunes, miércoles y viernes" or "Sin día". */
/** `?dia=` of the editor of a cardio activity of no day («sin día», 1.5.0), where a weekday goes for the others. */
export const NO_DAY_PARAM = 'sin';

export function weekdaysLabel(days: IsoWeekday[]): string {
  const names = days.map((d, i) => (i === 0 ? WEEKDAY_NAMES[d] : WEEKDAY_NAMES[d].toLowerCase()));
  if (names.length === 0) return 'Sin día';
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0];
}
