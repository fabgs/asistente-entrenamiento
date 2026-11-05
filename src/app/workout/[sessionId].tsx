import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Redirect, router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { showActions, showDialog, showSnackbar } from '@/components/Dialog';
import { SuggestionAction, SuggestionLine } from '@/components/Recommendation';
import { Ring } from '@/components/Ring';
import { Sheet } from '@/components/Sheet';
import {
  AddRow,
  AppText,
  BottomBar,
  Button,
  Card,
  EmptyState,
  ExerciseIcon,
  HeaderActions,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  Loading,
  ProgressBar,
  ROW_ICON_INSET,
  Row,
  RowIcon,
  Screen,
  Stepper,
  Tag,
  Value,
} from '@/components/ui';
import { allExerciseMuscles } from '@/db/repositories/muscles';
import { getRoutine, isBodyweight, type Slot } from '@/db/repositories/routines';
import {
  deleteSet,
  discardSession,
  finishSession,
  getSession,
  lastReps,
  lastWarmups,
  listSets,
  logSet,
  logWarmupSet,
  restoreSet,
  sessionSlots,
  updateSessionState,
  updateSetReps,
  updateSetWeight,
  type Session,
  type SetLog,
} from '@/db/repositories/sessions';
import { getSettings, toProgressionSettings, updateSettings } from '@/db/repositories/settings';
import {
  applyChange,
  listOpenChanges,
  setSlotWeightManually,
  undoChange,
  type WeightChange,
} from '@/db/repositories/weightChanges';
import {
  capitalizeFirst,
  formatCountdown,
  formatKg,
  formatLoad,
  formatMinutes,
  formatNumber,
  formatTarget,
  spokenTarget,
} from '@/domain/format';
import type { ExerciseMuscles } from '@/domain/muscles';
import type { RepTarget } from '@/domain/types';
import { warmupProposal, type WarmupSet } from '@/domain/warmup';
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
import { clearWorkoutInProgress, completedLabel, describeNext, showWorkoutInProgress } from '@/services/workoutInProgress';
import { colors, maxFontScale, radius, spacing, type } from '@/theme';

const KEEP_AWAKE_TAG = 'workout';
/** The set cells are 48 dp high: their texts grow less with the system font. */
const CELL_MAX_SCALE = 1.15;

const setsLabel = (n: number) => (n === 1 ? '1 serie' : `${n} series`);

function defaultReps(target: RepTarget): number {
  if (target.kind === 'range') return target.min;
  if (target.kind === 'fixed') return target.reps;
  return 10;
}

const restSecondsOf = (slot: Slot | undefined, fallback: number) => slot?.restSeconds ?? fallback;

