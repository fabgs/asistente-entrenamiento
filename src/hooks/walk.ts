import { useEffect } from 'react';
import { getCardioSession, listTrackPoints } from '@/db/repositories/cardioSessions';
import { hintsSeen } from '@/db/repositories/hints';
import { getSettings } from '@/db/repositories/settings';
import { useLoader } from './data';

/**
 * A cardio session with the settings its screens use. While a GPS session is recording, its points
 * come too and everything is read again every 3 s: the background task stores the fixes.
 */
export function useCardioSession(sessionId: number) {
  const { data, reload } = useLoader(async (db) => {
    const session = await getCardioSession(db, sessionId);
    if (!session) return null;
    const recording = session.status === 'in_progress' && session.tracking === 'gps';
    return {
      session,
      points: recording ? await listTrackPoints(db, sessionId) : null,
      settings: await getSettings(db),
      hints: await hintsSeen(db),
    };
  });

  const recording = !!data?.points;
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [recording, reload]);

  return { data, reload };
}
