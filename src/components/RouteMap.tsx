import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { LatLon } from '@/domain/gps';
import { fitView, outline, project, TILE_SIZE, tilesFor } from '@/domain/mapView';
import { colors, radius } from '@/theme';
import { AppText } from './ui';

// OpenStreetMap's own tiles: no API key. Their usage policy asks for attribution and a User-Agent
// that identifies the app; a personal app's few requests are well within it.
const tileSource = (z: number, x: number, y: number) => ({
  uri: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  headers: { 'User-Agent': 'Entreno/1.0 (personal training app)' },
});

/** A route drawn over map tiles; without internet only the line shows, over the app background. */
export function RouteMap({ segments, height = 240 }: { segments: LatLon[][]; height?: number }) {
  const [width, setWidth] = useState(0);
  const points = segments.flat();

  return (
    <View style={[styles.box, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {points.length === 0 ? (
        <View style={styles.empty}>
          <AppText variant="muted">Esperando la señal del GPS…</AppText>
        </View>
      ) : width > 0 ? (
        <MapContent segments={segments} points={points} width={width} height={height} />
      ) : null}
    </View>
  );
}

function MapContent({
  segments,
  points,
  width,
  height,
}: {
  segments: LatLon[][];
  points: LatLon[];
  width: number;
  height: number;
}) {
  const view = fitView(points, width, height);
  const toScreen = (p: LatLon) => {
    const { x, y } = project(p, view.zoom);
    return { x: x - view.originX, y: y - view.originY };
  };
  const start = toScreen(points[0]);
  const end = toScreen(points[points.length - 1]);

  return (
    <>
      {tilesFor(view, width, height).map((t) => (
        <Image
          key={`${view.zoom}/${t.x}/${t.y}/${t.left}`}
          source={tileSource(view.zoom, t.x, t.y)}
          style={{ position: 'absolute', left: t.left, top: t.top, width: TILE_SIZE, height: TILE_SIZE }}
        />
      ))}
      {/* Darkens the light map so it sits in the dark theme and the route stands out. */}
      <View style={styles.shade} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {segments.map((segment, i) => (
          <Polyline
            key={i}
            points={segment.map((p) => toScreen(p)).map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={colors.primary}
            strokeWidth={4}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <Circle cx={start.x} cy={start.y} r={6} fill={colors.bg} stroke={colors.primary} strokeWidth={3} />
        <Circle cx={end.x} cy={end.y} r={7} fill={colors.primary} stroke={colors.bg} strokeWidth={2} />
      </Svg>
      <Text style={styles.attribution}>© OpenStreetMap</Text>
    </>
  );
}

/** Small outline of a route, without map tiles, for lists. */
export function RouteThumbnail({ segments, size = 56 }: { segments: LatLon[][]; size?: number }) {
  if (segments.flat().length < 2) return null;
  return (
    <View style={[styles.thumbnail, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {outline(segments, size, size).map((segment, i) => (
          <Polyline
            key={i}
            points={segment.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={colors.primary}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  box: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(14, 17, 22, 0.55)' },
  attribution: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    fontSize: 10,
    color: colors.muted,
    backgroundColor: 'rgba(14, 17, 22, 0.6)',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
});
