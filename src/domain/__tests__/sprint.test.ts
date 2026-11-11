import { parsePlan } from '../cardioPlan';
import { NBSP } from '../format';
import {
  cancelGo,
  closeForFinish,
  bestSprint,
  decodeLapFixes,
  decodeLaps,
  DEFAULT_SPRINT_PLAN,
  describeSprintPlan,
  dropLastClosed,
  dropOpen,
  encodeLapFixes,
  encodeLaps,
  extraSprint,
  formatSprintResult,
  goNow,
  measureSprint,
  parseSprintPlan,
  shiftRest,
  sprintGps,
  sprintLabel,
  sprintState,
  stopLap,
  gpsTopSpeed,
  markedStraight,
  sprintsPlace,
  sprintTraces,
  straightElsewhere,
  straightSpeedMs,
  type Lap,
  type LapRow,
  type SprintFix,
} from '../sprint';
import { distanceM } from '../gps';
import { eastOf, LAT0, LON0, standing, straight, T0 } from './sprintFixtures';
import { PHONE_FUSED, phoneFused } from './sprintPhone';

const M_PER_DEG_LAT = (6_371_008.8 * Math.PI) / 180;

const STOP = T0 + 11_500;
const NOW = T0 + 20_000;
const measure = (fixes: SprintFix[], startAt = T0, stopAt = STOP, now = NOW) => measureSprint(fixes, startAt, stopAt, now);
const withK = (k: number, over: Partial<SprintFix>) => straight().map((f) => (f.t === T0 + 1000 * k ? { ...f, ...over } : f));

