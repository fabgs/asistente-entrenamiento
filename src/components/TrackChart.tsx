import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { formatClock, formatNumber } from '@/domain/format';
import type { TrackSample } from '@/domain/gps';
import { niceScale } from '@/domain/progress';
import {
  chartSummary,
  distanceTicks,
  isZoomed,
  nearestIndex,
  percentileRange,
  trackSeries,
  zoomRange,
  type Range,
  type SeriesPoint,
  type TrackMetric,
} from '@/domain/trackChart';
import { fixed, formatDistance, type DistanceUnit } from '@/domain/walkStats';
import { colors, radius, spacing, type } from '@/theme';
import { AppText, FloatingButton, Segmented, Value } from './ui';

const PAD = { left: 36, right: 12, top: 8 };
/** Under the plot: the distance labels and, zoomed in, the position bar. */
const AXIS_H = 28;
/** Never zoom in closer than this many metres. */
const MIN_SPAN_M = 200;
const DOUBLE_TAP_MS = 300;
/** Movement that turns a touch into a drag. */
const SLOP = 8;
/** While recording, the readout goes back to the latest point this long after letting go. */
const LIVE_RELEASE_MS = 5000;
/** Below this the chart of a walk being recorded says little. */
const LIVE_MIN_M = 100;
/** The map is told where the cursor is at most this often (a WebView does not keep up with more). */
const REPORT_MS = 50;
const ZOOM_ANIMATION_MS = 200;

const METRICS: { value: TrackMetric; label: string }[] = [
  { value: 'pace', label: 'Ritmo' },
  { value: 'speed', label: 'Velocidad' },
  { value: 'altitude', label: 'Altitud' },
];

const paceText = (minutes: number) => formatClock(Math.round(minutes * 60) * 1000);

const FORMAT: Record<TrackMetric, { value: (v: number) => string; unit: string; tick: (v: number) => string; step: number }> = {
  pace: { value: paceText, unit: '/km', tick: paceText, step: 1 / 60 },
  speed: { value: (v) => fixed(v, 1), unit: 'km/h', tick: (v) => formatNumber(v, 1), step: 0.1 },
  altitude: { value: (v) => String(Math.round(v)), unit: 'm', tick: (v) => formatNumber(v, 0), step: 1 },
};

/** 3–4 marks of the y axis that its labels can show exactly, none repeated. */
function valueTicks(ticks: number[], metric: TrackMetric): number[] {
  const { tick, step } = FORMAT[metric];
  const exact = ticks.filter((t) => Math.abs(t / step - Math.round(t / step)) < 1e-6);
  return exact.filter((t, i) => exact.findIndex((u) => tick(u) === tick(t)) === i);
}

/** A figure over the chart: label above, value and unit below (the cells of the board above). */
interface Cell {
  label: string;
  value: string;
  unit?: string;
}

function StatCell({ label, value, unit }: Cell) {
  return (
    <View style={styles.cell}>
      <AppText variant="label" numberOfLines={1}>
        {label}
      </AppText>
      <Value value={value} unit={unit} />
    </View>
  );
}

/**
 * The chart of a walk, with a selector (pace, speed, altitude) along the distance. A tap places the
 * cursor and a horizontal drag moves it (`onCursor`, to mark it on the map); a vertical drag scrolls
 * the page. Pinching or double tapping zooms in and «Ver todo» goes back. `live` follows the latest
 * point while recording; `focus` zooms to a stretch from outside (a km of the splits).
 */