export default function WorkoutScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const id = Number(sessionId);
  const db = useDb();
  // Looking at the exercise list while the rest keeps counting.
  const [browsing, setBrowsing] = useState(false);

  const { data, reload } = useLoader(async (db) => {
    const session = await getSession(db, id);
    if (!session) return null;
    const sets = await listSets(db, id);
    const slots = await sessionSlots(db, session, sets);
    // A loose workout borrows its exercises from routines: «Cambiar peso» says which one it changes.
    const routineNames = new Map<number, string>();
    if (session.routineId === null) {
      for (const routineId of new Set(slots.map((s) => s.routineId))) {
        const routine = await getRoutine(db, routineId);
        if (routine) routineNames.set(routineId, routine.name);
      }
    }
    const lastBySlot = new Map<number, number[]>();
    const warmupsBySlot = new Map<number, WarmupSet[]>();
    for (const s of slots) {
      lastBySlot.set(s.id, await lastReps(db, s.id));
      warmupsBySlot.set(s.id, await lastWarmups(db, s.id));
    }
    return {
      session,
      slots,
      lastBySlot,
      warmupsBySlot,
      routineNames,
      muscles: await allExerciseMuscles(db),
      sets,
      settings: await getSettings(db),
      overlayAllowed: canDrawOverlays(),
      openChanges: await listOpenChanges(db),
    };
  });

  // Back from a set or from the rest shows the exercise list instead of leaving the workout.
  const resting = !!data?.session.restEndsAt;
  const inSet = !resting && data?.session.currentSlotId != null;
  // A loose workout with nothing done yet is dropped on the way out: there is nothing to keep.
  const [leaving, setLeaving] = useState(false);
  const emptyLoose = data?.session.routineId === null && data.sets.length === 0;
  usePreventRemove(!leaving && data?.session.status === 'in_progress' && ((resting && !browsing) || inSet), () => {
    if (resting) setBrowsing(true);
    else if (emptyLoose) {
      clearWorkoutInProgress();
      discardSession(db, id).then(() => setLeaving(true));
    } else updateSessionState(db, id, { currentSlotId: null }).then(reload);
  });
  useEffect(() => {
    if (!leaving) return;
    if (router.canGoBack()) router.back();
    else router.dismissTo('/');
  }, [leaving]);

  const keepAwake = data?.settings.keepAwake ?? false;
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [keepAwake]);

  // Every change of the workout updates its notification, which takes the user back here.
  useEffect(() => {
    if (data?.session.status === 'in_progress') showWorkoutInProgress(data.session, data.slots, data.sets);
  }, [data]);

  if (data === undefined) return <Loading />;
  if (data === null) {
    return <EmptyState icon="dumbbell" title="No se encontró este entreno" text="Puede que se descartara." />;
  }

  const { session, slots, sets, settings } = data;
  if (session.status !== 'in_progress') return <Redirect href={`/workout/resumen/${id}`} />;

  const planned = slots.map((s) => ({ slotId: s.id, sets: s.sets }));
  const skipped = session.skippedSlotIds;
  const current = slots.find((s) => s.id === session.currentSlotId) ?? null;
  const loose = session.routineId === null;
  const done = completedLabel(session, slots);

  const update = async (patch: Parameters<typeof updateSessionState>[2]) => {
    await updateSessionState(db, id, patch);
    await reload();
  };

  const finish = async () => {
    clearWorkoutInProgress();
    await cancelRestEnd(id);
    const result = await finishSession(db, id, toProgressionSettings(settings));
    if (result === 'discarded') router.dismissTo('/');
    else router.replace(`/workout/resumen/${id}?nuevo=1`);
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
      `Te ${left === 1 ? 'queda 1 ejercicio' : `quedan ${left} ejercicios`} sin hacer. Las series hechas se guardan igual.`,
      [
        { text: 'Terminar', onPress: finish },
        { text: 'Seguir entrenando', style: 'cancel' },
      ],
    );
  };

  const discard = () =>
    showDialog('¿Descartar el entreno?', 'Se borran todas las series de hoy y no se puede deshacer.', [
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          clearWorkoutInProgress();
          await cancelRestEnd(id);
          await discardSession(db, id);
          router.dismissTo('/');
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);

  const chooseSlot = async (slotId: number) => {
    setBrowsing(false);
    const unskipped = skipped.filter((s) => s !== slotId);
    const slot = slots.find((s) => s.id === slotId)!;
    if (session.restEndsAt && !restIsOver(session.restEndsAt) && setsDone(slotId, sets) < slot.sets) {
      // Still resting: the chosen exercise becomes the next one, the rest keeps counting.
      const next = nextStep(planned, sets, unskipped, slotId);
      await scheduleRestEnd(id, session.restEndsAt, describeNext(next, slots, done), settings.restOverlay).catch(() => null);
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
    const endsAt = restDeadline(restSecondsOf(slot, settings.restSecondsDefault));
    let notificationId: string | null = null;
    try {
      notificationId = await scheduleRestEnd(id, endsAt, describeNext(next, slots, done), settings.restOverlay);
    } catch (e) {
      console.warn('Could not schedule rest alarm', e);
    }
    await update({ restEndsAt: endsAt, restNotificationId: notificationId });
  };

  const adjustRest = async (deltaSeconds: number) => {
    if (!session.restEndsAt) return;
    const endsAt = shiftDeadline(session.restEndsAt, deltaSeconds);
    const next = nextStep(planned, sets, skipped, session.currentSlotId ?? -1);
    await scheduleRestEnd(id, endsAt, describeNext(next, slots, done), settings.restOverlay).catch(() => null);
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

  const restNext = nextStep(planned, sets, skipped, session.currentSlotId ?? -1);
  const continueAfterRest = () => {
    setBrowsing(false);
    if (restNext.kind === 'next_set') endRest('same');
    else if (restNext.kind === 'next_exercise') endRest(restNext.slotId);
    else endRest(null).then(confirmFinish);
  };

  // Corrections never touch the rest: its countdown and alarm go on.
  const correctSet = async (set: SetLog, reps: number, weightKg?: number | null) => {
    await updateSetReps(db, set.id, reps);
    if (weightKg !== undefined) await updateSetWeight(db, set.id, weightKg);
    reload();
  };
  const removeSet = async (set: SetLog) => {
    await deleteSet(db, set.id);
    reload();
    showSnackbar(set.isWarmup ? 'Aproximación borrada' : 'Serie borrada', {
      label: 'Deshacer',
      onPress: async () => {
        await restoreSet(db, set);
        reload();
      },
    });
  };

  const title = session.routineName ?? 'Ejercicio suelto';

  if (session.restEndsAt && !browsing) {
    const restSlot = slots.find((s) => s.id === session.currentSlotId);
    const nextSlot = restNext.kind === 'finished' ? null : (slots.find((s) => s.id === restNext.slotId) ?? null);
    const lastSet = sets.filter((s) => !s.isWarmup).reduce<SetLog | null>((a, b) => (a && a.completedAt > b.completedAt ? a : b), null);
    return (
      <>
        <Stack.Screen options={{ title, headerRight: undefined }} />
        <RestView
          endsAt={session.restEndsAt}
          totalSeconds={restSecondsOf(restSlot, settings.restSecondsDefault)}
          next={restNext}
          nextSlot={nextSlot}
          nextMuscles={nextSlot ? data.muscles.get(nextSlot.exerciseId) : undefined}
          nextSlotDone={nextSlot ? setsDone(nextSlot.id, sets) : 0}
          lastSet={lastSet}
          lastSlot={lastSet ? slots.find((s) => s.id === lastSet.slotId) : undefined}
          onCorrect={correctSet}
          onDelete={removeSet}
          onAdjust={adjustRest}
          onContinue={continueAfterRest}
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
    const slotSets = sets.filter((s) => s.slotId === current.id && !s.isWarmup);
    const warmups = sets.filter((s) => s.slotId === current.id && s.isWarmup);
    const skip = async () => {
      await update({ currentSlotId: null, skippedSlotIds: [...skipped, current.id] });
      showSnackbar('Ejercicio saltado', {
        label: 'Deshacer',
        onPress: () => update({ currentSlotId: current.id, skippedSlotIds: skipped.filter((s) => s !== current.id) }),
      });
    };
    return (
      <SetView
        key={`${current.id}-${slotSets.length}`}
        title={title}
        slot={current}
        slotSets={slotSets}
        warmups={warmups}
        lastWarmups={data.warmupsBySlot.get(current.id) ?? []}
        increment={current.incrementKg ?? current.exerciseIncrementKg ?? settings.defaultIncrementKg}
        last={data.lastBySlot.get(current.id) ?? []}
        change={data.openChanges.find((c) => c.slotId === current.id)}
        onChanged={reload}
        onComplete={(reps) => completeSet(current, reps)}
        onWarmup={async (weightKg, reps) => {
          await logWarmupSet(db, id, current, weightKg, reps);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          reload();
        }}
        onCorrect={correctSet}
        onDelete={removeSet}
        onWeight={async (kg) => {
          await setSlotWeightManually(db, current.id, kg);
          reload();
        }}
        onSkip={skip}
        canSkip={!loose}
        weightNote={loose ? `también en «${data.routineNames.get(current.routineId) ?? 'su rutina'}»` : 'también para las próximas sesiones'}
      />
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <HeaderActions>
              <IconButton
                icon="dots-vertical"
                label="Más acciones"
                onPress={() =>
                  showActions([{ text: 'Descartar entreno', icon: 'trash-can-outline', destructive: true, onPress: discard }])
                }
              />
            </HeaderActions>
          ),
        }}
      />
      <ExerciseList
        session={session}
        slots={slots}
        sets={sets}
        openChanges={data.openChanges}
        completedTitle={done}
        rest={
          session.restEndsAt
            ? {
                endsAt: session.restEndsAt,
                totalSeconds: restSecondsOf(slots.find((s) => s.id === session.currentSlotId), settings.restSecondsDefault),
                nextLabel: describeNext(restNext, slots, done),
                onOpen: () => setBrowsing(false),
              }
            : null
        }
        onChoose={chooseSlot}
        onFinish={confirmFinish}
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
  completedTitle,
  onChoose,
  onFinish,
}: {
  session: Session;
  slots: Slot[];
  sets: SetLog[];
  openChanges: WeightChange[];
  /** «Rutina completada», «Ejercicio completado» or «Ejercicios completados». */
  completedTitle: string;
  rest: { endsAt: number; totalSeconds: number; nextLabel: string; onOpen: () => void } | null;
  onChoose: (slotId: number) => void;
  onFinish: () => void;
}) {
  const planned = slots.map((s) => ({ slotId: s.id, sets: s.sets }));
  const nextId = nextPendingSlot(planned, sets, session.skippedSlotIds, null);
  const working = sets.filter((s) => !s.isWarmup).length;
  const allDone = nextId === null && working > 0;
  const elapsed = useNow(30_000) - session.startedAt;
  const doneCount = slots.filter((s) => setsDone(s.id, sets) >= s.sets).length;
  const totalSets = slots.reduce((sum, s) => sum + s.sets, 0);
  const nextSlot = slots.find((s) => s.id === nextId);

  const footer = (
    <BottomBar actionKey={rest ? 'rest' : allDone ? 'done' : nextSlot ? `next-${nextSlot.id}` : 'finish'}>
      {rest ? (
        <RestBar {...rest} />
      ) : allDone ? (
        <Button size="xl" icon="flag-checkered" title="Terminar y ver resumen" onPress={onFinish} style={{ flex: 1 }} />
      ) : nextSlot ? (
        <Button
          size="xl"
          icon="play"
          title={`${setsDone(nextSlot.id, sets) > 0 ? 'Seguir' : 'Empezar'} · ${nextSlot.exerciseName}`}
          onPress={() => onChoose(nextSlot.id)}
          style={{ flex: 1 }}
        />
      ) : (
        <Button size="xl" icon="flag-checkered" title="Terminar entreno" onPress={onFinish} style={{ flex: 1 }} />
      )}
    </BottomBar>
  );

  return (
    <Screen footer={footer}>
      {allDone ? (
        <Card style={styles.completed}>
          <View style={styles.completedIcon}>
            <Icon name="check-bold" size={34} color={colors.onPrimary} />
          </View>
          <AppText variant="title">{completedTitle}</AppText>
          <AppText variant="secondary" style={{ textAlign: 'center' }}>
            {doneCount} {doneCount === 1 ? 'ejercicio' : 'ejercicios'} · {setsLabel(working)} · {formatMinutes(elapsed)}
          </AppText>
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <AppText variant="bodySm" tabular style={{ color: colors.muted }}>
            {formatMinutes(elapsed)} · {working} de {totalSets} series
          </AppText>
          <ProgressBar progress={working / Math.max(1, totalSets)} />
        </View>
      )}

      <ListGroup>
        {slots.map((slot) => {
          const done = setsDone(slot.id, sets);
          const complete = done >= slot.sets;
          const skippedSlot = session.skippedSlotIds.includes(slot.id);
          const warmupCount = sets.filter((s) => s.slotId === slot.id && s.isWarmup).length;
          const change = openChanges.find((c) => c.slotId === slot.id);
          const quiet = complete || skippedSlot;
          return (
            <ListRow
              key={slot.id}
              onPress={() => onChoose(slot.id)}
              chevron={false}
              left={complete ? <Icon name="check-circle" size={22} color={colors.primary} /> : null}
              title={
                <View style={styles.rowTitle}>
                  <AppText variant="rowTitle" style={[{ flexShrink: 1 }, quiet && { color: colors.muted }]} numberOfLines={2}>
                    {slot.exerciseName}
                  </AppText>
                  {slot.id === nextId && !rest ? <Tag label="Siguiente" tone="success" /> : null}
                  {skippedSlot ? <Tag label="Saltado" /> : null}
                </View>
              }
              subtitle={
                <View>
                  <AppText variant="secondary" numberOfLines={1}>
                    {formatLoad(slot.weightKg, isBodyweight(slot), slot.exercisePair)} · {formatTarget(slot.target, slot.unit, slot.perSide)}
                    {warmupCount > 0 ? ` · ${warmupCount} aprox.` : ''}
                  </AppText>
                  {change && done === 0 ? <SuggestionLine change={change} readOnly /> : null}
                </View>
              }
              right={<SetDots done={done} total={slot.sets} />}
            />
          );
        })}
        {session.routineId !== null ? (
          <AddRow
            title="Añadir ejercicio a la rutina"
            onPress={() => router.push({ pathname: '/ejercicios', params: { pickFor: String(session.routineId) } })}
          />
        ) : !rest ? (
          <AddRow
            title="Añadir otro ejercicio"
            onPress={() => router.push({ pathname: '/ejercicio-suelto', params: { sesion: String(session.id) } })}
          />
        ) : null}
      </ListGroup>
      {!allDone && working > 0 ? <Button size="lg" kind="secondary" title="Terminar entreno" onPress={onFinish} /> : null}
    </Screen>
  );
}

/** One dot per set (filled when done); with more than five, "2/3". */
function SetDots({ done, total }: { done: number; total: number }) {
  if (total > 5 || done > total) {
    return (
      <AppText variant="control" tabular weight="600">
        {`${done}/${total}`}
      </AppText>
    );
  }
  return (
    <View style={styles.dots} accessible accessibilityLabel={`${done} de ${total} series`}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dot, i < done && styles.dotDone]} />
      ))}
    </View>
  );
}

