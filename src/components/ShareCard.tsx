import type { ComponentRef, ReactNode, Ref } from 'react';
import { Image, PixelRatio, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polyline, Rect, Stop } from 'react-native-svg';
import type { LatLon } from '@/domain/gps';
import { outline } from '@/domain/mapView';
import { colors, shareType } from '@/theme';
import { RouteMap } from './RouteMap';
import { Icon } from './ui';

export type StoryStyle = 'mapa' | 'foto' | 'oscuro' | 'transparente';
export type StoryFormat = 'story' | 'square';

export interface StoryFigure {
  label: string;
  value: string;
  unit?: string;
}

export interface StoryExercise {
  name: string;
  detail: string;
}

/** The photo behind the «foto» look, framed to fill the image. */
export interface StoryPhoto {
  uri: string;
}

/**
 * Images to share: an Instagram story (1080 × 1920 px) or a square post (1080 × 1080). Every size
 * is in units of the width (`u` = width / 360, so 1 u is 3 px of the final image). In the story the
 * title and the figures stay inside the area Instagram does not cover (x 72–1008 px, y 250–1700
 * px); the name of the app and «© OpenStreetMap» go at the very bottom, as a footer.
 * «transparente» is a sticker: no background, everything white with a shadow, cropped to its
 * content (1080 × 1100 px, whatever the format). «foto» is the same white text over a photo.
 */
type StoryRef = Ref<ComponentRef<typeof View>>;
type ShareTypeName = keyof typeof shareType;

/** Where everything goes in each format, in units (360 wide). */
interface Frame {
  height: number;
  /** Side margin and the top of the title. */
  pad: number;
  top: number;
  /** Margin under the footer. */
  bottom: number;
  /** Text size against the story's. */
  k: number;
  /** The map of the «mapa» look, from the top, and the space it keeps free for the title and the fade. */
  map: number;
  mapInset: { top: number; bottom: number };
  /** Top of the fade of the map into the background. */
  fadeFrom: number;
  /** The route without map («oscuro»). */
  route: { top: number; height: number };
  /** The route over the photo; null: no route over the photo. */
  photoRoute: { top: number; height: number } | null;
  figures: number;
  exercises: number;
}

const FRAMES: Record<StoryFormat, Frame> = {
  story: {
    height: 640,
    pad: 24,
    top: 83,
    bottom: 26,
    k: 1,
    map: 450,
    mapInset: { top: 150, bottom: 40 },
    fadeFrom: 330,
    route: { top: 160, height: 270 },
    photoRoute: { top: 316, height: 130 },
    figures: 462,
    exercises: 6,
  },
  square: {
    height: 360,
    pad: 20,
    top: 20,
    bottom: 16,
    k: 0.8,
    // As much map as fits: the zoom goes in whole steps, and a little less room halves the route.
    map: 242,
    mapInset: { top: 60, bottom: 8 },
    fadeFrom: 190,
    route: { top: 72, height: 158 },
    photoRoute: { top: 134, height: 98 },
    figures: 244,
    exercises: 5,
  },
};

/** The sticker's own height (1080 × 1100 px), in units. */
const STICKER_HEIGHT = 1100 / 3;

/** Map tiles of the image come from this many zoom levels further in: a pixel of tile is a pixel of image. */
const TILE_DETAIL = Math.round(Math.log2(PixelRatio.get()));

/** A shareType token (pixels of the story) at the size of an image `u` wide, times `k`. */
function sized(name: ShareTypeName, u: number, k: number): TextStyle {
  const token: TextStyle = shareType[name];
  const f = (u / 3) * k;
  return {
    fontWeight: token.fontWeight,
    fontSize: (token.fontSize ?? 0) * f,
    lineHeight: token.lineHeight === undefined ? undefined : token.lineHeight * f,
    letterSpacing: token.letterSpacing === undefined ? undefined : token.letterSpacing * f,
  };
}

