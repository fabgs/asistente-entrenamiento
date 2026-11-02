import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Redirect, router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { showDialog } from '@/components/Dialog';
import { RecommendationBox, SuggestionLine } from '@/components/Recommendation';
import { AppText, Button, Card, Chip, Icon, Loading, Row, Screen, Stepper } from '@/components/ui';
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
import { getSettings, toProgressionSettings, updateSettings } from '@/db/repositories/settings';
import { listOpenChanges, type WeightChange } from '@/db/repositories/weightChanges';
import { formatCountdown, formatDuration, formatKg, formatLoad, formatTarget } from '@/domain/format';
import type { RepTarget } from '@/domain/types';
import { nextPendingSlot, nextStep, setsDone, type NextStep } from '@/domain/workoutMachine';
import { useDb, useLoader, useNow } from '@/hooks/data';
import { maybeAutoBackup } from '@/services/backup';
import { openOverlaySettings } from '@/services/notifications';
import {
  canDrawOverlays,
  cancelRestEnd,
  restDeadline,
  restIsOver,
  scheduleRestEnd,
  shiftDeadline,
} from '@/services/restTimer';
import { colors, radius, spacing } from '@/theme';

const KEEP_AWAKE_TAG = 'workout';

const setsLabel = (n: number) => (n === 1 ? '1 serie' : `${n} series`);

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
  // Looking at the exercise list while the rest keeps counting.
  const [browsing, setBrowsing] = useState(false);

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
      overlayAllowed: canDrawOverlays(),
      openChanges: await listOpenChanges(db),
    };
  });

  // Back from a set or from the rest shows the exercise list instead of leaving the workout.
  const resting = !!data?.session.restEndsAt;
  const inSet = !resting && data?.session.currentSlotId != null;
  usePreventRemove(data?.session.status === 'in_progress' && ((resting && !browsing) || inSet), () => {
    if (resting) setBrowsing(true);
    else updateSessionState(db, id, { currentSlotId: null }).then(reload);
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
    maybeAutoBackup(db);
  };

  const confirmFinish = () => {
    const left = slots.filter((s) => !skipped.includes(s.id) && setsDone(s.id, sets) < s.sets).length;
    if (left === 0) {
      finish();
      return;
    }
    showDialog(
      '¿Terminar ya?',
      `Te ${left === 1 ? 'queda 1 ejercicio' : `quedan ${left} ejercicios`} sin hacer. Las series que has hecho se guardan igual.`,
      [
        { text: 'Seguir entrenando', style: 'cancel' },
        { text: 'Terminar', onPress: finish },
      ],
    );
  };

  const discard = () =>
    showDialog('¿Descartar el entrenamiento?', 'Se borrarán todas las series de hoy. No se puede deshacer.', [
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

  const chooseSlot = async (slotId: number) => {
    setBrowsing(false);
    const unskipped = skipped.filter((s) => s !== slotId);
    const slot = slots.find((s) => s.id === slotId)!;
    if (session.restEndsAt && !restIsOver(session.restEndsAt) && setsDone(slotId, sets) < slot.sets) {
      // Still resting: the chosen exercise becomes the next one, the rest keeps counting.
      const next = nextStep(planned, sets, unskipped, slotId);
      await scheduleRestEnd(id, session.restEndsAt, describeNext(next, slots), settings.restOverlay).catch(() => null);
      await update({ currentSlotId: slotId, skippedSlotIds: unskipped });
      return;
    }
    if (session.restEndsAt) await cancelRestEnd(id);
    await update({ currentSlotId: slotId, skippedSlotIds: unskipped, restEndsAt: null, restNotificationId: null });
  };

  const completeSet = async (slot: Slot, reps: number) => {
    await logSet(db, id, slot, reps);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const next = nextStep(planned, [...sets, { slotId: slot.id }], skipped, slot.id);
    setBrowsing(false);
    if (next.kind === 'finished') {
      // The list then shows the "Rutina completada" card.
      await update({ currentSlotId: null, restEndsAt: null });
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

  const restNext = nextStep(planned, sets, skipped, session.currentSlotId ?? -1);
  const continueAfterRest = () => {
    setBrowsing(false);
    if (restNext.kind === 'next_set') endRest('same');
    else if (restNext.kind === 'next_exercise') endRest(restNext.slotId);
    else endRest(null).then(confirmFinish);
  };

  if (session.restEndsAt && !browsing) {
    const next = restNext;
    return (
      <>
        {header}
        <RestView
          endsAt={session.restEndsAt}
          next={next}
          nextLabel={describeNext(next, slots)}
          onAdjust={adjustRest}
          onContinue={continueAfterRest}
          onChoose={() => setBrowsing(true)}
          askOverlay={settings.restOverlay && !data.overlayAllowed}
          onGrantOverlay={openOverlaySettings}
          onDeclineOverlay={async () => {
            await updateSettings(db, { restOverlay: false });
            reload();
          }}
        />
      </>
    );
  }

  if (current && !session.restEndsAt) {
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
        rest={
          session.restEndsAt
            ? {
                endsAt: session.restEndsAt,
                nextLabel: describeNext(restNext, slots),
                nextSlotId: restNext.kind === 'finished' ? null : restNext.slotId,
                onOpen: () => setBrowsing(false),
              }
            : null
        }
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
  rest,
  onChoose,
  onFinish,
  onDiscard,
}: {
  session: Session;
  slots: Slot[];
  sets: SetLog[];
  openChanges: WeightChange[];
  rest: { endsAt: number; nextLabel: string; nextSlotId: number | null; onOpen: () => void } | null;
  onChoose: (slotId: number) => void;
  onFinish: () => void;
  onDiscard: () => void;
}) {
  const planned = slots.map((s) => ({ slotId: s.id, sets: s.sets }));
  const pendingId = nextPendingSlot(planned, sets, session.skippedSlotIds, null);
  const allDone = pendingId === null && sets.length > 0;
  const nextId = rest ? rest.nextSlotId : pendingId;
  const elapsed = useNow(30_000) - session.startedAt;
  const doneCount = slots.filter((s) => setsDone(s.id, sets) >= s.sets).length;

  return (
    <Screen>
      {rest ? <RestBanner endsAt={rest.endsAt} nextLabel={rest.nextLabel} onOpen={rest.onOpen} /> : null}

      {allDone ? (
        <Card style={styles.completed}>
          <View style={styles.completedIcon}>
            <Icon name="check-bold" size={34} color={colors.onPrimary} />
          </View>
          <AppText variant="title">Rutina completada</AppText>
          <AppText variant="muted" style={{ textAlign: 'center' }}>
            {doneCount} {doneCount === 1 ? 'ejercicio' : 'ejercicios'} · {setsLabel(sets.length)} · {formatDuration(elapsed)}
          </AppText>
          <Button big title="Terminar y ver resumen" onPress={onFinish} style={{ alignSelf: 'stretch' }} />
          <AppText variant="small" style={{ textAlign: 'center' }}>
            ¿Te falta algo? Toca un ejercicio para hacer una serie extra.
          </AppText>
        </Card>
      ) : (
        <AppText variant="muted">
          {formatDuration(elapsed)} · {sets.length === 1 ? '1 serie hecha' : `${sets.length} series hechas`}
        </AppText>
      )}

      {slots.map((slot) => {
        const done = setsDone(slot.id, sets);
        const complete = done >= slot.sets;
        const skippedSlot = session.skippedSlotIds.includes(slot.id);
        const isNext = slot.id === nextId;
        const change = openChanges.find((c) => c.slotId === slot.id);
        return (
          <Pressable key={slot.id} onPress={() => onChoose(slot.id)}>
            <Card style={[isNext && { borderColor: colors.primary, borderWidth: 2 }, (complete || skippedSlot) && { opacity: 0.6 }]}>
              <Row between>
                {complete ? <Icon name="check-circle" size={22} color={colors.primary} /> : null}
                <AppText variant="heading" style={{ flex: 1 }}>
                  {slot.exerciseName}
                </AppText>
                <Chip label={skippedSlot ? 'Saltado' : `${done}/${slot.sets}`} selected={complete} />
              </Row>
              <AppText variant="muted">
                {formatLoad(slot.weightKg, isBodyweight(slot))} · {formatTarget(slot.target, slot.unit, slot.perSide)}
              </AppText>
              {change && done === 0 ? <SuggestedWeight change={change} /> : null}
            </Card>
          </Pressable>
        );
      })}
      {session.routineId !== null ? (
        <Button
          kind="ghost"
          title="+ Añadir ejercicio a la rutina"
          onPress={() => router.push({ pathname: '/ejercicios', params: { pickFor: String(session.routineId) } })}
        />
      ) : null}
      {!allDone ? <Button big kind="secondary" title="Terminar entrenamiento" onPress={onFinish} /> : null}
      <Button kind="danger" title="Descartar entrenamiento" onPress={onDiscard} />
    </Screen>
  );
}

/** "Sugerido: ↑ 35 kg → 37,5 kg", so the change can be judged without opening the exercise. */
function SuggestedWeight({ change }: { change: WeightChange }) {
  const up = (change.toKg ?? 0) > (change.fromKg ?? 0);
  return (
    <Row style={{ gap: spacing.xs }}>
      <Icon name={up ? 'arrow-up-bold' : 'arrow-down-bold'} size={16} color={up ? colors.up : colors.down} />
      <AppText variant="small" style={{ color: up ? colors.up : colors.down, fontWeight: '700' }}>
        Sugerido: {formatKg(change.fromKg ?? 0)} → {formatKg(change.toKg ?? 0)}
      </AppText>
    </Row>
  );
}

/** The rest still counting while the list is open; tapping it goes back to the timer. */
function RestBanner({ endsAt, nextLabel, onOpen }: { endsAt: number; nextLabel: string; onOpen: () => void }) {
  const remaining = endsAt - useNow(250);
  const over = remaining <= 0;
  return (
    <Pressable onPress={onOpen} style={[styles.restBanner, over && { borderColor: colors.primary }]}>
      <Icon name={over ? 'bell-ring-outline' : 'timer-sand'} size={26} color={over ? colors.primary : colors.text} />
      <View style={{ flex: 1 }}>
        <AppText variant="small">{over ? '¡Descanso terminado!' : 'Descansando'}</AppText>
        <AppText numberOfLines={1}>{nextLabel}</AppText>
      </View>
      <AppText style={[styles.bannerClock, over && { color: colors.primary }]}>{formatCountdown(remaining)}</AppText>
      <Icon name="chevron-right" size={24} color={colors.muted} />
    </Pressable>
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
        <Row between>
          <View style={{ flex: 1 }}>
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

      {/* Two equal bordered buttons, so each one lines up with the cards above. */}
      <Row style={{ flexWrap: 'nowrap' }}>
        <Button kind="secondary" title="Ver ejercicios" onPress={onBack} style={{ flex: 1 }} />
        {done === 0 ? <Button kind="secondary" title="Saltar ejercicio" onPress={onSkip} style={{ flex: 1 }} /> : null}
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
  askOverlay,
  onGrantOverlay,
  onDeclineOverlay,
}: {
  endsAt: number;
  next: NextStep;
  nextLabel: string;
  onAdjust: (deltaSeconds: number) => void;
  onContinue: () => void;
  onChoose: () => void;
  askOverlay: boolean;
  onGrantOverlay: () => void;
  onDeclineOverlay: () => void;
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
    next.kind === 'next_set'
      ? next.setNumber === 1
        ? 'Empezar ejercicio'
        : `Siguiente serie (${next.setNumber})`
      : next.kind === 'next_exercise'
        ? 'Siguiente ejercicio'
        : 'Terminar';

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
      <Button kind="ghost" title={over ? 'Ver ejercicios' : 'Ver ejercicios (el descanso sigue)'} onPress={onChoose} />

      {askOverlay ? (
        <Card style={{ borderColor: colors.accent }}>
          <AppText variant="heading">Burbuja flotante</AppText>
          <AppText variant="muted">
            Para ver el descanso en una burbuja cuando sales de la app, Android necesita el permiso «Mostrar sobre
            otras apps». Si se abre una lista de apps, busca Entreno y permítelo.
          </AppText>
          <Row>
            <Button title="Dar permiso" onPress={onGrantOverlay} />
            <Button kind="ghost" title="No, gracias" onPress={onDeclineOverlay} />
          </Row>
        </Card>
      ) : null}
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
  restBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.cardAlt,
  },
  bannerClock: { color: colors.text, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  completed: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl, borderColor: colors.primary },
  completedIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
