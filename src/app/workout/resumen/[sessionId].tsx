import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { showDialog } from '@/components/Dialog';
import { RecommendationBox } from '@/components/Recommendation';
import { AppText, Button, Card, Chip, Loading, Row, Screen, Stat, StatRow, Stepper } from '@/components/ui';
import { getSlot, isBodyweight, slotRule, type Slot } from '@/db/repositories/routines';
import {
  deleteFinishedSession,
  deleteSet,
  getSession,
  listSets,
  refreshRecommendations,
  slotHistory,
  updateSetReps,
  updateSetWeight,
  type SetLog,
} from '@/db/repositories/sessions';
import { getSettings, toProgressionSettings } from '@/db/repositories/settings';
import { applyChange, listChangesForSession } from '@/db/repositories/weightChanges';
import { formatDuration, formatKg, formatLoad, formatLongDate, formatNumber } from '@/domain/format';
import { recommend } from '@/domain/progression';
import { useDb, useLoader } from '@/hooks/data';
import { spacing } from '@/theme';

export default function SummaryScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const id = Number(sessionId);
  const db = useDb();
  const [editing, setEditing] = useState(false);

  const { data, reload } = useLoader(async (db) => {
    const session = await getSession(db, id);
    if (!session) return null;
    const sets = await listSets(db, id);
    const settings = await getSettings(db);
    const progression = toProgressionSettings(settings);
    // Grouped from the sets themselves, so exercises removed from the routine still show up.
    const slots: Slot[] = [];
    for (const slotId of [...new Set(sets.map((s) => s.slotId))]) {
      const slot = slotId === null ? null : await getSlot(db, slotId);
      if (slot) slots.push(slot);
    }
    const keepReasons = new Map<number, string>();
    for (const slot of slots) {
      const history = await slotHistory(db, slot.id, 12);
      const from = history.findIndex((h) => h.sessionId === id);
      if (from >= 0) {
        keepReasons.set(slot.id, recommend(slotRule(slot), slot.exerciseIncrementKg, history.slice(from), progression).reason);
      }
    }
    return {
      session,
      sets,
      slots,
      keepReasons,
      progression,
      defaultIncrement: settings.defaultIncrementKg,
      changes: await listChangesForSession(db, id),
    };
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
  const finished = session.status === 'finished';
  const pending = changes.filter((c) => c.status === 'pending');
  const volume = sets.reduce((sum, s) => sum + (s.weightKg ?? 0) * s.reps, 0);
  const duration = session.finishedAt ? formatDuration(session.finishedAt - session.startedAt) : '—';

  const applyAll = async () => {
    for (const c of pending) await applyChange(db, c.id);
    reload();
  };

  const afterEdit = async () => {
    await refreshRecommendations(db, id, data.progression);
    await reload();
  };

  const removeSession = () =>
    showDialog('Borrar entrenamiento', 'Se borrarán todas sus series. No se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await deleteFinishedSession(db, id);
          if (router.canGoBack()) router.back();
          else router.replace('/');
        },
      },
    ]);

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">{session.routineName ?? 'Entrenamiento'}</AppText>
        <AppText variant="muted">
          {formatLongDate(new Date(session.startedAt))}
          {session.imported ? ' · importado del Excel' : ''}
        </AppText>
      </View>

      <StatRow>
        <Stat label="Duración" value={duration} />
        <Stat label="Series" value={String(sets.length)} />
        <Stat label="Volumen" value={`${formatNumber(volume, 0)} kg`} />
      </StatRow>

      {finished ? (
        <Button
          kind={editing ? 'primary' : 'secondary'}
          title={editing ? 'Terminar de corregir' : 'Corregir series'}
          onPress={() => setEditing(!editing)}
        />
      ) : null}

      {pending.length > 1 && !editing ? (
        <Button title={`Aplicar todas las recomendaciones (${pending.length})`} onPress={applyAll} />
      ) : null}

      {slots.map((slot) => {
        const slotSets = sets.filter((s) => s.slotId === slot.id);
        // The latest live recommendation; an expired one only explains a past decision.
        const change = changes.filter((c) => c.slotId === slot.id && c.status !== 'expired').at(-1);
        return (
          <Card key={slot.id}>
            <Row between>
              <AppText variant="heading" style={{ flex: 1 }}>
                {slot.exerciseName}
              </AppText>
              <Button kind="ghost" title="Progreso" onPress={() => router.push(`/progreso/${slot.exerciseId}`)} />
            </Row>
            {editing ? (
              <SetEditorList
                slot={slot}
                sets={slotSets}
                increment={slot.incrementKg ?? slot.exerciseIncrementKg ?? data.defaultIncrement}
                onChanged={afterEdit}
              />
            ) : (
              <>
                <AppText variant="muted">
                  {formatLoad(slotSets[0]?.weightKg ?? null, isBodyweight(slot))} · {slotSets.map((s) => s.reps).join(' · ')}
                </AppText>
                {change ? (
                  <RecommendationBox change={change} onChanged={reload} />
                ) : (
                  <AppText variant="small">= {data.keepReasons.get(slot.id) ?? 'Sin cambio de peso'}</AppText>
                )}
              </>
            )}
          </Card>
        );
      })}

      {editing ? (
        <>
          <AppText variant="small">
            Al corregir, la recomendación de peso de esta sesión se recalcula (salvo que ya la hubieras aplicado o haya
            una sesión más reciente de ese ejercicio).
          </AppText>
          <Button kind="danger" title="Borrar este entrenamiento" onPress={removeSession} />
        </>
      ) : (
        <Button
          big
          kind="secondary"
          title="Cerrar"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      )}
    </Screen>
  );
}

