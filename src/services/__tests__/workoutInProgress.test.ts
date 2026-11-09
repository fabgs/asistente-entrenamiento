import type { Slot } from '@/db/repositories/routines';
import type { Session, SetLog } from '@/db/repositories/sessions';
import { completedLabel, describeNext, inProgressText } from '../workoutInProgress';

jest.mock('../../../modules/rest-timer', () => ({ startOngoing: jest.fn(), stopOngoing: jest.fn() }));

const slot = (id: number, name: string, sets = 3): Slot =>
  ({ id, routineId: 1, exerciseName: name, sets, weightKg: 35, exerciseType: 'external', exercisePair: false }) as Slot;

const session = (over: Partial<Session> = {}): Session => ({
  id: 9,
  routineId: null,
  routineName: null,
  title: null,
  date: '2026-11-04',
  startedAt: 0,
  finishedAt: null,
  status: 'in_progress',
  imported: false,
  restEndsAt: null,
  restNotificationId: null,
  currentSlotId: null,
  skippedSlotIds: [],
  looseFirst: 'Remo',
  looseCount: 1,
  warmupStartedAt: null,
  warmupEndedAt: null,
  setStartedAt: null,
  ...over,
});

const set = (slotId: number, n: number): SetLog => ({
  id: n,
  sessionId: 9,
  slotId,
  exerciseId: slotId,
  setIndex: n,
  weightKg: 35,
  reps: 12,
  isExtra: false,
  isWarmup: false,
  startedAt: null,
  restSeconds: null,
  completedAt: n,
});

describe('workout notification text', () => {
  const remo = slot(1, 'Remo');

  it('does not break on a slot it does not know', () => {
    expect(describeNext({ kind: 'next_set', slotId: 99, setNumber: 2 }, [remo])).toBe('Serie 2');
    expect(describeNext({ kind: 'next_exercise', slotId: 99 }, [remo])).toBe('Siguiente ejercicio');
  });

  it('follows a loose workout', () => {
    expect(inProgressText(session(), [remo], [])).toBe('0 de 3 series');
    expect(inProgressText(session({ currentSlotId: 1 }), [remo], [set(1, 1)])).toBe('Serie 2 de 3 · Remo · 35 kg');
    const all = [set(1, 1), set(1, 2), set(1, 3)];
    expect(inProgressText(session(), [remo], all)).toBe('Ejercicio completado');
    const press = slot(2, 'Press', 1);
    expect(inProgressText(session(), [remo, press], [...all, set(2, 4)])).toBe('Ejercicios completados');
  });

  it('keeps «Rutina completada» for a routine', () => {
    expect(completedLabel(session({ routineId: 1 }), [remo])).toBe('Rutina completada');
    const all = [set(1, 1), set(1, 2), set(1, 3)];
    expect(inProgressText(session({ routineId: 1, routineName: 'Día 1' }), [remo], all)).toBe('Rutina completada');
  });

  it('says it is warming up, and what comes after', () => {
    const press = slot(2, 'Press');
    const warming = { routineId: 1, warmupStartedAt: 0, warmupEndedAt: null };
    expect(inProgressText(session(warming), [remo, press], [])).toBe('Calentamiento · Siguiente: Remo · 35 kg');
    // An exercise chosen in the list comes next.
    expect(inProgressText(session({ ...warming, currentSlotId: 2 }), [remo, press], [])).toBe('Calentamiento · Siguiente: Press · 35 kg');
    expect(inProgressText(session(warming), [], [])).toBe('Calentamiento');
    // Once it ended, the set as always.
    expect(inProgressText(session({ ...warming, warmupEndedAt: 1, currentSlotId: 1 }), [remo], [])).toBe('Serie 1 de 3 · Remo · 35 kg');
  });
});