/** Text of the image: its size never follows the system font size. */
function ShareText({
  kind,
  u,
  k = 1,
  white = false,
  style,
  ...rest
}: TextProps & { kind: ShareTypeName; u: number; k?: number; white?: boolean; style?: StyleProp<TextStyle> }) {
  return <Text allowFontScaling={false} style={[sized(kind, u, k), style, white && styles.white]} {...rest} />;
}

function Story({
  ref,
  width,
  height,
  look,
  children,
}: {
  ref?: StoryRef;
  width: number;
  height: number;
  look: StoryStyle;
  children: ReactNode;
}) {
  return (
    <View
      ref={ref}
      collapsable={false}
      style={{ width, height, overflow: 'hidden', backgroundColor: look === 'transparente' ? 'transparent' : colors.bg }}>
      {children}
    </View>
  );
}

function Header({ u, k, title, subtitle, white }: { u: number; k: number; title: string; subtitle: string; white: boolean }) {
  return (
    <View style={{ gap: 3 * u * k }}>
      <ShareText kind="title" u={u} k={k} style={styles.title} white={white} numberOfLines={2}>
        {title}
      </ShareText>
      <ShareText kind="date" u={u} k={k} style={styles.muted} white={white}>
        {subtitle}
      </ShareText>
    </View>
  );
}

function Figures({ u, k, figures, columns, white }: { u: number; k: number; figures: StoryFigure[]; columns: number; white: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 * u * k }}>
      {figures.map((f) => (
        <View key={f.label} style={{ width: `${100 / columns}%`, gap: 1 * u * k }}>
          <ShareText kind="label" u={u} k={k} style={styles.muted} white={white}>
            {f.label.toUpperCase()}
          </ShareText>
          <ShareText kind="value" u={u} k={k} style={styles.value} white={white} numberOfLines={1} adjustsFontSizeToFit>
            {f.value}
            {f.unit ? (
              <ShareText kind="unit" u={u} k={k} style={styles.muted} white={white}>
                {` ${f.unit}`}
              </ShareText>
            ) : null}
          </ShareText>
        </View>
      ))}
    </View>
  );
}

/** The name of the app and, over map tiles, their attribution: the last line of the image. */
function Footer({ u, k, white, attribution }: { u: number; k: number; white: boolean; attribution: boolean }) {
  return (
    <View style={styles.footer}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 * u * k }}>
        <Icon name="dumbbell" size={12 * u * k} color={white ? colors.onImage : colors.primary} />
        <ShareText kind="brand" u={u} k={k} style={styles.brand} white={white}>
          ENTRENO
        </ShareText>
      </View>
      {attribution ? (
        <ShareText kind="attribution" u={u} k={k} style={styles.muted} white={white}>
          © OpenStreetMap
        </ShareText>
      ) : null}
    </View>
  );
}

