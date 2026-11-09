import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { RouteListItem, SavedRoute, WalkRoute } from '@/db/repositories/routes';
import { formatClock } from '@/domain/format';
import { formatRecordDate } from '@/domain/records';
import { followText, type FollowView } from '@/domain/routeFollow';
import { routeFacts, timesLine } from '@/domain/routes';
import { colors, radius, spacing } from '@/theme';
import { FormRow } from './FormRow';
import { RouteRowThumbnail } from './RouteMap';
import { Sheet } from './Sheet';
import { AppText, Button, Figure, Icon, ListGroup, ListRow, ROW_ICON_INSET, RowIcon, SwitchRow, useBusy, type IconName } from './ui';

export const openRoute = (routeId: number) => router.push({ pathname: '/mis-rutas/[id]', params: { id: String(routeId) } });

/**
 * A row of Mis rutas: its outline, «5,14 km · desnivel +48 m» over «4 veces · la última el 9 nov»
 * and the best time. Also for choosing a route to follow (1.4.9).
 */
export function RouteRow({ item, today, onPress }: { item: RouteListItem; today: string; onPress: () => void }) {
  const { route, count, lastDate, bestMs } = item;
  return (
    <ListRow
      title={route.name}
      left={<RouteRowThumbnail segments={route.segments} />}
      subtitle={
        <>
          {/* Beside the best time even «4 veces · la última el 9 nov» needs two lines. */}
          <AppText variant="secondary" numberOfLines={2}>
            {routeFacts(route.distanceM, route.climbM, true)}
          </AppText>
          <AppText variant="secondary" numberOfLines={2}>
            {count === 0 && route.source === 'gpx'
              ? 'Importada de un GPX'
              : timesLine(count, lastDate ? formatRecordDate(lastDate, today) : null)}
          </AppText>
        </>
      }
      right={bestMs !== null ? <Figure value={formatClock(bestMs)} caption="mejor" /> : undefined}
      onPress={onPress}
    />
  );
}

/**
 * On the screen of a finished walk, between its figures and its map: the route it is linked to
 * («3.ª vez · 2:10 más rápido que tu mejor»), or the question about the one it seems to repeat.
 */
export function WalkRouteBlock({ info, onYes, onNo }: { info: NonNullable<WalkRoute>; onYes: () => Promise<void>; onNo: () => Promise<void> }) {
  const [busy, run] = useBusy();
  if (info.kind === 'linked') {
    return (
      <ListGroup inset={ROW_ICON_INSET}>
        <ListRow
          title={info.name}
          left={<RowIcon name="map-marker-path" />}
          subtitle={
            <>
              <AppText variant="secondary" numberOfLines={1}>
                {info.first}
              </AppText>
              {info.second ? (
                <AppText variant="secondary" numberOfLines={2}>
                  {info.second}
                </AppText>
              ) : null}
            </>
          }
          onPress={() => openRoute(info.routeId)}
        />
      </ListGroup>
    );
  }
  return (
    <View style={styles.box}>
      <View style={styles.headRow}>
        <Icon name="map-marker-question-outline" size={18} color={colors.warning} />
        <AppText variant="label" weight="600">
          Ruta
        </AppText>
      </View>
      <AppText variant="body">{info.title}</AppText>
      {info.detail ? <AppText variant="secondary">{info.detail}</AppText> : null}
      <View style={styles.buttons}>
        <Button kind="tonal" title="Sí" disabled={busy} onPress={run(onYes)} style={{ flex: 1 }} />
        <Button kind="secondary" title="No" disabled={busy} onPress={run(onNo)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const PILL: Record<FollowView['kind'], { icon: IconName; color: string }> = {
  waiting: { icon: 'map-marker-path', color: colors.muted },
  approach: { icon: 'map-marker-distance', color: colors.muted },
  on: { icon: 'map-marker-path', color: colors.primary },
  off: { icon: 'map-marker-alert-outline', color: colors.warning },
  done: { icon: 'map-marker-check-outline', color: colors.primary },
};

/**
 * Under the figures of a walk that follows a route (1.4.9): «2,3 de 5,1 km · quedan 2,8», how far
 * the route is, or «Fuera de la ruta · a 60 m» in amber. Built like the GPS pill of the title; grey in a pause.
 */
export function RouteFollowPill({ view, name, paused }: { view: FollowView; name: string; paused: boolean }) {
  const { icon, color } = PILL[view.kind];
  const off = view.kind === 'off';
  const text = followText(view, name);
  return (
    <View style={[styles.pill, off && !paused && { backgroundColor: colors.warningTint }]} accessible accessibilityLabel={text} accessibilityLiveRegion="polite">
      <Icon name={icon} size={14} color={paused ? colors.muted : color} />
      <AppText variant="bodySm" weight="600" tabular numberOfLines={1} maxFontSizeMultiplier={1.15} style={{ color: paused ? colors.muted : colors.text }}>
        {text}
      </AppText>
    </View>
  );
}

/**
 * «Seguir una ruta»: the saved routes (a tap starts following one), the switch of the alert and, when
 * starting a walk, «Caminar libre» at the bottom (`onFree`); from the walk's menu there is none.
 */
export function FollowRouteSheet({
  visible,
  routes,
  today,
  alertOn,
  onAlert,
  onPick,
  onFree,
  onClose,
}: {
  visible: boolean;
  routes: RouteListItem[];
  today: string;
  alertOn: boolean;
  onAlert: (on: boolean) => void;
  onPick: (route: SavedRoute) => void;
  onFree?: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title="Seguir una ruta" onClose={onClose}>
      <ScrollView style={{ flexGrow: 0, flexShrink: 1 }}>
        <ListGroup inset={ROW_ICON_INSET} style={{ backgroundColor: colors.cardAlt }}>
          {routes.map((item) => (
            <RouteRow key={item.route.id} item={item} today={today} onPress={() => onPick(item.route)} />
          ))}
        </ListGroup>
      </ScrollView>
      <ListGroup style={{ backgroundColor: colors.cardAlt }}>
        <FormRow>
          <SwitchRow label="Avisar si me salgo" subtitle="También con la pantalla bloqueada" value={alertOn} onValueChange={onAlert} />
        </FormRow>
      </ListGroup>
      {onFree ? <Button size="lg" icon="play" title="Caminar libre" onPress={onFree} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.cardAlt,
  },
  box: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