describe('measureSprint', () => {
  it('1 · measures the straight sprint', () => {
    const m = measure(straight());
    expect(m.distanceM).toBeCloseTo(72.5, 2);
    expect(m.topSpeedMs).toBe(8);
    expect(m.quality).toBe('good');
    expect(m.settled).toBe(true);
  });

  it('2 · smooths a single Doppler spike', () => {
    const m = measure(withK(5, { speed: 11 }));
    expect(m.distanceM).toBeCloseTo(72.5, 2);
    expect(m.topSpeedMs).toBe(8);
  });

  it('3 · uses the positions when the Doppler is impossible', () => {
    const m = measure(withK(5, { speed: 20 }));
    expect(m.distanceM).toBeCloseTo(72.5, 2);
    expect(m.topSpeedMs).toBeCloseTo(8, 2);
  });

  it('4 · falls back on the positions when Android reports 0 (unknown) while moving', () => {
    const fixes = straight().map((f, i) => (i - 3 >= 1 && i - 3 <= 11 ? { ...f, speed: 0 } : f));
    const m = measure(fixes);
    expect(m.distanceM!).toBeCloseTo(70, 1);
    expect(m.topSpeedMs).toBeCloseTo(8, 2);
    expect(m.quality).toBe('weak');
  });

  it('5 · measures nothing when every fix is too inaccurate', () => {
    expect(measure(straight().map((f) => ({ ...f, accuracy: 25 })))).toMatchObject({ distanceM: null, topSpeedMs: null, quality: 'none' });
  });

  it('6 · marks a sprint with mediocre accuracy as weak', () => {
    const m = measure(straight().map((f) => ({ ...f, accuracy: 12 })));
    expect(m.distanceM).toBeCloseTo(72.5, 2);
    expect(m.quality).toBe('weak');
  });

  it('7 · bridges a 4 s gap but calls it weak', () => {
    const m = measure(straight().filter((f) => ![4, 5, 6].some((k) => f.t === T0 + 1000 * k)));
    expect(m.distanceM).toBeCloseTo(72.5, 2);
    expect(m.quality).toBe('weak');
  });

  it('8 · waits for the fixes after the stop before settling', () => {
    const early = straight().filter((f) => f.t <= T0 + 10_000);
    const m = measure(early, T0, STOP, STOP + 1000);
    expect(m.distanceM).toBeCloseTo(73.25, 2);
    expect(m.settled).toBe(false);
    const later = measure(straight().filter((f) => f.t <= T0 + 13_000), T0, STOP, STOP + 1000);
    expect(later.distanceM).toBeCloseTo(72.5, 2);
    expect(later.settled).toBe(true);
  });

  it('9 · settles after 5 s even without the fixes after the stop, as weak', () => {
    const m = measure(straight().filter((f) => f.t <= T0 + 10_000), T0, STOP, STOP + 6000);
    expect(m.distanceM).toBeCloseTo(73.25, 2);
    expect(m.settled).toBe(true);
    expect(m.quality).toBe('weak');
  });

  it('10 · reads a curve that takes off late that much later, up to 1,5 s', () => {
    const late = (ms: number) => straight().map((f) => ({ ...f, t: f.t + ms }));
    expect(measure(late(800)).distanceM).toBeCloseTo(72.5, 2);
    // Later than that it is the athlete who was late, and «Parar» cuts what is left.
    expect(measure(late(3000), T0, STOP, T0 + 30_000).distanceM).toBeCloseTo(69.5, 2);
    // Already moving at the beep (a rolling start): nothing is shifted.
    const rolling = straight().map((f) => ({ ...f, speed: Math.max(f.speed!, 2) }));
    expect(measure(rolling, T0 + 2000, STOP).topSpeedMs).toBe(8);
  });

  it('11 · interpolates the speed at a start between two fixes', () => {
    expect(measure(straight(), T0 + 400).distanceM).toBeCloseTo(72.18, 2);
  });

  it('12 · stops counting at «Parar» while still running', () => {
    const m = measure(straight(), T0, T0 + 6500);
    expect(m.distanceM).toBeCloseTo(43, 2);
    expect(m.topSpeedMs).toBe(8);
  });

  it('13 · does not add the steps after braking when «Parar» comes late', () => {
    expect(measure(straight(), T0, T0 + 14_000).distanceM).toBeCloseTo(72.5, 2);
  });

  it('14 · sorts the fixes and drops repeated times', () => {
    const fixes = straight();
    const shuffled = [...fixes.slice(9), fixes[8], ...fixes.slice(0, 8), fixes[8]];
    expect(measure(shuffled).distanceM).toBeCloseTo(72.5, 2);
  });

  it('15 · needs two fixes inside the sprint', () => {
    expect(measure(straight(), T0 + 2000, T0 + 3500).quality).toBe('none');
  });

  it('16 · standing still is no sprint', () => {
    const m = measure(standing(20), T0, T0 + 15_000, T0 + 30_000);
    expect(m.distanceM).toBe(0);
    expect(m.topSpeedMs).toBeNull();
  });

  it('17 · drops a fix 40 m away from both neighbours', () => {
    const fixes = straight().map((f) => (f.t === T0 + 6000 ? eastOf(f, 40) : f));
    expect(measure(fixes).distanceM).toBeCloseTo(72.5, 2);
  });

  it('18 · keeps the top of a short sprint, whose peak is a single fix', () => {
    const speeds = [0, 0, 0, 0, 3.5, 5.6, 6.6, 7.4, 3, 0.5, 0, 0];
    let north = 0;
    const fixes = speeds.map((speed, i) => {
      north += i === 0 ? 0 : (speeds[i - 1] + speed) / 2;
      return { ...straight()[0], t: T0 + 1000 * (i - 3), lat: LAT0 + north / M_PER_DEG_LAT, speed };
    });
    const m = measure(fixes, T0, T0 + 6500);
    expect(m.topSpeedMs).toBe(7.4);
    expect(m.distanceM).toBeCloseTo(26.35, 2);
    expect(m.quality).toBe('good');
  });

  it('19 · measures with the fixes of the chip and leaves the fused ones out', () => {
    // The fused location of a phone: the same times, half the speed and positions that barely move.
    const fused = straight().map((f) => ({ ...f, gnss: false, speed: f.speed! / 2, lat: LAT0 + (f.lat - LAT0) / 2 }));
    const both = measure([...fused, ...straight().map((f) => ({ ...f, t: f.t + 1 }))]);
    expect(both.distanceM).toBeCloseTo(72.5, 1);
    expect(both.quality).toBe('good');
    // Only the fused ones (no native module, or the listener died): measured, never called good.
    const alone = measure(fused);
    expect(alone.distanceM).toBeCloseTo(36.25, 1);
    expect(alone.quality).toBe('weak');
    // A chip that gave two fixes in the whole sprint does not cover it.
    const sparse = straight().filter((f) => f.t <= T0 || f.t >= STOP || f.t === T0 + 4000 || f.t === T0 + 8000);
    expect(measure([...fused, ...sparse]).distanceM).toBeCloseTo(36.25, 1);
  });

  it('20 · calls it weak when the positions tell another distance than the speeds', () => {
    const slow = straight().map((f) => ({ ...f, speed: f.speed! * 0.6 }));
    const m = measure(slow);
    expect(m.distanceM).toBeCloseTo(43.5, 1);
    expect(m.quality).toBe('weak');
  });

  it('21 · the fused location of a real phone on a 30–40 m straight: nothing to trust', () => {
    const measured = PHONE_FUSED.map((lap, i) => measureSprint(phoneFused(i), T0, T0 + lap.timeMs, T0 + 60_000));
    expect(measured.map((m) => m.quality)).toEqual(['weak', 'weak', 'weak', 'weak', 'weak', 'weak']);
    // The same straight six times, and no two alike: from 3 to 33 m.
    const metres = measured.map((m) => Math.round(m.distanceM!));
    expect(Math.max(...metres) - Math.min(...metres)).toBeGreaterThan(15);
  });
});

