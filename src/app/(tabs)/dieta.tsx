import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { showActions, showSnackbar, type SheetAction } from '@/components/Dialog';
import { Sheet } from '@/components/Sheet';
import {
  AddRow,
  AppText,
  Button,
  Card,
  DayPicker,
  Divider,
  TabHeaderButton,
  Icon,
  ListGroup,
  ListRow,
  Loading,
  NumberRow,
  ProgressBar,
  RowIcon,
  Screen,
  Section,
  Segmented,
  StatRow,
  Value,
} from '@/components/ui';
import {
  copyDietDay,
  listDietItems,
  MEALS,
  removeDietItem,
  restoreDietDays,
  restoreDietItem,
  updateDietItemGrams,
  type DietItem,
} from '@/db/repositories/diet';
import { loadNutritionTargets } from '@/db/repositories/settings';
import { formatNumber, NBSP } from '@/domain/format';
import {
  averageMacros,
  deviation,
  macrosFor,
  sumMacros,
  type Deviation,
  type Macros,
  type NutritionTargets,
} from '@/domain/nutrition';
import { ISO_WEEKDAYS, isoWeekdayOf, localDateString, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

const itemMacros = (i: DietItem) => macrosFor(i, i.grams);

/** PLAN.md §5: green within 5 % of the target, amber within 10 %, red further; always with an icon. */
const DEVIATION_LOOK: Record<Deviation, { color: string; icon: 'check' | 'alert'; words: string }> = {
  ok: { color: colors.primary, icon: 'check', words: 'en el objetivo' },
  near: { color: colors.warning, icon: 'alert', words: 'cerca del objetivo' },
  off: { color: colors.danger, icon: 'alert', words: 'lejos del objetivo' },
};

type TotalsView = 'day' | 'week';

export default function DietScreen() {
  const db = useDb();
  const navigation = useNavigation();
  const [day, setDay] = useState<IsoWeekday>(() => isoWeekdayOf(new Date()));
  const [view, setView] = useState<TotalsView>('day');
  const [item, setItem] = useState<DietItem | null>(null);
  const [copying, setCopying] = useState(false);
  const { data, reload } = useLoader(async (db) => ({
    items: await listDietItems(db),
    targets: await loadNutritionTargets(db, localDateString(new Date())),
  }));

  const dayName = WEEKDAY_NAMES[day].toLowerCase();
  const dayItems = data?.items.filter((i) => i.weekday === day) ?? [];
  const hasItems = dayItems.length > 0;

  useLayoutEffect(() => {
    const actions: SheetAction[] = [
      { text: 'Objetivos del día', icon: 'target', onPress: () => router.push('/objetivos') },
      { text: 'Catálogo de alimentos', icon: 'food-apple-outline', onPress: () => router.push('/alimentos') },
    ];
    // Copying an empty day would only empty the others.
    if (hasItems) actions.unshift({ text: `Copiar el ${dayName} a…`, icon: 'content-copy', onPress: () => setCopying(true) });
    navigation.setOptions({
      headerRight: () => <TabHeaderButton icon="dots-vertical" label="Más acciones" onPress={() => showActions(actions)} />,
    });
  }, [navigation, dayName, hasItems]);

  if (!data) return <Loading />;

  const dayTotals = sumMacros(dayItems.map(itemMacros));
  const weekAverage = averageMacros(
    ISO_WEEKDAYS.map((d) => sumMacros(data.items.filter((i) => i.weekday === d).map(itemMacros))),
  );

  const saveGrams = async (target: DietItem, grams: number) => {
    setItem(null);
    await updateDietItemGrams(db, target.id, grams);
    await reload();
  };

  const remove = async (target: DietItem) => {
    setItem(null);
    const removed = await removeDietItem(db, target.id);
    await reload();
    if (!removed) return;
    showSnackbar('Alimento quitado', {
      label: 'Deshacer',
      onPress: async () => {
        await restoreDietItem(db, removed);
        await reload();
      },
    });
  };

  const copy = async (to: IsoWeekday[]) => {
    setCopying(false);
    const replaced = await copyDietDay(db, day, to);
    await reload();
    showSnackbar(`Plan del ${dayName} copiado`, {
      label: 'Deshacer',
      onPress: async () => {
        await restoreDietDays(db, to, replaced);
        await reload();
      },
    });
  };

  return (
    <Screen>
      <DayPicker
        multiple={false}
        value={[day]}
        onChange={(days) => {
          if (days[0]) setDay(days[0]);
        }}
      />

      <View style={styles.totals}>
        <Segmented<TotalsView>
          options={[
            { value: 'day', label: 'Día' },
            { value: 'week', label: 'Media semanal' },
          ]}
          value={view}
          onChange={setView}
        />
        <Totals totals={view === 'day' ? dayTotals : weekAverage} targets={data.targets} />
        {!data.targets ? (
          <ListGroup>
            <ListRow
              left={<RowIcon name="account-alert-outline" color={colors.warning} />}
              title="Completa tu perfil para ver objetivos"
              onPress={() => router.push('/perfil')}
            />
          </ListGroup>
        ) : null}
      </View>

      {MEALS.map((meal) => {
        const items = dayItems.filter((i) => i.meal === meal.key);
        const kcal = sumMacros(items.map(itemMacros)).kcal;
        return (
          <Section key={meal.key} label={meal.label} right={items.length > 0 ? `${formatNumber(kcal, 0)}${NBSP}kcal` : undefined}>
            <ListGroup>
              {items.map((i) => (
                <FoodRow key={i.id} item={i} onPress={() => setItem(i)} />
              ))}
              <AddRow
                title="Añadir alimento"
                onPress={() => router.push({ pathname: '/alimentos', params: { pickDay: String(day), pickMeal: meal.key } })}
              />
            </ListGroup>
          </Section>
        );
      })}

      <Sheet
        visible={item !== null}
        title={item?.foodName ?? ''}
        onClose={() => setItem(null)}
        action={
          item ? <Button kind="danger" icon="minus-circle-outline" title="Quitar" onPress={() => remove(item)} /> : null
        }>
        {item ? <GramsEditor key={item.id} item={item} onSave={(grams) => saveGrams(item, grams)} /> : null}
      </Sheet>

      <Sheet visible={copying} title={`Copiar el ${dayName} a…`} onClose={() => setCopying(false)}>
        {copying ? <CopyDays from={day} onCopy={copy} /> : null}
      </Sheet>
    </Screen>
  );
}

/** Calories and macros in a 2 × 2 grid, each against its target when the profile has one. */
function Totals({ totals, targets }: { totals: Macros; targets: NutritionTargets | null }) {
  return (
    <Card flush>
      <StatRow>
        <TotalCell label="Calorías" value={totals.kcal} unit="kcal" target={targets?.targetKcal} />
        <TotalCell label="Proteína" value={totals.protein} unit="g" target={targets?.proteinG} />
      </StatRow>
      <Divider />
      <StatRow>
        <TotalCell label="Grasa" value={totals.fat} unit="g" target={targets?.fatG} />
        <TotalCell label="Hidratos" value={totals.carbs} unit="g" target={targets?.carbsG} />
      </StatRow>
    </Card>
  );
}

function TotalCell({ label, value, unit, target }: { label: string; value: number; unit: string; target?: number }) {
  const figure = formatNumber(value, 0);
  if (!target) {
    return (
      <View style={styles.cell}>
        <AppText variant="label" numberOfLines={1}>
          {label}
        </AppText>
        <Value value={figure} unit={unit} size="metricSm" />
      </View>
    );
  }
  const look = DEVIATION_LOOK[deviation(value, target)];
  return (
    <View style={styles.cell} accessible accessibilityLabel={`${label}: ${figure} de ${formatNumber(target, 0)} ${unit}, ${look.words}`}>
      <AppText variant="label" numberOfLines={1}>
        {label}
      </AppText>
      <Value value={figure} unit={unit} size="metricSm" />
      <View style={styles.targetLine}>
        <Icon name={look.icon} size={12} color={look.color} />
        <AppText variant="caption" tabular numberOfLines={1}>
          de {formatNumber(target, 0)}
        </AppText>
      </View>
      <View style={styles.meter}>
        <ProgressBar progress={value / target} color={look.color} />
      </View>
    </View>
  );
}

/** A food of a meal: name, then grams and kcal in two right-aligned columns. */
function FoodRow({ item, onPress }: { item: DietItem; onPress: () => void }) {
  const grams = formatNumber(item.grams);
  const kcal = formatNumber(itemMacros(item).kcal, 0);
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.pressed }}
      accessibilityRole="button"
      accessibilityLabel={`${item.foodName}, ${grams} gramos, ${kcal} kilocalorías`}
      style={styles.foodRow}>
      <AppText variant="bodySm" numberOfLines={2} style={{ flex: 1 }}>
        {item.foodName}
      </AppText>
      <AppText variant="secondary" tabular numberOfLines={1} style={styles.grams}>
        {grams}
        {NBSP}g
      </AppText>
      <Value value={kcal} unit="kcal" size="control" align="right" style={styles.kcal} />
    </Pressable>
  );
}

