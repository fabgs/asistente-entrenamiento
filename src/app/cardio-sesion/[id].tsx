import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { showActions, showDialog, showPrompt, showSnackbar } from '@/components/Dialog';
import { MetricBoard } from '@/components/MetricBoard';
import { askPhotoSource, PhotoSection } from '@/components/Photos';
import { RouteMap } from '@/components/RouteMap';
import { FollowRouteSheet, openRoute, RouteFollowPill, WalkRouteBlock } from '@/components/Routes';
import { SprintDetails } from '@/components/Sprint';
import { askFinishSprints, SprintLive } from '@/components/SprintLive';
import { TrackChart } from '@/components/TrackChart';
import {
  AppText,
  BottomBar,
  Button,
  Card,
  EditableTitle,
  EmptyState,
  FloatingButton,
  HeaderActions,
  Icon,
  IconButton,
  ListGroup,
  Loading,
  ProgressBar,
  Row,
  Screen,
  Section,
  Segmented,
  Stat,
  StatRow,
  Tag,
  type IconName,
} from '@/components/ui';
import { setCardioTitle, type CardioSession } from '@/db/repositories/cardioSessions';
import { markHintSeen, type Hint } from '@/db/repositories/hints';
import type { Photo, PhotoOwner } from '@/db/repositories/photos';
import {
  linkWalk,
  routeList,
  saveWalkAsRoute,
  setRouteDeclined,
  unlinkWalk,
  type RouteListItem,
  type SavedRoute,
  type WalkRoute,
} from '@/db/repositories/routes';
import { walkRecordText } from '@/db/repositories/records';
import { updateSettings, type LivePanel, type Settings } from '@/db/repositories/settings';
import {
  describePlan,
  expandPlan,
  INTENSITY_LABEL,
  PLAN_KIND_LABEL,
  phaseAt,
  planSeconds,
  type Intensity,
  type Phase,
} from '@/domain/cardioPlan';
import { formatClock, formatCountdown, formatLongDate, formatMetres, formatNumber, formatTimeRange, NBSP } from '@/domain/format';
import { activeMs, decodeRoute, kmSplits, MAX_ACCURACY_M, positionAtDistance, type LatLon, type Split, type TrackPoint } from '@/domain/gps';
import { photoPlace, placeFromFix, walkTrackOf } from '@/domain/photos';
import type { FollowState } from '@/domain/routeFollow';
import { defaultRouteName, recentFirst } from '@/domain/routes';
import { localDateString, parseLocalDate } from '@/domain/schedule';
import type { TrackMetric } from '@/domain/trackChart';
import { sprintGps } from '@/domain/sprint';
import { walkSnapshot, type WalkMetric, type WalkSnapshot } from '@/domain/walkStats';
import { useDb, useNow } from '@/hooks/data';
import { useCardioSession, useFollowedRoute, type SprintLive as SprintLiveData } from '@/hooks/walk';
import { maybeAutoBackup } from '@/services/backup';
import {
  discardCardio,
  ensureCardioRunning,
  finishCardio,
  followRoute,
  GPS_ERROR_MESSAGE,
  pauseCardio,
  resumeCardio,
  setRouteAlert,
} from '@/services/cardioSession';
import { shareWalkGpx } from '@/services/gpx';
import { pickPhotos, takePhoto, type AddPhotosResult } from '@/services/photos';
import { colors, radius, spacing } from '@/theme';

const KEEP_AWAKE_TAG = 'cardio';
/** A fix older than this means the GPS has lost the signal. */
const STALE_FIX_MS = 20_000;
/** Better than this the GPS pill is green. */
const GOOD_ACCURACY_M = 10;
/** Below this the live panel is too short: the screen scrolls instead (big system font). */
const MIN_PANEL = 180;

const INTENSITY_COLOR: Record<Intensity, string> = {
  low: colors.intensityLow,
  medium: colors.intensityMedium,
  high: colors.intensityHigh,
};

/** What the walk screens remember (settings and one-time hints). */
interface WalkPrefs {
  settings: Settings;
  metricHint: boolean;
  chartHint: boolean;
  onHero: (metric: WalkMetric) => void;
  onToggleUnit: () => void;
  onChartMetric: (metric: TrackMetric) => void;
  onChartHintSeen: () => void;
  onLivePanel: (panel: LivePanel) => void;
}

