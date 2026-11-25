import { NBSP } from '../format';
import { liveWalk } from '../liveActivity';

const T0 = new Date(2026, 10, 25, 7, 53).getTime();
const MIN = 60_000;
const walk = { name: 'Caminar', title: null, startedAt: T0, finishedAt: null, pausedAt: null, pausedMs: 0 };

describe('the walk in the Live Activity (1.5.7)', () => {
  it('counts the time from the start without the pauses, with the distance and the average pace', () => {
    const now = T0 + 12 * MIN;
    const live = liveWalk({ ...walk, pausedMs: 2 * MIN }, { distanceM: 820, activeMs: 10 * MIN, climbM: null }, now);
    expect(live).toMatchObject({ activeStart: T0 + 2 * MIN, paused: false, still: null, title: 'Caminar', symbol: 'figure.walk' });
    expect(live.metric).toBe(`820${NBSP}m`);
    // 820 m in 10 min: 12:12 per km.
    expect(live.body).toBe(`Ritmo medio 12:12${NBSP}/km`);
  });

  it('says it is recording before there is a pace, and starts at 0 m', () => {
    const live = liveWalk(walk, null, T0 + 5000);
    expect(live.body).toBe('Grabando la ruta');
    expect(live.metric).toBe(`0${NBSP}m`);
    expect(liveWalk(walk, { distanceM: 30, activeMs: 20_000, climbM: null }, T0 + 20_000).body).toBe('Grabando la ruta');
  });

  it('stops the time while paused', () => {
    const now = T0 + 20 * MIN;
    const live = liveWalk({ ...walk, pausedAt: T0 + 15 * MIN }, { distanceM: 1240, activeMs: 15 * MIN, climbM: 3 }, now);
    expect(live).toMatchObject({ paused: true, still: '15:00', body: 'En pausa', symbol: 'pause.circle' });
    expect(live.metric).toBe(`1,24${NBSP}km`);
  });

  it('goes by the title the user gave and the sport its name says', () => {
    expect(liveWalk({ ...walk, title: 'Vuelta al pantano' }, null, T0).title).toBe('Vuelta al pantano');
    expect(liveWalk({ ...walk, name: 'Correr suave' }, null, T0).symbol).toBe('figure.run');
    expect(liveWalk({ ...walk, name: 'Senderismo' }, null, T0).symbol).toBe('figure.hiking');
  });
});
