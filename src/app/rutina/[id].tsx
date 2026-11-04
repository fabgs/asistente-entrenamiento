import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { showActions, showDialog, showPrompt } from '@/components/Dialog';
import { routineCounts } from '@/components/RoutineCard';
import { SlotRow } from '@/components/SlotRow';
import {
  AddRow,
  AppText,
  Button,
  DayPicker,
  EditableTitle,
  EmptyState,
  ExerciseIcon,
  HeaderButton,
  IconButton,
  ListGroup,
  Loading,
  ROW_ICON_INSET,
  Screen,
  Section,
} from '@/components/ui';
import { allExerciseMuscles } from '@/db/repositories/muscles';
import {
  archiveRoutine,
  getRoutine,
  listSlots,
  moveSlot,
  renameRoutine,
  setRoutineWeekdays,
  type Slot,
} from '@/db/repositories/routines';
import type { ExerciseMuscles } from '@/domain/muscles';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { queueWrite, reschedule, useSavedAtOnce } from '@/hooks/editing';
import { colors, spacing } from '@/theme';

/** Editor of a routine: name (tapping the title), days and exercises; everything saves at once. */
export default function RoutineEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const routineId = Number(id);
  const db = useDb();
  const [sorting, setSorting] = useState(false);
  const { data, reload } = useLoader(async (db) => {
    const routine = await getRoutine(db, routineId);
    return routine ? { routine, slots: await listSlots(db, routineId), muscles: await allExerciseMuscles(db) } : null;
  });
  const [days, setDays] = useSavedAtOnce<IsoWeekday[]>(data?.routine.weekdays ?? [], async (next) => {
    await setRoutineWeekdays(db, routineId, next);
    reschedule(db);
    await reload();
  });

  const remove = () =>
    showDialog(
      '¿Borrar la rutina?',
      'Desaparece de Rutinas y de la semana. Los entrenos que ya hiciste siguen en el historial.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: async () => {
            await queueWrite(() => archiveRoutine(db, routineId));
            reschedule(db);
            router.back();
          },
        },
      ],
    );

  // The name is the title of the page (it is edited there), so the header has none.
  const header = (
    <Stack.Screen
      options={{
        headerTitle: '',
        headerRight: data
          ? () => (
              <HeaderButton
                icon="dots-vertical"
                label="Más acciones"
                onPress={() =>
                  showActions([{ text: 'Borrar rutina', icon: 'trash-can-outline', destructive: true, onPress: remove }])
                }
              />
            )
          : undefined,
      }}
    />
  );

  if (data === undefined) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }
  if (data === null) {
    return (
      <Screen>
        {header}
        <EmptyState icon="dumbbell" title="Esta rutina ya no existe" />
      </Screen>
    );
  }

  const { routine, slots } = data;
  const ordering = sorting && slots.length > 1;

  const rename = async () => {
    const name = (await showPrompt('Nombre de la rutina', { value: routine.name, confirm: 'Guardar' }))?.trim();
    if (!name || name === routine.name) return;
    await queueWrite(() => renameRoutine(db, routineId, name));
    reschedule(db);
    reload();
  };

  const move = async (slot: Slot, delta: -1 | 1) => {
    await queueWrite(() => moveSlot(db, slot.id, delta));
    reschedule(db);
    reload();
  };

  return (
    <Screen>
      {header}
      <View style={styles.titleBlock}>
        <EditableTitle value={routine.name} onEdit={rename} />
        <AppText variant="secondary">{routineCounts(slots)}</AppText>
      </View>

      <Section label="Días">
        <DayPicker value={days} onChange={setDays} />
      </Section>

      <Section
        label="Ejercicios"
        right={
          slots.length > 1 ? (
            <Button kind="text" title={ordering ? 'Hecho' : 'Ordenar'} onPress={() => setSorting(!ordering)} />
          ) : undefined
        }>
        <ListGroup inset={ROW_ICON_INSET}>
          {slots.map((slot, i) =>
            ordering ? (
              <SortRow
                key={slot.id}
                name={slot.exerciseName}
                muscles={data.muscles.get(slot.exerciseId)}
                onUp={i > 0 ? () => move(slot, -1) : undefined}
                onDown={i < slots.length - 1 ? () => move(slot, 1) : undefined}
              />
            ) : (
              <SlotRow
                key={slot.id}
                slot={slot}
                muscles={data.muscles.get(slot.exerciseId)}
                onPress={() => router.push(`/slot/${slot.id}`)}
                hint="Abre el ejercicio de la rutina"
              />
            ),
          )}
          {ordering ? null : (
            <AddRow
              title="Añadir ejercicio"
              onPress={() => router.push({ pathname: '/ejercicios', params: { pickFor: String(routineId) } })}
            />
          )}
        </ListGroup>
      </Section>
    </Screen>
  );
}

/**
 * A row while ordering: not a button itself, so that each arrow is its own control. The arrow that
 * cannot be used is not drawn, but keeps its place.
 */
function SortRow({
  name,
  muscles,
  onUp,
  onDown,
}: {
  name: string;
  muscles: ExerciseMuscles | undefined;
  onUp?: () => void;
  onDown?: () => void;
}) {
  return (
    <View style={styles.sortRow}>
      <ExerciseIcon muscles={muscles} />
      <AppText variant="rowTitle" style={styles.flex}>
        {name}
      </AppText>
      <View style={styles.arrows}>
        {onUp ? (
          <IconButton icon="chevron-up" size={22} color={colors.muted} label={`Subir ${name}`} onPress={onUp} />
        ) : (
          <View style={styles.arrowPlace} />
        )}
        {onDown ? (
          <IconButton icon="chevron-down" size={22} color={colors.muted} label={`Bajar ${name}`} onPress={onDown} />
        ) : (
          <View style={styles.arrowPlace} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titleBlock: { gap: spacing.xs },
  flex: { flex: 1 },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  // The last icon lines up with the 16 dp margin of the row.
  arrows: { flexDirection: 'row', marginRight: -spacing.md },
  arrowPlace: { width: 48, height: 48 },
});
