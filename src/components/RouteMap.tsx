import { useEffect, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { LatLon } from '@/domain/gps';
import { fitView, osmTileUrl, outline, project, TILE_USER_AGENT, tilesFor } from '@/domain/mapView';
import { attributionType, colors, radius } from '@/theme';
import { AppText, Icon } from './ui';

const tileSource = (z: number, x: number, y: number) => ({ uri: osmTileUrl(z, x, y), headers: { 'User-Agent': TILE_USER_AGENT } });

/** Darkens the light tiles to sit in the dark theme (the 3D map uses raster-brightness-max 0.62). */
const VEIL = 0.38;
const PHOTO_MARK = 24;

/**
 * A route drawn over map tiles; without internet only the line shows, over the app background.
 * `cursor` marks a moment of the walk (from its chart); `onPress` opens the full map; `corner`
 * holds small buttons over the top-right corner.
 */
export function RouteMap({
  segments,
  height = 240,
  cursor = null,
  onPress,
  corner,
  rounded = true,
  onTilesLoaded,
  fitInset,
  fitPadding = 24,
  lineWidth = 5,
  veil = VEIL,
  detail = 1,
  attribution = true,
  photos = [],
}: {
  segments: LatLon[][];
  height?: number;
  cursor?: LatLon | null;
  onPress?: () => void;
  corner?: ReactNode;
  rounded?: boolean;
  /** Called once every tile has loaded or failed (for capturing the map as an image). */
  onTilesLoaded?: () => void;
  /** Space kept free above and below the route (e.g. for text drawn over the map). */
  fitInset?: { top: number; bottom: number };
  /** Margin around the route inside that space. */
  fitPadding?: number;
  lineWidth?: number;
  /** How much the light map is darkened to sit in the dark theme. */
  veil?: number;
  /** Zoom levels the tiles come from further in, drawn smaller and so sharper (see tilesFor). */
  detail?: number;
  /** false when the screen shows «© OpenStreetMap» itself (the share image). */
  attribution?: boolean;
  /** Where the walk's photos were taken: a camera on the route. */
  photos?: LatLon[];
}) {
  const [width, setWidth] = useState(0);
  const points = segments.flat();

  return (
    <View style={[styles.box, !rounded && styles.square, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {points.length === 0 ? (
        <View style={styles.empty}>
          <AppText variant="muted">Esperando la señal del GPS…</AppText>
        </View>
      ) : width > 0 ? (
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          style={StyleSheet.absoluteFill}
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={onPress ? 'Abrir el mapa a pantalla completa' : 'Mapa de la ruta'}>
          <MapContent
            segments={segments}
            points={points}
            width={width}
            height={height}
            cursor={cursor}
            onTilesLoaded={onTilesLoaded}
            fitInset={fitInset}
            fitPadding={fitPadding}
            lineWidth={lineWidth}
            veil={veil}
            detail={detail}
            attribution={attribution}
            photos={photos}
          />
        </Pressable>
      ) : null}
      {corner && points.length > 0 ? <View style={styles.corner}>{corner}</View> : null}
    </View>
  );
}

function MapContent({
  segments,
  points,
  width,
  height,
  cursor,
  onTilesLoaded,
  fitInset = { top: 0, bottom: 0 },
  fitPadding,
  lineWidth,
  veil,
  detail,
  attribution,
  photos,
}: {
  segments: LatLon[][];
  points: LatLon[];
  width: number;
  height: number;
  cursor: LatLon | null;
  onTilesLoaded?: () => void;
  fitInset?: { top: number; bottom: number };
  fitPadding: number;
  lineWidth: number;
  veil: number;
  detail: number;
  attribution: boolean;
  photos: LatLon[];
}) {
  const fitted = fitView(points, width, height - fitInset.top - fitInset.bottom, fitPadding);
  const view = { ...fitted, originY: fitted.originY - fitInset.top };
  const tiles = tilesFor(view, width, height, detail);
  const [settled, setSettled] = useState(0);
  const toScreen = (p: LatLon) => {
    const { x, y } = project(p, view.zoom);
    return { x: x - view.originX, y: y - view.originY };
  };
  const start = toScreen(points[0]);
  const end = toScreen(points[points.length - 1]);
  const mark = cursor ? toScreen(cursor) : null;
  const lines = segments.map((segment) => segment.map((p) => toScreen(p)).map((p) => `${p.x},${p.y}`).join(' '));
  const allSettled = tiles.length > 0 && settled >= tiles.length;
  useEffect(() => {
    if (allSettled) onTilesLoaded?.();
  }, [allSettled, onTilesLoaded]);

  return (
    <>
      {tiles.map((t) => (
        <Image
          key={`${t.zoom}/${t.x}/${t.y}/${t.left}`}
          source={tileSource(t.zoom, t.x, t.y)}
          onLoadEnd={onTilesLoaded ? () => setSettled((n) => n + 1) : undefined}
          style={{ position: 'absolute', left: t.left, top: t.top, width: t.size, height: t.size }}
        />
      ))}
      {/* Darkens the light map so it sits in the dark theme and the route stands out. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: veil }]} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {/* The dark outline keeps the green line readable over light tiles. */}
        {lines.map((points, i) => (
          <Polyline
            key={`o${i}`}
            points={points}
            fill="none"
            stroke={colors.bg}
            strokeOpacity={0.7}
            strokeWidth={lineWidth + 4}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {lines.map((points, i) => (
          <Polyline
            key={i}
            points={points}
            fill="none"
            stroke={colors.primary}
            strokeWidth={lineWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <Circle cx={start.x} cy={start.y} r={6} fill={colors.bg} stroke={colors.primary} strokeWidth={3} />
        <Circle cx={end.x} cy={end.y} r={7} fill={colors.primary} stroke={colors.bg} strokeWidth={2} />
        {/* Same mark as the chart's cursor. */}
        {mark ? (
          <>
            <Circle cx={mark.x} cy={mark.y + 1} r={10} fill={colors.bg} opacity={0.35} />
            <Circle cx={mark.x} cy={mark.y} r={7} fill={colors.text} stroke={colors.bg} strokeWidth={3} />
          </>
        ) : null}
      </Svg>
      {photos.map((p, i) => {
        const at = toScreen(p);
        return (
          <View key={i} pointerEvents="none" style={[styles.photo, { left: at.x - PHOTO_MARK / 2, top: at.y - PHOTO_MARK / 2 }]}>
            <Icon name="camera" size={13} color={colors.text} />
          </View>
        );
      })}
      {attribution ? (
        <Text style={styles.attribution} maxFontSizeMultiplier={1}>
          © OpenStreetMap
        </Text>
      ) : null}
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
  thumbnail: { borderRadius: radius.sm, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  box: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.cardAlt },
  square: { borderRadius: 0 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', top: 8, right: 8, gap: 8 },
  photo: {
    position: 'absolute',
    width: PHOTO_MARK,
    height: PHOTO_MARK,
    borderRadius: PHOTO_MARK / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 2,
    borderColor: colors.text,
  },
  attribution: {
    position: 'absolute',
    left: 6,
    bottom: 4,
    ...attributionType,
    color: colors.muted,
    backgroundColor: colors.overlay,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
});
