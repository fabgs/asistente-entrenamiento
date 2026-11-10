import { formatKg, formatNumber } from './format';
import type {
  ProgressionMode,
  ProgressionSettings,
  Recommendation,
  RepTarget,
  SessionPerformance,
  SlotRule,
} from './types';

/** What a new install uses, and what «Volver a…» returns to (Ajustes, «Sugerencias de peso»). */
export const DEFAULT_PROGRESSION: ProgressionSettings = {
  defaultIncrementKg: 2.5,
  mode: 'average',
  sessionsBelowToDecrease: 2,
};

/** Bounds of the editable rules: 0,25 kg reaches a 1,25 kg plate on a dip belt; 4 sessions are a month. */
export const INCREMENT_LIMITS = { min: 0.25, max: 10, step: 0.25 } as const;
export const SESSIONS_BELOW_LIMITS = { min: 1, max: 4 } as const;

const MODES: readonly ProgressionMode[] = ['average', 'strict'];

/**
 * Rules as the engine can use them: a backup edited by hand or from a buggy version could bring an
 * increment of 0 (a «Bajar a» that keeps the weight), an unknown mode or 0 sessions.
 */
export function sanitizeProgression(s: ProgressionSettings): ProgressionSettings {
  const increment = Number.isFinite(s.defaultIncrementKg) && s.defaultIncrementKg > 0 ? s.defaultIncrementKg : DEFAULT_PROGRESSION.defaultIncrementKg;
  const sessions = Number.isFinite(s.sessionsBelowToDecrease)
    ? Math.min(SESSIONS_BELOW_LIMITS.max, Math.max(SESSIONS_BELOW_LIMITS.min, Math.round(s.sessionsBelowToDecrease)))
    : DEFAULT_PROGRESSION.sessionsBelowToDecrease;
  return {
    defaultIncrementKg: Math.min(INCREMENT_LIMITS.max, increment),
    mode: MODES.includes(s.mode) ? s.mode : DEFAULT_PROGRESSION.mode,
    sessionsBelowToDecrease: sessions,
  };
}

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

// Reasons read as plain sentences (PLAN.md §12): no «>», «<», «→» or «=». The buttons say the weight.
function aboveReason(reps: number[], target: RepTarget, settings: ProgressionSettings): string {
  if (target.kind === 'fixed') return `Completaste ${reps.length} × ${target.reps}`;
  if (target.kind === 'range' && settings.mode === 'strict') {
    return `Todas las series en ${target.max} o más`;
  }
  const max = target.kind === 'range' ? target.max : 0;
  return `Media de ${formatNumber(average(reps), 1)} reps, por encima de ${max}`;
}

export const SESSIONS_IN_WORDS: Record<number, string> = { 1: 'una', 2: 'dos', 3: 'tres', 4: 'cuatro' };

/** Sessions in a row within the target, with the same weight and no more reps, that call for a deload (rule 12). */
export const DELOAD_SESSIONS = 3;
/** How much a deload takes off, rounded to the increment and never less than one. */
export const DELOAD_SHARE = 0.1;

/**
 * The weight after a deload: the multiple of the increment closest to 10 % less (on a tie, the
 * smaller drop) and at least one increment. 35 kg by 2,5 → 32,5; 60 → 55; 37,5 → 35.
 */
