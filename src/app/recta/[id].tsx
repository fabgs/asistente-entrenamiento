import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { showPrompt, showSnackbar } from '@/components/Dialog';
import { InteractiveMap, type MapLayer, type MapStatus } from '@/components/InteractiveMap';
import { AppText, BottomBar, Button, EmptyState, FloatingButton, HeaderButton, Loading, Value } from '@/components/ui';
import {
  getCardioSession,
  lastTrackPoint,
  NO_STRAIGHT,
  setSprintStraight,
  sprintLapFixes,
  type CardioSession,
  type Straight,
} from '@/db/repositories/cardioSessions';
import { NBSP } from '@/domain/format';
import { distanceM, type LatLon } from '@/domain/gps';
import { markedStraight, sprintsPlace, STRAIGHT_RANGE_M } from '@/domain/sprint';
import { useDb, useLoader } from '@/hooks/data';
import { emitDataChanged, queueWrite, reschedule } from '@/hooks/editing';
import { currentPlace } from '@/services/gpsTracker';
import { colors, spacing } from '@/theme';

/** Close enough to tell a kerb from a lane in the orthophoto. */
const ZOOM = 19;
const RANGE_TEXT = `Entre ${STRAIGHT_RANGE_M[0]} y ${STRAIGHT_RANGE_M[1]}${NBSP}m`;

/**
 * Recta (PLAN.md §6.8, 1.5.2): the straight of some sprints, marked on the map. A cross stays in
 * the middle and the map moves under it: «Fijar salida», then «Guardar» with the cross on the
 * finish. Its metres are what the speeds of the session come from. It opens on the straight already
 * marked or where the sprints were run; the metres can also be typed.
 */
export default function StraightScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = Number(id);
  const { data } = useLoader(async (db) => {
    const session = await getCardioSession(db, sessionId);
    if (!session?.sprint) return null;
    const ends = session.sprint.straightEnds;
    const inProgress = session.status === 'in_progress';
    // Where the map opens: the finish already marked, where the sprints are being run or were run, or where the phone is.
    const place: LatLon | null =
      ends?.end ?? (inProgress ? await lastTrackPoint(db, sessionId) : sprintsPlace(await sprintLapFixes(db, sessionId))) ?? (await currentPlace());
    return { session, place, inProgress };
  });
  if (data === undefined) return <Loading />;
  if (data === null) return <EmptyState icon="alert-circle-outline" title="Sesión no encontrada" />;
  return <Marker key={data.session.id} session={data.session} place={data.place} inProgress={data.inProgress} />;
}

