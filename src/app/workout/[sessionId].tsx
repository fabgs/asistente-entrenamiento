import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { RecommendationBox, SuggestionLine } from '@/components/Recommendation';
import { AppText, Button, Card, Chip, Loading, Row, Screen, Stepper } from '@/components/ui';
import { isBodyweight, listSlots, type Slot } from '@/db/repositories/routines';
import {
  deleteSet,
  discardSession,
  finishSession,
  getSession,
  lastReps,
  listSets,
  logSet,
  updateSessionState,
  updateSetReps,
  type Session,
  type SetLog,
} from '@/db/repositories/sessions';
import { getSettings, toProgressionSettings } from '@/db/repositories/settings';
import { listOpenChanges, type WeightChange } from '@/db/repositories/weightChanges';
import { formatCountdown, formatLoad, formatTarget } from '@/domain/format';
import type { RepTarget } from '@/domain/types';
import { nextPendingSlot, nextStep, setsDone, type NextStep } from '@/domain/workoutMachine';
import { useDb, useLoader, useNow } from '@/hooks/data';
import { cancelRestEnd, restDeadline, scheduleRestEnd, shiftDeadline } from '@/services/restTimer';
import { colors, radius, spacing } from '@/theme';

const KEEP_AWAKE_TAG = 'workout';

function defaultReps(target: RepTarget): number {
  if (target.kind === 'range') return target.min;
  if (target.kind === 'fixed') return target.reps;
  return 10;
}

function describeNext(next: NextStep, slots: Slot[]): string {
  if (next.kind === 'finished') return 'Rutina completada';
  const slot = slots.find((s) => s.id === next.slotId)!;
  const load = formatLoad(slot.weightKg, isBodyweight(slot));
  return next.kind === 'next_set'
    ? `Serie ${next.setNumber}/${slot.sets} · ${slot.exerciseName} · ${load}`
    : `Siguiente ejercicio: ${slot.exerciseName} · ${load}`;
}

