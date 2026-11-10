import type { Db } from '../db';
import { getMeta, setMeta } from '../maintenance';

/** One-time tips (a gesture that cannot be seen); once used they never show again, even after a reset. */
export type Hint = 'walk-metric' | 'walk-chart' | 'sprint-how' | 'heat-map';

export async function hintsSeen(db: Db): Promise<Set<Hint>> {
  const seen = new Set<Hint>();
  for (const hint of ['walk-metric', 'walk-chart', 'sprint-how', 'heat-map'] as const) {
    if (await getMeta(db, `hint:${hint}`)) seen.add(hint);
  }
  return seen;
}

export const markHintSeen = (db: Db, hint: Hint) => setMeta(db, `hint:${hint}`, '1');
