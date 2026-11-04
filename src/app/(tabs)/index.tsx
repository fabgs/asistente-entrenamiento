import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { showDialog } from '@/components/Dialog';
import { RoutineCard } from '@/components/RoutineCard';
import { Sheet } from '@/components/Sheet';
import {
  AppText,
  Button,
  Card,
  CheckMark,
  EmptyState,
  Icon,
  ListGroup,
  ListRow,
  Loading,
  RowIcon,
  Screen,
  Section,
  Tag,
  TRACKING_ICON,
  useBusy,
} from '@/components/ui';
import { cardioLogOn, listCardio, setCardioDone, type CardioActivity, type CardioDone } from '@/db/repositories/cardio';
import { getActiveCardioSession, getCardioSession } from '@/db/repositories/cardioSessions';
import { listRoutines, listSlots, type Routine, type Slot } from '@/db/repositories/routines';
import {
  discardSession,
  finishedSessionsOn,
  finishSession,
  getActiveSession,
  openNextSet,
  startSession,
  type SessionSummaryRow,
} from '@/db/repositories/sessions';
import { getProfile, getSettings, latestWeight, toProgressionSettings } from '@/db/repositories/settings';
import { listOpenChanges } from '@/db/repositories/weightChanges';
import { sharesLockCountdown, trackingDetails } from '@/domain/cardioPlan';
import { cardioPool, doneOnOtherDays } from '@/domain/cardioPool';
import { formatDuration, formatLongDate, workoutTitle } from '@/domain/format';
import { allDoneMessage, isoWeekdayOf, localDateString, weekdaysLabel } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { maybeAutoBackup } from '@/services/backup';
import { discardCardio, GPS_ERROR_MESSAGE, startCardio } from '@/services/cardioSession';
import { cancelRestEnd } from '@/services/restTimer';
import { clearWorkoutInProgress } from '@/services/workoutInProgress';
import { colors, spacing } from '@/theme';

const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

/** "a, b y c" */
const listInSpanish = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : (items[0] ?? '');