export default function CardioSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = Number(id);
  const db = useDb();
  const { data, reload } = useCardioSession(sessionId);
  const [justFinished, setJustFinished] = useState(false);
  // «Seguir una ruta…» from the menu of a walk being recorded.
  const [followSheet, setFollowSheet] = useState<RouteListItem[] | null>(null);
  // Discarding leaves once the live screen has let go of the back button.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    if (router.canGoBack()) router.back();
    else router.dismissTo('/');
  }, [leaving]);

  const session = data?.session;
  const inProgress = session?.status === 'in_progress';

  // Once per visit: if the app was killed or the phone restarted, recording starts again.
  const checked = useRef(false);
  useEffect(() => {
    if (!session || checked.current) return;
    checked.current = true;
    ensureCardioRunning(db, session).catch((e) => console.warn('Could not resume cardio', e));
  }, [db, session]);

  const keepAwake = inProgress && (session?.tracking === 'timer' || session?.tracking === 'sprint') && !!data?.settings.keepAwake;
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [keepAwake]);

  if (data === undefined) return <Loading />;
  if (data === null || !session) {
    return <EmptyState icon="map-marker-off-outline" title="No se encontró esta sesión" text="Puede que se borrara." />;
  }

  const { settings, hints } = data;
  const isWalk = session.tracking === 'gps';
  const isSprint = session.tracking === 'sprint';
  const seen = async (hint: Hint) => {
    if (!hints.has(hint)) await markHintSeen(db, hint);
  };
  const saveAndReload = async (patch: Partial<Settings>) => {
    await updateSettings(db, patch);
    reload();
  };
  const prefs: WalkPrefs = {
    settings,
    metricHint: !hints.has('walk-metric'),
    // Never two hints at once: the chart's waits until the figures' is gone.
    chartHint: hints.has('walk-metric') && !hints.has('walk-chart'),
    onHero: async (metric) => {
      await seen('walk-metric');
      saveAndReload({ cardioHero: metric });
    },
    onToggleUnit: () => saveAndReload({ distanceUnit: settings.distanceUnit === 'km' ? 'm' : 'km' }),
    onChartMetric: (metric) => saveAndReload({ cardioChart: metric }),
    onChartHintSeen: async () => {
      await seen('walk-chart');
      reload();
    },
    onLivePanel: (panel) => saveAndReload({ cardioLivePanel: panel }),
  };

  const finish = async (at?: number) => {
    await finishCardio(db, session, at);
    setJustFinished(true);
    await reload();
    // The best time of its route or the longest walk: said once, as it is saved (1.4.10).
    if (isWalk) {
      const record = await walkRecordText(db, session.id).catch(() => null);
      if (record) showSnackbar(record);
    }
    maybeAutoBackup(db);
  };

  const confirmFinish = () =>
    showDialog('¿Terminar y guardar?', undefined, [
      { text: 'Guardar', onPress: () => finish() },
      { text: isWalk ? 'Seguir caminando' : 'Seguir', style: 'cancel' },
    ]);

  const what = isWalk ? 'caminata' : isSprint ? 'sprints' : 'sesión';
  const these = isWalk ? 'la caminata' : isSprint ? 'los sprints' : 'la sesión';
  const discard = () =>
    showDialog(
      inProgress ? `¿Descartar ${these}?` : `¿Borrar ${these}?`,
      inProgress
        ? isWalk
          ? 'Se pierde la ruta grabada hasta ahora.'
          : isSprint
            ? 'No se guardan en el historial.'
            : 'No se guarda en el historial.'
        : isSprint
          ? 'Desaparecen del historial y no se puede deshacer.'
          : 'Desaparece del historial y no se puede deshacer.',
      [
        {
          text: inProgress ? 'Descartar' : 'Borrar',
          style: 'destructive',
          onPress: async () => {
            await discardCardio(db, session);
            setLeaving(true);
          },
        },
        { text: 'Cancelar', style: 'cancel' },
      ],
    );
  // A finished walk with a line can be saved as a route, or taken out of the one it is linked to.
  const routeLink = data.route?.kind === 'linked' ? data.route : null;
  const canSaveRoute = isWalk && !inProgress && !routeLink && decodeRoute(session.route).flat().length >= 2;
  const saveRoute = async () => {
    const name = await showPrompt('Guardar como ruta', {
      value: defaultRouteName(session.title, session.distanceM ?? 0),
      placeholder: 'Nombre de la ruta',
      maxLength: 40,
      confirm: 'Guardar',
    });
    if (name === null) return;
    const { routeId, count } = await saveWalkAsRoute(db, session.id, name.trim() || defaultRouteName(session.title, session.distanceM ?? 0));
    reload();
    showSnackbar(count > 1 ? `Ruta guardada · la has hecho ${count} veces` : 'Ruta guardada', { label: 'Ver', onPress: () => openRoute(routeId) });
  };
  const leaveRoute = async (link: Extract<WalkRoute, { kind: 'linked' }>) => {
    const was = await unlinkWalk(db, session.id);
    reload();
    showSnackbar(`Quitada de «${link.name}»`, {
      label: 'Deshacer',
      onPress: async () => {
        if (was) await linkWalk(db, session.id, was.routeId, was.relation);
        reload();
      },
    });
  };
  // Following a route while walking (1.4.9).
  const followed = data.followed;
  const openFollowSheet = async () => setFollowSheet(recentFirst(await routeList(db)));
  const stopFollowing = async (route: SavedRoute) => {
    const state = session.followState;
    await followRoute(db, session, null);
    reload();
    showSnackbar(`Ya no sigues «${route.name}»`, {
      label: 'Deshacer',
      onPress: async () => {
        await followRoute(db, session, route.id, state);
        reload();
      },
    });
  };
  const switchAlert = async (on: boolean) => {
    await setRouteAlert(db, on, session);
    reload();
  };
  const followItems =
    isWalk && inProgress
      ? followed
        ? [
            { text: 'Dejar de seguir la ruta', icon: 'map-marker-remove-outline' as const, onPress: () => stopFollowing(followed) },
            settings.routeAlert
              ? {
                  text: 'No avisar si me salgo',
                  icon: 'bell-off-outline' as const,
                  onPress: () => switchAlert(false).then(() => showSnackbar('Aviso desactivado')),
                }
              : {
                  text: 'Avisar si me salgo',
                  icon: 'bell-ring-outline' as const,
                  onPress: () => switchAlert(true).then(() => showSnackbar('Aviso activado')),
                },
          ]
        : data.routes > 0
          ? [{ text: 'Seguir una ruta…', icon: 'map-marker-path' as const, onPress: openFollowSheet }]
          : []
      : [];
  const canExport = isWalk && !inProgress && decodeRoute(session.route).flat().length >= 2;
  const exportGpx = () =>
    shareWalkGpx(session).catch((e) => {
      console.warn('Could not export the GPX', e);
      showSnackbar('No se pudo exportar el GPX');
    });
  const menu = () => {
    const at = Date.now();
    // «Terminar ahora» once there is something to keep: a sprint done or one running.
    const somethingToKeep = isSprint && inProgress && session.laps.some((l) => l.stopAt !== null || l.startAt <= at);
    showActions([
      ...(somethingToKeep
        ? [{ text: 'Terminar ahora', icon: 'flag-checkered' as const, onPress: () => askFinishSprints(session, at, () => finish()) }]
        : []),
      ...followItems,
      ...(canSaveRoute ? [{ text: 'Guardar como ruta', icon: 'map-marker-path' as const, onPress: saveRoute }] : []),
      ...(routeLink ? [{ text: 'Quitar de la ruta', icon: 'link-variant-off' as const, onPress: () => leaveRoute(routeLink) }] : []),
      ...(canExport ? [{ text: 'Exportar GPX', icon: 'file-export-outline' as const, onPress: exportGpx }] : []),
      { text: inProgress ? `Descartar ${what}` : `Borrar ${what}`, icon: 'trash-can-outline', destructive: true, onPress: discard },
    ]);
  };
  const answerRoute = {
    yes: async () => {
      if (data.route?.kind !== 'question') return;
      await linkWalk(db, session.id, data.route.routeId, data.route.relation);
      reload();
    },
    no: async () => {
      if (data.route?.kind !== 'question') return;
      const { name } = data.route;
      await setRouteDeclined(db, session.id, true);
      reload();
      showSnackbar(`No se enlaza a «${name}»`, {
        label: 'Deshacer',
        onPress: async () => {
          await setRouteDeclined(db, session.id, false);
          reload();
        },
      });
    },
  };
  const share = () => router.push({ pathname: '/compartir/[tipo]/[id]', params: { tipo: 'cardio', id: String(session.id) } });

  const owner: PhotoOwner = { kind: 'cardio', id: session.id };
  const afterPhotos = (result: AddPhotosResult, text?: string) => {
    if (result === 'denied') {
      showSnackbar('Sin permiso para usar la cámara', { label: 'Ajustes', onPress: () => Linking.openSettings() });
    } else if (result !== 'canceled' && text) {
      showSnackbar(text);
    }
    reload();
  };
  const failedPhoto = (e: unknown) => {
    console.warn('Could not add the photo', e);
    showSnackbar('No se pudo añadir la foto');
  };
  const addPhoto = () =>
    askPhotoSource(
      () => takePhoto(db, owner, null).then((r) => afterPhotos(r), failedPhoto),
      () => {
        // A walk places each photo on its route, from what the photo says (see photoPlace).
        const track = isWalk ? walkTrackOf(session) : null;
        pickPhotos(db, owner, track ? (meta) => photoPlace(track, meta) : undefined).then((r) => afterPhotos(r), failedPhoto);
      },
    );
  // During the walk: the photo goes where the walker is when the camera opens.
  const shoot = () => {
    const place = placeFromFix(data.points?.at(-1) ?? null, Date.now());
    takePhoto(db, owner, place).then((r) => afterPhotos(r, place ? 'Foto añadida en la ruta' : 'Foto añadida, sin sitio en el mapa'), failedPhoto);
  };
  const photoPlaces = placesOf(data.photos);

  const togglePause = async () => {
    if (session.pausedAt === null) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await pauseCardio(db, session);
    } else {
      const result = await resumeCardio(db, session);
      if (result !== 'ok') showDialog('No se puede seguir grabando', GPS_ERROR_MESSAGE[result]);
    }
    reload();
  };

  if (!inProgress) {
    return (
      <>
        <Stack.Screen
          options={{
            // Also clears the GPS pill that was the title while recording.
            title: '',
            headerTitle: '',
            headerRight: () => (
              <HeaderActions>
                {isWalk || isSprint ? <IconButton icon="share-variant" label="Compartir imagen" onPress={share} /> : null}
                <IconButton icon="dots-vertical" label="Más acciones" onPress={menu} />
              </HeaderActions>
            ),
          }}
        />
        <FinishedView
          session={session}
          prefs={prefs}
          photos={data.photos}
          route={
            data.route ? <WalkRouteBlock key={data.route.kind} info={data.route} onYes={answerRoute.yes} onNo={answerRoute.no} /> : null
          }
          onAddPhoto={addPhoto}
          onRename={async () => {
            const title = await showPrompt('Título', {
              value: session.title ?? '',
              placeholder: session.name,
              maxLength: 40,
              confirm: 'Guardar',
            });
            if (title === null) return;
            await setCardioTitle(db, session.id, title);
            reload();
          }}
          footer={
            justFinished ? (
              <BottomBar>
                {isWalk || isSprint ? (
                  <Button size="lg" kind="secondary" icon="share-variant" title="Compartir" onPress={share} style={{ flex: 1 }} />
                ) : null}
                <Button size="lg" icon="check" title="Listo" onPress={() => router.dismissTo('/')} style={{ flex: 1 }} />
              </BottomBar>
            ) : undefined
          }
        />
      </>
    );
  }

  const paused = session.pausedAt !== null;
  const footer = (
    <BottomBar actionKey={paused ? 'paused' : 'running'}>
      {paused ? (
        <>
          <Button size="xl" icon="play" title="Seguir" onPress={togglePause} style={{ flex: 1 }} />
          <Button size="xl" kind="secondary" icon="flag-checkered" title="Terminar" onPress={confirmFinish} style={{ flex: 1 }} />
        </>
      ) : (
        <>
          <Button size="xl" kind="secondary" icon="pause" title="Pausar" onPress={togglePause} style={{ flex: 1 }} />
          <Button size="xl" icon="flag-checkered" title="Terminar" onPress={confirmFinish} style={{ flex: 1 }} />
        </>
      )}
    </BottomBar>
  );
  const headerRight = () => (
    <HeaderActions>
      <IconButton icon="dots-vertical" label="Más acciones" onPress={menu} />
    </HeaderActions>
  );

  if (isSprint && data.sprintLive) {
    const live = data.sprintLive;
    return (
      <>
        <Stack.Screen options={{ title: session.name, headerTitle: () => <SprintGpsPill live={live} />, headerRight }} />
        <SprintLive
          session={session}
          live={live}
          hintSeen={hints.has('sprint-how')}
          leaving={leaving}
          reload={reload}
          onFinish={() => finish()}
        />
      </>
    );
  }

  if (!isWalk) {
    return (
      <>
        <Stack.Screen options={{ title: session.name, headerTitle: session.name, headerRight }} />
        <TimerView session={session} onPlanOver={finish} footer={footer} />
      </>
    );
  }
  const points = data.points ?? [];
  return (
    <>
      <Stack.Screen
        options={{
          title: session.name,
          headerTitle: () => <GpsPill last={points.at(-1)} paused={paused} />,
          headerRight: () => (
            <HeaderActions>
              <IconButton icon="camera-outline" label="Hacer una foto" onPress={shoot} />
              <IconButton icon="dots-vertical" label="Más acciones" onPress={menu} />
            </HeaderActions>
          ),
        }}
      />
      <GpsView
        session={session}
        points={points}
        photos={photoPlaces}
        prefs={prefs}
        footer={footer}
        follow={followed ? { route: followed, state: session.followState } : null}
      />
      <FollowRouteSheet
        visible={followSheet !== null}
        routes={followSheet ?? []}
        today={localDateString(new Date(session.startedAt))}
        alertOn={settings.routeAlert}
        onAlert={switchAlert}
        onPick={async (route) => {
          setFollowSheet(null);
          await followRoute(db, session, route.id);
          reload();
        }}
        onClose={() => setFollowSheet(null)}
      />
    </>
  );
}