const T = 1_000_000;
const plan = DEFAULT_SPRINT_PLAN;
const closed = (startAt: number, stopAt: number): Lap => ({ startAt, stopAt, distanceM: null, topSpeedMs: null, quality: null });
const pending = (startAt: number): Lap => ({ startAt, stopAt: null, distanceM: null, topSpeedMs: null, quality: null });

describe('sprint state and transitions', () => {
  it('starts ready, waits 5 s and runs from the beep', () => {
    expect(sprintState(plan, [], T)).toEqual({ kind: 'ready', number: 1 });
    const laps = goNow(plan, [], T)!;
    expect(laps).toEqual([pending(T + 5000)]);
    expect(sprintState(plan, laps, T + 3000)).toEqual({ kind: 'waiting', number: 1, goAt: T + 5000, restFrom: null });
    expect(sprintState(plan, laps, T + 6000)).toEqual({ kind: 'running', number: 1, startAt: T + 5000, forgotten: false });
  });

  it('ignores a stop right after the beep, voids a false start and closes a sprint', () => {
    const laps = goNow(plan, [], T)!;
    expect(stopLap(plan, laps, T + 5400)).toEqual({ kind: 'ignored' });
    const falseStart = stopLap(plan, laps, T + 7000);
    expect(falseStart.kind).toBe('false-start');
    if (falseStart.kind === 'false-start') expect(sprintState(plan, falseStart.laps, T + 7000)).toEqual({ kind: 'ready', number: 1 });
    const stopped = stopLap(plan, laps, T + 17_000);
    expect(stopped).toMatchObject({ kind: 'stopped', number: 1, timeMs: 12_000, last: false });
    if (stopped.kind !== 'stopped') throw new Error('not stopped');
    expect(stopped.laps.at(-1)).toEqual(pending(T + 107_000));
    expect(sprintState(plan, stopped.laps, T + 20_000)).toEqual({ kind: 'waiting', number: 2, goAt: T + 107_000, restFrom: T + 17_000 });
  });

  const resting = [closed(T + 5000, T + 17_000), pending(T + 107_000)];

  it('shifts the rest by 30 s, never into the last 5 s', () => {
    expect(shiftRest(plan, resting, 30, T + 20_000)!.at(-1)!.startAt).toBe(T + 137_000);
    expect(shiftRest(plan, resting, -30, T + 100_000)!.at(-1)!.startAt).toBe(T + 105_000);
    expect(shiftRest(plan, resting, -30, T + 103_000)).toBeNull();
  });

  it('skips the rest to a start in 5 s and cancels a pending start', () => {
    expect(goNow(plan, resting, T + 20_000)!.at(-1)!.startAt).toBe(T + 25_000);
    expect(goNow(plan, resting, T + 103_000)).toBeNull();
    expect(sprintState(plan, cancelGo(plan, resting, T + 20_000)!, T + 20_000)).toEqual({ kind: 'ready', number: 2 });
  });

  it('ends after the planned sprints and allows extra ones', () => {
    const five = Array.from({ length: 5 }, (_, i) => closed(T + i * 200_000, T + i * 200_000 + 10_000));
    const sixth = [...five, pending(T + 1_000_000)];
    const done = stopLap(plan, sixth, T + 1_012_000);
    expect(done).toMatchObject({ kind: 'stopped', number: 6, last: true });
    if (done.kind !== 'stopped') throw new Error('not stopped');
    expect(done.laps.at(-1)!.stopAt).toBe(T + 1_012_000);
    expect(sprintState(plan, done.laps, T + 1_013_000)).toEqual({ kind: 'done', count: 6 });
    expect(extraSprint(plan, done.laps, T + 1_022_000)!.at(-1)).toEqual(pending(T + 1_102_000));
    const extra = extraSprint(plan, done.laps, T + 1_212_000)!;
    expect(extra.at(-1)).toEqual(pending(T + 1_217_000));
    const seventh = stopLap(plan, extra, T + 1_230_000);
    expect(seventh).toMatchObject({ kind: 'stopped', number: 7, last: true });
    if (seventh.kind === 'stopped') expect(sprintState(plan, seventh.laps, T + 1_231_000)).toEqual({ kind: 'done', count: 7 });
  });

  it('drops the last finished sprint, and the pending start with the last one', () => {
    const two = [closed(T, T + 10_000), closed(T + 100_000, T + 110_000), pending(T + 200_000)];
    const one = dropLastClosed(plan, two, T + 120_000)!;
    expect(one).toEqual([closed(T, T + 10_000), pending(T + 200_000)]);
    expect(sprintState(plan, one, T + 120_000)).toMatchObject({ kind: 'waiting', number: 2 });
    expect(dropLastClosed(plan, one, T + 120_000)).toEqual([]);
  });

  it('flags a forgotten sprint and lets it go', () => {
    const running = [pending(T)];
    expect(sprintState(plan, running, T + 61_000)).toMatchObject({ kind: 'running', forgotten: true });
    expect(sprintState(plan, dropOpen(plan, running, T + 61_000)!, T + 61_000)).toEqual({ kind: 'ready', number: 1 });
  });

  it('after the app was killed, the sprint runs from its beep and nothing is invented', () => {
    const laps = [closed(T, T + 10_000), closed(T + 100_000, T + 110_000), pending(T + 300_000)];
    expect(sprintState(plan, laps, T + 900_000)).toEqual({ kind: 'running', number: 3, startAt: T + 300_000, forgotten: true });
  });

  it('closes a long enough sprint on finishing and drops a short or pending one', () => {
    expect(closeForFinish([pending(T)], T + 10_000)).toEqual([closed(T, T + 10_000)]);
    expect(closeForFinish([pending(T)], T + 2000)).toEqual([]);
    expect(closeForFinish([closed(T, T + 10_000), pending(T + 100_000)], T + 20_000)).toEqual([closed(T, T + 10_000)]);
  });
});

