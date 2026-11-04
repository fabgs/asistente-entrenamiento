import { Pressable, StyleSheet, View } from 'react-native';
import { isBodyweight, type Slot } from '@/db/repositories/routines';
import { formatLoad, formatTarget, loadFigure, spokenPrescription } from '@/domain/format';
import type { ExerciseMuscles } from '@/domain/muscles';
import { colors, spacing } from '@/theme';
import { AppText, ExerciseIcon, Figure, Icon } from './ui';

/**
 * An exercise of a routine as a row (PLAN.md §12, «Iconos de ejercicio»): its icon, the name with
 * the load as a figure on the right («35 kg», «15 kg / lastre»; nothing without a load) and the
 * prescription underneath across the whole text column. Rutinas, Hoy, the routine editor and
 * «Ejercicio suelto». TalkBack reads it whole: «Dominadas pronas, Peso corporal, 3 series, al fallo».
 */
export function SlotRow({
  slot,
  muscles,
  onPress,
  hint,
}: {
  slot: Slot;
  muscles: ExerciseMuscles | undefined;
  /** With it the row is a button and has a chevron. */
  onPress?: () => void;
  hint?: string;
}) {
  const bodyweight = isBodyweight(slot);
  const figure = loadFigure(slot.weightKg, bodyweight, slot.exercisePair);
  const label = [
    slot.exerciseName,
    formatLoad(slot.weightKg, bodyweight, slot.exercisePair),
    spokenPrescription(slot.sets, slot.target, slot.unit, slot.perSide),
  ].join(', ');

  const content = (
    <>
      <ExerciseIcon muscles={muscles} />
      <View style={styles.text}>
        <View style={styles.head}>
          <AppText variant="rowTitle" style={styles.flex}>
            {slot.exerciseName}
          </AppText>
          {figure ? <Figure {...figure} /> : null}
          {onPress ? <Icon name="chevron-right" size={20} color={colors.muted} /> : null}
        </View>
        <AppText variant="secondary">{`${slot.sets} × ${formatTarget(slot.target, slot.unit, slot.perSide)}`}</AppText>
      </View>
    </>
  );

  return onPress ? (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.pressed }}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.row} accessible accessibilityLabel={label}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  text: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