/** What the GPS can measure, as the title of the live sprints. */
function SprintGpsPill({ live }: { live: SprintLiveData }) {
  const now = useNow(1000);
  const { state, accuracyM } = sprintGps(live.lastFix, live.gpsOn, now);
  const accuracy = accuracyM === null ? '' : ` ±${accuracyM}${NBSP}m`;
  const shown: { icon?: IconName; color: string; text: string } =
    state === 'off'
      ? { icon: 'map-marker-off', color: colors.muted, text: 'Sin GPS · solo tiempo' }
      : state === 'searching'
        ? { color: colors.muted, text: 'Buscando GPS…' }
        : state === 'unusable'
          ? { icon: 'alert-circle', color: colors.danger, text: `GPS${accuracy} · no mide` }
          : state === 'weak'
            ? { icon: 'alert-circle', color: colors.warning, text: `GPS débil${accuracy}` }
            : { color: colors.primary, text: `GPS${accuracy}` };
  return (
    <View style={styles.pill} accessible accessibilityLabel={shown.text} accessibilityLiveRegion="polite">
      {shown.icon ? (
        <Icon name={shown.icon} size={14} color={shown.color} />
      ) : (
        <View style={[styles.pillDot, { backgroundColor: shown.color }]} />
      )}
      <AppText variant="label" weight="600" style={{ color: colors.text }} numberOfLines={1}>
        {shown.text}
      </AppText>
    </View>
  );
}

