import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { niceScale, splitUnit } from '@/domain/progress';
import { colors, spacing, type } from '@/theme';
import { AppText, Value } from './ui';

export interface ChartPoint {
  label: string;
  value: number;
}

const PAD = { left: 36, right: 8, top: 8, bottom: 22 };

/**
 * Single-series line chart (one series per chart, never a second axis): 2 dp line with a 10 % area
 * wash and a hairline grid. A fixed readout above the plot shows one point, the latest until a
 * tap or a drag snaps the cursor to the nearest one. Only the latest point and the cursor carry a
 * marker. `title` names the series for TalkBack.
 */
export function LineChart({
  title,
  points,
  format,
  tickFormat = (v) => splitUnit(format(v)).value,
  height = 200,
}: {
  title: string;
  points: ChartPoint[];
  /** Value with its unit ("20 kg"); the readout splits it at the first space. */
  format: (value: number) => string;
  /** Axis labels: only the number, as the unit does not fit in the left margin. */
  tickFormat?: (value: number) => string;
  /** Height of the plot with its x axis, without the readout. */
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const touch = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  if (points.length === 0) return null;

  const last = points.length - 1;
  // A shorter series (another exercise, another metric) must not keep a cursor out of range.
  const cursor = selected !== null && selected <= last ? selected : null;
  const active = cursor ?? last;
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const baseline = PAD.top + plotH;
  const scale = niceScale(points.map((p) => p.value));
  const x = (i: number) => PAD.left + (last === 0 ? plotW / 2 : (i / last) * plotW);
  const y = (v: number) => baseline - ((v - scale.min) / (scale.max - scale.min || 1)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(last)},${baseline} L${x(0)},${baseline} Z`;

  const pick = (e: GestureResponderEvent) => {
    const ratio = (e.nativeEvent.locationX - PAD.left) / plotW;
    setSelected(Math.min(last, Math.max(0, Math.round(ratio * last))));
  };
  // A tap or a sideways drag moves the cursor; a vertical drag is left to the page scroll.
  const onGrant = (e: GestureResponderEvent) => {
    touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, dragging: false };
  };
  const onMove = (e: GestureResponderEvent) => {
    const t = touch.current;
    if (!t) return;
    const dx = Math.abs(e.nativeEvent.pageX - t.x);
    if (!t.dragging && dx > 8 && dx > Math.abs(e.nativeEvent.pageY - t.y)) t.dragging = true;
    if (t.dragging) pick(e);
  };
  const onRelease = (e: GestureResponderEvent) => {
    if (touch.current && !touch.current.dragging) pick(e);
    touch.current = null;
  };

  const reading = splitUnit(format(points[active].value));
  const pointText = (i: number) => `${format(points[i].value)} el ${points[i].label}`;
  const axisText = { fill: colors.muted, fontSize: type.axis.fontSize, fontWeight: type.axis.fontWeight } as const;

  return (
    <View>
      <View style={styles.readout}>
        <Value value={reading.value} unit={reading.unit} size="metricSm" />
        <AppText variant="label" tabular numberOfLines={1}>
          {points[active].label}
        </AppText>
      </View>
      <View
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onRelease}
        onResponderTerminate={() => (touch.current = null)}
        onResponderTerminationRequest={() => !touch.current?.dragging}
        accessible
        accessibilityLabel={`${title}: de ${pointText(0)} a ${pointText(last)}`}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {scale.ticks.map((t) => (
              <Line key={`g${t}`} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
            ))}
            {scale.ticks.map((t) => (
              <SvgText key={`t${t}`} x={PAD.left - 6} y={y(t) + 4} textAnchor="end" {...axisText}>
                {tickFormat(t)}
              </SvgText>
            ))}
            <SvgText x={x(0)} y={height - 6} textAnchor={last === 0 ? 'middle' : 'start'} {...axisText}>
              {points[0].label}
            </SvgText>
            {last > 0 ? (
              <SvgText x={x(last)} y={height - 6} textAnchor="end" {...axisText}>
                {points[last].label}
              </SvgText>
            ) : null}

            {last > 0 ? <Path d={area} fill={colors.chart} fillOpacity={0.1} /> : null}
            {last > 0 ? (
              <Path d={line} stroke={colors.chart} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />
            ) : null}

            {cursor !== last ? (
              <Circle cx={x(last)} cy={y(points[last].value)} r={4} fill={colors.chart} stroke={colors.card} strokeWidth={2} />
            ) : null}
            {cursor !== null ? (
              <>
                <Line
                  x1={x(cursor)}
                  x2={x(cursor)}
                  y1={PAD.top}
                  y2={baseline}
                  stroke={colors.text}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
                <Circle cx={x(cursor)} cy={y(points[cursor].value)} r={5} fill={colors.text} stroke={colors.card} strokeWidth={2} />
              </>
            ) : null}
          </Svg>
        ) : (
          <View style={{ height }} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