/** The rest still counting while the list is open; tapping it goes back to the timer. */
function RestBar({ endsAt, totalSeconds, nextLabel, onOpen }: { endsAt: number; totalSeconds: number; nextLabel: string; onOpen: () => void }) {
  const remaining = endsAt - useNow(250);
  const over = remaining <= 0;
  const ink = over ? colors.primary : colors.text;
  return (
    <Pressable
      onPress={onOpen}
      style={[styles.restBar, over && { backgroundColor: colors.primaryTint }]}
      accessibilityRole="button"
      accessibilityLabel={over ? 'Descanso terminado' : `Descanso, quedan ${formatCountdown(remaining)}`}
      accessibilityHint="Vuelve al descanso">
      <Ring size={32} stroke={4} endsAt={endsAt} totalMs={totalSeconds * 1000} over={over} color={ink} />
      <View style={{ flex: 1 }}>
        <AppText variant="label" style={over ? { color: colors.primary } : undefined}>
          {over ? 'Descanso terminado' : 'Descanso'}
        </AppText>
        <AppText variant="bodySm" numberOfLines={1}>
          {nextLabel}
        </AppText>
      </View>
      <AppText variant="metric" tabular style={{ color: ink }}>
        {formatCountdown(remaining)}
      </AppText>
      <Icon name="chevron-right" size={20} color={colors.muted} />
    </Pressable>
  );
}

