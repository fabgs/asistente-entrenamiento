import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { showDialog } from '@/components/Dialog';
import { OpenChange } from '@/components/Recommendation';
import { AppText, Button, Card, CheckMark, Chip, Icon, Loading, Row, Screen, SectionLabel } from '@/components/ui';
import { cardioForWeekday, cardioLogOn, setCardioDone, type CardioActivity, type CardioDone } from '@/db/repositories/cardio';
import { getActiveCardioSession } from '@/db/repositories/cardioSessions';
import { isBodyweight, listRoutines, listSlots, type Routine, type Slot } from '@/db/repositories/routines';
import {
  discardSession,
  finishedRoutinesOn,
  finishSession,
  getActiveSession,
  startSession,
  type SessionSummaryRow,
} from '@/db/repositories/sessions';
import { getProfile, getSettings, latestWeight, toProgressionSettings } from '@/db/repositories/settings';
import { applyChange, listOpenChanges, type WeightChange } from '@/db/repositories/weightChanges';
import { describePlan, PLAN_KIND_LABEL } from '@/domain/cardioPlan';
import { formatDuration, formatLoad, formatLongDate, formatTarget } from '@/domain/format';
import { isoWeekdayOf, localDateString } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { maybeAutoBackup } from '@/services/backup';
import { GPS_ERROR_MESSAGE, startCardio } from '@/services/cardioSession';
import { cancelRestEnd } from '@/services/restTimer';
import { colors, radius, spacing } from '@/theme';

const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

/** "a, b y c" */
const listInSpanish = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : (items[0] ?? '');

