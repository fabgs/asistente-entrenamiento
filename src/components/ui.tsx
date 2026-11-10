import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { Children, Fragment, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CardioTracking } from '@/domain/cardioPlan';
import { cardioSport, type CardioSport } from '@/domain/cardioSport';
import { formatCountdown, formatDateWithYear, formatNumber, parseDecimal } from '@/domain/format';
import { movementPattern, muscleLabel, type ExerciseMuscles, type MovementPattern } from '@/domain/muscles';
import { ISO_WEEKDAYS, isoWeekdayOf, localDateString, pickerStartDate, today, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { cardOutline, colors, maxFontScale, quietTypes, radius, spacing, switchThumb, type, unitSize, weight, type TypeName } from '@/theme';
import { setBottomBarHeight } from './layers';

/** Names from before the type scale, still accepted: muted = secondary, small = caption, huge = display. */
const ALIASES = { muted: 'secondary', small: 'caption', huge: 'display' } as const satisfies Record<string, TypeName>;
type TextVariant = TypeName | keyof typeof ALIASES;

/**
 * Every text of the app. `variant` is a step of the type scale (theme.ts); quiet variants (secondary,
 * label, caption, overline, axis) are grey. `weight` adjusts body, bodySm and label, and rowValue at
 * 700 to single out one figure.
 */
export function AppText({
  variant = 'body',
  tabular = false,
  weight,
  style,
  ...rest
}: TextProps & { variant?: TextVariant; tabular?: boolean; weight?: '500' | '600' | '700' }) {
  const name: TypeName = variant in ALIASES ? ALIASES[variant as keyof typeof ALIASES] : (variant as TypeName);
  return (
    <Text
      maxFontSizeMultiplier={maxFontScale[name]}
      style={[
        type[name],
        { color: quietTypes.includes(name) ? colors.muted : colors.text },
        (type[name].fontSize ?? 0) >= 36 && styles.noFontPadding,
        tabular && styles.tabular,
        weight && { fontWeight: weight },
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * A scrolling screen. `footer` (a BottomBar with the main action) stays below the scroll, never on
 * top of it, so the action is always in the same place; the keyboard pushes both up.
 */
export function Screen({
  children,
  scroll = true,
  footer,
  tight = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  /** 16 between sections instead of 24 (set, rest and live walk). */
  tight?: boolean;
}) {
  // KeyboardAvoidingView compares its own position (measured from under the header) with the
  // keyboard's (measured from the top of the screen): without the header height it falls short and
  // the keyboard covers the bottom of the footer.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const content = [styles.screen, { gap: tight ? spacing.lg : spacing.xl }, footer ? { paddingBottom: spacing.lg } : null];
  const body = scroll ? (
    <ScrollView style={styles.scroll} contentContainerStyle={content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[content, { flex: 1 }]}>{children}</View>
  );
  if (!footer) return body;
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1, backgroundColor: colors.bg }}>
      {body}
      {footer}
    </KeyboardAvoidingView>
  );
}

/** One level of container: never a card inside a card (inside, use dividers or a Block). */
export function Card({ children, style, flush = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; flush?: boolean }) {
  return <View style={[styles.card, flush && styles.flush, style]}>{children}</View>;
}

/** A sub-block inside a card: something to decide or a notice. */
export function Block({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.block, style]}>{children}</View>;
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

type ButtonKind = 'primary' | 'secondary' | 'tonal' | 'tonalDanger' | 'text' | 'danger' | 'ghost' | 'destructive';
type ButtonSize = 'md' | 'lg' | 'xl';
const KIND_ALIASES: Partial<Record<ButtonKind, ButtonKind>> = { ghost: 'text', destructive: 'tonalDanger' };

/**
 * One primary per view. `text` is an action in the text colour (never blue links), flush with the
 * edge it is aligned to; `danger` (red text) only in sheets, menus and rows; `tonalDanger` only to
 * confirm a deletion in a dialog.
 */
export function Button({
  title,
  onPress,
  kind: rawKind = 'primary',
  big = false,
  size = big ? 'lg' : 'md',
  disabled = false,
  icon,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  /** Same as size="lg". */
  big?: boolean;
  size?: ButtonSize;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  /** When the title alone is not enough out of context («Aproximación» → «Añadir aproximación»). */
  accessibilityLabel?: string;
}) {
  const kind = KIND_ALIASES[rawKind] ?? rawKind;
  const flat = kind === 'text' || kind === 'danger';
  const color = disabled ? colors.disabledText : buttonText[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={flat ? undefined : { color: colors.ripple }}
      hitSlop={flat ? 12 : undefined}
      style={({ pressed }) => [
        styles.button,
        { minHeight: flat ? 44 : BUTTON_HEIGHT[size], paddingHorizontal: flat ? 0 : size === 'xl' ? 20 : spacing.lg },
        buttonStyles[kind],
        disabled && !flat && styles.buttonDisabled,
        pressed && flat && { opacity: 0.6 },
        style,
      ]}>
      {icon ? <Icon name={icon} size={size === 'xl' ? 24 : 20} color={color} /> : null}
      <Text
        maxFontSizeMultiplier={size === 'xl' ? 1.15 : undefined}
        style={[styles.buttonText, { color }, size === 'xl' && styles.buttonTextXl]}
        numberOfLines={1}
        // With a big system font, a little smaller before cutting it («Termi…»).
        adjustsFontSizeToFit
        minimumFontScale={0.8}>
        {title}
      </Text>
    </Pressable>
  );
}

const BUTTON_HEIGHT: Record<ButtonSize, number> = { md: 48, lg: 56, xl: 64 };

/** Round icon button: header actions (share, ⋮), editing in a row, closing a notice. */
export function IconButton({
  icon,
  label,
  onPress,
  size = 24,
  color = colors.text,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      android_ripple={{ color: colors.ripple, borderless: true, radius: 24 }}
      style={styles.iconButton}>
      <Icon name={icon} size={size} color={disabled ? colors.disabledText : color} />
    </Pressable>
  );
}

/** Header action (share, ⋮…): same button, aligned with the 16 dp margin. */
export const HeaderButton = (props: { icon: IconName; label: string; onPress: () => void }) => (
  <View style={{ marginRight: -12 }}>
    <IconButton {...props} />
  </View>
);

/** The same in the header of a tab, which has no margin of its own on the right. */
export const TabHeaderButton = (props: { icon: IconName; label: string; onPress: () => void }) => (
  <View style={{ marginRight: spacing.xs }}>
    <IconButton {...props} />
  </View>
);

/** Up to two header icons (share-variant, dots-vertical), for <Stack.Screen options={{ headerRight }}>. */
export function HeaderActions({ children }: { children: ReactNode }) {
  return <View style={styles.headerActions}>{children}</View>;
}

/**
 * Control floating over a map or a chart: round 44 dp with an icon or a short text, or a 32 dp pill
 * with an icon and a word («Ver todo», «Recentrar»).
 */
export function FloatingButton({
  icon,
  text,
  label,
  onPress,
  pill = false,
  disabled = false,
}: {
  icon?: IconName;
  text?: string;
  label: string;
  onPress: () => void;
  pill?: boolean;
  disabled?: boolean;
}) {
  const color = disabled ? colors.disabledText : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={pill ? 8 : 2}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [pill ? styles.floatingPill : styles.floating, pressed && { opacity: 0.75 }]}>
      {icon ? <Icon name={icon} size={pill ? 16 : 22} color={color} /> : null}
      {text ? <Text style={[pill ? styles.floatingPillText : styles.floatingText, { color }]}>{text}</Text> : null}
    </Pressable>
  );
}

