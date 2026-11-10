/**
 * The colours of the app (PLAN.md §8 and §12, 1.4.10): a dark or a light mode and one of four
 * accents, chosen in Ajustes → Apariencia. Pure: `src/theme.ts` builds `colors` from it once, when
 * the app starts.
 */

export type ThemeMode = 'dark' | 'light';
export type AccentKey = 'green' | 'teal' | 'blue' | 'pink';

export interface ThemePreference {
  mode: ThemeMode;
  accent: AccentKey;
}

export const DEFAULT_THEME: ThemePreference = { mode: 'dark', accent: 'green' };

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
];

interface Accent {
  key: AccentKey;
  name: string;
  /** In the dark mode: the accent, the text on it and the series of a chart (darker, on `card`). */
  dark: string;
  onDark: string;
  chartDark: string;
  /** In the light mode, dark enough to be read as text on its own tint. */
  light: string;
  onLight: string;
}

/**
 * The accents on offer. Not amber, orange or lime (amber is «you decide» and a weight going down),
 * red (destructive) or violet (muscles): they would say something else.
 */
export const ACCENTS: readonly Accent[] = [
  { key: 'green', name: 'Verde', dark: '#4ADE80', onDark: '#0B1A10', chartDark: '#16A34A', light: '#126B36', onLight: '#FFFFFF' },
  { key: 'teal', name: 'Turquesa', dark: '#2DD4BF', onDark: '#06201C', chartDark: '#0D9488', light: '#0B666C', onLight: '#FFFFFF' },
  { key: 'blue', name: 'Azul', dark: '#60A5FA', onDark: '#0A1626', chartDark: '#3B82F6', light: '#1D4ED8', onLight: '#FFFFFF' },
  { key: 'pink', name: 'Rosa', dark: '#F274D6', onDark: '#2A0A22', chartDark: '#D946B4', light: '#A21489', onLight: '#FFFFFF' },
];

const accentOf = (key: AccentKey) => ACCENTS.find((a) => a.key === key) ?? ACCENTS[0];

/** «Oscuro · Verde», the value of the row in Ajustes. */
export function themeLabel(theme: ThemePreference): string {
  return `${THEME_MODES.find((m) => m.value === theme.mode)!.label} · ${accentOf(theme.accent).name}`;
}

