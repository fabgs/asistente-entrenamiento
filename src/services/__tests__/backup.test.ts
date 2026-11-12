import type { Db } from '@/db/db';
import { createTestDb } from '@/db/__tests__/testDb';
import { DEMO_SEED } from '@/db/demoSeed';
import { getBackupLink, setBackupLink } from '@/db/repositories/backupLink';
import { getSettings, updateSettings } from '@/db/repositories/settings';
import { importSeed } from '@/db/seed';
import { SEED } from '@/db/seedData';
import {
  backupToGithub,
  downloadFromGithub,
  foreignCopyInGithub,
  ForeignCopyError,
  githubToken,
  maybeAutoBackup,
  openBackup,
  resetToSeed,
  restoreFrom,
} from '../backup';

jest.mock('expo-application', () => ({ getLastUpdateTimeAsync: async () => new Date(0) }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();
  return {
    getItemAsync: async (key: string) => items.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => void items.set(key, value),
    deleteItemAsync: async (key: string) => void items.delete(key),
  };
});
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: class {
    exists = false;
    uri = 'file:///cache/copy.json';
    private text = '';
    create() {}
    delete() {}
    async write(text: string) {
      this.text = text;
    }
    async base64() {
      return Buffer.from(this.text, 'utf8').toString('base64');
    }
  },
}));
jest.mock('../backupCipher', () => ({
  appKit: {},
  backupKeyStore: { get: async () => null, set: jest.fn(), clear: jest.fn() },
}));
jest.mock('../dailyReminder', () => ({ rescheduleDailyReminders: jest.fn() }));
jest.mock('../notifications', () => ({ resetNotifications: jest.fn() }));

/** The file of the private repo: every upload replaces it and gives it a new sha. */
const github = { text: null as string | null, sha: null as string | null, uploads: 0 };

const respond = (status: number, body?: unknown) =>
  ({ ok: status < 300, status, json: async () => body, text: async () => String(body) }) as Response;

beforeEach(() => {
  Object.assign(github, { text: null, sha: null, uploads: 0 });
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body as string) as { content: string; sha?: string };
      if ((body.sha ?? null) !== github.sha) return respond(409);
      github.uploads++;
      github.text = Buffer.from(body.content, 'base64').toString('utf8');
      github.sha = `sha-${github.uploads}`;
      return respond(200, { content: { sha: github.sha } });
    }
    if (github.text === null) return respond(404);
    const raw = (init?.headers as Record<string, string>).Accept.includes('raw');
    return respond(200, raw ? github.text : { sha: github.sha });
  }) as unknown as typeof fetch;
});

const DAY = 24 * 60 * 60 * 1000;
const NOV_11 = new Date(2026, 10, 11, 8, 56);
const NOV_12 = new Date(2026, 10, 12, 21, 2);

const count = async (db: Db, table: string) =>
  (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;

const sessionsInGithub = () =>
  (JSON.parse(github.text!) as { tables: { workout_session: unknown[] } }).tables.workout_session.length;

async function configure(db: Db): Promise<Db> {
  await updateSettings(db, { backupOwner: 'yo', backupRepo: 'entreno-backup' });
  await githubToken.set('tok');
  return db;
}

/** The phone with the user's data, already uploading its copies with 1.5.3. */
async function usedPhone(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, DEMO_SEED, NOV_11);
  await configure(db);
  await backupToGithub(db, NOV_11);
  return db;
}

/** A phone just installed (what `_layout` does on the first start), given the GitHub settings. */
async function newPhone(): Promise<Db> {
  const db = await createTestDb();
  await importSeed(db, SEED, NOV_12);
  await setBackupLink(db, null);
  return configure(db);
}

