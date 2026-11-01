import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Card, Loading, Row, Screen } from '@/components/ui';
import { listCardio } from '@/db/repositories/cardio';
import { isBodyweight, listRoutines, listSlots, type Slot } from '@/db/repositories/routines';
import { listPendingChanges } from '@/db/repositories/weightChanges';
import { formatLoad, formatTarget } from '@/domain/format';
import { ISO_WEEKDAYS, WEEKDAY_NAMES } from '@/domain/schedule';
import { useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

export default function RoutinesScreen() {
  const { data } = useLoader(async (db) => {
    const routines = await listRoutines(db);
    const slots = new Map<number, Slot[]>();
    for (const r of routines) slots.set(r.id, await listSlots(db, r.id));
    return { routines, slots, cardio: await listCardio(db), pending: await listPendingChanges(db) };
  });

  if (!data) return <Loading />;

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
          <AppText variant="heading">{routine.name}</AppText>
          <AppText variant="small">{routine.weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ')}</AppText>
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
                {data.pending.some((p) => p.slotId === slot.id) ? '  ·  recomendación pendiente' : ''}
              </AppText>
            </Pressable>
          ))}
        </Card>
      ))}

      <AppText variant="small" style={{ textAlign: 'center' }}>
        Toca un ejercicio para cambiar su peso. El editor completo de rutinas llegará en la fase 4.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dayRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
  dayName: { width: 40, color: colors.muted, fontWeight: '700' },
  slotRow: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
});
