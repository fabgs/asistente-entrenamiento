import { useEffect, useState } from 'react';
import { listHeatWalks, type HeatWalkRow } from '@/db/repositories/pathHeat';
import { decodeRoute } from '@/domain/gps';
import { addHeatWalks, emptyPathHeat, recencyWeight, type HeatWalk, type PathHeat } from '@/domain/pathHeat';
import { localDateString } from '@/domain/schedule';
import { useDb } from './data';

/** Older walks are read this many at a time, letting the screen breathe in between. */
const BATCH = 50;

const toWalk = (row: HeatWalkRow): HeatWalk => ({ id: row.id, date: row.date, startedAt: row.startedAt, segments: decodeRoute(row.route) });

// The last map built, while the app is open: opening the screen again is instant until a walk is added or the day changes.
let cache: { key: string; heat: PathHeat } | null = null;

export interface PathHeatState {
  /** Null until the walks of the last 30 days are in; then it keeps growing in place (see `version`). */
  heat: PathHeat | null;
  /** Changes whenever `heat` has more walks: what depends on it is worked out again. */
  version: number;
  /** Every walk is in: «Siempre» can be trusted. */
  done: boolean;
  today: string;
}

/**
 * The heat map of the walks (PLAN.md §6.8, 1.4.10), built in two steps so the screen has something
 * at once: first the walks of the last 30 days (all «Últimos 30 días» needs to colour its paths),
 * then the older ones in batches.
 */
export function usePathHeat(): PathHeatState {
  const db = useDb();
  const [state, setState] = useState<PathHeatState>(() => ({ heat: null, version: 0, done: false, today: localDateString(new Date()) }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = localDateString(new Date());
      const rows = await listHeatWalks(db);
      if (cancelled) return;
      const key = `${today}:${rows.length}:${rows[0]?.id ?? 0}:${rows[0]?.startedAt ?? 0}`;
      if (cache?.key === key) {
        setState({ heat: cache.heat, version: 2, done: true, today });
        return;
      }
      const heat = emptyPathHeat(today);
      // The latest first: rows come in that order, and those of the last 30 days are its start.
      const recent = rows.filter((r) => recencyWeight(r.date, today) > 0);
      const older = rows.filter((r) => recencyWeight(r.date, today) <= 0);
      addHeatWalks(heat, recent.map(toWalk));
      setState({ heat, version: 1, done: older.length === 0, today });
      for (let i = 0; i < older.length; i += BATCH) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled) return;
        addHeatWalks(heat, older.slice(i, i + BATCH).map(toWalk));
      }
      cache = { key, heat };
      if (older.length > 0) setState({ heat, version: 2, done: true, today });
    })().catch((e) => console.warn('Could not build the heat map', e));
    return () => {
      cancelled = true;
    };
  }, [db]);

  return state;
}
