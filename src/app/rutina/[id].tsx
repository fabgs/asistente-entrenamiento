import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { showDialog } from '@/components/Dialog';
import { AppText, Button, Card, Loading, Row, Screen, TextField, WeekdayPicker } from '@/components/ui';
import {
  archiveRoutine,
  getRoutine,
  isBodyweight,
  listSlots,
  moveSlot,
  renameRoutine,
  setRoutineWeekdays,
  type Routine,
} from '@/db/repositories/routines';
import { formatLoad, formatTarget } from '@/domain/format';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { rescheduleDailyReminders } from '@/services/dailyReminder';
import { colors, radius, spacing } from '@/theme';

export default function RoutineEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const routineId = Number(id);
  const db = useDb();

  const { data, reload } = useLoader(async (db) => {
    const routine = await getRoutine(db, routineId);
    return routine ? { routine, slots: await listSlots(db, routineId) } : null;
  });

  if (data === undefined) return <Loading />;
  if (data === null) {
    return (
      <Screen>
        <AppText>No se encontró la rutina.</AppText>
      </Screen>
    );
  }

  const move = async (slotId: number, delta: -1 | 1) => {
    await moveSlot(db, slotId, delta);
    reload();
  };

  const archive = () =>
    showDialog('Archivar rutina', `«${data.routine.name}» dejará de aparecer, pero se guarda su historial.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Archivar',
        style: 'destructive',
        onPress: async () => {
          await archiveRoutine(db, routineId);
          await rescheduleDailyReminders(db);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Editar rutina' }} />
      <RoutineForm key={`${data.routine.name}|${data.routine.weekdays.join()}`} routine={data.routine} onSaved={reload} />

      <Card>
        <AppText variant="heading">Ejercicios</AppText>
        {data.slots.length === 0 ? <AppText variant="muted">Aún no tiene ejercicios.</AppText> : null}
        {data.slots.map((slot, i) => (
          <View key={slot.id} style={styles.slotRow}>
            <Pressable style={{ flex: 1, gap: 2 }} onPress={() => router.push(`/slot/${slot.id}`)}>
              <AppText>{slot.exerciseName}</AppText>
              <AppText variant="small">
                {slot.sets} × {formatTarget(slot.target, slot.unit, slot.perSide)} ·{' '}
                {formatLoad(slot.weightKg, isBodyweight(slot))}
              </AppText>
            </Pressable>
            <MoveButton label="↑" disabled={i === 0} onPress={() => move(slot.id, -1)} />
            <MoveButton label="↓" disabled={i === data.slots.length - 1} onPress={() => move(slot.id, 1)} />
          </View>
        ))}
        <AppText variant="small">Toca un ejercicio para cambiar series, reps, descanso o quitarlo.</AppText>
        <Button
          kind="secondary"
          title="Añadir ejercicio"
          onPress={() => router.push({ pathname: '/ejercicios', params: { pickFor: String(routineId) } })}
        />
      </Card>

      <Button kind="danger" title="Archivar rutina" onPress={archive} />
    </Screen>
  );
}

function RoutineForm({ routine, onSaved }: { routine: Routine; onSaved: () => void }) {
  const db = useDb();
  const [name, setName] = useState(routine.name);
  const [weekdays, setWeekdays] = useState<IsoWeekday[]>(routine.weekdays);
  const changed = name.trim() !== routine.name || weekdays.join() !== routine.weekdays.join();

  const save = async () => {
    if (!name.trim()) return;
    await renameRoutine(db, routine.id, name.trim());
    await setRoutineWeekdays(db, routine.id, weekdays);
    await rescheduleDailyReminders(db);
    onSaved();
  };

  return (
    <Card>
      <TextField label="Nombre" value={name} onChangeText={setName} />
      <AppText variant="small">Días en los que toca</AppText>
      <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      <Row>
        <Button title="Guardar" onPress={save} disabled={!changed || !name.trim()} />
      </Row>
    </Card>
  );
}

function MoveButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.move, disabled && { opacity: 0.3 }]}>
      <AppText style={{ fontWeight: '700' }}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  move: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