/** Shortcut chip for a value (rest 1:30, 2:00…); selected in a green tint. */
export function Chip({
  label,
  selected = false,
  onPress,
  color,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={4}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && { opacity: 0.75 }, style]}>
      <Text style={[styles.chipText, { color: selected ? colors.primary : (color ?? colors.text) }]}>{label}</Text>
    </Pressable>
  );
}

/** Small label that cannot be tapped: a state or a category. */
export function Tag({ label, tone = 'neutral', icon }: { label: string; tone?: TagTone; icon?: IconName }) {
  const { bg, fg } = TAG_TONES[tone];
  return (
    <View style={[styles.tag, { backgroundColor: bg }]} accessible accessibilityLabel={label}>
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <Text style={[styles.tagText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export type TagTone = 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'muscle' | 'muscleSoft';
const TAG_TONES: Record<TagTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.cardAlt, fg: colors.muted },
  success: { bg: colors.primaryTint, fg: colors.primary },
  warning: { bg: colors.warningTint, fg: colors.warning },
  info: { bg: colors.accentTint, fg: colors.accent },
  danger: { bg: colors.dangerTint, fg: colors.danger },
  muscle: { bg: colors.muscleTint, fg: colors.muscleText },
  muscleSoft: { bg: colors.muscleTintSoft, fg: colors.muted },
};

/** The muscles of an exercise as tags: the primary ones first and stronger, then the secondary ones. */
export function MuscleTags({ muscles }: { muscles: ExerciseMuscles }) {
  if (muscles.primary.length === 0 && muscles.secondary.length === 0) return null;
  return (
    <View style={styles.muscleTags}>
      {muscles.primary.map((m) => (
        <Tag key={m} label={muscleLabel(m)} tone="muscle" />
      ))}
      {muscles.secondary.map((m) => (
        <Tag key={m} label={muscleLabel(m)} tone="muscleSoft" />
      ))}
    </View>
  );
}

/**
 * One choice among a few (2–4), all in view and in one line. `onMap` is the same control over a map
 * (see-through track, fixed width).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
  onMap = false,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  onMap?: boolean;
}) {
  return (
    <View style={[styles.segmented, onMap && styles.segmentedOnMap, style]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            disabled={o.disabled}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync();
              onChange(o.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: o.disabled }}
            style={[styles.segment, on && (onMap ? styles.segmentOnMap : styles.segmentOn)]}>
            <Text
              style={[styles.segmentText, on && styles.segmentTextOn, o.disabled && { color: colors.disabledText }]}
              numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A number with its unit smaller and grey, never split across lines. */
export function Value({
  value,
  unit,
  size = 'metricSm',
  color = colors.text,
  align,
  tabular = true,
  fit = false,
  maxScale,
  style,
}: {
  value: string;
  unit?: string;
  size?: TypeName;
  color?: string;
  align?: TextStyle['textAlign'];
  tabular?: boolean;
  /** Shrink to fit (only big figures, never in grids). */
  fit?: boolean;
  /** How much it may grow with the system font size (by default, that of its size). */
  maxScale?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      maxFontSizeMultiplier={maxScale ?? maxFontScale[size]}
      style={[type[size], { color, textAlign: align }, tabular && styles.tabular, (type[size].fontSize ?? 0) >= 36 && styles.noFontPadding, style]}
      numberOfLines={1}
      adjustsFontSizeToFit={fit}
      minimumFontScale={0.6}>
      {value}
      {unit ? (
        <Text style={[styles.unit, { fontSize: unitSize[size] ?? 13 }]}>{` ${unit}`}</Text>
      ) : null}
    </Text>
  );
}

/**
 * Big − value + control, usable with sweaty hands. Tapping the value opens the keyboard to type it
 * (not inside sheets: `typing={false}`); every valid keystroke is applied at once.
 */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  format = String,
  big = false,
  decimal = false,
  typing = true,
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
  typing?: boolean;
  parse?: (text: string) => number | null;
  toText?: (value: number) => string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const set = (next: number) => onChange(Math.max(min, Math.round(next * 100) / 100));
  const change = (delta: number) => {
    Haptics.selectionAsync();
    setTyped(null);
    set(value + delta);
  };
  const typeText = (text: string) => {
    setTyped(text);
    const parsed = parse(text);
    if (parsed !== null) set(parsed);
  };
  const valueStyle = big ? styles.stepperValueBig : styles.stepperValue;

  return (
    <View style={styles.stepper}>
      <Pressable
        style={[styles.stepperButton, big && styles.stepperButtonBig]}
        android_ripple={{ color: colors.ripple }}
        onPress={() => change(-step)}
        accessibilityRole="button"
        accessibilityLabel="Menos">
        <Icon name="minus" size={big ? 36 : 28} />
      </Pressable>
      {typed !== null ? (
        <TextInput
          autoFocus
          selectTextOnFocus
          value={typed}
          onChangeText={typeText}
          onBlur={() => setTyped(null)}
          onSubmitEditing={() => setTyped(null)}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          returnKeyType="done"
          maxFontSizeMultiplier={1}
          style={[valueStyle, styles.stepperInput]}
        />
      ) : (
        <Pressable
          style={styles.stepperValueBox}
          disabled={!typing}
          onPress={() => setTyped(toText(value))}
          accessibilityRole={typing ? 'button' : 'text'}
          accessibilityHint={typing ? 'Toca para escribir el valor' : undefined}>
          <Text style={valueStyle} maxFontSizeMultiplier={big ? 1 : 1.15} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {format(value)}
          </Text>
        </Pressable>
      )}
      <Pressable
        style={[styles.stepperButton, big && styles.stepperButtonBig]}
        android_ripple={{ color: colors.ripple }}
        onPress={() => change(step)}
        accessibilityRole="button"
        accessibilityLabel="Más">
        <Icon name="plus" size={big ? 36 : 28} />
      </Pressable>
    </View>
  );
}

const KEYBOARDS = { text: 'default', decimal: 'decimal-pad', number: 'number-pad' } as const;

export function TextField({
  label,
  value,
  onChangeText,
  keyboard = 'text',
  placeholder,
  multiline = false,
  secure = false,
  suffix,
  maxLength,
  error,
  help,
  autoFocus = false,
  autoCapitalize,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboard?: keyof typeof KEYBOARDS;
  placeholder?: string;
  multiline?: boolean;
  secure?: boolean;
  /** Unit written inside the field, on the right ("cm"). */
  suffix?: string;
  /** Shows a counter ("18/40"). */
  maxLength?: number;
  error?: string;
  /** One line of help under the field. */
  help?: string;
  autoFocus?: boolean;
  /** 'none' for names that tell capitals apart (a repository, a file path). */
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <View
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          focused && styles.inputFocused,
          !!error && styles.inputError,
        ]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType={KEYBOARDS[keyboard]}
          secureTextEntry={secure}
          autoCapitalize={secure ? 'none' : autoCapitalize}
          autoCorrect={!secure}
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          multiline={multiline}
          maxLength={maxLength}
          style={[styles.inputText, multiline && { textAlignVertical: 'top', alignSelf: 'stretch' }]}
        />
        {suffix ? <AppText style={{ color: colors.muted }}>{suffix}</AppText> : null}
      </View>
      {error || help || maxLength ? (
        <View style={styles.fieldFoot}>
          {error ? <Icon name="alert-circle" size={16} color={colors.danger} /> : null}
          <AppText variant="caption" style={[{ flex: 1 }, error ? { color: colors.danger } : null]}>
            {error ?? help ?? ''}
          </AppText>
          {maxLength ? (
            <AppText variant="caption" tabular>
              {value.length}/{maxLength}
            </AppText>
          ) : null}
        </View>
      ) : null}
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
    <View style={{ gap: 6 }}>
      <AppText variant="label">{label}</AppText>
      <Pressable onPress={open} style={styles.input} accessibilityRole="button" accessibilityHint="Abre el calendario">
        <AppText style={[{ flex: 1 }, value ? undefined : { color: colors.muted }]}>
          {value ? formatDateWithYear(value) : placeholder}
        </AppText>
        <Icon name="calendar-month-outline" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

/** A setting that switches on and off: the whole row toggles. */
export function SwitchRow({
  label,
  subtitle,
  value,
  onValueChange,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={styles.switchRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="rowTitle">{label}</AppText>
        {subtitle ? <AppText variant="secondary">{subtitle}</AppText> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        thumbColor={value ? switchThumb.on : switchThumb.off}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </Pressable>
  );
}

/**
 * The seven days in one row (Lun…Dom) with a dot under today. `multiple` lets several be chosen
 * (routines, "Copiar a…"); otherwise one (Dieta). Days in `hide` are not offered.
 */
export function DayPicker({
  value,
  onChange,
  multiple = true,
  hide = [],
}: {
  value: IsoWeekday[];
  onChange: (days: IsoWeekday[]) => void;
  multiple?: boolean;
  hide?: IsoWeekday[];
}) {
  const todayIso = isoWeekdayOf(new Date());
  const toggle = (day: IsoWeekday) => {
    Haptics.selectionAsync();
    if (!multiple) onChange([day]);
    else onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  };
  return (
    <View style={styles.days} accessibilityRole={multiple ? undefined : 'radiogroup'}>
      {ISO_WEEKDAYS.filter((day) => !hide.includes(day)).map((day) => {
        const on = value.includes(day);
        return (
          <Pressable
            key={day}
            onPress={() => toggle(day)}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={multiple ? { checked: on } : { selected: on }}
            accessibilityLabel={WEEKDAY_NAMES[day]}
            style={[styles.day, on && styles.dayOn]}>
            <Text style={[styles.dayText, on && { color: colors.primary }]}>{WEEKDAY_NAMES[day].slice(0, 3)}</Text>
            {day === todayIso ? <View style={[styles.todayDot, on && { backgroundColor: colors.primary }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Several days at once (kept for the routine editor): see DayPicker. */
export const WeekdayPicker = (props: { value: IsoWeekday[]; onChange: (days: IsoWeekday[]) => void; hide?: IsoWeekday[] }) => (
  <DayPicker {...props} multiple />
);

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The icon of each way of recording cardio, for an activity whose name tells no sport. */
export const TRACKING_ICON: Record<CardioTracking, IconName> = {
  gps: 'walk',
  timer: 'timer-outline',
  check: 'check-circle-outline',
  sprint: 'run-fast',
};

const SPORT_ICON: Record<CardioSport, IconName> = {
  bike: 'bike',
  swim: 'swim',
  row: 'rowing',
  run: 'run',
  hike: 'hiking',
  walk: 'walk',
};

/**
 * The icon of a cardio activity (Hoy, the weekly cardio, the history): sprints keep theirs; otherwise
 * the sport of its name («Bici estática» is done with the timer, but it is a bike) or how it is recorded.
 */
export function cardioIcon(name: string, tracking: CardioTracking): IconName {
  if (tracking === 'sprint') return TRACKING_ICON.sprint;
  const sport = cardioSport(name);
  return sport ? SPORT_ICON[sport] : TRACKING_ICON[tracking];
}

/** The icon of an exercise, by the movement pattern of its first primary muscle (catalog, history). */
export const PATTERN_ICON: Record<MovementPattern, IconName> = {
  push: 'weight-lifter',
  pull: 'rowing',
  arms: 'arm-flex',
  legs: 'yoga',
  hinge: 'kettlebell',
  core: 'human-handsup',
};

/** Icon of an exercise for the start of a row; the dumbbell while it has no muscles. */
export function ExerciseIcon({ muscles }: { muscles: ExerciseMuscles | undefined }) {
  const pattern = movementPattern(muscles);
  return <RowIcon name={pattern ? PATTERN_ICON[pattern] : 'dumbbell'} color={pattern ? colors.text : colors.muted} />;
}

/**
 * Glyphs drawn mirrored: the dumbbell rises to the right, like the app icon. A plain string list on
 * purpose: a Set<IconName> (thousands of names) makes tsc run out of memory comparing its methods.
 */
const MIRRORED: readonly string[] = ['dumbbell'];
const mirrored = { transform: [{ scaleX: -1 }] };

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} style={MIRRORED.includes(name) ? mirrored : undefined} />;
}

/** A page title with a pencil: tapping it calls `onEdit` (which opens the title dialog). */
export function EditableTitle({ value, onEdit }: { value: string; onEdit: () => void }) {
  return (
    <Pressable onPress={onEdit} style={styles.titleRow} accessibilityRole="button" accessibilityHint="Cambia el título">
      <AppText variant="title" style={{ flexShrink: 1 }}>
        {value}
      </AppText>
      <Icon name="pencil-outline" size={18} color={colors.muted} />
    </Pressable>
  );
}

/**
 * Actions pinned to the bottom of a screen, under the thumb (pass it as `<Screen footer>`). When
 * `actionKey` changes (a new action takes the place of another), taps are ignored for 600 ms and the
 * bar fades in, so a double tap does not hit the next action.
 */
export function BottomBar({
  children,
  style,
  actionKey,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  actionKey?: string | number;
}) {
  const insets = useSafeAreaInsets();
  const [fade] = useState(() => new Animated.Value(1));
  const guarded = !useArmed(actionKey);
  useEffect(() => {
    if (actionKey === undefined) return;
    fade.setValue(0.4);
    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [actionKey, fade]);
  useEffect(() => () => setBottomBarHeight(0), []);

  return (
    <Animated.View
      onLayout={(e) => setBottomBarHeight(e.nativeEvent.layout.height)}
      pointerEvents={guarded ? 'none' : 'auto'}
      style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md), opacity: fade }, style]}>
      {children}
    </Animated.View>
  );
}

/**
 * False for 600 ms after mounting and after `key` changes, so a double tap meant for what was there
 * does not hit what replaces it (BottomBar, the weight suggestion). Without a key, always true.
 */
export function useArmed(key: string | number | undefined, delay = 600): boolean {
  const [armedKey, setArmedKey] = useState<string | number | undefined>(undefined);
  useEffect(() => {
    if (key === undefined) return;
    const timer = setTimeout(() => setArmedKey(key), delay);
    return () => clearTimeout(timer);
  }, [key, delay]);
  return armedKey === key;
}

/**
 * Runs one database action at a time: taps while it is running are ignored. The ref catches the
 * second tap of a double tap, which arrives before the re-render that disables the button.
 */
export function useBusy(): [boolean, (fn: () => Promise<void>) => () => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = (fn: () => Promise<void>) => async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return [busy, run];
}

/** Rows of a list on one surface, separated by hairlines (instead of a card per item). */
export function ListGroup({ children, style, inset = spacing.lg }: { children: ReactNode; style?: StyleProp<ViewStyle>; inset?: number }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, style]}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={[styles.separator, { marginLeft: inset }]} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** Every row that opens something has a chevron; an editable one shows its value. */
export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  chevron = !!onPress,
  onLongPress,
  titleLines = 2,
  disabled = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  onLongPress?: () => void;
  titleLines?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || (!onPress && !onLongPress)}
      accessibilityRole={onPress ? 'button' : undefined}
      android_ripple={onPress || onLongPress ? { color: colors.pressed } : undefined}
      style={[styles.listRow, subtitle ? { minHeight: 72 } : null]}>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === 'string' ? (
          <AppText variant="rowTitle" numberOfLines={titleLines} style={disabled ? { color: colors.disabledText } : undefined}>
            {title}
          </AppText>
        ) : (
          title
        )}
        {typeof subtitle === 'string' ? (
          <AppText variant="secondary" numberOfLines={1} style={disabled ? { color: colors.disabledText } : undefined}>
            {subtitle}
          </AppText>
        ) : (
          subtitle
        )}
      </View>
      {typeof right === 'string' ? (
        <AppText variant="rowValue" tabular>
          {right}
        </AppText>
      ) : right ? (
        // A Tag (alignSelf flex-start) stays centred in the row too.
        <View style={{ alignItems: 'flex-end' }}>{right}</View>
      ) : null}
      {chevron ? <Icon name="chevron-right" size={20} color={colors.muted} /> : null}
    </Pressable>
  );
}

/** A subtitle of several lines, each kept to one line (a route under the facts, the times under the distance). */
export function SubtitleLines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line) => (
        <AppText key={line} variant="secondary" numberOfLines={1}>
          {line}
        </AppText>
      ))}
    </>
  );
}