/** The route as a line, without map: for the dark, photo and sticker looks. */
function RouteLine({ segments, width, height, u, white }: { segments: LatLon[][]; width: number; height: number; u: number; white: boolean }) {
  if (segments.flat().length < 2) return null;
  const shapes = outline(segments, width, height, 6 * u);
  const lines = shapes.map((s) => s.map((p) => `${p.x},${p.y}`).join(' '));
  const all = shapes.flat();
  const color = white ? colors.onImage : colors.primary;
  return (
    <Svg width={width} height={height}>
      {white
        ? lines.map((points, i) => (
            <Polyline
              key={`s${i}`}
              points={points}
              fill="none"
              stroke={colors.imageShadow}
              strokeWidth={7 * u}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))
        : null}
      {lines.map((points, i) => (
        <Polyline key={i} points={points} fill="none" stroke={color} strokeWidth={4 * u} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      <Circle cx={all[0].x} cy={all[0].y} r={4 * u} fill={white ? colors.imageShadow : colors.bg} stroke={color} strokeWidth={2 * u} />
      <Circle cx={all[all.length - 1].x} cy={all[all.length - 1].y} r={4.5 * u} fill={color} />
    </Svg>
  );
}

/** Darkens the map under the title and fades it into the background above the figures. */
function MapFade({ width, frame, u }: { width: number; frame: Frame; u: number }) {
  return (
    <Svg width={width} height={(frame.map + 40) * u} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="top" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.bg} stopOpacity={0.9} />
          <Stop offset="1" stopColor={colors.bg} stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
          <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={frame.mapInset.top * u} fill="url(#top)" />
      <Rect x={0} y={frame.fadeFrom * u} width={width} height={(frame.map - frame.fadeFrom) * u + 1} fill="url(#bottom)" />
    </Svg>
  );
}

/**
 * The photo filling the image, darkened at the top (title) and towards the bottom (figures) so
 * the white text reads over any photo; `dim` darkens all of it (a workout has text everywhere).
 */
function PhotoBackground({
  photo,
  width,
  height,
  dim = 0,
  onReady,
}: {
  photo: StoryPhoto;
  width: number;
  height: number;
  dim?: number;
  onReady?: () => void;
}) {
  return (
    <>
      <Image
        source={{ uri: photo.uri }}
        style={{ position: 'absolute', left: 0, top: 0, width, height }}
        resizeMode="cover"
        onLoadEnd={onReady}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="photoTop" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity={0.7} />
            <Stop offset="1" stopColor={colors.bg} stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="photoBottom" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.bg} stopOpacity={0.85} />
          </LinearGradient>
        </Defs>
        {dim > 0 ? <Rect x={0} y={0} width={width} height={height} fill={colors.bg} opacity={dim} /> : null}
        <Rect x={0} y={0} width={width} height={height * 0.32} fill="url(#photoTop)" />
        <Rect x={0} y={height * 0.4} width={width} height={height * 0.6 + 1} fill="url(#photoBottom)" />
      </Svg>
    </>
  );
}

export function WalkStory({
  ref,
  width,
  look,
  format,
  title,
  subtitle,
  segments,
  figures,
  photo,
  onMapReady,
  onPhotoReady,
}: {
  ref?: StoryRef;
  width: number;
  look: StoryStyle;
  format: StoryFormat;
  title: string;
  subtitle: string;
  segments: LatLon[][];
  figures: StoryFigure[];
  photo?: StoryPhoto | null;
  onMapReady?: () => void;
  onPhotoReady?: () => void;
}) {
  const u = width / 360;
  const pad = FRAMES[format].pad * u;

  if (look === 'transparente') {
    const height = STICKER_HEIGHT * u;
    return (
      <Story ref={ref} width={width} height={height} look={look}>
        <View style={{ flex: 1, paddingHorizontal: 24 * u, paddingVertical: 18 * u, gap: 10 * u }}>
          <Header u={u} k={1} title={title} subtitle={subtitle} white />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <RouteLine segments={segments} width={width - 48 * u} height={height * 0.4} u={u} white />
          </View>
          <Figures u={u} k={1} figures={figures} columns={2} white />
          <Footer u={u} k={1} white attribution={false} />
        </View>
      </Story>
    );
  }

  const frame = FRAMES[format];
  const height = frame.height * u;
  const { k } = frame;
  const onPhoto = look === 'foto' && !!photo;
  return (
    <Story ref={ref} width={width} height={height} look={look}>
      {look === 'mapa' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: frame.map * u }}>
          <RouteMap
            segments={segments}
            height={frame.map * u}
            rounded={false}
            veil={0.25}
            detail={TILE_DETAIL}
            attribution={false}
            fitInset={{ top: frame.mapInset.top * u, bottom: frame.mapInset.bottom * u }}
            fitPadding={4 * u}
            lineWidth={4.7 * u * k}
            onTilesLoaded={onMapReady}
          />
          <MapFade width={width} frame={frame} u={u} />
        </View>
      ) : onPhoto ? (
        <>
          <PhotoBackground photo={photo} width={width} height={height} onReady={onPhotoReady} />
          {frame.photoRoute ? (
            <View style={{ position: 'absolute', left: pad, right: pad, top: frame.photoRoute.top * u, height: frame.photoRoute.height * u }}>
              <RouteLine segments={segments} width={width - 2 * pad} height={frame.photoRoute.height * u} u={u * k} white />
            </View>
          ) : null}
        </>
      ) : (
        <View style={{ position: 'absolute', left: pad, right: pad, top: frame.route.top * u, height: frame.route.height * u }}>
          <RouteLine segments={segments} width={width - 2 * pad} height={frame.route.height * u} u={u * k} white={false} />
        </View>
      )}
      <View style={{ position: 'absolute', left: pad, right: pad, top: frame.top * u }}>
        <Header u={u} k={k} title={title} subtitle={subtitle} white={look === 'mapa' || onPhoto} />
      </View>
      <View style={{ position: 'absolute', left: pad, right: pad, top: frame.figures * u }}>
        <Figures u={u} k={k} figures={figures} columns={2} white={onPhoto} />
      </View>
      <View style={{ position: 'absolute', left: pad, right: pad, bottom: frame.bottom * u }}>
        <Footer u={u} k={k} white={onPhoto} attribution={look === 'mapa'} />
      </View>
    </Story>
  );
}

