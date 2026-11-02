import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { showDialog } from '@/components/Dialog';
import { AppText, Button, Card, Chip, Loading, Row, Screen, Stepper, WeekdayPicker } from '@/components/ui';
import {
  copyDietDay,
  deleteDietItem,
  listDietItems,
  MEALS,
  updateDietItemGrams,
  type DietItem,
} from '@/db/repositories/diet';
import { loadNutritionTargets } from '@/db/repositories/settings';
import { formatNumber } from '@/domain/format';
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
const DEVIATION_COLOR: Record<Deviation, string> = { ok: colors.primary, near: colors.warning, off: colors.danger };

export default function DietScreen() {
  const db = useDb();
  const [day, setDay] = useState<IsoWeekday>(isoWeekdayOf(new Date()));
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);
  const { data, reload } = useLoader(async (db) => ({
    items: await listDietItems(db),
    targets: await loadNutritionTargets(db, localDateString(new Date())),
  }));

  if (!data) return <Loading />;

  const dayItems = data.items.filter((i) => i.weekday === day);
  const dayTotals = sumMacros(dayItems.map(itemMacros));
  const weekAverage = averageMacros(
    ISO_WEEKDAYS.map((d) => sumMacros(data.items.filter((i) => i.weekday === d).map(itemMacros))),
  );

  const changeDay = (d: IsoWeekday) => {
    setDay(d);
    setEditingItem(null);
    setCopying(false);
  };

  const changed = async () => {
    setEditingItem(null);
    await reload();
  };

  return (
    <Screen>
      <Row>
        {ISO_WEEKDAYS.map((d) => (
          <Chip key={d} label={WEEKDAY_NAMES[d].slice(0, 3)} selected={d === day} onPress={() => changeDay(d)} />
        ))}
      </Row>

      <TotalsCard title={`Total ${WEEKDAY_NAMES[day].toLowerCase()}`} totals={dayTotals} targets={data.targets} />

      {MEALS.map((meal) => {
        const items = dayItems.filter((i) => i.meal === meal.key);
        const mealKcal = sumMacros(items.map(itemMacros)).kcal;
        return (
          <Card key={meal.key}>
            <Row between>
              <AppText variant="heading" style={{ flex: 1 }}>
                {meal.label}
              </AppText>
              {items.length > 0 ? <AppText variant="muted">{formatNumber(mealKcal, 0)} kcal</AppText> : null}
            </Row>
            {items.map((item) =>
              editingItem === item.id ? (
                <ItemEditor key={item.id} item={item} onDone={changed} />
              ) : (
                <Pressable key={item.id} style={styles.itemRow} onPress={() => setEditingItem(item.id)}>
                  <AppText style={{ flex: 1 }}>{item.foodName}</AppText>
                  <AppText variant="muted">
                    {formatNumber(item.grams)} g · {formatNumber(itemMacros(item).kcal, 0)} kcal
                  </AppText>
                </Pressable>
              ),
            )}
            <Button
              kind="ghost"
              title="+ Añadir alimento"
              onPress={() => router.push({ pathname: '/alimentos', params: { pickDay: String(day), pickMeal: meal.key } })}
            />
          </Card>
        );
      })}

      {copying ? (
        <CopyDayCard
          from={day}
          onCancel={() => setCopying(false)}
          onCopy={async (to) => {
            await copyDietDay(db, day, to);
            setCopying(false);
            await reload();
          }}
        />
      ) : (
        <Button kind="secondary" title={`Copiar el ${WEEKDAY_NAMES[day].toLowerCase()} a otros días`} onPress={() => setCopying(true)} />
      )}

      <TotalsCard title="Media semanal" totals={weekAverage} targets={data.targets} />
      <Button kind="secondary" title="Catálogo de alimentos" onPress={() => router.push('/alimentos')} />
    </Screen>
  );
}

function ItemEditor({ item, onDone }: { item: DietItem; onDone: () => void }) {
  const db = useDb();
  const [grams, setGrams] = useState(item.grams);
  const m = macrosFor(item, grams);

  const save = async () => {
    await updateDietItemGrams(db, item.id, grams);
    onDone();
  };
  const remove = async () => {
    await deleteDietItem(db, item.id);
    onDone();
  };

  return (
    <View style={styles.editor}>
      <AppText>{item.foodName}</AppText>
      <Stepper decimal value={grams} onChange={setGrams} step={10} min={0} format={(g) => `${formatNumber(g)} g`} />
      <AppText variant="small">
        {formatNumber(m.kcal, 0)} kcal · P {formatNumber(m.protein, 1)} g · G {formatNumber(m.fat, 1)} g · C{' '}
        {formatNumber(m.carbs, 1)} g
      </AppText>
      <Row>
        <Button title="Guardar" onPress={save} disabled={grams <= 0} />
        <Button kind="danger" title="Quitar" onPress={remove} />
        <Button kind="ghost" title="Cancelar" onPress={onDone} />
      </Row>
    </View>
  );
}

function CopyDayCard({
  from,
  onCancel,
  onCopy,
}: {
  from: IsoWeekday;
  onCancel: () => void;
  onCopy: (to: IsoWeekday[]) => void;
}) {
  const [chosen, setTargets] = useState<IsoWeekday[]>([]);

  const confirm = () =>
    showDialog(
      'Copiar día',
      `El plan de ${chosen.map((d) => WEEKDAY_NAMES[d].toLowerCase()).join(', ')} se reemplazará por el del ${WEEKDAY_NAMES[from].toLowerCase()}.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Copiar', onPress: () => onCopy(chosen) },
      ],
    );

  return (
    <Card>
      <AppText variant="heading">Copiar el {WEEKDAY_NAMES[from].toLowerCase()} a…</AppText>
      <WeekdayPicker value={chosen} onChange={setTargets} hide={[from]} />
      <Row>
        <Button title="Copiar" onPress={confirm} disabled={chosen.length === 0} />
        <Button kind="ghost" title="Cancelar" onPress={onCancel} />
      </Row>
    </Card>
  );
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
        <Row key={label} between>
          <AppText variant="muted" style={{ flex: 1 }}>
            {label}
          </AppText>
          <View style={{ flexDirection: 'row' }}>
            <AppText style={target ? { color: DEVIATION_COLOR[deviation(value, target)], fontWeight: '700' } : undefined}>
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
      {targets ? (
        <AppText variant="small">Verde: a menos del 5 % del objetivo · ámbar: menos del 10 % · rojo: más.</AppText>
      ) : (
        <AppText variant="small">Completa tu perfil para comparar con tus objetivos.</AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  editor: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
});
