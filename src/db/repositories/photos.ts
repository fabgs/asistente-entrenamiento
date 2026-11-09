import type { LatLon } from '@/domain/gps';
import type { Db } from '../db';

/** What a photo belongs to: a cardio session (walk, phases, sprints) or a workout. */
export interface PhotoOwner {
  kind: 'cardio' | 'workout';
  id: number;
}

/**
 * A photo of a session. The picture is a file in the app's own folder (`file`, see
 * services/photos.ts); the row is in the backups, the picture is not.
 */
export interface Photo {
  id: number;
  owner: PhotoOwner;
  file: string;
  width: number;
  height: number;
  /** When it was taken, if known (EXIF of the gallery, or the moment the camera opened). */
  takenAt: number | null;
  /** Where on the route, if known: its pin on the map. */
  place: LatLon | null;
  createdAt: number;
}

export interface NewPhoto {
  file: string;
  width: number;
  height: number;
  takenAt: number | null;
  place: LatLon | null;
}

interface PhotoRow {
  id: number;
  cardio_session_id: number | null;
  workout_session_id: number | null;
  file: string;
  width: number;
  height: number;
  taken_at: number | null;
  lat: number | null;
  lon: number | null;
  created_at: number;
}

const column = (owner: PhotoOwner) => (owner.kind === 'cardio' ? 'cardio_session_id' : 'workout_session_id');

const fromRow = (r: PhotoRow): Photo => ({
  id: r.id,
  owner: r.cardio_session_id !== null ? { kind: 'cardio', id: r.cardio_session_id } : { kind: 'workout', id: r.workout_session_id! },
  file: r.file,
  width: r.width,
  height: r.height,
  takenAt: r.taken_at,
  place: r.lat !== null && r.lon !== null ? { lat: r.lat, lon: r.lon } : null,
  createdAt: r.created_at,
});

export async function addPhoto(db: Db, owner: PhotoOwner, photo: NewPhoto, now = Date.now()): Promise<number> {
  const { lastInsertRowId } = await db.runAsync(
    `INSERT INTO photo (${column(owner)}, file, width, height, taken_at, lat, lon, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    owner.id,
    photo.file,
    photo.width,
    photo.height,
    photo.takenAt,
    photo.place?.lat ?? null,
    photo.place?.lon ?? null,
    now,
  );
  return lastInsertRowId;
}

/** In the order they were taken (or added, when the time is unknown). */
export async function listPhotos(db: Db, owner: PhotoOwner): Promise<Photo[]> {
  const rows = await db.getAllAsync<PhotoRow>(
    `SELECT * FROM photo WHERE ${column(owner)} = ? ORDER BY COALESCE(taken_at, created_at), id`,
    owner.id,
  );
  return rows.map(fromRow);
}

/** The photos of every walk of a saved route, in the order they were taken. */
export async function listRoutePhotos(db: Db, routeId: number): Promise<Photo[]> {
  const rows = await db.getAllAsync<PhotoRow>(
    `SELECT photo.* FROM photo JOIN cardio_session ON cardio_session.id = photo.cardio_session_id
     WHERE cardio_session.route_id = ? ORDER BY COALESCE(photo.taken_at, photo.created_at), photo.id`,
    routeId,
  );
  return rows.map(fromRow);
}

export async function getPhoto(db: Db, id: number): Promise<Photo | null> {
  const row = await db.getFirstAsync<PhotoRow>('SELECT * FROM photo WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

export async function deletePhoto(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM photo WHERE id = ?', id);
}

/** The files of a session's photos: to delete them after deleting the session. */
export async function photoFilesOf(db: Db, owner: PhotoOwner): Promise<string[]> {
  const rows = await db.getAllAsync<{ file: string }>(`SELECT file FROM photo WHERE ${column(owner)} = ?`, owner.id);
  return rows.map((r) => r.file);
}

/** The pictures every photo row uses, of any session. */
export async function allPhotoFiles(db: Db): Promise<string[]> {
  return (await db.getAllAsync<{ file: string }>('SELECT file FROM photo')).map((r) => r.file);
}