describe('the count before the beep (1.5.0)', () => {
  const slow = { ...plan, leadSec: 15 };
  const resting = [closed(T + 15_000, T + 27_000), pending(T + 117_000)];

  it('is how long «Empezar sprint» waits for the beep', () => {
    expect(goNow(slow, [], T)).toEqual([pending(T + 15_000)]);
    expect(sprintState(slow, goNow(slow, [], T)!, T + 14_000).kind).toBe('waiting');
  });

  it('is where skipping the rest leaves the start, only when that is sooner', () => {
    expect(goNow(slow, resting, T + 30_000)!.at(-1)!.startAt).toBe(T + 45_000);
    // 12 s left of the rest: a count of 15 would make it later.
    expect(goNow(slow, resting, T + 105_000)).toBeNull();
    expect(goNow(plan, resting, T + 105_000)!.at(-1)!.startAt).toBe(T + 110_000);
  });

  it('is the least a rest can be shortened to, and no shift inside it', () => {
    expect(shiftRest(slow, resting, -30, T + 90_000)!.at(-1)!.startAt).toBe(T + 105_000);
    expect(shiftRest(slow, resting, -30, T + 103_000)).toBeNull();
    expect(shiftRest(slow, resting, 30, T + 103_000)).toBeNull();
    expect(shiftRest(slow, resting, 30, T + 90_000)!.at(-1)!.startAt).toBe(T + 147_000);
  });

  it('is what one more sprint waits when the rest is already over', () => {
    const done = [closed(T, T + 10_000)];
    const one = { ...slow, sprints: 1 };
    expect(extraSprint(one, done, T + 20_000)!.at(-1)).toEqual(pending(T + 100_000));
    expect(extraSprint(one, done, T + 300_000)!.at(-1)).toEqual(pending(T + 315_000));
  });
});

