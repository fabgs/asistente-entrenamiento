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

/** Between a figure and its unit, so "10 kg" never breaks across lines. */
export const NBSP = '\u00A0';
/** Thousands separator from five digits on ("10 250"), as the RAE asks; four digits go together. */
const THIN = '\u202F';

/** Spanish number formatting without relying on Intl support in the JS engine. */
export function formatNumber(value: number, maxDecimals = 2): string {
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(value * factor) / factor;
  const [whole, decimals] = String(rounded).split('.');
  const digits = whole.replace('-', '');
  const grouped = digits.length > 4 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN) : digits;
  return `${whole.startsWith('-') ? '-' : ''}${grouped}${decimals ? `,${decimals}` : ''}`;
}

export function formatKg(kg: number): string {
  return `${formatNumber(kg)}${NBSP}kg`;
}

/** Label for the load of a slot: "37,5 kg", "Lastre 15 kg", "Peso corporal" or "Sin carga". */
/** `pair`: two dumbbells of that weight each, «2 × 10 kg». */
export function formatLoad(weightKg: number | null, isBodyweight: boolean, pair = false): string {
  if (isBodyweight) {
    return weightKg ? `Lastre ${formatKg(weightKg)}` : 'Peso corporal';
  }
  if (!weightKg) return 'Sin carga';
  return pair ? `2${NBSP}×${NBSP}${formatKg(weightKg)}` : formatKg(weightKg);
}

/**
 * The load of a slot as a figure for a column of figures (rows of an exercise): «35 kg», «2 × 10 kg»,
 * or «15 kg» with «lastre» underneath. Without a load (bodyweight alone, «Sin carga») there is no
 * figure: the row says nothing rather than a long word that would squeeze the name.
 */
export function loadFigure(
  weightKg: number | null,
  isBodyweight: boolean,
  pair = false,
): { value: string; unit: string; caption?: string } | null {
  if (!weightKg) return null;
  if (isBodyweight) return { value: formatNumber(weightKg), unit: 'kg', caption: 'lastre' };
  return { value: pair ? `2${NBSP}×${NBSP}${formatNumber(weightKg)}` : formatNumber(weightKg), unit: 'kg' };
}

/** Material written as «mancuernas» (plural): the weight is that of each of two dumbbells. */
export const isPairEquipment = (equipment: string | null) => equipment?.trim().toLowerCase() === 'mancuernas';

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Running clock: "4:05", "52:10" or "1:02:05". */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** "850 m" below one kilometre, "5,23 km" above. */
export function formatMetres(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)}${NBSP}m` : `${formatNumber(metres / 1000, 2)}${NBSP}km`;
}

/** Result of a cardio session: "5,23 km · 58 min" with GPS, "30 min" for a timer. */
export function formatCardioResult(distanceM: number | null, activeMs: number): string {
  return distanceM !== null ? `${formatMetres(distanceM)} · ${formatDuration(activeMs)}` : formatDuration(activeMs);
}

/** Sprint time, truncated to tenths like a stopwatch: «12,4 s», or «1:02,3» from a minute. */
export function formatSprintTime(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const s = Math.floor(tenths / 10);
  return s < 60 ? `${s},${tenths % 10}${NBSP}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')},${tenths % 10}`;
}

export function formatSpeedKmh(metresPerSecond: number): string {
  return `${formatNumber(metresPerSecond * 3.6, 1)}${NBSP}km/h`;
}

/** "45 s", "58 min", "1 h" or "1 h 5 min" (never "1 h 0 min"). */
export function formatDuration(ms: number): string {
  if (ms < 59_500) return `${Math.round(ms / 1000)}${NBSP}s`;
  return formatMinutes(ms);
}