export default function WorkoutScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const id = Number(sessionId);
  const db = useDb();
  const [later, setLater] = useState<number[]>([]);

  const { data, reload } = useLoader(async (db) => {
    const session = await getSession(db, id);
    if (!session) return null;
    const slots = session.routineId ? await listSlots(db, session.routineId) : [];
    const lastBySlot = new Map<number, number[]>();
    for (const s of slots) lastBySlot.set(s.id, await lastReps(db, s.id));
    return {
      session,
      slots,
      lastBySlot,
      sets: await listSets(db, id),
      settings: await getSettings(db),
      openChanges: await listOpenChanges(db),
    };
  });

  const keepAwake = data?.settings.keepAwake ?? false;
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [keepAwake]);

  if (data === undefined) return <Loading />;
  if (data === null) {
    return (
      <Screen>
        <AppText>No se encontró este entrenamiento.</AppText>
      </Screen>
    );
  }

  const { session, slots, sets, settings } = data;
  if (session.status !== 'in_progress') return <Redirect href={`/workout/resumen/${id}`} />;

  const planned = slots.map((s) => ({ slotId: s.id, sets: s.sets }));
  const skipped = session.skippedSlotIds;
  const current = slots.find((s) => s.id === session.currentSlotId) ?? null;

  const update = async (patch: Parameters<typeof updateSessionState>[2]) => {
    await updateSessionState(db, id, patch);
    await reload();
  };

  const finish = async () => {
    await cancelRestEnd(id);
    await finishSession(db, id, toProgressionSettings(settings));
    router.replace(`/workout/resumen/${id}`);
  };

  const confirmFinish = () => {
    const left = slots.filter((s) => !skipped.includes(s.id) && setsDone(s.id, sets) < s.sets).length;
    if (left === 0) {
      finish();
      return;
    }
    Alert.alert('Terminar entrenamiento', `Quedan ${left} ejercicios sin completar.`, [
      { text: 'Seguir entrenando', style: 'cancel' },
      { text: 'Terminar', onPress: finish },
    ]);
  };

  const discard = () =>
    Alert.alert('Descartar entrenamiento', 'Se borrarán todas las series de esta sesión.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          await cancelRestEnd(id);
          await discardSession(db, id);
          router.replace('/');
        },
      },
    ]);

  const chooseSlot = (slotId: number) =>
    update({ currentSlotId: slotId, skippedSlotIds: skipped.filter((s) => s !== slotId) });

  const completeSet = async (slot: Slot, reps: number) => {
    await logSet(db, id, slot, reps);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const next = nextStep(planned, [...sets, { slotId: slot.id }], skipped, slot.id);
    if (next.kind === 'finished') {
      await update({ currentSlotId: null, restEndsAt: null });
      Alert.alert('¡Rutina completada!', '¿Terminar el entrenamiento?', [
        { text: 'Ahora no', style: 'cancel' },
        { text: 'Terminar', onPress: finish },
      ]);
      return;
    }
    const endsAt = restDeadline(slot.restSeconds ?? settings.restSecondsDefault);
    let notificationId: string | null = null;
    try {
      notificationId = await scheduleRestEnd(id, endsAt, describeNext(next, slots), settings.restOverlay);
    } catch (e) {
      console.warn('Could not schedule rest alarm', e);
    }
    await update({ restEndsAt: endsAt, restNotificationId: notificationId });
  };

  const adjustRest = async (deltaSeconds: number) => {
    if (!session.restEndsAt) return;
    const endsAt = shiftDeadline(session.restEndsAt, deltaSeconds);
    const next = nextStep(planned, sets, skipped, session.currentSlotId ?? -1);
    await scheduleRestEnd(id, endsAt, describeNext(next, slots), settings.restOverlay).catch(() => null);
    await update({ restEndsAt: endsAt });
  };

  const endRest = async (goToSlot: number | null | 'same') => {
    await cancelRestEnd(id);
    await update({
      restEndsAt: null,
      restNotificationId: null,
      ...(goToSlot === 'same' ? {} : { currentSlotId: goToSlot }),
    });
  };

  const header = <Stack.Screen options={{ title: session.routineName ?? 'Entrenando' }} />;

  if (session.restEndsAt) {
    const next = nextStep(planned, sets, skipped, session.currentSlotId ?? -1);
    return (
      <>
        {header}
        <RestView
          endsAt={session.restEndsAt}
          next={next}
          nextLabel={describeNext(next, slots)}
          onAdjust={adjustRest}
          onContinue={() => {
            if (next.kind === 'next_set') endRest('same');
            else if (next.kind === 'next_exercise') endRest(next.slotId);
            else endRest(null).then(confirmFinish);
          }}
          onChoose={() => endRest(null)}
        />
      </>
    );
  }

  if (current) {
    const change = data.openChanges.find((c) => c.slotId === current.id);
    const slotSets = sets.filter((s) => s.slotId === current.id);
    return (
      <>
        {header}
        <SetView
          key={`${current.id}-${slotSets.length}`}
          slot={current}
          slotSets={slotSets}
          last={data.lastBySlot.get(current.id) ?? []}
          change={change}
          askNow={change?.status === 'pending' && slotSets.length === 0 && !later.includes(current.id)}
          onLater={() => setLater([...later, current.id])}
          onChanged={reload}
          onComplete={(reps) => completeSet(current, reps)}
          onUpdateSet={async (setId, reps) => {
            await updateSetReps(db, setId, reps);
            reload();
          }}
          onDeleteSet={async (setId) => {
            await deleteSet(db, setId);
            reload();
          }}
          onBack={() => update({ currentSlotId: null })}
          onSkip={() => update({ currentSlotId: null, skippedSlotIds: [...skipped, current.id] })}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <ExerciseList
        session={session}
        slots={slots}
        sets={sets}
        openChanges={data.openChanges}
        onChoose={chooseSlot}
        onFinish={confirmFinish}
        onDiscard={discard}
      />
    </>
  );
}

