import type { CardioPlan, CardioTracking } from './cardioPlan';
import { normalizeForSearch } from './format';
import { weekdaysLabel } from './schedule';
import type { SprintPlan } from './sprint';
import type { IsoWeekday } from './types';

/**
 * «Hacer otro cardio» (PLAN.md §6.3 and §6.8): the cardio that is not waiting in «Para hoy», as a
 * pool. An activity is planned per weekday, so «Caminar 5 km» exists once for each of its days: the
 * pool shows it once, with the days it belongs to. Since the 1.5.0 it also holds the activities of
 * no day («sin día») and what was already done today with a session, to do it again.
 */
export interface PoolActivity {
  id: number;
  /** Null for an activity «sin día». */
  weekday: IsoWeekday | null;
  name: string;
  target: string | null;
  intensity: string | null;
  tracking: CardioTracking;
  plan: CardioPlan | null;
  sprint: SprintPlan | null;
}

export interface PoolEntry<A> {
  /** The one done when picked: the one done today, else the one «sin día», else the oldest of the group (lowest id). */
  activity: A;
  weekdays: IsoWeekday[];
  /** Some activity of the group has no day. */
  noDay: boolean;
  /** Times the group was done today: its finished sessions, or 1 when only checked off. */
  doneToday: number;
}

/**
 * Everything an activity stores but its notes; texts without case, accents or surrounding spaces. Of
 * a sprints plan, only how many and the rest: the count before the beep and the length of the
 * straight (1.5.0) are how one runs them, not another activity.
 */
export function cardioKey(a: PoolActivity): string {
  const text = (s: string | null) => normalizeForSearch(s?.trim() ?? '') || null;
  const plan =
    a.tracking === 'timer'
      ? a.plan
      : a.tracking === 'sprint' && a.sprint
        ? { kind: a.sprint.kind, sprints: a.sprint.sprints, restSec: a.sprint.restSec }
        : null;
  return JSON.stringify([
    text(a.name),
    text(a.target),
    text(a.intensity),
    a.tracking,
    plan ? Object.entries(plan).sort(([x], [y]) => x.localeCompare(y)) : null,
  ]);
}

/** The activities grouped as the same one, in the order they come in. */
function groupsOf<A extends PoolActivity>(all: readonly A[]): A[][] {
  const groups = new Map<string, A[]>();
  for (const a of all) {
    const key = cardioKey(a);
    const group = groups.get(key);
    if (group) group.push(a);
    else groups.set(key, [a]);
  }
  return [...groups.values()];
}

/** Who stands for a group: the one done today (its log is the one that grows), else the one «sin día», else the oldest. */
function representative<A extends PoolActivity>(members: readonly A[], doneToday: ReadonlyMap<number, number>): A {
  const oldest = (list: readonly A[]) => list.reduce((min, m) => (m.id < min.id ? m : min));
  const done = members.filter((m) => doneToday.has(m.id));
  if (done.length > 0) return oldest(done);
  const noDay = members.filter((m) => m.weekday === null);
  return oldest(noDay.length > 0 ? noDay : members);
}

/**
 * The other cardio for today. Every group of equal activities except those with one planned for
 * today and not done yet (it is in «Para hoy») and those that are only checked off and already are.
 * First what was done today (to do it again), then the activities «sin día», then those of other
 * days in the order of the week. `all` comes in the order of the weekly cardio; `doneToday` says how
 * many times each activity was done today.
 */
export function cardioPool<A extends PoolActivity>(all: readonly A[], today: IsoWeekday, doneToday: ReadonlyMap<number, number>): PoolEntry<A>[] {
  const pool: PoolEntry<A>[] = [];
  for (const members of groupsOf(all)) {
    const done = members.reduce((sum, m) => sum + (doneToday.get(m.id) ?? 0), 0);
    if (members.some((m) => m.weekday === today && !doneToday.has(m.id))) continue;
    if (done > 0 && members[0].tracking === 'check') continue;
    pool.push({
      activity: representative(members, doneToday),
      weekdays: [...new Set(members.map((m) => m.weekday).filter((d): d is IsoWeekday => d !== null))].sort((x, y) => x - y),
      noDay: members.some((m) => m.weekday === null),
      doneToday: done,
    });
  }
  const rank = (e: PoolEntry<A>) => (e.doneToday > 0 ? 0 : e.noDay ? 1 : 2);
  // Stable: within each part, the order of the weekly cardio.
  return pool.map((entry, i) => ({ entry, i })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.i - b.i).map(({ entry }) => entry);
}

/** The last line of a row of the pool: «Hecho hoy», «Hecho hoy 2 veces», «Sin día» or its days. */
export function poolLine(entry: Pick<PoolEntry<unknown>, 'weekdays' | 'noDay' | 'doneToday'>): string {
  if (entry.doneToday > 1) return `Hecho hoy ${entry.doneToday} veces`;
  if (entry.doneToday === 1) return 'Hecho hoy';
  return entry.noDay ? weekdaysLabel([]) : weekdaysLabel(entry.weekdays);
}

/**
 * The walks with GPS that Hoy lets start now, one per group as the pool has them (today's, those of
 * other days, those «sin día» and those already done today): what «Seguir esta ruta» starts.
 */
export function walksToStart<A extends PoolActivity>(all: readonly A[], doneToday: ReadonlyMap<number, number>): A[] {
  return groupsOf(all.filter((a) => a.tracking === 'gps')).map((members) => representative(members, doneToday));
}