/** Icon in a 40 dp circle, for the start of a row. */
export function RowIcon({ name, color = colors.text, tint, size = 24 }: { name: IconName; color?: string; tint?: string; size?: number }) {
  return (
    <View style={[styles.rowIcon, tint ? { backgroundColor: tint } : null]}>
      <Icon name={name} size={size} color={color} />
    </View>
  );
}

/** Where the text of a row with a 40 dp icon starts, and so its dividers: 16 + 40 + 16. */
export const ROW_ICON_INSET = spacing.lg + 40 + spacing.lg;

/**
 * A figure in the column of figures on the right of a row («35 kg», «5,2 km»), with an optional
 * word underneath («máx.», «lastre»). Its figures line up from row to row.
 */
export function Figure({ value, unit, caption }: { value: string; unit?: string; caption?: string }) {
  return (
    <View style={styles.figure}>
      <Value value={value} unit={unit} size="rowValue" />
      {caption ? (
        <AppText variant="caption" tabular>
          {caption}
        </AppText>
      ) : null}
    </View>
  );
}

/** The last row of a group, which adds an item to it. */
export function AddRow({ title, onPress }: { title: string; onPress: () => void }) {
  return <ListRow title={title} onPress={onPress} chevron={false} left={<RowIcon name="plus" size={22} />} />;
}

