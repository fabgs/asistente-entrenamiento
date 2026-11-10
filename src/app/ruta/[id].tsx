import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { InteractiveMap, type MapLayer, type MapMode, type MapStatus } from '@/components/InteractiveMap';
import { TrackChart } from '@/components/TrackChart';
import { AppText, Button, EmptyState, FloatingButton, IconButton, Loading, Segmented, Value } from '@/components/ui';
import { updateSettings } from '@/db/repositories/settings';
import { activeMs, distanceAlong, positionAtDistance } from '@/domain/gps';
import { walkMetric, walkSnapshot } from '@/domain/walkStats';
import { useDb, useNow } from '@/hooks/data';
import { useCardioSession, useFollowedRoute } from '@/hooks/walk';
import { colors, radius, spacing } from '@/theme';

/** Height of the chart in the open sheet. */
const CHART_H = 140;
const TOAST_MS = 1500;

// While the app is open, the map opens again in the last mode used.
let lastMode: MapMode = '2d';

/** The route full screen: interactive map (2D/3D, map or satellite) over the chart, in sync. */
export default function RouteExplorerScreen() {
  const { id, modo } = useLocalSearchParams<{ id: string; modo?: string }>();
  const db = useDb();
  const { data, reload } = useCardioSession(Number(id));
  const live = !!data?.points;
  const now = useNow(live ? 1000 : 60_000);
  const insets = useSafeAreaInsets();
  const [mode, setModeState] = useState<MapMode>(modo === '3d' ? '3d' : lastMode);
  const [layer, setLayer] = useState<MapLayer>('map');
  const [status, setStatus] = useState<MapStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [cursorD, setCursorD] = useState<number | null>(null);
  const [select, setSelect] = useState<{ d: number; key: number } | undefined>();
  const [recenter, setRecenter] = useState(0);
  const [north, setNorth] = useState(0);
  const [turned, setTurned] = useState(false);
  const [open, setOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [following, setFollowing] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // The route and the chart change with each read of the points (every 3 s while recording).
  const lastFix = data?.points?.at(-1)?.t ?? 0;
  const walk = useMemo(() => (data ? walkSnapshot(data.session, data.points, lastFix) : null), [data, lastFix]);
  const kms = useMemo(() => {
    if (!walk) return [];
    const total = walk.samples.at(-1)?.d ?? 0;
    return Array.from({ length: Math.floor(total / 1000) }, (_, i) => {
      const p = positionAtDistance(walk.segments, (i + 1) * 1000);
      return p ? { ...p, km: i + 1 } : null;
    }).filter((k) => k !== null);
  }, [walk]);

  // While walking, what is left of the followed route; a finished walk shows only itself.
  const guide = useFollowedRoute(live && data?.followed ? { route: data.followed, state: data.session.followState } : null);

  if (data === undefined) return <Loading />;
  if (data === null || !walk) return null;

  const offline = status === 'offline';
  const cursor = cursorD === null ? null : positionAtDistance(walk.segments, cursorD);
  const unit = data.settings.distanceUnit;
  const hasChart = walk.samples.length > 2;

  const setMode = (m: MapMode) => {
    lastMode = m;
    setModeState(m);
  };
  const toggleLayer = () => {
    const next = layer === 'map' ? 'satellite' : 'map';
    setLayer(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next === 'map' ? 'Mapa' : 'Satélite');
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };
  const chevron = (
    <IconButton
      icon={open ? 'chevron-down' : 'chevron-up'}
      size={20}
      label={open ? 'Plegar la gráfica' : 'Desplegar la gráfica'}
      onPress={() => setOpen(!open)}
    />
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <InteractiveMap
        key={attempt}
        segments={walk.segments}
        guide={guide?.ahead}
        cursor={cursor}
        kms={kms}
        mode={offline ? '2d' : mode}
        layer={offline ? 'map' : layer}
        topInset={insets.top + 56}
        bottomInset={sheetHeight}
        recenterKey={recenter}
        northKey={north}
        follow={live && following}
        onStatus={setStatus}
        onCamera={({ bearing, pitch }) => setTurned(Math.abs(bearing) > 1 || (mode === '2d' && pitch > 1))}
        onUserMove={() => setFollowing(false)}
        onTap={(p) => {
          const d = distanceAlong(walk.segments, p);
          if (d === null) return;
          setCursorD(d);
          setSelect({ d, key: Date.now() });
        }}
      />

      {/* Keeps the status bar readable over light tiles. */}
      <Svg pointerEvents="none" width="100%" height={insets.top + 64} style={styles.topShade}>
        <Defs>
          <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity={0.75} />
            <Stop offset="1" stopColor={colors.bg} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#shade)" />
      </Svg>

      {status === 'loading' ? (
        <View style={[styles.state, { bottom: sheetHeight }]} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
          <AppText variant="caption">{mode === '3d' ? 'Cargando relieve…' : 'Cargando mapa…'}</AppText>
        </View>
      ) : offline ? (
        <View style={[styles.state, styles.offline, { bottom: sheetHeight }]}>
          <EmptyState
            icon="wifi-off"
            title="Sin conexión"
            text="El mapa interactivo necesita internet."
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
      ) : null}

      <View style={[styles.back, { top: insets.top + spacing.sm }]}>
        <FloatingButton icon="arrow-left" label="Volver" onPress={() => router.back()} />
      </View>
      {offline ? null : (
        <View style={[styles.controls, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
          <Segmented
            onMap
            options={[
              { value: '2d', label: '2D' },
              { value: '3d', label: '3D' },
            ]}
            value={mode}
            onChange={setMode}
            style={styles.modes}
          />
          <FloatingButton icon="layers-outline" label={layer === 'map' ? 'Ver satélite' : 'Ver mapa'} onPress={toggleLayer} />
          <FloatingButton
            icon="fit-to-screen-outline"
            label="Ver toda la ruta"
            onPress={() => {
              setFollowing(false);
              setRecenter(recenter + 1);
            }}
          />
          {turned ? <FloatingButton icon="compass-outline" label="Norte arriba" onPress={() => setNorth(north + 1)} /> : null}
        </View>
      )}

      {toast ? (
        <View style={[styles.state, { bottom: sheetHeight }]} pointerEvents="none">
          <View style={styles.toast}>
            <AppText variant="bodySm" weight="600">
              {toast}
            </AppText>
          </View>
        </View>
      ) : null}

      {live && !following && !offline ? (
        <View style={[styles.recenter, { bottom: sheetHeight + spacing.md }]} pointerEvents="box-none">
          <FloatingButton pill icon="crosshairs-gps" text="Recentrar" label="Volver a tu posición" onPress={() => setFollowing(true)} />
        </View>
      ) : null}

      {hasChart || live ? (
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
          onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}>
          {live && !open ? (
            <View style={styles.liveRow}>
              {(['distance', 'time', 'pace'] as const).map((m) => {
                const numbers = { ...walk.numbers, activeMs: activeMs(data.session, now) };
                const t = walkMetric(m, numbers, unit);
                return (
                  <View key={m} style={styles.liveCell}>
                    <AppText variant="label" numberOfLines={1}>
                      {t.label}
                    </AppText>
                    <Value value={t.value} unit={t.unit} size="metric" />
                  </View>
                );
              })}
              {chevron}
            </View>
          ) : (
            <TrackChart
              samples={walk.samples}
              average={live ? { ...walk.numbers, activeMs: activeMs(data.session, now) } : walk.numbers}
              unit={unit}
              metric={data.settings.cardioChart}
              onMetric={(m) => updateSettings(db, { cardioChart: m }).then(reload)}
              height={CHART_H}
              live={live}
              plot={open}
              select={select}
              accessory={chevron}
              onCursor={(p) => setCursorD(p?.d ?? null)}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topShade: { position: 'absolute', top: 0, left: 0 },
  back: { position: 'absolute', left: spacing.sm },
  controls: { position: 'absolute', right: spacing.sm, alignItems: 'flex-end', gap: spacing.sm },
  modes: { width: 96 },
  state: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  offline: { backgroundColor: colors.bg },
  toast: {
    backgroundColor: colors.overlay,
    borderColor: colors.overlayBorder,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  recenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  liveCell: { flex: 1, gap: 2 },
});
