import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/theme';
import { AppText, Button } from './ui';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface DialogRequest {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

let present: ((request: DialogRequest) => void) | null = null;

/**
 * Same arguments as `Alert.alert`, but drawn with the app's own look by <DialogHost /> (mounted
 * once in the root layout). Tapping outside or Back counts as the 'cancel' button.
 */
export function showDialog(title: string, message?: string, buttons: DialogButton[] = [{ text: 'Vale' }]): void {
  present?.({ title, message, buttons });
}

export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  useEffect(() => {
    present = setRequest;
    return () => {
      present = null;
    };
  }, []);

  if (!request) return null;
  const cancel = request.buttons.find((b) => b.style === 'cancel');
  const actions = request.buttons.filter((b) => b.style !== 'cancel');
  // Main action first, the destructive one after it, cancel last and quiet.
  const ordered = [
    ...actions.filter((b) => b.style !== 'destructive'),
    ...actions.filter((b) => b.style === 'destructive'),
  ];
  const close = (button?: DialogButton) => {
    setRequest(null);
    button?.onPress?.();
  };

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => close(cancel)}>
      <Pressable style={styles.backdrop} onPress={() => close(cancel)}>
        <Pressable style={styles.sheet}>
          <AppText variant="heading">{request.title}</AppText>
          {request.message ? <AppText variant="muted">{request.message}</AppText> : null}
          <View style={styles.buttons}>
            {ordered.map((b, i) => (
              <Button
                key={b.text}
                title={b.text}
                kind={b.style === 'destructive' ? 'danger' : i === 0 ? 'primary' : 'secondary'}
                onPress={() => close(b)}
              />
            ))}
            {cancel ? <Button kind="ghost" title={cancel.text} onPress={() => close(cancel)} /> : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 10, 0.72)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  buttons: { gap: spacing.sm, marginTop: spacing.md },
});