export default function TodayScreen() {
  const db = useDb();
  const navigation = useNavigation();
  const [sheet, setSheet] = useState<'routine' | 'cardio' | null>(null);
  const [, run] = useBusy();
  const { data, reload } = useLoader(async (db) => {
    const now = new Date();
    const weekday = isoWeekdayOf(now);
    const date = localDateString(now);
    const routines = await listRoutines(db);
    const slotsByRoutine = new Map<number, Slot[]>();
    for (const r of routines) slotsByRoutine.set(r.id, await listSlots(db, r.id));
    const allCardio = await listCardio(db);
    return {
      now,
      date,
      weekday,
      today: routines.filter((r) => r.weekdays.includes(weekday)),
      others: routines.filter((r) => !r.weekdays.includes(weekday)),
      slotsByRoutine,
      openChanges: await listOpenChanges(db),
      allCardio,
      cardio: allCardio.filter((c) => c.weekday === weekday),
      cardioDone: await cardioLogOn(db, date),
      workoutsDone: await finishedSessionsOn(db, date),
      active: await getActiveSession(db),
      activeCardio: await getActiveCardioSession(db),
      profile: await getProfile(db),
      weightKg: await latestWeight(db),
      hasRoutines: routines.length > 0,
      devMode: (await getSettings(db)).devMode,
    };
  });

  // The date is the title of the tab; with test mode on, a tag next to it says so.
  const title = data ? formatLongDate(data.now) : 'Hoy';
  const devMode = !!data?.devMode;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: title,
      headerRight: devMode
        ? () => (
            <Pressable
              onPress={() => router.push('/ajustes')}
              hitSlop={8}
              style={{ marginRight: spacing.lg }}
              accessibilityRole="button"
              accessibilityLabel="Modo pruebas activo"
              accessibilityHint="Abre los ajustes">
              <Tag label="Pruebas" tone="warning" icon="flask-outline" />
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, title, devMode]);

  if (!data) return <Loading />;

  // Starting or continuing goes straight to the set to do next.
  const openWorkout = async (sessionId: number) => {
    await openNextSet(db, sessionId);
    router.push(`/workout/${sessionId}`);
  };

  /** Sprints and the timer by phases share the lock-screen countdown with the rests: never with a workout. */
  const blockedByLockCardio = (): boolean => {
    const c = data.activeCardio;
    if (!c || !sharesLockCountdown(c.tracking)) return false;
    const sprints = c.tracking === 'sprint';
    showDialog(
      sprints ? 'Hay sprints en curso' : 'Hay un cardio en curso',
      sprints ? 'Termínalos antes de empezar el entreno.' : `Termina «${c.name}» antes de empezar el entreno.`,
      [
        { text: sprints ? 'Ver sprints' : 'Ver cardio', onPress: () => router.push(`/cardio-sesion/${c.id}`) },
        { text: 'Cancelar', style: 'cancel' },
      ],
    );
    return true;
  };

  const start = async (routine: Routine) => {
    setSheet(null);
    const active = data.active;
    if (active) {
      if (active.routineId === routine.id) return openWorkout(active.id);
      showDialog('Hay un entreno en curso', `Termina «${workoutTitle(active)}» antes de empezar otro.`, [
        { text: 'Ver entreno', onPress: () => openWorkout(active.id) },
        { text: 'Cancelar', style: 'cancel' },
      ]);
      return;
    }
    if (blockedByLockCardio()) return;
    await openWorkout(await startSession(db, routine.id, new Date()));
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
    const workout = data.active;
    if (sharesLockCountdown(activity.tracking) && workout) {
      showDialog(
        'Hay un entreno en curso',
        activity.tracking === 'sprint' ? 'Termínalo antes de empezar los sprints.' : `Termínalo antes de empezar «${activity.name}».`,
        [
          { text: 'Ver entreno', onPress: () => openWorkout(workout.id) },
          { text: 'Cancelar', style: 'cancel' },
        ],
      );
      return;
    }
    const result = await startCardio(db, activity);
    if ('error' in result) {
      showDialog('No se puede grabar la ruta', GPS_ERROR_MESSAGE[result.error]);
      return;
    }
    const { sessionId, gpsError } = result;
    if (gpsError) {
      // Sprints can still be timed without GPS.
      showDialog('No hay GPS', `${GPS_ERROR_MESSAGE[gpsError]} Sin GPS solo se mide el tiempo.`, [
        { text: 'Seguir sin GPS', onPress: () => router.push(`/cardio-sesion/${sessionId}`) },
        {
          text: 'Cancelar',
          style: 'cancel',
          onPress: async () => {
            const session = await getCardioSession(db, sessionId);
            if (session) await discardCardio(db, session);
            reload();
          },
        },
      ]);
      return;
    }
    router.push(`/cardio-sesion/${sessionId}`);
  };

  /** A cardio of the pool: checked off at once, or started like today's. */
  const pickCardio = (activity: CardioActivity) =>
    run(async () => {
      setSheet(null);
      if (activity.tracking === 'check') {
        await setCardioDone(db, data.date, activity, true);
        reload();
      } else {
        await startTracked(activity);
      }
    })();

  const closeStale = () => {
    const active = data.active!;
    showDialog('Entreno sin terminar', `${workoutTitle(active)} del ${active.date}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          clearWorkoutInProgress();
          await cancelRestEnd(active.id);
          await discardSession(db, active.id);
          reload();
        },
      },
      {
        text: 'Terminar',
        onPress: async () => {
          clearWorkoutInProgress();
          await cancelRestEnd(active.id);
          const result = await finishSession(db, active.id, toProgressionSettings(await getSettings(db)));
          if (result === 'discarded') {
            reload();
            return;
          }
          router.push(`/workout/resumen/${active.id}`);
          maybeAutoBackup(db);
        },
      },
    ]);
  };

  const missingProfile = [
    !data.profile.birthDate && 'la fecha de nacimiento',
    !data.profile.heightCm && 'la altura',
    !data.weightKg && 'el peso',
  ].filter((m): m is string => !!m);
  const doneIds = new Set(data.cardioDone.keys());
  const pendingCardio = data.cardio.filter((c) => !doneIds.has(c.id));
  const doneCardio = data.cardio.filter((c) => doneIds.has(c.id));
  // Cardio of other days done today (from the pool) also counts as done.
  const extraCardio = doneOnOtherDays(data.allCardio, data.weekday, doneIds);
  const doneRoutineIds = new Set(data.workoutsDone.map((s) => s.routineId));
  const pendingRoutines = data.today.filter((r) => !doneRoutineIds.has(r.id));
  const pool = cardioPool(data.allCardio, data.weekday, doneIds);
  const hasSlots = [...data.slotsByRoutine.values()].some((s) => s.length > 0);
  const nothingPending = pendingCardio.length === 0 && pendingRoutines.length === 0;
  const stale = !!data.active && data.now.getTime() - data.active.startedAt > STALE_SESSION_MS;
  // The routine card already has "Continuar entreno" when today's routine is the one running.
  const showActiveCard = !!data.active && (stale || !pendingRoutines.some((r) => r.id === data.active!.routineId));
  const hasDone = data.workoutsDone.length + doneCardio.length + extraCardio.length > 0;
  const showPoolRow = pool.length > 0 && !data.activeCardio;
  const showRoutineRow = data.others.length > 0 && !data.active;
  const showLooseRow = hasSlots && !data.active;

  const profileRow =
    missingProfile.length > 0 ? (
      <ListGroup>
        <ListRow
          onPress={() => router.push('/perfil')}
          left={<Icon name="account-alert-outline" size={22} color={colors.warning} />}
          title="Completa tu perfil"
          subtitle={`${missingProfile.length > 1 ? 'Faltan' : 'Falta'} ${listInSpanish(missingProfile)}`}
        />
      </ListGroup>
    ) : null;

  return (
    <Screen>
      {!data.hasRoutines && data.allCardio.length === 0 ? (
        <EmptyState
          icon="calendar-blank-outline"
          title="Monta tu semana"
          text="Crea tus rutinas con ejercicios del catálogo, asígnales días y añade el cardio. Aquí verás lo que toca hoy."
          action={
            <View style={{ alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button title="Crear una rutina" icon="dumbbell" onPress={() => router.push('/rutinas')} />
              <Button kind="secondary" title="Añadir cardio" icon="walk" onPress={() => router.push('/cardio')} />
            </View>
          }
        />
      ) : null}

      {data.active && showActiveCard ? (
        <Card>
          <View style={styles.headRow}>
            <RowIcon name="dumbbell" color={colors.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="heading">Entreno en curso</AppText>
              <AppText variant="secondary">{workoutTitle(data.active)}</AppText>
            </View>
          </View>
          <Button size="lg" icon="play" title="Continuar entreno" onPress={() => openWorkout(data.active!.id)} />
          {stale ? <Button kind="secondary" title="Terminar o descartar…" onPress={closeStale} /> : null}
        </Card>
      ) : null}

      {data.activeCardio ? (
        <ListGroup>
          <ListRow
            onPress={() => router.push(`/cardio-sesion/${data.activeCardio!.id}`)}
            left={<Icon name={TRACKING_ICON[data.activeCardio.tracking]} size={22} color={colors.accent} />}
            title={data.activeCardio.name}
            subtitle={
              data.activeCardio.sprint
                ? `${data.activeCardio.laps.filter((l) => l.stopAt !== null).length} de ${data.activeCardio.sprint.sprints} sprints`
                : data.activeCardio.pausedAt
                  ? 'En pausa'
                  : 'Grabando'
            }
            right={<Tag label="En curso" tone="info" />}
          />
        </ListGroup>
      ) : null}

      {nothingPending ? (
        hasDone ? (
          <EmptyState icon="check-circle-outline" title="Todo hecho por hoy" text={allDoneMessage(data.date)} />
        ) : data.today.length === 0 && data.cardio.length === 0 && (data.hasRoutines || data.allCardio.length > 0) ? (
          <EmptyState icon="sofa-outline" title="Día de descanso" text="Hoy no hay nada programado." />
        ) : null
      ) : (
        <Section label="Para hoy">
          {pendingCardio.length > 0 ? (
            <ListGroup>
              {pendingCardio.map((c) => (
                <CardioRow
                  key={c.id}
                  activity={c}
                  done={null}
                  running={data.activeCardio?.activityId === c.id}
                  onToggle={() => toggleCardio(c)}
                  onStart={() => startTracked(c)}
                />
              ))}
            </ListGroup>
          ) : null}
          {pendingRoutines.map((r) => (
            <RoutineCard
              key={r.id}
              mode="today"
              routine={r}
              slots={data.slotsByRoutine.get(r.id) ?? []}
              openChanges={data.openChanges}
              startLabel={data.active?.routineId === r.id ? 'Continuar entreno' : 'Empezar rutina'}
              state={data.active?.routineId === r.id ? 'running' : undefined}
              onStart={() => start(r)}
              onChanged={reload}
            />
          ))}
          {profileRow}
        </Section>
      )}
      {nothingPending ? profileRow : null}

      {hasDone ? (
        <Section label="Hecho">
          <ListGroup>
            {data.workoutsDone.map((s) => (
              <DoneWorkoutRow key={`w${s.id}`} done={s} />
            ))}
            {[...doneCardio, ...extraCardio].map((c) => (
              <CardioRow
                key={`c${c.id}`}
                activity={c}
                done={data.cardioDone.get(c.id) ?? null}
                running={false}
                onToggle={() => toggleCardio(c)}
                onStart={() => startTracked(c)}
              />
            ))}
          </ListGroup>
        </Section>
      ) : null}

      {showPoolRow || showRoutineRow || showLooseRow ? (
        <ListGroup>
          {showPoolRow ? (
            <ListRow onPress={() => setSheet('cardio')} left={<Icon name="run" size={22} color={colors.muted} />} title="Hacer otro cardio" />
          ) : null}
          {showRoutineRow ? (
            <ListRow
              onPress={() => setSheet('routine')}
              left={<Icon name="swap-horizontal" size={22} color={colors.muted} />}
              title="Entrenar otra rutina"
            />
          ) : null}
          {showLooseRow ? (
            <ListRow
              onPress={() => {
                if (!blockedByLockCardio()) router.push('/ejercicio-suelto');
              }}
              left={<Icon name="dumbbell" size={22} color={colors.muted} />}
              title="Hacer un ejercicio suelto"
            />
          ) : null}
        </ListGroup>
      ) : null}

      <Sheet visible={sheet === 'routine'} title="Entrenar otra rutina" onClose={() => setSheet(null)}>
        <ListGroup style={{ backgroundColor: colors.cardAlt }}>
          {data.others.map((r) => {
            const slots = data.slotsByRoutine.get(r.id) ?? [];
            return (
              <ListRow
                key={r.id}
                onPress={() => start(r)}
                title={r.name}
                subtitle={`${r.weekdays.length ? `${weekdaysLabel(r.weekdays)} · ` : ''}${slots.length} ejercicios`}
              />
            );
          })}
        </ListGroup>
      </Sheet>

      <Sheet visible={sheet === 'cardio'} title="Hacer otro cardio" onClose={() => setSheet(null)}>
        <ScrollView style={{ flexGrow: 0 }}>
          <ListGroup style={{ backgroundColor: colors.cardAlt }}>
            {pool.map(({ activity: a, weekdays }) => (
              <ListRow
                key={a.id}
                onPress={() => pickCardio(a)}
                left={<Icon name={TRACKING_ICON[a.tracking]} size={22} color={colors.muted} />}
                title={a.name}
                subtitle={
                  // The days on a line of their own: cut at the end of a long line, they were lost.
                  <View>
                    {a.target || trackingDetails(a) ? (
                      <AppText variant="secondary" numberOfLines={1}>
                        {[a.target, trackingDetails(a)].filter(Boolean).join(' · ')}
                      </AppText>
                    ) : null}
                    <AppText variant="secondary" numberOfLines={1}>
                      {weekdaysLabel(weekdays)}
                    </AppText>
                  </View>
                }
              />
            ))}
          </ListGroup>
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

function CardioRow({
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
  const details = trackingDetails(activity);
  // The target goes under the name: next to the check, the icon and «Iniciar» there is no room for both.
  const subtitle = done?.value ?? ([activity.target, details, activity.notes].filter(Boolean).join(' · ') || undefined);
  const sessionId = done?.sessionId;
  const title = activity.name;

  return (
    <ListRow
      onPress={sessionId ? () => router.push(`/cardio-sesion/${sessionId}`) : undefined}
      left={
        // Round like the routines done next to it in «Hecho».
        done ? (
          <CheckMark round done onPress={onToggle} />
        ) : (
          <View style={styles.cardioLeft}>
            <CheckMark round done={false} onPress={onToggle} />
            <Icon name={TRACKING_ICON[activity.tracking]} size={22} color={colors.muted} />
          </View>
        )
      }
      title={<AppText variant="rowTitle" style={done ? { color: colors.muted } : undefined}>{title}</AppText>}
      subtitle={subtitle}
      chevron={!!sessionId}
      right={
        !done && activity.tracking !== 'check' ? (
          <Button
            kind={running ? 'primary' : 'secondary'}
            icon={running ? 'chevron-right' : 'play'}
            title={running ? 'Ver' : 'Iniciar'}
            onPress={onStart}
          />
        ) : undefined
      }
    />
  );
}

/** A workout finished today: a routine (even one of another day, or twice) or a loose one. */
function DoneWorkoutRow({ done }: { done: SessionSummaryRow }) {
  const duration = done.finishedAt ? formatDuration(done.finishedAt - done.startedAt) : null;
  return (
    <ListRow
      onPress={() => router.push(`/workout/resumen/${done.id}`)}
      left={<Icon name="check-circle" size={22} color={colors.primary} />}
      title={<AppText variant="rowTitle" style={{ color: colors.muted }}>{workoutTitle(done)}</AppText>}
      subtitle={[duration, done.setCount === 1 ? '1 serie' : `${done.setCount} series`].filter(Boolean).join(' · ')}
    />
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardioLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
