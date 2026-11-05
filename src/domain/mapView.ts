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
  /** dp per world pixel of `zoom`: 1, or more in an exact fit (between two zoom levels). */
  scale: number;
}

function bounds(points: LatLon[], zoom: number) {
  const px = points.map((p) => project(p, zoom));
  const xs = px.map((p) => p.x);
  const ys = px.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Highest zoom that shows every point inside `width` × `height` with `padding` around, centred. */
export function fitView(points: LatLon[], width: number, height: number, padding = 24): MapView {
  for (let zoom = MAX_ZOOM; zoom >= 1; zoom--) {
    const { minX, maxX, minY, maxY } = bounds(points, zoom);
    if (zoom === 1 || (maxX - minX <= width - 2 * padding && maxY - minY <= height - 2 * padding)) {
      return { zoom, originX: (minX + maxX) / 2 - width / 2, originY: (minY + maxY) / 2 - height / 2, scale: 1 };
    }
  }
  throw new Error('unreachable');
}

/**
 * Like fitView, but scaled between zoom levels so the route fills the space exactly, as the route
 * without map does (`outline`): the share image draws it the same size in every look. A very short
 * route stops at twice the deepest zoom.
 */
export function fitViewExact(points: LatLon[], width: number, height: number, padding = 24): MapView {
  const { zoom } = fitView(points, width, height, padding);
  const { minX, maxX, minY, maxY } = bounds(points, zoom);
  const ratio = (room: number, span: number) => (span > 0 ? room / span : Infinity);
  const fill = Math.min(ratio(width - 2 * padding, maxX - minX), ratio(height - 2 * padding, maxY - minY));
  // Below the deepest zoom, fill < 2: one more level would have fitted.
  const scale = Math.max(1, Math.min(fill, zoom === MAX_ZOOM ? 2 : Infinity));
  return {
    zoom,
    originX: (minX + maxX) / 2 - width / 2 / scale,
    originY: (minY + maxY) / 2 - height / 2 / scale,
    scale,
  };
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
 * names stay sharp (k = 1 in the app; round(log2(PixelRatio)) in the share image). A view scaled
 * between zoom levels takes them one level further in once it is more than √2 larger.
 */
export function tilesFor(view: MapView, width: number, height: number, detail = 0): Tile[] {
  const { scale } = view;
  const k = Math.max(0, Math.min(Math.round(detail + Math.log2(scale)), MAX_TILE_ZOOM - view.zoom));
  const zoom = view.zoom + k;
  // Side of a tile in world pixels of view.zoom.
  const side = TILE_SIZE / 2 ** k;
  const tiles: Tile[] = [];
  const count = 2 ** zoom;
  const firstX = Math.floor(view.originX / side);
  const firstY = Math.floor(view.originY / side);
  for (let ty = firstY; ty * side < view.originY + height / scale; ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = firstX; tx * side < view.originX + width / scale; tx++) {
      tiles.push({
        zoom,
        x: ((tx % count) + count) % count,
        y: ty,
        left: (tx * side - view.originX) * scale,
        top: (ty * side - view.originY) * scale,
        size: side * scale,
      });
    }
  }
  return tiles;
}

/** Where a point of the map lands on screen. */
export function toScreen(view: MapView, p: LatLon): { x: number; y: number } {
  const { x, y } = project(p, view.zoom);
  return { x: (x - view.originX) * view.scale, y: (y - view.originY) * view.scale };
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
