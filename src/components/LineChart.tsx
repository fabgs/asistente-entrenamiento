import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { niceScale } from '@/domain/progress';
import { colors } from '@/theme';
import { AppText, Row } from './ui';

export interface ChartPoint {
  label: string;
  value: number;
}

const PAD = { left: 44, right: 16, top: 12, bottom: 26 };
const MAX_MARKERS = 20;

/**
 * Single-series line chart (dataviz spec): 2px line, 10% area wash, ringed markers, hairline grid.
 * Tapping or dragging snaps to the nearest session; the readout shows it (the latest by default).
 * Every value is also in the session table below the chart.
 */
export function LineChart({
  title,
  points,
  format,
  tickFormat = (v) => format(v).replace(' kg', ''),
  height = 170,
}: {
  title: string;
  points: ChartPoint[];
  format: (value: number) => string;
  /** Axis labels: only the number, as the unit does not fit in the left margin. */
  tickFormat?: (value: number) => string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  if (points.length === 0) return null;

  const active = selected ?? points.length - 1;
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const scale = niceScale(points.map((p) => p.value));
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - scale.min) / (scale.max - scale.min || 1)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  const baseline = PAD.top + plotH;
  const area = `${line} L${x(points.length - 1)},${baseline} L${x(0)},${baseline} Z`;

  const pick = (locationX: number) => {
    const ratio = (locationX - PAD.left) / plotW;
    const index = Math.round(ratio * (points.length - 1));
    setSelected(Math.min(points.length - 1, Math.max(0, index)));
  };

  return (
    <View style={{ gap: 4 }}>
      <Row between>
        <AppText variant="small">{title}</AppText>
        <AppText variant="small">
          <AppText style={{ fontWeight: '700' }}>{format(points[active].value)}</AppText> · {points[active].label}
        </AppText>
      </Row>
      <View
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        onResponderTerminationRequest={() => true}
        accessibilityLabel={`${title}: de ${format(points[0].value)} a ${format(points[points.length - 1].value)}`}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {scale.ticks.map((t) => (
              <Line key={`g${t}`} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
            ))}
            {scale.ticks.map((t) => (
              <SvgText key={`t${t}`} x={PAD.left - 8} y={y(t) + 4} fill={colors.muted} fontSize={11} textAnchor="end">
                {tickFormat(t)}
              </SvgText>
            ))}

            {points.length > 1 ? <Path d={area} fill={colors.chart} fillOpacity={0.1} /> : null}
            {points.length > 1 ? (
              <Path d={line} stroke={colors.chart} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />
            ) : null}

            {selected !== null ? (
              <Line x1={x(active)} x2={x(active)} y1={PAD.top} y2={baseline} stroke={colors.muted} strokeWidth={1} />
            ) : null}
            {points.map((p, i) =>
              points.length <= MAX_MARKERS || i === active ? (
                <Circle
                  key={i}
                  cx={x(i)}
                  cy={y(p.value)}
                  r={i === active ? 5 : 4}
                  fill={colors.chart}
                  stroke={colors.card}
                  strokeWidth={2}
                />
              ) : null,
            )}

            <SvgText x={x(0)} y={height - 6} fill={colors.muted} fontSize={11} textAnchor={points.length === 1 ? 'middle' : 'start'}>
              {points[0].label}
            </SvgText>
            {points.length > 1 ? (
              <SvgText x={x(points.length - 1)} y={height - 6} fill={colors.muted} fontSize={11} textAnchor="end">
                {points[points.length - 1].label}
              </SvgText>
            ) : null}
          </Svg>
        ) : (
          <View style={{ height }} />
        )}
      </View>
    </View>
  );
}
