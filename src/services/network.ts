import { osmTileUrl, TILE_USER_AGENT } from '@/domain/mapView';

/** Whether map tiles can be loaded right now: a quick request for the smallest tile, 4 s at most. */
export async function canLoadMapTiles(timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(osmTileUrl(0, 0, 0), {
      method: 'HEAD',
      headers: { 'User-Agent': TILE_USER_AGENT },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
