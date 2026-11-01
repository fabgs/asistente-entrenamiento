import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Loading, Row, Screen } from '@/components/ui';
import { listCardio } from '@/db/repositories/cardio';
import { createRoutine, isBodyweight, listRoutines, listSlots, type Slot } from '@/db/repositories/routines';
import { SuggestionLine } from '@/components/Recommendation';
import { listOpenChanges } from '@/db/repositories/weightChanges';
import { formatLoad, formatTarget } from '@/domain/format';
import { ISO_WEEKDAYS, WEEKDAY_NAMES } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

export default function RoutinesScreen() {
  const db = useDb();
  const { data, reload } = useLoader(async (db) => {
    const routines = await listRoutines(db);
    const slots = new Map<number, Slot[]>();
    for (const r of routines) slots.set(r.id, await listSlots(db, r.id));
    return { routines, slots, cardio: await listCardio(db), openChanges: await listOpenChanges(db) };
  });

  if (!data) return <Loading />;

  const newRoutine = async () => {
    const id = await createRoutine(db, 'Nueva rutina');
    router.push(`/rutina/${id}`);
  };

  return (
    <Screen>
      <Card>
        <AppText variant="heading">Semana</AppText>
        {ISO_WEEKDAYS.map((wd) => {
          const strength = data.routines.filter((r) => r.weekdays.includes(wd)).map((r) => r.name);
          const cardio = data.cardio.filter((c) => c.weekday === wd).map((c) => `${c.name}${c.target ? ` ${c.target}` : ''}`);
          return (
            <View key={wd} style={styles.dayRow}>
              <AppText style={styles.dayName}>{WEEKDAY_NAMES[wd].slice(0, 3)}</AppText>
              <View style={{ flex: 1 }}>
                {strength.map((s) => (
                  <AppText key={s}>{s}</AppText>
                ))}
                <AppText variant="small">{cardio.join(' · ') || '—'}</AppText>
              </View>
            </View>
          );
        })}
      </Card>

      {data.routines.map((routine) => (
        <Card key={routine.id}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <AppText variant="heading" style={{ flex: 1 }}>
              {routine.name}
            </AppText>
            <Button kind="ghost" title="Editar" onPress={() => router.push(`/rutina/${routine.id}`)} />
          </Row>
          <AppText variant="small">
            {routine.weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ') || 'Sin día asignado'}
          </AppText>
          {(data.slots.get(routine.id) ?? []).map((slot) => (
            <Pressable key={slot.id} onPress={() => router.push(`/slot/${slot.id}`)} style={styles.slotRow}>
              <Row style={{ justifyContent: 'space-between' }}>
                <AppText style={{ flex: 1 }}>{slot.exerciseName}</AppText>
                <AppText style={{ color: colors.primary, fontWeight: '700' }}>
                  {formatLoad(slot.weightKg, isBodyweight(slot))}
                </AppText>
              </Row>
              <AppText variant="small">
                {slot.sets} × {formatTarget(slot.target, slot.unit, slot.perSide)}
              </AppText>
              {data.openChanges
                .filter((c) => c.slotId === slot.id)
                .map((c) => (
                  <SuggestionLine key={c.id} change={c} onChanged={reload} />
                ))}
            </Pressable>
          ))}
        </Card>
      ))}

      <Button title="Nueva rutina" onPress={newRoutine} />
      <Button kind="secondary" title="Catálogo de ejercicios" onPress={() => router.push('/ejercicios')} />
      <Button kind="secondary" title="Cardio semanal" onPress={() => router.push('/cardio')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  dayRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
  dayName: { width: 40, color: colors.muted, fontWeight: '700' },
  slotRow: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
});
