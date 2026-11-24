import type { BackupLink } from '../backupLink';
import { dataFingerprint, newerCopyMessage, syncDecision, whenText } from '../sync';

const ours = (sha: string | null, more: Partial<BackupLink> = {}): BackupLink => ({ sha, uploadedBefore: true, hasData: true, ...more });

describe('the fingerprint of the data (1.5.6)', () => {
  const tables = {
    settings: [{ id: 1, rest_seconds_default: 150, last_backup_at: 1, last_backup_error: null, cardio_chart: 'pace' }],
    workout_session: [{ id: 1, date: '2026-11-24' }],
  };

  it('is the same for the same data and changes with any change', () => {
    expect(dataFingerprint(tables)).toBe(dataFingerprint(structuredClone(tables)));
    expect(dataFingerprint({ ...tables, workout_session: [{ id: 1, date: '2026-11-25' }] })).not.toBe(dataFingerprint(tables));
    expect(dataFingerprint({ ...tables, settings: [{ ...tables.settings[0], rest_seconds_default: 120 }] })).not.toBe(dataFingerprint(tables));
  });

  it('does not count the time of the last copy nor how the phone shows things', () => {
    const uploaded = { ...tables, settings: [{ ...tables.settings[0], last_backup_at: 99, last_backup_error: 'sin red', cardio_chart: 'speed' }] };
    expect(dataFingerprint(uploaded)).toBe(dataFingerprint(tables));
  });

  it('copes with a copy without settings', () => {
    expect(dataFingerprint({ workout_session: [] })).toMatch(/^[0-9a-f]+$/);
  });
});

describe('what to do when the app opens (1.5.6)', () => {
  it('does nothing with its own copy, none, or one already declined', () => {
    expect(syncDecision('a', ours('a'), null, true)).toBe('none');
    expect(syncDecision(null, ours('a'), null, false)).toBe('none');
    expect(syncDecision('b', ours('a'), 'b', false)).toBe('none');
  });

  it('offers the copy of another phone, or lets the user choose when both changed', () => {
    expect(syncDecision('b', ours('a'), null, false)).toBe('offer');
    expect(syncDecision('b', ours('a'), null, true)).toBe('conflict');
    // Declining one copy does not decline the next.
    expect(syncDecision('c', ours('a'), 'b', false)).toBe('offer');
  });

  it('offers it to a new or reset phone, which comes from no copy', () => {
    expect(syncDecision('b', ours('', { uploadedBefore: false, hasData: false }), null, false)).toBe('offer');
  });

  it('leaves alone a phone from before 1.5.3 that was already uploading', () => {
    expect(syncDecision('b', ours(null), null, true)).toBe('none');
  });
});

describe('the question (1.5.6)', () => {
  const now = new Date(2026, 10, 24, 21, 0);

  it('says when the other copy was made', () => {
    expect(whenText(new Date(2026, 10, 24, 20, 15).getTime(), now)).toBe('hoy a las 20:15');
    expect(whenText(new Date(2026, 10, 23, 9, 3).getTime(), now)).toBe('ayer a las 9:03');
    expect(whenText(new Date(2026, 10, 2, 9, 3).getTime(), now)).toBe('el 2/11 a las 9:03');
    // Across a month.
    expect(whenText(new Date(2026, 10, 30, 23, 50).getTime(), new Date(2026, 11, 1, 8, 0))).toBe('ayer a las 23:50');
  });

  it('asks to bring it, or says what each choice loses', () => {
    const at = new Date(2026, 10, 24, 20, 15).getTime();
    expect(newerCopyMessage('offer', at, now, 'tiene 377 entrenos')).toBe(
      'La subió otro móvil hoy a las 20:15 y tiene 377 entrenos. ¿Traer sus datos a este móvil?',
    );
    expect(newerCopyMessage('conflict', at, now, 'tiene 377 entrenos')).toMatch(/^La subió otro móvil hoy a las 20:15 y tiene 377 entrenos\. Este móvil también tiene cambios/);
  });
});
