import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { showActions, showDialog, showPrompt, showSnackbar } from '@/components/Dialog';
import { SessionMusclesSection } from '@/components/MuscleWeek';
import { askPhotoSource, PhotoSection } from '@/components/Photos';
import { NoChangeLine, RecommendationBox } from '@/components/Recommendation';
import { Sheet } from '@/components/Sheet';
import {
  AppText,
  BottomBar,
  Button,
  Card,
  EditableTitle,
  EmptyState,
  ExerciseIcon,
  HeaderActions,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  Loading,
  Row,
  RowIcon,
  Screen,
  Section,
  Stat,
  StatRow,
  Stepper,
  Tag,
  useBusy,
} from '@/components/ui';
import { allExerciseMuscles, workSetsOfSession } from '@/db/repositories/muscles';
import { listPhotos, type PhotoOwner } from '@/db/repositories/photos';
import { getSlot, isBodyweight, slotRule, type Slot } from '@/db/repositories/routines';
import {
  deleteFinishedSession,
  deleteSet,
  getSession,
  listSets,
  refreshRecommendations,
  restoreSet,
  setSessionTitle,
  slotHistory,
  updateSetReps,
  updateSetWeight,
  type SetLog,
} from '@/db/repositories/sessions';
import { sessionRecordExercises } from '@/db/repositories/records';
import { getProfile, getSettings, toProgressionSettings } from '@/db/repositories/settings';
import { applyChange, listChangesForSession, type WeightChange } from '@/db/repositories/weightChanges';
import {
  formatDuration,
  formatKg,
  formatLongDate,
  formatMinutes,
  formatNumber,
  formatSetGroups,
  formatTimeRange,
  workoutTitle,
} from '@/domain/format';
import { MUSCLE_KEYS, setsPerMuscle } from '@/domain/muscles';
import { volumeOf } from '@/domain/progress';
import { recommend } from '@/domain/progression';
import type { Recommendation } from '@/domain/types';
import { exerciseTimes, formatOverPlan, formatRest, sessionTimes, type SessionTimes } from '@/domain/workoutTimes';
import { useDb, useLoader } from '@/hooks/data';
import { deletingPhotosOf, isOnPhone, pickPhotos, takePhoto, type AddPhotosResult } from '@/services/photos';
import { colors, radius, spacing } from '@/theme';

/** "1 sube · 1 baja": what «Aplicar las N» will do, without scrolling to each one. */
function directions(changes: WeightChange[]): string {
  const up = changes.filter((c) => (c.toKg ?? 0) > (c.fromKg ?? 0)).length;
  const down = changes.length - up;
  return [up ? `${up} ${up === 1 ? 'sube' : 'suben'}` : null, down ? `${down} ${down === 1 ? 'baja' : 'bajan'}` : null]
    .filter(Boolean)
    .join(' · ');
}