/** The state of the GPS, as the title of the live walk. */
function GpsPill({ last, paused }: { last: TrackPoint | undefined; paused: boolean }) {
  const now = useNow(1000);
  const accuracy = Math.round(last?.accuracy ?? 0);
  const state: { icon?: IconName; color: string; text: string } = paused
    ? { icon: 'pause', color: colors.warning, text: 'En pausa' }
    : !last
      ? { color: colors.muted, text: 'Buscando GPS…' }
      : now - last.t > STALE_FIX_MS
        ? { icon: 'alert-circle', color: colors.danger, text: 'Sin señal de GPS' }
        : accuracy > MAX_ACCURACY_M
          ? { icon: 'alert-circle', color: colors.danger, text: `GPS ±${accuracy}${NBSP}m · no suma` }
          : accuracy > GOOD_ACCURACY_M
            ? { icon: 'alert-circle', color: colors.warning, text: `GPS débil ±${accuracy}${NBSP}m` }
            : { color: colors.primary, text: `GPS ±${accuracy}${NBSP}m` };
  return (
    <View style={styles.pill} accessible accessibilityLabel={state.text} accessibilityLiveRegion="polite">
      {state.icon ? (
        <Icon name={state.icon} size={14} color={state.color} />
      ) : (
        <View style={[styles.pillDot, { backgroundColor: state.color }]} />
      )}
      <AppText variant="label" weight="600" style={{ color: colors.text }} numberOfLines={1}>
        {state.text}
      </AppText>
    </View>
  );
}

