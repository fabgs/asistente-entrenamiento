import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Db } from '@/db/db';

export function useDb(): Db {
  return useSQLiteContext();
}

/**
 * Loads data every time the screen gains focus or the app returns to the foreground (e.g. after
 * granting a permission in Android settings). `reload` refreshes it after a write and resolves
 * once the new data is in state. Screens with route params are separate instances per param.
 */
export function useLoader<T>(load: (db: Db) => Promise<T>) {
  const db = useDb();
  const [data, setData] = useState<T>();
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(async () => {
    setData(await loadRef.current(db));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      reload();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') reload();
      });
      return () => sub.remove();
    }, [reload]),
  );
  return { data, reload };
}

/** Current time, refreshed every `intervalMs` while mounted. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
