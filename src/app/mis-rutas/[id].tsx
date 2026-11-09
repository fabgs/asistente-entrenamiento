import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { showActions, showDialog, showPrompt, showSnackbar } from '@/components/Dialog';
import { LineChart } from '@/components/LineChart';
import { RouteMap } from '@/components/RouteMap';
import {
  AppText,
  BottomBar,
  Button,
  Card,
  cardioIcon,
  EditableTitle,
  EmptyState,
  Figure,
  HeaderActions,
  IconButton,
  ListGroup,
  ListRow,
  Loading,
  Screen,
  Section,
  Stat,
  StatRow,
} from '@/components/ui';
import { listCardio, cardioLogOn, type CardioActivity } from '@/db/repositories/cardio';
import { getActiveCardioSession } from '@/db/repositories/cardioSessions';
import { listRoutePhotos } from '@/db/repositories/photos';
import { deleteRoute, getRoute, renameRoute, routeTimes } from '@/db/repositories/routes';
import { formatClock, formatTimeOfDay, NBSP } from '@/domain/format';
import { paceMinPerKm, type LatLon } from '@/domain/gps';
import { capitalize, countOf, formatDayMonth } from '@/domain/progress';
import { formatRecordDate } from '@/domain/records';
import { exclusionText, routeCloses, routeFacts, routeKm, routeRecords, type RouteTime } from '@/domain/routes';
import { cardioKey } from '@/domain/cardioPool';
import { localDateString } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { followRoute, GPS_ERROR_MESSAGE, startCardio } from '@/services/cardioSession';
import { shareRouteGpx } from '@/services/gpx';
import { isOnPhone } from '@/services/photos';
import { dismissRouteAlert } from '@/services/routeAlert';
import { spacing } from '@/theme';

const MIN = 60_000;
/** Near an hour the axis may reach it, and «1:02:00» does not fit in its margin. */
const HOURS_FROM_MIN = 55;

