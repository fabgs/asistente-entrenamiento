import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { AppText, Card, Chip, Loading, Row, Screen } from '@/components/ui';
import { listFinishedSessions } from '@/db/repositories/sessions';
import { formatDuration, formatLongDate } from '@/domain/format';
import { useLoader } from '@/hooks/data';

export default function HistoryScreen() {
  const { data } = useLoader((db) => listFinishedSessions(db));

  if (!data) return <Loading />;

  return (
    <Screen>
      {data.length === 0 ? <AppText variant="muted">Aún no hay entrenamientos terminados.</AppText> : null}
      {data.map((s) => (
        <Pressable key={s.id} onPress={() => router.push(`/workout/resumen/${s.id}`)}>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
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
    </Screen>
  );
}
