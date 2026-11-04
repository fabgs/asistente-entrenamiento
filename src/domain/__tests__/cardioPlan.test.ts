import { DEFAULT_PLANS, describePlan, expandPlan, parsePlan, phaseAt, planAlarms, planSeconds, sharesLockCountdown, trackingDetails } from '../cardioPlan';
import { DEFAULT_SPRINT_PLAN } from '../sprint';

describe('cardio plans', () => {
  it('expands MISS into warm-up, main block and cool-down', () => {
    const phases = expandPlan(DEFAULT_PLANS.miss);
    expect(phases.map((p) => [p.label, p.intensity, p.startSec, p.seconds])).toEqual([
      ['Calentamiento', 'low', 0, 300],
      ['Intensidad media (Z3-4)', 'medium', 300, 1200],
      ['Enfriamiento', 'low', 1500, 300],
    ]);
    expect(planSeconds(DEFAULT_PLANS.miss)).toBe(1800);
  });

  it('expands HIIT rounds into work and recovery', () => {
    const phases = expandPlan({ kind: 'hiit', warmupMin: 3, rounds: 2, workSec: 30, restSec: 60, cooldownMin: 0 });
    expect(phases.map((p) => p.label)).toEqual(['Calentamiento', 'Sprint 1/2', 'Recupera 1/2', 'Sprint 2/2', 'Recupera 2/2']);
    expect(phases[3]).toMatchObject({ intensity: 'high', startSec: 180 + 90 });
    expect(planSeconds(DEFAULT_PLANS.hiit)).toBe(15 * 60);
  });

  it('finds the running phase and what is left of it', () => {
    const phases = expandPlan(DEFAULT_PLANS.miss);
    expect(phaseAt(phases, 0)).toMatchObject({ index: 0, remainingSec: 300 });
    expect(phaseAt(phases, 299.5)).toMatchObject({ index: 0, remainingSec: 0.5 });
    expect(phaseAt(phases, 300)).toMatchObject({ index: 1, remainingSec: 1200 });
    expect(phaseAt(phases, 1799)).toMatchObject({ index: 2, remainingSec: 1 });
    expect(phaseAt(phases, 1800)).toBeNull();
  });

  it('describes plans briefly', () => {
    expect(describePlan(DEFAULT_PLANS.liss)).toBe('30 min');
    expect(describePlan(DEFAULT_PLANS.miss)).toBe('5 + 20 + 5 min');
    expect(describePlan(DEFAULT_PLANS.hiit)).toBe('3 min + 6 × (30 s / 1 min) + 3 min');
  });

  it('parses only valid stored plans', () => {
    expect(parsePlan(JSON.stringify(DEFAULT_PLANS.hiit))).toEqual(DEFAULT_PLANS.hiit);
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan('{')).toBeNull();
    expect(parsePlan('{"kind":"liss"}')).toBeNull();
    expect(parsePlan('{"kind":"liss","minutes":0}')).toBeNull();
    expect(parsePlan('{"kind":"tabata","minutes":4}')).toBeNull();
  });

  it('schedules an alarm for every phase change still ahead and the end', () => {
    const alarms = planAlarms(DEFAULT_PLANS.miss, 'Bici estática', 0, 0);
    expect(alarms.map((a) => [a.key, a.at, a.title])).toEqual([
      ['1', 300_000, 'Intensidad media (Z3-4) · 20 min'],
      ['2', 1_500_000, 'Enfriamiento · 5 min'],
      ['end', 1_800_000, '¡Cardio terminado!'],
    ]);
    expect(alarms[0].body).toBe('Intensidad media · luego: Enfriamiento');
    expect(alarms[1].body).toBe('Intensidad suave · última fase');
    expect(alarms[2].body).toBe('Bici estática · 5 + 20 + 5 min');
  });

  it('only schedules what is left after resuming', () => {
    // 10 min in (the clock started 10 min ago, pauses excluded).
    const alarms = planAlarms(DEFAULT_PLANS.miss, 'Bici', 1_000_000 - 600_000, 1_000_000);
    expect(alarms.map((a) => a.key)).toEqual(['2', 'end']);
    expect(planAlarms(DEFAULT_PLANS.miss, 'Bici', 0, 2_000_000)).toEqual([]);
  });
});

describe('trackingDetails', () => {
  const base = { plan: null, sprint: null, intensity: 'Alta (HIIT)' };
  it('describes the plan of a timer or of the sprints, or the intensity', () => {
    expect(trackingDetails({ ...base, tracking: 'timer', plan: DEFAULT_PLANS.liss })).toBe('LISS · continuo suave');
    expect(trackingDetails({ ...base, tracking: 'timer', plan: DEFAULT_PLANS.hiit })).toBe(
      'HIIT · intervalos · 3 min + 6 × (30 s / 1 min) + 3 min',
    );
    expect(trackingDetails({ ...base, tracking: 'sprint', sprint: DEFAULT_SPRINT_PLAN })).toBe('6 sprints · descanso 1:30');
    expect(trackingDetails({ ...base, tracking: 'check' })).toBe('Alta (HIIT)');
    expect(trackingDetails({ ...base, tracking: 'gps', intensity: null })).toBeNull();
  });
});

describe('sharesLockCountdown', () => {
  it('is true for the cardio that uses the lock-screen countdown', () => {
    expect(sharesLockCountdown('sprint')).toBe(true);
    expect(sharesLockCountdown('timer')).toBe(true);
    expect(sharesLockCountdown('gps')).toBe(false);
    expect(sharesLockCountdown('check')).toBe(false);
  });
});