export default function TodayScreen() {
  const db = useDb();
  const [showOthers, setShowOthers] = useState(false);
  const { data, reload } = useLoader(async (db) => {
    const now = new Date();
    const weekday = isoWeekdayOf(now);
    const date = localDateString(now);
    const routines = await listRoutines(db);
    const slotsByRoutine = new Map<number, Slot[]>();
    for (const r of routines) slotsByRoutine.set(r.id, await listSlots(db, r.id));
    return {
      now,
      date,
      today: routines.filter((r) => r.weekdays.includes(weekday)),
      others: routines.filter((r) => !r.weekdays.includes(weekday)),
      slotsByRoutine,
      openChanges: await listOpenChanges(db),
      cardio: await cardioForWeekday(db, weekday),
      cardioDone: await cardioLogOn(db, date),
      routinesDone: await finishedRoutinesOn(db, date),
      active: await getActiveSession(db),
      activeCardio: await getActiveCardioSession(db),
      profile: await getProfile(db),
      weightKg: await latestWeight(db),
      hasRoutines: routines.length > 0,
      devMode: (await getSettings(db)).devMode,
    };
  });

  if (!data) return <Loading />;

  const start = async (routine: Routine) => {
    if (data.active) {
      router.push(`/workout/${data.active.id}`);
      return;
    }
    const id = await startSession(db, routine.id, new Date());
    router.push(`/workout/${id}`);
  };

  const toggleCardio = async (activity: CardioActivity) => {
    await setCardioDone(db, data.date, activity, !data.cardioDone.has(activity.id));
    reload();
  };

  const startTracked = async (activity: CardioActivity) => {
    if (data.activeCardio) {
      router.push(`/cardio-sesion/${data.activeCardio.id}`);
      return;
    }
    const result = await startCardio(db, activity);
    if ('error' in result) {
      showDialog('No se puede grabar la ruta', GPS_ERROR_MESSAGE[result.error]);
      return;
    }
    router.push(`/cardio-sesion/${result.sessionId}`);
  };

  const closeStale = () => {
    const active = data.active!;
    showDialog('Entrenamiento sin terminar', `${active.routineName ?? 'Sesión'} del ${active.date}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          await cancelRestEnd(active.id);
          await discardSession(db, active.id);
          reload();
        },
      },
      {
        text: 'Terminar',
        onPress: async () => {
          await cancelRestEnd(active.id);
          await finishSession(db, active.id, toProgressionSettings(await getSettings(db)));
          router.push(`/workout/resumen/${active.id}`);
          maybeAutoBackup(db);
        },
      },
    ]);
  };

  const missingProfile = [
    !data.profile.birthDate && 'tu fecha de nacimiento',
    !data.profile.heightCm && 'tu altura',
    !data.weightKg && 'tu peso',
  ].filter((m): m is string => !!m);
  const pendingCardio = data.cardio.filter((c) => !data.cardioDone.has(c.id));
  const doneCardio = data.cardio.filter((c) => data.cardioDone.has(c.id));
  const pendingRoutines = data.today.filter((r) => !data.routinesDone.has(r.id));
  const doneRoutines = data.today.filter((r) => data.routinesDone.has(r.id));
  // A routine done today from another day also counts.
  const extraDone = data.others.filter((r) => data.routinesDone.has(r.id));
  const nothingPending = pendingCardio.length === 0 && pendingRoutines.length === 0;
  const stale = !!data.active && data.now.getTime() - data.active.startedAt > STALE_SESSION_MS;
  // The routine card already has "Continuar entrenamiento" when today's routine is the one running.
  const showActiveCard = !!data.active && (stale || !pendingRoutines.some((r) => r.id === data.active!.routineId));
  const hasDone = doneCardio.length + doneRoutines.length + extraDone.length > 0;

  const cardioItem = (c: CardioActivity) => (
    <CardioItem
      key={c.id}
      activity={c}
      done={data.cardioDone.get(c.id) ?? null}
      running={data.activeCardio?.activityId === c.id}
      onToggle={() => toggleCardio(c)}
      onStart={() => startTracked(c)}
    />
  );
  const routineCard = (r: Routine) => (
    <RoutineCard
      key={r.id}
      routine={r}
      slots={data.slotsByRoutine.get(r.id) ?? []}
      openChanges={data.openChanges}
      done={data.routinesDone.get(r.id) ?? null}
      onStart={() => start(r)}
      startLabel={data.active ? 'Continuar entrenamiento' : 'Empezar rutina'}
      running={data.active?.routineId === r.id}
      onChanged={reload}
    />
  );

  return (
    <Screen>
      <AppText variant="title">{formatLongDate(data.now)}</AppText>

      {data.devMode ? (
        <Pressable onPress={() => router.push('/ajustes')}>
          <AppText variant="small" style={{ color: colors.warning }}>
            Modo pruebas activo: los datos se borran al instalar una versión nueva.
          </AppText>
        </Pressable>
      ) : null}

      {missingProfile.length > 0 ? (
        <Pressable onPress={() => router.push('/perfil')}>
          <Card style={{ borderColor: colors.warning }}>
            <AppText variant="heading">Completa tu perfil</AppText>
            <AppText variant="muted">
              {missingProfile.length > 1 ? 'Faltan' : 'Falta'} {listInSpanish(missingProfile)} para calcular calorías y macros.
            </AppText>
          </Card>
        </Pressable>
      ) : null}

      {!data.hasRoutines && data.cardio.length === 0 ? (
        <Card>
          <AppText variant="heading">Monta tu semana</AppText>
          <AppText variant="muted">
            Crea tus rutinas con los ejercicios del catálogo y asígnales días; añade el cardio de cada día. Aquí verás lo
            que toca hoy.
          </AppText>
          <Button title="Crear una rutina" icon="dumbbell" onPress={() => router.push('/rutinas')} />
          <Button kind="secondary" title="Añadir cardio" icon="run" onPress={() => router.push('/cardio')} />
        </Card>
      ) : null}

      {data.active && showActiveCard ? (
        <Card style={{ borderColor: colors.primary }}>
          <Row style={{ flexWrap: 'nowrap' }}>
            <Icon name="dumbbell" color={colors.primary} />
            <View style={{ flex: 1 }}>
              <AppText variant="heading">Entrenamiento en curso</AppText>
              <AppText variant="muted">{data.active.routineName}</AppText>
            </View>
          </Row>
          <Button big title="Continuar entrenamiento" onPress={() => router.push(`/workout/${data.active!.id}`)} />
          {stale ? (
            <Button kind="secondary" title="Terminar o descartar…" onPress={closeStale} />
          ) : null}
        </Card>
      ) : null}

      {data.activeCardio ? (
        <Pressable onPress={() => router.push(`/cardio-sesion/${data.activeCardio!.id}`)}>
          <Card style={{ borderColor: colors.accent }}>
            <Row style={{ flexWrap: 'nowrap' }}>
              <Icon name={data.activeCardio.tracking === 'gps' ? 'map-marker-path' : 'timer-outline'} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <AppText variant="heading">{data.activeCardio.name} en curso</AppText>
                <AppText variant="muted">{data.activeCardio.pausedAt ? 'En pausa' : 'Toca para ver cómo vas'}</AppText>
              </View>
              <Icon name="chevron-right" color={colors.muted} />
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {nothingPending ? (
        hasDone ? (
          <Card>
            <AppText variant="heading">Todo hecho por hoy</AppText>
            <AppText variant="muted">Buen trabajo. Lo de hoy está abajo.</AppText>
          </Card>
        ) : data.hasRoutines && data.today.length === 0 && data.cardio.length === 0 ? (
          <Card>
            <AppText variant="heading">Día de descanso</AppText>
            <AppText variant="muted">Hoy no hay nada programado. Si te apetece, entrena otra rutina.</AppText>
          </Card>
        ) : null
      ) : (
        <>
          <SectionLabel>Para hoy</SectionLabel>
          {pendingCardio.map(cardioItem)}
          {pendingRoutines.map(routineCard)}
          {data.today.length === 0 ? (
            <AppText variant="muted">Hoy no tocan pesas.</AppText>
          ) : null}
        </>
      )}

      {hasDone ? (
        <>
          <SectionLabel>Hecho</SectionLabel>
          {[...doneRoutines, ...extraDone].map(routineCard)}
          {doneCardio.map(cardioItem)}
        </>
      ) : null}

      {data.others.length > 0 && !data.active ? (
        <View style={{ gap: spacing.sm }}>
          <Button kind="ghost" title={showOthers ? 'Ocultar otras rutinas' : 'Entrenar otra rutina'} onPress={() => setShowOthers(!showOthers)} />
          {showOthers ? (
            <Row>
              {data.others.map((r) => (
                <Chip key={r.id} label={r.name} onPress={() => start(r)} />
              ))}
            </Row>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function CardioItem({
  activity,
  done,
  running,
  onToggle,
  onStart,
}: {
  activity: CardioActivity;
  done: CardioDone | null;
  running: boolean;
  onToggle: () => void;
  onStart: () => void;
}) {
  const details =
    activity.tracking === 'timer' && activity.plan
      ? activity.plan.kind === 'liss'
        ? PLAN_KIND_LABEL.liss
        : `${PLAN_KIND_LABEL[activity.plan.kind]} · ${describePlan(activity.plan)}`
      : activity.intensity;
  const subtitle = done?.value ?? [details, activity.notes].filter(Boolean).join(' · ');
  const sessionId = done?.sessionId;

  return (
    <Card style={[styles.item, done && styles.doneItem]}>
      <CheckMark done={!!done} onPress={onToggle} />
      <Pressable
        style={{ flex: 1, gap: 2 }}
        disabled={!sessionId}
        onPress={() => router.push(`/cardio-sesion/${sessionId}`)}>
        <AppText style={[styles.itemTitle, done && styles.doneText]}>
          {activity.name}
          {activity.target ? ` · ${activity.target}` : ''}
        </AppText>
        {subtitle ? <AppText variant="small">{subtitle}</AppText> : null}
      </Pressable>
      {!done && activity.tracking !== 'check' ? (
        <Button
          kind={running ? 'primary' : 'secondary'}
          icon={running ? 'chevron-right' : activity.tracking === 'gps' ? 'map-marker-path' : 'timer-outline'}
          title={running ? 'Ver' : 'Iniciar'}
          onPress={onStart}
        />
      ) : null}
      {sessionId ? <Icon name="chevron-right" color={colors.muted} /> : null}
    </Card>
  );
}

function RoutineCard({
  routine,
  slots,
  openChanges,
  done,
  onStart,
  startLabel,
  running,
  onChanged,
}: {
  routine: Routine;
  slots: Slot[];
  openChanges: WeightChange[];
  done: SessionSummaryRow | null;
  onStart: () => void;
  startLabel: string;
  running: boolean;
  onChanged: () => void;
}) {
  const db = useDb();
  const [expanded, setExpanded] = useState(false);
  const openHere = openChanges.filter((c) => slots.some((s) => s.id === c.slotId));
  const pendingHere = openHere.filter((c) => c.status === 'pending');
  const totalSets = slots.reduce((sum, s) => sum + s.sets, 0);

  const applyAll = async () => {
    for (const change of pendingHere) await applyChange(db, change.id);
    onChanged();
  };

  const summary = done
    ? `Hecha · ${done.finishedAt ? formatDuration(done.finishedAt - done.startedAt) : ''} · ${done.setCount} series`
    : running
      ? 'En curso'
      : `${slots.length} ejercicios · ${totalSets} series`;

  return (
    <Card style={done ? styles.doneItem : running ? { borderColor: colors.primary } : undefined}>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={styles.routineHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityHint="Muestra u oculta los ejercicios">
        <CheckMark done={!!done} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="heading">{routine.name}</AppText>
          <AppText variant="small">{summary}</AppText>
          {!done && pendingHere.length > 0 && !expanded ? (
            <AppText variant="small" style={{ color: colors.warning }}>
              {pendingHere.length === 1 ? '1 cambio de peso por decidir' : `${pendingHere.length} cambios de peso por decidir`}
            </AppText>
          ) : null}
        </View>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={28} color={colors.muted} />
      </Pressable>

      {!done ? <Button big title={startLabel} icon="play" onPress={onStart} /> : null}

      {expanded ? (
        <View>
          {slots.map((slot) => {
            const change = openHere.find((c) => c.slotId === slot.id);
            return (
              <View key={slot.id} style={styles.slotRow}>
                <Row between>
                  <AppText style={{ flex: 1 }}>{slot.exerciseName}</AppText>
                  <AppText variant="muted">{formatLoad(slot.weightKg, isBodyweight(slot))}</AppText>
                </Row>
                <AppText variant="small">
                  {slot.sets} × {formatTarget(slot.target, slot.unit, slot.perSide)}
                </AppText>
                {change && !done ? <OpenChange change={change} onChanged={onChanged} /> : null}
              </View>
            );
          })}
          {!done && pendingHere.length > 1 ? (
            <Button kind="secondary" title={`Aplicar todas (${pendingHere.length})`} onPress={applyAll} />
          ) : null}
        </View>
      ) : null}

      {done ? (
        <Button kind="ghost" title="Ver resumen" onPress={() => router.push(`/workout/resumen/${done.id}`)} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemTitle: { fontWeight: '600' },
  doneItem: { backgroundColor: colors.bg, borderStyle: 'dashed' },
  doneText: { color: colors.muted, textDecorationLine: 'line-through' },
  routineHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  slotRow: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderRadius: radius.sm,
  },
});