/** Like formatDuration but never in seconds, for counters refreshed every half minute: "0 min". */
export function formatMinutes(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}${NBSP}min`;
  return minutes === 0 ? `${hours}${NBSP}h` : `${hours}${NBSP}h ${minutes}${NBSP}min`;
}

/** Time of day: "9:05". */
export function formatTimeOfDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "9:20–10:19" */
export const formatTimeRange = (startMs: number, endMs: number) => `${formatTimeOfDay(startMs)}–${formatTimeOfDay(endMs)}`;

const UNIT_LABEL: Record<RepUnit, string> = { reps: 'reps', steps: 'pasos', seconds: 's' };

export function formatTarget(target: RepTarget, unit: RepUnit, perSide: boolean): string {
  let label: string;
  switch (target.kind) {
    case 'range':
      label = `${target.min}–${target.max}${NBSP}${UNIT_LABEL[unit]}`;
      break;
    case 'fixed':
      label = `${target.reps}${NBSP}${UNIT_LABEL[unit]}`;
      break;
    case 'failure':
      // Lower case: it goes mid-sentence ("3 × al fallo −1", "Objetivo al fallo").
      label = target.minus > 0 ? `al fallo −${target.minus}` : 'al fallo';
      break;
  }
  return perSide ? `${label} por lado` : label;
}

/** "Al fallo −1": a target that starts a line (formatTarget is lower case for mid-sentence use). */
export const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const SPOKEN_UNIT: Record<RepUnit, [string, string]> = {
  reps: ['repetición', 'repeticiones'],
  steps: ['paso', 'pasos'],
  seconds: ['segundo', 'segundos'],
};

/** What TalkBack reads for a target: "de 10 a 12 repeticiones", "al fallo menos 1", "1 segundo por lado". */
export function spokenTarget(target: RepTarget, unit: RepUnit, perSide: boolean): string {
  const [one, many] = SPOKEN_UNIT[unit];
  let label: string;
  switch (target.kind) {
    case 'range':
      label = `de ${target.min} a ${target.max} ${many}`;
      break;
    case 'fixed':
      label = `${target.reps} ${target.reps === 1 ? one : many}`;
      break;
    case 'failure':
      label = target.minus > 0 ? `al fallo menos ${target.minus}` : 'al fallo';
      break;
  }
  return perSide ? `${label} por lado` : label;
}

/** What TalkBack reads for «3 × 5–8 reps»: "3 series, de 5 a 8 repeticiones". */
export function spokenPrescription(sets: number, target: RepTarget, unit: RepUnit, perSide: boolean): string {
  return `${sets} ${sets === 1 ? 'serie' : 'series'}, ${spokenTarget(target, unit, perSide)}`;
}

/**
 * The sets of an exercise in one line, grouping runs at the same weight:
 * "35 kg × 15, 15, 14" or "35 kg × 15, 15 · 37,5 kg × 12".
 */
export function formatSetGroups(
  sets: { weightKg: number | null; reps: number }[],
  isBodyweight: boolean,
  pair = false,
): string {
  const groups: { kg: number | null; reps: number[] }[] = [];
  for (const s of sets) {
    const last = groups.at(-1);
    if (last && (last.kg ?? 0) === (s.weightKg ?? 0)) last.reps.push(s.reps);
    else groups.push({ kg: s.weightKg, reps: [s.reps] });
  }
  return groups.map((g) => `${formatLoad(g.kg, isBodyweight, pair)} × ${g.reps.join(', ')}`).join(' · ');
}

/** "Domingo, 1 de noviembre" (with the comma the RAE asks for). */
export function formatLongDate(date: Date): string {
  const text = format(date, "EEEE, d 'de' MMMM", { locale: es });
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

/** "12 oct" from ISO 'YYYY-MM-DD'. */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'd MMM', { locale: es }).replace('.', '');
}

/** Lower case without accents, to search "platano" and find "Plátano". */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * The name of a workout: its own title, its routine, or for a loose one its first exercise
 * («Remo con barra (90º)», «Remo con barra (90º) y 1 más»).
 */
export function workoutTitle(s: { title: string | null; routineName: string | null; looseFirst: string | null; looseCount: number }): string {
  if (s.title) return s.title;
  if (s.routineName) return s.routineName;
  if (s.looseFirst) return s.looseCount > 1 ? `${s.looseFirst} y ${s.looseCount - 1} más` : s.looseFirst;
  return 'Entreno';
}

/** Size of files: «850 kB», «1,2 MB» (decimal units, as Android shows them). */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${formatNumber(Math.max(1, Math.round(bytes / 1000)), 0)}${NBSP}kB`;
  return `${formatNumber(bytes / 1_000_000, 1)}${NBSP}MB`;
}