/** Upper-case label above a group of a screen, with an optional value or action on the right. */
/**
 * The label of a group. Over a card or a list it sits 4 dp in from their edges: a rounded corner
 * makes a surface look narrower than it is, and a label flush with it seems to stick out (optical
 * alignment). `flush` keeps it on the edge, for a label inside a card above text.
 */
export function SectionLabel({ children, right, flush = false }: { children: ReactNode; right?: ReactNode; flush?: boolean }) {
  return (
    <View style={[styles.sectionRow, !flush && styles.sectionInset]}>
      <Text style={[styles.sectionLabel, { flex: 1 }]}>{children}</Text>
      {typeof right === 'string' ? (
        <AppText variant="label" tabular weight="600">
          {right}
        </AppText>
      ) : (
        right
      )}
    </View>
  );
}

/** A labelled group: the label sits 8 dp above its content. */
export function Section({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel right={right}>{label}</SectionLabel>
      {children}
    </View>
  );
}

/**
 * Square check like a to-do list; filled when done. Only for what is ticked by hand. `round` is the
 * circle of Hoy, the same as the one of a routine done.
 */
export function CheckMark({ done, onPress, round = false }: { done: boolean; onPress?: () => void; round?: boolean }) {
  if (round) {
    return (
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        hitSlop={13}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}>
        <Icon name={done ? 'check-circle' : 'circle-outline'} size={22} color={done ? colors.primary : colors.muted} />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      style={[styles.check, done && styles.checkDone]}>
      {done ? <Icon name="check-bold" size={20} color={colors.onPrimary} /> : null}
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
    <ListRow
      onPress={open}
      title={label}
      right={
        <AppText variant="rowValue" tabular>
          {value}
        </AppText>
      }
    />
  );
}

