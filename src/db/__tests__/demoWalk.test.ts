import { activeMs, decodeRoute, elevationChange, altitudeProfile } from '@/domain/gps';
import { addDemoWalk } from '../demoWalk';
import { getCardioSession } from '../repositories/cardioSessions';
import { importSeed } from '../seed';
import { SEED } from '../seedData';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 3, 10, 0);

it('adds a finished walk of about 5 km with a pause, a route and its profile', async () => {
  const db = await createTestDb();
  await importSeed(db, SEED, NOW);
  const session = (await getCardioSession(db, await addDemoWalk(db, NOW.getTime())))!;

  expect(session.status).toBe('finished');
  expect(session.distanceM).toBeGreaterThan(4500);
  expect(session.distanceM).toBeLessThan(5800);
  expect(decodeRoute(session.route)).toHaveLength(2);
  expect(session.pausedMs).toBe(120_000);
  expect(activeMs(session, session.finishedAt!) / 60_000).toBeGreaterThan(50);
  expect(elevationChange(altitudeProfile(session.samples)).gain).toBeGreaterThan(50);
});
