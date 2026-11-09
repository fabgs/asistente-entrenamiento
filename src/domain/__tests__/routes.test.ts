import {
  bestRouteMatch,
  compareWithEarlier,
  defaultRouteName,
  exclusionOf,
  exclusionText,
  ordinalOf,
  routeCloses,
  routeEnds,
  routeFacts,
  routeLengthM,
  routeMatch,
  recentFirst,
  routeQuestion,
  routeRecords,
  timesLine,
  visitLines,
  type RouteMatch,
  type RouteTime,
} from '../routes';
import { at, LINE, LOOP, LOOP_DETOUR, OUT_AND_BACK, reversed, walkAlong, type Corner } from './routeFixtures';

describe('routeMatch', () => {
  it('finds the same loop walked again with another GPS error', () => {
    const route = [walkAlong(LOOP, { seed: 1 })];
    const walk = [walkAlong(LOOP, { seed: 5 })];
    const match = routeMatch(walk, route);
    expect(match.kind).toBe('same');
    expect(match.reversed).toBe(false);
    expect(match.overlap).toBeGreaterThan(0.95);
  });

  it('tells a loop walked the other way round', () => {
    const route = [walkAlong(LOOP, { seed: 1 })];
    expect(routeMatch([walkAlong(reversed(LOOP), { seed: 3 })], route)).toMatchObject({ kind: 'reverse', reversed: true });
  });

  it('takes an out-and-back on the same street as the same route either way', () => {
    const route = [walkAlong(OUT_AND_BACK, { seed: 1 })];
    expect(routeMatch([walkAlong(OUT_AND_BACK, { seed: 2 })], route).kind).toBe('same');
    expect(routeMatch([walkAlong(reversed(OUT_AND_BACK), { seed: 4 })], route).kind).toBe('same');
  });

  it('tells a route from one place to another walked back', () => {
    const route = [walkAlong(LINE, { seed: 1 })];
    expect(routeMatch([walkAlong(LINE, { seed: 2 })], route).kind).toBe('same');
    expect(routeMatch([walkAlong(reversed(LINE), { seed: 2 })], route)).toMatchObject({ kind: 'reverse', reversed: true });
  });

  it('does not take a loop for an out-and-back of the same length from the same door', () => {
    const loop = [walkAlong(LOOP, { seed: 1 })];
    const outAndBack = [walkAlong(OUT_AND_BACK, { seed: 2 })];
    expect(routeLengthM(outAndBack)).toBeCloseTo(routeLengthM(loop), -2);
    expect(routeMatch(outAndBack, loop).kind).toBe('none');
    expect(routeMatch(loop, outAndBack).kind).toBe('none');
  });

  it('calls a detour of 300 m a variant, and says which way round it went', () => {
    // A 2 km block; the walk leaves the top street for a parallel one 150 m further north.
    const block: Corner[] = [
      [0, 0],
      [600, 0],
      [600, 400],
      [0, 400],
      [0, 0],
    ];
    const detour: Corner[] = [
      [0, 0],
      [600, 0],
      [600, 400],
      [450, 400],
      [450, 550],
      [150, 550],
      [150, 400],
      [0, 400],
      [0, 0],
    ];
    const route = [walkAlong(block, { seed: 1 })];
    const variant = routeMatch([walkAlong(detour, { seed: 2 })], route);
    expect(variant.kind).toBe('variant');
    expect(variant.reversed).toBe(false);
    expect(variant.overlap).toBeGreaterThanOrEqual(0.5);
    expect(variant.overlap).toBeLessThan(0.85);
    expect(routeMatch([walkAlong(reversed(detour), { seed: 2 })], route)).toMatchObject({ kind: 'variant', reversed: true });
  });

  it('on a 5 km block, a long parallel street is a variant; a short one or a spur is the same route, off the best', () => {
    const block: Corner[] = [
      [0, 0],
      [1500, 0],
      [1500, 1000],
      [0, 1000],
      [0, 0],
    ];
    // Both add 300 m. Measured: 0.85 (just a variant), 0.91 and 0.96.
    const longParallel: Corner[] = [[0, 0], [1500, 0], [1500, 1000], [1050, 1000], [1050, 1150], [450, 1150], [450, 1000], [0, 1000], [0, 0]];
    const shortParallel: Corner[] = [[0, 0], [1500, 0], [1500, 1000], [900, 1000], [900, 1150], [600, 1150], [600, 1000], [0, 1000], [0, 0]];
    const spur: Corner[] = [[0, 0], [1500, 0], [1500, 1000], [750, 1000], [750, 1150], [750, 1000], [0, 1000], [0, 0]];
    const route = [walkAlong(block, { seed: 1 })];
    expect(routeMatch([walkAlong(longParallel, { seed: 2 })], route).kind).toBe('variant');
    for (const detour of [shortParallel, spur]) {
      const walk = [walkAlong(detour, { seed: 2 })];
      expect(routeMatch(walk, route).kind).toBe('same');
      // The overlap is no help there: the metres off the route keep it off the best time.
      expect(exclusionOf(walk, route, 'same')?.kind).toBe('off');
    }
  });

  it('calls the block with its top street swapped a variant (the fixture of the database tests)', () => {
    expect(routeMatch([walkAlong(LOOP_DETOUR, { seed: 2 })], [walkAlong(LOOP, { seed: 1 })]).kind).toBe('variant');
  });

  it('keeps apart two loops that only share the way out', () => {
    const north: Corner[] = [
      [0, 0],
      [700, 0],
      [700, 300],
      [0, 300],
      [0, 0],
    ];
    const south: Corner[] = [
      [0, 0],
      [700, 0],
      [700, -300],
      [0, -300],
      [0, 0],
    ];
    expect(routeMatch([walkAlong(south, { seed: 2 })], [walkAlong(north, { seed: 1 })]).kind).toBe('none');
  });

  it('allows a start 150 m away, but not 250 m', () => {
    const route = [walkAlong(LOOP, { seed: 1 })];
    const from150: Corner[] = [[-150, 0], ...LOOP];
    const from250: Corner[] = [[-250, 0], ...LOOP];
    expect(routeMatch([walkAlong(from150, { seed: 2 })], route).kind).toBe('same');
    expect(routeMatch([walkAlong(from250, { seed: 2 })], route).kind).toBe('none');
  });

  it('joins the segments of a walk with a pause', () => {
    const route = [walkAlong(LOOP, { seed: 1 })];
    const walk = walkAlong(LOOP, { seed: 3 });
    // Paused for a while: the GPS starts again 30 m further on.
    const paused = [walk.slice(0, 80), walk.slice(84)];
    expect(routeMatch(paused, route).kind).toBe('same');
  });

  it('does not count the same loop walked twice', () => {
    const route = [walkAlong(LOOP, { seed: 1 })];
    const twice = [walkAlong([...LOOP, ...LOOP.slice(1)], { seed: 2 })];
    expect(routeMatch(twice, route).kind).toBe('none');
  });

  it('ignores walks somewhere else and empty ones', () => {
    const route = [walkAlong(LOOP, { seed: 1 })];
    const elsewhere = walkAlong(LOOP, { seed: 2 }).map((p) => ({ lat: p.lat + 0.05, lon: p.lon }));
    expect(routeMatch([elsewhere], route).kind).toBe('none');
    expect(routeMatch([], route).kind).toBe('none');
    expect(routeMatch([[]], route).kind).toBe('none');
    expect(routeMatch(route, []).kind).toBe('none');
  });

  it('knows where a route starts and ends, and whether it closes', () => {
    const segments = [[at(0, 0), at(10, 0)], [], [at(20, 0), at(30, 0)]];
    expect(routeEnds(segments)).toEqual({ start: at(0, 0), end: at(30, 0) });
    expect(routeEnds([[]])).toBeNull();
    expect(routeCloses([walkAlong(LOOP)])).toBe(true);
    expect(routeCloses([walkAlong(OUT_AND_BACK)])).toBe(true);
    expect(routeCloses([walkAlong(LINE)])).toBe(false);
  });

  it('picks a route walked the same way or back before a variant with more overlap', () => {
    const m = (kind: RouteMatch['kind'], overlap: number): RouteMatch => ({ kind, reversed: kind === 'reverse', overlap });
    expect(bestRouteMatch([{ item: 1, match: m('variant', 0.84) }, { item: 2, match: m('same', 0.86) }])?.item).toBe(2);
    expect(bestRouteMatch([{ item: 1, match: m('same', 0.9) }, { item: 2, match: m('reverse', 0.97) }])?.item).toBe(2);
    expect(bestRouteMatch([{ item: 1, match: m('variant', 0.6) }, { item: 2, match: m('variant', 0.7) }])?.item).toBe(2);
    expect(bestRouteMatch([{ item: 1, match: m('none', 0.3) }])).toBeNull();
    expect(bestRouteMatch([])).toBeNull();
  });
});