/** Rest or interval length: quick picks plus an "Otro" row (− / + by 15 s, or typing "2:30"). */
export function DurationField({
  value,
  onChange,
  presets = [90, 120, 150, 180],
  step = 15,
  min = 15,
  max = Infinity,
}: {
  value: number;
  onChange: (seconds: number) => void;
  presets?: number[];
  step?: number;
  min?: number;
  max?: number;
}) {
  const label = (s: number) => formatCountdown(s * 1000);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {presets.map((s) => (
          <Chip key={s} label={label(s)} selected={value === s} onPress={() => onChange(s)} style={{ flex: 1 }} />
        ))}
      </View>
      <NumberRow label="Otro" value={value} onChange={onChange} step={step} min={min} max={max} format={label} />
    </View>
  );
}

/** Label on the left and a small − value + on the right: any number of a form. */
export function NumberRow({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = Infinity,
  format = String,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (value: number) => string;
}) {
  const change = (next: number) => {
    Haptics.selectionAsync();
    onChange(Math.min(max, Math.max(min, Math.round(next * 100) / 100)));
  };
  return (
    <View style={styles.numberRow}>
      {/* One line: on narrow screens the label shrinks instead of breaking a word. */}
      <AppText style={{ flex: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {label}
      </AppText>
      <Pressable style={styles.miniButton} onPress={() => change(value - step)} hitSlop={4} accessibilityLabel={`Menos ${label}`}>
        <Icon name="minus" size={20} />
      </Pressable>
      <Text style={styles.miniValue} maxFontSizeMultiplier={1.15}>
        {format(value)}
      </Text>
      <Pressable style={styles.miniButton} onPress={() => change(value + step)} hitSlop={4} accessibilityLabel={`Más ${label}`}>
        <Icon name="plus" size={20} />
      </Pressable>
    </View>
  );
}

/** Static figures side by side in one card, left aligned and split by hairlines (StatGrid). */
export function StatRow({ children }: { children: ReactNode }) {
  const cells = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.statRow}>
      {cells.map((cell, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={styles.statDivider} /> : null}
          {cell}
        </Fragment>
      ))}
    </View>
  );
}

