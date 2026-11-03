import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';

/**
 * One field of a form inside a ListGroup (NumberRow, SwitchRow, a segmented control…), with the
 * 16 dp side margin of a list row. `padded` adds 8 above and below, for controls under 56 dp.
 */
export function FormRow({ children, padded = false }: { children: ReactNode; padded?: boolean }) {
  return <View style={[styles.row, padded && styles.padded]}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.lg },
  padded: { paddingVertical: spacing.sm, gap: spacing.md },
});
