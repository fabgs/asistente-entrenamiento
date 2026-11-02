import type { Db, SqlValue } from '../db';
import { MIGRATIONS, migrate } from '../migrations';

interface NodeStatement {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
}
interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
}

/** In-memory database for tests, backed by Node's built-in SQLite; `upTo` stops at an older schema. */
export async function createTestDb({ upTo }: { upTo?: number } = {}): Promise<Db> {
  // getBuiltinModule bypasses Jest's resolver, which does not know node:sqlite.
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as {
    DatabaseSync: new (path: string) => NodeDatabase;
  };
  const raw = new DatabaseSync(':memory:');
  const db: Db = {
    async execAsync(source) {
      raw.exec(source);
    },
    async runAsync(source, ...params) {
      const r = raw.prepare(source).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getAllAsync<T>(source: string, ...params: SqlValue[]) {
      return raw.prepare(source).all(...params) as T[];
    },
    async getFirstAsync<T>(source: string, ...params: SqlValue[]) {
      return (raw.prepare(source).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(task) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  if (upTo === undefined) {
    await migrate(db);
  } else {
    for (let version = 0; version < upTo; version++) {
      await db.execAsync(MIGRATIONS[version]);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    }
  }
  return db;
}
