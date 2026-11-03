import { router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { showActions, showDialog } from '@/components/Dialog';
import {
  AppText,
  BottomBar,
  Button,
  EmptyState,
  HeaderButton,
  Icon,
  ListGroup,
  ListRow,
  Loading,
  Screen,
  Section,
  TextField,
  Value,
} from '@/components/ui';
import { archiveFood, createFood, foodNameTaken, getFood, updateFood, type Food } from '@/db/repositories/diet';
import { formatNumber, parseDecimal } from '@/domain/format';
import { kcalOf } from '@/domain/nutrition';
import { useDb, useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

const EMPTY: Food = { id: 0, name: '', fatPer100g: 0, carbsPer100g: 0, proteinPer100g: 0 };

/** Create (`id = nuevo`, optionally with the `nombre` searched for) or edit a food of the catalog. */
export default function FoodEditorScreen() {
  const { id, nombre } = useLocalSearchParams<{ id: string; nombre?: string }>();
  const isNew = id === 'nuevo';
  const { data } = useLoader(async (db) => (isNew ? { ...EMPTY, name: nombre ?? '' } : await getFood(db, Number(id))));

  if (data === undefined) return <Loading />;
  if (data === null) {
    return (
      <Screen>
        <EmptyState icon="food-apple-outline" title="No se encontró el alimento" />
      </Screen>
    );
  }
  return <FoodForm key={data.id} food={data} isNew={isNew} />;
}

const asText = (n: number) => (n ? formatNumber(n, 2) : '');
/** Empty counts as 0; null while the text is not a number. */
const asNumber = (text: string) => (text.trim() ? parseDecimal(text) : 0);

type Field = 'name' | 'protein' | 'fat' | 'carbs' | 'total';

function FoodForm({ food, isNew }: { food: Food; isNew: boolean }) {
  const db = useDb();
  const [name, setName] = useState(food.name);
  const [protein, setProtein] = useState(asText(food.proteinPer100g));
  const [fat, setFat] = useState(asText(food.fatPer100g));
  const [carbs, setCarbs] = useState(asText(food.carbsPer100g));
  const [error, setError] = useState<{ field: Field; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const p = asNumber(protein);
  const f = asNumber(fat);
  const c = asNumber(carbs);
  const changed =
    name.trim() !== food.name ||
    p !== food.proteinPer100g ||
    f !== food.fatPer100g ||
    c !== food.carbsPer100g;
  // A new food can be saved as soon as it has a name (it may come from the search).
  const canSave = !saving && (isNew ? name.trim() !== '' : changed);

  /** Validates and writes; false (with the error on its field) if something is wrong. */
  const persist = async (): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) return fail('name', 'Ponle un nombre');
    if (p === null) return fail('protein', 'No es un número');
    if (f === null) return fail('fat', 'No es un número');
    if (c === null) return fail('carbs', 'No es un número');
    if (p + f + c > 100) return fail('total', 'Los macros no pueden sumar más de 100 g por cada 100 g');
    if (await foodNameTaken(db, trimmed, isNew ? undefined : food.id)) return fail('name', 'Ya hay un alimento con ese nombre');
    const fields = { name: trimmed, proteinPer100g: p, fatPer100g: f, carbsPer100g: c };
    setSaving(true);
    try {
      if (isNew) await createFood(db, fields);
      else await updateFood(db, food.id, fields);
      return true;
    } catch {
      // Only possible clash left: an archived food with that exact name.
      return fail('name', 'Ya hay un alimento con ese nombre');
    } finally {
      setSaving(false);
    }
  };

  function fail(field: Field, text: string): false {
    setError({ field, text });
    return false;
  }

  const disableLeaveCheck = usePreventRemove(changed && !leaving, ({ repeat }) =>
    showDialog('¿Guardar los cambios?', undefined, [
      {
        text: 'Guardar',
        onPress: async () => {
          if (!(await persist())) return;
          setLeaving(true);
          repeat();
        },
      },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: () => {
          setLeaving(true);
          repeat();
        },
      },
      { text: 'Seguir editando', style: 'cancel' },
    ]),
  );

  const leave = () => {
    setLeaving(true);
    disableLeaveCheck();
    router.back();
  };

  const save = async () => {
    setError(null);
    if (await persist()) leave();
  };

  const remove = () =>
    showDialog('¿Borrar el alimento?', 'Desaparece del catálogo. Los días de la dieta que lo usan no cambian.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await archiveFood(db, food.id);
          leave();
        },
      },
    ]);

  const edit = (set: (text: string) => void) => (text: string) => {
    set(text);
    if (error) setError(null);
  };
  const errorFor = (field: Field) => (error?.field === field ? error.text : undefined);
  const kcal = p === null || f === null || c === null ? null : kcalOf(f, c, p);

  return (
    <Screen
      footer={
        <BottomBar>
          <Button size="lg" title="Guardar" disabled={!canSave} onPress={save} style={{ flex: 1 }} />
        </BottomBar>
      }>
      <Stack.Screen
        options={{
          title: isNew ? 'Nuevo alimento' : 'Alimento',
          headerRight: isNew
            ? undefined
            : () => (
                <HeaderButton
                  icon="dots-vertical"
                  label="Más acciones"
                  onPress={() =>
                    showActions([{ text: 'Borrar alimento', icon: 'trash-can-outline', destructive: true, onPress: remove }])
                  }
                />
              ),
        }}
      />
      <TextField
        label="Nombre"
        value={name}
        onChangeText={edit(setName)}
        placeholder="Copos de avena"
        error={errorFor('name')}
        autoFocus={isNew && !food.name}
      />

      <Section label="Macros por 100 gramos">
        <View style={styles.macros}>
          <View style={styles.macro}>
            <TextField label="Proteína" value={protein} onChangeText={edit(setProtein)} keyboard="decimal" placeholder="0" suffix="g" error={errorFor('protein')} />
          </View>
          <View style={styles.macro}>
            <TextField label="Grasa" value={fat} onChangeText={edit(setFat)} keyboard="decimal" placeholder="0" suffix="g" error={errorFor('fat')} />
          </View>
          <View style={styles.macro}>
            <TextField label="Hidratos" value={carbs} onChangeText={edit(setCarbs)} keyboard="decimal" placeholder="0" suffix="g" error={errorFor('carbs')} />
          </View>
        </View>
        {error?.field === 'total' ? (
          <View style={styles.totalError}>
            <Icon name="alert-circle" size={16} color={colors.danger} />
            <AppText variant="caption" style={{ flex: 1, color: colors.danger }}>
              {error.text}
            </AppText>
          </View>
        ) : null}
        <ListGroup>
          <ListRow title="Calorías" right={kcal === null ? '–' : <Value value={formatNumber(kcal, 0)} unit="kcal" size="rowValue" />} />
        </ListGroup>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  macros: { flexDirection: 'row', gap: spacing.sm },
  macro: { flex: 1 },
  totalError: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
