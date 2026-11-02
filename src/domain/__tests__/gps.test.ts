import {
  activeMs,
  altitudeProfile,
  buildSamples,
  decodeSamples,
  elevationChange,
  encodeSamples,
  kmSplits,
  speedSeries,
  splitSegments,
  decodePolyline,
  decodeRoute,
  distanceM,
  encodePolyline,
  encodeRoute,
  filterTrack,
  paceMinPerKm,
  summarizeTrack,
  type TrackPoint,
} from '../gps';

// One metre north is ~0.000009 degrees of latitude.
const DEG_PER_M = 1 / 111_195;
const START = { lat: 40.4168, lon: -3.7038 };

/** Walking north at `speed` m/s, one fix every `every` seconds. */
function walk(seconds: number, { speed = 1.4, every = 3, t0 = 0, segment = 0, fromM = 0, accuracy = 5 } = {}) {
  const points: TrackPoint[] = [];
  for (let s = 0; s <= seconds; s += every) {
    points.push({
      t: t0 + s * 1000,
      lat: START.lat + (fromM + s * speed) * DEG_PER_M,
      lon: START.lon,
      accuracy,
      segment,
    });
  }
  return points;
}

describe('gps', () => {
  it('measures great-circle distance', () => {
    expect(distanceM(START, { lat: START.lat + 1000 * DEG_PER_M, lon: START.lon })).toBeCloseTo(1000, 0);
    // Madrid → Barcelona, ~505 km.
    expect(distanceM(START, { lat: 41.3874, lon: 2.1686 }) / 1000).toBeCloseTo(505, -1);
  });

  it('adds up a straight walk', () => {
    const track = walk(600); // 10 min at 1.4 m/s = 840 m
    const summary = summarizeTrack(track, 600_000);
    expect(summary.distanceM).toBeCloseTo(840, -1);
    expect(summary.currentSpeedMs).toBeCloseTo(1.4, 1);
  });

  it('counts slow walking even when each fix moves less than the minimum step', () => {
    const track = walk(300, { speed: 0.8, every: 2 }); // 1.6 m per fix
    expect(summarizeTrack(track, 300_000).distanceM).toBeGreaterThan(230);
  });

  it('ignores jitter while standing still', () => {
    const still: TrackPoint[] = Array.from({ length: 100 }, (_, i) => ({
      t: i * 3000,
      lat: START.lat + ((i % 3) - 1) * 3 * DEG_PER_M,
      lon: START.lon + ((i % 2) - 0.5) * 3 * DEG_PER_M,
      accuracy: 8,
      segment: 0,
    }));
    expect(summarizeTrack(still, 300_000).distanceM).toBe(0);
    expect(summarizeTrack(still, 300_000).currentSpeedMs).toBe(0);
  });

  it('drops inaccurate fixes and impossible jumps', () => {
    const track = walk(60);
    const jump = { ...track[10], lat: track[10].lat + 500 * DEG_PER_M };
    const blurry = { ...track[12], lon: track[12].lon + 80 * DEG_PER_M, accuracy: 60 };
    const noisy = [...track.slice(0, 10), jump, ...track.slice(10, 12), blurry, ...track.slice(12)];
    expect(filterTrack(noisy)).not.toContainEqual(jump);
    expect(filterTrack(noisy)).not.toContainEqual(blurry);
    expect(summarizeTrack(noisy, 60_000).distanceM).toBeCloseTo(84, -1);
  });

  it('never joins segments across a pause', () => {
    const first = walk(300); // 420 m
    // Walked 1 km with the recording paused, then resumed.
    const second = walk(300, { t0: 900_000, segment: 1, fromM: 420 + 1000 });
    const summary = summarizeTrack([...first, ...second], 1_200_000);
    expect(summary.segments).toHaveLength(2);
    expect(summary.distanceM).toBeCloseTo(840, -1);
  });

  it('reports no current speed when the last fix is old', () => {
    expect(summarizeTrack(walk(60), 60_000 + 120_000).currentSpeedMs).toBe(0);
  });

  it('subtracts pauses from the active time', () => {
    const base = { startedAt: 0, finishedAt: null, pausedAt: null, pausedMs: 0 };
    expect(activeMs(base, 600_000)).toBe(600_000);
    expect(activeMs({ ...base, pausedMs: 60_000 }, 600_000)).toBe(540_000);
    expect(activeMs({ ...base, pausedAt: 500_000 }, 600_000)).toBe(500_000);
    expect(activeMs({ ...base, finishedAt: 400_000, pausedMs: 100_000 }, 900_000)).toBe(300_000);
  });

  it('formats pace in min/km', () => {
    expect(paceMinPerKm(1000 / 600)).toBe('10:00');
    expect(paceMinPerKm(1.4)).toBe('11:54');
    expect(paceMinPerKm(0.1)).toBeNull();
  });

  it('encodes polylines like Google does', () => {
    const points = [
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ];
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(points);
  });

  it('round-trips a route with several segments', () => {
    const segments = [walk(30).map(({ lat, lon }) => ({ lat, lon })), walk(30, { fromM: 900 })];
    const decoded = decodeRoute(encodeRoute(segments));
    expect(decoded).toHaveLength(2);
    expect(decoded[1]).toHaveLength(segments[1].length);
    expect(decoded[1][3].lat).toBeCloseTo(segments[1][3].lat, 5);
    expect(decodeRoute(null)).toEqual([]);
  });
  it('samples the track every 10 s of active time, leaving pauses out', () => {
    const first = walk(300); // 420 m in 5 min
    const second = walk(300, { t0: 900_000, segment: 1, fromM: 2000 }); // after a 10 min pause
    const samples = buildSamples(splitSegments([...first, ...second]), -30_000);
    expect(samples[0]).toMatchObject({ s: 30, d: 0 }); // 30 s waiting for the first fix
    expect(samples.at(-1)).toMatchObject({ s: 630, d: 840 });
    for (let i = 1; i < samples.length - 1; i++) expect(samples[i].s - samples[i - 1].s).toBeGreaterThanOrEqual(10);
    expect(samples.length).toBeLessThan(70);
  });

  it('gives a smoothed speed over time', () => {
    const samples = buildSamples([walk(600)], 0);
    const series = speedSeries(samples);
    expect(series).toHaveLength(samples.length - 1);
    for (const point of series) expect(point.speed).toBeCloseTo(1.4, 1);
  });

  it('measures climb and descent without GPS noise', () => {
    const samples = Array.from({ length: 60 }, (_, i) => ({
      s: i * 10,
      d: i * 14,
      // Up 30 m, down 20 m, with ±2 m of noise.
      a: (i < 30 ? 600 + i : 630 - (i - 30) * (20 / 29)) + (i % 2 ? 2 : -2),
    }));
    const { gain, loss } = elevationChange(altitudeProfile(samples));
    expect(gain).toBeGreaterThan(25);
    expect(gain).toBeLessThan(32);
    expect(loss).toBeGreaterThan(15);
    expect(loss).toBeLessThan(22);
    expect(elevationChange([{ a: 600 }, { a: 602 }, { a: 599 }, { a: 601 }]).gain).toBe(0);
  });

  it('times every kilometre and the last partial one', () => {
    // 1000 m in 600 s, then 1000 m in 500 s, then 300 m in 180 s.
    const samples = [
      { s: 0, d: 0, a: null },
      { s: 600, d: 1000, a: null },
      { s: 1100, d: 2000, a: null },
      { s: 1280, d: 2300, a: null },
    ];
    expect(kmSplits(samples)).toEqual([
      { distanceM: 1000, seconds: 600 },
      { distanceM: 1000, seconds: 500 },
      { distanceM: 300, seconds: 180 },
    ]);
    const split = kmSplits([
      { s: 0, d: 0, a: null },
      { s: 100, d: 800, a: null },
      { s: 200, d: 1600, a: null },
    ]);
    expect(split[0].seconds).toBeCloseTo(125);
    expect(split[1]).toEqual({ distanceM: 600, seconds: 75 });
  });

  it('stores samples compactly', () => {
    const samples = [
      { s: 0, d: 0, a: 655.2 },
      { s: 10, d: 14, a: null },
    ];
    expect(encodeSamples(samples)).toBe('[[0,0,655.2],[10,14,null]]');
    expect(decodeSamples(encodeSamples(samples))).toEqual(samples);
    expect(decodeSamples(null)).toEqual([]);
  });
});
