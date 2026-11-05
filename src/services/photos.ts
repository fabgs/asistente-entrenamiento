import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import type { Db } from '@/db/db';
import { deleteMeta, getMeta, setMeta } from '@/db/maintenance';
import { getCardioSession } from '@/db/repositories/cardioSessions';
import { addPhoto, allPhotoFiles, deletePhoto, photoFilesOf, type Photo, type PhotoOwner } from '@/db/repositories/photos';
import { getSession } from '@/db/repositories/sessions';
import type { LatLon } from '@/domain/gps';
import { exifPlace, exifTakenAt, photoPlace, photosWithoutSession, walkTrackOf } from '@/domain/photos';

/**
 * Photos of sessions. Each one is copied into the app's own folder, made smaller (2160 px on its
 * long side, enough for a 1080 × 1920 story): the gallery's original can be deleted or moved
 * without the session losing it. The backups carry the rows, not the pictures; a wipe (test mode,
 * restore) keeps the files, so restoring the backup on the same phone brings the photos back.
 */
const MAX_SIDE = 2160;
const QUALITY = 0.85;
/** Photos chosen at once from the gallery. */
const MAX_PICK = 10;

const FOLDER = ['photos'] as const;

function folder(): Directory {
  const dir = new Directory(Paths.document, ...FOLDER);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const photoFile = (file: string) => new File(Paths.document, ...FOLDER, file);

export const photoUri = (file: string) => photoFile(file).uri;

/** False on a phone where the backup was restored but the picture never was. */
export const isOnPhone = (photo: Photo) => photoFile(photo.file).exists;

/** A smaller JPEG copy of the picture in the app's folder. */
async function keep(uri: string): Promise<{ file: string; width: number; height: number }> {
  // Glide applies the EXIF orientation when decoding: the copy is upright and has no EXIF.
  const image = await ImageManipulator.manipulate(uri, { maxWidth: MAX_SIDE, maxHeight: MAX_SIDE }).renderAsync();
  const saved = await image.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  new File(saved.uri).move(new File(folder(), name));
  return { file: name, width: saved.width, height: saved.height };
}

function deleteFiles(files: string[]): void {
  for (const file of files) {
    try {
      const f = photoFile(file);
      if (f.exists) f.delete();
    } catch (e) {
      console.warn('Could not delete a photo', e);
    }
  }
}

export type AddPhotosResult = { added: number } | 'canceled' | 'denied';

/** What a picture from the gallery tells: when and (rarely, see exifPlace) where it was taken. */
export interface PickedMeta {
  takenAt: number | null;
  place: LatLon | null;
}

/**
 * What the camera or the gallery was opened for, in app_meta while it is open: Android may close the
 * app meanwhile (little memory, a big camera app), and then the photo comes back on the next start
 * (recoverPendingPhotos).
 */
const PENDING = 'photo-pending';

interface PendingPhoto {
  owner: PhotoOwner;
  source: 'camera' | 'gallery';
  /** Camera: where it was taken (the walk's last fix), and when. */
  place: LatLon | null;
  at: number;
}

/** Runs the camera or the picker with its PendingPhoto saved; if it returns normally, nothing is pending. */
async function launching<T>(db: Db, pending: PendingPhoto, launch: () => Promise<T>): Promise<T> {
  await setMeta(db, PENDING, JSON.stringify(pending));
  try {
    return await launch();
  } finally {
    await deleteMeta(db, PENDING);
  }
}

/**
 * Takes a photo with the camera and adds it to the session. `place` is where it was taken (the
 * walk's last fix when the camera opened). The original also goes to the gallery, like any photo
 * taken with the phone; if that fails, the session still has its copy.
 */
export async function takePhoto(db: Db, owner: PhotoOwner, place: LatLon | null, now = Date.now()): Promise<AddPhotosResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return 'denied';
  const result = await launching(db, { owner, source: 'camera', place, at: now }, () =>
    ImagePicker.launchCameraAsync(CAMERA_OPTIONS),
  );
  if (result.canceled || result.assets.length === 0) return 'canceled';
  return addTaken(db, owner, result.assets[0].uri, place, now);
}

const CAMERA_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 1 };
const GALLERY_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: 'images',
  allowsMultipleSelection: true,
  selectionLimit: MAX_PICK,
  orderedSelection: true,
  quality: 1,
  exif: true,
};

async function addTaken(db: Db, owner: PhotoOwner, uri: string, place: LatLon | null, takenAt: number): Promise<AddPhotosResult> {
  const kept = await keep(uri);
  await addPhoto(db, owner, { ...kept, takenAt, place });
  saveOriginal(uri);
  return { added: 1 };
}

async function saveOriginal(uri: string): Promise<void> {
  try {
    if ((await requestPermissionsAsync(true)).granted) await Asset.create(uri);
  } catch (e) {
    console.warn('Could not save the photo in the gallery', e);
  }
}