export default function SummaryScreen() {
  const { sessionId, nuevo } = useLocalSearchParams<{ sessionId: string; nuevo?: string }>();
  const id = Number(sessionId);
  const db = useDb();
  const [correcting, setCorrecting] = useState(false);
  const [sheet, setSheet] = useState<{ set: SetLog; slot: Slot } | null>(null);
  const [sheetReps, setSheetReps] = useState(0);
  const [sheetKg, setSheetKg] = useState(0);
  const [, run] = useBusy();

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
    const keepReasons = new Map<number, Recommendation>();
    for (const slot of slots) {
      const history = await slotHistory(db, slot.id, 12);
      const from = history.findIndex((h) => h.sessionId === id);
      if (from >= 0) {
        const rec = recommend(slotRule(slot), slot.exerciseIncrementKg, history.slice(from), progression);
        // Only a reason to keep is shown as «Se mantiene»: with the rules changed since, the same
        // session may now call for a change, and its own (expired) suggestion is not shown.
        if (rec.action === 'keep' || rec.action === 'manual') keepReasons.set(slot.id, rec);
      }
    }
    const muscles = await allExerciseMuscles(db);
    return {
      session,
      sets,
      slots,
      keepReasons,
      progression,
      defaultIncrement: settings.defaultIncrementKg,
      changes: await listChangesForSession(db, id),
      muscles,
      setsPerMuscle: setsPerMuscle(await workSetsOfSession(db, id), muscles),
      sex: (await getProfile(db)).sex,
      photos: (await listPhotos(db, { kind: 'workout', id })).filter(isOnPhone),
      // The exercises whose best set was beaten in this workout (1.4.10).
      records: await sessionRecordExercises(db, id),
    };
  });

  if (data === undefined) return <Loading />;
  if (data === null) {
    return <EmptyState icon="dumbbell" title="No se encontró este entreno" text="Puede que se borrara." />;
  }

  const { session, sets, slots, changes } = data;
  const finished = session.status === 'finished';
  const pending = changes.filter((c) => c.status === 'pending');
  // Warm-ups are shown, but never count as series or volume.
  const work = sets.filter((s) => !s.isWarmup);
  const warmupCount = sets.length - work.length;
  // Each exercise counts its two dumbbells, if it has them; a set whose slot is gone counts once.
  const volume = work.reduce(
    (sum, s) => sum + volumeOf([s], slots.find((slot) => slot.id === s.slotId)?.exercisePair),
    0,
  );
  // An imported session has no real duration (it was stored with a made-up hour).
  const duration = session.finishedAt && !session.imported ? formatDuration(session.finishedAt - session.startedAt) : '—';
  // Warm-up and rests, measured since 1.4.7: nothing for older or imported sessions.
  const times = sessionTimes(session, sets);

  const applyAll = run(async () => {
    for (const c of pending) await applyChange(db, c.id);
    reload();
  });

  const afterEdit = async () => {
    await refreshRecommendations(db, id, data.progression);
    await reload();
  };

  const owner: PhotoOwner = { kind: 'workout', id };
  const afterPhotos = (result: AddPhotosResult) => {
    if (result === 'denied') showSnackbar('Sin permiso para usar la cámara', { label: 'Ajustes', onPress: () => Linking.openSettings() });
    reload();
  };
  const failedPhoto = (e: unknown) => {
    console.warn('Could not add the photo', e);
    showSnackbar('No se pudo añadir la foto');
  };
  const addPhoto = () =>
    askPhotoSource(
      () => takePhoto(db, owner, null).then(afterPhotos, failedPhoto),
      () => pickPhotos(db, owner).then(afterPhotos, failedPhoto),
    );

  const removeSession = () =>
    showDialog('¿Borrar el entreno?', 'Se borran todas sus series y no se puede deshacer.', [
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await deletingPhotosOf(db, owner, () => deleteFinishedSession(db, id));
          if (router.canGoBack()) router.back();
          else router.dismissTo('/');
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);

  const share = () => router.push({ pathname: '/compartir/[tipo]/[id]', params: { tipo: 'entreno', id: String(id) } });
  const menu = () =>
    showActions([
      { text: 'Corregir series', icon: 'pencil-outline', onPress: () => setCorrecting(true) },
      { text: 'Borrar entreno', icon: 'trash-can-outline', destructive: true, onPress: removeSession },
    ]);

  const openSet = (set: SetLog, slot: Slot) => {
    setSheetReps(set.reps);
    setSheetKg(set.weightKg ?? 0);
    setSheet({ set, slot });
  };

  const footer = correcting ? (
    <BottomBar>
      <Button size="lg" title="Hecho" onPress={() => setCorrecting(false)} style={{ flex: 1 }} />
    </BottomBar>
  ) : nuevo && finished ? (
    <BottomBar>
      <Button size="lg" kind="secondary" icon="share-variant" title="Compartir" onPress={share} style={{ flex: 1 }} />
      <Button size="lg" icon="check" title="Listo" onPress={() => router.dismissTo('/')} style={{ flex: 1 }} />
    </BottomBar>
  ) : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          title: correcting ? 'Corregir series' : '',
          headerRight:
            finished && !correcting
              ? () => (
                  <HeaderActions>
                    <IconButton icon="share-variant" label="Compartir imagen" onPress={share} />
                    <IconButton icon="dots-vertical" label="Más acciones" onPress={menu} />
                  </HeaderActions>
                )
              : undefined,
        }}
      />
      <Screen footer={footer}>
        <View style={{ gap: spacing.xs }}>
          <EditableTitle
            value={workoutTitle(session)}
            onEdit={async () => {
              const name = workoutTitle({ ...session, title: null });
              const title = await showPrompt('Título', { value: session.title ?? '', placeholder: name, maxLength: 40, confirm: 'Guardar' });
              if (title === null) return;
              await setSessionTitle(db, id, title);
              reload();
            }}
          />
          <Row>
            <AppText variant="secondary">
              {formatLongDate(new Date(session.startedAt))}
              {session.finishedAt && !session.imported ? ` · ${formatTimeRange(session.startedAt, session.finishedAt)}` : ''}
            </AppText>
            {session.imported ? <Tag label="Importado" /> : null}
          </Row>
        </View>

        <View style={{ gap: spacing.sm }}>
          <StatRow>
            <Stat label="Duración" value={duration} />
            <Stat label="Series" value={String(work.length)} />
            <Stat label="Volumen" value={formatNumber(volume, 0)} unit="kg" />
          </StatRow>
          {/* Under the grid: in a third of the width «aproximaciones» does not fit. */}
          {warmupCount > 0 ? (
            <AppText variant="caption">
              Series y volumen sin contar {warmupCount === 1 ? '1 aproximación' : `${warmupCount} aproximaciones`}
            </AppText>
          ) : null}
        </View>

        {pending.length > 1 && !correcting ? (
          <ListGroup>
            <ListRow
              left={<RowIcon name="arrow-up-down" color={colors.warning} tint={colors.warningTint} />}
              title={`${pending.length} sugerencias`}
              subtitle={directions(pending)}
              right={<Button kind="tonal" title={`Aplicar las ${pending.length}`} onPress={applyAll} />}
            />
          </ListGroup>
        ) : null}

        {slots.map((slot) => {
          const slotSets = work.filter((s) => s.slotId === slot.id);
          const warmups = sets.filter((s) => s.slotId === slot.id && s.isWarmup);
          const bodyweight = isBodyweight(slot);
          // The latest live recommendation; an expired one only explains a past decision.
          const change = changes.filter((c) => c.slotId === slot.id && c.status !== 'expired').at(-1);
          return (
            <Card key={slot.id}>
              {/* The exercise and what was done form one block that opens its progress. */}
              <Pressable
                onPress={() => router.push(`/progreso/${slot.exerciseId}`)}
                style={styles.nameRow}
                accessibilityRole="button"
                accessibilityHint="Abre el progreso del ejercicio">
                <ExerciseIcon muscles={data.muscles.get(slot.exerciseId)} />
                <View style={styles.nameBlock}>
                  <AppText variant="heading">{slot.exerciseName}</AppText>
                  {correcting ? null : slotSets.length > 0 ? (
                    <AppText variant="bodySm" tabular>
                      {formatSetGroups(slotSets, bodyweight, slot.exercisePair, slot.unit)}
                    </AppText>
                  ) : (
                    <AppText variant="secondary">Sin series</AppText>
                  )}
                  {correcting ? null : <ExerciseTimesLine slotId={slot.id} sets={sets} />}
                  {!correcting && finished && data.records.includes(slot.exerciseId) ? <Tag label="Récord" tone="success" /> : null}
                </View>
                <Icon name="chevron-right" size={20} color={colors.muted} />
              </Pressable>
              {warmups.length > 0 ? (
                <Row style={{ flexWrap: 'nowrap' }}>
                  <Tag label="Aprox." tone="info" />
                  <AppText variant="secondary" tabular style={{ flex: 1 }}>
                    {warmups.map((w) => `${w.weightKg ? formatKg(w.weightKg) : 'sin peso'} × ${w.reps}`).join(' · ')}
                  </AppText>
                </Row>
              ) : null}
              {correcting ? (
                <View style={styles.cells}>
                  {[...warmups, ...slotSets].map((s) => (
                    <Pressable
                      key={s.id}
                      onPress={() => openSet(s, slot)}
                      style={[styles.cell, s.isWarmup && { backgroundColor: colors.accentTint }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${s.isWarmup ? 'Aproximación' : 'Serie'} ${s.setIndex}: ${s.reps} repeticiones`}>
                      <AppText variant="tag" style={s.isWarmup ? { color: colors.accent } : undefined}>
                        {s.isWarmup ? 'A' : 'S'}
                        {s.setIndex}
                      </AppText>
                      <AppText variant="rowValue" tabular>
                        {s.reps}
                      </AppText>
                      <AppText variant="caption" tabular>
                        {s.weightKg ? formatNumber(s.weightKg) : '–'}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <>
                  {change ? (
                    <RecommendationBox change={change} onChanged={reload} />
                  ) : data.keepReasons.has(slot.id) ? (
                    <NoChangeLine
                      reason={data.keepReasons.get(slot.id)!.reason}
                      manual={data.keepReasons.get(slot.id)!.action === 'manual'}
                    />
                  ) : null}
                </>
              )}
            </Card>
          );
        })}

        {correcting ? (
          <AppText variant="caption">La sugerencia de peso se recalcula al guardar</AppText>
        ) : finished ? (
          <>
            <TimesSection times={times} />
            {/* Exercises without muscles count nowhere: with none mapped there is nothing to paint. */}
            {MUSCLE_KEYS.some((m) => data.setsPerMuscle[m] > 0) ? <SessionMusclesSection sets={data.setsPerMuscle} sex={data.sex} /> : null}
            <PhotoSection photos={data.photos} onAdd={addPhoto} />
          </>
        ) : null}
      </Screen>

      <Sheet
        visible={sheet !== null}
        title={sheet ? `${sheet.set.isWarmup ? 'Aproximación' : 'Serie'} ${sheet.set.setIndex}` : ''}
        onClose={() => setSheet(null)}
        action={
          sheet ? (
            <Button
              kind="danger"
              icon="trash-can-outline"
              title="Borrar"
              onPress={async () => {
                const removed = sheet.set;
                setSheet(null);
                await deleteSet(db, removed.id);
                afterEdit();
                showSnackbar(removed.isWarmup ? 'Aproximación borrada' : 'Serie borrada', {
                  label: 'Deshacer',
                  onPress: async () => {
                    await restoreSet(db, removed);
                    afterEdit();
                  },
                });
              }}
            />
          ) : null
        }>
        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">Repeticiones</AppText>
          <Stepper value={sheetReps} onChange={setSheetReps} min={1} typing={false} />
        </View>
        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">{sheet && isBodyweight(sheet.slot) ? 'Lastre' : 'Peso'}</AppText>
          <Stepper
            decimal
            typing={false}
            value={sheetKg}
            onChange={setSheetKg}
            step={sheet ? (sheet.slot.incrementKg ?? sheet.slot.exerciseIncrementKg ?? data.defaultIncrement) : 2.5}
            format={formatKg}
          />
        </View>
        <Button
          size="lg"
          title="Guardar"
          disabled={sheetReps <= 0}
          onPress={async () => {
            if (!sheet) return;
            const { set, slot } = sheet;
            setSheet(null);
            await updateSetReps(db, set.id, sheetReps);
            const newWeight = isBodyweight(slot) && sheetKg === 0 ? null : sheetKg;
            if (newWeight !== set.weightKg) await updateSetWeight(db, set.id, newWeight);
            afterEdit();
          }}
        />
      </Sheet>
    </>
  );
}

/** «12 min · descansos 2:41 · 3:15 · 2:30»: how long the exercise took and each rest between its sets. */
function ExerciseTimesLine({ slotId, sets }: { slotId: number; sets: SetLog[] }) {
  const { spanMs, rests } = exerciseTimes(slotId, sets);
  const parts = [
    spanMs !== null ? formatDuration(spanMs) : null,
    rests.length > 0 ? `${rests.length === 1 ? 'descanso' : 'descansos'} ${rests.map(formatRest).join(' · ')}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <AppText variant="caption" tabular>
      {parts.join(' · ')}
    </AppText>
  );
}

/**
 * The warm-up and the rests between sets, against the plan (PLAN.md §6.4): medians, so a phone call
 * does not sink the figure; rests longer than 10 min are told apart.
 */
function TimesSection({ times }: { times: SessionTimes }) {
  const { warmupMs, rests, interruptions } = times;
  if (warmupMs === null && rests.medianMs === null) return null;
  return (
    <Section label="Tiempos">
      <ListGroup>
        {warmupMs !== null ? <ListRow title="Calentamiento" right={formatMinutes(warmupMs)} /> : null}
        {rests.medianMs !== null ? (
          <ListRow
            title="Descanso entre series"
            subtitle={
              <AppText variant="secondary">
                {[`Mediana de ${rests.count}`, rests.overPlanMs !== null ? formatOverPlan(rests.overPlanMs) : null].filter(Boolean).join(' · ')}
              </AppText>
            }
            right={formatRest(rests.medianMs)}
          />
        ) : null}
      </ListGroup>
      {interruptions.length > 0 ? (
        <AppText variant="caption">
          {interruptions.length === 1
            ? `No cuenta 1 descanso de ${formatMinutes(interruptions[0])}`
            : `No cuentan ${interruptions.length} descansos de más de 10 min`}
        </AppText>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minHeight: 40 },
  nameBlock: { flex: 1, gap: 2 },
  cells: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: {
    width: 64,
    minHeight: 64,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
});