function Marker({ session, place, inProgress }: { session: CardioSession; place: LatLon | null; inProgress: boolean }) {
  const db = useDb();
  const plan = session.sprint!;
  const previous: Straight = { straightM: plan.straightM, straightEnds: plan.straightEnds };
  // The end fixed first; with a straight already marked, its start: the cross opens on its finish.
  const [start, setStart] = useState<LatLon | null>(plan.straightEnds?.start ?? null);
  const [center, setCenter] = useState<LatLon | null>(null);
  const [layer, setLayer] = useState<MapLayer>('satellite');
  const [status, setStatus] = useState<MapStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [goTo, setGoTo] = useState<LatLon | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (straight: Straight) => {
    setSaving(true);
    try {
      if (await queueWrite(() => setSprintStraight(db, session.id, straight))) reschedule(db);
      router.back();
      showSnackbar(straight.straightM === null ? 'Recta quitada' : `Recta de ${straight.straightM}${NBSP}m guardada`, {
        label: 'Deshacer',
        onPress: async () => {
          if (await queueWrite(() => setSprintStraight(db, session.id, previous))) reschedule(db);
          emitDataChanged();
        },
      });
    } finally {
      setSaving(false);
    }
  };

  /** The metres typed instead of marked: its ends go away. Empty takes the straight away. */
  const typeMetres = async () => {
    const text = await showPrompt('Recta', {
      value: plan.straightM === null ? '' : String(plan.straightM),
      message: 'Si ya sabes cuánto mide. Vacía, se quita.',
      keyboard: 'number',
      suffix: 'm',
      maxLength: 3,
    });
    if (text === null) return;
    const metres = text.trim() === '' ? null : Number(text.trim());
    if (metres !== null && !(Number.isInteger(metres) && metres >= STRAIGHT_RANGE_M[0] && metres <= STRAIGHT_RANGE_M[1])) {
      showSnackbar(RANGE_TEXT);
      return;
    }
    if (metres === plan.straightM) return;
    await save(metres === null ? NO_STRAIGHT : { straightM: metres, straightEnds: null });
  };

  const header = <Stack.Screen options={{ headerRight: () => <HeaderButton icon="keyboard-outline" label="Escribir los metros" onPress={typeMetres} /> }} />;

  if (!place) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="map-marker-question-outline"
          title="Sin posición"
          text="No hay por dónde abrir el mapa: enciende la ubicación o escribe los metros."
          action={<Button kind="secondary" title="Escribir los metros" onPress={typeMetres} />}
        />
      </View>
    );
  }

  const offline = status === 'offline';
  const ready = status === 'ready' && center !== null;
  const metres = start && center ? Math.round(distanceM(start, center)) : null;
  const straight = start && center ? markedStraight(start, center) : null;

  return (
    <View style={styles.screen}>
      {header}
      <View style={styles.map}>
        <InteractiveMap
          key={attempt}
          segments={[]}
          cursor={null}
          mode="2d"
          layer={layer}
          pick={{ center: place, zoom: ZOOM, anchor: start, cross: true }}
          onCenter={setCenter}
          centerOn={goTo}
          onStatus={setStatus}
        />
        {status === 'loading' ? (
          <View style={styles.state} pointerEvents="none">
            <ActivityIndicator color={colors.primary} />
            <AppText variant="caption">Cargando mapa…</AppText>
          </View>
        ) : offline ? (
          <View style={[styles.state, styles.offline]}>
            <EmptyState
              icon="wifi-off"
              title="Sin conexión"
              text="El mapa necesita internet."
              action={
                <View style={{ gap: spacing.sm }}>
                  <Button
                    kind="secondary"
                    title="Reintentar"
                    onPress={() => {
                      setStatus('loading');
                      setCenter(null);
                      setAttempt(attempt + 1);
                    }}
                  />
                  <Button kind="text" title="Escribir los metros" onPress={typeMetres} />
                </View>
              }
            />
          </View>
        ) : (
          <>
            <View style={styles.controls} pointerEvents="box-none">
              <FloatingButton
                icon="layers-outline"
                label={layer === 'satellite' ? 'Ver el mapa' : 'Ver el satélite'}
                onPress={() => setLayer(layer === 'satellite' ? 'map' : 'satellite')}
              />
              {inProgress ? (
                <FloatingButton
                  icon="crosshairs-gps"
                  label="Centrar en mi posición"
                  onPress={async () => {
                    // It only moves the map: the ends are fixed by eye, never by the GPS.
                    const here = (await lastTrackPoint(db, session.id)) ?? (await currentPlace());
                    if (here) setGoTo({ lat: here.lat, lon: here.lon });
                    else showSnackbar('Sin posición todavía');
                  }}
                />
              ) : null}
            </View>
            {start ? (
              <View style={styles.undo} pointerEvents="box-none">
                <FloatingButton pill icon="undo" text="Cambiar salida" label="Cambiar la salida" onPress={() => setStart(null)} />
              </View>
            ) : null}
          </>
        )}
      </View>

      {offline ? null : (
        <BottomBar actionKey={start ? 'end' : 'start'} style={styles.bar}>
          {start ? (
            <View style={styles.reading}>
              <Value value={metres === null ? '–' : String(metres)} unit="m" size="metricSm" />
              <AppText variant="secondary" style={[styles.flex, metres !== null && !straight ? { color: colors.warning } : null]} numberOfLines={2}>
                {metres !== null && !straight ? RANGE_TEXT : 'Lleva la cruz a la llegada'}
              </AppText>
            </View>
          ) : (
            <AppText variant="secondary" numberOfLines={2}>
              Lleva la cruz a la salida
            </AppText>
          )}
          {start ? (
            <Button
              size="xl"
              icon="check"
              title={saving ? 'Guardando…' : straight ? `Guardar · ${straight.straightM}${NBSP}m` : 'Guardar'}
              disabled={!ready || !straight || saving}
              onPress={() => (straight ? save(straight) : undefined)}
            />
          ) : (
            <Button size="xl" icon="map-marker-outline" title="Fijar salida" disabled={!ready} onPress={() => setStart(center)} />
          )}
        </BottomBar>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  map: { flex: 1 },
  state: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  offline: { backgroundColor: colors.bg },
  controls: { position: 'absolute', top: spacing.sm, right: spacing.sm, alignItems: 'flex-end', gap: spacing.sm },
  undo: { position: 'absolute', left: 0, right: 0, bottom: spacing.md, alignItems: 'center' },
  bar: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.md },
  reading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 40 },
});
