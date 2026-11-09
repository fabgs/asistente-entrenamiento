import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { CardioSession } from '@/db/repositories/cardioSessions';
import type { SavedRoute } from '@/db/repositories/routes';
import { decodeRoute } from '@/domain/gps';
import { checkGpxRoute, gpxFileName, GpxError, parseGpx, toGpx, walkElevation, type GpxTrack } from '@/domain/gpx';
import { defaultRouteName, routeLengthM } from '@/domain/routes';

/** A GPX chosen to import, checked, with the name to offer (its own, cut to 40, or «Ruta de 8,2 km»). */
export interface PickedGpx {
  track: GpxTrack;
  name: string;
}

/**
 * Lets the user choose a GPX (any type: Android marks .gpx as anything) and checks it as a route.
 * Null if cancelled; throws GpxError with a message for the user.
 */
export async function pickGpx(): Promise<PickedGpx | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['*/*'] });
  if (picked.canceled || !picked.result) return null;
  let text: string;
  try {
    text = await picked.result.text();
  } catch {
    throw new GpxError('No se pudo leer el fichero.');
  }
  const track = parseGpx(text);
  checkGpxRoute(track);
  return { track, name: (track.name ?? defaultRouteName(null, routeLengthM(track.segments))).slice(0, 40).trim() };
}

/** Opens the share sheet with a GPX written to the cache. */
async function shareGpx(fileName: string, xml: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  await file.write(xml);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/gpx+xml', dialogTitle: 'Exportar GPX' });
}

/** A finished walk as a GPX: its line with the altitude of its profile, and its start (no time per point). */
export function shareWalkGpx(session: CardioSession): Promise<void> {
  const name = session.title ?? session.name;
  const segments = decodeRoute(session.route);
  return shareGpx(
    gpxFileName(name, session.date),
    toGpx({ name, segments, startedAt: session.startedAt, ele: walkElevation(segments, session.samples) }),
  );
}

/** A saved route as a GPX: its line, without altitude (a route keeps only its climb). */
export function shareRouteGpx(route: SavedRoute): Promise<void> {
  return shareGpx(gpxFileName(route.name), toGpx({ name: route.name, segments: route.segments }));
}
