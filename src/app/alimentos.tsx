import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Keyboard, StyleSheet, TextInput, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import {
  AppText,
  Button,
  EmptyState,
  HeaderButton,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  Loading,
  NumberRow,
  Screen,
  Section,
} from '@/components/ui';
import { addDietItem, listFoods, type Food } from '@/db/repositories/diet';
import type { Meal } from '@/db/seedTypes';
import { formatNumber, NBSP, normalizeForSearch } from '@/domain/format';
import { kcalOf, macrosFor } from '@/domain/nutrition';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { colors, radius, spacing, type } from '@/theme';

/** «Añadir al desayuno», «Añadir a la comida»… */
const ADD_TO: Record<Meal, string> = {
  desayuno: 'Añadir al desayuno',
  comida: 'Añadir a la comida',
  merienda: 'Añadir a la merienda',
  cena: 'Añadir a la cena',
};

const sortKey = (food: Food) => normalizeForSearch(food.name);

/** Initial for the overline, without accents ("Á" goes with "A"); digits and symbols under «#». */
function initialOf(food: Food): string {
  const first = sortKey(food).charAt(0).toUpperCase();
  return /[A-ZÑ]/.test(first) ? first : '#';
}

/** Food catalog. With `pickDay` and `pickMeal`, choosing a food adds it to that meal of the plan. */
export default function FoodsScreen() {
  const params = useLocalSearchParams<{ pickDay?: string; pickMeal?: Meal }>();
  const pick =
    params.pickDay && params.pickMeal ? { day: Number(params.pickDay) as IsoWeekday, meal: params.pickMeal } : null;
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Food | null>(null);
  const { data } = useLoader((db) => listFoods(db));

  const newFood = (name?: string) =>
    router.push({ pathname: '/alimento/[id]', params: { id: 'nuevo', ...(name ? { nombre: name } : {}) } });
  const header = (
    <Stack.Screen
      options={{
        title: pick ? ADD_TO[pick.meal] : 'Alimentos',
        headerRight: () => <HeaderButton icon="plus" label="Nuevo alimento" onPress={() => newFood()} />,
      }}
    />
  );

  if (!data) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }

  const search = normalizeForSearch(query.trim());
  const visible = data
    .filter((f) => sortKey(f).includes(search))
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  const groups: { initial: string; foods: Food[] }[] = [];
  for (const food of visible) {
    const initial = initialOf(food);
    const last = groups.at(-1);
    if (last?.initial === initial) last.foods.push(food);
    else groups.push({ initial, foods: [food] });
  }

  return (
    <Screen>
      {header}
      <SearchField value={query} onChangeText={setQuery} placeholder="Buscar alimento" />
      {groups.map((group) => (
        <Section key={group.initial} label={group.initial}>
          <ListGroup>
            {group.foods.map((food) => (
              <ListRow
                key={food.id}
                title={food.name}
                titleLines={1}
                right={
                  <AppText variant="secondary" tabular>
                    {formatNumber(kcalOf(food.fatPer100g, food.carbsPer100g, food.proteinPer100g), 0)}
                    {NBSP}kcal
                  </AppText>
                }
                onPress={() => {
                  if (!pick) return router.push(`/alimento/${food.id}`);
                  Keyboard.dismiss();
                  setChosen(food);
                }}
                chevron={!pick}
              />
            ))}
          </ListGroup>
        </Section>
      ))}
      {visible.length === 0 ? (
        <EmptyState
          icon="magnify"
          title="Ningún alimento coincide"
          text={query.trim() ? `Puedes crear «${query.trim()}» con sus macros.` : undefined}
          action={
            query.trim() ? (
              <Button kind="secondary" icon="plus" title="Crear alimento" onPress={() => newFood(query.trim())} />
            ) : null
          }
        />
      ) : null}

      {pick ? (
        <Sheet visible={chosen !== null} title={chosen?.name ?? ''} onClose={() => setChosen(null)}>
          {chosen ? (
            <AddToMeal
              key={chosen.id}
              food={chosen}
              onAdded={() => {
                setChosen(null);
                router.back();
              }}
              day={pick.day}
              meal={pick.meal}
            />
          ) : null}
        </Sheet>
      ) : null}
    </Screen>
  );
}

function AddToMeal({ food, day, meal, onAdded }: { food: Food; day: IsoWeekday; meal: Meal; onAdded: () => void }) {
  const db = useDb();
  const [grams, setGrams] = useState(100);
  const [adding, setAdding] = useState(false);
  const kcal = macrosFor(food, grams).kcal;

  const add = async () => {
    setAdding(true);
    await addDietItem(db, day, meal, food.id, grams);
    onAdded();
  };

  return (
    <>
      <NumberRow
        label="Gramos"
        value={grams}
        onChange={setGrams}
        step={10}
        min={0}
        max={5000}
        format={(g) => `${formatNumber(g)}${NBSP}g`}
      />
      <AppText variant="caption" tabular>
        {formatNumber(kcal, 0)}
        {NBSP}kcal
      </AppText>
      <Button size="lg" title="Añadir" disabled={grams <= 0 || adding} onPress={add} />
    </>
  );
}

/** Search box: magnifier inside on the left, no label, and a cross to clear it. */
function SearchField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.search, focused && styles.searchFocused]}>
      <Icon name="magnify" size={20} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        returnKeyType="search"
        autoCorrect={false}
        style={styles.searchText}
        accessibilityLabel={placeholder}
      />
      {value ? <IconButton icon="close" label="Borrar la búsqueda" size={20} color={colors.muted} onPress={() => onChangeText('')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  searchFocused: { borderWidth: 2, borderColor: colors.primary, margin: -1 },
  searchText: { flex: 1, alignSelf: 'stretch', ...type.body, color: colors.text, paddingVertical: spacing.sm },
});
