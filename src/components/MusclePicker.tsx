import { ScrollView, StyleSheet, View } from 'react-native';
import { MUSCLE_GROUPS, muscleLabel, musclesOfGroup, sortMuscles, type Muscle } from '@/domain/muscles';
import { spacing } from '@/theme';
import { Sheet } from './Sheet';
import { AppText, Button, Chip } from './ui';

/** Under the HOMBROS label the head alone is enough, and the three fit in one line. */
const CHIP_LABEL: Partial<Record<Muscle, string>> = {
  front_delts: 'Anterior',
  side_delts: 'Lateral',
  rear_delts: 'Posterior',
};

/** Chooses several muscles, as chips by group. `hidden` are left out (the primary ones, when choosing secondary). */
export function MusclePickerSheet({
  visible,
  title,
  selected,
  hidden = [],
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected: readonly Muscle[];
  hidden?: readonly Muscle[];
  onChange: (muscles: Muscle[]) => void;
  onClose: () => void;
}) {
  const toggle = (m: Muscle) =>
    onChange(sortMuscles(selected.includes(m) ? selected.filter((x) => x !== m) : [...selected, m]));

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {/* Shrinks to scroll when the font is large, so that «Listo» always stays in view. */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.groups}>
        {MUSCLE_GROUPS.map((group) => {
          const muscles = musclesOfGroup(group.key).filter((m) => !hidden.includes(m));
          if (muscles.length === 0) return null;
          return (
            <View key={group.key} style={styles.group}>
              <AppText variant="overline">{group.label}</AppText>
              <View style={styles.chips}>
                {muscles.map((m) => (
                  <Chip key={m} label={CHIP_LABEL[m] ?? muscleLabel(m)} selected={selected.includes(m)} onPress={() => toggle(m)} />
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
      <Button size="lg" title="Listo" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  groups: { gap: spacing.md },
  group: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
