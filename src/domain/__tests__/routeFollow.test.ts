import {
  buildFollowLine,
  distanceToRoute,
  followNotice,
  followStep,
  followText,
  followView,
  parseFollowState,
  REMINDER_MS,
  routeAhead,
  type FollowEvent,
  type FollowFix,
  type FollowLine,
  type FollowState,
} from '../routeFollow';
import { distanceM } from '../gps';
import { routeLengthM } from '../routes';
import { LINE, LOOP, OUT_AND_BACK, reversed, walkAlong, type Corner } from './routeFixtures';

const T0 = Date.UTC(2026, 10, 9, 8, 0);
// A 5 km block.
const BLOCK: Corner[] = [
  [0, 0],
  [1500, 0],
  [1500, 1000],
  [0, 1000],
  [0, 0],
];

/** Fixes walking through `corners` at `speed` m/s, one every `every` seconds. */
function fixesAlong(corners: Corner[], { speed = 1.4, every = 3, drift = 0, seed = 2, accuracy = 5, t0 = T0 } = {}): FollowFix[] {
  return walkAlong(corners, { step: speed * every, drift, seed }).map((p, i) => ({ ...p, t: t0 + i * every * 1000, accuracy }));
}

const lineOf = (corners: Corner[], drift = 8) => buildFollowLine([walkAlong(corners, { seed: 1, drift })]);

/** Runs the fixes in batches (one by default), as the GPS task would, collecting the events. */
function run(line: FollowLine, fixes: FollowFix[], { alertOn = true, batch = 1, start = null as FollowState | null } = {}) {
  let state = start;
  const events: { event: FollowEvent; i: number }[] = [];
  const states: FollowState[] = [];
  for (let i = 0; i < fixes.length; i += batch) {
    const chunk = fixes.slice(i, i + batch);
    const result = followStep(line, state, chunk, chunk.at(-1)!.t + 1000, alertOn);
    state = result.state;
    states.push(state);
    if (result.event) events.push({ event: result.event, i: i + chunk.length - 1 });
  }
  return { state: state!, events, states };
}

