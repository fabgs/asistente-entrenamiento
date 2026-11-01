import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { OpenChange } from '@/components/Recommendation';
import { AppText, Button, Card, Chip, Loading, Row, Screen } from '@/components/ui';
import { cardioDoneOn, cardioForWeekday, setCardioDone, type CardioActivity } from '@/db/repositories/cardio';
import { isBodyweight, listRoutines, listSlots, type Routine, type Slot } from '@/db/repositories/routines';
import { discardSession, finishSession, getActiveSession, startSession } from '@/db/repositories/sessions';
import { getProfile, getSettings, toProgressionSettings } from '@/db/repositories/settings';
import { applyChange, listOpenChanges, type WeightChange } from '@/db/repositories/weightChanges';
import { formatLoad, formatLongDate, formatTarget } from '@/domain/format';
import { isoWeekdayOf, localDateString } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { cancelRestEnd } from '@/services/restTimer';
import { colors, spacing } from '@/theme';

const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

export default function TodayScreen() {
  const db = useDb();
  const [showOthers, setShowOthers] = useState(false);
  const { data, reload } = useLoader(async (db) => {
    const now = new Date();
    const weekday = isoWeekdayOf(now);
    const routines = await listRoutines(db);
    const slotsByRoutine = new Map<number, Slot[]>();
    for (const r of routines) slotsByRoutine.set(r.id, await listSlots(db, r.id));
    return {
      now,
      date: localDateString(now),
      today: routines.filter((r) => r.weekdays.includes(weekday)),
      others: routines.filter((r) => !r.weekdays.includes(weekday)),
      slotsByRoutine,
      openChanges: await listOpenChanges(db),
      cardio: await cardioForWeekday(db, weekday),
      cardioDone: await cardioDoneOn(db, localDateString(now)),
      active: await getActiveSession(db),
      profile: await getProfile(db),
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

  const closeStale = () => {
    const active = data.active!;
    Alert.alert('Entrenamiento sin terminar', `${active.routineName ?? 'Sesión'} del ${active.date}`, [
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
        },
      },
    ]);
  };

  const title = formatLongDate(data.now);

  return (
    <Screen>
      <AppText variant="title">{title}</AppText>

      {!data.profile.birthDate ? (
        <Pressable onPress={() => router.push('/perfil')}>
          <Card style={{ borderColor: colors.warning }}>
            <AppText variant="heading">Completa tu perfil</AppText>
            <AppText variant="muted">Falta tu fecha de nacimiento para calcular calorías y macros.</AppText>
          </Card>
        </Pressable>
      ) : null}

      {data.active ? (
        <Card style={{ borderColor: colors.primary }}>
          <AppText variant="heading">Entrenamiento en curso</AppText>
          <AppText variant="muted">{data.active.routineName}</AppText>
          <Button big title="Continuar entrenamiento" onPress={() => router.push(`/workout/${data.active!.id}`)} />
          {data.now.getTime() - data.active.startedAt > STALE_SESSION_MS ? (
            <Button kind="secondary" title="Terminar o descartar…" onPress={closeStale} />
          ) : null}
        </Card>
      ) : null}

      {data.today.length === 0 ? (
        <Card>
          <AppText variant="heading">Hoy no tocan pesas</AppText>
          <AppText variant="muted">Si quieres, puedes entrenar otra rutina.</AppText>
        </Card>
      ) : (
        data.today.map((routine) => (
          <RoutineCard
            key={routine.id}
            routine={routine}
            slots={data.slotsByRoutine.get(routine.id) ?? []}
            openChanges={data.openChanges}
            onStart={() => start(routine)}
            startLabel={data.active ? 'Continuar entrenamiento' : 'Empezar rutina'}
            onChanged={reload}
          />
        ))
      )}

      {data.cardio.length > 0 ? (
        <Card>
          <AppText variant="heading">Cardio</AppText>
          {data.cardio.map((c) => {
            const done = data.cardioDone.has(c.id);
            return (
              <Pressable key={c.id} onPress={() => toggleCardio(c)} style={styles.cardioRow}>
                <View style={[styles.check, done && styles.checkDone]}>
                  {done ? <AppText style={{ color: colors.onPrimary, fontWeight: '800' }}>✓</AppText> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <AppText style={done ? styles.doneText : undefined}>
                    {c.name}
                    {c.target ? ` · ${c.target}` : ''}
                  </AppText>
                  {c.intensity || c.notes ? (
                    <AppText variant="small">{[c.intensity, c.notes].filter(Boolean).join(' · ')}</AppText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Card>
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

function RoutineCard({
  routine,
  slots,
  openChanges,
  onStart,
  startLabel,
  onChanged,
}: {
  routine: Routine;
  slots: Slot[];
  openChanges: WeightChange[];
  onStart: () => void;
  startLabel: string;
  onChanged: () => void;
}) {
  const db = useDb();
  const openHere = openChanges.filter((c) => slots.some((s) => s.id === c.slotId));
  const pendingHere = openHere.filter((c) => c.status === 'pending');

  const applyAll = async () => {
    for (const change of pendingHere) await applyChange(db, change.id);
    onChanged();
  };

  return (
    <Card>
      <AppText variant="heading">{routine.name}</AppText>
      {slots.map((slot) => {
        const change = openHere.find((c) => c.slotId === slot.id);
        return (
          <View key={slot.id} style={styles.slotRow}>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText style={{ flex: 1 }}>{slot.exerciseName}</AppText>
              <AppText variant="muted">{formatLoad(slot.weightKg, isBodyweight(slot))}</AppText>
            </Row>
            <AppText variant="small">
              {slot.sets} × {formatTarget(slot.target, slot.unit, slot.perSide)}
            </AppText>
            {change ? <OpenChange change={change} onChanged={onChanged} /> : null}
          </View>
        );
      })}
      {pendingHere.length > 1 ? (
        <Button kind="secondary" title={`Aplicar todas (${pendingHere.length})`} onPress={applyAll} />
      ) : null}
      <Button big title={startLabel} onPress={onStart} />
    </Card>
  );
}

const styles = StyleSheet.create({
  slotRow: { gap: 2, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  cardioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  check: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  doneText: { color: colors.muted, textDecorationLine: 'line-through' },
});
