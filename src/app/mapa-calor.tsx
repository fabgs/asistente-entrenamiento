import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InteractiveMap, type HeatPath, type MapStatus } from '@/components/InteractiveMap';
import { HeatLegend } from '@/components/MuscleWeek';
import { AppText, Button, EmptyState, FloatingButton, Loading, Segmented } from '@/components/ui';
import { hintsSeen, markHintSeen } from '@/db/repositories/hints';
import { getHeatMode, setHeatMode } from '@/db/repositories/pathHeat';
import type { LatLon } from '@/domain/gps';
import { mix } from '@/domain/palette';
import {
  hasRecentHeat,
  HEAT_MODES,
  heatCellAt,
  heatFrame,
  heatLegend,
  heatLines,
  heatReading,
  type HeatLine,
  type HeatMode,
} from '@/domain/pathHeat';
import { useDb, useLoader } from '@/hooks/data';
import { usePathHeat } from '@/hooks/pathHeat';
import { colors, radius, spacing } from '@/theme';

/** From long ago (grey) to the most walked: one red, only here (PLAN.md §12). */
const TRAIL = [colors.trail0, colors.trail1, colors.trail2, colors.trail3, colors.trail4] as const;
/** Width of a path of each level, in dp. */
const WIDTHS = [2, 3, 4, 5.5, 7] as const;

/** A lone walk getting old fades to the grey of the net: its colour, its width and its outline, not its opacity (that adds up where lines cross). */
function toPath(line: HeatLine): HeatPath {
  const fading = line.level === 1 && line.fade < 1;
  return {
    points: line.points,
    color: fading ? mix(colors.trail0, colors.trail1, line.fade) : TRAIL[line.level],
    width: fading ? WIDTHS[0] + (WIDTHS[1] - WIDTHS[0]) * line.fade : WIDTHS[line.level],
    casing: line.level === 0 ? 0 : fading ? line.fade : 1,
    sort: fading ? line.fade : line.level,
  };
}

/**
 * Mapa de calor (PLAN.md §6.8, 1.4.10), from Mis rutas: the paths of every walk with GPS, redder
 * the more they are walked. «Últimos 30 días» fades what is left alone back to grey; «Siempre»
 * counts every walk. Tapping a path reads its walks.
 */