describe('following a route', () => {
  it('walks a 5 km block with the drift of a phone without a single alert, to its end', () => {
    const line = lineOf(BLOCK);
    for (const seed of [2, 3, 4, 5, 6]) {
      const { state, events } = run(line, fixesAlong(BLOCK, { drift: 8, seed }));
      expect(events).toEqual([]);
      expect(state.status).toBe('done');
      expect(state.dir).toBe(1);
    }
  });

  it('ignores noise of ±15 m with a fix out to 35 m now and then', () => {
    const line = lineOf(BLOCK);
    const fixes = fixesAlong(BLOCK, { drift: 15, seed: 3 }).map((f, i) =>
      i % 20 === 10 ? { ...f, lon: f.lon + 35 / (111_195 * Math.cos((f.lat * Math.PI) / 180)), accuracy: 18 } : f,
    );
    expect(run(line, fixes).events).toEqual([]);
  });

  it('alerts on the third fix past 40 m of a 100 m detour, and says so on the second back under 25 m', () => {
    const route: Corner[] = [
      [0, 0],
      [1000, 0],
    ];
    const detour: Corner[] = [
      [0, 0],
      [400, 0],
      [400, 100],
      [500, 100],
      [500, 0],
      [1000, 0],
    ];
    const line = lineOf(route, 0);
    const fixes = fixesAlong(detour);
    const distances = fixes.map((f) => distanceToRoute(line, f));
    const firstOut = distances.findIndex((d) => d > 40);
    const firstIn = distances.findIndex((d, i) => i > firstOut && d < 25);
    expect(run(line, fixes).events).toEqual([
      { event: 'off', i: firstOut + 2 },
      { event: 'back', i: firstIn + 1 },
    ]);
  });

  it('does not alert on a path 30 m beside the route', () => {
    const route: Corner[] = [
      [0, 0],
      [1200, 0],
    ];
    const beside: Corner[] = [
      [0, 0],
      [300, 0],
      [300, 30],
      [900, 30],
      [900, 0],
      [1200, 0],
    ];
    const { events, states } = run(lineOf(route, 0), fixesAlong(beside));
    expect(events).toEqual([]);
    expect(states.every((s) => s.status !== 'off')).toBe(true);
  });

  it('ignores fixes with a bad accuracy, even three in a row far away', () => {
    const line = lineOf(LOOP, 0);
    const fixes = fixesAlong(LOOP).map((f, i) => (i % 4 === 2 || (i >= 100 && i < 103) ? { ...f, lat: f.lat + 80 / 111_195, accuracy: 35 } : f));
    expect(run(line, fixes).events).toEqual([]);
    expect(run(line, fixes.map((f, i) => (i === 50 ? { ...f, accuracy: null } : f))).events).toEqual([]);
  });

  it('starts counting again after more than 30 s without a good fix', () => {
    const route: Corner[] = [
      [0, 0],
      [600, 0],
    ];
    const line = lineOf(route, 0);
    const on = fixesAlong(route).slice(0, 20);
    const t = on.at(-1)!.t;
    const away = (dt: number, y: number) => ({ ...on.at(-1)!, lat: on.at(-1)!.lat + y / 111_195, t: t + dt });
    const twoOut = [away(3_000, 60), away(6_000, 60)];
    expect(run(line, [...on, ...twoOut, away(9_000, 60)]).events.map((e) => e.event)).toEqual(['off']);
    expect(run(line, [...on, ...twoOut, away(46_000, 60)]).events).toEqual([]);
  });

  it('on an out-and-back, does not take the way back for the way out', () => {
    const line = lineOf(OUT_AND_BACK);
    const fixes = fixesAlong(OUT_AND_BACK, { drift: 8, seed: 4 });
    const { states, events } = run(line, fixes);
    expect(events).toEqual([]);
    // 300 m from home on the way back: 1100 m along the 1400 m route.
    const i = Math.round(1100 / (1.4 * 3));
    expect(followView(states[i], line).doneM).toBeGreaterThan(1050);
    expect(followView(states[i], line).doneM).toBeLessThan(1150);
  });

  it('finds out that a loop is walked the other way round before 150 m', () => {
    const line = lineOf(LOOP);
    const { states, events, state } = run(line, fixesAlong(reversed(LOOP), { drift: 8, seed: 5 }));
    expect(events).toEqual([]);
    expect(states[Math.round(150 / 4.2)].dir).toBe(-1);
    expect(state.status).toBe('done');
  });

  it('follows a route from one place to another started at its end', () => {
    const line = lineOf(LINE);
    const { state, events, states } = run(line, fixesAlong(reversed(LINE), { drift: 8, seed: 6 }));
    expect(events).toEqual([]);
    expect(states[5].initial).toBe(-1);
    expect(state).toMatchObject({ dir: -1, status: 'done' });
  });

  it('joins a route halfway', () => {
    const route: Corner[] = [
      [0, 0],
      [1000, 0],
    ];
    const line = lineOf(route, 0);
    const half: Corner[] = [
      [500, 0],
      [1000, 0],
    ];
    const { states, state, events } = run(line, fixesAlong(half));
    expect(events).toEqual([]);
    expect(followView(states[5], line).doneM).toBeGreaterThan(490);
    expect(followView(states[5], line).doneM).toBeLessThan(560);
    expect(state.status).toBe('done');
  });

  it('starting 600 m away, says how far the route is and never alerts until on it', () => {
    const line = lineOf(LOOP, 0);
    const fixes = fixesAlong([[-600, 0], ...LOOP]);
    const { states, events } = run(line, fixes);
    expect(events).toEqual([]);
    expect(followText(followView(states[0], line), 'Manzana')).toBe('A 600 m de la ruta');
    expect(followView(states[60], line).gapM).toBeLessThan(followView(states[10], line).gapM);
    expect(states[150].status).toBe('on');
  });

  it('does not alert walking on past the end of the route', () => {
    const route: Corner[] = [
      [0, 0],
      [800, 0],
    ];
    const { events, state } = run(lineOf(route, 0), fixesAlong([[0, 0], [800, 0], [800, 400]]));
    expect(events).toEqual([]);
    expect(state.status).toBe('done');
  });

  it('crosses the gap between two segments without alerts and without progress', () => {
    const line = buildFollowLine([walkAlong([[0, 0], [500, 0]], { drift: 0 }), walkAlong([[700, 0], [1200, 0]], { drift: 0 })]);
    expect(Math.abs(line.total - 1000)).toBeLessThan(10);
    const fixes = fixesAlong([
      [0, 0],
      [1200, 0],
    ]);
    const { events, states, state } = run(line, fixes);
    expect(events).toEqual([]);
    expect(followView(states[Math.round(600 / 4.2)], line).doneM).toBeCloseTo(500, -1);
    expect(state.status).toBe('done');
  });

  it('does not alert with fixes that arrive late, and does with the next fresh ones', () => {
    const route: Corner[] = [
      [0, 0],
      [600, 0],
    ];
    const line = lineOf(route, 0);
    const on = fixesAlong(route).slice(0, 20);
    const last = on.at(-1)!;
    const far = [1, 2, 3, 4].map((k) => ({ ...last, lat: last.lat + 80 / 111_195, t: last.t + k * 3000 }));
    const { state } = run(line, on);
    const late = followStep(line, state, far.slice(0, 3), far[2].t + 120_000, true);
    expect(late.event).toBeNull();
    expect(late.state.status).toBe('off');
    expect(followStep(line, late.state, far.slice(3), far[3].t + 1000, true).event).toBe('off');
  });

  it('reminds once if still off the route and farther after 3 min, never standing still', () => {
    const route: Corner[] = [
      [0, 0],
      [600, 0],
    ];
    const line = lineOf(route, 0);
    const on = fixesAlong(route).slice(0, 20);
    const last = on.at(-1)!;
    const at = (seconds: number, y: number) => ({ ...last, lat: last.lat + y / 111_195, t: last.t + seconds * 1000 });
    const minutes = (REMINDER_MS / 1000) * 2;
    const still = Array.from({ length: minutes / 3 }, (_, k) => at(3 * (k + 1), 60));
    expect(run(line, [...on, ...still]).events.map((e) => e.event)).toEqual(['off']);
    const away = Array.from({ length: minutes / 3 }, (_, k) => at(3 * (k + 1), 45 + k));
    const result = run(line, [...on, ...away]);
    expect(result.events.map((e) => e.event)).toEqual(['off', 'reminder']);
    expect(away[result.events[1].i - on.length].t - away[0].t).toBeGreaterThanOrEqual(REMINDER_MS - 6000);
  });

  it('with the alert off, keeps the state but says nothing', () => {
    const route: Corner[] = [
      [0, 0],
      [1000, 0],
    ];
    const detour: Corner[] = [
      [0, 0],
      [400, 0],
      [400, 100],
      [500, 100],
      [500, 0],
      [1000, 0],
    ];
    const { events, states } = run(lineOf(route, 0), fixesAlong(detour), { alertOn: false });
    expect(events).toEqual([]);
    expect(states.some((s) => s.status === 'off')).toBe(true);
  });

  it('runs a 20 km route of 4000 points with 1200 fixes in well under a second', () => {
    const big: Corner[] = [
      [0, 0],
      [6000, 0],
      [6000, 4000],
      [0, 4000],
      [0, 0],
    ];
    const line = buildFollowLine([walkAlong(big, { step: 5, seed: 1 })]);
    expect(line.forward.xs.length).toBeGreaterThan(3900);
    const fixes = fixesAlong(big, { speed: 1.4, every: 3, drift: 8 }).slice(0, 1200);
    const started = performance.now();
    run(line, fixes, { batch: 2 });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('carries on the same from the state stored between batches', () => {
    const line = lineOf(BLOCK);
    const fixes = fixesAlong(BLOCK, { drift: 8, seed: 2 });
    const whole = run(line, fixes, { batch: fixes.length }).state;
    let state: FollowState | null = null;
    for (let i = 0; i < fixes.length; i += 3) {
      const chunk = fixes.slice(i, i + 3);
      state = parseFollowState(JSON.stringify(followStep(line, state, chunk, chunk.at(-1)!.t + 1000, true).state));
    }
    expect(state).toEqual(whole);
  });

  describe('what is left of the route to draw', () => {
    const route = [walkAlong(BLOCK, { seed: 1, drift: 0 })];
    const line = buildFollowLine(route);
    const walked = (fixes: FollowFix[], metres: number) => fixes.slice(0, Math.round(metres / (1.4 * 3)));

    it('is the whole route before stepping on it and until the way round is known', () => {
      expect(routeAhead(route, line, null)).toBe(route);
      const far = fixesAlong([[-500, 500], [-500, 400]], { drift: 0 });
      expect(routeAhead(route, line, run(line, far).state)).toBe(route);
      const { state } = run(line, walked(fixesAlong(BLOCK, { drift: 0 }), 60));
      expect(state.status).toBe('on');
      expect(state.dir).toBe(0);
      expect(routeAhead(route, line, state)).toBe(route);
    });

    it('loses what is behind the walker as they go, and starts where they are', () => {
      const fixes = walked(fixesAlong(BLOCK, { drift: 0 }), 2000);
      const { state } = run(line, fixes);
      const view = followView(state, line);
      const ahead = routeAhead(route, line, state);
      expect(view.doneM).toBeGreaterThan(1900);
      expect(routeLengthM(ahead)).toBeCloseTo(view.leftM, -1);
      expect(distanceM(ahead[0][0], fixes.at(-1)!)).toBeLessThan(10);
      expect(ahead[0].at(-1)).toEqual(route[0].at(-1));
    });

    it('keeps the part towards the start when the route is walked back to front', () => {
      const way = [walkAlong(LINE, { seed: 1, drift: 0 })];
      const wayLine = buildFollowLine(way);
      const fixes = walked(fixesAlong(reversed(LINE), { drift: 0 }), 600);
      const { state } = run(wayLine, fixes);
      expect(state.dir).toBe(-1);
      const ahead = routeAhead(way, wayLine, state);
      expect(ahead[0][0]).toEqual(way[0][0]);
      expect(distanceM(ahead[0].at(-1)!, fixes.at(-1)!)).toBeLessThan(10);
      expect(routeLengthM(ahead)).toBeCloseTo(followView(state, wayLine).leftM, -1);
    });

    it('still shows what was left while off the route, and nothing at its end', () => {
      const detour: Corner[] = [[0, 0], [600, 0], [600, -150], [900, -150]];
      const { state } = run(line, fixesAlong(detour, { drift: 0 }));
      expect(state.status).toBe('off');
      expect(routeLengthM(routeAhead(route, line, state))).toBeGreaterThan(4300);
      expect(routeAhead(route, line, run(line, fixesAlong(BLOCK, { drift: 0 })).state)).toEqual([]);
    });

    it('drops the segments already walked of a route in two parts', () => {
      const parts = [walkAlong([[0, 0], [800, 0]], { seed: 1, drift: 0 }), walkAlong([[900, 0], [1700, 0]], { seed: 1, drift: 0 })];
      const partsLine = buildFollowLine(parts);
      const { state } = run(partsLine, walked(fixesAlong([[0, 0], [1700, 0]], { drift: 0 }), 1200));
      const ahead = routeAhead(parts, partsLine, state);
      expect(ahead).toHaveLength(1);
      expect(ahead[0].at(-1)).toEqual(parts[1].at(-1));
      expect(routeLengthM(ahead)).toBeCloseTo(followView(state, partsLine).leftM, -1);
    });
  });

  it('writes the line under the figures and the notifications', () => {
    const line = lineOf(BLOCK, 0);
    expect(followText(followView(null, line), 'Ver hormigas')).toBe('Ver hormigas · 5 km');
    const view = { kind: 'on' as const, doneM: 2310, leftM: 2690, gapM: 0, totalM: 5000 };
    expect(followText(view, 'Ver hormigas')).toBe('2,3 de 5 km · quedan 2,7');
    expect(followText({ ...view, kind: 'off', gapM: 63 }, 'Ver hormigas')).toBe('Fuera de la ruta · a 60 m');
    expect(followText({ ...view, kind: 'approach', gapM: 2340 }, 'Ver hormigas')).toBe('A 2,3 km de la ruta');
    expect(followText({ ...view, kind: 'done' }, 'Ver hormigas')).toBe('Final de la ruta · 5 km');
    expect(followNotice('off', { ...view, gapM: 63 }, 'Ver hormigas')).toEqual({
      title: 'Te has salido de la ruta',
      body: 'Estás a 60 m de «Ver hormigas».',
    });
    expect(followNotice('back', view, 'Ver hormigas').body).toBe('Quedan 2,7 km de «Ver hormigas».');
    expect(parseFollowState('{"v":2}')).toBeNull();
    expect(parseFollowState('no')).toBeNull();
  });
});
