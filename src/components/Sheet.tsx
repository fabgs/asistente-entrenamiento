import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '@/theme';
import { AppText } from './ui';

/**
 * Bottom sheet to edit something small without leaving the screen (correct a set, a warm-up, the
 * weight of today): steppers, segmented controls and lists, never a text field, and it never opens
 * a dialog (what it deletes is undone from a Snackbar). Tapping outside or Back closes it. `action`
 * sits next to the title (e.g. Borrar).
 */
export function Sheet({
  visible,
  title,
  onClose,
  action,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar">
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.head}>
              <AppText variant="heading" style={{ flex: 1 }}>
                {title}
              </AppText>
              {action}
            </View>
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
    maxHeight: '85%',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, marginBottom: -spacing.sm },
});