function GramsEditor({ item, onSave }: { item: DietItem; onSave: (grams: number) => void }) {
  const [grams, setGrams] = useState(item.grams);
  const m = macrosFor(item, grams);
  const g = (value: number) => `${formatNumber(value, 1)}${NBSP}g`;
  return (
    <>
      <NumberRow label="Gramos" value={grams} onChange={setGrams} step={10} min={0} max={5000} format={(v) => `${formatNumber(v)}${NBSP}g`} />
      <AppText variant="caption" tabular>
        {formatNumber(m.kcal, 0)}
        {NBSP}kcal · Proteína {g(m.protein)} · Grasa {g(m.fat)} · Hidratos {g(m.carbs)}
      </AppText>
      <Button size="lg" title="Guardar" disabled={grams <= 0} onPress={() => onSave(grams)} />
    </>
  );
}

function CopyDays({ from, onCopy }: { from: IsoWeekday; onCopy: (to: IsoWeekday[]) => void }) {
  const [to, setTo] = useState<IsoWeekday[]>([]);
  return (
    <>
      <DayPicker value={to} onChange={setTo} hide={[from]} />
      <AppText variant="caption">El plan de los días que elijas se sustituye por este.</AppText>
      <Button size="lg" title="Copiar" disabled={to.length === 0} onPress={() => onCopy(to)} />
    </>
  );
}

const styles = StyleSheet.create({
  totals: { gap: spacing.md },
  cell: { flex: 1, minHeight: 72, gap: 2, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  targetLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meter: { marginTop: spacing.xs },
  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  grams: { minWidth: 64, textAlign: 'right' },
  kcal: { minWidth: 72 },
});