export function TrackChart({
  samples,
  average,
  unit,
  metric: initialMetric = 'pace',
  onMetric,
  onCursor,
  height: fixedHeight = 200,
  fill = false,
  live = false,
  focus,
  select,
  plot = true,
  hint = false,
  onHintSeen,
  accessory,
}: {
  samples: TrackSample[];
  /** Distance and active time of the walk, for the averages of the readout. */
  average?: { distanceM: number; activeMs: number };
  unit: DistanceUnit;
  /** The metric to start with (remembered in the settings through `onMetric`). */
  metric?: TrackMetric;
  onMetric?: (metric: TrackMetric) => void;
  onCursor?: (point: { s: number; d: number } | null) => void;
  /** Of the plot, without the distance axis. */
  height?: number;
  /** Takes the height left in its parent instead (the live panel). */
  fill?: boolean;
  live?: boolean;
  focus?: { min: number; max: number; key: number };
  /** Puts the cursor at a distance from outside (e.g. a tap on the map). */
  select?: { d: number; key: number };
  /** false: only the selector and the readout (a folded sheet). */
  plot?: boolean;
  /** Shows once how to use it, until the first drag. */
  hint?: boolean;
  onHintSeen?: () => void;
  /** At the end of the readout row (the chevron of the map's sheet). */
  accessory?: ReactNode;
}) {
  const [metric, setMetricState] = useState<TrackMetric>(initialMetric);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = size.width;
  const height = fill ? Math.max(40, size.height - PAD.top - AXIS_H) : fixedHeight;
  const [cursorD, setCursorD] = useState<number | null>(null);
  const [zoom, setZoom] = useState<Range | null>(null);
  const [hintGone, setHintGone] = useState(false);
  // The accessory (the chevron of the map's sheet) gets an empty twin on the left, so the two
  // figures stay centred on the sheet.
  const [accessoryW, setAccessoryW] = useState(0);
  const box = useRef<ComponentRef<typeof View>>(null);
  const origin = useRef({ x: 0, y: 0 });
  const touch = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);
  const pinch = useRef<{ view: Range; spanPx: number; anchor: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number } | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reported = useRef({ at: 0, point: null as SeriesPoint | null });
  const frame = useRef<number | null>(null);

  // A new `focus` zooms to it once; a new `select` moves the cursor.
  const [focusKey, setFocusKey] = useState<number | null>(null);
  if (focus && focus.key !== focusKey) {
    setFocusKey(focus.key);
    setZoom({ min: focus.min, max: focus.max });
    setCursorD(focus.min);
  }
  const [selectKey, setSelectKey] = useState<number | null>(null);
  if (select && select.key !== selectKey) {
    setSelectKey(select.key);
    setCursorD(select.d);
  }
  useEffect(
    () => () => {
      if (release.current) clearTimeout(release.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const hasAltitude = samples.some((x) => x.a !== null);
  const available = METRICS.filter((m) => m.value !== 'altitude' || hasAltitude);
  const shown = available.some((m) => m.value === metric) ? metric : 'pace';
  const series = trackSeries(samples, shown);
  const lastD = samples[samples.length - 1]?.d ?? 0;
  const fmt = FORMAT[shown];
  const selector = (
    <Segmented
      options={available}
      value={shown}
      onChange={(m) => {
        setMetricState(m);
        onMetric?.(m);
        clearCursor();
      }}
    />
  );

  if (live && (series.length < 2 || lastD < LIVE_MIN_M)) {
    return (
      <View style={[{ gap: spacing.sm }, fill && { flex: 1 }]}>
        {selector}
        {accessory ? <View style={{ alignItems: 'flex-end' }}>{accessory}</View> : null}
        <View style={[styles.waiting, fill ? { flex: 1 } : { height: height + PAD.top + AXIS_H }]}>
          <AppText variant="caption">La gráfica aparece a partir de los 100 m</AppText>
        </View>
      </View>
    );
  }
  if (series.length < 2) return null;

  const full: Range = { min: series[0].d, max: Math.max(series[0].d + 1, series[series.length - 1].d) };
  // A zoom from before the walk grew (live) stays inside the data.
  const view: Range =
    zoom && isZoomed(zoom, full) ? { min: Math.max(full.min, zoom.min), max: Math.min(full.max, zoom.max) } : full;
  const zoomed = view !== full;
  const visible = series.filter((p) => p.d >= view.min && p.d <= view.max);
  const values = visible.map((p) => p.value).filter((v): v is number => v !== null);
  const range = percentileRange(values);
  const scale = niceScale([range.min, range.max], 4);
  const yTicks = valueTicks(scale.ticks, shown);
  const invert = shown === 'pace'; // the faster pace, lower, goes on top

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const baseline = PAD.top + height;
  const x = (d: number) => PAD.left + ((d - view.min) / (view.max - view.min || 1)) * plotW;
  const y = (v: number) => {
    const ratio = (Math.min(scale.max, Math.max(scale.min, v)) - scale.min) / (scale.max - scale.min || 1);
    return invert ? PAD.top + ratio * height : baseline - ratio * height;
  };
  const dAt = (px: number) => view.min + ((px - PAD.left) / plotW) * (view.max - view.min);

  // Gaps (stopped or paused) break the line.
  let line = '';
  let area = '';
  let run: SeriesPoint[] = [];
  const flush = () => {
    if (run.length > 1) {
      const path = run.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.d)},${y(p.value!)}`).join(' ');
      line += path;
      area += `${path} L${x(run[run.length - 1].d)},${baseline} L${x(run[0].d)},${baseline} Z`;
    }
    run = [];
  };
  for (const p of visible) {
    // Slower than the scale is walking up to a stop: a gap, like the stop itself, not a spike.
    if (p.value === null || (invert && p.value > scale.max)) flush();
    else run.push(p);
  }
  flush();

  const following = live && cursorD === null;
  const active =
    cursorD !== null ? series[nearestIndex(series, cursorD, (p) => p.d)] : following ? series[series.length - 1] : null;
  const xTicks = distanceTicks(view, unit);
  const text = (value: number | null) => (value === null ? '–' : fmt.value(value));
  const unitOf = (value: number | null) => (value === null ? undefined : fmt.unit);
  const summary = chartSummary(shown, samples, average);
  // With a point chosen, its value and where it is; while recording, the latest one and the
  // average; else the summary of the walk.
  const cells: [Cell, Cell] = active && !following
    ? [
        { label: METRICS.find((m) => m.value === shown)!.label, value: text(active.value), unit: unitOf(active.value) },
        {
          label: 'Punto',
          ...(unit === 'km'
            ? { value: formatNumber(active.d / 1000, 2), unit: `km · ${formatClock(active.s * 1000)}` }
            : { value: formatDistance(active.d, 'm').value, unit: `m · ${formatClock(active.s * 1000)}` }),
        },
      ]
    : active
      ? [
          { label: 'Ahora', value: text(active.value), unit: unitOf(active.value) },
          { label: summary[0].label, value: text(summary[0].value), unit: unitOf(summary[0].value) },
        ]
      : [
          { label: summary[0].label, value: text(summary[0].value), unit: unitOf(summary[0].value) },
          { label: summary[1].label, value: text(summary[1].value), unit: unitOf(summary[1].value) },
        ];

  function clearCursor() {
    if (release.current) clearTimeout(release.current);
    setCursorD(null);
    onCursor?.(null);
  }

  const report = (point: SeriesPoint, force: boolean) => {
    const now = Date.now();
    reported.current.point = point;
    if (!force && now - reported.current.at < REPORT_MS) return;
    reported.current.at = now;
    onCursor?.({ s: point.s, d: point.d });
  };

  const selectAt = (px: number, force: boolean) => {
    if (release.current) clearTimeout(release.current);
    const d = Math.min(full.max, Math.max(full.min, dAt(px)));
    const point = series[nearestIndex(series, d, (p) => p.d)];
    setCursorD(point.d);
    report(point, force);
  };

  const followAgainLater = () => {
    if (!live) return;
    if (release.current) clearTimeout(release.current);
    release.current = setTimeout(clearCursor, LIVE_RELEASE_MS);
  };

  const animateTo = (target: Range) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const from = view;
    const start = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / ZOOM_ANIMATION_MS);
      const e = 1 - (1 - k) ** 3;
      if (k < 1) {
        setZoom({ min: from.min + (target.min - from.min) * e, max: from.max + (target.max - from.max) * e });
        frame.current = requestAnimationFrame(step);
      } else {
        frame.current = null;
        setZoom(isZoomed(target, full) ? target : null);
      }
    };
    frame.current = requestAnimationFrame(step);
  };

  const zoomIn = (anchor: number) => {
    const atMax = view.max - view.min <= MIN_SPAN_M * 1.01;
    animateTo(atMax ? full : zoomRange(view, full, 2, anchor, MIN_SPAN_M));
  };

  const measure = () =>
    box.current?.measure((_x: number, _y: number, _w: number, _h: number, pageX: number, pageY: number) => {
      origin.current = { x: pageX, y: pageY };
    });

  // Taps, from the raw touches: the chart only claims the gesture when the finger moves sideways.
  const onTouchStart = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length !== 1) {
      touch.current = null;
      return;
    }
    measure();
    touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: e.nativeEvent.timestamp, moved: false };
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    const start = touch.current;
    if (!start) return;
    if (Math.abs(e.nativeEvent.pageX - start.x) > SLOP || Math.abs(e.nativeEvent.pageY - start.y) > SLOP) start.moved = true;
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || start.moved) return;
    const px = start.x - origin.current.x;
    const py = start.y - origin.current.y;
    if (px < PAD.left || py > baseline) {
      clearCursor();
      return;
    }
    const now = e.nativeEvent.timestamp;
    const previous = lastTap.current;
    if (previous && now - previous.t < DOUBLE_TAP_MS && Math.abs(previous.x - px) < 40) {
      lastTap.current = null;
      zoomIn(dAt(px));
      return;
    }
    lastTap.current = { t: now, x: px };
    selectAt(px, true);
    followAgainLater();
  };

  const wantsGesture = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length >= 2) return true;
    const start = touch.current;
    if (!start) return false;
    const dx = Math.abs(e.nativeEvent.pageX - start.x);
    const dy = Math.abs(e.nativeEvent.pageY - start.y);
    return dx > SLOP && dx > dy;
  };

  const onGrant = () => {
    if (release.current) clearTimeout(release.current);
    if (hint && !hintGone) {
      setHintGone(true);
      onHintSeen?.();
    }
    // true: the ScrollView around cannot take the gesture while it lasts.
    return true;
  };

  const onMove = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length >= 2) {
      const [a, b] = [touches[0].pageX - origin.current.x, touches[1].pageX - origin.current.x];
      const spanPx = Math.max(20, Math.abs(a - b));
      const center = (a + b) / 2;
      if (!pinch.current) pinch.current = { view, spanPx, anchor: dAt(center) };
      const start = pinch.current;
      const span = ((start.view.max - start.view.min) * start.spanPx) / spanPx;
      const ratio = (center - PAD.left) / plotW;
      const anchored = { min: start.anchor - ratio * span, max: start.anchor - ratio * span + span };
      setZoom(zoomRange(anchored, full, 1, start.anchor, MIN_SPAN_M));
      return;
    }
    if (pinch.current) return; // one finger lifted at the end of a pinch
    selectAt(e.nativeEvent.pageX - origin.current.x, false);
  };

  const onRelease = () => {
    const wasPinch = pinch.current !== null;
    pinch.current = null;
    const last = reported.current.point;
    if (!wasPinch && last) report(last, true);
    followAgainLater();
  };

  const metricLabel = METRICS.find((m) => m.value === shown)!.label;
  const spokenSummary = summary
    .map((c) => `${c.label.toLowerCase()} ${c.value === null ? 'sin datos' : `${fmt.value(c.value)} ${fmt.unit}`}`)
    .join(', ');
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'zoomIn') zoomIn((view.min + view.max) / 2);
    if (e.nativeEvent.actionName === 'reset') animateTo(full);
  };

  return (
    <View style={[{ gap: spacing.sm }, fill && { flex: 1 }]}>
      {selector}

      <View style={styles.readout}>
        {accessory ? <View style={{ width: accessoryW }} /> : null}
        <StatCell {...cells[0]} />
        <StatCell {...cells[1]} />
        {accessory ? <View onLayout={(e) => setAccessoryW(e.nativeEvent.layout.width)}>{accessory}</View> : null}
      </View>

      {plot ? (
        <View
          ref={box}
          style={fill ? { flex: 1 } : undefined}
          onLayout={(e) => {
            setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
            measure();
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => (touch.current = null)}
          onStartShouldSetResponder={(e) => e.nativeEvent.touches.length >= 2}
          onMoveShouldSetResponder={wantsGesture}
          onResponderGrant={onGrant}
          onResponderMove={onMove}
          onResponderRelease={onRelease}
          onResponderTerminationRequest={() => false}
          onResponderTerminate={() => (pinch.current = null)}
          accessible
          accessibilityLabel={`${metricLabel} a lo largo de la ruta: ${spokenSummary}`}
          accessibilityActions={[
            { name: 'zoomIn', label: 'Ampliar' },
            { name: 'reset', label: 'Ver todo' },
          ]}
          onAccessibilityAction={onAction}>
          {width > 0 ? (
            <Svg width={width} height={height + PAD.top + AXIS_H}>
              {yTicks.map((t) => (
                <Line key={`g${t}`} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
              ))}
              {yTicks.map((t) => (
                <SvgText
                  key={`t${t}`}
                  x={PAD.left - 6}
                  y={y(t) + 4}
                  fill={colors.muted}
                  fontSize={type.axis.fontSize}
                  fontWeight={type.axis.fontWeight}
                  textAnchor="end">
                  {fmt.tick(t)}
                </SvgText>
              ))}
              {xTicks.map((t, i) => (
                <SvgText
                  key={`x${t.d}`}
                  x={x(t.d)}
                  y={baseline + 16}
                  fill={colors.muted}
                  fontSize={type.axis.fontSize}
                  fontWeight={type.axis.fontWeight}
                  textAnchor={i === xTicks.length - 1 && x(t.d) > width - 40 ? 'end' : 'middle'}>
                  {t.label}
                </SvgText>
              ))}
              {area ? <Path d={area} fill={colors.chart} fillOpacity={shown === 'altitude' ? 0.2 : 0.1} /> : null}
              {line ? (
                <Path d={line} stroke={colors.chart} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />
              ) : null}
              {active && active.d >= view.min && active.d <= view.max ? (
                <>
                  {following ? null : (
                    <Line
                      x1={x(active.d)}
                      x2={x(active.d)}
                      y1={PAD.top}
                      y2={baseline}
                      stroke={colors.text}
                      strokeOpacity={0.5}
                      strokeWidth={1}
                    />
                  )}
                  {active.value !== null ? (
                    <Circle cx={x(active.d)} cy={y(active.value)} r={5} fill={colors.text} stroke={colors.card} strokeWidth={2} />
                  ) : null}
                </>
              ) : null}
              {zoomed ? (
                <>
                  <Rect x={PAD.left} y={baseline + AXIS_H - 4} width={plotW} height={4} rx={2} fill={colors.cardAlt} />
                  <Rect
                    x={PAD.left + ((view.min - full.min) / (full.max - full.min)) * plotW}
                    y={baseline + AXIS_H - 4}
                    width={Math.max(8, ((view.max - view.min) / (full.max - full.min)) * plotW)}
                    height={4}
                    rx={2}
                    fill={colors.muted}
                  />
                </>
              ) : null}
            </Svg>
          ) : (
            <View style={fill ? { flex: 1 } : { height: height + PAD.top + AXIS_H }} />
          )}
          {hint && !hintGone && width > 0 ? (
            <View pointerEvents="none" style={[styles.hint, { top: PAD.top, height, left: PAD.left, right: PAD.right }]}>
              <View style={styles.hintBox}>
                <AppText variant="caption" style={{ color: colors.text, textAlign: 'center' }}>
                  Arrastra para ver cada punto · pellizca para ampliar
                </AppText>
              </View>
            </View>
          ) : null}
          {zoomed ? (
            <View style={styles.all}>
              <FloatingButton pill icon="fit-to-screen-outline" text="Ver todo" label="Ver la ruta entera" onPress={() => animateTo(full)} />
            </View>
          ) : null}
        </View>
      ) : null}
      {plot && shown === 'altitude' ? <AppText variant="caption">Altitud aproximada, del GPS</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  waiting: { alignItems: 'center', justifyContent: 'center' },
  readout: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  // Each figure centred in its half, so the pair sits symmetric under the selector.
  cell: { flex: 1, gap: 2, alignItems: 'center' },
  hint: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  hintBox: {
    backgroundColor: colors.hintBox,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 260,
  },
  all: { position: 'absolute', top: spacing.sm, right: spacing.sm },
});
