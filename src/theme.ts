import { DarkTheme } from 'expo-router';

export const colors = {
  bg: '#0E1116',
  card: '#171B22',
  cardAlt: '#1F2530',
  border: '#2A313C',
  text: '#F2F4F7',
  muted: '#9AA4B2',
  primary: '#4ADE80',
  onPrimary: '#0B1A10',
  accent: '#60A5FA',
  warning: '#FBBF24',
  danger: '#F87171',
  up: '#4ADE80',
  down: '#F87171',
  /** Cardio intensity: LISS, MISS and HIIT phases. */
  intensityLow: '#60A5FA',
  intensityMedium: '#FBBF24',
  intensityHigh: '#F87171',
  /** Series colour for charts: validated for lightness band and contrast on `card` (dataviz). */
  chart: '#16A34A',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.card,
    text: colors.text,
    border: colors.border,
  },
};
