import type { Db } from '@/db/db';
import { createTestDb } from '@/db/__tests__/testDb';
import { DEMO_SEED } from '@/db/demoSeed';
import { getBackupLink, setBackupLink } from '@/db/repositories/backupLink';
import { getSettings, logWeight, updateSettings } from '@/db/repositories/settings';
import { importSeed } from '@/db/seed';
import { SEED } from '@/db/seedData';
import { startSession } from '@/db/repositories/sessions';
import {
  backupToGithub,
  bringNewerCopy,
  checkNewerCopy,
  declineNewerCopy,
  downloadFromGithub,
  foreignCopyInGithub,
  ForeignCopyError,
  githubToken,
  hasLocalChanges,
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

    // Nothing changed since: nothing to upload (1.5.6). A weigh-in later, it uploads.
    await maybeAutoBackup(db, new Date(NOV_12.getTime() + 2 * DAY));
    expect(github.sha).toBe('sha-1');
    await logWeight(db, '2026-11-14', 83.5);
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

  it('uploads freely to a repository without a copy, once it has something of the user', async () => {
    const db = await newPhone();
    await maybeAutoBackup(db, NOV_12);
    expect(github.sha).toBeNull();
    await logWeight(db, '2026-11-12', 84);
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
    await logWeight(db, '2026-11-15', 83);
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

    await logWeight(old, '2026-11-14', 83);
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

describe('two phones with the same data (1.5.6)', () => {
  const MIN = 60 * 1000;
  const NOV_24 = new Date(2026, 10, 24, 20, 15);
  const later = (minutes: number) => new Date(NOV_24.getTime() + minutes * MIN);

  /** The phone of the user, and a second one that restored its copy. */
  async function twoPhones(): Promise<{ android: Db; iphone: Db }> {
    const android = await usedPhone();
    const iphone = await newPhone();
    const copy = await downloadFromGithub(iphone);
    await restoreFrom(iphone, await openBackup(copy.text), copy.sha);
    return { android, iphone };
  }

  it('uploads only what changed, at most every 10 minutes unless a workout or a cardio has just ended', async () => {
    const db = await usedPhone();
    expect(github.uploads).toBe(1);
    expect(await hasLocalChanges(db)).toBe(false);
    // The time of the last copy is not a change of the data.
    expect((await getSettings(db)).lastBackupAt).toBe(NOV_11.getTime());
    await maybeAutoBackup(db, later(0), { force: true });
    expect(github.uploads).toBe(1);

    await logWeight(db, '2026-11-24', 83.4);
    expect(await hasLocalChanges(db)).toBe(true);
    await maybeAutoBackup(db, later(0));
    expect(github.uploads).toBe(2);
    expect(await hasLocalChanges(db)).toBe(false);

    await logWeight(db, '2026-11-24', 83.2);
    await maybeAutoBackup(db, later(5));
    expect(github.uploads).toBe(2);
    await maybeAutoBackup(db, later(5), { force: true });
    expect(github.uploads).toBe(3);
    await logWeight(db, '2026-11-24', 83.0);
    await maybeAutoBackup(db, later(16));
    expect(github.uploads).toBe(4);
  });

  it('a phone that restored the copy has nothing to offer or to upload', async () => {
    const { iphone } = await twoPhones();
    expect(await hasLocalChanges(iphone)).toBe(false);
    expect(await checkNewerCopy(iphone)).toBeNull();
  });

  it('offers the copy the other phone uploaded, and brings it', async () => {
    const { android, iphone } = await twoPhones();
    await logWeight(iphone, '2026-11-24', 82.9);
    await maybeAutoBackup(iphone, later(0), { force: true });
    expect(github.sha).toBe('sha-2');

    const copy = await checkNewerCopy(android);
    expect(copy).toMatchObject({ kind: 'offer', sha: 'sha-2', exportedAt: later(0).getTime() });
    expect(copy!.contents).toMatch(/^tiene \d+ entrenos/);
    await bringNewerCopy(android, copy!);
    expect(await db1Weight(android)).toBe(82.9);
    expect((await getBackupLink(android)).sha).toBe('sha-2');
    expect(await hasLocalChanges(android)).toBe(false);
    expect(await checkNewerCopy(android)).toBeNull();
    // And back: what the Android phone does next reaches the iPhone the same way.
    await logWeight(android, '2026-11-25', 82.7);
    await maybeAutoBackup(android, later(30));
    expect((await checkNewerCopy(iphone))?.kind).toBe('offer');
  });

  it('lets the user choose when both phones changed, and «Ahora no» waits for the next copy', async () => {
    const { android, iphone } = await twoPhones();
    await logWeight(iphone, '2026-11-24', 82.9);
    await maybeAutoBackup(iphone, later(0), { force: true });
    await logWeight(android, '2026-11-24', 84.1);

    const copy = await checkNewerCopy(android);
    expect(copy?.kind).toBe('conflict');
    await declineNewerCopy(android, copy!);
    expect(await checkNewerCopy(android)).toBeNull();
    // Its own change does not go up over the other's copy on its own.
    await maybeAutoBackup(android, later(20));
    expect(github.sha).toBe('sha-2');

    await logWeight(iphone, '2026-11-25', 82.8);
    await maybeAutoBackup(iphone, later(30));
    expect((await checkNewerCopy(android))?.kind).toBe('conflict');

    // «Subir la de este»: now the iPhone is offered the Android phone's copy. It has nothing left to
    // upload (its changes went up with its copy), so it is a plain offer: what the user chose loses
    // the iPhone's changes, as the question said.
    await backupToGithub(android, later(40), true);
    expect((await checkNewerCopy(iphone))?.kind).toBe('offer');
  });

  it('asks nothing while a workout is in progress', async () => {
    const { android, iphone } = await twoPhones();
    await logWeight(iphone, '2026-11-24', 82.9);
    await maybeAutoBackup(iphone, later(0), { force: true });
    const routine = await android.getFirstAsync<{ id: number }>('SELECT id FROM routine LIMIT 1');
    await startSession(android, routine!.id, later(1));
    expect(await checkNewerCopy(android)).toBeNull();
  });
});

async function db1Weight(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ weight_kg: number }>('SELECT weight_kg FROM weight_log ORDER BY date DESC LIMIT 1'))!.weight_kg;
}