/** Correcting a set already done: its reps (and its weight, in the summary). «Borrar» undoes from a Snackbar. */
function SetSheet({
  set,
  label,
  onClose,
  onSave,
  onDelete,
}: {
  set: SetLog | null;
  label: string;
  onClose: () => void;
  onSave: (set: SetLog, reps: number) => void;
  onDelete: (set: SetLog) => void;
}) {
  const [reps, setReps] = useState(set?.reps ?? 0);
  return (
    <Sheet
      visible={set !== null}
      title={set ? `Serie ${set.setIndex}` : ''}
      onClose={onClose}
      action={
        set ? (
          <Button
            kind="danger"
            icon="trash-can-outline"
            title="Borrar"
            onPress={() => {
              onClose();
              onDelete(set);
            }}
          />
        ) : null
      }>
      <AppText variant="label">{label}</AppText>
      <Stepper value={reps} onChange={setReps} min={1} typing={false} />
      <Button
        size="lg"
        title="Guardar"
        disabled={!set || reps <= 0 || reps === set.reps}
        onPress={() => {
          if (set) onSave(set, reps);
          onClose();
        }}
      />
    </Sheet>
  );
}

type SheetState = { kind: 'set'; set: SetLog } | { kind: 'warmup'; set: SetLog | null } | { kind: 'weight' } | null;