const LIVE_PANELS: { value: LivePanel; label: string }[] = [
  { value: 'map', label: 'Mapa' },
  { value: 'chart', label: 'Gráfica' },
  { value: 'splits', label: 'Parciales' },
];

function GpsView({
  session,
  points,
  photos,
  prefs,
  footer,
  follow,
}: {
  session: CardioSession;
  points: TrackPoint[];
  photos: LatLon[];
  prefs: WalkPrefs;
  footer: ReactNode;
  /** The route being followed (1.4.9), with the detector's state. */
  follow: { route: SavedRoute; state: FollowState | null } | null;
}) {
  const following = useFollowedRoute(follow);
  const { settings } = prefs;
  const now = useNow(1000);
  const [panel, setPanel] = useState<LivePanel>(settings.cardioLivePanel);
  const [panelHeight, setPanelHeight] = useState(0);
  const [cramped, setCramped] = useState(false);
  const lastFix = points.at(-1)?.t ?? session.startedAt;
  // The route, the chart and the splits change with each read of the points (every 3 s), not with the clock.
  const track = useMemo(() => walkSnapshot(session, points, lastFix), [session, points, lastFix]);
  const splits = useMemo(() => kmSplits(track.samples), [track.samples]);
  const paused = session.pausedAt !== null;
  const numbers = {
    ...track.numbers,
    activeMs: activeMs(session, now),
    currentSpeedMs: now - lastFix > STALE_FIX_MS ? undefined : track.numbers.currentSpeedMs,
  };

  // A buzz at every km, only with the screen in front of the user.
  const km = Math.floor(track.numbers.distanceM / 1000);
  const lastKm = useRef(km);
  useEffect(() => {
    if (km > lastKm.current && AppState.currentState === 'active') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    lastKm.current = km;
  }, [km]);

  const content = (
    <>
      <MetricBoard
        mode="live"
        paused={paused}
        hint={prefs.metricHint}
        hero={settings.cardioHero}
        numbers={numbers}
        unit={settings.distanceUnit}
        onHero={prefs.onHero}
        onToggleUnit={prefs.onToggleUnit}
        below={following && follow ? <RouteFollowPill view={following.view} name={follow.route.name} paused={paused} /> : undefined}
      />
      <Segmented
        options={LIVE_PANELS}
        value={panel}
        onChange={(p) => {
          setPanel(p);
          prefs.onLivePanel(p);
        }}
      />
      <View
        style={cramped ? { height: 260 } : styles.panel}
        onLayout={(e) => {
          const height = e.nativeEvent.layout.height;
          if (!cramped && height < MIN_PANEL) setCramped(true);
          setPanelHeight(height);
        }}>
        {panelHeight === 0 ? null : panel === 'map' ? (
          <RouteMap
            segments={track.segments}
            height={panelHeight}
            photos={photos}
            guide={following?.ahead}
            guideEnds={following?.ends}
            fit={follow?.route.segments}
            onPress={() => openMap(session.id)}
            corner={<FloatingButton icon="arrow-expand" label="Ampliar el mapa" onPress={() => openMap(session.id)} />}
          />
        ) : panel === 'chart' ? (
          <Card flush style={styles.livePanelCard}>
            <TrackChart
              live
              fill
              samples={track.samples}
              average={numbers}
              unit={settings.distanceUnit}
              metric={settings.cardioChart}
              onMetric={prefs.onChartMetric}
            />
          </Card>
        ) : (
          <LiveSplits splits={splits} />
        )}
      </View>
    </>
  );
  return (
    <Screen tight scroll={cramped} footer={footer}>
      {content}
    </Screen>
  );
}

