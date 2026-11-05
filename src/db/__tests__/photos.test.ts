import type { Db } from '../db';
import { exportBackup, parseBackup, restoreBackup, wipeAllData } from '../maintenance';
import { listCardio } from '../repositories/cardio';
import { discardCardioSession, finishCardioSession, startCardioSession } from '../repositories/cardioSessions';
import { addPhoto, deletePhoto, getPhoto, listPhotos, photoFilesOf, type NewPhoto } from '../repositories/photos';
import { listRoutines } from '../repositories/routines';
import { deleteFinishedSession, startSession } from '../repositories/sessions';
import { importSeed } from '../seed';
import { DEMO_SEED as SEED } from '../demoSeed';
import { createTestDb } from './testDb';

const NOW = new Date(2026, 10, 5, 9, 51);
const T0 = NOW.getTime();

const shot = (file: string, extra: Partial<NewPhoto> = {}): NewPhoto => ({
  file,
  width: 2160,
  height: 1620,
  takenAt: null,
  place: null,
  ...extra,
});

async function withSessions(): Promise<{ db: Db; walk: number; workout: number }> {
  const db = await createTestDb();
  await importSeed(db, SEED, NOW);
  const caminar = (await listCardio(db)).find((a) => a.tracking === 'gps')!;
  const walk = await startCardioSession(db, caminar, T0);
  await finishCardioSession(db, walk, T0 + 3_600_000);
  const workout = await startSession(db, (await listRoutines(db))[0].id, NOW);
  return { db, walk, workout };
}

describe('photos', () => {
  it('lists the photos of each session in the order they were taken', async () => {
    const { db, walk, workout } = await withSessions();
    await addPhoto(db, { kind: 'cardio', id: walk }, shot('b.jpg', { takenAt: T0 + 600_000 }), T0 + 4_000_000);
    await addPhoto(db, { kind: 'cardio', id: walk }, shot('a.jpg', { takenAt: T0 + 60_000, place: { lat: 38.07, lon: -0.97 } }));
    await addPhoto(db, { kind: 'workout', id: workout }, shot('gym.jpg'), T0);

    const photos = await listPhotos(db, { kind: 'cardio', id: walk });
    expect(photos.map((p) => p.file)).toEqual(['a.jpg', 'b.jpg']);
    expect(photos[0]).toMatchObject({ owner: { kind: 'cardio', id: walk }, place: { lat: 38.07, lon: -0.97 }, width: 2160 });
    expect(photos[1].place).toBeNull();
    expect((await listPhotos(db, { kind: 'workout', id: workout })).map((p) => p.file)).toEqual(['gym.jpg']);
  });

  it('removes one photo', async () => {
    const { db, walk } = await withSessions();
    const id = await addPhoto(db, { kind: 'cardio', id: walk }, shot('a.jpg'));
    expect((await getPhoto(db, id))?.file).toBe('a.jpg');
    await deletePhoto(db, id);
    expect(await getPhoto(db, id)).toBeNull();
  });

  it('a photo belongs to exactly one session', async () => {
    const { db, walk, workout } = await withSessions();
    await expect(
      db.runAsync(
        `INSERT INTO photo (cardio_session_id, workout_session_id, file, width, height, created_at) VALUES (?, ?, 'x.jpg', 1, 1, 0)`,
        walk,
        workout,
      ),
    ).rejects.toThrow();
  });

  it('goes away with its session, leaving the file names to delete', async () => {
    const { db, walk, workout } = await withSessions();
    await addPhoto(db, { kind: 'cardio', id: walk }, shot('walk.jpg'));
    await addPhoto(db, { kind: 'workout', id: workout }, shot('gym.jpg'));
    expect(await photoFilesOf(db, { kind: 'cardio', id: walk })).toEqual(['walk.jpg']);

    await discardCardioSession(db, walk);
    await deleteFinishedSession(db, workout);
    expect(await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM photo')).toEqual({ n: 0 });
  });

  it('travels in the backup (only the rows) and comes back after a wipe', async () => {
    const { db, walk } = await withSessions();
    await addPhoto(db, { kind: 'cardio', id: walk }, shot('walk.jpg', { takenAt: T0, place: { lat: 38.07, lon: -0.97 } }));
    const backup = parseBackup(JSON.stringify(await exportBackup(db, NOW)));
    expect(backup.tables.photo).toHaveLength(1);

    await wipeAllData(db);
    expect(await listPhotos(db, { kind: 'cardio', id: walk })).toEqual([]);
    await restoreBackup(db, backup);
    const [back] = await listPhotos(db, { kind: 'cardio', id: walk });
    expect(back).toMatchObject({ file: 'walk.jpg', takenAt: T0, place: { lat: 38.07, lon: -0.97 } });
  });

  it('restores a backup from before photos existed', async () => {
    const { db } = await withSessions();
    const backup = await exportBackup(db, NOW);
    delete backup.tables.photo;
    await restoreBackup(db, { ...backup, schemaVersion: 9 });
    expect(await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM photo')).toEqual({ n: 0 });
  });
});
