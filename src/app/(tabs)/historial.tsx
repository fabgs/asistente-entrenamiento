import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { RouteThumbnail } from '@/components/RouteMap';
import { AppText, Card, Chip, Icon, Loading, Row, Screen } from '@/components/ui';
import { cardioHistory, exercisesWithHistory } from '@/db/repositories/progress';
import { listFinishedSessions } from '@/db/repositories/sessions';
import { formatDuration, formatKg, formatLongDate, formatShortDate } from '@/domain/format';
import { decodeRoute } from '@/domain/gps';
import { parseLocalDate } from '@/domain/schedule';
import { useLoader } from '@/hooks/data';
import { colors } from '@/theme';

type HistoryView = 'entrenos' | 'ejercicios' | 'cardio';

const VIEWS: { key: HistoryView; label: string }[] = [
  { key: 'entrenos', label: 'Entrenos' },
  { key: 'ejercicios', label: 'Ejercicios' },
  { key: 'cardio', label: 'Cardio' },
];

export default function HistoryScreen() {
  const [view, setView] = useState<HistoryView>('entrenos');
  const { data } = useLoader(async (db) => ({
    sessions: await listFinishedSessions(db),
    exercises: await exercisesWithHistory(db),
    cardio: await cardioHistory(db),
  }));

  if (!data) return <Loading />;

  return (
    <Screen>
      <Row>
        {VIEWS.map((v) => (
          <Chip key={v.key} label={v.label} selected={view === v.key} onPress={() => setView(v.key)} />
        ))}
      </Row>

      {view === 'entrenos' ? (
        <>
          {data.sessions.length === 0 ? <AppText variant="muted">Aún no hay entrenamientos terminados.</AppText> : null}
          {data.sessions.map((s) => (
            <Pressable key={s.id} onPress={() => router.push(`/workout/resumen/${s.id}`)}>
              <Card>
                <Row between>
                  <AppText variant="heading" style={{ flex: 1 }}>
                    {s.routineName ?? 'Entrenamiento'}
                  </AppText>
                  {s.imported ? <Chip label="Excel" /> : null}
                </Row>
                <AppText variant="muted">
                  {formatLongDate(new Date(s.startedAt))} · {s.setCount} series
                  {s.finishedAt && !s.imported ? ` · ${formatDuration(s.finishedAt - s.startedAt)}` : ''}
                </AppText>
              </Card>
            </Pressable>
          ))}
        </>
      ) : null}

      {view === 'ejercicios' ? (
        <>
          {data.exercises.length === 0 ? <AppText variant="muted">Aún no hay ejercicios con historial.</AppText> : null}
          {data.exercises.map((e) => (
            <Pressable key={e.id} onPress={() => router.push(`/progreso/${e.id}`)}>
              <Card>
                <AppText variant="heading">{e.name}</AppText>
                <AppText variant="muted">
                  {e.sessions} {e.sessions === 1 ? 'sesión' : 'sesiones'} · última el {formatShortDate(e.lastDate)}
                  {e.topWeightKg ? ` · máx. ${formatKg(e.topWeightKg)}` : ''}
                </AppText>
              </Card>
            </Pressable>
          ))}
        </>
      ) : null}

      {view === 'cardio' ? (
        <>
          {data.cardio.length === 0 ? (
            <AppText variant="muted">Cuando marques el cardio como hecho en Hoy, aparecerá aquí.</AppText>
          ) : null}
          {data.cardio.map((day) => (
            <Card key={day.date}>
              <AppText variant="heading">{formatLongDate(parseLocalDate(day.date))}</AppText>
              {day.activities.map((a, i) => (
                <Pressable
                  key={i}
                  disabled={a.sessionId === null}
                  onPress={() => router.push(`/cardio-sesion/${a.sessionId}`)}>
                  <Row style={{ flexWrap: 'nowrap', minHeight: a.route ? 64 : undefined }}>
                    <Icon name="check" size={18} color={colors.primary} />
                    <AppText variant="muted" style={{ flex: 1 }}>
                      {a.name}
                      {a.value ? ` · ${a.value}` : ''}
                    </AppText>
                    {a.route ? <RouteThumbnail segments={decodeRoute(a.route)} /> : null}
                    {a.sessionId !== null ? <Icon name="chevron-right" size={20} color={colors.muted} /> : null}
                  </Row>
                </Pressable>
              ))}
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