describe('exclusionOf', () => {
  const route = [walkAlong(LOOP, { drift: 0 })];

  it('lets compete a walk that starts 90 m away, not one that starts 150 m away', () => {
    expect(exclusionOf([walkAlong([[-90, 0], ...LOOP], { drift: 0, seed: 2 })], route, 'same')).toBeNull();
    expect(exclusionOf([walkAlong([[-150, 0], ...LOOP], { drift: 0, seed: 2 })], route, 'same')).toEqual({ kind: 'start', m: 150 });
    expect(exclusionOf([walkAlong([...LOOP, [0, -150]], { drift: 0, seed: 2 })], route, 'same')).toEqual({ kind: 'end', m: 150 });
  });

  it('measures the start of a walk back from the end of the route', () => {
    const line = [walkAlong(LINE, { drift: 0 })];
    expect(exclusionOf([walkAlong(reversed(LINE), { drift: 0, seed: 2 })], line, 'reverse')).toBeNull();
    expect(exclusionOf([walkAlong(reversed(LINE), { drift: 0, seed: 2 })], line, 'same')?.kind).toBe('start');
  });

  it('adds up what was not recorded between pauses', () => {
    // A point every 8 m: the GPS starts again 64 m and then 56 m further on.
    const walk = walkAlong(LOOP, { drift: 0, seed: 2 });
    expect(exclusionOf([walk.slice(0, 20), walk.slice(27, 40), walk.slice(46)], route, 'same')).toEqual({ kind: 'gap', m: 120 });
    expect(exclusionOf([walk.slice(0, 20), walk.slice(27)], route, 'same')).toBeNull();
  });

  it('lets the GPS drift, and never gives a reason for a variant', () => {
    expect(exclusionOf([walkAlong(LOOP, { drift: 12, seed: 3 })], route, 'same')).toBeNull();
    expect(exclusionOf([walkAlong([[-150, 0], ...LOOP], { seed: 2 })], route, 'variant')).toBeNull();
  });

  it('says why in a few words', () => {
    expect(exclusionText({ kind: 'start', m: 150 })).toBe('No cuenta para el mejor: empieza a 150 m');
    expect(exclusionText({ kind: 'end', m: 120 })).toBe('No cuenta para el mejor: acaba a 120 m');
    expect(exclusionText({ kind: 'gap', m: 300 })).toBe('No cuenta para el mejor: 300 m sin grabar');
    expect(exclusionText({ kind: 'off', m: 230 })).toBe('No cuenta para el mejor: 230 m fuera de la ruta');
  });
});

