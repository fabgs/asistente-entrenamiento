import { distanceAlong, distanceM, positionAtDistance, type TrackSample } from '../gps';
import { distanceTicks, isZoomed, nearestIndex, panRange, percentileRange, trackSeries, zoomRange } from '../trackChart';

const DEG_PER_M = 1 / 111_195;
const north = (fromM: number, toM: number, step = 100) => {
  const points = [];
  for (let m = fromM; m <= toM; m += step) points.push({ lat: 40 + m * DEG_PER_M, lon: -3 });
  return points;
};

/** A sample every 10 s walking at `speed` m/s, standing still between `stopFrom` and `stopTo`. */
function samples(seconds: number, speed = 1.5, stopFrom = Infinity, stopTo = Infinity): TrackSample[] {
  const list: TrackSample[] = [];
  let d = 0;
  for (let s = 0; s <= seconds; s += 10) {
    list.push({ s, d: Math.round(d), a: 100 + s / 10 });
    if (s < stopFrom || s >= stopTo) d += speed * 10;
  }
  return list;
}

describe('positionAtDistance', () => {
  it('interpolates along the route', () => {
    const p = positionAtDistance([north(0, 1000)], 250)!;
    expect(distanceM({ lat: 40, lon: -3 }, p)).toBeCloseTo(250, 0);
  });

  it('never joins two segments: a distance past the first one continues in the second', () => {
    const route = [north(0, 500), north(800, 1300)];
    // 500 m of the first segment + 100 m into the second one, which starts at 800 m north.
    expect(distanceM({ lat: 40, lon: -3 }, positionAtDistance(route, 600)!)).toBeCloseTo(900, 0);
  });

  it('finds how far along the route a tapped point is', () => {
    const route = [north(0, 500), north(800, 1300)];
    // Next to the start of the second segment: 500 m of the first one.
    expect(distanceAlong(route, { lat: 40 + 810 * DEG_PER_M, lon: -3.0001 })).toBeCloseTo(500, 0);
    expect(distanceAlong(route, { lat: 40 + 1290 * DEG_PER_M, lon: -3 })).toBeCloseTo(1000, 0);
    expect(distanceAlong([], { lat: 40, lon: -3 })).toBeNull();
  });

  it('stops at the end and handles empty routes', () => {
    expect(positionAtDistance([north(0, 300)], 5000)).toEqual(north(0, 300).at(-1));
    expect(positionAtDistance([], 10)).toBeNull();
  });
});

describe('trackSeries', () => {
  it('gives speed in km/h and pace in minutes per km', () => {
    const speed = trackSeries(samples(600), 'speed');
    expect(speed.at(-1)!.value).toBeCloseTo(5.4, 1);
    const pace = trackSeries(samples(600), 'pace');
    expect(pace.at(-1)!.value).toBeCloseTo(1000 / 1.5 / 60, 1); // 11:07 /km
    expect(pace.at(-1)!.d).toBe(900);
  });

  it('leaves the pace empty while stopped', () => {
    const pace = trackSeries(samples(900, 1.5, 300, 500), 'pace');
    expect(pace.find((p) => p.s === 480)!.value).toBeNull();
    expect(pace.find((p) => p.s === 900)!.value).not.toBeNull();
  });

  it('charts the smoothed altitude with its time and distance', () => {
    const alt = trackSeries(samples(100), 'altitude');
    expect(alt).toHaveLength(11);
    expect(alt[5]).toMatchObject({ s: 50, d: 75 });
    expect(alt[5].value).toBeCloseTo(105, 5);
  });
});

describe('zoom', () => {
  const full = { min: 0, max: 5000 };

  it('zooms in around the anchor, which keeps its place on screen', () => {
    const view = zoomRange(full, full, 2, 1000, 200);
    expect(view.max - view.min).toBe(2500);
    expect((1000 - view.min) / (view.max - view.min)).toBeCloseTo(1000 / 5000, 5);
    expect(isZoomed(view, full)).toBe(true);
  });

  it('never goes past the full range nor below the minimum span', () => {
    expect(zoomRange({ min: 0, max: 1000 }, full, 0.1, 500, 200)).toEqual(full);
    const tight = zoomRange({ min: 4000, max: 5000 }, full, 100, 4900, 200);
    expect(tight.max - tight.min).toBe(200);
    expect(tight.max).toBeLessThanOrEqual(5000);
    expect(isZoomed(full, full)).toBe(false);
  });

  it('pans inside the full range', () => {
    expect(panRange({ min: 1000, max: 2000 }, full, 500)).toEqual({ min: 1500, max: 2500 });
    expect(panRange({ min: 1000, max: 2000 }, full, -5000)).toEqual({ min: 0, max: 1000 });
    expect(panRange({ min: 1000, max: 2000 }, full, 9000)).toEqual({ min: 4000, max: 5000 });
  });

  it('finds the nearest point', () => {
    const xs = [0, 10, 20, 40];
    expect(nearestIndex(xs, 14, (x) => x)).toBe(1);
    expect(nearestIndex(xs, 31, (x) => x)).toBe(3);
    expect(nearestIndex(xs, -5, (x) => x)).toBe(0);
    expect(nearestIndex(xs, 99, (x) => x)).toBe(3);
  });
});

describe('axes', () => {
  it('cuts GPS spikes at the edge of the y axis', () => {
    // The real walk: ≈ 5 km/h with a 10 km/h spike.
    const speeds = [...Array.from({ length: 98 }, (_, i) => 4.6 + (i % 7) * 0.1), 9.8, 10.1];
    const range = percentileRange(speeds);
    expect(range.max).toBeLessThan(6);
    expect(range.min).toBeGreaterThan(4.4);
    // The line at ≈ 5 km/h fills most of the height.
    expect((5.2 - 4.6) / (range.max - range.min)).toBeGreaterThan(0.6);
  });

  it('keeps every value when there are few', () => {
    expect(percentileRange([3, 9, 5])).toEqual({ min: 3, max: 9 });
    expect(percentileRange([])).toEqual({ min: 0, max: 1 });
  });

  it('marks every km, closer when zoomed in, with the unit only on the last one', () => {
    expect(distanceTicks({ min: 0, max: 5142 }, 'km').map((t) => t.label)).toEqual(['0', '1', '2', '3', '4', '5 km']);
    expect(distanceTicks({ min: 1000, max: 2000 }, 'km').map((t) => t.d)).toEqual([1000, 1200, 1400, 1600, 1800, 2000]);
    expect(distanceTicks({ min: 1000, max: 2000 }, 'km').at(-1)?.label).toBe('2 km');
    expect(distanceTicks({ min: 0, max: 1300 }, 'm').map((t) => t.label)).toEqual(['0', '500', '1000 m']);
  });
});
