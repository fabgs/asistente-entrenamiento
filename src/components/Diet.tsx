import * as Haptics from 'expo-haptics';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DietItem } from '@/db/repositories/diet';
import { formatNumber, NBSP } from '@/domain/format';
import { deviation, macrosFor, type Deviation, type Macros, type NutritionTargets } from '@/domain/nutrition';
import type { IsoWeekday } from '@/domain/types';
import { colors, spacing } from '@/theme';
import { AppText, Button, Card, DayPicker, Divider, Icon, NumberRow, ProgressBar, SectionLabel, Value } from './ui';

export const itemMacros = (i: DietItem) => macrosFor(i, i.grams);

/** PLAN.md §5: green within 5 % of the target, amber within 10 %, red further; always with an icon. */
const DEVIATION_LOOK: Record<Deviation, { color: string; icon: 'check' | 'alert'; words: string }> = {
  ok: { color: colors.primary, icon: 'check', words: 'en el objetivo' },
  near: { color: colors.warning, icon: 'alert', words: 'cerca del objetivo' },
  off: { color: colors.danger, icon: 'alert', words: 'lejos del objetivo' },
};

const CELLS: { label: string; unit: string; of: (m: Macros) => number; target: (t: NutritionTargets) => number }[] = [
  { label: 'Calorías', unit: 'kcal', of: (m) => m.kcal, target: (t) => t.targetKcal },
  { label: 'Proteína', unit: 'g', of: (m) => m.protein, target: (t) => t.proteinG },
  { label: 'Grasa', unit: 'g', of: (m) => m.fat, target: (t) => t.fatG },
  { label: 'Hidratos', unit: 'g', of: (m) => m.carbs, target: (t) => t.carbsG },
];

/** Two rows of two cells in one card. Not two StatRow: each is a card of its own, and in the light mode drew its outline inside this one. */
function Grid({ cell }: { cell: (index: number) => ReactNode }) {
  return (
    <Card flush>
      <View style={styles.gridRow}>
        {cell(0)}
        <View style={styles.gridDivider} />
        {cell(1)}
      </View>
      <Divider />
      <View style={styles.gridRow}>
        {cell(2)}
        <View style={styles.gridDivider} />
        {cell(3)}
      </View>
    </Card>
  );
}

/** Calories and macros of a plan in a 2 × 2 grid, each against its target when the profile has one. */
export function PlanTotals({ totals, targets }: { totals: Macros; targets: NutritionTargets | null }) {
  return (
    <Grid
      cell={(i) => {
        const { label, unit, of, target } = CELLS[i];
        const goal = targets ? target(targets) : 0;
        const figure = formatNumber(of(totals), 0);
        if (!goal) return <Cell key={label} label={label} figure={figure} unit={unit} />;
        const look = DEVIATION_LOOK[deviation(of(totals), goal)];
        return (
          <Cell
            key={label}
            label={label}
            figure={figure}
            unit={unit}
            of={goal}
            progress={of(totals) / goal}
            color={look.color}
            icon={look.icon}
            spoken={`${label}: ${figure} de ${formatNumber(goal, 0)} ${unit}, ${look.words}`}
          />
        );
      }}
    />
  );
}

/** What is ticked today against the plan of today: a count that fills up, not a verdict. */
export function EatenTotals({ eaten, planned }: { eaten: Macros; planned: Macros }) {
  return (
    <Grid
      cell={(i) => {
        const { label, unit, of } = CELLS[i];
        const figure = formatNumber(of(eaten), 0);
        const goal = of(planned);
        if (goal <= 0) return <Cell key={label} label={label} figure={figure} unit={unit} />;
        return (
          <Cell
            key={label}
            label={label}
            figure={figure}
            unit={unit}
            of={goal}
            progress={of(eaten) / goal}
            color={colors.primary}
            spoken={`${label}: ${figure} de ${formatNumber(goal, 0)} ${unit} del plan`}
          />
        );
      }}
    />
  );
}

