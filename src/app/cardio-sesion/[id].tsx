import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { showDialog } from '@/components/Dialog';
import { LineChart } from '@/components/LineChart';
import { RouteMap } from '@/components/RouteMap';
import { AppText, Button, Card, Icon, Loading, Row, Screen, Stat, StatRow } from '@/components/ui';
import { getCardioSession, listTrackPoints, type CardioSession } from '@/db/repositories/cardioSessions';
import { getSettings } from '@/db/repositories/settings';
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
import {
  formatClock,
  formatCountdown,
  formatLongDate,
  formatMetres,
  formatNumber,
  formatSpeedKmh,
} from '@/domain/format';
import {
  activeMs,
  altitudeProfile,
  decodeRoute,
  elevationChange,
  kmSplits,
  paceMinPerKm,
  speedSeries,
  summarizeTrack,
  type Split,
  type TrackPoint,
  type TrackSample,
} from '@/domain/gps';
import { parseLocalDate } from '@/domain/schedule';
import { useDb, useLoader, useNow } from '@/hooks/data';
import { maybeAutoBackup } from '@/services/backup';
import {
  discardCardio,
  ensureCardioRunning,
  finishCardio,
  GPS_ERROR_MESSAGE,
  pauseCardio,
  resumeCardio,
} from '@/services/cardioSession';
import { colors, radius, spacing } from '@/theme';

const KEEP_AWAKE_TAG = 'cardio';
/** A fix older than this means the GPS has lost the signal. */
const STALE_FIX_MS = 20_000;

const INTENSITY_COLOR: Record<Intensity, string> = {
  low: colors.intensityLow,
  medium: colors.intensityMedium,
  high: colors.intensityHigh,
};

export default function CardioSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = Number(id);
  const db = useDb();
  const { data, reload } = useLoader(async (db) => {
    const session = await getCardioSession(db, sessionId);
    if (!session) return null;
    const live = session.status === 'in_progress' && session.tracking === 'gps';
    return {
      session,
      points: live ? await listTrackPoints(db, sessionId) : [],
      keepAwake: (await getSettings(db)).keepAwake,
    };
  });

  const session = data?.session;
  const inProgress = session?.status === 'in_progress';

  // The background task stores the GPS fixes; the screen just reads them again every few seconds.
  const liveGps = inProgress && session?.tracking === 'gps';
  useEffect(() => {
    if (!liveGps) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [liveGps, reload]);

  // Once per visit: if the app was killed or the phone restarted, recording starts again.
  const checked = useRef(false);
  useEffect(() => {
    if (!session || checked.current) return;
    checked.current = true;
    ensureCardioRunning(db, session).catch((e) => console.warn('Could not resume cardio', e));
  }, [db, session]);

  const keepAwake = inProgress && session?.tracking === 'timer' && !!data?.keepAwake;
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [keepAwake]);

  if (data === undefined) return <Loading />;
  if (data === null || !session) {
    return (
      <Screen>
        <AppText>No se encontró esta sesión de cardio.</AppText>
      </Screen>
    );
  }

  const header = <Stack.Screen options={{ title: session.name }} />;

  const finish = async (at?: number) => {
    await finishCardio(db, session, at);
    await reload();
    maybeAutoBackup(db);
  };

  const confirmFinish = () =>
    showDialog('¿Terminar y guardar?', `«${session.name}» se guarda en el historial y se marca como hecho en Hoy.`, [
      { text: 'Seguir', style: 'cancel' },
      { text: 'Terminar', onPress: () => finish() },
    ]);

  const discard = () =>
    showDialog(
      inProgress ? '¿Descartar esta sesión?' : '¿Borrar esta sesión?',
      session.tracking === 'gps' ? 'Se perderá la ruta grabada.' : 'No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: inProgress ? 'Descartar' : 'Borrar',
          style: 'destructive',
          onPress: async () => {
            await discardCardio(db, session);
            if (router.canGoBack()) router.back();
            else router.replace('/');
          },
        },
      ],
    );

  const togglePause = async () => {
    if (session.pausedAt === null) {
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
        {header}
        <FinishedView session={session} onDelete={discard} />
      </>
    );
  }

  return (
    <>
      {header}
      {session.tracking === 'gps' ? (
        <GpsView session={session} points={data.points} />
      ) : (
        <TimerView session={session} onPlanOver={finish} />
      )}
      <View style={styles.controls}>
        <Button
          big
          kind={session.pausedAt === null ? 'secondary' : 'primary'}
          icon={session.pausedAt === null ? 'pause' : 'play'}
          title={session.pausedAt === null ? 'Pausar' : 'Seguir'}
          onPress={togglePause}
          style={{ flex: 1 }}
        />
        <Button big icon="flag-checkered" title="Terminar" onPress={confirmFinish} style={{ flex: 1 }} />
      </View>
      <View style={styles.discard}>
        <Button kind="ghost" title="Descartar" onPress={discard} />
      </View>
    </>
  );
}