const placesOf = (photos: Photo[]): LatLon[] => photos.flatMap((p) => (p.place ? [p.place] : []));

const openMap = (sessionId: number, mode?: '3d') =>
  router.push({ pathname: '/ruta/[id]', params: { id: String(sessionId), ...(mode ? { modo: mode } : {}) } });

/** The km being walked, filling up, and the km already closed, the last one first. */
function LiveSplits({ splits }: { splits: Split[] }) {
  const last = splits.at(-1);
  const current = last && last.distanceM < 1000 ? last : null;
  const closed = current ? splits.slice(0, -1) : splits;
  if (splits.length === 0) {
    return (
      <View style={styles.centered}>
        <AppText variant="caption">Aquí verás el tiempo de cada km</AppText>
      </View>
    );
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.md }}>
      {current ? (
        <Card>
          <Row between>
            <AppText variant="heading">Km {splits.length}</AppText>
            <Tag label="En curso" tone="info" />
          </Row>
          <ProgressBar progress={current.distanceM / 1000} color={colors.accent} height={6} />
          <AppText variant="bodySm" tabular>
            {formatMetres(current.distanceM)} · {formatClock(current.seconds * 1000)}
          </AppText>
        </Card>
      ) : null}
      {closed.length > 0 ? <SplitsTable splits={closed} reverse /> : null}
    </ScrollView>
  );
}

/** Map, chart and splits of a finished walk; the chart's cursor is marked on the map. */
function WalkDetails({
  sessionId,
  walk,
  prefs,
  photos,
  children,
}: {
  sessionId: number;
  walk: WalkSnapshot;
  prefs: WalkPrefs;
  photos: LatLon[];
  /** Between the map and chart and the splits: the photos. */
  children?: ReactNode;
}) {
  const [cursorD, setCursorD] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ min: number; max: number; key: number } | undefined>();
  const splits = kmSplits(walk.samples);

  return (
    <>
      <View style={{ gap: spacing.md }}>
        {walk.segments.length > 0 ? (
          <RouteMap
            segments={walk.segments}
            height={240}
            photos={photos}
            cursor={cursorD === null ? null : positionAtDistance(walk.segments, cursorD)}
            onPress={() => openMap(sessionId)}
            corner={
              <>
                <FloatingButton text="3D" label="Ver la ruta en 3D" onPress={() => openMap(sessionId, '3d')} />
                <FloatingButton icon="arrow-expand" label="Ampliar el mapa" onPress={() => openMap(sessionId)} />
              </>
            }
          />
        ) : null}
        {walk.samples.length > 2 ? (
          <Card flush style={styles.chartCard}>
            <TrackChart
              samples={walk.samples}
              average={walk.numbers}
              unit={prefs.settings.distanceUnit}
              metric={prefs.settings.cardioChart}
              onMetric={prefs.onChartMetric}
              hint={prefs.chartHint}
              onHintSeen={prefs.onChartHintSeen}
              focus={focus}
              onCursor={(p) => setCursorD(p?.d ?? null)}
            />
          </Card>
        ) : (
          <AppText variant="caption">Recorrido demasiado corto para gráficas y parciales.</AppText>
        )}
      </View>
      {children}
      {splits.length > 0 ? (
        <Section label="Parciales">
          <SplitsTable
            splits={splits}
            onPick={(i) => {
              const from = i * 1000;
              setFocus({ min: from, max: from + splits[i].distanceM, key: Date.now() });
              setCursorD(from);
            }}
          />
        </Section>
      ) : null}
    </>
  );
}

