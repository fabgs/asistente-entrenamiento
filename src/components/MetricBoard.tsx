import * as Haptics from 'expo-haptics';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  gridMetrics,
  spokenMetric,
  walkMetric,
  type BoardMode,
  type DistanceUnit,
  type WalkMetric,
  type WalkNumbers,
} from '@/domain/walkStats';
import { colors, radius, spacing } from '@/theme';
import { AppText, Value } from './ui';

/**
 * The figures of a walk: one big and the rest in a grid. Tapping a cell moves its figure to the big
 * spot and the distance takes that cell, so the others never move (gridMetrics); tapping the big
 * distance switches between km and metres.
 */
export function MetricBoard({
  mode,
  hero: preferred,
  numbers,
  unit,
  onHero,
  onToggleUnit,
  paused = false,
  hint = false,
}: {
  mode: BoardMode;
  hero: WalkMetric;
  numbers: WalkNumbers;
  unit: DistanceUnit;
  onHero: (metric: WalkMetric) => void;
  onToggleUnit: () => void;
  /** Recording paused: the figures go grey. */
  paused?: boolean;
  /** Until the first change, a caption says the cells can be tapped. */
  hint?: boolean;
}) {
  const live = mode === 'live';
  const { hero, cells } = gridMetrics(preferred, mode);
  const big = walkMetric(hero, numbers, unit);
  const isDistance = hero === 'distance';
  const columns = live ? 3 : 2;
  const rows: WalkMetric[][] = [];
  for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
  const ink = paused ? colors.muted : colors.text;
  const fadeKey = (m: WalkMetric) => (m === 'distance' ? `${m}:${unit}` : m);

  return (
    <View style={{ gap: spacing.md }}>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          onToggleUnit();
        }}
        disabled={!isDistance}
        accessibilityRole={isDistance ? 'button' : 'text'}
        accessibilityLabel={spokenMetric(big)}
        accessibilityHint={isDistance ? `Cambia a ${unit === 'km' ? 'metros' : 'kilómetros'}` : undefined}>
        <Fade k={fadeKey(hero)} style={[styles.hero, live && { alignItems: 'center' }]}>
          <AppText variant="label">{big.label}</AppText>
          <Value
            value={big.value}
            unit={big.unit}
            size={live ? 'display' : 'heroSm'}
            color={ink}
            align={live ? 'center' : undefined}
            fit
          />
        </Fade>
      </Pressable>

      <View style={styles.grid}>
        {rows.map((row, r) => (
          <Fragment key={r}>
            {r > 0 ? <View style={styles.hDivider} /> : null}
            <View style={styles.gridRow}>
              {row.map((m, c) => {
                const t = walkMetric(m, numbers, unit);
                return (
                  <Fragment key={c}>
                    {c > 0 ? <View style={styles.vDivider} /> : null}
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        onHero(m);
                      }}
                      android_ripple={{ color: colors.pressed }}
                      style={[styles.cell, live ? styles.cellLive : styles.cellDetail]}
                      accessibilityRole="button"
                      accessibilityLabel={spokenMetric(t)}
                      accessibilityHint="Toca para verlo en grande">
                      <Fade k={fadeKey(m)} style={styles.cellContent}>
                        <AppText variant="label" numberOfLines={1} maxFontSizeMultiplier={1.15}>
                          {t.label}
                        </AppText>
                        {/* The live cells are measured for 26 sp («11:32 /km» takes 90 of 93 dp): they do not grow. */}
                        <Value value={t.value} unit={t.unit} size={live ? 'metric' : 'metricSm'} color={ink} maxScale={live ? 1 : undefined} />
                      </Fade>
                    </Pressable>
                  </Fragment>
                );
              })}
            </View>
          </Fragment>
        ))}
      </View>
      {hint ? <AppText variant="caption">Toca un dato para verlo en grande</AppText> : null}
    </View>
  );
}

/** Fades its content in for 150 ms whenever `k` changes (not on the first render). */
function Fade({ k, style, children }: { k: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [opacity] = useState(() => new Animated.Value(1));
  const shown = useRef(k);
  useEffect(() => {
    if (shown.current === k) return;
    shown.current = k;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [k, opacity]);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  hero: { gap: 2 },
  grid: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' },
  gridRow: { flexDirection: 'row' },
  hDivider: { height: 1, backgroundColor: colors.border },
  vDivider: { width: 1, backgroundColor: colors.border },
  cell: { flex: 1, justifyContent: 'center' },
  cellLive: { minHeight: 64, paddingVertical: 10, paddingHorizontal: spacing.sm },
  cellDetail: { minHeight: 72, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  cellContent: { gap: 2 },
});