function SetEditorList({
  slot,
  sets,
  increment,
  onChanged,
}: {
  slot: Slot;
  sets: SetLog[];
  increment: number;
  onChanged: () => void;
}) {
  const db = useDb();
  const [open, setOpen] = useState<number | null>(null);
  const [reps, setReps] = useState(0);
  const [weight, setWeight] = useState(0);
  const bodyweight = isBodyweight(slot);

  const edit = (set: SetLog) => {
    setOpen(set.id);
    setReps(set.reps);
    setWeight(set.weightKg ?? 0);
  };

  const save = async (set: SetLog) => {
    await updateSetReps(db, set.id, reps);
    const newWeight = bodyweight && weight === 0 ? null : weight;
    if (newWeight !== set.weightKg) await updateSetWeight(db, set.id, newWeight);
    setOpen(null);
    onChanged();
  };

  const remove = async (set: SetLog) => {
    await deleteSet(db, set.id);
    setOpen(null);
    onChanged();
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Row>
        {sets.map((s) => (
          <Chip
            key={s.id}
            label={`S${s.setIndex}: ${s.reps}${s.weightKg ? ` × ${formatKg(s.weightKg)}` : ''}`}
            selected={open === s.id}
            onPress={() => (open === s.id ? setOpen(null) : edit(s))}
          />
        ))}
      </Row>
      {sets
        .filter((s) => s.id === open)
        .map((s) => (
          <View key={s.id} style={{ gap: spacing.sm }}>
            <AppText variant="small">Repeticiones</AppText>
            <Stepper value={reps} onChange={setReps} min={0} />
            <AppText variant="small">{bodyweight ? 'Lastre' : 'Peso'}</AppText>
            <Stepper decimal value={weight} onChange={setWeight} step={increment} format={formatKg} />
            <Row>
              <Button title="Guardar" onPress={() => save(s)} disabled={reps <= 0} />
              <Button kind="danger" title="Borrar serie" onPress={() => remove(s)} />
            </Row>
          </View>
        ))}
      {sets.length === 0 ? <AppText variant="small">Sin series.</AppText> : null}
    </View>
  );
}

