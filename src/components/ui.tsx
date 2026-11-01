import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { formatDateWithYear, formatNumber, parseDecimal } from '@/domain/format';
import { ISO_WEEKDAYS, localDateString, pickerStartDate, today, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
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

/**
 * Big − value + control, usable with sweaty hands. Tapping the value opens the keyboard to type it;
 * every valid keystroke is applied at once, so a button pressed with the keyboard open sees it.
 */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  format = String,
  big = false,
  decimal = false,
  parse = parseDecimal,
  toText = (v: number) => formatNumber(v),
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  format?: (value: number) => string;
  big?: boolean;
  decimal?: boolean;
  parse?: (text: string) => number | null;
  toText?: (value: number) => string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const set = (next: number) => onChange(Math.max(min, Math.round(next * 100) / 100));
  const change = (delta: number) => {
    setTyped(null);
    set(value + delta);
  };
  const type = (text: string) => {
    setTyped(text);
    const parsed = parse(text);
    if (parsed !== null) set(parsed);
  };

  return (
    <View style={styles.stepper}>
      <Pressable style={[styles.stepperButton, big && styles.stepperButtonBig]} onPress={() => change(-step)}>
        <Text style={styles.stepperSign}>−</Text>
      </Pressable>
      {typed !== null ? (
        <TextInput
          autoFocus
          selectTextOnFocus
          value={typed}
          onChangeText={type}
          onBlur={() => setTyped(null)}
          onSubmitEditing={() => setTyped(null)}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          returnKeyType="done"
          style={[styles.stepperValue, styles.stepperInput, big && textStyles.huge]}
        />
      ) : (
        <Pressable
          style={styles.stepperValueBox}
          onPress={() => setTyped(toText(value))}
          accessibilityRole="button"
          accessibilityHint="Toca para escribir el valor">
          <Text
            style={[styles.stepperValue, big && textStyles.huge]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.4}>
            {format(value)}
          </Text>
        </Pressable>
      )}
      <Pressable style={[styles.stepperButton, big && styles.stepperButtonBig]} onPress={() => change(step)}>
        <Text style={styles.stepperSign}>+</Text>
      </Pressable>
    </View>
  );
}

const KEYBOARDS = { text: 'default', decimal: 'decimal-pad' } as const;

export function TextField({
  label,
  value,
  onChangeText,
  keyboard = 'text',
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboard?: keyof typeof KEYBOARDS;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="small">{label}</AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={KEYBOARDS[keyboard]}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

/** Opens the system calendar; `value` and `onChange` use 'YYYY-MM-DD'. Dates after today are not allowed. */
export function DateField({
  label,
  value,
  onChange,
  placeholder = 'Elegir fecha',
  yearsAgo = 0,
}: {
  label: string;
  value: string | null;
  onChange: (iso: string) => void;
  placeholder?: string;
  yearsAgo?: number;
}) {
  const open = () =>
    DateTimePickerAndroid.open({
      value: pickerStartDate(value, yearsAgo),
      mode: 'date',
      maximumDate: today(),
      onChange: (event, date) => {
        if (event.type === 'set' && date) onChange(localDateString(date));
      },
    });

  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="small">{label}</AppText>
      <Pressable onPress={open} style={styles.input} accessibilityRole="button" accessibilityHint="Abre el calendario">
        <AppText style={value ? undefined : { color: colors.muted }}>
          {value ? formatDateWithYear(value) : placeholder}
        </AppText>
      </Pressable>
    </View>
  );
}

export function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
      <AppText style={{ flex: 1 }}>{label}</AppText>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: colors.primary }} />
    </Row>
  );
}

/** Multi-select Monday…Sunday chips. */
export function WeekdayPicker({ value, onChange }: { value: IsoWeekday[]; onChange: (days: IsoWeekday[]) => void }) {
  const toggle = (day: IsoWeekday) =>
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  return (
    <Row>
      {ISO_WEEKDAYS.map((day) => (
        <Chip key={day} label={WEEKDAY_NAMES[day].slice(0, 3)} selected={value.includes(day)} onPress={() => toggle(day)} />
      ))}
    </Row>
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
  stepperValueBox: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  stepperValue: { color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  stepperInput: {
    flex: 1,
    padding: 0,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  divider: { height: 1, backgroundColor: colors.border },
  input: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
});
