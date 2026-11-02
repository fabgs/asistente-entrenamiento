import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { showDialog } from '@/components/Dialog';
import { AppText, Button, Card, Loading, Row, Screen, TextField } from '@/components/ui';
import { archiveFood, createFood, foodNameTaken, getFood, updateFood, type Food } from '@/db/repositories/diet';
import { formatNumber, parseDecimal } from '@/domain/format';
import { kcalOf } from '@/domain/nutrition';
import { useDb, useLoader } from '@/hooks/data';
import { colors } from '@/theme';

const EMPTY: Food = { id: 0, name: '', fatPer100g: 0, carbsPer100g: 0, proteinPer100g: 0 };

/** Create (`id = nuevo`) or edit a food of the catalog. */
export default function FoodEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'nuevo';
  const { data } = useLoader(async (db) => (isNew ? EMPTY : await getFood(db, Number(id))));

  if (data === undefined) return <Loading />;
  if (data === null) {
    return (
      <Screen>
        <AppText>No se encontró el alimento.</AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Nuevo alimento' : 'Editar alimento' }} />
      <FoodForm food={data} isNew={isNew} />
    </Screen>
  );
}

const asText = (n: number) => (n ? formatNumber(n, 2) : '');

function FoodForm({ food, isNew }: { food: Food; isNew: boolean }) {
  const db = useDb();
  const [name, setName] = useState(food.name);
  const [protein, setProtein] = useState(asText(food.proteinPer100g));
  const [fat, setFat] = useState(asText(food.fatPer100g));
  const [carbs, setCarbs] = useState(asText(food.carbsPer100g));
  const [error, setError] = useState<string | null>(null);

  const values = [protein, fat, carbs].map((t) => (t.trim() ? parseDecimal(t) : 0));
  const [p, f, c] = values.map((v) => v ?? 0);
  const invalid = values.some((v) => v === null);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Ponle un nombre');
    if (invalid) return setError('Revisa los números (usa coma o punto para los decimales)');
    if (p + f + c > 100) return setError('Los macros no pueden sumar más de 100 g por cada 100 g');
    if (await foodNameTaken(db, trimmed, isNew ? undefined : food.id)) return setError('Ya hay un alimento con ese nombre');
    const fields = { name: trimmed, proteinPer100g: p, fatPer100g: f, carbsPer100g: c };
    if (isNew) await createFood(db, fields);
    else await updateFood(db, food.id, fields);
    router.back();
  };

  const archive = () =>
    showDialog('Archivar alimento', 'Dejará de salir en el catálogo; los días del plan que lo usan no cambian.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Archivar',
        style: 'destructive',
        onPress: async () => {
          await archiveFood(db, food.id);
          router.back();
        },
      },
    ]);

  return (
    <>
      <Card>
        <TextField label="Nombre" value={name} onChangeText={setName} placeholder="Copos de avena" />
        <AppText variant="small">Por cada 100 g</AppText>
        <Row style={{ flexWrap: 'nowrap' }}>
          {(
            [
              ['Proteína (g)', protein, setProtein],
              ['Grasa (g)', fat, setFat],
              ['Carbohidratos (g)', carbs, setCarbs],
            ] as const
          ).map(([label, value, set]) => (
            <View key={label} style={{ flex: 1 }}>
              <TextField label={label} value={value} onChangeText={set} keyboard="decimal" placeholder="0" />
            </View>
          ))}
        </Row>
        <AppText>{invalid ? '—' : `${formatNumber(kcalOf(f, c, p), 0)} kcal por 100 g`}</AppText>
        {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
        <Button title="Guardar" onPress={save} />
      </Card>
      {!isNew ? <Button kind="danger" title="Archivar alimento" onPress={archive} /> : null}
    </>
  );
}