export default function HeatMapScreen() {
  const db = useDb();
  const insets = useSafeAreaInsets();
  const { heat, version, done, today } = usePathHeat();
  const { data: prefs } = useLoader(async (db) => ({ mode: await getHeatMode(db), hint: !(await hintsSeen(db)).has('heat-map') }));
  const [chosen, setChosen] = useState<HeatMode | null>(null);
  const mode = chosen ?? prefs?.mode ?? 'recent';
  const [status, setStatus] = useState<MapStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [recenter, setRecenter] = useState(0);
  const [north, setNorth] = useState(0);
  const [turned, setTurned] = useState(false);
  const [tapped, setTapped] = useState<LatLon | null>(null);
  const [hintGone, setHintGone] = useState(false);

  // `heat` grows in place while the older walks are read: `version` says when.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const paths = useMemo(() => (heat ? heatLines(heat, mode).map(toPath) : []), [heat, version, mode]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frame = useMemo(() => (heat ? heatFrame(heat) : null), [heat, version]);

  // A one-time hint: seen as soon as it has been shown.
  const showHint = !!prefs?.hint && !hintGone;
  useEffect(() => {
    if (prefs?.hint) void markHintSeen(db, 'heat-map');
  }, [db, prefs?.hint]);

  if (!heat || !prefs) return <Loading />;
  // With nothing walked in the last 30 days the map has no place to open on until the older walks are in.
  if (!frame && !done) return <Loading />;
  if (heat.walks === 0) {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="map-outline"
          title="Sin caminatas todavía"
          text="Cuando termines una caminata con GPS verás aquí por dónde pasas más."
        />
      </View>
    );
  }

  const offline = status === 'offline';
  const cell = tapped ? heatCellAt(heat, tapped) : null;
  const legend = heatLegend(heat, mode);
  // «Siempre» counts every walk: until the old ones are in, its levels are not the real ones.
  const counting = !done && mode === 'always';

  return (
    <View style={styles.screen}>
      <View style={styles.map}>
        <InteractiveMap
          key={attempt}
          segments={[]}
          heat={paths}
          frame={frame}
          cursor={cell ? tapped : null}
          mode="2d"
          layer="map"
          recenterKey={recenter}
          northKey={north}
          onStatus={setStatus}
          onCamera={({ bearing, pitch }) => setTurned(Math.abs(bearing) > 1 || pitch > 1)}
          onTap={(p) => {
            setHintGone(true);
            setTapped(p);
          }}
          onTapOut={() => {
            setHintGone(true);
            setTapped(null);
          }}
        />
        {status === 'loading' ? (
          <View style={styles.state} pointerEvents="none">
            <ActivityIndicator color={colors.primary} />
            <AppText variant="caption">Cargando mapa…</AppText>
          </View>
        ) : offline ? (
          <View style={[styles.state, styles.offline]}>
            <EmptyState
              icon="wifi-off"
              title="Sin conexión"
              text="El mapa necesita internet."
              action={
                <Button
                  kind="secondary"
                  title="Reintentar"
                  onPress={() => {
                    setStatus('loading');
                    setAttempt(attempt + 1);
                  }}
                />
              }
            />
          </View>
        ) : (
          <>
            <View style={styles.controls} pointerEvents="box-none">
              <FloatingButton icon="fit-to-screen-outline" label="Ver todo lo andado" onPress={() => setRecenter(recenter + 1)} />
              {turned ? <FloatingButton icon="compass-outline" label="Norte arriba" onPress={() => setNorth(north + 1)} /> : null}
            </View>
            {showHint ? (
              <View style={styles.hintLayer} pointerEvents="none">
                <View style={styles.hint}>
                  <AppText variant="bodySm" style={{ textAlign: 'center' }}>
                    Los caminos que repites se van poniendo rojos.
                  </AppText>
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Segmented
          options={HEAT_MODES}
          value={mode}
          onChange={(next) => {
            setChosen(next);
            setHintGone(true);
            void setHeatMode(db, next);
          }}
        />
        {/* One line: the reading of the path tapped, or the legend. */}
        <View style={styles.line}>
          {counting ? (
            <AppText variant="secondary" style={styles.center}>
              Calculando…
            </AppText>
          ) : cell ? (
            <AppText variant="bodySm" weight="600" style={styles.center} numberOfLines={2}>
              {heatReading(cell, mode, today)}
            </AppText>
          ) : mode === 'recent' && !hasRecentHeat(heat) ? (
            <AppText variant="secondary" style={styles.center}>
              Ninguna caminata en los últimos 30 días
            </AppText>
          ) : (
            <HeatLegend
              ramp={TRAIL}
              levels={[1, 2, 3, 4]}
              from={legend.low}
              to={legend.high}
              label={
                mode === 'recent'
                  ? 'Caminos de los últimos 30 días, de una vez a casi a diario; en gris, los de antes'
                  : `Caminos de siempre, de una caminata a ${legend.high}`
              }
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  state: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  offline: { backgroundColor: colors.bg },
  controls: { position: 'absolute', top: spacing.sm, right: spacing.sm, alignItems: 'flex-end', gap: spacing.sm },
  hintLayer: { position: 'absolute', left: spacing.lg, right: spacing.lg, top: spacing.sm + 52, alignItems: 'center' },
  hint: {
    backgroundColor: colors.overlay,
    borderColor: colors.overlayBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  bar: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  // Two lines of reading at a big font, so the bar does not jump when a path is tapped.
  line: { minHeight: 40, justifyContent: 'center' },
  center: { textAlign: 'center' },
});
