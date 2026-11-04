import type { CardioPlan, CardioTracking } from './cardioPlan';
import { normalizeForSearch } from './format';
import type { SprintPlan } from './sprint';
import type { IsoWeekday } from './types';

/**
 * «Hacer otro cardio» (PLAN.md §6.8): the cardio of the other days of the week as a pool. An
 * activity is planned per weekday, so «Caminar 5 km» exists once for each of its days: the pool
 * shows it once, with the days it belongs to.
 */
export interface PoolActivity {
  id: number;
  weekday: IsoWeekday;
  name: string;
  target: string | null;
  intensity: string | null;
  tracking: CardioTracking;
  plan: CardioPlan | null;
  sprint: SprintPlan | null;
}

export interface PoolEntry<A> {
  /** The one done when picked: the oldest of the group (lowest id). */
  activity: A;
  weekdays: IsoWeekday[];
}

/** Everything an activity stores but its notes; texts without case, accents or surrounding spaces. */
export function cardioKey(a: PoolActivity): string {
  const text = (s: string | null) => normalizeForSearch(s?.trim() ?? '') || null;
  const plan = a.tracking === 'timer' ? a.plan : a.tracking === 'sprint' ? a.sprint : null;
  return JSON.stringify([
    text(a.name),
    text(a.target),
    text(a.intensity),
    a.tracking,
    plan ? Object.entries(plan).sort(([x], [y]) => x.localeCompare(y)) : null,
  ]);
}

/**
 * The other cardio for today: every group of equal activities with none planned for today and none
 * done today. `all` comes in the order of the weekly cardio (day, position), which the pool keeps.
 */
export function cardioPool<A extends PoolActivity>(all: readonly A[], today: IsoWeekday, doneToday: ReadonlySet<number>): PoolEntry<A>[] {
  const groups = new Map<string, A[]>();
  for (const a of all) {
    const key = cardioKey(a);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const pool: PoolEntry<A>[] = [];
  for (const members of groups.values()) {
    if (members.some((m) => m.weekday === today || doneToday.has(m.id))) continue;
    const activity = members.reduce((min, m) => (m.id < min.id ? m : min));
    const weekdays = [...new Set(members.map((m) => m.weekday))].sort((x, y) => x - y);
    pool.push({ activity, weekdays });
  }
  return pool;
}

/** Activities of other days done today (from the pool), in the order of the weekly cardio. */
export function doneOnOtherDays<A extends { id: number; weekday: IsoWeekday }>(all: readonly A[], today: IsoWeekday, doneToday: ReadonlySet<number>): A[] {
  return all.filter((a) => a.weekday !== today && doneToday.has(a.id));
}