/** A figure of a StatRow, with its unit smaller and an optional caption under it. */
export function Stat({ label, value, unit, caption, big = false }: { label: string; value: string; unit?: string; caption?: string; big?: boolean }) {
  return (
    <View style={styles.stat}>
      <AppText variant="label" numberOfLines={1}>
        {label}
      </AppText>
      <Value value={value} unit={unit} size={big ? 'metric' : 'metricSm'} />
      {caption ? <AppText variant="caption">{caption}</AppText> : null}
    </View>
  );
}

/** Thin bar of how much is done. */
export function ProgressBar({ progress, color = colors.primary, height = 4 }: { progress: number; color?: string; height?: number }) {
  return (
    <View style={[styles.progressTrack, { height }]}>
      <View style={{ height, width: `${Math.max(0, Math.min(1, progress)) * 100}%`, backgroundColor: color, borderRadius: radius.pill }} />
    </View>
  );
}

export function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 1000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View style={[styles.screen, { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm }]}>
      <ActivityIndicator color={colors.primary} size="large" />
      {slow ? <AppText variant="caption">Preparando…</AppText> : null}
    </View>
  );
}

/** Nothing to show yet: an icon, what is missing and, if there is one, the way to add it. */
export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={40} color={colors.muted} />
      <AppText variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {text ? (
        <AppText variant="secondary" style={{ textAlign: 'center' }}>
          {text}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

/** Something failed: one line and «Reintentar». */
export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <View style={styles.empty}>
      <Icon name="alert-circle" size={22} color={colors.danger} />
      <AppText variant="bodySm" style={{ textAlign: 'center' }}>
        {text}
      </AppText>
      {onRetry ? <Button kind="secondary" title="Reintentar" onPress={onRetry} /> : null}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/** Remembers whether something stays mounted (for one-time effects that must not repeat on re-render). */
export function useOnce(): () => boolean {
  const done = useRef(false);
  return () => {
    if (done.current) return false;
    done.current = true;
    return true;
  };
}

const buttonStyles = StyleSheet.create({
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  tonal: { backgroundColor: colors.primaryTint },
  tonalDanger: { backgroundColor: colors.dangerTint },
  text: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent' },
  ghost: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: colors.dangerTint },
});

const buttonText: Record<ButtonKind, string> = {
  primary: colors.onPrimary,
  secondary: colors.text,
  tonal: colors.primary,
  tonalDanger: colors.danger,
  text: colors.text,
  danger: colors.danger,
  ghost: colors.text,
  destructive: colors.danger,
};

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  screen: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.bg,
    flexGrow: 1,
  },
  noFontPadding: { includeFontPadding: false },
  tabular: { fontVariant: ['tabular-nums'] },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, ...cardOutline },
  flush: { padding: 0, gap: 0, overflow: 'hidden' },
  block: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  rowBetween: { justifyContent: 'space-between', flexWrap: 'nowrap' },
  button: {
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  buttonDisabled: { backgroundColor: colors.cardAlt, borderWidth: 0 },
  buttonText: { ...type.rowValue, flexShrink: 1 },
  buttonTextXl: type.buttonXl,
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', marginRight: -12 },
  floating: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.overlayBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingText: { ...type.control },
  floatingPill: {
    flexDirection: 'row',
    gap: spacing.xs,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.overlayBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingPillText: { ...type.label, fontWeight: weight.semibold },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    backgroundColor: colors.cardAlt,
  },
  chipOn: { backgroundColor: colors.primaryTint, borderColor: 'transparent' },
  chipText: { ...type.control, fontVariant: ['tabular-nums'] },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    minHeight: 22,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.sm,
  },
  tagText: { ...type.tag },
  muscleTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  figure: { alignItems: 'flex-end' },
  segmented: {
    flexDirection: 'row',
    minHeight: 40,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segmentedOnMap: { width: 96, backgroundColor: colors.overlay, borderColor: colors.overlayBorder },
  segment: { flex: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentOn: { backgroundColor: colors.primaryTint },
  segmentOnMap: { backgroundColor: colors.primaryTintOnMap },
  segmentText: { ...type.control, fontWeight: weight.medium, color: colors.muted },
  segmentTextOn: { color: colors.primary, fontWeight: weight.semibold },
  unit: { color: colors.muted, fontWeight: weight.semibold },
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
    overflow: 'hidden',
  },
  stepperButtonBig: { width: 80, height: 80 },
  stepperValueBox: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  stepperValue: { color: colors.text, ...type.metric, textAlign: 'center', fontVariant: ['tabular-nums'] },
  stepperValueBig: { color: colors.text, ...type.display, textAlign: 'center', fontVariant: ['tabular-nums'], includeFontPadding: false },
  stepperInput: { flex: 1, padding: 0, borderBottomWidth: 2, borderBottomColor: colors.primary },
  days: { flexDirection: 'row', gap: spacing.xs },
  day: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOn: { backgroundColor: colors.primaryTint },
  dayText: { ...type.control, color: colors.muted },
  todayDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: colors.muted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  statRow: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', ...cardOutline },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  stat: { flex: 1, minHeight: 72, gap: 2, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  sectionLabel: { color: colors.muted, ...type.overline },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 20 },
  sectionInset: { paddingHorizontal: spacing.xs },
  check: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  // The padding keeps a subtitle of two lines (or a big system font) off the edges.
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  miniButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniValue: { color: colors.text, ...type.metricSm, minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  inputText: { flex: 1, color: colors.text, ...type.body, paddingVertical: spacing.sm },
  inputFocused: { borderColor: colors.primary, borderWidth: 2, margin: -1 },
  inputError: { borderColor: colors.danger, borderWidth: 2, margin: -1 },
  inputMultiline: { minHeight: 96, alignItems: 'flex-start', paddingVertical: spacing.xs },
  fieldFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bottomBar: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', ...cardOutline },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: { backgroundColor: colors.cardAlt, borderRadius: radius.pill, overflow: 'hidden' },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
});
