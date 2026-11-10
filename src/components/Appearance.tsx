import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { ACCENTS, buildColors, THEME_MODES, themeLabel, type Palette, type ThemePreference } from '@/domain/palette';
import { applyTheme } from '@/services/themePreference';
import { colors, radius, spacing, theme } from '@/theme';
import { Sheet } from './Sheet';
import { AppText, Button, Icon, ListGroup, ListRow, Section, Segmented } from './ui';

const SWATCH = 48;

/**
 * Ajustes → Apariencia (PLAN.md §8, 1.4.10): the mode (dark or light) and the accent. Every colour
 * is read once when the app starts, so the choice is made on samples and a small preview and
 * «Aplicar» restarts the app. Not while a workout or a cardio session is in progress.
 */
export function AppearanceSection({ busy }: { busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ThemePreference>(theme);
  const [applying, setApplying] = useState(false);
  const changed = choice.mode !== theme.mode || choice.accent !== theme.accent;
  const close = () => {
    setOpen(false);
    setChoice(theme);
  };

  return (
    <Section label="Apariencia">
      <ListGroup>
        <ListRow title="Tema y color" right={<AppText variant="secondary">{themeLabel(theme)}</AppText>} onPress={() => setOpen(true)} />
      </ListGroup>
      <Sheet visible={open} title="Apariencia" onClose={close}>
        <Segmented options={THEME_MODES} value={choice.mode} onChange={(mode) => setChoice({ ...choice, mode })} />
        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">Color</AppText>
          <View style={styles.swatches} accessibilityRole="radiogroup">
            {ACCENTS.map((accent) => {
              const on = accent.key === choice.accent;
              const tone = buildColors({ mode: choice.mode, accent: accent.key });
              return (
                <Pressable
                  key={accent.key}
                  onPress={() => {
                    if (on) return;
                    Haptics.selectionAsync();
                    setChoice({ ...choice, accent: accent.key });
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={accent.name}
                  style={styles.swatchCell}>
                  <View style={[styles.ring, on && { borderColor: colors.text }]}>
                    <View style={[styles.swatch, { backgroundColor: tone.primary }]}>
                      {on ? <Icon name="check-bold" size={22} color={tone.onPrimary} /> : null}
                    </View>
                  </View>
                  <AppText variant="label" numberOfLines={1} style={on ? { color: colors.text } : undefined}>
                    {accent.name}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
        <ThemePreview palette={buildColors(choice)} light={choice.mode === 'light'} />
        <AppText variant="caption" style={{ textAlign: 'center' }}>
          {busy ? 'Termina el entreno o el cardio en curso para cambiarlo.' : 'La app se reinicia un momento.'}
        </AppText>
        <Button
          size="lg"
          title="Aplicar"
          disabled={!changed || busy || applying}
          onPress={() => {
            setApplying(true);
            applyTheme(choice).catch(() => setApplying(false));
          }}
        />
      </Sheet>
    </Section>
  );
}

/**
 * A few pieces of the app drawn with a palette that is not the one in use: copies, because the real
 * components took their colours when the app started.
 */
function ThemePreview({ palette: p, light }: { palette: Palette; light: boolean }) {
  return (
    <View
      style={[styles.preview, { backgroundColor: p.bg, borderColor: p.border }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View style={[styles.previewCard, { backgroundColor: p.card }, light && { borderWidth: StyleSheet.hairlineWidth, borderColor: p.cardBorder }]}>
        <View style={styles.previewRow}>
          <Icon name="check-circle" size={22} color={p.primary} />
          <View style={{ flex: 1 }}>
            <AppText variant="rowTitle" numberOfLines={1} style={{ color: p.text }}>
              Caminar
            </AppText>
            <AppText variant="caption" numberOfLines={1} style={{ color: p.muted }}>
              5,14 km · 59 min
            </AppText>
          </View>
          <Svg width={64} height={36}>
            {[
              { stroke: p.mapCasing, width: 7 },
              { stroke: p.primary, width: 3.5 },
            ].map((line) => (
              <Polyline
                key={line.width}
                points="6,28 16,12 30,20 40,8 58,14"
                fill="none"
                stroke={line.stroke}
                strokeWidth={line.width}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </Svg>
        </View>
        <View style={[styles.previewSegmented, { backgroundColor: p.cardAlt, borderColor: p.border }]}>
          <View style={[styles.previewSegment, { backgroundColor: p.primaryTint }]}>
            <AppText variant="control" numberOfLines={1} style={{ color: p.primary }}>
              Esta semana
            </AppText>
          </View>
          <View style={styles.previewSegment}>
            <AppText variant="control" weight="500" numberOfLines={1} style={{ color: p.muted }}>
              Últimos días
            </AppText>
          </View>
        </View>
      </View>
      <View style={[styles.previewButton, { backgroundColor: p.primary }]}>
        <AppText variant="rowValue" numberOfLines={1} style={{ color: p.onPrimary }}>
          Serie hecha
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', justifyContent: 'space-between' },
  swatchCell: { flex: 1, alignItems: 'center', gap: spacing.xs },
  ring: { padding: 3, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.card },
  swatch: { width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, alignItems: 'center', justifyContent: 'center' },
  preview: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.md },
  previewCard: { borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  previewSegmented: { flexDirection: 'row', minHeight: 36, borderWidth: 1, borderRadius: radius.md, padding: 3, gap: 3 },
  previewSegment: { flex: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  previewButton: { minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