/**
 * Adds photos chosen from the gallery. `placeOf` decides where each one goes on the route from
 * what its EXIF says (on a walk); without it, nowhere.
 */
export async function pickPhotos(
  db: Db,
  owner: PhotoOwner,
  placeOf: (meta: PickedMeta) => LatLon | null = () => null,
): Promise<AddPhotosResult> {
  const result = await launching(db, { owner, source: 'gallery', place: null, at: Date.now() }, () =>
    ImagePicker.launchImageLibraryAsync(GALLERY_OPTIONS),
  );
  if (result.canceled || result.assets.length === 0) return 'canceled';
  return addPicked(db, owner, result.assets, placeOf);
}

async function addPicked(
  db: Db,
  owner: PhotoOwner,
  assets: ImagePicker.ImagePickerAsset[],
  placeOf: (meta: PickedMeta) => LatLon | null,
): Promise<AddPhotosResult> {
  let added = 0;
  for (const asset of assets) {
    const meta: PickedMeta = { takenAt: exifTakenAt(asset.exif), place: exifPlace(asset.exif) };
    const kept = await keep(asset.uri);
    await addPhoto(db, owner, { ...kept, takenAt: meta.takenAt, place: placeOf(meta) });
    added++;
  }
  return { added };
}

/**
 * On start: if Android closed the app while the camera or the gallery was open, adds what came back
 * to the session it was opened for, placed as it would have been. Null when there is nothing (the
 * usual case), it was cancelled or the session no longer exists.
 */
export async function recoverPendingPhotos(db: Db): Promise<{ owner: PhotoOwner; added: number } | null> {
  const saved = await getMeta(db, PENDING);
  if (saved === null) return null;
  await deleteMeta(db, PENDING);
  const pending = JSON.parse(saved) as PendingPhoto;
  const { owner } = pending;
  const result = await ImagePicker.getPendingResultAsync();
  const assets = result && !('code' in result) && !result.canceled ? result.assets : [];
  // The picker keeps its result only when Android closed the screen; when it killed the whole app
  // (little memory, the usual case) the result is lost, but the camera did write the picture.
  const shot = assets.length === 0 && pending.source === 'camera' ? cameraFileSince(pending.at) : null;
  if (assets.length === 0 && !shot) return null;
  const cardio = owner.kind === 'cardio' ? await getCardioSession(db, owner.id) : null;
  if (owner.kind === 'cardio' ? !cardio : !(await getSession(db, owner.id))) return null;
  let outcome: AddPhotosResult;
  if (pending.source === 'camera') {
    outcome = await addTaken(db, owner, shot?.uri ?? assets[0].uri, pending.place, pending.at);
  } else {
    const track = cardio?.tracking === 'gps' ? walkTrackOf(cardio) : null;
    outcome = await addPicked(db, owner, assets, track ? (meta) => photoPlace(track, meta) : () => null);
  }
  return typeof outcome === 'object' ? { owner, added: outcome.added } : null;
}

/**
 * The picture the camera wrote after `at`: expo-image-picker gives it a new file in its cache folder
 * (`ImagePicker`, see createOutputFile in the library) before opening the camera.
 */
function cameraFileSince(at: number): File | null {
  const dir = new Directory(Paths.cache, 'ImagePicker');
  if (!dir.exists) return null;
  const shots = dir
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
    .map((file) => ({ file, time: file.info().modificationTime ?? 0 }))
    .filter(({ time }) => time >= at)
    .sort((a, b) => b.time - a.time);
  return shots[0]?.file ?? null;
}

export async function removePhoto(db: Db, photo: Photo): Promise<void> {
  await deletePhoto(db, photo.id);
  deleteFiles([photo.file]);
}

/**
 * Runs the deletion of a session and then deletes its photos' pictures (the rows go with the
 * session, in its own transaction).
 */
export async function deletingPhotosOf(db: Db, owner: PhotoOwner, deleteSession: () => Promise<void>): Promise<void> {
  const files = await photoFilesOf(db, owner);
  await deleteSession();
  deleteFiles(files);
}

/** Pictures of the folder that no session uses any more, and how much they take (see photosWithoutSession). */
export async function unusedPhotos(db: Db): Promise<{ files: string[]; bytes: number }> {
  const onDisk = folder()
    .list()
    .filter((entry): entry is File => entry instanceof File)
    .map((f) => ({ name: f.name, size: f.size }));
  return photosWithoutSession(onDisk, await allPhotoFiles(db));
}

/** Deletes them, counted again now: a photo added meanwhile stays. */
export async function deleteUnusedPhotos(db: Db): Promise<void> {
  deleteFiles((await unusedPhotos(db)).files);
}