function GpsView({ session, points }: { session: CardioSession; points: TrackPoint[] }) {
  const now = useNow(1000);
  const active = activeMs(session, now);
  const track = summarizeTrack(points, now);
  const average = active > 0 ? track.distanceM / (active / 1000) : 0;
  const last = points.at(-1);
  const paused = session.pausedAt !== null;
  const signal = paused
    ? 'Grabación en pausa'
    : !last
      ? 'Buscando la señal del GPS…'
      : now - last.t > STALE_FIX_MS
        ? 'Sin señal del GPS ahora mismo'
        : `GPS preciso a ±${Math.round(last.accuracy ?? 0)} m`;

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.heroValue}>{formatMetres(track.distanceM)}</Text>
        <AppText variant="muted">{formatClock(active)}</AppText>
      </View>
      <StatRow>
        <Stat label="Velocidad" value={paused ? '—' : formatSpeedKmh(track.currentSpeedMs)} />
        <Stat label="Ritmo" value={paused ? '—' : `${paceMinPerKm(track.currentSpeedMs) ?? '—'} /km`} />
        <Stat label="Media" value={`${paceMinPerKm(average) ?? '—'} /km`} />
      </StatRow>
      <RouteMap segments={track.segments} height={260} />
      <Row>
        <Icon name={paused ? 'pause-circle-outline' : last ? 'crosshairs-gps' : 'crosshairs-question'} size={18} color={colors.muted} />
        <AppText variant="small">{signal}</AppText>
      </Row>
      <AppText variant="small">
        Puedes bloquear el móvil: la ruta se sigue grabando (lo indica la notificación «Grabando la ruta»).
      </AppText>
    </Screen>
  );
}

