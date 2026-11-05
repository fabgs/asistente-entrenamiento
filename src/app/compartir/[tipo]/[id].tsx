import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { showSnackbar } from '@/components/Dialog';
import { WalkStory, WorkoutStory, type StoryExercise, type StoryFigure, type StoryFormat, type StoryStyle } from '@/components/ShareCard';
import { sprintMetres, sprintSpeed } from '@/components/Sprint';
import { AppText, BottomBar, Button, EmptyState, Loading, Screen, Segmented, TextField } from '@/components/ui';
import { getCardioSession, setCardioTitle } from '@/db/repositories/cardioSessions';
import { listPhotos, type Photo } from '@/db/repositories/photos';
import { getSlot, isBodyweight, type Slot } from '@/db/repositories/routines';
import { getSession, listSets, setSessionTitle } from '@/db/repositories/sessions';
import { getSettings } from '@/db/repositories/settings';
import { formatDuration, formatLoad, formatLongDate, formatMetres, formatNumber, formatSpeedKmh, formatSprintTime, formatTimeRange, workoutTitle } from '@/domain/format';
import { activeMs } from '@/domain/gps';
import { parseLocalDate } from '@/domain/schedule';
import { splitUnit, volumeOf } from '@/domain/progress';
import { lapRows, sprintSummary } from '@/domain/sprint';
import { walkMetric, walkSnapshot } from '@/domain/walkStats';
import { useDb, useLoader } from '@/hooks/data';
import { canLoadMapTiles } from '@/services/network';
import { isOnPhone, photoUri } from '@/services/photos';
import { layoutSize, saveViewToGallery, shareViewAsImage, SQUARE_PX, STICKER_PX, STORY_PX } from '@/services/shareImage';
import { colors, radius, spacing } from '@/theme';

const LOOKS: { value: StoryStyle; label: string }[] = [
  { value: 'mapa', label: 'Mapa' },
  { value: 'foto', label: 'Foto' },
  { value: 'oscuro', label: 'Oscuro' },
  { value: 'transparente', label: 'Sin fondo' },
];
const FORMATS: { value: StoryFormat; label: string }[] = [
  { value: 'story', label: 'Historia · 9:16' },
  { value: 'square', label: 'Cuadrado · 1:1' },
];
const TITLE_MAX = 40;
const THUMB = 56;
/** Height the preview leaves to the rest of the screen (header, controls and bottom bar). */
const CONTROLS_HEIGHT = 390;
/** What the format and photo rows add to it, with the gap above each one. */
const FORMAT_ROW = 72;
const PHOTO_ROW = THUMB + 24;

/** "3 × 12 · 35 kg" when every set had the same reps, "12, 11, 10 · 35 kg" when not. */
function exerciseDetail(reps: number[], load: string): string {
  const same = reps.every((r) => r === reps[0]);
  return `${same ? `${reps.length} × ${reps[0]}` : reps.join(', ')} · ${load}`;
}