export function WorkoutStory({
  ref,
  width,
  look,
  format,
  title,
  subtitle,
  figures,
  exercises,
  photo,
  onPhotoReady,
}: {
  ref?: StoryRef;
  width: number;
  look: StoryStyle;
  format: StoryFormat;
  title: string;
  subtitle: string;
  figures: StoryFigure[];
  exercises: StoryExercise[];
  photo?: StoryPhoto | null;
  onPhotoReady?: () => void;
}) {
  const u = width / 360;
  const sticker = look === 'transparente';
  const frame = FRAMES[format];
  const k = sticker ? 1 : frame.k;
  const height = (sticker ? STICKER_HEIGHT : frame.height) * u;
  const pad = (sticker ? 24 : frame.pad) * u;
  const onPhoto = look === 'foto' && !!photo;
  const white = sticker || onPhoto;
  const shown = exercises.slice(0, sticker ? 6 : frame.exercises);
  const rest = exercises.length - shown.length;
  return (
    <Story ref={ref} width={width} height={height} look={look}>
      {onPhoto ? <PhotoBackground photo={photo} width={width} height={height} dim={0.45} onReady={onPhotoReady} /> : null}
      <View
        style={{
          flex: 1,
          paddingHorizontal: pad,
          paddingTop: (sticker ? 18 : frame.top) * u,
          paddingBottom: (sticker ? 18 : frame.bottom) * u,
          gap: 14 * u * k,
        }}>
        <Header u={u} k={k} title={title} subtitle={subtitle} white={white} />
        <Figures u={u} k={k} figures={figures} columns={3} white={white} />
        <View>
          {shown.map((e, i) => (
            <View
              key={i}
              style={[styles.exercise, { minHeight: 24 * u * k, borderTopColor: white ? colors.imageRuleOnPhoto : colors.imageRule }]}>
              <ShareText kind="exercise" u={u} k={k} style={styles.exerciseName} white={white} numberOfLines={1}>
                {e.name}
              </ShareText>
              <ShareText kind="exerciseDetail" u={u} k={k} style={styles.exerciseDetail} white={white} numberOfLines={1}>
                {e.detail}
              </ShareText>
            </View>
          ))}
          {rest > 0 ? (
            <ShareText kind="exerciseDetail" u={u} k={k} style={[styles.muted, { marginTop: 4 * u * k }]} white={white}>
              +{rest} más
            </ShareText>
          ) : null}
        </View>
        <View style={{ flex: 1 }} />
        <Footer u={u} k={k} white={white} attribution={false} />
      </View>
    </Story>
  );
}

const styles = StyleSheet.create({
  white: {
    color: colors.onImage,
    textShadowColor: colors.imageShadow,
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 2 },
  },
  brand: { color: colors.primary },
  title: { color: colors.text },
  muted: { color: colors.muted },
  value: { color: colors.text, fontVariant: ['tabular-nums'] },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exercise: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1 },
  exerciseName: { flex: 1, color: colors.text },
  exerciseDetail: { color: colors.muted, fontVariant: ['tabular-nums'] },
});
