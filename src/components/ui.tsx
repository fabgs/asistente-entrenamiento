import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState, type ComponentProps, type ReactNode } from 'react';
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
import { formatCountdown, formatDateWithYear, formatNumber, parseDecimal, parseDuration } from '@/domain/format';
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

/**
 * Horizontal group. With `between`, the first child takes the free space (its text wraps) and the
 * last one stays on the same line, flush with the right edge.
 */
export function Row({
  children,
  style,
  between = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  between?: boolean;
}) {
  return <View style={[styles.row, between && styles.rowBetween, style]}>{children}</View>;
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  kind = 'primary',
  big = false,
  disabled = false,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  big?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      hitSlop={kind === 'ghost' ? { left: spacing.md, right: spacing.md } : undefined}
      style={({ pressed }) => [
        styles.button,
        buttonStyles[kind],
        big && styles.buttonBig,
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.75 },
        style,
      ]}>
      {icon ? <Icon name={icon} size={big ? 24 : 20} color={buttonText[kind]} /> : null}
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
  secure = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboard?: keyof typeof KEYBOARDS;
  placeholder?: string;
  multiline?: boolean;
  secure?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="small">{label}</AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={KEYBOARDS[keyboard]}
        secureTextEntry={secure}
        autoCapitalize={secure ? 'none' : undefined}
        autoCorrect={!secure}
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
    <Row between>
      <AppText style={{ flex: 1 }}>{label}</AppText>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: colors.primary }} />
    </Row>
  );
}

/** Multi-select Monday…Sunday chips; days in `hide` are not offered. */
export function WeekdayPicker({
  value,
  onChange,
  hide = [],
}: {
  value: IsoWeekday[];
  onChange: (days: IsoWeekday[]) => void;
  hide?: IsoWeekday[];
}) {
  const toggle = (day: IsoWeekday) =>
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  return (
    <Row>
      {ISO_WEEKDAYS.filter((day) => !hide.includes(day)).map((day) => (
        <Chip key={day} label={WEEKDAY_NAMES[day].slice(0, 3)} selected={value.includes(day)} onPress={() => toggle(day)} />
      ))}
    </Row>
  );
}

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

/** Small upper-case label that separates groups on a screen. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/** Square check like a to-do list; filled when done. */
export function CheckMark({ done, onPress }: { done: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      style={[styles.check, done && styles.checkDone]}>
      {done ? <Icon name="check-bold" size={18} color={colors.onPrimary} /> : null}
    </Pressable>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A time of day in one row ("06:00"); tapping it opens Android's clock. Uses 'HH:mm'. */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (hhmm: string) => void }) {
  const open = () => {
    const [hour, minute] = value.split(':').map(Number);
    DateTimePickerAndroid.open({
      value: new Date(2000, 0, 1, hour, minute),
      mode: 'time',
      is24Hour: true,
      onChange: (event, date) => {
        if (event.type === 'set' && date) onChange(`${pad2(date.getHours())}:${pad2(date.getMinutes())}`);
      },
    });
  };
  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.fieldRow, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityHint="Abre el reloj para elegir la hora">
      <AppText style={{ flex: 1 }}>{label}</AppText>
      <Text style={styles.fieldValue}>{value}</Text>
      <Icon name="clock-outline" size={20} color={colors.muted} />
    </Pressable>
  );
}

/** Rest or interval length: quick picks plus − / + and typing ("2:30" or seconds). */
export function DurationField({
  value,
  onChange,
  presets = [90, 120, 150, 180],
  step = 15,
  min = 15,
}: {
  value: number;
  onChange: (seconds: number) => void;
  presets?: number[];
  step?: number;
  min?: number;
}) {
  const label = (s: number) => formatCountdown(s * 1000);
  return (
    <View style={{ gap: spacing.sm }}>
      <Row>
        {presets.map((s) => (
          <Chip key={s} label={label(s)} selected={value === s} onPress={() => onChange(s)} />
        ))}
      </Row>
      <Stepper value={value} onChange={onChange} step={step} min={min} format={label} parse={parseDuration} toText={String} />
    </View>
  );
}

/** Label on the left and a small − value + on the right, for forms with several numbers. */
export function NumberRow({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  format = String,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  format?: (value: number) => string;
}) {
  return (
    <Row between>
      {/* One line: on narrow screens the label shrinks instead of breaking a word. */}
      <AppText style={{ flex: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {label}
      </AppText>
      <Pressable style={styles.miniButton} onPress={() => onChange(Math.max(min, value - step))} hitSlop={4}>
        <Icon name="minus" size={20} />
      </Pressable>
      <Text style={styles.miniValue}>{format(value)}</Text>
      <Pressable style={styles.miniButton} onPress={() => onChange(value + step)} hitSlop={4}>
        <Icon name="plus" size={20} />
      </Pressable>
    </Row>
  );
}

/** Boxes of a StatRow keep the same height: long values shrink to one line instead of wrapping. */
export function StatRow({ children }: { children: ReactNode }) {
  return <View style={styles.statRow}>{children}</View>;
}

export function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.stat}>
      <AppText variant="small" numberOfLines={1}>
        {label}
      </AppText>
      <Text style={[styles.statValue, big && styles.statValueBig]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
        {value}
      </Text>
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
  // No side padding: a text button sits flush with the edge it is aligned to, like the text around it.
  ghost: { backgroundColor: 'transparent', paddingHorizontal: 0 },
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
  rowBetween: { justifyContent: 'space-between', flexWrap: 'nowrap' },
  button: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
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
  statRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statValueBig: { fontSize: 30, fontWeight: '800' },
  sectionLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: -spacing.sm,
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  fieldValue: { color: colors.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  miniButton: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    minWidth: 64,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
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
