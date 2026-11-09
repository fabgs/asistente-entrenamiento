import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { RouteListItem, WalkRoute } from '@/db/repositories/routes';
import { formatClock } from '@/domain/format';
import { formatRecordDate } from '@/domain/records';
import { routeFacts, timesLine } from '@/domain/routes';
import { colors, radius, spacing } from '@/theme';
import { RouteRowThumbnail } from './RouteMap';
import { AppText, Button, Figure, Icon, ListGroup, ListRow, ROW_ICON_INSET, RowIcon, useBusy } from './ui';

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
            {timesLine(count, lastDate ? formatRecordDate(lastDate, today) : null)}
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

const styles = StyleSheet.create({
  box: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
