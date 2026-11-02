import type { LatLon } from './gps';

export const TILE_SIZE = 256;
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
  x: number;
  y: number;
  /** Position on screen. */
  left: number;
  top: number;
}

/** Tiles covering the view. */
export function tilesFor(view: MapView, width: number, height: number): Tile[] {
  const tiles: Tile[] = [];
  const count = 2 ** view.zoom;
  const firstX = Math.floor(view.originX / TILE_SIZE);
  const firstY = Math.floor(view.originY / TILE_SIZE);
  for (let ty = firstY; ty * TILE_SIZE < view.originY + height; ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = firstX; tx * TILE_SIZE < view.originX + width; tx++) {
      tiles.push({
        x: ((tx % count) + count) % count,
        y: ty,
        left: tx * TILE_SIZE - view.originX,
        top: ty * TILE_SIZE - view.originY,
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
