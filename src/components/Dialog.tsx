import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '@/theme';
import { getBottomInset, onBottomInset } from './layers';
import { AppText, Button, Icon, TextField, useArmed, type IconName } from './ui';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface SheetAction {
  text: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
}

interface Prompt {
  title: string;
  message?: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  /** Hides what is typed (a password). */
  secure?: boolean;
  /** The number pad, and a unit inside the field («m»). */
  keyboard?: 'text' | 'number';
  suffix?: string;
  confirm: string;
  resolve: (text: string | null) => void;
}

type Request =
  | { kind: 'dialog'; title: string; message?: string; buttons: DialogButton[] }
  | { kind: 'sheet'; title?: string; actions: SheetAction[] }
  | ({ kind: 'prompt' } & Prompt);

let present: ((request: Request | null) => void) | null = null;

/**
 * Same arguments as `Alert.alert`, but drawn with the app's own look by <DialogHost /> (mounted
 * once in the root layout). Only to confirm what cannot be undone. Tapping outside or Back counts as
 * the 'cancel' button.
 */
export function showDialog(title: string, message?: string, buttons: DialogButton[] = [{ text: 'Vale' }]): void {
  present?.({ kind: 'dialog', title, message, buttons });
}

/** The ⋮ menu: occasional and destructive actions, from the bottom. */
export function showActions(actions: SheetAction[], title?: string): void {
  present?.({ kind: 'sheet', title, actions });
}

/**
 * A dialog with one text field (a title, a name), in the top third so the keyboard does not cover
 * it. Resolves with the text, or null if cancelled.
 */
export function showPrompt(
  title: string,
  options: {
    value: string;
    message?: string;
    placeholder?: string;
    maxLength?: number;
    secure?: boolean;
    keyboard?: 'text' | 'number';
    suffix?: string;
    confirm?: string;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!present) return resolve(null);
    present({ kind: 'prompt', title, confirm: options.confirm ?? 'Guardar', resolve, ...options });
  });
}

interface Snack {
  text: string;
  action?: { label: string; onPress: () => void };
  key: number;
}

let presentSnack: ((snack: Snack) => void) | null = null;
let snackKey = 0;

/** A short message at the bottom (4 s, 5 s with an action such as «Deshacer»), above the BottomBar. */
export function showSnackbar(text: string, action?: Snack['action']): void {
  presentSnack?.({ text, action, key: ++snackKey });
}

export function SnackbarHost() {
  const [snack, setSnack] = useState<Snack | null>(null);
  const [barHeight, setBarHeight] = useState(getBottomInset);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    presentSnack = setSnack;
    const off = onBottomInset(setBarHeight);
    return () => {
      presentSnack = null;
      off();
    };
  }, []);
  useEffect(() => {
    if (!snack) return;
    const timer = setTimeout(() => setSnack(null), snack.action ? 5000 : 4000);
    return () => clearTimeout(timer);
  }, [snack]);
  // The action waits 600 ms: the second tap of a double tap on the button below must not undo.
  const armed = useArmed(snack?.key);

  if (!snack) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.snackLayer, { bottom: barHeight > 0 ? barHeight + spacing.md : insets.bottom + spacing.lg }]}>
      <View style={styles.snack} accessibilityLiveRegion="polite">
        <AppText variant="bodySm" style={{ flex: 1 }}>
          {snack.text}
        </AppText>
        {snack.action ? (
          <Pressable
            hitSlop={12}
            disabled={!armed}
            onPress={() => {
              setSnack(null);
              snack.action!.onPress();
            }}>
            <AppText variant="bodySm" weight="700" style={{ color: colors.primary }}>
              {snack.action.label}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function DialogHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const [text, setText] = useState('');
  const insets = useSafeAreaInsets();
  useEffect(() => {
    present = (r) => {
      if (r?.kind === 'prompt') setText(r.value);
      setRequest(r);
    };
    return () => {
      present = null;
    };
  }, []);

  if (!request) return null;

  if (request.kind === 'sheet') {
    const choose = (action?: SheetAction) => {
      setRequest(null);
      action?.onPress();
    };
    return (
      <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => choose()}>
        <Pressable style={styles.sheetBackdrop} onPress={() => choose()}>
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            {request.title ? (
              <AppText variant="heading" style={styles.sheetTitle}>
                {request.title}
              </AppText>
            ) : null}
            {request.actions.map((a) => (
              <Pressable
                key={a.text}
                onPress={() => choose(a)}
                accessibilityRole="button"
                android_ripple={{ color: colors.pressed }}
                style={styles.action}>
                {a.icon ? <Icon name={a.icon} size={24} color={a.destructive ? colors.danger : colors.text} /> : null}
                <AppText variant="rowTitle" style={a.destructive ? { color: colors.danger } : undefined}>
                  {a.text}
                </AppText>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  if (request.kind === 'prompt') {
    const finish = (value: string | null) => {
      setRequest(null);
      request.resolve(value);
    };
    return (
      <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => finish(null)}>
        <Pressable style={[styles.backdrop, styles.top, { paddingTop: insets.top + spacing.xxl }]} onPress={() => finish(null)}>
          <Pressable style={styles.dialog}>
            <AppText variant="headerTitle">{request.title}</AppText>
            {request.message ? <AppText variant="secondary">{request.message}</AppText> : null}
            <TextField
              value={text}
              onChangeText={setText}
              placeholder={request.placeholder}
              maxLength={request.maxLength}
              secure={request.secure}
              keyboard={request.keyboard}
              suffix={request.suffix}
              autoFocus
            />
            <View style={styles.buttons}>
              <Button title={request.confirm} onPress={() => finish(text)} />
              <Button kind="secondary" title="Cancelar" onPress={() => finish(null)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  const cancel = request.buttons.find((b) => b.style === 'cancel');
  const actions = request.buttons.filter((b) => b.style !== 'cancel');
  // Main action first, the destructive one after it, cancel last.
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
        <Pressable style={styles.dialog}>
          <AppText variant="headerTitle">{request.title}</AppText>
          {request.message ? (
            <AppText variant="bodySm" style={{ color: colors.muted }}>
              {request.message}
            </AppText>
          ) : null}
          <View style={styles.buttons}>
            {ordered.map((b, i) => (
              <Button
                key={b.text}
                title={b.text}
                kind={b.style === 'destructive' ? 'tonalDanger' : i === 0 ? 'primary' : 'secondary'}
                onPress={() => close(b)}
              />
            ))}
            {cancel ? <Button kind="secondary" title={cancel.text} onPress={() => close(cancel)} /> : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: spacing.lg },
  top: { justifyContent: 'flex-start' },
  dialog: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  buttons: { gap: spacing.sm, marginTop: spacing.sm },
  sheetBackdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.sm },
  sheetTitle: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minHeight: 56, paddingHorizontal: spacing.lg },
  snackLayer: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  snack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
});