export function deloadWeight(weightKg: number, incrementKg: number): number {
  const steps = Math.max(1, Math.ceil((weightKg * DELOAD_SHARE) / incrementKg - 0.5 - 1e-9));
  return round2(weightKg - steps * incrementKg);
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
      reason: 'Sin sugerencia: intenta superar tus reps',
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
    return keep(`Hiciste ${last.reps.length} de ${slot.sets} series`);
  }

  const assessment = assess(last.reps, slot.target, settings);

  if (assessment === 'above') {
    const toKg = round2(weight + increment);
    return {
      action: 'increase',
      fromKg: slot.weightKg,
      toKg,
      reason: aboveReason(last.reps, slot.target, settings),
      repsToBeat: last.reps,
    };
  }

  if (assessment === 'below' && slot.target.kind === 'range') {
    const avgLabel = `Media de ${formatNumber(average(last.reps), 1)}, por debajo de ${slot.target.min}`;
    if (!slot.allowDecrease) return keep(`${avgLabel}; este ejercicio no baja solo`);

    const needed = Math.max(1, settings.sessionsBelowToDecrease);
    // Sessions in a row below the range at this weight, the last one included.
    let streak = 0;
    for (const s of history) {
      if (streak >= needed || !sameWeight(s.weightKg, last.weightKg) || assess(s.reps, slot.target, settings) !== 'below') break;
      streak++;
    }
    if (streak < needed) {
      const left = needed - streak;
      return keep(
        left === 1
          ? `${avgLabel}: si se repite, te sugerirá bajar`
          : `${avgLabel}: si sigue así ${SESSIONS_IN_WORDS[left] ?? left} sesiones más, te sugerirá bajar`,
      );
    }

    const toKg = round2(weight - increment);
    if (toKg < 0) return keep(`${avgLabel}: no hay carga que quitar, prueba una variante más fácil`);
    const sessionsLabel = needed > 1 ? `, ${SESSIONS_IN_WORDS[needed] ?? needed} sesiones seguidas` : '';
    return {
      action: 'decrease',
      fromKg: slot.weightKg,
      toKg,
      reason: `${avgLabel}${sessionsLabel}`,
      repsToBeat: last.reps,
    };
  }

  // Within the target. Stalled there (rule 12): complete sessions in a row with this weight, all
  // within the target, whose reps have not gone up. Every third one suggests a deload, so an
  // ignored one does not come back at each session.
  const total = (s: SessionPerformance) => s.reps.slice(0, slot.sets).reduce((sum, r) => sum + r, 0);
  let stalled = 0;
  for (const s of history) {
    if (s.reps.length < slot.sets || !sameWeight(s.weightKg, last.weightKg) || assess(s.reps, slot.target, settings) !== 'in') break;
    stalled++;
  }
  const deloadKg = slot.allowDecrease && weight > 0 ? deloadWeight(weight, increment) : 0;
  const position = stalled % DELOAD_SESSIONS;
  if (deloadKg > 0 && stalled >= DELOAD_SESSIONS && position === 0 && total(last) <= total(history[DELOAD_SESSIONS - 1])) {
    return {
      action: 'decrease',
      fromKg: slot.weightKg,
      toKg: deloadKg,
      reason: 'Tres sesiones seguidas sin mejorar las reps: descarga para volver a subir',
      repsToBeat: last.reps,
      deload: true,
    };
  }
  // One session short of it, said so: one more rep next time avoids the surprise.
  const warning =
    deloadKg > 0 && position === DELOAD_SESSIONS - 1 && total(last) <= total(history[1]) ? ': si la próxima no mejora, te sugerirá bajar' : '';

  if (slot.target.kind === 'range') {
    // «Todas las series» rises only with every set at the top: the average may be above it already.
    if (settings.mode === 'strict') {
      const { max } = slot.target;
      const hit = last.reps.filter((r) => r >= max).length;
      return keep(`${hit > 0 ? `${hit} de ${last.reps.length} series en ${max} o más` : `Ninguna serie en ${max} o más`}${warning}`);
    }
    return keep(`Media de ${formatNumber(average(last.reps), 1)}, dentro de ${slot.target.min}–${slot.target.max}${warning}`);
  }
  return keep(`Aún no completas todas las series${warning}`);
}

/** «14, 12 y 11». */
const repsList = (reps: number[]) =>
  reps.length > 1 ? `${reps.slice(0, -1).join(', ')} y ${reps[reps.length - 1]}` : String(reps[0] ?? '');

/** What a suggestion says, with the verbs of its buttons: «Subir a 37,5 kg», «Mantener 35 kg». */
export function outcomeLabel(rec: Recommendation): string {
  if (rec.action === 'increase' && rec.toKg !== null) return `Subir a ${formatKg(rec.toKg)}`;
  if (rec.action === 'decrease' && rec.toKg !== null) return `Bajar a ${formatKg(rec.toKg)}`;
  return `Mantener ${formatKg(rec.fromKg ?? 0)}`;
}

export interface RuleExample {
  /** «14, 12 y 11» or «9, 9 y 8 dos veces seguidas». */
  label: string;
  outcome: string;
}

const exampleSlot = (weightKg: number): SlotRule => ({
  sets: 3,
  target: { kind: 'range', min: 10, max: 12 },
  progression: 'load',
  allowDecrease: true,
  incrementKg: null,
  weightKg,
});

/**
 * «Cuándo subir», on 10–12 reps with 35 kg: two sessions whose outcome swaps between the two rules
 * (the average of 14, 12 and 11 is above 12, but not every set is; 12, 12 and 12 the other way round).
 * Worked out by `recommend()` itself, so the example can never contradict the engine.
 */
export function raiseExamples(settings: ProgressionSettings): RuleExample[] {
  return [
    [14, 12, 11],
    [12, 12, 12],
  ].map((reps) => ({
    label: repsList(reps),
    outcome: outcomeLabel(recommend(exampleSlot(35), null, [{ weightKg: 35, reps }], settings)),
  }));
}

/** The deload, on 10–12 reps with 20 kg: three sessions within the range that go nowhere. */
export function deloadExample(settings: ProgressionSettings): RuleExample {
  const flat = { weightKg: 20, reps: [11, 11, 10] };
  return {
    label: `${repsList(flat.reps)} ${SESSIONS_IN_WORDS[DELOAD_SESSIONS]} veces seguidas`,
    outcome: outcomeLabel(recommend(exampleSlot(20), null, Array.from({ length: DELOAD_SESSIONS }, () => flat), settings)),
  };
}

/** «Cuándo bajar», on 10–12 reps with 20 kg: 9, 9 and 8 one session short of the rule, then enough. */
export function lowerExamples(settings: ProgressionSettings): RuleExample[] {
  const below = { weightKg: 20, reps: [9, 9, 8] };
  const needed = Math.max(1, settings.sessionsBelowToDecrease);
  const times = needed > 1 ? [needed - 1, needed] : [needed];
  return times.map((n) => ({
    label: `${repsList(below.reps)} ${n === 1 ? 'una vez' : `${SESSIONS_IN_WORDS[n] ?? n} veces seguidas`}`,
    outcome: outcomeLabel(recommend(exampleSlot(20), null, Array.from({ length: n }, () => below), settings)),
  }));
}
