import { format, formatDistance } from 'date-fns';
import { es } from 'date-fns/locale';
import type { ExerciseType, RepTarget, RepUnit } from './types';

export const EXERCISE_TYPE_LABEL: Record<ExerciseType, string> = {
  external: 'Carga externa',
  bodyweight: 'Peso corporal (+ lastre)',
};

// Codes used by the Excel import; anything else is shown as the user typed it.
const EQUIPMENT_LABEL: Record<string, string> = {
  peso_corporal: '',
  barra: 'Barra',
  barra_z: 'Barra Z',
  mancuerna: 'Mancuerna',
  mancuernas: 'Mancuernas',
};

export function formatEquipment(equipment: string | null): string | null {
  if (!equipment) return null;
  return (EQUIPMENT_LABEL[equipment] ?? equipment) || null;
}

/** Spanish number formatting without relying on Intl support in the JS engine. */
export function formatNumber(value: number, maxDecimals = 2): string {
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(value * factor) / factor;
  return String(rounded).replace('.', ',');
}

export function formatKg(kg: number): string {
  return `${formatNumber(kg)} kg`;
}

/** Label for the load of a slot: "37,5 kg", "Lastre 15 kg" or "Peso corporal". */
export function formatLoad(weightKg: number | null, isBodyweight: boolean): string {
  if (isBodyweight) {
    return weightKg ? `Lastre ${formatKg(weightKg)}` : 'Peso corporal';
  }
  return formatKg(weightKg ?? 0);
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

const UNIT_LABEL: Record<RepUnit, string> = { reps: 'reps', steps: 'pasos', seconds: 's' };

export function formatTarget(target: RepTarget, unit: RepUnit, perSide: boolean): string {
  let label: string;
  switch (target.kind) {
    case 'range':
      label = `${target.min}–${target.max} ${UNIT_LABEL[unit]}`;
      break;
    case 'fixed':
      label = `${target.reps} ${UNIT_LABEL[unit]}`;
      break;
    case 'failure':
      label = target.minus > 0 ? `Al fallo −${target.minus}` : 'Al fallo';
      break;
  }
  return perSide ? `${label} por lado` : label;
}

/** "Domingo 1 de noviembre". */
export function formatLongDate(date: Date): string {
  const text = format(date, "EEEE d 'de' MMMM", { locale: es });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Number typed by the user, with comma or dot as decimal separator; null while incomplete. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return null;
  return Number(normalized);
}

/** Seconds from "2:30" (minutes:seconds) or a plain number of seconds. */
export function parseDuration(text: string): number | null {
  const match = text.trim().match(/^(\d+):([0-5]?\d)$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return parseDecimal(text);
}

/** "25 de junio de 1995" from ISO 'YYYY-MM-DD'. */
export function formatDateWithYear(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return format(new Date(y, m - 1, d), "d 'de' MMMM 'de' yyyy", { locale: es });
}

/** "hace 2 horas" */
export function formatAgo(timestamp: number, now = Date.now()): string {
  return formatDistance(timestamp, now, { addSuffix: true, locale: es });
}
