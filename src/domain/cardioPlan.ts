import { describeSprintPlan, type SprintPlan } from './sprint';

/** How an activity is recorded: checked off, a GPS walk, a timer by phases or sprints. */
export type CardioTracking = 'check' | 'gps' | 'timer' | 'sprint';
export type Intensity = 'low' | 'medium' | 'high';

export type CardioPlan =
  | { kind: 'liss'; minutes: number }
  | { kind: 'miss'; warmupMin: number; mainMin: number; cooldownMin: number }
  | { kind: 'hiit'; warmupMin: number; rounds: number; workSec: number; restSec: number; cooldownMin: number };

export type PlanKind = CardioPlan['kind'];

export interface Phase {
  label: string;
  intensity: Intensity;
  /** Seconds from the start of the session. */
  startSec: number;
  seconds: number;
}

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  liss: 'LISS · continuo suave',
  miss: 'MISS · intensidad media',
  hiit: 'HIIT · intervalos',
};

export const INTENSITY_LABEL: Record<Intensity, string> = {
  low: 'Suave',
  medium: 'Media',
  high: 'Alta',
};

export const DEFAULT_PLANS: { [K in PlanKind]: Extract<CardioPlan, { kind: K }> } = {
  liss: { kind: 'liss', minutes: 30 },
  miss: { kind: 'miss', warmupMin: 5, mainMin: 20, cooldownMin: 5 },
  hiit: { kind: 'hiit', warmupMin: 3, rounds: 6, workSec: 30, restSec: 60, cooldownMin: 3 },
};

/** Consecutive phases from the plan; blocks of 0 length are left out. */
export function expandPlan(plan: CardioPlan): Phase[] {
  const blocks: Omit<Phase, 'startSec'>[] = [];
  const add = (label: string, intensity: Intensity, seconds: number) => {
    if (seconds > 0) blocks.push({ label, intensity, seconds });
  };
  switch (plan.kind) {
    case 'liss':
      add('Ritmo suave (Z2)', 'low', plan.minutes * 60);
      break;
    case 'miss':
      add('Calentamiento', 'low', plan.warmupMin * 60);
      add('Intensidad media (Z3-4)', 'medium', plan.mainMin * 60);
      add('Enfriamiento', 'low', plan.cooldownMin * 60);
      break;
    case 'hiit':
      add('Calentamiento', 'low', plan.warmupMin * 60);
      for (let r = 1; r <= plan.rounds; r++) {
        add(`Sprint ${r}/${plan.rounds}`, 'high', plan.workSec);
        add(`Recupera ${r}/${plan.rounds}`, 'low', plan.restSec);
      }
      add('Enfriamiento', 'low', plan.cooldownMin * 60);
      break;
  }
  let start = 0;
  return blocks.map((b) => {
    const phase = { ...b, startSec: start };
    start += b.seconds;
    return phase;
  });
}

export function planSeconds(plan: CardioPlan): number {
  return expandPlan(plan).reduce((sum, p) => sum + p.seconds, 0);
}

export interface PhasePosition {
  index: number;
  phase: Phase;
  /** Seconds left in this phase. */
  remainingSec: number;
}

/** The phase running after `elapsedSec`, or null once the plan is over. */
export function phaseAt(phases: Phase[], elapsedSec: number): PhasePosition | null {
  for (const [index, phase] of phases.entries()) {
    const end = phase.startSec + phase.seconds;
    if (elapsedSec < end) return { index, phase, remainingSec: end - Math.max(elapsedSec, phase.startSec) };
  }
  return null;
}

const seconds = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);

/** "5 + 20 + 5 min", "30 min" or "3 min + 6 × (30 s / 60 s) + 3 min". */
export function describePlan(plan: CardioPlan): string {
  switch (plan.kind) {
    case 'liss':
      return `${plan.minutes} min`;
    case 'miss':
      return `${plan.warmupMin} + ${plan.mainMin} + ${plan.cooldownMin} min`;
    case 'hiit':
      return [
        plan.warmupMin > 0 ? `${plan.warmupMin} min` : null,
        `${plan.rounds} × (${seconds(plan.workSec)} / ${seconds(plan.restSec)})`,
        plan.cooldownMin > 0 ? `${plan.cooldownMin} min` : null,
      ]
        .filter(Boolean)
        .join(' + ');
  }
}

const isCount = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** The stored JSON plan, or null if missing or malformed. */
export function parsePlan(json: string | null): CardioPlan | null {
  if (!json) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const fields: Record<PlanKind, string[]> = {
    liss: ['minutes'],
    miss: ['warmupMin', 'mainMin', 'cooldownMin'],
    hiit: ['warmupMin', 'rounds', 'workSec', 'restSec', 'cooldownMin'],
  };
  const kind = p?.kind as PlanKind;
  if (!(kind in fields) || !fields[kind].every((f) => isCount(p[f]))) return null;
  const plan = p as unknown as CardioPlan;
  return planSeconds(plan) > 0 ? plan : null;
}

export interface PlanAlarm {
  key: string;
  /** Epoch ms. */
  at: number;
  title: string;
  body: string;
}

/**
 * Alarms still ahead for a plan whose clock started at `planStartMs` (moved forward by pauses): one
 * per phase change, announcing the new phase, and one at the end. The first phase needs none.
 */
export function planAlarms(plan: CardioPlan, name: string, planStartMs: number, now: number): PlanAlarm[] {
  const phases = expandPlan(plan);
  const alarms: PlanAlarm[] = [];
  for (const [i, phase] of phases.entries()) {
    const at = planStartMs + phase.startSec * 1000;
    if (i === 0 || at <= now) continue;
    const next = phases[i + 1];
    alarms.push({
      key: String(i),
      at,
      title: `${phase.label} · ${seconds(phase.seconds)}`,
      body: `Intensidad ${INTENSITY_LABEL[phase.intensity].toLowerCase()}${next ? ` · luego: ${next.label}` : ' · última fase'}`,
    });
  }
  const end = planStartMs + planSeconds(plan) * 1000;
  if (end > now) alarms.push({ key: 'end', at: end, title: '¡Cardio terminado!', body: `${name} · ${describePlan(plan)}` });
  return alarms;
}

/**
 * What an activity is about, after its target: the plan of a timer or of the sprints, or its
 * intensity. Hoy and the weekly cardio show the same text.
 */
export function trackingDetails(a: {
  tracking: CardioTracking;
  plan: CardioPlan | null;
  sprint: SprintPlan | null;
  intensity: string | null;
}): string | null {
  if (a.tracking === 'timer' && a.plan) {
    return a.plan.kind === 'liss' ? PLAN_KIND_LABEL.liss : `${PLAN_KIND_LABEL[a.plan.kind]} · ${describePlan(a.plan)}`;
  }
  if (a.tracking === 'sprint' && a.sprint) return describeSprintPlan(a.sprint);
  return a.intensity;
}

/**
 * Cardio that uses the lock-screen countdown of the rest-timer module (the timer by phases and the
 * sprints): it cannot run while a workout does, which needs it for its rests.
 */
export const sharesLockCountdown = (tracking: CardioTracking) => tracking === 'sprint' || tracking === 'timer';