describe('stopping with a button (1.5.0)', () => {
  const running = [pending(T)];

  it('ignores a press before 3 s instead of voiding the start', () => {
    expect(stopLap(plan, running, T + 400, { button: true })).toEqual({ kind: 'ignored' });
    expect(stopLap(plan, running, T + 2000, { button: true })).toEqual({ kind: 'ignored' });
    // The same moment on the screen is a false start.
    expect(stopLap(plan, running, T + 2000).kind).toBe('false-start');
    expect(stopLap(plan, running, T + 3000, { button: true })).toMatchObject({ kind: 'stopped', timeMs: 3000 });
  });

  it('stops at the press, however late it is read, and the rest runs from the press', () => {
    const stopped = stopLap(plan, running, T + 12_000, { button: true, now: T + 20_000 });
    expect(stopped).toMatchObject({ kind: 'stopped', number: 1, timeMs: 12_000 });
    if (stopped.kind !== 'stopped') throw new Error('not stopped');
    expect(stopped.laps).toEqual([closed(T, T + 12_000), pending(T + 102_000)]);
  });

  it('leaves no start pending when it is read once the rest would be over or inside its count', () => {
    const late = stopLap(plan, running, T + 12_000, { button: true, now: T + 200_000 });
    if (late.kind !== 'stopped') throw new Error('not stopped');
    expect(late.laps).toEqual([closed(T, T + 12_000)]);
    expect(sprintState(plan, late.laps, T + 200_000)).toEqual({ kind: 'ready', number: 2 });
    // 3 s before the rest ends, with a count of 5: too late for that beep.
    const inside = stopLap(plan, running, T + 12_000, { button: true, now: T + 99_000 });
    if (inside.kind !== 'stopped') throw new Error('not stopped');
    expect(inside.laps).toHaveLength(1);
    // Read just in time for the count.
    const inTime = stopLap(plan, running, T + 12_000, { button: true, now: T + 97_000 });
    if (inTime.kind !== 'stopped') throw new Error('not stopped');
    expect(inTime.laps.at(-1)).toEqual(pending(T + 102_000));
  });

  it('does nothing when no sprint was running at the press: the screen got there first', () => {
    const resting = [closed(T, T + 12_000), pending(T + 102_000)];
    expect(stopLap(plan, resting, T + 12_500, { button: true, now: T + 13_000 })).toEqual({ kind: 'ignored' });
    expect(stopLap(plan, [], T, { button: true })).toEqual({ kind: 'ignored' });
  });
});

