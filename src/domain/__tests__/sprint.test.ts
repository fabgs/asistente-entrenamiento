import { parsePlan } from '../cardioPlan';
import { NBSP } from '../format';
import {
  cancelGo,
  closeForFinish,
  comparisonCaption,
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
  straightComparison,
  type Lap,
  type SprintFix,
} from '../sprint';
import { distanceM } from '../gps';
import { eastOf, standing, straight, T0 } from './sprintFixtures';

const STOP = T0 + 11_500;
const NOW = T0 + 20_000;
const measure = (fixes: SprintFix[], startAt = T0, stopAt = STOP, now = NOW, lag?: number) =>
  measureSprint(fixes, startAt, stopAt, now, lag);
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

  it('10 · corrects a clock skew with the lag', () => {
    const late = straight().map((f) => ({ ...f, t: f.t + 800 }));
    expect(measure(late).distanceM).toBeCloseTo(72.02, 2);
    expect(measure(late, T0, STOP, NOW, 800).distanceM).toBeCloseTo(72.5, 2);
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

describe('the straight next to the GPS (1.5.0)', () => {
  const row = (distanceM: number | null, quality: 'good' | 'weak' | 'none' | null = 'good') => ({ distanceM, quality });

  it('is nothing without a straight written down', () => {
    expect(straightComparison([row(58), row(59), row(60)], null)).toBeNull();
  });

  it('compares it with the median of the sprints with a good GPS, from three on', () => {
    const five = [row(57.4), row(58.2), row(61), row(55), row(58.4)];
    const comparison = straightComparison(five, 60)!;
    expect(comparison).toEqual({ straightM: 60, gps: { medianM: 58, diffM: -2, count: 5 } });
    expect(comparisonCaption(comparison)).toBe(`2${NBSP}m menos · 5 sprints`);
    // An even number: the middle two.
    const four = straightComparison([row(62), row(63), row(64), row(70)], 60)!;
    expect(four.gps).toEqual({ medianM: 64, diffM: 4, count: 4 });
    expect(comparisonCaption(four)).toBe(`4${NBSP}m más · 4 sprints`);
    expect(comparisonCaption(straightComparison([row(59.6), row(60.2), row(60.4)], 60)!)).toBe('Igual · 3 sprints');
  });

  it('leaves out the sprints the GPS measured badly or not at all, and says so with too few', () => {
    const rows = [row(58), row(59), row(90, 'weak'), row(null, 'none'), row(40, null)];
    const comparison = straightComparison(rows, 60)!;
    expect(comparison).toEqual({ straightM: 60, gps: null });
    expect(comparisonCaption(comparison)).toBe('Pocos sprints con buen GPS para comparar');
    // One odd reading among good ones does not move the median.
    expect(straightComparison([row(58), row(59), row(60), row(120)], 60)!.gps!.medianM).toBe(60);
    expect(straightComparison([], 60)).toEqual({ straightM: 60, gps: null });
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
    expect(parseSprintPlan('{"kind":"sprint","sprints":0,"restSec":5}')).toEqual({ kind: 'sprint', sprints: 1, restSec: 30, leadSec: 5, straightM: null });
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
    expect(formatSprintResult(fast)).toBe(`2 sprints · máx. 28,8${NBSP}km/h`);
    expect(formatSprintResult([closed(0, 12_000), closed(100_000, 111_800)])).toBe(`2 sprints · mejor 11,8${NBSP}s`);
    expect(formatSprintResult([{ ...closed(0, 12_000), topSpeedMs: 25 / 3.6, quality: 'good' }])).toBe(`1 sprint · máx. 25${NBSP}km/h`);
  });

  it('keeps the fixes of each sprint within 0,2 m', () => {
    const laps = [closed(T0, STOP)];
    const fixes = straight().map((f) => ({ ...f, receivedAt: f.t + 350 }));
    const [back] = decodeLapFixes(encodeLapFixes(laps, fixes), laps);
    const kept = fixes.filter((f) => f.t >= T0 - 3000 && f.t <= STOP + 3000);
    expect(back).toHaveLength(kept.length);
    back.forEach((f, i) => {
      expect(f.t).toBe(kept[i].t);
      expect(distanceM(f, kept[i])).toBeLessThanOrEqual(0.2);
      expect(f.speed).toBe(kept[i].speed);
      expect(f.receivedAt).toBe(kept[i].receivedAt);
    });
    expect(decodeLapFixes(null, laps)).toEqual([[]]);
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