function TimerView({ session, onPlanOver }: { session: CardioSession; onPlanOver: (at: number) => void }) {
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
  const color = INTENSITY_COLOR[phase.intensity];

  return (
    <Screen>
      <View style={[styles.phaseBox, { borderColor: color }]}>
        <AppText variant="small" style={{ color, fontWeight: '700', letterSpacing: 1 }}>
          {INTENSITY_LABEL[phase.intensity].toUpperCase()} · FASE {index + 1} DE {phases.length}
        </AppText>
        <AppText variant="title" style={{ textAlign: 'center' }}>
          {phase.label}
        </AppText>
        <Text style={[styles.countdown, { color }]}>{formatCountdown(remainingSec * 1000)}</Text>
        {session.pausedAt !== null ? <AppText variant="muted">En pausa</AppText> : null}
      </View>
      <PhaseBar phases={phases} elapsedSec={elapsedMs / 1000} total={total} />
      <Row between>
        <AppText variant="muted" style={{ flex: 1 }}>
          {formatClock(elapsedMs)} de {formatClock(total * 1000)}
        </AppText>
        <AppText variant="muted">{PLAN_KIND_LABEL[plan.kind]}</AppText>
      </Row>
      <Card>
        <AppText variant="small">A continuación</AppText>
        <AppText variant="heading">{next ? `${next.label} · ${formatCountdown(next.seconds * 1000)}` : 'Fin'}</AppText>
      </Card>
      <AppText variant="small">
        Cada cambio de fase suena aunque bloquees el móvil. En la pantalla de bloqueo verás lo que falta.
      </AppText>
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

function FinishedView({ session, onDelete }: { session: CardioSession; onDelete: () => void }) {
  const time = activeMs(session, session.finishedAt ?? session.startedAt);
  const segments = decodeRoute(session.route);
  const average = time > 0 && session.distanceM ? session.distanceM / (time / 1000) : 0;

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">{session.name}</AppText>
        <AppText variant="muted">{formatLongDate(parseLocalDate(session.date))}</AppText>
      </View>
      {session.tracking === 'gps' ? (
        <>
          <StatRow>
            <Stat big label="Distancia" value={formatMetres(session.distanceM ?? 0)} />
            <Stat big label="Tiempo" value={formatClock(time)} />
          </StatRow>
          <StatRow>
            <Stat label="Ritmo medio" value={`${paceMinPerKm(average) ?? '—'} /km`} />
            <Stat label="Velocidad media" value={formatSpeedKmh(average)} />
          </StatRow>
          {segments.length > 0 ? <RouteMap segments={segments} height={300} /> : null}
          {session.samples.length > 2 ? <WalkDetails samples={session.samples} /> : null}
        </>
      ) : (
        <StatRow>
          <Stat big label="Tiempo" value={formatClock(time)} />
          {session.plan ? <Stat label={PLAN_KIND_LABEL[session.plan.kind]} value={describePlan(session.plan)} /> : null}
        </StatRow>
      )}
      <Button big kind="secondary" title="Cerrar" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <Button kind="danger" title="Borrar esta sesión" onPress={onDelete} />
    </Screen>
  );
}

/** Speed and altitude charts and the time of each kilometre. */
function WalkDetails({ samples }: { samples: TrackSample[] }) {
  const speed = speedSeries(samples);
  const profile = altitudeProfile(samples);
  const { gain, loss } = elevationChange(profile);
  const splits = kmSplits(samples);

  return (
    <>
      <Card>
        <LineChart
          title="Velocidad (km/h)"
          points={speed.map((p) => ({ label: formatClock(p.s * 1000), value: p.speed * 3.6 }))}
          format={(v) => `${formatNumber(v, 1)} km/h`}
          tickFormat={(v) => formatNumber(v, 1)}
        />
      </Card>
      {profile.length > 1 ? (
        <Card>
          <LineChart
            title="Altitud GPS (m)"
            points={profile.map((p) => ({ label: formatMetres(p.d), value: p.a }))}
            format={(v) => `${formatNumber(v, 0)} m`}
            tickFormat={(v) => formatNumber(v, 0)}
          />
          <AppText variant="small">
            Desnivel: sube {formatNumber(gain, 0)} m y baja {formatNumber(loss, 0)} m. La altitud del GPS es
            aproximada.
          </AppText>
        </Card>
      ) : null}
      {splits.length > 0 ? <SplitsCard splits={splits} /> : null}
      <AppText variant="small">Toca o arrastra sobre las gráficas para ver cada momento.</AppText>
    </>
  );
}

function SplitsCard({ splits }: { splits: Split[] }) {
  const pace = (s: Split) => s.seconds / (s.distanceM / 1000);
  const fastest = Math.min(...splits.map(pace));
  return (
    <Card>
      <AppText variant="heading">Parciales</AppText>
      {splits.map((s, i) => (
        <Row key={i} style={{ flexWrap: 'nowrap' }}>
          <AppText style={styles.splitLabel}>{s.distanceM === 1000 ? `Km ${i + 1}` : formatMetres(s.distanceM)}</AppText>
          {/* Longer bar = faster kilometre. */}
          <View style={styles.splitTrack}>
            <View style={[styles.splitBar, { width: `${(fastest / pace(s)) * 100}%` }]} />
          </View>
          <AppText style={styles.splitPace}>{formatClock(pace(s) * 1000)} /km</AppText>
        </Row>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  splitLabel: { width: 64, fontWeight: '600' },
  splitTrack: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  splitBar: { height: 8, borderRadius: radius.pill, backgroundColor: colors.chart },
  splitPace: { width: 92, textAlign: 'right', fontVariant: ['tabular-nums'] },
  hero: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  heroValue: { color: colors.text, fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'] },
  controls: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  discard: { backgroundColor: colors.bg, paddingBottom: spacing.sm },
  phaseBox: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 2,
    backgroundColor: colors.card,
  },
  countdown: { fontSize: 88, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bar: { flexDirection: 'row', height: 14, borderRadius: radius.pill, overflow: 'hidden', gap: 2 },
  barDone: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(14, 17, 22, 0.65)' },
});
