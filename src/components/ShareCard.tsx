import type { ComponentRef, ReactNode, Ref } from 'react';
import { PixelRatio, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polyline, Rect, Stop } from 'react-native-svg';
import type { LatLon } from '@/domain/gps';
import { outline } from '@/domain/mapView';
import { colors, shareType } from '@/theme';
import { RouteMap } from './RouteMap';
import { Icon } from './ui';

export type StoryStyle = 'mapa' | 'oscuro' | 'transparente';

export interface StoryFigure {
  label: string;
  value: string;
  unit?: string;
}

export interface StoryExercise {
  name: string;
  detail: string;
}

/**
 * Images to share as an Instagram story (1080 × 1920 px). Every size is in units of the width
 * (`u` = width / 360, so 1 u is 3 px of the final image), and the text stays inside the safe area
 * (x 72–1008 px, y 250–1670 px) that Instagram does not cover. «transparente» is a sticker: no
 * background, everything white with a shadow, cropped to its content (1080 × 1100 px).
 */
export const STICKER_RATIO = 1100 / 1080;

type StoryRef = Ref<ComponentRef<typeof View>>;
type ShareTypeName = keyof typeof shareType;

const SAFE = { x: 24, top: 83, bottom: 557 };
/** Map tiles of the image come from this many zoom levels further in: a pixel of tile is a pixel of image. */
const TILE_DETAIL = Math.round(Math.log2(PixelRatio.get()));

/** A shareType token (pixels of the image) at the size of a story `u` wide. */
function sized(name: ShareTypeName, u: number): TextStyle {
  const token: TextStyle = shareType[name];
  const k = u / 3;
  return {
    fontWeight: token.fontWeight,
    fontSize: (token.fontSize ?? 0) * k,
    lineHeight: token.lineHeight === undefined ? undefined : token.lineHeight * k,
    letterSpacing: token.letterSpacing === undefined ? undefined : token.letterSpacing * k,
  };
}

/** Text of the image: its size never follows the system font size. */
function ShareText({
  kind,
  u,
  white = false,
  style,
  ...rest
}: TextProps & { kind: ShareTypeName; u: number; white?: boolean; style?: StyleProp<TextStyle> }) {
  return <Text allowFontScaling={false} style={[sized(kind, u), style, white && styles.white]} {...rest} />;
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

function Header({
  u,
  title,
  subtitle,
  sticker,
  overMap = false,
}: {
  u: number;
  title: string;
  subtitle: string;
  sticker: boolean;
  overMap?: boolean;
}) {
  return (
    <View style={{ gap: 3 * u }}>
      <ShareText kind="title" u={u} style={styles.title} white={sticker || overMap} numberOfLines={2}>
        {title}
      </ShareText>
      <ShareText kind="date" u={u} style={styles.muted} white={sticker || overMap}>
        {subtitle}
      </ShareText>
    </View>
  );
}

function Figures({ u, figures, columns, sticker }: { u: number; figures: StoryFigure[]; columns: number; sticker: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 * u }}>
      {figures.map((f) => (
        <View key={f.label} style={{ width: `${100 / columns}%`, gap: 1 * u }}>
          <ShareText kind="label" u={u} style={styles.muted} white={sticker}>
            {f.label.toUpperCase()}
          </ShareText>
          <ShareText kind="value" u={u} style={styles.value} white={sticker} numberOfLines={1} adjustsFontSizeToFit>
            {f.value}
            {f.unit ? (
              <ShareText kind="unit" u={u} style={styles.muted} white={sticker}>
                {` ${f.unit}`}
              </ShareText>
            ) : null}
          </ShareText>
        </View>
      ))}
    </View>
  );
}

function Brand({ u, sticker }: { u: number; sticker: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 * u }}>
      <Icon name="dumbbell" size={12 * u} color={sticker ? colors.onImage : colors.primary} />
      <ShareText kind="brand" u={u} style={styles.brand} white={sticker}>
        ENTRENO
      </ShareText>
    </View>
  );
}