const paceOf = (s: Split) => s.seconds / (s.distanceM / 1000);
/** Differences smaller than this are not worth showing. */
const SPLIT_DIFF_S = 5;

/**
 * Time of each km against the average: «−0:19» (faster) or «+0:26» (slower). The last stretch, if
 * short, has no difference: it is not reliable. `reverse` lists the last km first.
 */
function SplitsTable({ splits, reverse = false, onPick }: { splits: Split[]; reverse?: boolean; onPick?: (index: number) => void }) {
  const full = splits.filter((s) => s.distanceM === 1000);
  const average = splits.reduce((sum, s) => sum + s.seconds, 0) / (splits.reduce((sum, s) => sum + s.distanceM, 0) / 1000);
  const fastest = full.length > 1 ? Math.min(...full.map(paceOf)) : null;
  const rows = splits.map((s, i) => ({ s, i }));
  if (reverse) rows.reverse();

  return (
    <ListGroup>
      <View style={styles.splitHead}>
        <AppText variant="label" style={styles.splitKm}>
          Km
        </AppText>
        <AppText variant="label" style={styles.splitPace}>
          Ritmo /km
        </AppText>
        <AppText variant="label" style={styles.splitDiff}>
          Dif.
        </AppText>
      </View>
      {rows.map(({ s, i }) => {
        const pace = paceOf(s);
        const partial = s.distanceM < 1000;
        const diff = Math.round(pace - average);
        const ink = partial ? colors.muted : colors.text;
        return (
          <Pressable
            key={i}
            disabled={!onPick}
            onPress={() => onPick?.(i)}
            android_ripple={onPick ? { color: colors.pressed } : undefined}
            style={styles.splitRow}
            accessibilityRole={onPick ? 'button' : undefined}
            accessibilityHint={onPick ? 'Amplía la gráfica a este km' : undefined}>
            <AppText variant="bodySm" weight="600" tabular style={[styles.splitKm, { color: ink }]}>
              {partial ? formatNumber(s.distanceM / 1000, 2) : i + 1}
            </AppText>
            <AppText variant="rowValue" tabular style={[styles.splitPace, { color: ink }]}>
              {formatClock(pace * 1000)}
            </AppText>
            <View style={[styles.splitDiff, styles.diffCell]}>
              {!partial && Math.abs(diff) >= SPLIT_DIFF_S ? (
                <>
                  {diff < 0 ? <Icon name="arrow-up" size={12} color={colors.primary} /> : null}
                  <AppText variant="secondary" weight="500" tabular style={{ color: diff < 0 ? colors.text : colors.muted }}>
                    {diff < 0 ? '−' : '+'}
                    {formatClock(Math.abs(diff) * 1000)}
                  </AppText>
                </>
              ) : null}
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              {fastest !== null && !partial && pace === fastest ? <Tag label="Más rápido" tone="success" /> : null}
            </View>
          </Pressable>
        );
      })}
    </ListGroup>
  );
}