/** Labels of the time axis: «3:45» for short walks, «1:02» (hours and minutes) for those near an hour or longer. */
const axisClock = (maxMinutes: number) => (minutes: number) => {
  if (maxMinutes < HOURS_FROM_MIN) return formatClock(minutes * MIN);
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * A saved route (PLAN.md §6.8, 1.4.8): its map with the photos of every time, the best and the
 * latest time, a chart of the times that compete and every walk of it, each opening its screen.
 */
export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = Number(id);
  const db = useDb();
  const { data, reload } = useLoader(async (db) => {
    const route = await getRoute(db, routeId);
    if (!route) return null;
    const photos = (await listRoutePhotos(db, routeId)).filter(isOnPhone);
    const today = localDateString(new Date());
    return {
      today,
      route,
      times: await routeTimes(db, route),
      places: photos.flatMap((p): LatLon[] => (p.place ? [p.place] : [])),
      active: await getActiveCardioSession(db),
      walks: walksToStart(await listCardio(db), await cardioLogOn(db, today)),
    };
  });

  if (data === undefined) return <Loading />;
  if (data === null) return <EmptyState icon="map-marker-off-outline" title="No se encontró esta ruta" text="Puede que se borrara." />;
  const { today, route, times, places, active, walks } = data;
  const { best, last, chart } = routeRecords(times, routeCloses(route.segments));

  const rename = async () => {
    const name = await showPrompt('Nombre de la ruta', { value: route.name, maxLength: 40, confirm: 'Guardar' });
    if (name === null) return;
    await renameRoute(db, route.id, name);
    reload();
  };
  const exportGpx = () =>
    shareRouteGpx(route).catch((e) => {
      console.warn('Could not export the GPX', e);
      showSnackbar('No se pudo exportar el GPX');
    });
  const menu = () =>
    showActions([
      { text: 'Exportar GPX', icon: 'file-export-outline', onPress: exportGpx },
      {
        text: 'Borrar ruta',
        icon: 'trash-can-outline',
        destructive: true,
        onPress: () =>
          showDialog(`¿Borrar la ruta «${route.name}»?`, 'Sus caminatas siguen en el historial.', [
            {
              text: 'Borrar',
              style: 'destructive',
              onPress: async () => {
                await deleteRoute(db, route.id);
                // A walk following it goes on as a free walk, without its alert.
                if (active?.followRouteId === route.id) await dismissRouteAlert(active.id);
                router.back();
              },
            },
            { text: 'Cancelar', style: 'cancel' },
          ]),
      },
    ]);

  // «Seguir esta ruta»: the walk being recorded follows it; otherwise one starts, with the walk to do.
  const start = async (activity: CardioActivity) => {
    const result = await startCardio(db, activity, route.id);
    if ('error' in result) {
      showDialog('No se puede grabar la ruta', GPS_ERROR_MESSAGE[result.error]);
      return;
    }
    router.push({ pathname: '/cardio-sesion/[id]', params: { id: String(result.sessionId) } });
  };
  const follow = async () => {
    if (active?.tracking === 'gps') {
      await followRoute(db, active, route.id);
      router.push({ pathname: '/cardio-sesion/[id]', params: { id: String(active.id) } });
    } else if (walks.length === 1) {
      await start(walks[0]);
    } else {
      showActions(
        walks.map((a) => ({ text: a.name, icon: cardioIcon(a.name, a.tracking), onPress: () => start(a) })),
        `Seguir «${route.name}»`,
      );
    }
  };
  const canFollow = active ? active.tracking === 'gps' : walks.length > 0;

  return (
    <Screen
      footer={
        canFollow ? (
          <BottomBar>
            <Button size="lg" icon="play" title="Seguir esta ruta" onPress={follow} style={{ flex: 1 }} />
          </BottomBar>
        ) : undefined
      }>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <HeaderActions>
              <IconButton icon="dots-vertical" label="Más acciones" onPress={menu} />
            </HeaderActions>
          ),
        }}
      />
      <View style={{ gap: spacing.xs }}>
        <EditableTitle value={route.name} onEdit={rename} />
        <AppText variant="secondary">
          {[routeFacts(route.distanceM, route.climbM), times.length > 0 ? countOf(times.length, 'vez', 'veces') : null]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
      </View>
      {route.segments.flat().length >= 2 ? <RouteMap segments={route.segments} height={240} photos={places} /> : null}
      {best && last ? (
        <View style={{ gap: spacing.sm }}>
          <StatRow>
            <Stat label="Mejor" value={formatClock(best.activeMs)} caption={formatRecordDate(best.date, today)} />
            {chart.length >= 2 ? <Stat label="Última" value={formatClock(last.activeMs)} caption={formatRecordDate(last.date, today)} /> : null}
          </StatRow>
          {chart.length < 2 ? <AppText variant="caption">Cuando la repitas verás aquí tus tiempos.</AppText> : null}
        </View>
      ) : null}
      {chart.length >= 2 ? (
        <Card>
          <LineChart
            title="Tiempo de cada vez"
            points={chart.map((t) => ({ label: formatRecordDate(t.date, today), value: t.activeMs / MIN }))}
            format={(minutes) => formatClock(minutes * MIN)}
            tickFormat={axisClock(Math.max(...chart.map((t) => t.activeMs / MIN)))}
          />
        </Card>
      ) : null}
      <Section label="Veces" right={times.length > 0 ? String(times.length) : undefined}>
        {times.length === 0 ? (
          <AppText variant="secondary">Sin caminatas todavía.</AppText>
        ) : (
          <ListGroup>
            {[...times].reverse().map((t) => (
              <TimeRow key={t.sessionId} time={t} />
            ))}
          </ListGroup>
        )}
      </Section>
    </Screen>
  );
}

/**
 * The walks with GPS that Hoy would let start now (today's and those of other days, one per
 * activity as «Hacer otro cardio» groups them), without those already done today.
 */
function walksToStart(all: CardioActivity[], doneToday: ReadonlyMap<number, unknown>): CardioActivity[] {
  const groups = new Map<string, CardioActivity[]>();
  for (const a of all.filter((a) => a.tracking === 'gps')) groups.set(cardioKey(a), [...(groups.get(cardioKey(a)) ?? []), a]);
  return [...groups.values()]
    .filter((group) => !group.some((a) => doneToday.has(a.id)))
    .map((group) => group.reduce((a, b) => (b.id < a.id ? b : a)));
}

/** One walk of the route: «Lun 9 nov», «10:42 · al revés» and why it does not compete, if so; its time and pace. */
function TimeRow({ time }: { time: RouteTime }) {
  const kind = time.relation === 'reverse' ? 'al revés' : time.relation === 'variant' ? `variante · ${routeKm(time.distanceM ?? 0)}` : null;
  const pace = time.distanceM && time.activeMs > 0 ? paceMinPerKm(time.distanceM / (time.activeMs / 1000)) : null;
  return (
    <ListRow
      title={capitalize(formatDayMonth(time.date))}
      subtitle={
        <>
          <AppText variant="secondary" numberOfLines={1}>
            {[formatTimeOfDay(time.startedAt), kind].filter(Boolean).join(' · ')}
          </AppText>
          {time.exclusion ? (
            <AppText variant="secondary" numberOfLines={2}>
              {exclusionText(time.exclusion)}
            </AppText>
          ) : null}
        </>
      }
      right={<Figure value={formatClock(time.activeMs)} caption={pace ? `${pace}${NBSP}/km` : undefined} />}
      onPress={() => router.push({ pathname: '/cardio-sesion/[id]', params: { id: String(time.sessionId) } })}
    />
  );
}
