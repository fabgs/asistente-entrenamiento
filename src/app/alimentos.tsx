import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, Loading, Screen, Stepper, TextField } from '@/components/ui';
import { addDietItem, listFoods, MEALS, type Food } from '@/db/repositories/diet';
import type { Meal } from '@/db/seedTypes';
import { formatNumber, normalizeForSearch } from '@/domain/format';
import { kcalOf, macrosFor } from '@/domain/nutrition';
import { WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

/** Food catalog. With `pickDay` and `pickMeal`, choosing a food adds it to that meal of the plan. */
export default function FoodsScreen() {
  const params = useLocalSearchParams<{ pickDay?: string; pickMeal?: Meal }>();
  const pick =
    params.pickDay && params.pickMeal ? { day: Number(params.pickDay) as IsoWeekday, meal: params.pickMeal } : null;
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<number | null>(null);
  const { data } = useLoader((db) => listFoods(db));

  if (!data) return <Loading />;

  const visible = data.filter((f) => normalizeForSearch(f.name).includes(normalizeForSearch(query.trim())));
  const mealLabel = pick ? MEALS.find((m) => m.key === pick.meal)?.label : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: pick ? `Añadir a ${mealLabel?.toLowerCase()}` : 'Alimentos' }} />
      {pick ? (
        <AppText variant="muted">
          {mealLabel} del {WEEKDAY_NAMES[pick.day].toLowerCase()}: elige un alimento y la cantidad.
        </AppText>
      ) : null}
      <TextField label="Buscar" value={query} onChangeText={setQuery} placeholder="Pollo, arroz…" />
      <Button kind="secondary" title="Crear alimento nuevo" onPress={() => router.push('/alimento/nuevo')} />
      {visible.map((food) => (
        <View key={food.id} style={styles.row}>
          <Pressable
            onPress={() => (pick ? setChosen(chosen === food.id ? null : food.id) : router.push(`/alimento/${food.id}`))}>
            <AppText>{food.name}</AppText>
            <AppText variant="small">{per100(food)}</AppText>
          </Pressable>
          {pick && chosen === food.id ? <AddPanel food={food} day={pick.day} meal={pick.meal} /> : null}
        </View>
      ))}
      {visible.length === 0 ? <AppText variant="muted">Ningún alimento coincide.</AppText> : null}
    </Screen>
  );
}

function per100(f: Food): string {
  const kcal = kcalOf(f.fatPer100g, f.carbsPer100g, f.proteinPer100g);
  return `${formatNumber(kcal, 0)} kcal · P ${formatNumber(f.proteinPer100g, 1)} · G ${formatNumber(f.fatPer100g, 1)} · C ${formatNumber(f.carbsPer100g, 1)} por 100 g`;
}

function AddPanel({ food, day, meal }: { food: Food; day: IsoWeekday; meal: Meal }) {
  const db = useDb();
  const [grams, setGrams] = useState(100);

  const add = async () => {
    await addDietItem(db, day, meal, food.id, grams);
    router.back();
  };

  return (
    <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
      <Stepper decimal value={grams} onChange={setGrams} step={10} min={0} format={(g) => `${formatNumber(g)} g`} />
      <AppText variant="small">{formatNumber(macrosFor(food, grams).kcal, 0)} kcal</AppText>
      <Button title="Añadir" onPress={add} disabled={grams <= 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
});