/** Image of a walk or a workout to share (Instagram story size), with an editable title. */
export default function ShareScreen() {
  const { tipo, id } = useLocalSearchParams<{ tipo: string; id: string }>();
  const sessionId = Number(id);
  const isWalk = tipo === 'cardio';
  const db = useDb();
  const card = useRef<ComponentRef<typeof View>>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [title, setTitle] = useState<string | null>(null);
  // null until chosen: with photos the image starts with one of them.
  const [look, setLook] = useState<StoryStyle | null>(null);
  const [format, setFormat] = useState<StoryFormat>('story');
  const [photoId, setPhotoId] = useState<number | null>(null);
  // What is drawn and ready to capture: the map's tiles or the photo have loaded for this key.
  const [ready, setReady] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // null while checking; without internet the map look cannot be drawn.
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isWalk) return;
    let alive = true;
    canLoadMapTiles().then((ok) => {
      if (alive) setOnline(ok);
    });
    return () => {
      alive = false;
    };
  }, [isWalk]);

  const { data } = useLoader(async (db) => {
    const photos = (await listPhotos(db, { kind: isWalk ? 'cardio' : 'workout', id: sessionId })).filter(isOnPhone);
    if (isWalk) {
      const session = await getCardioSession(db, sessionId);
      if (!session) return null;
      const subtitle = `${formatLongDate(parseLocalDate(session.date))} · ${formatTimeRange(session.startedAt, session.finishedAt ?? session.startedAt)}`;
      if (session.tracking === 'sprint') {
        // Like a workout: the figures, then a row per sprint.
        const rows = lapRows(session.laps);
        const summary = sprintSummary(rows);
        const fig = (label: string, text: string): StoryFigure => ({ label, ...splitUnit(text) });
        return {
          kind: 'sprint' as const,
          photos,
          defaultTitle: session.name,
          title: session.title ?? '',
          subtitle,
          figures:
            summary.topSpeedMs !== null
              ? [
                  { label: 'Sprints', value: String(summary.count) },
                  fig('Vel. máx.', formatSpeedKmh(summary.topSpeedMs)),
                  ...(summary.totalDistanceM !== null ? [fig('Metros', formatMetres(summary.totalDistanceM))] : []),
                ]
              : [
                  { label: 'Sprints', value: String(summary.count) },
                  ...(summary.bestTimeMs !== null ? [fig('Mejor', formatSprintTime(summary.bestTimeMs))] : []),
                  { label: 'Duración', value: formatDuration(activeMs(session, session.finishedAt ?? session.startedAt)) },
                ],
          exercises: rows.map(
            (r): StoryExercise => ({
              name: `Sprint ${r.number}`,
              detail:
                r.quality === 'none' || r.quality === null
                  ? formatSprintTime(r.timeMs)
                  : `${formatSprintTime(r.timeMs)} · ${sprintMetres(r)} · ${sprintSpeed(r)}`,
            }),
          ),
        };
      }
      const walk = walkSnapshot(session, null, 0);
      const unit = (await getSettings(db)).distanceUnit;
      const climb = walk.numbers.climbM ?? 0;
      return {
        kind: 'walk' as const,
        photos,
        defaultTitle: session.name,
        title: session.title ?? '',
        subtitle,
        segments: walk.segments,
        figures: (['distance', 'time', 'avgPace', climb > 20 ? 'climb' : 'avgSpeed'] as const).map(
          (m): StoryFigure => walkMetric(m, walk.numbers, unit),
        ),
      };
    }
    const session = await getSession(db, sessionId);
    if (!session) return null;
    const sets = (await listSets(db, sessionId)).filter((s) => !s.isWarmup);
    const slots: Slot[] = [];
    for (const slotId of [...new Set(sets.map((s) => s.slotId))]) {
      const slot = slotId === null ? null : await getSlot(db, slotId);
      if (slot) slots.push(slot);
    }
    const volume = slots.reduce((sum, slot) => sum + volumeOf(sets.filter((s) => s.slotId === slot.id), slot.exercisePair), 0);
    return {
      kind: 'workout' as const,
      photos,
      defaultTitle: workoutTitle({ ...session, title: null }),
      title: session.title ?? '',
      subtitle: `${formatLongDate(new Date(session.startedAt))}${session.finishedAt ? ` · ${formatTimeRange(session.startedAt, session.finishedAt)}` : ''}`,
      figures: [
        { label: 'Duración', value: session.finishedAt ? formatDuration(session.finishedAt - session.startedAt) : '–' },
        { label: 'Series', value: String(sets.length) },
        { label: 'Volumen', value: formatNumber(volume, 0), unit: 'kg' },
      ] as StoryFigure[],
      exercises: slots.map((slot): StoryExercise => {
        const own = sets.filter((s) => s.slotId === slot.id);
        return {
          name: slot.exerciseName,
          detail: exerciseDetail(
            own.map((s) => s.reps),
            formatLoad(own[0]?.weightKg ?? null, isBodyweight(slot), slot.exercisePair),
          ),
        };
      }),
    };
  });

  if (data === undefined) return <Loading />;
  if (data === null) {
    return <EmptyState icon="image-off-outline" title="No se encontró esta sesión" text="Puede que se borrara." />;
  }

  const typed = title ?? data.title;
  const shownTitle = typed.trim() || data.defaultTitle;
  const hasMap = data.kind === 'walk' && data.segments.length > 0;
  const hasPhotos = data.photos.length > 0;
  const wanted: StoryStyle = look ?? (hasPhotos ? 'foto' : hasMap ? 'mapa' : 'oscuro');
  const shownLook: StoryStyle =
    (wanted === 'mapa' && (!hasMap || online === false)) || (wanted === 'foto' && !hasPhotos) ? 'oscuro' : wanted;
  const sticker = shownLook === 'transparente';
  const photo: Photo | undefined = data.photos.find((p) => p.id === photoId) ?? data.photos[0];
  const choosingPhoto = shownLook === 'foto' && data.photos.length > 1;
  const px = sticker ? STICKER_PX : format === 'square' ? SQUARE_PX : STORY_PX;
  const size = layoutSize(px);
  // The preview takes the free height between the controls and the bottom bar.
  const free = screenH - CONTROLS_HEIGHT - (sticker ? 0 : FORMAT_ROW) - (choosingPhoto ? PHOTO_ROW : 0);
  const scale = Math.min((screenW - 2 * spacing.lg) / size.width, free / size.height);
  const looks = LOOKS.filter((l) => (l.value === 'mapa' ? hasMap : l.value === 'foto' ? hasPhotos : true)).map((l) =>
    l.value === 'mapa' ? { ...l, disabled: online === false } : l,
  );
  // A new look, format or photo draws again: capturing waits until its tiles or photo have loaded.
  const drawKey = `${shownLook}:${format}:${shownLook === 'foto' ? photo?.id : ''}`;
  const waiting = (shownLook === 'mapa' || shownLook === 'foto') && ready !== drawKey;
  const markReady = () => setReady(drawKey);
  const storyPhoto = shownLook === 'foto' && photo ? { uri: photoUri(photo.file) } : null;
  const fileName = `entreno-${tipo}-${sessionId}`;

  const run = async (action: 'save' | 'share') => {
    setBusy(true);
    try {
      if (typed.trim() !== data.title) {
        if (data.kind === 'workout') await setSessionTitle(db, sessionId, typed);
        else await setCardioTitle(db, sessionId, typed);
      }
      if (action === 'share') {
        await shareViewAsImage(card, fileName, px);
      } else if ((await saveViewToGallery(card, fileName, px)) === 'saved') {
        showSnackbar('Imagen guardada en la galería');
      } else {
        showSnackbar('Sin permiso para guardar', { label: 'Ajustes', onPress: () => Linking.openSettings() });
      }
    } catch (e) {
      console.warn('Could not create the image', e);
      showSnackbar('No se pudo crear la imagen', { label: 'Reintentar', onPress: () => run(action) });
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <BottomBar>
      <Button
        size="lg"
        kind="secondary"
        icon="download-outline"
        title="Guardar"
        onPress={() => run('save')}
        disabled={busy || waiting}
        style={{ flex: 1 }}
      />
      <Button size="lg" icon="share-variant" title="Compartir" onPress={() => run('share')} disabled={busy || waiting} style={{ flex: 1 }} />
    </BottomBar>
  );

  const preview = { width: size.width * scale, height: size.height * scale };
  return (
    <Screen footer={footer}>
      <TextField
        label="Título"
        value={typed}
        onChangeText={setTitle}
        placeholder={data.defaultTitle}
        maxLength={TITLE_MAX}
      />
      <View style={{ gap: spacing.xs }}>
        <Segmented options={looks} value={shownLook} onChange={setLook} />
        {hasMap && online === false ? <AppText variant="caption">Sin conexión: el estilo Mapa necesita internet</AppText> : null}
      </View>
      {sticker ? null : <Segmented options={FORMATS} value={format} onChange={setFormat} />}
      {choosingPhoto ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {data.photos.map((p, i) => {
            const on = p.id === photo?.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => setPhotoId(p.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Foto ${i + 1} de ${data.photos.length}`}
                style={[styles.thumb, on && styles.thumbOn]}>
                <Image source={{ uri: photoUri(p.file) }} style={styles.thumbImage} resizeMode="cover" resizeMethod="resize" />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <View style={[styles.preview, preview]}>
          {sticker ? <Checkerboard {...preview} /> : null}
          <View style={{ width: size.width, height: size.height, transform: [{ scale }], transformOrigin: 'top left' }}>
            {data.kind === 'walk' ? (
              <WalkStory
                key={drawKey}
                ref={card}
                width={size.width}
                look={shownLook}
                format={format}
                title={shownTitle}
                subtitle={data.subtitle}
                segments={data.segments}
                figures={data.figures}
                photo={storyPhoto}
                onMapReady={markReady}
                onPhotoReady={markReady}
              />
            ) : (
              <WorkoutStory
                key={drawKey}
                ref={card}
                width={size.width}
                look={shownLook}
                format={format}
                title={shownTitle}
                subtitle={data.subtitle}
                figures={data.figures}
                exercises={data.exercises}
                photo={storyPhoto}
                onPhotoReady={markReady}
              />
            )}
          </View>
          {busy || waiting ? (
            <View style={styles.preparing}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="caption" style={{ color: colors.text }}>
                {busy ? 'Preparando la imagen…' : shownLook === 'foto' ? 'Cargando la foto…' : 'Cargando el mapa…'}
              </AppText>
            </View>
          ) : null}
        </View>
        {sticker ? (
          <AppText variant="caption" style={{ textAlign: 'center' }}>
            Para ponerla encima de una foto, añádela como pegatina desde la galería
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

/** Shows what is see-through in the sticker preview. */
function Checkerboard({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="check" width={16} height={16} patternUnits="userSpaceOnUse">
          <Rect x={0} y={0} width={16} height={16} fill={colors.cardAlt} />
          <Rect x={0} y={0} width={8} height={8} fill={colors.card} />
          <Rect x={8} y={8} width={8} height={8} fill={colors.card} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#check)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: colors.primary },
  thumbImage: { width: '100%', height: '100%' },
  preview: { alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg },
  preparing: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.overlay,
  },
});
