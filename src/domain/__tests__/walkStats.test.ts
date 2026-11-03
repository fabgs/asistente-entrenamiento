import { encodeRoute } from '../gps';
import {
  finishedMetric,
  formatDistance,
  gridMetrics,
  isWalkMetric,
  spokenMetric,
  walkMetric,
  walkSnapshot,
  type WalkMetric,
  type WalkNumbers,
} from '../walkStats';

// The walk of the screenshots that asked for this: 5,14 km in 59:12.
const WALK: WalkNumbers = { distanceM: 5142, activeMs: (59 * 60 + 12) * 1000, currentSpeedMs: 1.5, climbM: 55.4 };

describe('walk metrics', () => {
  it('shows the distance in km or in metres', () => {
    expect(formatDistance(5142, 'km')).toEqual({ value: '5,14', unit: 'km' });
    expect(formatDistance(5100, 'km')).toEqual({ value: '5,10', unit: 'km' });
    expect(formatDistance(5142.4, 'm')).toEqual({ value: '5142', unit: 'm' });
    expect(formatDistance(12345, 'm').value).toBe('12 345');
  });

  it('formats each figure with its unit apart', () => {
    expect(walkMetric('time', WALK, 'km')).toEqual({ label: 'Tiempo', value: '59:12', unit: '' });
    expect(walkMetric('avgPace', WALK, 'km')).toEqual({ label: 'Ritmo medio', value: '11:31', unit: '/km' });
    expect(walkMetric('avgSpeed', WALK, 'km')).toEqual({ label: 'Vel. media', value: '5,2', unit: 'km/h' });
    expect(walkMetric('pace', WALK, 'km').value).toBe('11:07');
    expect(walkMetric('speed', WALK, 'km').value).toBe('5,4');
    expect(walkMetric('climb', WALK, 'km')).toEqual({ label: 'Desnivel +', value: '55', unit: 'm' });
  });

  it('shows a dash when standing still or without altitude', () => {
    const still = { ...WALK, currentSpeedMs: 0, climbM: null };
    expect(walkMetric('pace', still, 'km').value).toBe('–');
    expect(walkMetric('speed', still, 'km').value).toBe('0,0');
    expect(walkMetric('climb', still, 'km').value).toBe('–');
    expect(walkMetric('avgPace', { ...WALK, activeMs: 0 }, 'km').value).toBe('–');
  });

  it('shows a dash for the pace and speed while paused and before 50 m', () => {
    const paused = { ...WALK, currentSpeedMs: undefined };
    expect(walkMetric('pace', paused, 'km').value).toBe('–');
    expect(walkMetric('speed', paused, 'km').value).toBe('–');
    expect(walkMetric('avgPace', paused, 'km').value).toBe('11:31');
    const start = { distanceM: 30, activeMs: 20_000, currentSpeedMs: 1.5, climbM: null };
    for (const m of ['pace', 'speed', 'avgPace', 'avgSpeed'] as const) expect(walkMetric(m, start, 'km').value).toBe('–');
    expect(walkMetric('distance', start, 'm').value).toBe('30');
  });

  it('reads each figure aloud in words', () => {
    expect(spokenMetric(walkMetric('avgPace', WALK, 'km'))).toBe('Ritmo medio, 11 minutos 31 segundos por kilómetro');
    expect(spokenMetric(walkMetric('time', { ...WALK, activeMs: 3_606_000 }, 'km'))).toBe('Tiempo, 1 hora 6 segundos');
    expect(spokenMetric(walkMetric('time', { ...WALK, activeMs: 61_000 }, 'km'))).toBe('Tiempo, 1 minuto 1 segundo');
    expect(spokenMetric(walkMetric('time', { ...WALK, activeMs: 0 }, 'km'))).toBe('Tiempo, 0 segundos');
    expect(spokenMetric(walkMetric('distance', WALK, 'km'))).toBe('Distancia, 5,14 kilómetros');
    expect(spokenMetric(walkMetric('climb', { ...WALK, climbM: null }, 'km'))).toBe('Desnivel +, sin datos');
  });

  it('builds the same figures while recording and once finished', () => {
    const DEG = 1 / 111_195;
    const points = Array.from({ length: 101 }, (_, i) => ({
      t: 1000 + i * 3000,
      lat: 40 + i * 4.5 * DEG,
      lon: -3,
      accuracy: 5,
      altitude: 600 + i / 2,
      segment: 0,
    }));
    const session = { startedAt: 1000, finishedAt: null, pausedAt: null, pausedMs: 0, distanceM: null, route: null, samples: [] };
    const live = walkSnapshot(session, points, 301_000);
    expect(live.numbers.distanceM).toBeCloseTo(450, -1);
    expect(live.numbers.activeMs).toBe(300_000);
    expect(live.numbers.currentSpeedMs).toBeCloseTo(1.5, 1);
    expect(live.numbers.climbM).toBeGreaterThan(40);
    expect(live.samples.at(-1)).toMatchObject({ s: 300, d: 450 });

    const done = walkSnapshot(
      { ...session, finishedAt: 301_000, distanceM: 450, route: encodeRoute(live.segments), samples: live.samples },
      null,
      999_999,
    );
    expect(done.numbers).toMatchObject({ distanceM: 450, activeMs: 300_000, climbM: live.numbers.climbM });
    expect(done.numbers.currentSpeedMs).toBeUndefined();
    expect(done.segments[0]).toHaveLength(live.segments[0].length);
  });

  it('keeps every figure in its own cell, with the distance where the big one was', () => {
    const all: WalkMetric[] = ['distance', 'time', 'pace', 'speed', 'avgPace', 'avgSpeed', 'climb'];
    const live = Object.fromEntries(all.map((m) => [m, gridMetrics(m, 'live')]));
    expect(live.distance).toEqual({ hero: 'distance', cells: ['time', 'pace', 'speed', 'avgPace', 'avgSpeed', 'climb'] });
    expect(live.time.cells).toEqual(['distance', 'pace', 'speed', 'avgPace', 'avgSpeed', 'climb']);
    expect(live.pace.cells).toEqual(['time', 'distance', 'speed', 'avgPace', 'avgSpeed', 'climb']);
    expect(live.speed.cells).toEqual(['time', 'pace', 'distance', 'avgPace', 'avgSpeed', 'climb']);
    expect(live.avgPace.cells).toEqual(['time', 'pace', 'speed', 'distance', 'avgSpeed', 'climb']);
    expect(live.avgSpeed.cells).toEqual(['time', 'pace', 'speed', 'avgPace', 'distance', 'climb']);
    expect(live.climb.cells).toEqual(['time', 'pace', 'speed', 'avgPace', 'avgSpeed', 'distance']);

    const done = Object.fromEntries(all.map((m) => [m, gridMetrics(m, 'finished')]));
    expect(done.distance).toEqual({ hero: 'distance', cells: ['time', 'avgPace', 'avgSpeed', 'climb'] });
    expect(done.time.cells).toEqual(['distance', 'avgPace', 'avgSpeed', 'climb']);
    expect(done.pace).toEqual({ hero: 'avgPace', cells: ['time', 'distance', 'avgSpeed', 'climb'] });
    expect(done.speed).toEqual({ hero: 'avgSpeed', cells: ['time', 'avgPace', 'distance', 'climb'] });
    expect(done.avgPace).toEqual(done.pace);
    expect(done.avgSpeed).toEqual(done.speed);
    expect(done.climb.cells).toEqual(['time', 'avgPace', 'avgSpeed', 'distance']);
    for (const m of all) {
      expect(live[m].cells).toHaveLength(6);
      expect(done[m].cells).toHaveLength(4);
    }
  });

  it('uses the average once the walk is over', () => {
    expect(finishedMetric('pace')).toBe('avgPace');
    expect(finishedMetric('speed')).toBe('avgSpeed');
    expect(finishedMetric('distance')).toBe('distance');
    expect(isWalkMetric('climb')).toBe(true);
    expect(isWalkMetric('calories')).toBe(false);
  });
});