describe('the walks of a route', () => {
  const MIN = 60_000;
  let next = 1;
  /** A walk of the route on day `day` of November, in `minutes`. */
  const time = (day: number, minutes: number, relation: RouteTime['relation'] = 'same', exclusion: RouteTime['exclusion'] = null): RouteTime => ({
    sessionId: next++,
    startedAt: Date.UTC(2026, 10, day, 9),
    date: `2026-11-${String(day).padStart(2, '0')}`,
    activeMs: minutes * MIN,
    distanceM: 5140,
    relation,
    exclusion,
  });

  it('compares each walk with the best of the earlier ones only', () => {
    const first = time(1, 55);
    const second = time(3, 52.5);
    const third = time(5, 54);
    const fourth = time(7, 50);
    const all = [fourth, first, third, second];
    expect(visitLines(first, all, true)).toEqual({ first: '1.ª vez', second: null });
    expect(visitLines(second, all, true)).toEqual({ first: '2.ª vez', second: '2:30 más rápido que la otra vez' });
    expect(visitLines(third, all, true)).toEqual({ first: '3.ª vez', second: '1:30 más lento que tu mejor' });
    // The best of the three before it is the second one (52:30), not this later one.
    expect(compareWithEarlier(fourth, all, true)).toEqual({ diffMs: -2.5 * MIN, against: 'best' });
    expect(ordinalOf(fourth, all)).toBe(4);
  });

  it('calls less than 15 s the same, and 15 s a difference', () => {
    const first = time(1, 52);
    expect(visitLines(time(2, 52 + 14 / 60), [first], true).second).toBe('Igual que la otra vez');
    expect(visitLines(time(2, 52 + 15 / 60), [first], true).second).toBe('0:15 más lento que la otra vez');
  });

  it('on a loop, compares a walk back with the ones the same way; on a line, only with the ones back', () => {
    const ahead = time(1, 50);
    const back = time(2, 51, 'reverse');
    expect(visitLines(back, [ahead, back], true)).toEqual({ first: '2.ª vez · al revés', second: '1:00 más lento que la otra vez' });
    expect(visitLines(back, [ahead, back], false)).toEqual({ first: '2.ª vez · al revés', second: null });
    const records = routeRecords([ahead, back], false);
    expect(records.best).toBe(ahead);
    expect(records.chart).toEqual([ahead]);
  });

  it('leaves out variants and walks with a reason, but counts them as times walked', () => {
    const first = time(1, 50);
    const variant = time(2, 40, 'variant');
    const short = time(3, 45, 'same', { kind: 'start', m: 150 });
    const fourth = time(4, 51);
    const all = [first, variant, short, fourth];
    expect(visitLines(variant, all, true)).toEqual({ first: '2.ª vez · variante', second: null });
    expect(visitLines(short, all, true)).toEqual({ first: '3.ª vez', second: 'No cuenta para el mejor: empieza a 150 m' });
    expect(visitLines(fourth, all, true)).toEqual({ first: '4.ª vez', second: '1:00 más lento que la otra vez' });
    expect(routeRecords(all, true)).toEqual({ best: first, last: fourth, chart: [first, fourth] });
    expect(routeRecords([variant], true)).toEqual({ best: null, last: null, chart: [] });
  });

  it('offers first the route walked or saved most recently', () => {
    const item = (name: string, lastAt: number | null, createdAt: number) => ({ name, lastAt, route: { createdAt } });
    const sorted = recentFirst([item('vieja', 100, 50), item('gpx de hoy', null, 900), item('andada ayer', 800, 10), item('nunca', null, 20)]);
    expect(sorted.map((i) => i.name)).toEqual(['gpx de hoy', 'andada ayer', 'vieja', 'nunca']);
  });

  it('writes the facts, the name, the question and the times walked', () => {
    expect(routeFacts(5140, 47.6)).toBe('5,14 km · desnivel +48 m');
    expect(routeFacts(5140, 47.6, true)).toBe('5,14 km · +48 m');
    expect(routeFacts(850, null)).toBe('0,85 km');
    expect(defaultRouteName('Ver hormigas', 5140)).toBe('Ver hormigas');
    expect(defaultRouteName(null, 5140)).toBe('Ruta de 5,1 km');
    expect(defaultRouteName('  ', 5000)).toBe('Ruta de 5 km');
    const m = (kind: RouteMatch['kind'], overlap = 1): RouteMatch => ({ kind, reversed: kind === 'reverse', overlap });
    expect(routeQuestion('Ver hormigas', m('same'), 5140, 5140)).toEqual({ title: '¿Es tu ruta «Ver hormigas»?', detail: null });
    expect(routeQuestion('Ver hormigas', m('reverse'), 5140, 5140).title).toBe('¿Es tu ruta «Ver hormigas», al revés?');
    expect(routeQuestion('Ver hormigas', m('variant', 0.724), 5600, 5140)).toEqual({
      title: '¿Es una variante de «Ver hormigas»?',
      detail: 'Coincide el 72 % del recorrido · 5,60 km frente a 5,14 km',
    });
    expect(timesLine(4, '9 nov')).toBe('4 veces · la última el 9 nov');
    expect(timesLine(1, '9 nov')).toBe('1 vez · el 9 nov');
    expect(timesLine(0, null)).toBe('Sin caminatas');
  });
});