function TimerView({
  session,
  onPlanOver,
  footer,
}: {
  session: CardioSession;
  onPlanOver: (at: number) => void;
  footer: ReactNode;
}) {
  const now = useNow(250);
  const plan = session.plan!;
  const phases = expandPlan(plan);
  const total = planSeconds(plan);
  const elapsedMs = activeMs(session, now);
  const position = phaseAt(phases, elapsedMs / 1000);
  const over = position === null;

  const reported = useRef(false);
  useEffect(() => {
    if (!over || reported.current) return;
    reported.current = true;
    // Ends when the plan did, even if the screen was opened much later. The short wait lets the
    // final alarm ring before finishing cancels what is left of the timer.
    const end = now - elapsedMs + total * 1000;
    setTimeout(() => onPlanOver(end), 3000);
  }, [over, now, elapsedMs, total, onPlanOver]);

  if (!position) return <Loading />;
  const { phase, remainingSec, index } = position;
  const next = phases[index + 1];

  return (
    <Screen footer={footer}>
      <View style={styles.phase}>
        <Row style={{ justifyContent: 'center' }}>
          <Tag label={`${INTENSITY_LABEL[phase.intensity]} · fase ${index + 1} de ${phases.length}`} />
          {session.pausedAt !== null ? <Tag label="En pausa" tone="warning" icon="pause" /> : null}
        </Row>
        <AppText variant="title" style={{ textAlign: 'center' }}>
          {phase.label}
        </AppText>
        <AppText variant="countdown" tabular style={{ color: INTENSITY_COLOR[phase.intensity] }}>
          {formatCountdown(remainingSec * 1000)}
        </AppText>
      </View>
      <View style={{ gap: spacing.sm }}>
        <PhaseBar phases={phases} elapsedSec={elapsedMs / 1000} total={total} />
        <Row between>
          <AppText variant="secondary" tabular style={{ flex: 1 }}>
            {formatClock(elapsedMs)} de {formatClock(total * 1000)}
          </AppText>
          <AppText variant="secondary">{PLAN_KIND_LABEL[plan.kind]}</AppText>
        </Row>
      </View>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="label">A continuación</AppText>
        <AppText variant="heading">{next ? `${next.label} · ${formatCountdown(next.seconds * 1000)}` : 'Fin'}</AppText>
      </View>
    </Screen>
  );
}

/** All phases as coloured blocks, with the time already done shaded. */
function PhaseBar({ phases, elapsedSec, total }: { phases: Phase[]; elapsedSec: number; total: number }) {
  return (
    <View style={styles.bar}>
      {phases.map((p, i) => (
        <View key={i} style={{ flex: p.seconds, backgroundColor: INTENSITY_COLOR[p.intensity] }} />
      ))}
      <View style={[styles.barDone, { width: `${Math.min(100, (elapsedSec / total) * 100)}%` }]} />
    </View>
  );
}

function FinishedView({
  session,
  prefs,
  photos,
  route,
  onAddPhoto,
  onRename,
  footer,
}: {
  session: CardioSession;
  prefs: WalkPrefs;
  photos: Photo[];
  /** The walk's saved route or the question about one: between its figures and its map. */
  route: ReactNode;
  onAddPhoto: () => void;
  onRename: () => void;
  footer?: ReactNode;
}) {
  const end = session.finishedAt ?? session.startedAt;
  const walk = session.tracking === 'gps' ? walkSnapshot(session, null, 0) : null;
  const { settings } = prefs;
  const photoSection = <PhotoSection photos={photos} onAdd={onAddPhoto} />;

  return (
    <Screen footer={footer}>
      <View style={{ gap: spacing.xs }}>
        <EditableTitle value={session.title ?? session.name} onEdit={onRename} />
        <AppText variant="secondary">
          {formatLongDate(parseLocalDate(session.date))} · {formatTimeRange(session.startedAt, end)}
        </AppText>
      </View>
      {walk ? (
        <>
          <MetricBoard
            mode="finished"
            hero={settings.cardioHero}
            hint={prefs.metricHint}
            numbers={walk.numbers}
            unit={settings.distanceUnit}
            onHero={prefs.onHero}
            onToggleUnit={prefs.onToggleUnit}
          />
          {route}
          <WalkDetails sessionId={session.id} walk={walk} prefs={prefs} photos={placesOf(photos)}>
            {photoSection}
          </WalkDetails>
        </>
      ) : session.tracking === 'sprint' ? (
        <>
          <SprintDetails laps={session.laps} totalMs={activeMs(session, end)} />
          {photoSection}
        </>
      ) : (
        <>
          <StatRow>
            <Stat label="Tiempo" value={formatClock(activeMs(session, end))} big />
            {session.plan ? <Stat label={PLAN_KIND_LABEL[session.plan.kind]} value={describePlan(session.plan)} /> : null}
          </StatRow>
          {photoSection}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.cardAlt,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  panel: { flex: 1, minHeight: MIN_PANEL },
  livePanelCard: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chartCard: { padding: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  splitHead: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: spacing.lg },
  splitRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: spacing.lg },
  splitKm: { width: 40 },
  splitPace: { width: 88 },
  splitDiff: { width: 72 },
  diffCell: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  phase: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  bar: { flexDirection: 'row', height: 14, borderRadius: radius.pill, overflow: 'hidden', gap: 2 },
  barDone: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.overlay },
});