function Cell({
  label,
  figure,
  unit,
  of,
  progress,
  color,
  icon,
  spoken,
}: {
  label: string;
  figure: string;
  unit: string;
  of?: number;
  progress?: number;
  color?: string;
  icon?: 'check' | 'alert';
  spoken?: string;
}) {
  return (
    <View style={styles.cell} accessible={!!spoken} accessibilityLabel={spoken}>
      <AppText variant="label" numberOfLines={1}>
        {label}
      </AppText>
      <Value value={figure} unit={unit} size="metricSm" />
      {of !== undefined ? (
        <>
          <View style={styles.targetLine}>
            {icon ? <Icon name={icon} size={12} color={color} /> : null}
            <AppText variant="caption" tabular numberOfLines={1}>
              de {formatNumber(of, 0)}
            </AppText>
          </View>
          <View style={styles.meter}>
            <ProgressBar progress={progress ?? 0} color={color} />
          </View>
        </>
      ) : null}
    </View>
  );
}

/** A food of a meal of a plan: name, then grams and kcal in two right-aligned columns. Tapping it edits its grams. */
export function FoodRow({ item, onPress }: { item: DietItem; onPress: () => void }) {
  const grams = formatNumber(item.grams);
  const kcal = formatNumber(itemMacros(item).kcal, 0);
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.pressed }}
      accessibilityRole="button"
      accessibilityLabel={`${item.foodName}, ${grams} gramos, ${kcal} kilocalorías`}
      style={styles.foodRow}>
      <FoodColumns item={item} />
    </Pressable>
  );
}

/** The same food in today's list (1.5.1): the whole row ticks it as eaten. */
export function TickRow({ item, eaten, onToggle }: { item: DietItem; eaten: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onToggle();
      }}
      android_ripple={{ color: colors.pressed }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: eaten }}
      accessibilityLabel={`${item.foodName}, ${formatNumber(item.grams)} gramos`}
      style={styles.foodRow}>
      <View style={styles.tick}>
        <Tick done={eaten} />
      </View>
      <FoodColumns item={item} muted={eaten} />
    </Pressable>
  );
}

function FoodColumns({ item, muted = false }: { item: DietItem; muted?: boolean }) {
  return (
    <>
      <AppText variant="bodySm" numberOfLines={2} style={[{ flex: 1 }, muted && { color: colors.muted }]}>
        {item.foodName}
      </AppText>
      <AppText variant="secondary" tabular numberOfLines={1} style={styles.grams}>
        {formatNumber(item.grams)}
        {NBSP}g
      </AppText>
      <Value value={formatNumber(itemMacros(item).kcal, 0)} unit="kcal" size="control" align="right" style={styles.kcal} />
    </>
  );
}

/** The circle of Hoy: filled once done. */
function Tick({ done }: { done: boolean }) {
  return <Icon name={done ? 'check-circle' : 'circle-outline'} size={22} color={done ? colors.primary : colors.muted} />;
}

/**
 * The label of a meal in today's list: its circle, in line with those of its foods, ticks the whole
 * meal (or unticks it, once all of it is eaten).
 */
export function MealTickHeader({ label, kcal, done, onToggle }: { label: string; kcal: number; done: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onToggle();
      }}
      hitSlop={{ top: 12, bottom: 4 }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={`${label}, todo`}
      style={styles.mealHead}>
      <Tick done={done} />
      <View style={{ flex: 1 }}>
        <SectionLabel flush right={`${formatNumber(kcal, 0)}${NBSP}kcal`}>
          {label}
        </SectionLabel>
      </View>
    </Pressable>
  );
}

export function GramsEditor({ item, onSave }: { item: DietItem; onSave: (grams: number) => void }) {
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

/** The weekdays whose plan is replaced by the one being copied; `from` (a weekday) is not offered. */
export function CopyDays({ from, onCopy }: { from: IsoWeekday | null; onCopy: (to: IsoWeekday[]) => void }) {
  const [to, setTo] = useState<IsoWeekday[]>([]);
  return (
    <>
      <DayPicker value={to} onChange={setTo} hide={from === null ? [] : [from]} />
      <AppText variant="caption">El plan de los días que elijas se sustituye por este.</AppText>
      <Button size="lg" title="Copiar" disabled={to.length === 0} onPress={() => onCopy(to)} />
    </>
  );
}

const styles = StyleSheet.create({
  gridRow: { flexDirection: 'row', alignItems: 'stretch' },
  gridDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
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
  // With the gap of the row, the name starts 12 dp after the circle.
  tick: { marginRight: spacing.xs },
  grams: { minWidth: 64, textAlign: 'right' },
  kcal: { minWidth: 72 },
  // The circle sits over those of the foods (the list has the same padding); the kcal, where a label's go.
  mealHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.xs, minHeight: 24 },
});