describe('the straight and the time are what count (1.5.2)', () => {
  const row = (number: number, timeMs: number, over: Partial<LapRow> = {}): LapRow => ({
    number,
    timeMs,
    distanceM: 17,
    topSpeedMs: 5.5,
    quality: 'weak',
    settled: true,
    ...over,
  });
  // The session of the user on 2026-11-11: the same straight six times.
  const rows = [row(1, 8700), row(2, 8100), row(3, 8200), row(4, 7600), row(5, 7200), row(6, 7000)];

  it('gives the speed of a sprint over the straight: its metres by its time', () => {
    expect(straightSpeedMs(36, 7000) * 3.6).toBeCloseTo(18.51, 2);
    expect(straightSpeedMs(60, 12_000)).toBe(5);
  });

  it('says the best time and, with a straight, the speed it means', () => {
    expect(bestSprint(rows, 36)).toEqual({ number: 6, timeMs: 7000, speedMs: 36 / 7 });
    expect(bestSprint(rows, null)).toEqual({ number: 6, timeMs: 7000, speedMs: null });
    expect(bestSprint([], 36)).toBeNull();
  });

  it('keeps the top speed of the GPS apart, and out when it is below the speed over the straight', () => {
    // 5,5 m/s (19,8 km/h) is above the 18,5 km/h of the best sprint over 36 m: said, as rough.
    expect(gpsTopSpeed(rows, 36)).toEqual({ speedMs: 5.5, weak: true });
    // Over a straight of 50 m the best sprint averaged 25,7 km/h: a top of 19,8 is plainly wrong.
    expect(gpsTopSpeed(rows, 50)).toBeNull();
    expect(gpsTopSpeed(rows, null)).toEqual({ speedMs: 5.5, weak: true });
    expect(gpsTopSpeed([row(1, 7000, { topSpeedMs: 8, quality: 'good' })], 36)).toEqual({ speedMs: 8, weak: false });
    expect(gpsTopSpeed([row(1, 7000, { topSpeedMs: null, quality: 'none' })], 36)).toBeNull();
  });

  it('says in Hoy how many, over how many metres and the best time, never what the GPS measured', () => {
    const laps: Lap[] = [
      { ...closed(0, 8700), distanceM: 17, topSpeedMs: 2.03, quality: 'weak' },
      { ...closed(100_000, 107_000), distanceM: 19, topSpeedMs: 4.13, quality: 'weak' },
    ];
    expect(formatSprintResult(laps, 36)).toBe(`2 × 36${NBSP}m · mejor 7,0${NBSP}s`);
    expect(formatSprintResult(laps)).toBe(`2 sprints · mejor 7,0${NBSP}s`);
    expect(formatSprintResult([], 36)).toBe(`0 × 36${NBSP}m`);
  });

  it('marks a straight on the map: its two ends and the whole metres between them', () => {
    const start = { lat: LAT0, lon: LON0 };
    const end = { lat: LAT0 + 36.4 / M_PER_DEG_LAT, lon: LON0 };
    const marked = markedStraight(start, end)!;
    expect(marked.straightM).toBe(36);
    expect(distanceM(marked.straightEnds!.start, start)).toBeLessThan(0.1);
    expect(distanceM(marked.straightEnds!.end, end)).toBeLessThan(0.1);
    // Shorter or longer than a straight can be: nothing to save.
    expect(markedStraight(start, { lat: LAT0 + 6 / M_PER_DEG_LAT, lon: LON0 })).toBeNull();
    expect(markedStraight(start, { lat: LAT0 + 450 / M_PER_DEG_LAT, lon: LON0 })).toBeNull();
  });

  it('keeps the ends in the plan, only with their metres', () => {
    const marked = markedStraight({ lat: LAT0, lon: LON0 }, { lat: LAT0 + 36 / M_PER_DEG_LAT, lon: LON0 })!;
    const stored = JSON.stringify({ ...plan, ...marked });
    expect(parseSprintPlan(stored)).toEqual({ ...plan, ...marked });
    // A plan from before the 1.5.2, a written straight, ends without metres and ends that are not places.
    expect(parseSprintPlan('{"kind":"sprint","sprints":6,"restSec":90,"straightM":60}')!.straightEnds).toBeNull();
    expect(parseSprintPlan(JSON.stringify({ ...plan, straightEnds: marked.straightEnds }))!.straightEnds).toBeNull();
    expect(parseSprintPlan(JSON.stringify({ ...plan, straightM: 36, straightEnds: { start: { lat: 95, lon: 0 }, end: marked.straightEnds!.end } }))!.straightEnds).toBeNull();
    expect(parseSprintPlan(JSON.stringify({ ...plan, straightM: 36, straightEnds: [1, 2] }))!.straightEnds).toBeNull();
  });

  it('knows when the athlete is nowhere near the straight marked', () => {
    const { straightEnds } = markedStraight({ lat: LAT0, lon: LON0 }, { lat: LAT0 + 36 / M_PER_DEG_LAT, lon: LON0 })!;
    const at = (metres: number, accuracy: number | null = 4) => ({ lat: LAT0 + metres / M_PER_DEG_LAT, lon: LON0, accuracy });
    expect(straightElsewhere(straightEnds, at(20))).toBe(false);
    expect(straightElsewhere(straightEnds, at(180))).toBe(false);
    expect(straightElsewhere(straightEnds, at(190))).toBe(true);
    // A poor fix, none, or no ends: nothing to say.
    expect(straightElsewhere(straightEnds, at(500, 40))).toBe(false);
    expect(straightElsewhere(straightEnds, at(500, null))).toBe(false);
    expect(straightElsewhere(straightEnds, null)).toBe(false);
    expect(straightElsewhere(null, at(500))).toBe(false);
  });

  it('draws the path of each sprint only with fixes of the chip, from the beep to the stop', () => {
    const laps = [closed(T0, STOP), closed(T0 + 100_000, T0 + 108_000)];
    const second = straight().map((f) => ({ ...f, t: f.t + 100_000, gnss: false }));
    const traces = sprintTraces(laps, [straight(), second]);
    // The first sprint: its 12 fixes between the beep and the stop. The second only has fused fixes: no path.
    expect(traces).toHaveLength(1);
    expect(traces[0]).toHaveLength(12);
    expect(traces[0][0]).toEqual({ lat: LAT0, lon: LON0 });
    expect(sprintTraces(laps, [])).toEqual([]);
    // Where they were run, to open a map there: the middle of every usable fix, whatever its source.
    const place = sprintsPlace([straight(), second])!;
    expect(distanceM(place, { lat: LAT0, lon: LON0 })).toBeLessThan(80);
    expect(sprintsPlace([straight().map((f) => ({ ...f, accuracy: 40 }))])).toBeNull();
    expect(sprintsPlace([])).toBeNull();
  });
});

