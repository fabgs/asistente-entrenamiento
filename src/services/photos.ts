import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import type { Db } from '@/db/db';
import { addPhoto, deletePhoto, photoFilesOf, type Photo, type PhotoOwner } from '@/db/repositories/photos';
import type { LatLon } from '@/domain/gps';
import { exifPlace, exifTakenAt } from '@/domain/photos';

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
 * Takes a photo with the camera and adds it to the session. `place` is where it was taken (the
 * walk's last fix when the camera opened). The original also goes to the gallery, like any photo
 * taken with the phone; if that fails, the session still has its copy.
 */
export async function takePhoto(db: Db, owner: PhotoOwner, place: LatLon | null, now = Date.now()): Promise<AddPhotosResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return 'denied';
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 1 });
  if (result.canceled || result.assets.length === 0) return 'canceled';
  const { uri } = result.assets[0];
  const kept = await keep(uri);
  await addPhoto(db, owner, { ...kept, takenAt: now, place });
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
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: true,
    selectionLimit: MAX_PICK,
    orderedSelection: true,
    quality: 1,
    exif: true,
  });
  if (result.canceled || result.assets.length === 0) return 'canceled';
  let added = 0;
  for (const asset of result.assets) {
    const meta: PickedMeta = { takenAt: exifTakenAt(asset.exif), place: exifPlace(asset.exif) };
    const kept = await keep(asset.uri);
    await addPhoto(db, owner, { ...kept, takenAt: meta.takenAt, place: placeOf(meta) });
    added++;
  }
  return { added };
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
