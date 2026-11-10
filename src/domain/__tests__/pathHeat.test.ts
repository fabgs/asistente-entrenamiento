import type { LatLon } from '../gps';
import {
  addHeatWalks,
  alwaysCuts,
  alwaysTone,
  emptyPathHeat,
  heatCellAt,
  heatFrame,
  heatLegend,
  heatLineLength,
  heatLines,
  heatReading,
  hasRecentHeat,
  mostWalked,
  recencyWeight,
  recentTone,
  type HeatWalk,
  type PathHeat,
} from '../pathHeat';
import { at, LOOP, OUT_AND_BACK, reversed, walkAlong, type Corner } from './routeFixtures';

const TODAY = '2026-11-10';
const NB = ' ';

/** `days` before TODAY, as a local date. */
function daysAgo(days: number): string {
  const d = new Date(2026, 10, 10 - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let nextId = 1;
/** A walk along `corners` `days` ago. Without drift unless asked: the tests place lines to the metre. */
function walk(corners: Corner[], days = 0, { drift = 0, seed = 1, segments }: { drift?: number; seed?: number; segments?: LatLon[][] } = {}): HeatWalk {
  const id = nextId++;
  return {
    id,
    date: daysAgo(days),
    startedAt: Date.UTC(2026, 10, 10 - days, 8) + id,
    segments: segments ?? [walkAlong(corners, { drift, seed, step: 4 })],
  };
}

/** The map of some walks, added the latest first as the screen does. */
function heatOf(walks: HeatWalk[], today = TODAY): PathHeat {
  const heat = emptyPathHeat(today);
  addHeatWalks(heat, [...walks].sort((a, b) => b.startedAt - a.startedAt));
  return heat;
}

const STREET: Corner[] = [
  [0, 0],
  [600, 0],
];
const street = (y: number): Corner[] => [
  [0, y],
  [600, y],
];
const cellAt = (heat: PathHeat, x: number, y: number) => heatCellAt(heat, at(x, y));

describe('counting walks along a path', () => {
  it('adds up two passes of the same street 8 m apart, all along it', () => {
    for (const y of [0, 9, 17, 24]) {
      const heat = heatOf([walk(street(y)), walk(street(y + 8), 1)]);
      for (let x = 20; x < 580; x += 7) {
        expect(cellAt(heat, x, y)?.n).toBe(2);
        expect(cellAt(heat, x, y + 8)?.n).toBe(2);
      }
    }
  });

  it('never mixes two parallel streets 40 m apart', () => {
    for (const y of [0, 9, 17, 24]) {
      const heat = heatOf([walk(street(y)), walk(street(y)), walk(street(y + 40), 1)]);
      for (let x = 20; x < 580; x += 7) {
        expect(cellAt(heat, x, y)?.n).toBe(2);
        expect(cellAt(heat, x, y + 40)?.n).toBe(1);
      }
    }
  });

  it('counts one walk for there and back along a street, two laps or a wait at a light', () => {
    const heat = heatOf([walk(OUT_AND_BACK)]);
    expect(mostWalked(heat)).toBe(1);
    const laps = heatOf([walk([...LOOP, ...LOOP.slice(1)])]);
    expect(mostWalked(laps)).toBe(1);
    const waiting: Corner[] = [[0, 0], [300, 0], [304, 3], [298, -2], [303, 2], [299, 0], [600, 0]];
    expect(mostWalked(heatOf([walk(waiting)]))).toBe(1);
  });

  it('counts the same walked the other way round, and two walks on one day as two', () => {
    const heat = heatOf([walk(LOOP), walk(reversed(LOOP)), walk(LOOP, 0, { seed: 3 })]);
    expect(mostWalked(heat)).toBe(3);
    expect(cellAt(heat, 200, 0)).toMatchObject({ n: 3, recent: 3, heat: 3, last: TODAY });
  });

  it('does not join the two sides of a pause or of a gap of more than 60 m in the fixes', () => {
    const paused = heatOf([walk([], 0, { segments: [walkAlong([[0, 0], [200, 0]], { drift: 0 }), walkAlong([[400, 0], [600, 0]], { drift: 0 })] })]);
    expect(cellAt(paused, 100, 0)?.n).toBe(1);
    expect(cellAt(paused, 300, 0)).toBeNull();
    const gap = [...walkAlong([[0, 0], [200, 0]], { drift: 0 }), ...walkAlong([[400, 0], [600, 0]], { drift: 0 })];
    const jumped = heatOf([walk([], 0, { segments: [gap] })]);
    expect(cellAt(jumped, 300, 0)).toBeNull();
    for (const line of heatLines(jumped, 'always')) {
      for (const [i, p] of line.points.entries()) {
        if (i > 0) expect(Math.abs(p.lon - line.points[i - 1].lon) * 83_000).toBeLessThan(250);
      }
    }
    expect(heatLineLength(heatLines(jumped, 'always'))).toBeCloseTo(400, -1.5);
  });

  it('leaves out a recording of less than 100 m', () => {
    const heat = heatOf([walk([[0, 0], [60, 0]])]);
    expect(heat.walks).toBe(0);
    expect(heat.cells.size).toBe(0);
    expect(heatLines(heat, 'always')).toEqual([]);
    expect(heatFrame(heat)).toBeNull();
  });
});

describe('the last 30 days', () => {
  it('weighs a walk 1 today, half two weeks ago and nothing from 30 days', () => {
    expect(recencyWeight(TODAY, TODAY)).toBe(1);
    expect(recencyWeight(daysAgo(15), TODAY)).toBe(0.5);
    expect(recencyWeight(daysAgo(29), TODAY)).toBeCloseTo(1 / 30);
    expect(recencyWeight(daysAgo(30), TODAY)).toBe(0);
    expect(recencyWeight(daysAgo(200), TODAY)).toBe(0);
    expect(recencyWeight('2026-11-12', TODAY)).toBe(1);
  });

  /** The level of a street walked on the days ago given. */
  const levelOf = (days: number[]) => recentTone(cellAt(heatOf(days.map((d) => walk(STREET, d))), 300, 0)!.heat);
  const every = (step: number, from = 0, to = 60) => Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step);

  it('keeps each habit at one level: once a week 2, two to four times 3, five or more 4', () => {
    for (const offset of [0, 3, 6]) expect(levelOf(every(7, offset)).level).toBe(2);
    for (const offset of [0, 1]) expect(levelOf(every(2, offset)).level).toBe(3);
    expect(levelOf(every(3.5).map(Math.round)).level).toBe(3);
    expect(levelOf(every(1)).level).toBe(4);
    // Five days a week (weekends off), whatever day it is today.
    for (const offset of [0, 1, 2, 3, 4, 5, 6]) {
      expect(levelOf(every(1).filter((d) => (d + offset) % 7 < 5)).level).toBe(4);
    }
  });

  it('reaches the top on the 13th day in a row, and cools down when the walks stop', () => {
    expect(levelOf(every(1, 0, 12)).level).toBe(3);
    expect(levelOf(every(1, 0, 13)).level).toBe(4);
    const stopped = (days: number) => levelOf(every(1, days, days + 60)).level;
    expect([0, 6, 7, 16, 17, 21, 22, 29, 30].map(stopped)).toEqual([4, 4, 3, 3, 2, 2, 1, 1, 0]);
  });

  it('fades a lone walk out to grey in steps, and the grey net stays', () => {
    expect(levelOf([0])).toEqual({ level: 1, fade: 1 });
    expect(levelOf([3])).toEqual({ level: 1, fade: 0.9 });
    expect(levelOf([15])).toEqual({ level: 1, fade: 0.5 });
    expect(levelOf([29])).toEqual({ level: 1, fade: 0.1 });
    expect(levelOf([30])).toEqual({ level: 0, fade: 1 });
    const old = heatOf([walk(LOOP, 45), walk(LOOP, 90)]);
    expect(hasRecentHeat(old)).toBe(false);
    const lines = heatLines(old, 'recent');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.level === 0)).toBe(true);
    expect(hasRecentHeat(heatOf([walk(LOOP, 45), walk(STREET, 29)]))).toBe(true);
  });
});