describe('laps and plans as JSON', () => {
  it('decodes laps defensively', () => {
    expect(decodeLaps(null)).toEqual([]);
    expect(decodeLaps('{')).toEqual([]);
    expect(decodeLaps('[[2,null],[1,null]]')).toEqual([pending(2)]);
    const laps: Lap[] = [{ startAt: 1, stopAt: 12_001, distanceM: 72.46, topSpeedMs: 8.123, quality: 'weak' }, pending(100_000)];
    expect(decodeLaps(encodeLaps(laps))).toEqual([{ ...laps[0], distanceM: 72.5, topSpeedMs: 8.12 }, laps[1]]);
  });

  it('parses sprint plans into range', () => {
    expect(parseSprintPlan(JSON.stringify(plan))).toEqual(plan);
    expect(parseSprintPlan('{"kind":"hiit","sprints":6,"restSec":90}')).toBeNull();
    expect(parseSprintPlan('{"kind":"sprint","sprints":6}')).toBeNull();
    expect(parseSprintPlan('{"kind":"sprint","sprints":0,"restSec":5}')).toEqual({ kind: 'sprint', sprints: 1, restSec: 30, leadSec: 5, straightM: null, straightEnds: null });
    // A plan stored before the 1.5.0 has neither the count nor the straight.
    expect(parseSprintPlan('{"kind":"sprint","sprints":6,"restSec":90}')).toEqual(plan);
    expect(parseSprintPlan('{"kind":"sprint","sprints":6,"restSec":90,"leadSec":15,"straightM":60}')).toMatchObject({ leadSec: 15, straightM: 60 });
    expect(parseSprintPlan('{"kind":"sprint","sprints":6,"restSec":90,"leadSec":2,"straightM":5}')).toMatchObject({ leadSec: 5, straightM: 10 });
    expect(parseSprintPlan('{"kind":"sprint","sprints":6,"restSec":90,"leadSec":90,"straightM":1000}')).toMatchObject({ leadSec: 30, straightM: 400 });
    expect(parseSprintPlan('{"kind":"sprint","sprints":6,"restSec":90,"leadSec":"x","straightM":0}')).toMatchObject({ leadSec: 5, straightM: null });
    expect(parseSprintPlan('{"kind":"sprint","sprints":6,"restSec":900}')!.restSec).toBe(600);
    expect(parsePlan(JSON.stringify(plan))).toBeNull();
  });

  it('describes plans, labels and results', () => {
    expect(describeSprintPlan(plan)).toBe('6 sprints · descanso 1:30');
    expect(describeSprintPlan({ ...plan, sprints: 1, restSec: 120 })).toBe('1 sprint · descanso 2:00');
    expect(describeSprintPlan({ ...plan, straightM: 60 })).toBe(`6 sprints · descanso 1:30 · recta 60${NBSP}m`);
    expect(sprintLabel(4, plan)).toBe('Sprint 4 de 6');
    expect(sprintLabel(7, plan)).toBe('Sprint 7');
    const fast: Lap[] = [
      { ...closed(0, 12_000), topSpeedMs: 8, quality: 'good' },
      { ...closed(100_000, 111_800), topSpeedMs: 7.5, quality: 'good' },
    ];
    // Since the 1.5.2 the time, however well the GPS measured.
    expect(formatSprintResult(fast)).toBe(`2 sprints · mejor 11,8${NBSP}s`);
    expect(formatSprintResult([closed(0, 12_000), closed(100_000, 111_800)])).toBe(`2 sprints · mejor 11,8${NBSP}s`);
    expect(formatSprintResult([{ ...closed(0, 12_000), topSpeedMs: 25 / 3.6, quality: 'good' }])).toBe(`1 sprint · mejor 12,0${NBSP}s`);
  });

  it('keeps the fixes of each sprint within 0,2 m', () => {
    const laps = [closed(T0, STOP)];
    const fixes = straight().map((f) => ({ ...f, receivedAt: f.t + 350 }));
    const [back] = decodeLapFixes(encodeLapFixes(laps, fixes), laps);
    // From 3 s before the beep to 8 s after the stop: the curve of a phone runs late.
    const kept = fixes.filter((f) => f.t >= T0 - 3000 && f.t <= STOP + 8000);
    expect(back).toHaveLength(kept.length);
    back.forEach((f, i) => {
      expect(f.t).toBe(kept[i].t);
      expect(distanceM(f, kept[i])).toBeLessThanOrEqual(0.2);
      expect(f.speed).toBe(kept[i].speed);
      expect(f.receivedAt).toBe(kept[i].receivedAt);
      expect(f.gnss).toBe(true);
    });
    expect(decodeLapFixes(null, laps)).toEqual([[]]);
    // The chip's fixes say so, with how far it trusts the speed; the fused ones are stored as before the 1.5.2.
    const chip = { ...fixes[5], speedAccuracy: 0.42 };
    const fused = { ...fixes[6], gnss: false };
    const stored = JSON.parse(encodeLapFixes(laps, [chip, fused])) as number[][][];
    expect(stored[0][0]).toHaveLength(8);
    expect(stored[0][0].slice(6)).toEqual([1, 42]);
    expect(stored[0][1]).toHaveLength(6);
    const [[chipBack, fusedBack]] = decodeLapFixes(JSON.stringify(stored), laps);
    expect(chipBack).toMatchObject({ gnss: true, speedAccuracy: 0.42 });
    expect(fusedBack.gnss).toBeUndefined();
  });
});

describe('sprintGps', () => {
  const fix = (accuracy: number | null, age = 0) => ({ t: T - age, accuracy, receivedAt: T - age });
  it('says what the GPS can measure', () => {
    expect(sprintGps(fix(4), false, T).state).toBe('off');
    expect(sprintGps(null, true, T).state).toBe('searching');
    expect(sprintGps(fix(4, 4000), true, T).state).toBe('good');
    expect(sprintGps(fix(4, 4001), true, T).state).toBe('searching');
    expect(sprintGps(fix(8), true, T)).toEqual({ state: 'good', accuracyM: 8 });
    expect(sprintGps(fix(8.4), true, T).state).toBe('weak');
    expect(sprintGps(fix(20), true, T).state).toBe('weak');
    expect(sprintGps(fix(20.4), true, T).state).toBe('unusable');
    expect(sprintGps(fix(null), true, T).state).toBe('unusable');
  });
});
