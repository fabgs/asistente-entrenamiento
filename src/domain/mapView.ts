import type { LatLon } from './gps';

export const TILE_SIZE = 256;

// OpenStreetMap's own tiles: no API key. Their usage policy asks for attribution and a User-Agent
// that identifies the app; a personal app's few requests are well within it.
export const osmTileUrl = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
export const TILE_USER_AGENT = 'Entreno/1.3 (personal training app)';
const MAX_ZOOM = 17;

/** Web Mercator pixel position at `zoom` (what map tiles use). */
export function project(p: LatLon, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((p.lat * Math.PI) / 180);
  return {
    x: ((p.lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export interface MapView {
  zoom: number;
  /** World pixel shown at the top-left corner. */
  originX: number;
  originY: number;
}

/** Highest zoom that shows every point inside `width` × `height` with `padding` around, centred. */
export function fitView(points: LatLon[], width: number, height: number, padding = 24): MapView {
  for (let zoom = MAX_ZOOM; zoom >= 1; zoom--) {
    const px = points.map((p) => project(p, zoom));
    const xs = px.map((p) => p.x);
    const ys = px.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (zoom === 1 || (maxX - minX <= width - 2 * padding && maxY - minY <= height - 2 * padding)) {
      return { zoom, originX: (minX + maxX) / 2 - width / 2, originY: (minY + maxY) / 2 - height / 2 };
    }
  }
  throw new Error('unreachable');
}

export interface Tile {
  zoom: number;
  x: number;
  y: number;
  /** Position on screen. */
  left: number;
  top: number;
  /** Side on screen, in dp. */
  size: number;
}

/** OpenStreetMap serves tiles up to this zoom. */
const MAX_TILE_ZOOM = 19;

/**
 * Tiles covering the view. With `detail` k they come from k zoom levels further in and are drawn at
 * 256/2^k dp, so on a dense screen every pixel of a tile is about a pixel of the screen and street
 * names stay sharp (k = 1 in the app; round(log2(PixelRatio)) in the share image).
 */
export function tilesFor(view: MapView, width: number, height: number, detail = 0): Tile[] {
  const k = Math.max(0, Math.min(detail, MAX_TILE_ZOOM - view.zoom));
  const zoom = view.zoom + k;
  const size = TILE_SIZE / 2 ** k;
  const tiles: Tile[] = [];
  const count = 2 ** zoom;
  const firstX = Math.floor(view.originX / size);
  const firstY = Math.floor(view.originY / size);
  for (let ty = firstY; ty * size < view.originY + height; ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = firstX; tx * size < view.originX + width; tx++) {
      tiles.push({
        zoom,
        x: ((tx % count) + count) % count,
        y: ty,
        left: tx * size - view.originX,
        top: ty * size - view.originY,
        size,
      });
    }
  }
  return tiles;
}

/** Route segments scaled to fill `width` × `height` (keeping its shape), for thumbnails. */
export function outline(segments: LatLon[][], width: number, height: number, padding = 6): { x: number; y: number }[][] {
  const projected = segments.map((s) => s.map((p) => project(p, 20)));
  const all = projected.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((width - 2 * padding) / (maxX - minX || 1), (height - 2 * padding) / (maxY - minY || 1));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  return projected.map((s) => s.map((p) => ({ x: offsetX + (p.x - minX) * scale, y: offsetY + (p.y - minY) * scale })));
}