function SetView({
  title,
  slot,
  slotSets,
  warmups,
  lastWarmups,
  increment,
  last,
  change,
  onChanged,
  onComplete,
  onWarmup,
  onCorrect,
  onDelete,
  onWeight,
  onSkip,
  canSkip,
  weightNote,
}: {
  title: string;
  slot: Slot;
  slotSets: SetLog[];
  warmups: SetLog[];
  lastWarmups: WarmupSet[];
  increment: number;
  last: number[];
  change?: WeightChange;
  onChanged: () => void;
  onComplete: (reps: number) => Promise<void>;
  onWarmup: (weightKg: number | null, reps: number) => Promise<void>;
  onCorrect: (set: SetLog, reps: number, weightKg?: number | null) => void;
  onDelete: (set: SetLog) => void;
  onWeight: (kg: number | null) => Promise<void>;
  onSkip: () => void;
  /** A loose exercise is not skipped: going back drops it if it has no sets. */
  canSkip: boolean;
  /** Where else the new weight applies: «también para las próximas sesiones» or the routine it belongs to. */
  weightNote: string;
}) {
  const db = useDb();
  const done = slotSets.length;
  const setNumber = done + 1;
  const extra = setNumber > slot.sets;
  const bodyweight = isBodyweight(slot);
  const repsLabel = `Repeticiones${slot.perSide ? ' por lado' : ''}`;
  const [reps, setReps] = useState(last[done] ?? last[last.length - 1] ?? defaultReps(slot.target));
  const [sheet, setSheet] = useState<SheetState>(null);
  const [sheetReps, setSheetReps] = useState(0);
  const [sheetKg, setSheetKg] = useState(0);
  const [saving, setSaving] = useState(false);
  const [appliedChange, setAppliedChange] = useState<WeightChange | null>(null);
  // Decided once per set (it remounts after each one): the wide action only before the first set
  // and for a pending suggestion; otherwise the quiet line.
  const [prominent] = useState(() => done === 0 && change?.status === 'pending');
  const shown = appliedChange ?? change ?? null;
  const { fontScale } = useWindowDimensions();
  // Same height for «Peso corporal» and a number at any font size.
  const numberLine = type.numberL.lineHeight * Math.min(fontScale, maxFontScale.numberL ?? 1);
  const noLoad = bodyweight && !slot.weightKg;
  const weightLabel = bodyweight ? 'Lastre' : slot.exercisePair ? 'Cada mancuerna' : 'Peso';

  const apply = async () => {
    if (!shown) return;
    Haptics.selectionAsync();
    await applyChange(db, shown.id);
    setAppliedChange(shown);
    onChanged();
  };
  const undo = async () => {
    if (!appliedChange) return;
    Haptics.selectionAsync();
    await undoChange(db, appliedChange.id);
    setAppliedChange(null);
    onChanged();
  };

  const openWarmup = (set: SetLog | null) => {
    const proposal = set
      ? { weightKg: set.weightKg, reps: set.reps }
      : warmupProposal(warmups.length, slot.weightKg ?? 0, increment, lastWarmups);
    setSheetKg(proposal.weightKg ?? 0);
    setSheetReps(proposal.reps);
    setSheet({ kind: 'warmup', set });
  };
  const openWeight = () => {
    setSheetKg(slot.weightKg ?? 0);
    setSheet({ kind: 'weight' });
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onComplete(reps);
    } finally {
      setSaving(false);
    }
  };

  const kgOrNull = (kg: number) => (kg > 0 ? kg : bodyweight ? null : 0);
  const loadText = (kg: number) => (kg > 0 ? formatKg(kg) : bodyweight ? 'Sin lastre' : formatKg(0));
  const lastSpoken = `Última vez: ${last.join(', ')}${last[done] !== undefined ? `. En esta serie, ${last[done]}` : ''}`;

  const menu = () =>
    showActions([
      ...(canSkip ? [{ text: 'Saltar ejercicio', icon: 'skip-next-outline' as const, onPress: onSkip }] : []),
      ...(done > 0 ? [{ text: 'Añadir aproximación', icon: 'plus' as const, onPress: () => openWarmup(null) }] : []),
      {
        // A loose exercise in no routine has its own hidden slot: editing it is not editing a routine.
        text: slot.looseOnly ? 'Editar series y peso' : 'Editar ejercicio de la rutina',
        icon: 'pencil-outline',
        onPress: () => router.push(`/slot/${slot.id}`),
      },
    ]);

  const footer = (
    <BottomBar actionKey={`set-${slot.id}-${done}`} style={{ flexDirection: 'column', gap: spacing.md }}>
      <AppText variant="label" style={{ textAlign: 'center' }}>
        {repsLabel}
      </AppText>
      <Stepper big value={reps} onChange={setReps} min={1} />
      <Button size="xl" icon="check-bold" title={extra ? 'Serie extra hecha' : 'Serie hecha'} onPress={submit} disabled={saving || reps <= 0} />
    </BottomBar>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <HeaderActions>
              <IconButton icon="dots-vertical" label="Más acciones" onPress={menu} />
            </HeaderActions>
          ),
        }}
      />
      <Screen tight footer={footer}>
        <View style={{ gap: spacing.xs }}>
          <AppText variant="title" numberOfLines={2}>
            {slot.exerciseName}
          </AppText>
          <Row between>
            <AppText variant="bodySm" weight="600" style={[{ flexShrink: 1 }, extra && { color: colors.warning }]}>
              {extra ? `Serie extra ${setNumber}` : `Serie ${setNumber} de ${slot.sets}`}
            </AppText>
            {done === 0 ? (
              // The text button keeps its 44 dp touch box; the negative margin keeps the line at 20 dp.
              <View style={styles.inlineAction}>
                <Button kind="text" icon="plus" title="Aproximación" accessibilityLabel="Añadir aproximación" onPress={() => openWarmup(null)} />
              </View>
            ) : null}
          </Row>
        </View>

        {warmups.length > 0 ? (
          // flexGrow 0: a ScrollView grows by default and would take the free height of the screen.
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.warmups}>
            {warmups.map((w) => (
              <Pressable
                key={w.id}
                onPress={() => openWarmup(w)}
                style={styles.warmupPill}
                accessibilityRole="button"
                accessibilityLabel={`Aproximación ${w.setIndex}: ${loadText(w.weightKg ?? 0)} por ${w.reps}`}>
                <AppText variant="tag" style={{ color: colors.accent }}>
                  A{w.setIndex}
                </AppText>
                <AppText variant="bodySm" weight="600" tabular>
                  {loadText(w.weightKg ?? 0)} × {w.reps}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <SetTracker planned={slot.sets} sets={slotSets} currentReps={reps} onOpen={(set) => setSheet({ kind: 'set', set })} />

        <ListGroup inset={0}>
          <View>
            <Pressable
              onPress={openWeight}
              android_ripple={{ color: colors.pressed }}
              style={styles.weightRow}
              accessibilityRole="button"
              accessibilityLabel={`${weightLabel}: ${noLoad ? 'peso corporal' : formatKg(slot.weightKg ?? 0)}`}
              accessibilityHint={bodyweight ? 'Cambia el lastre' : 'Cambia el peso'}>
              <AppText variant="label">{weightLabel}</AppText>
              <View style={[styles.weightLine, { minHeight: numberLine }]}>
                {noLoad ? (
                  <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>
                    Peso corporal
                  </AppText>
                ) : (
                  <Value value={formatNumber(slot.weightKg ?? 0)} unit="kg" size="numberL" style={{ flex: 1 }} />
                )}
                <Icon name="pencil-outline" size={20} color={colors.muted} />
              </View>
            </Pressable>
            {shown ? (
              <View style={styles.suggestionSlot}>
                {prominent ? (
                  <SuggestionAction change={shown} applied={!!appliedChange} bodyweight={bodyweight} onApply={apply} onUndo={undo} />
                ) : (
                  <SuggestionLine change={shown} applied={!!appliedChange} onApply={apply} onUndo={undo} />
                )}
              </View>
            ) : null}
          </View>

          <View style={styles.infoGrid}>
            <InfoCell
              label="Objetivo"
              spoken={`Objetivo: ${spokenTarget(slot.target, slot.unit, slot.perSide)}`}
              caption={slot.perSide ? 'Por lado' : undefined}>
              <AppText variant="rowValue" tabular numberOfLines={2}>
                {capitalizeFirst(formatTarget(slot.target, slot.unit, false))}
              </AppText>
            </InfoCell>
            {last.length > 0 ? (
              <>
                <View style={styles.vDivider} />
                <InfoCell label="Última vez" spoken={lastSpoken}>
                  <AppText variant="rowValue" tabular numberOfLines={2} style={{ color: colors.muted }}>
                    {last.map((r, i) => (
                      <Fragment key={i}>
                        {i > 0 ? ' · ' : ''}
                        <AppText
                          variant="rowValue"
                          tabular
                          weight={i === done ? '700' : undefined}
                          style={{ color: i === done ? colors.text : colors.muted }}>
                          {r}
                        </AppText>
                      </Fragment>
                    ))}
                  </AppText>
                </InfoCell>
              </>
            ) : null}
          </View>

          {slot.note ? <NoteRow text={slot.note} /> : null}
        </ListGroup>
      </Screen>

      <SetSheet
        key={sheet?.kind === 'set' ? sheet.set.id : 'none'}
        set={sheet?.kind === 'set' ? sheet.set : null}
        label={repsLabel}
        onClose={() => setSheet(null)}
        onSave={(set, value) => onCorrect(set, value)}
        onDelete={onDelete}
      />

      <Sheet
        visible={sheet?.kind === 'warmup'}
        title={sheet?.kind === 'warmup' ? `Aproximación ${sheet.set ? sheet.set.setIndex : warmups.length + 1}` : ''}
        onClose={() => setSheet(null)}
        action={
          sheet?.kind === 'warmup' && sheet.set ? (
            <Button
              kind="danger"
              icon="trash-can-outline"
              title="Borrar"
              onPress={() => {
                const removed = sheet.set!;
                setSheet(null);
                onDelete(removed);
              }}
            />
          ) : null
        }>
        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">{bodyweight ? 'Lastre' : 'Peso'}</AppText>
          <Stepper decimal value={sheetKg} onChange={setSheetKg} step={increment} format={loadText} typing={false} />
        </View>
        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">{repsLabel}</AppText>
          <Stepper value={sheetReps} onChange={setSheetReps} min={1} typing={false} />
        </View>
        <Button
          size="lg"
          title="Guardar aproximación"
          disabled={sheetReps <= 0}
          onPress={async () => {
            const editing = sheet?.kind === 'warmup' ? sheet.set : null;
            setSheet(null);
            if (editing) onCorrect(editing, sheetReps, kgOrNull(sheetKg));
            else await onWarmup(kgOrNull(sheetKg), sheetReps);
          }}
        />
      </Sheet>

      <Sheet visible={sheet?.kind === 'weight'} title={bodyweight ? 'Cambiar lastre' : 'Cambiar peso'} onClose={() => setSheet(null)}>
        <Stepper big decimal value={sheetKg} onChange={setSheetKg} step={increment} format={loadText} typing={false} />
        <AppText variant="caption">
          {slot.exercisePair ? `De cada mancuerna; ${weightNote}` : capitalizeFirst(weightNote)}
        </AppText>
        <Button
          size="lg"
          title={`Guardar ${loadText(sheetKg)}`}
          disabled={kgOrNull(sheetKg) === slot.weightKg}
          onPress={async () => {
            setSheet(null);
            await onWeight(kgOrNull(sheetKg));
            // «Deshacer» would put back the weight from before the suggestion over this one.
            setAppliedChange(null);
          }}
        />
      </Sheet>
    </>
  );
}

/** A label over its value in the set card; one TalkBack stop. */
function InfoCell({ label, spoken, caption, children }: { label: string; spoken: string; caption?: string; children: ReactNode }) {
  return (
    <View style={styles.infoCell} accessible accessibilityLabel={spoken}>
      <AppText variant="label" numberOfLines={1}>
        {label}
      </AppText>
      {children}
      {caption ? <AppText variant="caption">{caption}</AppText> : null}
    </View>
  );
}

/** The routine note: two lines; only when it is longer, a chevron and a tap show it whole. */
function NoteRow({ text }: { text: string }) {
  const { fontScale } = useWindowDimensions();
  const [lines, setLines] = useState(0);
  const [open, setOpen] = useState(false);
  const long = lines > 2;
  // The icons stay centred on the first line.
  const firstLine = { height: type.bodySm.lineHeight * Math.min(fontScale, maxFontScale.bodySm ?? fontScale) };
  return (
    <Pressable
      onPress={long ? () => setOpen((o) => !o) : undefined}
      android_ripple={long ? { color: colors.pressed } : undefined}
      style={styles.noteRow}
      accessibilityRole={long ? 'button' : undefined}
      accessibilityState={long ? { expanded: open } : undefined}
      accessibilityLabel={`Nota: ${text}`}
      accessibilityHint={long ? (open ? 'Recoge la nota' : 'Muestra la nota entera') : undefined}>
      <View style={[styles.noteSide, firstLine]}>
        <Icon name="note-text-outline" size={20} color={colors.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodySm" numberOfLines={open ? undefined : 2}>
          {text}
        </AppText>
        {/* Android reports only the visible lines of a clamped text: an invisible full copy counts them. */}
        <View style={styles.measure} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <AppText variant="bodySm" onTextLayout={(e) => setLines(e.nativeEvent.lines.length)}>
            {text}
          </AppText>
        </View>
      </View>
      {long ? (
        <View style={[styles.noteSide, firstLine]}>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * One cell per planned set, plus the extra ones: done (its reps and a check), the current one
 * (the reps of the stepper, live) and the ones left («–»). Tapping a done one opens its correction.
 */
function SetTracker({
  planned,
  sets,
  currentReps,
  onOpen,
}: {
  planned: number;
  sets: SetLog[];
  currentReps: number;
  onOpen: (set: SetLog) => void;
}) {
  const count = Math.max(planned, sets.length + 1);
  // At least 3 columns (1–2 sets keep a normal width), at most 6 (more wrap to a new row).
  const columns = Math.min(6, Math.max(3, count));
  const cells = Array.from({ length: count }, (_, i) => {
    const set = sets[i];
    const label = i >= planned ? 'Extra' : `S${i + 1}`;
    if (set) {
      return (
        <Pressable
          key={i}
          onPress={() => onOpen(set)}
          style={[styles.cell, styles.cellDone]}
          accessibilityRole="button"
          accessibilityLabel={`Serie ${i + 1}: ${set.reps} repeticiones, hecha`}
          accessibilityHint="Toca para corregirla">
          <AppText variant="tag" maxFontSizeMultiplier={CELL_MAX_SCALE}>
            {label}
          </AppText>
          <View style={styles.cellValue}>
            <AppText variant="rowValue" tabular maxFontSizeMultiplier={CELL_MAX_SCALE}>
              {set.reps}
            </AppText>
            <Icon name="check" size={14} color={colors.primary} />
          </View>
        </Pressable>
      );
    }
    const isCurrent = i === sets.length;
    return (
      <View
        key={i}
        style={[styles.cell, isCurrent ? styles.cellCurrent : styles.cellPending]}
        accessible
        accessibilityLabel={isCurrent ? `Serie ${i + 1}: ${currentReps} repeticiones, en curso` : `Serie ${i + 1}, pendiente`}>
        <AppText variant="tag" maxFontSizeMultiplier={CELL_MAX_SCALE} style={{ color: isCurrent ? colors.primary : colors.muted }}>
          {label}
        </AppText>
        <AppText variant="rowValue" tabular maxFontSizeMultiplier={CELL_MAX_SCALE} style={{ color: isCurrent ? colors.primary : colors.muted }}>
          {isCurrent ? currentReps : '–'}
        </AppText>
      </View>
    );
  });
  const rows: ReactNode[][] = [];
  for (let i = 0; i < count; i += columns) rows.push(cells.slice(i, i + columns));
  return (
    <View style={styles.tracker}>
      {rows.map((row, r) => (
        <View key={r} style={styles.trackerRow}>
          {row}
          {Array.from({ length: columns - row.length }, (_, k) => (
            <View key={`spacer-${k}`} style={styles.cellSpacer} />
          ))}
        </View>
      ))}
    </View>
  );
}

function RestView({
  endsAt,
  totalSeconds,
  next,
  nextSlot,
  nextMuscles,
  nextSlotDone,
  lastSet,
  lastSlot,
  onCorrect,
  onDelete,
  onAdjust,
  onContinue,
  askOverlay,
  onGrantOverlay,
  onDeclineOverlay,
}: {
  endsAt: number;
  totalSeconds: number;
  next: NextStep;
  nextSlot: Slot | null;
  /** For the icon of the next exercise, in the place of an arrow that said nothing «Siguiente» does not. */
  nextMuscles: ExerciseMuscles | undefined;
  /** Sets already done of the next exercise: one left half done does not start at «Primera serie». */
  nextSlotDone: number;
  lastSet: SetLog | null;
  lastSlot: Slot | undefined;
  onCorrect: (set: SetLog, reps: number) => void;
  onDelete: (set: SetLog) => void;
  onAdjust: (deltaSeconds: number) => void;
  onContinue: () => void;
  askOverlay: boolean;
  onGrantOverlay: () => void;
  onDeclineOverlay: () => void;
}) {
  const now = useNow(250);
  const remaining = endsAt - now;
  const over = remaining <= 0;
  const buzzed = useRef(false);
  const [correcting, setCorrecting] = useState<SetLog | null>(null);

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
        : 'Siguiente serie'
      : next.kind === 'next_exercise'
        ? 'Siguiente ejercicio'
        : 'Terminar';
  const nextSetNumber = next.kind === 'next_set' ? next.setNumber : nextSlotDone + 1;
  const nextSetLabel =
    next.kind === 'next_exercise' && nextSetNumber === 1 ? 'Primera serie' : `Serie ${nextSetNumber} de ${nextSlot?.sets ?? 0}`;
  const ringSize = 264;
  const ink = over ? colors.primary : colors.text;

  // «Saltar descanso» and the action that replaces it at 0 take exactly the same place.
  const footer = (
    <BottomBar actionKey={over ? 'next' : 'skip'} style={{ flexDirection: 'column', gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Button size="lg" kind="secondary" title="−30 s" onPress={() => onAdjust(-30)} disabled={over} style={{ flex: 1 }} />
        <Button size="lg" kind="secondary" title="+30 s" onPress={() => onAdjust(30)} disabled={over} style={{ flex: 1 }} />
      </View>
      <Button
        size="xl"
        kind={over ? 'primary' : 'secondary'}
        icon={over ? 'play' : 'skip-next'}
        title={over ? continueLabel : 'Saltar descanso'}
        onPress={onContinue}
      />
    </BottomBar>
  );

  return (
    <Screen tight footer={footer}>
      <View style={styles.restTop}>
        <AppText variant="bodySm" weight="600" style={{ color: over ? colors.primary : colors.muted }}>
          {over ? 'Descanso terminado' : 'Descanso'}
        </AppText>
        <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
          <View style={StyleSheet.absoluteFill}>
            <Ring size={ringSize} stroke={10} endsAt={endsAt} totalMs={totalSeconds * 1000} over={over} color={ink} />
          </View>
          <AppText
            variant="countdown"
            tabular
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={{ color: ink, maxWidth: ringSize - 40 }}>
            {formatCountdown(remaining)}
          </AppText>
          {over ? (
            <AppText variant="metricSm" tabular style={{ color: colors.warning }}>
              +{formatCountdown(-remaining)}
            </AppText>
          ) : (
            <AppText variant="secondary">de {formatCountdown(totalSeconds * 1000)}</AppText>
          )}
        </View>
      </View>

      {/* What was done (tap to correct it, without stopping the rest) and what comes next. */}
      <ListGroup inset={ROW_ICON_INSET}>
        {lastSet && lastSlot ? (
          <ListRow
            onPress={() => setCorrecting(lastSet)}
            chevron={false}
            left={<RowIcon name="check" color={colors.primary} tint={colors.primaryTint} />}
            title={`Serie ${lastSet.setIndex} hecha`}
            subtitle={`${formatLoad(lastSet.weightKg, isBodyweight(lastSlot), lastSlot.exercisePair)} × ${lastSet.reps}`}
            right={<Icon name="pencil-outline" size={20} color={colors.muted} />}
          />
        ) : null}
        {nextSlot ? (
          <ListRow
            left={<ExerciseIcon muscles={nextMuscles} />}
            title={
              <View style={{ gap: 2 }}>
                <AppText variant="label">Siguiente</AppText>
                <AppText variant="rowTitle" numberOfLines={2}>
                  {nextSlot.exerciseName}
                </AppText>
              </View>
            }
            subtitle={`${nextSetLabel} · ${formatLoad(
              nextSlot.weightKg,
              isBodyweight(nextSlot),
              nextSlot.exercisePair,
            )}`}
          />
        ) : (
          <ListRow left={<RowIcon name="flag-checkered" color={colors.muted} />} title="Era la última serie" />
        )}
      </ListGroup>

      {askOverlay ? (
        <ListGroup>
          <View style={styles.noticeRow}>
            <AppText variant="bodySm" style={{ flex: 1 }}>
              Burbuja con el descanso fuera de la app
            </AppText>
            <Button kind="text" title="Dar permiso" onPress={onGrantOverlay} />
            <IconButton icon="close" label="No, gracias" onPress={onDeclineOverlay} size={20} color={colors.muted} />
          </View>
        </ListGroup>
      ) : null}

      <SetSheet
        key={correcting?.id ?? 'none'}
        set={correcting}
        label={`Repeticiones${lastSlot?.perSide ? ' por lado' : ''}`}
        onClose={() => setCorrecting(null)}
        onSave={onCorrect}
        onDelete={onDelete}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  completed: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  completedIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  restBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
  },
  warmups: { gap: spacing.sm },
  warmupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentTint,
  },
  tracker: { gap: spacing.sm },
  trackerRow: { flexDirection: 'row', gap: spacing.sm },
  cell: { flex: 1, minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cellSpacer: { flex: 1 },
  cellDone: { backgroundColor: colors.cardAlt },
  cellCurrent: { backgroundColor: colors.primaryTint },
  cellPending: { borderWidth: 1, borderColor: colors.border },
  cellValue: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  inlineAction: { marginVertical: -spacing.md },
  weightRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
  weightLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestionSlot: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  infoGrid: { flexDirection: 'row', alignItems: 'stretch' },
  infoCell: { flex: 1, gap: 2, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  vDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  noteSide: { justifyContent: 'center' },
  measure: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  restTop: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingLeft: spacing.lg, paddingRight: spacing.xs },
});
