import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { colors, radius, spacing } from '@/theme';

type TextVariant = 'title' | 'heading' | 'body' | 'muted' | 'small' | 'huge';

export function AppText({ variant = 'body', style, ...rest }: TextProps & { variant?: TextVariant }) {
  return <Text style={[textStyles[variant], style]} {...rest} />;
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={styles.screen}>{children}</View>;
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  kind = 'primary',
  big = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  big?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        buttonStyles[kind],
        big && styles.buttonBig,
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.75 },
        style,
      ]}>
      <Text style={[styles.buttonText, { color: buttonText[kind] }, big && styles.buttonTextBig]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  color,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
      <Text style={[styles.chipText, { color: selected ? colors.onPrimary : (color ?? colors.text) }]}>{label}</Text>
    </Pressable>
  );
}

/** Big − value + control, usable with sweaty hands. */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  format = String,
  big = false,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  format?: (value: number) => string;
  big?: boolean;
}) {
  const change = (delta: number) => onChange(Math.max(min, Math.round((value + delta) * 100) / 100));
  return (
    <View style={styles.stepper}>
      <Pressable style={[styles.stepperButton, big && styles.stepperButtonBig]} onPress={() => change(-step)}>
        <Text style={styles.stepperSign}>−</Text>
      </Pressable>
      <Text
        style={[styles.stepperValue, big && textStyles.huge]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.4}>
        {format(value)}
      </Text>
      <Pressable style={[styles.stepperButton, big && styles.stepperButtonBig]} onPress={() => change(step)}>
        <Text style={styles.stepperSign}>+</Text>
      </Pressable>
    </View>
  );
}

export function Loading() {
  return (
    <View style={[styles.screen, { flex: 1, justifyContent: 'center' }]}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const textStyles = StyleSheet.create({
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
  body: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted, fontSize: 15 },
  small: { color: colors.muted, fontSize: 13 },
  huge: { color: colors.text, fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

const buttonStyles = StyleSheet.create({
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
});

const buttonText: Record<ButtonKind, string> = {
  primary: colors.onPrimary,
  secondary: colors.text,
  ghost: colors.accent,
  danger: colors.danger,
};

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  screen: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg, flexGrow: 1 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  button: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBig: { paddingVertical: spacing.lg + 4 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  buttonTextBig: { fontSize: 20 },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.cardAlt,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  stepperButton: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonBig: { width: 80, height: 80, borderRadius: radius.lg },
  stepperSign: { color: colors.text, fontSize: 32, fontWeight: '600' },
  stepperValue: { flex: 1, color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  divider: { height: 1, backgroundColor: colors.border },
});
