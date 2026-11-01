import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Card, Chip, Loading, Row, Screen } from '@/components/ui';
import { listDietItems, MEALS, type DietItem } from '@/db/repositories/diet';
import { loadNutritionTargets } from '@/db/repositories/settings';
import { formatNumber } from '@/domain/format';
import { macrosFor, sumMacros, type Macros, type NutritionTargets } from '@/domain/nutrition';
import { ISO_WEEKDAYS, isoWeekdayOf, localDateString, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useLoader } from '@/hooks/data';
import { colors } from '@/theme';

const itemMacros = (i: DietItem) => macrosFor(i, i.grams);

export default function DietScreen() {
  const [day, setDay] = useState<IsoWeekday>(isoWeekdayOf(new Date()));
  const { data } = useLoader(async (db) => ({
    items: await listDietItems(db),
    targets: await loadNutritionTargets(db, localDateString(new Date())),
  }));

  if (!data) return <Loading />;

  const dayItems = data.items.filter((i) => i.weekday === day);
  const dayTotals = sumMacros(dayItems.map(itemMacros));
  const weekTotals = ISO_WEEKDAYS.map((d) => sumMacros(data.items.filter((i) => i.weekday === d).map(itemMacros)));
  const weekAverage: Macros = {
    fat: weekTotals.reduce((s, m) => s + m.fat, 0) / 7,
    carbs: weekTotals.reduce((s, m) => s + m.carbs, 0) / 7,
    protein: weekTotals.reduce((s, m) => s + m.protein, 0) / 7,
    kcal: weekTotals.reduce((s, m) => s + m.kcal, 0) / 7,
  };

  return (
    <Screen>
      <Row>
        {ISO_WEEKDAYS.map((d) => (
          <Chip key={d} label={WEEKDAY_NAMES[d].slice(0, 3)} selected={d === day} onPress={() => setDay(d)} />
        ))}
      </Row>

      <TotalsCard title={`Total ${WEEKDAY_NAMES[day].toLowerCase()}`} totals={dayTotals} targets={data.targets} />

      {MEALS.map((meal) => {
        const items = dayItems.filter((i) => i.meal === meal.key);
        if (items.length === 0) return null;
        const mealKcal = sumMacros(items.map(itemMacros)).kcal;
        return (
          <Card key={meal.key}>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText variant="heading">{meal.label}</AppText>
              <AppText variant="muted">{formatNumber(mealKcal, 0)} kcal</AppText>
            </Row>
            {items.map((i) => (
              <Row key={i.id} style={{ justifyContent: 'space-between' }}>
                <AppText style={{ flex: 1 }}>{i.foodName}</AppText>
                <AppText variant="muted">
                  {formatNumber(i.grams)} g · {formatNumber(itemMacros(i).kcal, 0)} kcal
                </AppText>
              </Row>
            ))}
          </Card>
        );
      })}

      <TotalsCard title="Media semanal" totals={weekAverage} targets={data.targets} />
      <AppText variant="small" style={{ textAlign: 'center' }}>
        La edición del plan de dieta llegará en la fase 7.
      </AppText>
    </Screen>
  );
}

function deviationColor(value: number, target: number): string {
  const deviation = Math.abs(value - target) / target;
  if (deviation <= 0.05) return colors.primary;
  if (deviation <= 0.1) return colors.warning;
  return colors.danger;
}

function TotalsCard({ title, totals, targets }: { title: string; totals: Macros; targets: NutritionTargets | null }) {
  const rows: [string, number, number | undefined, string][] = [
    ['Kcal', totals.kcal, targets?.targetKcal, ''],
    ['Proteína', totals.protein, targets?.proteinG, ' g'],
    ['Grasa', totals.fat, targets?.fatG, ' g'],
    ['Carbohidratos', totals.carbs, targets?.carbsG, ' g'],
  ];
  return (
    <Card>
      <AppText variant="heading">{title}</AppText>
      {rows.map(([label, value, target, unit]) => (
        <Row key={label} style={{ justifyContent: 'space-between' }}>
          <AppText variant="muted">{label}</AppText>
          <View style={{ flexDirection: 'row' }}>
            <AppText style={target ? { color: deviationColor(value, target), fontWeight: '700' } : undefined}>
              {formatNumber(value, 0)}
              {unit}
            </AppText>
            {target ? (
              <AppText variant="muted">
                {' '}
                / {formatNumber(target, 0)}
                {unit}
              </AppText>
            ) : null}
          </View>
        </Row>
      ))}
      {!targets ? <AppText variant="small">Completa tu perfil para comparar con tus objetivos.</AppText> : null}
    </Card>
  );
}