function ExerciseList({
  session,
  slots,
  sets,
  openChanges,
  onChoose,
  onFinish,
  onDiscard,
}: {
  session: Session;
  slots: Slot[];
  sets: SetLog[];
  openChanges: WeightChange[];
  onChoose: (slotId: number) => void;
  onFinish: () => void;
  onDiscard: () => void;
}) {
  const planned = slots.map((s) => ({ slotId: s.id, sets: s.sets }));
  const nextId = nextPendingSlot(planned, sets, session.skippedSlotIds, null);
  const allDone = nextId === null;
  const minutes = Math.floor((useNow(30_000) - session.startedAt) / 60000);

  return (
    <Screen>
      <AppText variant="muted">
        {minutes} min · {sets.length} series hechas
      </AppText>
      {slots.map((slot) => {
        const done = setsDone(slot.id, sets);
        const complete = done >= slot.sets;
        const skippedSlot = session.skippedSlotIds.includes(slot.id);
        const isNext = slot.id === nextId;
        return (
          <Pressable key={slot.id} onPress={() => onChoose(slot.id)}>
            <Card style={[isNext && { borderColor: colors.primary, borderWidth: 2 }, (complete || skippedSlot) && { opacity: 0.6 }]}>
              <Row style={{ justifyContent: 'space-between' }}>
                <AppText variant="heading" style={{ flex: 1 }}>
                  {complete ? '✓ ' : ''}
                  {slot.exerciseName}
                </AppText>
                <Chip label={skippedSlot ? 'Saltado' : `${done}/${slot.sets}`} selected={complete} />
              </Row>
              <AppText variant="muted">
                {formatLoad(slot.weightKg, isBodyweight(slot))} · {formatTarget(slot.target, slot.unit, slot.perSide)}
              </AppText>
              {openChanges.some((c) => c.slotId === slot.id) && done === 0 ? (
                <AppText variant="small" style={{ color: colors.warning }}>
                  Tiene una sugerencia de peso
                </AppText>
              ) : null}
            </Card>
          </Pressable>
        );
      })}
      <Button big kind={allDone ? 'primary' : 'secondary'} title="Terminar entrenamiento" onPress={onFinish} />
      <Button kind="danger" title="Descartar entrenamiento" onPress={onDiscard} />
    </Screen>
  );
}

