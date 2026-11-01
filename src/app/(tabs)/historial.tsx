import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { AppText, Card, Chip, Loading, Row, Screen } from '@/components/ui';
import { listFinishedSessions } from '@/db/repositories/sessions';
import { formatDuration } from '@/domain/format';
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
            <AppText variant="muted" style={{ textTransform: 'capitalize' }}>
              {format(new Date(s.startedAt), "EEEE d 'de' MMMM", { locale: es })} · {s.setCount} series
              {s.finishedAt && !s.imported ? ` · ${formatDuration(s.finishedAt - s.startedAt)}` : ''}
            </AppText>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
