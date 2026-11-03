import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Linking, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { showSnackbar } from '@/components/Dialog';
import { WalkStory, WorkoutStory, type StoryExercise, type StoryFigure, type StoryStyle } from '@/components/ShareCard';
import { AppText, BottomBar, Button, EmptyState, Loading, Screen, Segmented, TextField } from '@/components/ui';
import { getCardioSession, setCardioTitle } from '@/db/repositories/cardioSessions';
import { getSlot, isBodyweight, type Slot } from '@/db/repositories/routines';
import { getSession, listSets, setSessionTitle } from '@/db/repositories/sessions';
import { getSettings } from '@/db/repositories/settings';
import { formatDuration, formatLoad, formatLongDate, formatNumber, formatTimeRange } from '@/domain/format';
import { parseLocalDate } from '@/domain/schedule';
import { walkMetric, walkSnapshot } from '@/domain/walkStats';
import { useDb, useLoader } from '@/hooks/data';
import { canLoadMapTiles } from '@/services/network';
import { layoutSize, saveViewToGallery, shareViewAsImage, STICKER_PX, STORY_PX } from '@/services/shareImage';
import { colors, radius, spacing } from '@/theme';

const LOOKS: { value: StoryStyle; label: string }[] = [
  { value: 'mapa', label: 'Mapa' },
  { value: 'oscuro', label: 'Oscuro' },
  { value: 'transparente', label: 'Sin fondo' },
];
const TITLE_MAX = 40;

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
  const [look, setLook] = useState<StoryStyle>(isWalk ? 'mapa' : 'oscuro');
  const [mapReady, setMapReady] = useState(false);
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
    if (isWalk) {
      const session = await getCardioSession(db, sessionId);
      if (!session) return null;
      const walk = walkSnapshot(session, null, 0);
      const unit = (await getSettings(db)).distanceUnit;
      const climb = walk.numbers.climbM ?? 0;
      return {
        kind: 'walk' as const,
        defaultTitle: session.name,
        title: session.title ?? '',
        subtitle: `${formatLongDate(parseLocalDate(session.date))} · ${formatTimeRange(session.startedAt, session.finishedAt ?? session.startedAt)}`,
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
    const volume = sets.reduce((sum, s) => sum + (s.weightKg ?? 0) * s.reps, 0);
    return {
      kind: 'workout' as const,
      defaultTitle: session.routineName ?? 'Entreno',
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
            formatLoad(own[0]?.weightKg ?? null, isBodyweight(slot)),
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
  const shownLook: StoryStyle = look === 'mapa' && (!hasMap || online === false) ? 'oscuro' : look;
  const sticker = shownLook === 'transparente';
  const px = sticker ? STICKER_PX : STORY_PX;
  const size = layoutSize(px);
  // The preview takes the free height between the controls and the bottom bar.
  const scale = Math.min((screenW - 2 * spacing.lg) / size.width, (screenH - 390) / size.height);
  const looks = hasMap ? LOOKS.map((l) => (l.value === 'mapa' ? { ...l, disabled: online === false } : l)) : LOOKS.slice(1);
  const waitingForMap = shownLook === 'mapa' && !mapReady;
  const fileName = `entreno-${tipo}-${sessionId}`;

  const run = async (action: 'save' | 'share') => {
    setBusy(true);
    try {
      if (typed.trim() !== data.title) {
        if (data.kind === 'walk') await setCardioTitle(db, sessionId, typed);
        else await setSessionTitle(db, sessionId, typed);
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
        disabled={busy || waitingForMap}
        style={{ flex: 1 }}
      />
      <Button size="lg" icon="share-variant" title="Compartir" onPress={() => run('share')} disabled={busy || waitingForMap} style={{ flex: 1 }} />
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

      <View style={{ gap: spacing.sm }}>
        <View style={[styles.preview, preview]}>
          {sticker ? <Checkerboard {...preview} /> : null}
          <View style={{ width: size.width, height: size.height, transform: [{ scale }], transformOrigin: 'top left' }}>
            {data.kind === 'walk' ? (
              <WalkStory
                ref={card}
                {...size}
                look={shownLook}
                title={shownTitle}
                subtitle={data.subtitle}
                segments={data.segments}
                figures={data.figures}
                onMapReady={() => setMapReady(true)}
              />
            ) : (
              <WorkoutStory
                ref={card}
                {...size}
                look={shownLook}
                title={shownTitle}
                subtitle={data.subtitle}
                figures={data.figures}
                exercises={data.exercises}
              />
            )}
          </View>
          {busy || waitingForMap ? (
            <View style={styles.preparing}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="caption" style={{ color: colors.text }}>
                {busy ? 'Preparando la imagen…' : 'Cargando el mapa…'}
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
  preview: { alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg },
  preparing: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.overlay,
  },
});
