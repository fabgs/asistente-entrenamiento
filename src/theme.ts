import { DarkTheme } from 'expo-router';
import type { TextStyle } from 'react-native';

export const colors = {
  bg: '#0E1116',
  card: '#171B22',
  cardAlt: '#1F2530',
  border: '#2A313C',
  text: '#F2F4F7',
  muted: '#9AA4B2',
  disabledText: '#5B6472',
  /** Only for: the one primary action of a view, a selection (as a tint), done/up, and the route. */
  primary: '#4ADE80',
  onPrimary: '#0B1A10',
  /** "In progress" and "does not count" (warm-up sets, low-intensity cardio). Never as link text. */
  accent: '#60A5FA',
  /** "You decide" or attention: pending suggestion, weight down, missing permission, pause, test mode. */
  warning: '#FBBF24',
  /** Destructive actions and critical states, always with an icon. */
  danger: '#F87171',
  up: '#4ADE80',
  down: '#FBBF24',
  primaryTint: 'rgba(74, 222, 128, 0.14)',
  accentTint: 'rgba(96, 165, 250, 0.14)',
  warningTint: 'rgba(251, 191, 36, 0.14)',
  dangerTint: 'rgba(248, 113, 113, 0.14)',
  /** The selected segment over a map, which needs a little more to stand out. */
  primaryTintOnMap: 'rgba(74, 222, 128, 0.20)',
  /** Controls floating over a map or a chart. */
  overlay: 'rgba(14, 17, 22, 0.80)',
  /** A route being followed, under the walk's green line (not `muted`: it is lost on the veiled tiles). */
  guide: 'rgba(242, 244, 247, 0.55)',
  overlayBorder: 'rgba(255, 255, 255, 0.10)',
  pressed: 'rgba(255, 255, 255, 0.08)',
  ripple: 'rgba(255, 255, 255, 0.12)',
  /** Behind sheets and dialogs. */
  scrim: 'rgba(5, 7, 10, 0.72)',
  /** Behind a one-time hint drawn over a chart. */
  hintBox: 'rgba(23, 27, 34, 0.90)',
  /** Darkens light map tiles to sit in the dark theme (same as MapLibre's raster-brightness-max 0.62). */
  mapVeil: 'rgba(14, 17, 22, 0.38)',
  /** Only if cards cannot be told from the background in the sun. */
  cardBorder: '#2A313C',
  /** Cardio intensity: LISS, MISS and HIIT phases. */
  intensityLow: '#60A5FA',
  intensityMedium: '#FBBF24',
  intensityHigh: '#F87171',
  /** Series colour for charts: validated for lightness band and contrast on `card` (dataviz). */
  chart: '#16A34A',
  /** Muscles: a violet no state uses. Text and tint of a primary muscle; a secondary one is quieter. */
  muscleText: '#C4B5FD',
  muscleTint: 'rgba(139, 92, 246, 0.22)',
  muscleTintSoft: 'rgba(139, 92, 246, 0.10)',
  /**
   * Body map, from nothing (heat0) to the most (heat4): an ordinal ramp validated in the dark theme on
   * `card` (dataviz: one hue, lightness steps ≥ 2,4:1 apart).
   */
  heat0: '#2A313C',
  heat1: '#6D28D9',
  heat2: '#8B5CF6',
  heat3: '#A78BFA',
  heat4: '#C4B5FD',
  /** The share image: white text and lines with a soft shadow (sticker), and its separators. */
  onImage: '#FFFFFF',
  imageShadow: 'rgba(0, 0, 0, 0.45)',
  imageRule: 'rgba(255, 255, 255, 0.08)',
  imageRuleOnPhoto: 'rgba(255, 255, 255, 0.35)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { xs: 6, sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const weight = { regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800' } as const;

/**
 * The type scale: no font size outside of it. Weights: 400 text, 500 rows and labels, 600 headings,
 * buttons and units, 700 figures and titles, 800 only figures of 36 or more.
 */
export const type = {
  countdown: { fontSize: 96, lineHeight: 104, fontWeight: '800', letterSpacing: -2 },
  display: { fontSize: 72, lineHeight: 80, fontWeight: '800', letterSpacing: -1.5 },
  heroSm: { fontSize: 56, lineHeight: 64, fontWeight: '800', letterSpacing: -1 },
  numberL: { fontSize: 36, lineHeight: 42, fontWeight: '800', letterSpacing: -0.5 },
  metric: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  metricSm: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 },
  headerTitle: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  rowTitle: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  rowValue: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  bodySm: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  control: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  secondary: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  tag: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  axis: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  /** Text of an xl button (Serie hecha, Pausar…). */
  buttonXl: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
} as const satisfies Record<string, TextStyle>;

export type TypeName = keyof typeof type;

/** Map attribution, the one text below the scale (OpenStreetMap asks for it to be legible, not big). */
export const attributionType = { fontSize: 10, lineHeight: 14, fontWeight: '500' } as const satisfies TextStyle;

/** Text of the share image, in pixels of the 1080 × 1920 image (never scaled by the system font size). */
export const shareType = {
  title: { fontSize: 72, lineHeight: 84, fontWeight: '800' },
  date: { fontSize: 34, lineHeight: 42, fontWeight: '500' },
  label: { fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: 3 },
  value: { fontSize: 88, lineHeight: 100, fontWeight: '800' },
  unit: { fontSize: 40, lineHeight: 48, fontWeight: '600' },
  brand: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: 6 },
  attribution: { fontSize: 22, lineHeight: 28, fontWeight: '500' },
  exercise: { fontSize: 36, lineHeight: 44, fontWeight: '600' },
  exerciseDetail: { fontSize: 32, lineHeight: 40, fontWeight: '500' },
} as const satisfies Record<string, TextStyle>;

/** Unit next to a figure of each size: about 40 % of it, never below 12. */
export const unitSize: Partial<Record<TypeName, number>> = {
  countdown: 36,
  display: 28,
  heroSm: 22,
  numberL: 15,
  metric: 12,
  metricSm: 13,
  rowValue: 14,
};

/** Big figures do not grow with the system font size (they would not fit); mid ones only a little. */
export const maxFontScale: Partial<Record<TypeName, number>> = {
  countdown: 1,
  display: 1,
  heroSm: 1,
  numberL: 1.15,
  metric: 1.15,
  metricSm: 1.15,
};

/** Variants drawn in the secondary colour by default. */
export const quietTypes: TypeName[] = ['secondary', 'label', 'caption', 'overline', 'axis'];

export const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
  },
};

/** Header of every stack screen and tab: the colour of the screen, without a shadow. */
export const headerOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerShadowVisible: false,
  headerTintColor: colors.text,
  headerTitleStyle: { fontSize: type.headerTitle.fontSize, fontWeight: type.headerTitle.fontWeight },
} as const;
