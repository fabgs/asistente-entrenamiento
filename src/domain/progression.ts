import { formatKg, formatNumber } from './format';
import type {
  ProgressionSettings,
  Recommendation,
  RepTarget,
  SessionPerformance,
  SlotRule,
} from './types';

type Assessment = 'above' | 'in' | 'below';

const round2 = (n: number) => Math.round(n * 100) / 100;
const sameWeight = (a: number | null, b: number | null) => Math.abs((a ?? 0) - (b ?? 0)) < 1e-9;
const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

function assess(reps: number[], target: RepTarget, settings: ProgressionSettings): Assessment {
  if (reps.length === 0) return 'in';
  switch (target.kind) {
    case 'range': {
      const avg = average(reps);
      const above =
        settings.mode === 'strict' ? reps.every((r) => r >= target.max) : avg > target.max;
      if (above) return 'above';
      return avg < target.min ? 'below' : 'in';
    }
    case 'fixed':
      return reps.every((r) => r >= target.reps) ? 'above' : 'in';
    case 'failure':
      return 'in';
  }
}

function aboveReason(reps: number[], target: RepTarget, settings: ProgressionSettings): string {
  if (target.kind === 'fixed') return `Completadas ${reps.length} × ${target.reps}`;
  if (target.kind === 'range' && settings.mode === 'strict') {
    return `Todas las series ≥ ${target.max}`;
  }
  const max = target.kind === 'range' ? target.max : 0;
  return `Media ${formatNumber(average(reps), 1)} > ${max}`;
}

/**
 * Suggests the load for the next session of a slot (PLAN.md §6.2).
 * `history` holds finished sessions that included the slot, newest first.
 */
export function recommend(
  slot: SlotRule,
  exerciseIncrementKg: number | null,
  history: SessionPerformance[],
  settings: ProgressionSettings,
): Recommendation {
  const last = history[0];

  if (slot.progression === 'manual' || slot.target.kind === 'failure') {
    return {
      action: 'manual',
      fromKg: slot.weightKg,
      toKg: slot.weightKg,
      reason: 'Progresión manual: intenta superar tus reps',
      repsToBeat: last?.reps,
    };
  }
  if (!last) {
    return { action: 'none', fromKg: slot.weightKg, toKg: slot.weightKg, reason: 'Sin datos todavía' };
  }

  const increment = slot.incrementKg ?? exerciseIncrementKg ?? settings.defaultIncrementKg;
  const weight = last.weightKg ?? 0;
  const keep = (reason: string): Recommendation => ({
    action: 'keep',
    fromKg: slot.weightKg,
    toKg: slot.weightKg,
    reason,
    repsToBeat: last.reps,
  });

  if (last.reps.length < slot.sets) {
    return keep(`Sesión incompleta (${last.reps.length} de ${slot.sets} series)`);
  }

  const assessment = assess(last.reps, slot.target, settings);

  if (assessment === 'above') {
    const toKg = round2(weight + increment);
    return {
      action: 'increase',
      fromKg: slot.weightKg,
      toKg,
      reason: `${aboveReason(last.reps, slot.target, settings)} → sube a ${formatKg(toKg)}`,
      repsToBeat: last.reps,
    };
  }

  if (assessment === 'below' && slot.target.kind === 'range') {
    const avgLabel = `Media ${formatNumber(average(last.reps), 1)} < ${slot.target.min}`;
    if (!slot.allowDecrease) return keep(`${avgLabel} (sin bajada automática)`);

    const needed = Math.max(1, settings.sessionsBelowToDecrease);
    const recent = history.slice(0, needed);
    const repeated =
      recent.length === needed &&
      recent.every(
        (s) => sameWeight(s.weightKg, last.weightKg) && assess(s.reps, slot.target, settings) === 'below',
      );
    if (!repeated) return keep(`${avgLabel}: si se repite, bajará`);

    const toKg = round2(weight - increment);
    if (toKg < 0) return keep(`${avgLabel}: sin carga que quitar, prueba una variante más fácil`);
    const sessionsLabel = needed > 1 ? ` en ${needed} sesiones` : '';
    return {
      action: 'decrease',
      fromKg: slot.weightKg,
      toKg,
      reason: `${avgLabel}${sessionsLabel} → baja a ${formatKg(toKg)}`,
      repsToBeat: last.reps,
    };
  }

  if (slot.target.kind === 'range') {
    return keep(`Media ${formatNumber(average(last.reps), 1)} dentro de ${slot.target.min}–${slot.target.max}`);
  }
  return keep('Aún no completas todas las series');
}
