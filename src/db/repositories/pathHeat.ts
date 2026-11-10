import type { HeatMode } from '@/domain/pathHeat';
import type { Db } from '../db';
import { getMeta, setMeta } from '../maintenance';

/** A finished walk with its line as it is stored (an encoded polyline with its segments). */
export interface HeatWalkRow {
  id: number;
  date: string;
  startedAt: number;
  route: string;
}

/**
 * What the heat map is built from (PLAN.md §6.8, 1.4.10): every finished walk with GPS, of any
 * activity and saved as a route or not, the latest first. Not the sprints, nor a walk in progress.
 */
export async function listHeatWalks(db: Db): Promise<HeatWalkRow[]> {
  return db.getAllAsync<HeatWalkRow>(
    `SELECT id, date, started_at AS startedAt, route FROM cardio_session
     WHERE status = 'finished' AND tracking = 'gps' AND route IS NOT NULL AND route <> ''
     ORDER BY started_at DESC, id DESC`,
  );
}

const MODE_KEY = 'heat-map-mode';

/** The mode the map was last looked at in. In app_meta: how a screen is left is not data of the copy. */
export async function getHeatMode(db: Db): Promise<HeatMode> {
  return (await getMeta(db, MODE_KEY)) === 'always' ? 'always' : 'recent';
}

export const setHeatMode = (db: Db, mode: HeatMode) => setMeta(db, MODE_KEY, mode);