/** The route as a line, without map: for the dark and sticker looks. */
function RouteLine({ segments, width, height, u, sticker }: { segments: LatLon[][]; width: number; height: number; u: number; sticker: boolean }) {
  if (segments.flat().length < 2) return null;
  const shapes = outline(segments, width, height, 6 * u);
  const lines = shapes.map((s) => s.map((p) => `${p.x},${p.y}`).join(' '));
  const all = shapes.flat();
  const color = sticker ? colors.onImage : colors.primary;
  return (
    <Svg width={width} height={height}>
      {sticker
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
      <Circle cx={all[0].x} cy={all[0].y} r={4 * u} fill={sticker ? colors.imageShadow : colors.bg} stroke={color} strokeWidth={2 * u} />
      <Circle cx={all[all.length - 1].x} cy={all[all.length - 1].y} r={4.5 * u} fill={color} />
    </Svg>
  );
}

/** Darkens the map under the title and fades it into the background above the figures. */
function MapFade({ width, mapHeight, u }: { width: number; mapHeight: number; u: number }) {
  return (
    <Svg width={width} height={mapHeight + 40 * u} style={StyleSheet.absoluteFill}>
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
      <Rect x={0} y={0} width={width} height={150 * u} fill="url(#top)" />
      <Rect x={0} y={300 * u} width={width} height={mapHeight - 300 * u + 1} fill="url(#bottom)" />
    </Svg>
  );
}

export function WalkStory({
  ref,
  width,
  height,
  look,
  title,
  subtitle,
  segments,
  figures,
  onMapReady,
}: {
  ref?: StoryRef;
  width: number;
  height: number;
  look: StoryStyle;
  title: string;
  subtitle: string;
  segments: LatLon[][];
  figures: StoryFigure[];
  onMapReady?: () => void;
}) {
  const u = width / 360;
  const sticker = look === 'transparente';
  const pad = SAFE.x * u;

  if (sticker) {
    return (
      <Story ref={ref} width={width} height={height} look={look}>
        <View style={{ flex: 1, paddingHorizontal: pad, paddingVertical: 18 * u, gap: 10 * u }}>
          <Header u={u} title={title} subtitle={subtitle} sticker />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <RouteLine segments={segments} width={width - 2 * pad} height={height * 0.4} u={u} sticker />
          </View>
          <Figures u={u} figures={figures} columns={2} sticker />
          <Brand u={u} sticker />
        </View>
      </Story>
    );
  }

  const mapHeight = 417 * u;
  return (
    <Story ref={ref} width={width} height={height} look={look}>
      {look === 'mapa' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: mapHeight }}>
          <RouteMap
            segments={segments}
            height={mapHeight}
            rounded={false}
            veil={0.25}
            detail={TILE_DETAIL}
            attribution={false}
            fitInset={{ top: 150 * u, bottom: 30 * u }}
            lineWidth={4.7 * u}
            onTilesLoaded={onMapReady}
          />
          <MapFade width={width} mapHeight={mapHeight} u={u} />
        </View>
      ) : (
        <View style={{ position: 'absolute', left: pad, right: pad, top: 160 * u, height: 250 * u }}>
          <RouteLine segments={segments} width={width - 2 * pad} height={250 * u} u={u} sticker={false} />
        </View>
      )}
      <View style={{ position: 'absolute', left: pad, right: pad, top: SAFE.top * u }}>
        <Header u={u} title={title} subtitle={subtitle} sticker={false} overMap={look === 'mapa'} />
      </View>
      <View style={{ position: 'absolute', left: pad, right: pad, top: 425 * u }}>
        <Figures u={u} figures={figures} columns={2} sticker={false} />
      </View>
      <View style={[styles.footer, { left: pad, right: pad, top: 535 * u }]}>
        <Brand u={u} sticker={false} />
        {look === 'mapa' ? (
          <ShareText kind="attribution" u={u} style={styles.muted}>
            © OpenStreetMap
          </ShareText>
        ) : null}
      </View>
    </Story>
  );
}

export function WorkoutStory({
  ref,
  width,
  height,
  look,
  title,
  subtitle,
  figures,
  exercises,
}: {
  ref?: StoryRef;
  width: number;
  height: number;
  look: StoryStyle;
  title: string;
  subtitle: string;
  figures: StoryFigure[];
  exercises: StoryExercise[];
}) {
  const u = width / 360;
  const sticker = look === 'transparente';
  const pad = SAFE.x * u;
  const shown = exercises.slice(0, 6);
  const rest = exercises.length - shown.length;
  return (
    <Story ref={ref} width={width} height={height} look={look}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: pad,
          paddingTop: (sticker ? 18 : SAFE.top) * u,
          paddingBottom: (sticker ? 18 : 640 - SAFE.bottom) * u,
          gap: 14 * u,
        }}>
        <Header u={u} title={title} subtitle={subtitle} sticker={sticker} />
        <Figures u={u} figures={figures} columns={3} sticker={sticker} />
        <View>
          {shown.map((e, i) => (
            <View
              key={i}
              style={[styles.exercise, { minHeight: 24 * u, borderTopColor: sticker ? colors.imageRuleOnPhoto : colors.imageRule }]}>
              <ShareText kind="exercise" u={u} style={styles.exerciseName} white={sticker} numberOfLines={1}>
                {e.name}
              </ShareText>
              <ShareText kind="exerciseDetail" u={u} style={styles.exerciseDetail} white={sticker} numberOfLines={1}>
                {e.detail}
              </ShareText>
            </View>
          ))}
          {rest > 0 ? (
            <ShareText kind="exerciseDetail" u={u} style={[styles.muted, { marginTop: 4 * u }]} white={sticker}>
              +{rest} más
            </ShareText>
          ) : null}
        </View>
        <View style={{ flex: 1 }} />
        <Brand u={u} sticker={sticker} />
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
  footer: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exercise: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1 },
  exerciseName: { flex: 1, color: colors.text },
  exerciseDetail: { color: colors.muted, fontVariant: ['tabular-nums'] },
});
