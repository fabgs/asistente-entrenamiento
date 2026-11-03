import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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
  type IconName,
} from '@/components/ui';
import { cardioForWeekday, cardioLogOn, setCardioDone, type CardioActivity, type CardioDone } from '@/db/repositories/cardio';
import { getActiveCardioSession } from '@/db/repositories/cardioSessions';
import { listRoutines, listSlots, type Routine, type Slot } from '@/db/repositories/routines';
import {
  discardSession,
  finishedRoutinesOn,
  finishSession,
  getActiveSession,
  openNextSet,
  startSession,
  type SessionSummaryRow,
} from '@/db/repositories/sessions';
import { getProfile, getSettings, latestWeight, toProgressionSettings } from '@/db/repositories/settings';
import { listOpenChanges } from '@/db/repositories/weightChanges';
import { describePlan, PLAN_KIND_LABEL } from '@/domain/cardioPlan';
import { formatDuration, formatLongDate } from '@/domain/format';
import { isoWeekdayOf, localDateString, WEEKDAY_NAMES } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { maybeAutoBackup } from '@/services/backup';
import { GPS_ERROR_MESSAGE, startCardio } from '@/services/cardioSession';
import { cancelRestEnd } from '@/services/restTimer';
import { colors, spacing } from '@/theme';

const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

/** "a, b y c" */
const listInSpanish = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : (items[0] ?? '');

const TRACKING_ICON: Record<CardioActivity['tracking'], IconName> = {
  gps: 'walk',
  timer: 'timer-outline',
  check: 'check-circle-outline',
};

export default function TodayScreen() {
  const db = useDb();
  const navigation = useNavigation();
  const [choosing, setChoosing] = useState(false);
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
  const start = async (routine: Routine) => {
    setChoosing(false);
    await openWorkout(data.active ? data.active.id : await startSession(db, routine.id, new Date()));
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
    showDialog('Entreno sin terminar', `${active.routineName ?? 'Sesión'} del ${active.date}`, [
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
    !data.profile.birthDate && 'la fecha de nacimiento',
    !data.profile.heightCm && 'la altura',
    !data.weightKg && 'el peso',
  ].filter((m): m is string => !!m);
  const pendingCardio = data.cardio.filter((c) => !data.cardioDone.has(c.id));
  const doneCardio = data.cardio.filter((c) => data.cardioDone.has(c.id));
  const pendingRoutines = data.today.filter((r) => !data.routinesDone.has(r.id));
  const doneRoutines = data.today.filter((r) => data.routinesDone.has(r.id));
  // A routine done today from another day also counts.
  const extraDone = data.others.filter((r) => data.routinesDone.has(r.id));
  const nothingPending = pendingCardio.length === 0 && pendingRoutines.length === 0;
  const stale = !!data.active && data.now.getTime() - data.active.startedAt > STALE_SESSION_MS;
  // The routine card already has "Continuar entreno" when today's routine is the one running.
  const showActiveCard = !!data.active && (stale || !pendingRoutines.some((r) => r.id === data.active!.routineId));
  const hasDone = doneCardio.length + doneRoutines.length + extraDone.length > 0;

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
      {!data.hasRoutines && data.cardio.length === 0 ? (
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
              <AppText variant="secondary">{data.active.routineName}</AppText>
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
            left={<Icon name={data.activeCardio.tracking === 'gps' ? 'walk' : 'timer-outline'} size={22} color={colors.accent} />}
            title={data.activeCardio.name}
            subtitle={data.activeCardio.pausedAt ? 'En pausa' : 'Grabando'}
            right={<Tag label="En curso" tone="info" />}
          />
        </ListGroup>
      ) : null}

      {nothingPending ? (
        hasDone ? (
          <EmptyState icon="check-circle-outline" title="Todo hecho por hoy" text="Lo de hoy está abajo." />
        ) : data.hasRoutines && data.today.length === 0 && data.cardio.length === 0 ? (
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
              startLabel={data.active ? 'Continuar entreno' : 'Empezar rutina'}
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
            {[...doneRoutines, ...extraDone].map((r) => (
              <DoneRoutineRow key={`r${r.id}`} routine={r} done={data.routinesDone.get(r.id)!} />
            ))}
            {doneCardio.map((c) => (
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

      {data.others.length > 0 && !data.active ? (
        <ListGroup>
          <ListRow
            onPress={() => setChoosing(true)}
            left={<Icon name="swap-horizontal" size={22} color={colors.muted} />}
            title="Entrenar otra rutina"
          />
        </ListGroup>
      ) : null}

      <Sheet visible={choosing} title="Entrenar otra rutina" onClose={() => setChoosing(false)}>
        <ListGroup style={{ backgroundColor: colors.cardAlt }}>
          {data.others.map((r) => {
            const slots = data.slotsByRoutine.get(r.id) ?? [];
            const days = r.weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ');
            return (
              <ListRow
                key={r.id}
                onPress={() => start(r)}
                title={r.name}
                subtitle={`${days ? `${days} · ` : ''}${slots.length} ejercicios`}
              />
            );
          })}
        </ListGroup>
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
  const details =
    activity.tracking === 'timer' && activity.plan
      ? activity.plan.kind === 'liss'
        ? PLAN_KIND_LABEL.liss
        : `${PLAN_KIND_LABEL[activity.plan.kind]} · ${describePlan(activity.plan)}`
      : activity.intensity;
  // The target goes under the name: next to the check, the icon and «Iniciar» there is no room for both.
  const subtitle = done?.value ?? ([activity.target, details, activity.notes].filter(Boolean).join(' · ') || undefined);
  const sessionId = done?.sessionId;
  const title = activity.name;

  return (
    <ListRow
      onPress={sessionId ? () => router.push(`/cardio-sesion/${sessionId}`) : undefined}
      left={
        done ? (
          <CheckMark done onPress={onToggle} />
        ) : (
          <View style={styles.cardioLeft}>
            <CheckMark done={false} onPress={onToggle} />
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

function DoneRoutineRow({ routine, done }: { routine: Routine; done: SessionSummaryRow }) {
  const duration = done.finishedAt ? formatDuration(done.finishedAt - done.startedAt) : null;
  return (
    <ListRow
      onPress={() => router.push(`/workout/resumen/${done.id}`)}
      left={<Icon name="check-circle" size={22} color={colors.primary} />}
      title={<AppText variant="rowTitle" style={{ color: colors.muted }}>{done.title ?? routine.name}</AppText>}
      subtitle={[duration, done.setCount === 1 ? '1 serie' : `${done.setCount} series`].filter(Boolean).join(' · ')}
    />
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardioLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
