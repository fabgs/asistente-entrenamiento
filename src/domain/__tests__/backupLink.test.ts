import { copyContents, mayReplaceCopy, type BackupLink } from '../backupLink';

const link = (over: Partial<BackupLink>): BackupLink => ({ sha: '', uploadedBefore: false, hasData: false, ...over });

describe('mayReplaceCopy', () => {
  it('uploads freely when GitHub has no copy yet', () => {
    expect(mayReplaceCopy(null, link({}))).toBe(true);
    expect(mayReplaceCopy(null, link({ sha: 'abc', hasData: true }))).toBe(true);
    expect(mayReplaceCopy(null, link({ sha: null }))).toBe(true);
  });

  it('replaces the copy this phone uploaded or restored last', () => {
    expect(mayReplaceCopy('abc', link({ sha: 'abc', uploadedBefore: true, hasData: true }))).toBe(true);
  });

  it('does not replace a copy another phone uploaded since', () => {
    expect(mayReplaceCopy('def', link({ sha: 'abc', uploadedBefore: true, hasData: true }))).toBe(false);
  });

  // 2026-11-12: a new phone was given the GitHub settings and its empty data went over the good copy.
  it('never replaces a copy from a new phone or after a reset', () => {
    expect(mayReplaceCopy('abc', link({ sha: '' }))).toBe(false);
    // Not even once it has data of its own: it is still not the data of that copy.
    expect(mayReplaceCopy('abc', link({ sha: '', hasData: true }))).toBe(false);
    // A reset keeps when the last copy was uploaded.
    expect(mayReplaceCopy('abc', link({ sha: '', uploadedBefore: true }))).toBe(false);
  });

  describe('a phone from before 1.5.3, which kept no sha', () => {
    it('goes on if it was already uploading its data', () => {
      expect(mayReplaceCopy('abc', link({ sha: null, uploadedBefore: true, hasData: true }))).toBe(true);
    });

    it('stops if it is empty, even having uploaded (the new phone of 2026-11-12, updated before restoring)', () => {
      expect(mayReplaceCopy('abc', link({ sha: null, uploadedBefore: true, hasData: false }))).toBe(false);
    });

    it('stops if it has never uploaded: the copy is from another phone', () => {
      expect(mayReplaceCopy('abc', link({ sha: null, uploadedBefore: false, hasData: true }))).toBe(false);
    });
  });
});

describe('copyContents', () => {
  it('says an empty copy is empty', () => {
    expect(copyContents(0, 0)).toBe('no tiene ningún entreno ni cardio');
  });

  it('counts workouts and cardio sessions', () => {
    expect(copyContents(373, 8)).toBe('tiene 373 entrenos y 8 sesiones de cardio');
    expect(copyContents(1, 1)).toBe('tiene 1 entreno y 1 sesión de cardio');
    expect(copyContents(12, 0)).toBe('tiene 12 entrenos');
    expect(copyContents(0, 3)).toBe('tiene 3 sesiones de cardio');
  });
});
