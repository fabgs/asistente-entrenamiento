export type SqlValue = string | number | null;

/**
 * The subset of expo-sqlite's SQLiteDatabase the app uses. Keeping it small lets the
 * repositories run against node:sqlite in Jest (see src/db/__tests__/testDb.ts).
 */
export interface Db {
  execAsync(source: string): Promise<void>;
  runAsync(
    source: string,
    ...params: SqlValue[]
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(source: string, ...params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, ...params: SqlValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export const bool = (value: number | null | undefined): boolean => value === 1;
export const int = (value: boolean): number => (value ? 1 : 0);