describe('a new phone and the copy in GitHub (2026-11-12)', () => {
  it('does not upload its empty data over the good copy, on its own or when a password is set', async () => {
    const old = await usedPhone();
    const sessions = await count(old, 'workout_session');
    expect(sessions).toBeGreaterThan(0);
    const good = github.sha;

    const db = await newPhone();
    await maybeAutoBackup(db, NOV_12);
    // What the password screen does after keeping the key.
    await expect(backupToGithub(db, NOV_12)).rejects.toThrow(ForeignCopyError);

    expect(github.sha).toBe(good);
    expect(sessionsInGithub()).toBe(sessions);
    const settings = await getSettings(db);
    expect(settings.lastBackupAt).toBeNull();
    expect(settings.lastBackupError).toContain('no salió de este móvil');
    expect(await foreignCopyInGithub(db)).toBe(true);
  });

  it('restores it and from then on uploads over it', async () => {
    const old = await usedPhone();
    const sessions = await count(old, 'workout_session');

    const db = await newPhone();
    const copy = await downloadFromGithub(db);
    expect(copy.sha).toBe('sha-1');
    await restoreFrom(db, await openBackup(copy.text), copy.sha);
    expect(await count(db, 'workout_session')).toBe(sessions);
    expect((await getBackupLink(db)).sha).toBe('sha-1');
    expect(await foreignCopyInGithub(db)).toBe(false);

    await maybeAutoBackup(db, new Date(NOV_12.getTime() + 2 * DAY));
    expect(github.sha).toBe('sha-2');
    expect(sessionsInGithub()).toBe(sessions);
    expect((await getBackupLink(db)).sha).toBe('sha-2');
    expect((await getSettings(db)).lastBackupError).toBeNull();
  });

  it('uploads over it only if the user says so', async () => {
    await usedPhone();
    const db = await newPhone();
    await backupToGithub(db, NOV_12, true);
    expect(github.sha).toBe('sha-2');
    expect(sessionsInGithub()).toBe(0);
    // Now that copy is its own.
    await backupToGithub(db, new Date(NOV_12.getTime() + DAY));
    expect(github.sha).toBe('sha-3');
  });

  it('uploads freely to a repository without a copy', async () => {
    const db = await newPhone();
    await maybeAutoBackup(db, NOV_12);
    expect(github.sha).toBe('sha-1');
    expect((await getBackupLink(db)).sha).toBe('sha-1');
  });
});

describe('other ways of losing the good copy', () => {
  it('a reset: the emptied phone does not upload until it restores', async () => {
    const db = await usedPhone();
    const sessions = await count(db, 'workout_session');
    await resetToSeed(db, NOV_12, SEED);
    await maybeAutoBackup(db, new Date(NOV_12.getTime() + 2 * DAY));
    expect(github.sha).toBe('sha-1');
    expect(sessionsInGithub()).toBe(sessions);

    const copy = await downloadFromGithub(db);
    await restoreFrom(db, await openBackup(copy.text), copy.sha);
    await maybeAutoBackup(db, new Date(NOV_12.getTime() + 3 * DAY));
    expect(github.sha).toBe('sha-2');
    expect(sessionsInGithub()).toBe(sessions);
  });

  it('two phones: the one left behind does not replace what the other uploaded since', async () => {
    const old = await usedPhone();
    const db = await newPhone();
    const copy = await downloadFromGithub(db);
    await restoreFrom(db, await openBackup(copy.text), copy.sha);
    await backupToGithub(db, NOV_12);
    expect(github.sha).toBe('sha-2');

    await maybeAutoBackup(old, new Date(NOV_12.getTime() + 2 * DAY));
    expect(github.sha).toBe('sha-2');
    expect((await getSettings(old)).lastBackupError).toContain('no salió de este móvil');
  });
});

describe('a phone updated from before 1.5.3, which never kept which copy was its own', () => {
  async function updatedPhone(seed: typeof SEED, lastBackupAt: number | null): Promise<Db> {
    const db = await createTestDb();
    await importSeed(db, seed, NOV_11);
    await configure(db);
    await updateSettings(db, { lastBackupAt });
    return db;
  }

  it('goes on uploading if it has data and was already doing it', async () => {
    await usedPhone();
    const db = await updatedPhone(DEMO_SEED, NOV_11.getTime());
    await maybeAutoBackup(db, NOV_12);
    expect(github.sha).toBe('sha-2');
    expect((await getBackupLink(db)).sha).toBe('sha-2');
  });

  it('stops if it is empty: the new phone of 2026-11-12 updated before restoring', async () => {
    await usedPhone();
    const db = await updatedPhone(SEED, NOV_11.getTime());
    await maybeAutoBackup(db, NOV_12);
    expect(github.sha).toBe('sha-1');
  });

  it('stops if it has never uploaded', async () => {
    await usedPhone();
    const db = await updatedPhone(DEMO_SEED, null);
    await maybeAutoBackup(db, NOV_12);
    expect(github.sha).toBe('sha-1');
  });
});
