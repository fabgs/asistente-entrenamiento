import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { RecommendationBox } from '@/components/Recommendation';
import { AppText, Button, Card, Loading, Row, Screen } from '@/components/ui';
import { isBodyweight, listSlots, slotRule } from '@/db/repositories/routines';
import { getSession, listSets, slotHistory } from '@/db/repositories/sessions';
import { getSettings, toProgressionSettings } from '@/db/repositories/settings';
import { applyChange, listChangesForSession } from '@/db/repositories/weightChanges';
import { formatDuration, formatLoad, formatNumber } from '@/domain/format';
import { recommend } from '@/domain/progression';
import { useDb, useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

export default function SummaryScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const id = Number(sessionId);
  const db = useDb();

  const { data, reload } = useLoader(async (db) => {
    const session = await getSession(db, id);
    if (!session) return null;
    const sets = await listSets(db, id);
    const settings = toProgressionSettings(await getSettings(db));
    const slots = (session.routineId ? await listSlots(db, session.routineId) : []).filter((s) =>
      sets.some((set) => set.slotId === s.id),
    );
    const keepReasons = new Map<number, string>();
    for (const slot of slots) {
      const history = await slotHistory(db, slot.id, 12);
      const from = history.findIndex((h) => h.sessionId === id);
      if (from >= 0) {
        keepReasons.set(slot.id, recommend(slotRule(slot), slot.exerciseIncrementKg, history.slice(from), settings).reason);
      }
    }
    return { session, sets, slots, keepReasons, changes: await listChangesForSession(db, id) };
  });

  if (data === undefined) return <Loading />;
  if (data === null) {
    return (
      <Screen>
        <AppText>No se encontró esta sesión.</AppText>
      </Screen>
    );
  }

  const { session, sets, slots, changes } = data;
  const pending = changes.filter((c) => c.status === 'pending');
  const volume = sets.reduce((sum, s) => sum + (s.weightKg ?? 0) * s.reps, 0);
  const duration = session.finishedAt ? formatDuration(session.finishedAt - session.startedAt) : '—';

  const applyAll = async () => {
    for (const c of pending) await applyChange(db, c.id);
    reload();
  };

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">{session.routineName ?? 'Entrenamiento'}</AppText>
        <AppText variant="muted" style={{ textTransform: 'capitalize' }}>
          {format(new Date(session.startedAt), "EEEE d 'de' MMMM", { locale: es })}
          {session.imported ? ' · importado del Excel' : ''}
        </AppText>
      </View>

      <Row style={{ justifyContent: 'space-between' }}>
        <Stat label="Duración" value={duration} />
        <Stat label="Series" value={String(sets.length)} />
        <Stat label="Volumen" value={`${formatNumber(volume, 0)} kg`} />
      </Row>

      {pending.length > 1 ? (
        <Button title={`Aplicar todas las recomendaciones (${pending.length})`} onPress={applyAll} />
      ) : null}

      {slots.map((slot) => {
        const slotSets = sets.filter((s) => s.slotId === slot.id);
        const change = changes.find((c) => c.slotId === slot.id);
        return (
          <Card key={slot.id}>
            <AppText variant="heading">{slot.exerciseName}</AppText>
            <AppText variant="muted">
              {formatLoad(slotSets[0]?.weightKg ?? null, isBodyweight(slot))} · {slotSets.map((s) => s.reps).join(' · ')}
            </AppText>
            {change ? (
              <RecommendationBox change={change} onChanged={reload} />
            ) : (
              <AppText variant="small">= {data.keepReasons.get(slot.id) ?? 'Sin cambio de peso'}</AppText>
            )}
          </Card>
        );
      })}

      <Button
        big
        kind="secondary"
        title="Cerrar"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1, alignItems: 'center' }}>
      <AppText variant="small">{label}</AppText>
      <AppText variant="heading" style={{ color: colors.text }}>
        {value}
      </AppText>
    </Card>
  );
}
