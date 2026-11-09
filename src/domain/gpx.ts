import { distanceM, type LatLon } from './gps';

/**
 * GPX without dependencies (React Native has no DOMParser): enough of the format to read the track
 * or route of a file from Wikiloc and the like, and to write a walk for them (PLAN.md §13, fase 26).
 */

export interface GpxPoint extends LatLon {
  /** Metres; null when the file does not say. */
  ele: number | null;
}

export interface GpxTrack {
  /** The name of the track (or route, or the file), if any. */
  name: string | null;
  /** One per `trkseg` (or `rte`), with points closer than MIN_STEP_M to the previous one left out. */
  segments: GpxPoint[][];
}

/** Thrown with a message for the user. */
export class GpxError extends Error {}

/** Points closer than this to the kept one before add nothing to a route and only make it heavier. */
export const MIN_STEP_M = 5;
/** Larger files are not routes for walking (a 30 km track with a point a second is ~5 MB). */
export const MAX_GPX_BYTES = 20_000_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Text content: without CDATA, with its entities decoded and its spaces collapsed. */
function text(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const plain = cdata ? cdata[1] : raw.replace(/<[^>]*>/g, '');
  return plain
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first `<name>` inside `xml`, if any. */
function nameIn(xml: string): string | null {
  const match = xml.match(/<(?:\w+:)?name\b[^>]*>([\s\S]*?)<\/(?:\w+:)?name>/i);
  const name = match ? text(match[1]) : '';
  return name || null;
}

const attribute = (tag: string, name: string): number | null => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*(-?[0-9.]+(?:e-?\\d+)?)\\s*["']`, 'i'));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

/** The points of `<trkpt>` or `<rtept>` elements in `xml`, in order. */
function pointsIn(xml: string, tag: 'trkpt' | 'rtept'): GpxPoint[] {
  const points: GpxPoint[] = [];
  const pattern = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>)`, 'gi');
  for (const match of xml.matchAll(pattern)) {
    const lat = attribute(match[1], 'lat');
    const lon = attribute(match[1], 'lon');
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const eleMatch = match[3]?.match(/<(?:\w+:)?ele\b[^>]*>([\s\S]*?)<\/(?:\w+:)?ele>/i);
    const ele = eleMatch ? Number(text(eleMatch[1])) : NaN;
    points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  return points;
}

/** Leaves out points closer than MIN_STEP_M to the last one kept (the last point always stays). */
function thin(points: GpxPoint[]): GpxPoint[] {
  const kept: GpxPoint[] = [];
  for (const [i, p] of points.entries()) {
    const last = kept.at(-1);
    if (!last || distanceM(last, p) >= MIN_STEP_M || (i === points.length - 1 && distanceM(last, p) > 0)) kept.push(p);
  }
  return kept;
}

/** Elements `tag` of `xml` (their inner text). */
const blocks = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'gi'))].map((m) => m[1]);

/**
 * Reads the tracks of a GPX (one segment per `trkseg`) or, without any, its routes (one per `rte`);
 * waypoints are left out. Throws GpxError when it is not a GPX or has no way to follow.
 */
export function parseGpx(xml: string): GpxTrack {
  if (xml.length > MAX_GPX_BYTES) throw new GpxError('El fichero es demasiado grande para ser una ruta.');
  if (!/<(?:\w+:)?gpx\b/i.test(xml)) throw new GpxError('No es un fichero GPX.');
  // Half a download would be half a route, without saying so.
  if (!/<\/(?:\w+:)?gpx\s*>/i.test(xml)) throw new GpxError('El fichero GPX está incompleto.');
  const tracks = blocks(xml, 'trk');
  let segments: GpxPoint[][];
  let name: string | null;
  if (tracks.some((t) => /<(?:\w+:)?trkpt\b/i.test(t))) {
    segments = tracks.flatMap((t) => {
      const parts = blocks(t, 'trkseg');
      return (parts.length > 0 ? parts : [t]).map((s) => pointsIn(s, 'trkpt'));
    });
    name = nameIn(tracks[0].replace(/<(?:\w+:)?trkseg\b[\s\S]*$/i, ''));
  } else {
    const routes = blocks(xml, 'rte');
    segments = routes.map((r) => pointsIn(r, 'rtept'));
    name = routes.length > 0 ? nameIn(routes[0].replace(/<(?:\w+:)?rtept\b[\s\S]*$/i, '')) : null;
  }
  const kept = segments.map(thin).filter((s) => s.length >= 2);
  if (kept.length === 0) throw new GpxError('El GPX no tiene ninguna ruta: le faltan los puntos del recorrido.');
  return { name: name ?? nameIn(xml.replace(/<(?:\w+:)?(?:trk|rte|wpt)\b[\s\S]*$/i, '')), segments: kept };
}

/** More points than this is not a route for walking. */
export const MAX_ROUTE_POINTS = 20_000;
/** Shorter than this is not a route either (a stray track, a test). */
export const MIN_ROUTE_M = 100;

const lengthM = (segments: LatLon[][]) =>
  segments.reduce((sum, s) => sum + s.slice(1).reduce((d, p, i) => d + distanceM(s[i], p), 0), 0);

/** The checks of a GPX before saving it as a route; throws GpxError with the reason. */
export function checkGpxRoute(track: GpxTrack): void {
  if (track.segments.reduce((n, s) => n + s.length, 0) > MAX_ROUTE_POINTS) {
    throw new GpxError('El GPX tiene demasiados puntos para una ruta.');
  }
  if (lengthM(track.segments) < MIN_ROUTE_M) throw new GpxError('La ruta del GPX mide menos de 100 m.');
}

/** «Ver hormigas 2026-11-09.gpx» for a walk (with its date), «Ver hormigas.gpx» for a route. */
export function gpxFileName(name: string, date?: string): string {
  const safe = name.replace(/[/\\:*?"<>|]/g, '-').trim() || 'Ruta';
  return `${date ? `${safe} ${date}` : safe}.gpx`;
}

/**
 * The altitude of each point of a walk, from its profile (`[s, d, a]` every 10 s): by the metres
 * walked to the point, which are counted like the profile, without joining the segments.
 */
export function walkElevation(segments: LatLon[][], samples: { d: number; a: number | null }[]): (segment: number, index: number) => number | null {
  const known = samples.filter((x): x is { d: number; a: number } => x.a !== null);
  const walked = segments.map(() => [] as number[]);
  let d = 0;
  for (const [k, segment] of segments.entries()) {
    for (const [i, p] of segment.entries()) {
      if (i > 0) d += distanceM(segment[i - 1], p);
      walked[k].push(d);
    }
  }
  return (segment, index) => {
    if (known.length === 0) return null;
    const at = walked[segment]?.[index];
    if (at === undefined) return null;
    const next = known.findIndex((x) => x.d >= at);
    if (next === -1) return known.at(-1)!.a;
    if (next === 0) return known[0].a;
    const [a, b] = [known[next - 1], known[next]];
    return b.d > a.d ? a.a + ((at - a.d) / (b.d - a.d)) * (b.a - a.a) : b.a;
  };
}

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

const coordinate = (n: number) => n.toFixed(6);

/**
 * A GPX 1.1 of a walk or a route: one `trkseg` per segment, with the altitude when it is known
 * (`ele`, by point) and the start in its metadata. Points carry no time: the stored route does not
 * keep when each one was walked.
 */
export function toGpx({
  name,
  segments,
  startedAt,
  ele,
}: {
  name: string;
  segments: LatLon[][];
  startedAt?: number | null;
  ele?: (segment: number, index: number) => number | null;
}): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Entreno" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${escapeXml(name)}</name>`,
    ...(startedAt ? [`    <time>${new Date(startedAt).toISOString()}</time>`] : []),
    '  </metadata>',
    '  <trk>',
    `    <name>${escapeXml(name)}</name>`,
  ];
  for (const [s, segment] of segments.entries()) {
    if (segment.length === 0) continue;
    lines.push('    <trkseg>');
    for (const [i, p] of segment.entries()) {
      const altitude = ele?.(s, i) ?? null;
      lines.push(
        altitude === null
          ? `      <trkpt lat="${coordinate(p.lat)}" lon="${coordinate(p.lon)}"/>`
          : `      <trkpt lat="${coordinate(p.lat)}" lon="${coordinate(p.lon)}"><ele>${altitude.toFixed(1)}</ele></trkpt>`,
      );
    }
    lines.push('    </trkseg>');
  }
  lines.push('  </trk>', '</gpx>', '');
  return lines.join('\n');
}