describe('always', () => {
  it('sets its levels by the most walked path, so the scale is never used up', () => {
    expect(alwaysCuts(1)).toEqual([2, 3, 4]);
    expect(alwaysCuts(7)).toEqual([2, 3, 5]);
    expect(alwaysCuts(40)).toEqual([4, 8, 24]);
    expect(alwaysCuts(300)).toEqual([30, 60, 180]);
    expect(alwaysCuts(1000)).toEqual([100, 200, 600]);
    const cuts = alwaysCuts(40);
    expect([1, 3, 4, 7, 8, 23, 24, 40].map((n) => alwaysTone(n, cuts).level)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('has no grey level and counts walks of any age', () => {
    const heat = heatOf([walk(LOOP, 400), walk(LOOP, 200), walk(STREET, 100)]);
    const lines = heatLines(heat, 'always');
    expect(lines.every((l) => l.level >= 1)).toBe(true);
    expect(cellAt(heat, 200, 300)?.n).toBe(2);
    // The bottom street of the block is also the street: three walks.
    expect(cellAt(heat, 200, 0)).toMatchObject({ n: 3, recent: 0 });
  });
});

describe('the lines of the map', () => {
  it('draws one line per path, however many walks go along it', () => {
    const once = heatLineLength(heatLines(heatOf([walk(LOOP, 0, { drift: 8, seed: 1 })]), 'always'));
    expect(once).toBeGreaterThan(1300);
    expect(once).toBeLessThan(1500);
    const many = heatOf(Array.from({ length: 12 }, (_, i) => walk(i % 2 ? reversed(LOOP) : LOOP, i, { drift: 8, seed: i + 2 })));
    expect(mostWalked(many)).toBe(12);
    const length = heatLineLength(heatLines(many, 'always'));
    expect(length).toBeGreaterThan(1300);
    expect(length).toBeLessThan(1.25 * once);
  });

  it('draws the way back of a street only once', () => {
    const length = heatLineLength(heatLines(heatOf([walk(OUT_AND_BACK)]), 'always'));
    expect(length).toBeGreaterThan(690);
    expect(length).toBeLessThan(800);
  });

  it('cuts a line where its level changes, and the pieces touch', () => {
    // A street walked every day, and once a longer way that leaves it at 600 m.
    const far: Corner[] = [[0, 0], [600, 0], [600, 400]];
    const heat = heatOf([walk(far), ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((d) => walk(STREET, d))]);
    const lines = heatLines(heat, 'recent');
    const levels = [...new Set(lines.map((l) => l.level))].sort();
    expect(levels).toEqual([1, 4]);
    const hot = lines.filter((l) => l.level === 4);
    const cool = lines.filter((l) => l.level === 1);
    expect(heatLineLength(hot)).toBeGreaterThan(560);
    expect(heatLineLength(hot)).toBeLessThan(660);
    expect(heatLineLength(cool)).toBeGreaterThan(360);
    // The end of one is the start of the other.
    const ends = hot.flatMap((l) => [l.points[0], l.points.at(-1)!]);
    expect(cool.some((l) => ends.some((e) => e.lat === l.points[0].lat && e.lon === l.points[0].lon))).toBe(true);
    // In «Siempre», 14 walks against 1: the same cut.
    expect([...new Set(heatLines(heat, 'always').map((l) => l.level))].sort()).toEqual([1, 4]);
  });

  it('thins the lines: a straight street is two points', () => {
    const [line, ...rest] = heatLines(heatOf([walk(STREET)]), 'always');
    expect(rest).toEqual([]);
    expect(line.points).toHaveLength(2);
    expect(heatLineLength([line])).toBeCloseTo(600, -1);
  });

  it('opens on what was walked near the latest walk, not on a trip far away', () => {
    const trip: Corner[] = [[40_000, 0], [40_600, 0]];
    const heat = heatOf([walk(LOOP), walk(trip, 5)]);
    const frame = heatFrame(heat)!;
    expect(frame.max.lon - frame.min.lon).toBeLessThan(0.01);
    expect(frame.min.lat).toBeCloseTo(at(0, 0).lat, 4);
    expect(frame.max.lat).toBeCloseTo(at(0, 300).lat, 4);
    // The trip is still on the map.
    expect(cellAt(heat, 40_300, 0)?.n).toBe(1);
  });

  it('draws the net of streets of a year of walks, not a line for each', () => {
    const ways = [LOOP, reversed(LOOP), OUT_AND_BACK, [...LOOP, ...OUT_AND_BACK.slice(1)]];
    // About 1000 points each, as a walk of an hour is stored. (Plain Node does a thousand of them
    // in a quarter of a second; under Jest's Babel it is thirty times slower.)
    const walks = Array.from({ length: 300 }, (_, i) =>
      walk([...ways[i % 4], ...ways[(i + 1) % 4].slice(1), ...ways[(i + 2) % 4].slice(1)], i, { drift: 8, seed: i + 1 }),
    );
    const heat = heatOf(walks);
    expect(mostWalked(heat)).toBe(300);
    for (const mode of ['recent', 'always'] as const) {
      const lines = heatLines(heat, mode);
      // The block and the 300 m of street that stick out of it.
      expect(heatLineLength(lines)).toBeGreaterThan(1650);
      expect(heatLineLength(lines)).toBeLessThan(2100);
      expect(lines.reduce((n, l) => n + l.points.length, 0)).toBeLessThan(200);
    }
  });
});

describe('what the map says', () => {
  const heat = heatOf([walk(LOOP), walk(LOOP, 1), walk(LOOP, 12), walk(STREET, 38), walk([[0, 300], [-400, 300]], 400)]);

  it('reads a tapped path with its real number of walks', () => {
    const shared = cellAt(heat, 200, 0)!;
    expect(heatReading(shared, 'recent', TODAY)).toBe(`3 caminatas en 30${NB}días · la última hoy`);
    expect(heatReading(shared, 'always', TODAY)).toBe('4 caminatas · la última hoy');
    const old = cellAt(heat, 550, 0)!;
    expect(heatReading(old, 'recent', TODAY)).toBe(`Ninguna en 30${NB}días · la última el 3${NB}oct`);
    expect(heatReading(old, 'always', TODAY)).toBe(`1 caminata · el 3${NB}oct`);
    expect(heatReading(cellAt(heat, -200, 300)!, 'always', TODAY)).toBe(`1 caminata · el 6${NB}oct 2025`);
    const one = cellAt(heatOf([walk(STREET, 1)]), 300, 0)!;
    expect(heatReading(one, 'recent', TODAY)).toBe(`1 caminata en 30${NB}días · ayer`);
    expect(heatReading(one, 'always', TODAY)).toBe('1 caminata · ayer');
  });

  it('finds the path next to a tap, and nothing far from any', () => {
    expect(cellAt(heat, 200, 8)?.n).toBe(4);
    expect(cellAt(heat, 200, 150)).toBeNull();
    expect(heatCellAt(emptyPathHeat(TODAY), at(0, 0))).toBeNull();
  });

  it('writes the two ends of the legend', () => {
    expect(heatLegend(heat, 'recent')).toEqual({ low: 'Una vez', high: 'Casi a diario' });
    expect(heatLegend(heat, 'always')).toEqual({ low: '1 caminata', high: '4 o más' });
    const many = heatOf(Array.from({ length: 40 }, (_, i) => walk(STREET, i)));
    expect(heatLegend(many, 'always').high).toBe('24 o más');
  });
});
