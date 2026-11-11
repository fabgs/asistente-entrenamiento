import { getRandomBytes } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

/**
 * The database is encrypted with SQLCipher (PLAN.md §10). Its key is 256 random bits created on the
 * phone and kept in the Keystore (expo-secure-store): it never leaves it, not even in the copies.
 */
export const DATABASE = 'entreno.db';
const KEY_ITEM = 'database-key';
const ENCRYPTED_COPY = 'entreno-cifrada.db';
// Every plain SQLite file starts like this; an encrypted one starts with random bytes.
const SQLITE_HEADER = 'SQLite format 3\0';

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** A raw key (x'…'): SQLCipher uses it as is, without deriving one from a password on every open. */
export const keyPragma = (key: string) => `PRAGMA key = "x'${key}'"`;
/**
 * Two connections write to the database (the app's and the GPS task's, every second during the
 * sprints): one that finds the other writing waits up to 5 s instead of losing its write.
 */
export const BUSY_TIMEOUT = 'PRAGMA busy_timeout = 5000';

const dbFile = (name: string) => new File(Paths.document, 'SQLite', name);

function isPlainSqlite(file: File): boolean {
  const handle = file.open();
  try {
    return String.fromCharCode(...handle.readBytesSync(16)) === SQLITE_HEADER;
  } finally {
    handle.close();
  }
}

function deleteWithJournals(name: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = dbFile(name + suffix);
    if (file.exists) file.delete();
  }
}

/**
 * Copies a plain database into a new encrypted one (`sqlcipher_export`), checks that it opens with
 * the key and has the same rows, and only then puts it in place of the plain one.
 */
async function encryptExisting(key: string): Promise<void> {
  deleteWithJournals(ENCRYPTED_COPY);
  const target = `${SQLite.defaultDatabaseDirectory}/${ENCRYPTED_COPY}`;
  const plain = await SQLite.openDatabaseAsync(DATABASE, { useNewConnection: true });
  let version: number;
  let rows: number;
  try {
    version = (await plain.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
    rows = (await plain.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM set_log'))?.n ?? 0;
    // In a SQL string the x'…' of the key needs its quotes doubled.
    await plain.execAsync(`ATTACH DATABASE '${target}' AS cifrada KEY 'x''${key}'''`);
    await plain.execAsync(`SELECT sqlcipher_export('cifrada'); PRAGMA cifrada.user_version = ${version}; DETACH DATABASE cifrada;`);
  } finally {
    await plain.closeAsync();
  }

  const check = await SQLite.openDatabaseAsync(ENCRYPTED_COPY, { useNewConnection: true });
  try {
    await check.execAsync(keyPragma(key));
    const copied = await check.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const copiedRows = await check.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM set_log');
    if (copied?.user_version !== version || copiedRows?.n !== rows) throw new Error('La copia cifrada no coincide');
  } finally {
    await check.closeAsync();
  }
  deleteWithJournals(DATABASE);
  dbFile(ENCRYPTED_COPY).move(dbFile(DATABASE));
}

async function prepare(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(KEY_ITEM);
  const file = dbFile(DATABASE);
  // An empty file (a first start cut short) is as good as none.
  if (file.exists && file.size === 0) deleteWithJournals(DATABASE);
  const plain = file.exists && isPlainSqlite(file);
  if (stored && !plain) return stored;

  const key = stored ?? toHex(getRandomBytes(32));
  if (!stored) await SecureStore.setItemAsync(KEY_ITEM, key);
  if (!file.exists) return key;
  if (!plain) {
    // Encrypted with a key this phone no longer has: put it aside and start empty (restore a copy).
    file.move(dbFile(`entreno-ilegible-${Date.now()}.db`));
    deleteWithJournals(DATABASE);
    return key;
  }
  try {
    await encryptExisting(key);
    return key;
  } catch (e) {
    // The plain database is untouched: keep using it and try again on the next start.
    console.warn('Could not encrypt the database', e);
    deleteWithJournals(ENCRYPTED_COPY);
    return null;
  }
}

let prepared: Promise<string | null> | null = null;

/** The key to open the database with (null: still plain), after encrypting an old plain one. */
export function prepareDatabase(): Promise<string | null> {
  prepared ??= prepare();
  return prepared;
}

/** A connection of its own (the GPS task), already unlocked. */
export async function openDatabaseInBackground(): Promise<SQLite.SQLiteDatabase> {
  const key = await prepareDatabase();
  const db = await SQLite.openDatabaseAsync(DATABASE, { useNewConnection: true });
  if (key) await db.execAsync(keyPragma(key));
  // The app's own connection writes too (a tap, the laps): wait for it instead of failing with «database is locked».
  await db.execAsync(BUSY_TIMEOUT);
  return db;
}