function SetView({
  slot,
  slotSets,
  last,
  change,
  askNow,
  onLater,
  onChanged,
  onComplete,
  onUpdateSet,
  onDeleteSet,
  onBack,
  onSkip,
}: {
  slot: Slot;
  slotSets: SetLog[];
  last: number[];
  change?: WeightChange;
  askNow: boolean;
  onLater: () => void;
  onChanged: () => void;
  onComplete: (reps: number) => void;
  onUpdateSet: (setId: number, reps: number) => void;
  onDeleteSet: (setId: number) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const done = slotSets.length;
  const setNumber = done + 1;
  const [reps, setReps] = useState(last[done] ?? last[last.length - 1] ?? defaultReps(slot.target));
  const [editing, setEditing] = useState<SetLog | null>(null);
  const [editReps, setEditReps] = useState(0);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onComplete(reps);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">{slot.exerciseName}</AppText>
        <AppText variant="heading" style={{ color: setNumber > slot.sets ? colors.warning : colors.primary }}>
          {setNumber > slot.sets ? `Serie extra ${setNumber}` : `Serie ${setNumber} de ${slot.sets}`}
        </AppText>
      </View>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <AppText variant="small">Peso</AppText>
            <AppText variant="heading">{formatLoad(slot.weightKg, isBodyweight(slot))}</AppText>
          </View>
          <Button kind="ghost" title="Editar peso" onPress={() => router.push(`/slot/${slot.id}`)} />
        </Row>
        <AppText variant="muted">Objetivo: {formatTarget(slot.target, slot.unit, slot.perSide)}</AppText>
        {slot.note ? <AppText variant="small">{slot.note}</AppText> : null}
        {last.length > 0 ? <AppText variant="small">Última vez: {last.join(' · ')}</AppText> : null}
      </Card>

      {change && askNow ? (
        <RecommendationBox title="Recomendación para hoy" change={change} onChanged={onChanged} onLater={onLater} />
      ) : change ? (
        <SuggestionLine change={change} onChanged={onChanged} />
      ) : null}

      {editing ? (
        <Card>
          <AppText variant="heading">Corregir serie {editing.setIndex}</AppText>
          <Stepper big value={editReps} onChange={setEditReps} />
          <Row>
            <Button
              title="Guardar"
              onPress={() => {
                onUpdateSet(editing.id, editReps);
                setEditing(null);
              }}
            />
            <Button
              kind="danger"
              title="Borrar serie"
              onPress={() => {
                onDeleteSet(editing.id);
                setEditing(null);
              }}
            />
            <Button kind="ghost" title="Cancelar" onPress={() => setEditing(null)} />
          </Row>
        </Card>
      ) : (
        <Card style={{ gap: spacing.lg }}>
          <AppText variant="muted" style={{ textAlign: 'center' }}>
            Repeticiones{slot.perSide ? ' por lado' : ''}
          </AppText>
          <Stepper big value={reps} onChange={setReps} />
          <Button big title="Serie hecha" onPress={submit} disabled={saving || reps <= 0} />
        </Card>
      )}

      {slotSets.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <AppText variant="small">Series hechas (toca para corregir)</AppText>
          <Row>
            {slotSets.map((s) => (
              <Chip
                key={s.id}
                label={`S${s.setIndex}: ${s.reps}`}
                onPress={() => {
                  setEditing(s);
                  setEditReps(s.reps);
                }}
              />
            ))}
          </Row>
        </View>
      ) : null}

      <Row>
        <Button kind="secondary" title="Ver ejercicios" onPress={onBack} />
        {done === 0 ? <Button kind="ghost" title="Saltar ejercicio" onPress={onSkip} /> : null}
      </Row>
    </Screen>
  );
}

function RestView({
  endsAt,
  next,
  nextLabel,
  onAdjust,
  onContinue,
  onChoose,
}: {
  endsAt: number;
  next: NextStep;
  nextLabel: string;
  onAdjust: (deltaSeconds: number) => void;
  onContinue: () => void;
  onChoose: () => void;
}) {
  const now = useNow(250);
  const remaining = endsAt - now;
  const over = remaining <= 0;
  const buzzed = useRef(false);

  useEffect(() => {
    if (over && !buzzed.current) {
      buzzed.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [over]);

  const continueLabel =
    next.kind === 'next_set' ? `Siguiente serie (${next.setNumber})` : next.kind === 'next_exercise' ? 'Siguiente ejercicio' : 'Terminar';

  return (
    <Screen>
      <View style={[styles.restBox, over && { borderColor: colors.primary }]}>
        <AppText variant="muted">{over ? '¡Descanso terminado!' : 'Descanso'}</AppText>
        <AppText style={[styles.countdown, over && { color: colors.primary }]}>{formatCountdown(remaining)}</AppText>
        {!over ? (
          <Row style={{ justifyContent: 'center' }}>
            <Button kind="secondary" title="−30 s" onPress={() => onAdjust(-30)} />
            <Button kind="secondary" title="+30 s" onPress={() => onAdjust(30)} />
          </Row>
        ) : null}
      </View>

      <Card>
        <AppText variant="small">A continuación</AppText>
        <AppText variant="heading">{nextLabel}</AppText>
      </Card>

      <Button big kind={over ? 'primary' : 'secondary'} title={over ? continueLabel : `Saltar descanso · ${continueLabel}`} onPress={onContinue} />
      <Button kind="ghost" title="Elegir otro ejercicio" onPress={onChoose} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  restBox: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  countdown: { color: colors.text, fontSize: 96, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
