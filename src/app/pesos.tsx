import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import { showSnackbar } from '@/components/Dialog';
import { Divider, EmptyState, ListRow, Loading, SectionLabel, Value } from '@/components/ui';
import { WeightSheet } from '@/components/WeightSheet';
import { countWeights, deleteWeight, listWeightsPage, logWeight, type WeightEntry } from '@/db/repositories/settings';
import { formatNumber } from '@/domain/format';
import { capitalize, formatDayMonth, formatMonth, groupByMonth } from '@/domain/progress';
import { useDb } from '@/hooks/data';
import { colors, radius, spacing } from '@/theme';

/** Weigh-ins read at a time: more load as the list nears its end. */
const PAGE = 30;

/** Every weigh-in, newest first and by month, loaded as it scrolls (Perfil shows only the last 3). */
export default function WeightsScreen() {
  const db = useDb();
  const [rows, setRows] = useState<WeightEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<WeightEntry | null>(null);
  const shown = useRef(0);
  const busy = useRef(false);

  /** Reads again what is on screen (at least a page), after an edit or coming back to the screen. */
  const refresh = useCallback(async () => {
    const page = await listWeightsPage(db, Math.max(PAGE, shown.current), 0);
    setTotal(await countWeights(db));
    shown.current = page.length;
    setRows(page);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const loadMore = async () => {
    if (busy.current || !rows || rows.length >= total) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const page = await listWeightsPage(db, PAGE, rows.length);
      const next = [...rows, ...page];
      shown.current = next.length;
      setRows(next);
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  };

  const save = async (kg: number) => {
    if (!editing) return;
    setEditing(null);
    await logWeight(db, editing.date, kg);
    await refresh();
  };

  const remove = async (entry: WeightEntry) => {
    setEditing(null);
    if (!(await deleteWeight(db, entry.date))) return;
    await refresh();
    showSnackbar('Pesaje borrado', {
      label: 'Deshacer',
      onPress: async () => {
        await logWeight(db, entry.date, entry.weightKg);
        await refresh();
      },
    });
  };

  if (!rows) return <Loading />;
  const sections = groupByMonth(rows, (w) => w.date).map((g, i) => ({
    key: g.month,
    title: formatMonth(g.month),
    first: i === 0,
    data: g.items,
  }));

  return (
    <View style={styles.screen}>
      <SectionList
        sections={sections}
        keyExtractor={(w) => w.date}
        renderSectionHeader={({ section }) => (
          <View style={[styles.monthHeader, section.first && { paddingTop: 0 }]}>
            <SectionLabel>{section.title}</SectionLabel>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View style={[styles.groupRow, index === 0 && styles.groupTop, index === section.data.length - 1 && styles.groupBottom]}>
            <ListRow
              title={capitalize(formatDayMonth(item.date))}
              right={<Value value={formatNumber(item.weightKg)} unit="kg" size="rowValue" />}
              onPress={() => setEditing(item)}
            />
          </View>
        )}
        ItemSeparatorComponent={RowSeparator}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={styles.more} /> : undefined}
        ListEmptyComponent={<EmptyState icon="scale-bathroom" title="Sin pesajes todavía" text="Regístralos desde Perfil." />}
        stickySectionHeadersEnabled={false}
        initialNumToRender={PAGE}
        contentContainerStyle={styles.list}
      />
      <WeightSheet
        open={editing !== null}
        entry={editing}
        start={editing?.weightKg ?? 0}
        canDelete={total > 1}
        onClose={() => setEditing(null)}
        onSave={save}
        onDelete={remove}
      />
    </View>
  );
}

/** Hairline between the rows of one month. */
function RowSeparator() {
  return (
    <View style={styles.separatorBox}>
      <Divider inset={spacing.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  monthHeader: { paddingTop: spacing.xl, paddingBottom: spacing.sm },
  groupRow: { backgroundColor: colors.card, overflow: 'hidden' },
  groupTop: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  groupBottom: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  separatorBox: { backgroundColor: colors.card },
  more: { paddingVertical: spacing.lg },
});