/** What is stored on the phone, or the default when there is nothing or it cannot be read. */
export function parseThemePreference(json: string | null | undefined): ThemePreference {
  if (!json) return DEFAULT_THEME;
  try {
    const stored = JSON.parse(json) as Partial<ThemePreference> | null;
    return {
      mode: stored?.mode === 'light' ? 'light' : 'dark',
      accent: ACCENTS.find((a) => a.key === stored?.accent)?.key ?? DEFAULT_THEME.accent,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** `hex` at `alpha`, as the tints are written. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

/** Everything that does not change with the accent. */
const DARK = {
  bg: '#0E1116',
  card: '#171B22',
  cardAlt: '#1F2530',
  border: '#2A313C',
  text: '#F2F4F7',
  muted: '#9AA4B2',
  disabledText: '#5B6472',
  /** "In progress" and "does not count" (warm-up sets, low-intensity cardio). Never as link text. */
  accent: '#60A5FA',
  /** "You decide" or attention: pending suggestion, weight down, missing permission, pause, test mode. */
  warning: '#FBBF24',
  /** Destructive actions and critical states, always with an icon. */
  danger: '#F87171',
  down: '#FBBF24',
  accentTint: 'rgba(96, 165, 250, 0.14)',
  warningTint: 'rgba(251, 191, 36, 0.14)',
  dangerTint: 'rgba(248, 113, 113, 0.14)',
  /** Controls floating over a map or a chart. */
  overlay: 'rgba(14, 17, 22, 0.80)',
  /** A route being followed, under the walk's line (not `muted`: it is lost on the veiled tiles). */
  guide: 'rgba(242, 244, 247, 0.55)',
  overlayBorder: 'rgba(255, 255, 255, 0.10)',
  pressed: 'rgba(255, 255, 255, 0.08)',
  ripple: 'rgba(255, 255, 255, 0.12)',
  /** Behind sheets and dialogs. */
  scrim: 'rgba(5, 7, 10, 0.72)',
  /** Behind a one-time hint drawn over a chart. */
  hintBox: 'rgba(23, 27, 34, 0.90)',
  /** Over the map tiles: darkens the light map to sit in the dark mode; nothing in the light one. */
  mapVeil: 'rgba(14, 17, 22, 0.38)',
  /** Around the walk's line on a map, so it reads over any tile (and over the satellite). */
  mapCasing: 'rgba(14, 17, 22, 0.70)',
  /** Around cards, only in the light mode: white on light grey does not separate in the sun. */
  cardBorder: '#2A313C',
  /** Cardio intensity: LISS, MISS and HIIT phases. */
  intensityLow: '#60A5FA',
  intensityMedium: '#FBBF24',
  intensityHigh: '#F87171',
  /** Muscles: a violet no state uses. Text and tint of a primary muscle; a secondary one is quieter. */
  muscleText: '#C4B5FD',
  muscleTint: 'rgba(139, 92, 246, 0.22)',
  muscleTintSoft: 'rgba(139, 92, 246, 0.10)',
  /**
   * Body map, from nothing (heat0) to the most (heat4): an ordinal ramp of one hue that moves away
   * from the card with each step (lighter in the dark mode, darker in the light one).
   */
  heat0: '#2A313C',
  heat1: '#6D28D9',
  heat2: '#8B5CF6',
  heat3: '#A78BFA',
  heat4: '#C4B5FD',
  /**
   * Mapa de calor (1.4.10): the paths walked, from long ago (trail0, grey) to the most walked
   * (trail4). One red hue, only on that map and its legend: never a text or a button. On the dark
   * map it gains light with the heat and ends in a vivid red (a lighter top level read as salmon:
   * less red, not more); the width of the line tells the levels apart too.
   */
  trail0: '#3D4450',
  trail1: '#8C433F',
  trail2: '#B3463F',
  trail3: '#DA4A40',
  trail4: '#FF5447',
  trailCasing: 'rgba(14, 17, 22, 0.78)',
  /** The share image: white text and lines with a soft shadow (sticker), and its separators. */
  onImage: '#FFFFFF',
  imageShadow: 'rgba(0, 0, 0, 0.45)',
  imageRule: 'rgba(255, 255, 255, 0.08)',
  imageRuleOnPhoto: 'rgba(255, 255, 255, 0.35)',
};

type Neutrals = { [K in keyof typeof DARK]: string };

const LIGHT: Neutrals = {
  bg: '#EEF0F3',
  card: '#FFFFFF',
  cardAlt: '#E4E7EC',
  border: '#C3C9D2',
  text: '#111418',
  muted: '#4F5968',
  disabledText: '#7F8A99',
  accent: '#1D4ED8',
  // Amber as a text has to be this dark to be read in the sun; its tint is still an amber.
  warning: '#9A4A08',
  danger: '#B91C1C',
  down: '#9A4A08',
  accentTint: 'rgba(29, 78, 216, 0.12)',
  warningTint: 'rgba(217, 119, 6, 0.16)',
  dangerTint: 'rgba(185, 28, 28, 0.12)',
  overlay: 'rgba(255, 255, 255, 0.90)',
  guide: 'rgba(17, 20, 24, 0.50)',
  overlayBorder: 'rgba(17, 20, 24, 0.12)',
  pressed: 'rgba(17, 20, 24, 0.06)',
  ripple: 'rgba(17, 20, 24, 0.10)',
  scrim: 'rgba(17, 20, 24, 0.45)',
  hintBox: 'rgba(255, 255, 255, 0.92)',
  mapVeil: 'rgba(255, 255, 255, 0.00)',
  mapCasing: 'rgba(255, 255, 255, 0.90)',
  cardBorder: '#C3C9D2',
  intensityLow: '#1D4ED8',
  intensityMedium: '#B8620A',
  intensityHigh: '#B91C1C',
  muscleText: '#5B21B6',
  muscleTint: 'rgba(124, 58, 237, 0.14)',
  muscleTintSoft: 'rgba(124, 58, 237, 0.07)',
  heat0: '#E2E5EA',
  heat1: '#A78BFA',
  heat2: '#8B5CF6',
  heat3: '#6D28D9',
  heat4: '#4C1D95',
  trail0: '#7A828E',
  trail1: '#E8877F',
  trail2: '#D9483F',
  trail3: '#B3201F',
  trail4: '#7A0F14',
  trailCasing: 'rgba(17, 20, 24, 0.55)',
  onImage: '#FFFFFF',
  imageShadow: 'rgba(0, 0, 0, 0.45)',
  imageRule: 'rgba(255, 255, 255, 0.08)',
  imageRuleOnPhoto: 'rgba(255, 255, 255, 0.35)',
};

export interface Palette extends Neutrals {
  /** The accent. Only for: the one primary action of a view, a selection (as a tint), done/up, and the walk's line. */
  primary: string;
  onPrimary: string;
  up: string;
  primaryTint: string;
  /** The selected segment over a map, which needs a little more to stand out. */
  primaryTintOnMap: string;
  /** Series colour for charts: readable on `card`. */
  chart: string;
}

/**
 * With the blue accent, «in progress» and «does not count» could not stay blue: they move to the
 * teal, the only meaning that turns with the accent.
 */
const IN_PROGRESS_WITH_BLUE = { dark: '#2DD4BF', light: '#0B666C' };

export function buildColors({ mode, accent }: ThemePreference): Palette {
  const dark = mode === 'dark';
  const tone = accentOf(accent);
  const primary = dark ? tone.dark : tone.light;
  const neutrals = dark ? DARK : LIGHT;
  const inProgress = accent === 'blue' ? IN_PROGRESS_WITH_BLUE[mode] : neutrals.accent;
  return {
    ...neutrals,
    accent: inProgress,
    accentTint: withAlpha(inProgress, dark ? 0.14 : 0.12),
    intensityLow: inProgress,
    primary,
    onPrimary: dark ? tone.onDark : tone.onLight,
    up: primary,
    primaryTint: withAlpha(primary, dark ? 0.14 : 0.12),
    primaryTintOnMap: withAlpha(primary, dark ? 0.2 : 0.18),
    chart: dark ? tone.chartDark : primary,
  };
}

/** How the map tiles are drawn in each mode: MapLibre's brightness (the static map uses `mapVeil`). */
export const MAP_BRIGHTNESS: Record<ThemeMode, number> = { dark: 0.62, light: 1 };

function parseColor(color: string): { rgb: [number, number, number]; alpha: number } {
  if (color.startsWith('#')) return { rgb: channels(color), alpha: 1 };
  const [r, g, b, a = 1] = color
    .slice(color.indexOf('(') + 1, color.indexOf(')'))
    .split(',')
    .map(Number);
  return { rgb: [r, g, b], alpha: a };
}

/** `color` (which may be see-through) laid over the opaque `under`, as a hex. */
export function over(color: string, under: string): string {
  const top = parseColor(color);
  const base = parseColor(under).rgb;
  return `#${top.rgb.map((c, i) => Math.round(c * top.alpha + base[i] * (1 - top.alpha)).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast of two opaque colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `from` to `to` in `t` (0–1), as a hex: a colour fading into another. */
export function mix(from: string, to: string, t: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a.map((c, i) => Math.round(c + (b[i] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}
