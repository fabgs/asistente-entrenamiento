import { router, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { showActions, showDialog, showPrompt, showSnackbar, type SheetAction } from '@/components/Dialog';
import { CopyDays, EatenTotals, FoodRow, GramsEditor, itemMacros, MealTickHeader, PlanTotals, TickRow } from '@/components/Diet';
import { FormRow } from '@/components/FormRow';
import { Sheet } from '@/components/Sheet';
import {
  AddRow,
  AppText,
  Button,
  Chip,
  DayPicker,
  EmptyState,
  Icon,
  ListGroup,
  ListRow,
  Loading,
  RowIcon,
  Screen,
  Section,
  Segmented,
  SwitchRow,
  TabHeaderButton,
  TextField,
  useBusy,
} from '@/components/ui';
import {
  copyDietDay,
  createDietPlan,
  deleteDietPlan,
  dietPlanNameTaken,
  eatenByDate,
  loadDietDay,
  MEALS,
  removeDietItem,
  renameDietPlan,
  restoreDietDays,
  restoreDietItem,
  setDietDayOverrides,
  setEaten,
  updateDietItemGrams,
  type DietItem,
} from '@/db/repositories/diet';
import { loadNutritionTargets } from '@/db/repositories/settings';
import {
  belongsTo,
  dayPlan,
  dayProgress,
  eatenLine,
  keptMealsLine,
  mealSources,
  mealsLine,
  overridesOf,
  planSource,
  sameSource,
  sourceName,
  switchDayPlan,
  tickedMeals,
  weekdaySource,
  type DietSource,
  type Meal,
  type MealProgress,
} from '@/domain/diet';
import { formatNumber, NBSP } from '@/domain/format';
import { averageMacros, sumMacros } from '@/domain/nutrition';
import { dateOfWeekday, ISO_WEEKDAYS, isoWeekdayOf, localDateString, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

/** «Hoy», what to eat today and what is ticked; «Planes», the plans it comes from. */
type Tab = 'today' | 'plans';
type TotalsView = 'day' | 'week';

const PLAN_NAME_MAX = 30;
const MEAL_LABEL = Object.fromEntries(MEALS.map((m) => [m.key, m.label])) as Record<Meal, string>;

/**
 * Dieta (PLAN.md §5). «Hoy» is the day's list to tick as it is eaten, on the plan of its weekday
 * or on another one for today only («Cambiar»). «Planes» is where they are written: the seven
 * weekdays and the «planes de día» of the user's (1.5.1).
 */
export default function DietScreen() {
  const db = useDb();
  const navigation = useNavigation();
  const [tab, setTab] = useState<Tab>('today');
  // The plan on view in «Planes»: today's weekday until another is chosen.
  const [chosen, setChosen] = useState<DietSource | null>(null);
  const [view, setView] = useState<TotalsView>('day');
  const [item, setItem] = useState<DietItem | null>(null);
  const [sheet, setSheet] = useState<'copy' | 'swap' | 'new' | null>(null);
  const { data, reload } = useLoader(async (db) => {
    const now = new Date();
    const date = localDateString(now);
    return {
      now,
      date,
      weekday: isoWeekdayOf(now),
      ...(await loadDietDay(db, date)),
      targets: await loadNutritionTargets(db, date),
      // What was ticked from Monday to today.
      week: await eatenByDate(db, localDateString(dateOfWeekday(now, 1, 0)), date),
    };
  });

  // The ⋮ of the tab: its actions change with what is on view, the button does not.
  const openMenu = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <TabHeaderButton icon="dots-vertical" label="Más acciones" onPress={() => openMenu.current()} />,
    });
  }, [navigation]);

  // A plan deleted while on view gives way to today's weekday.
  const selected: DietSource =
    chosen && data && (chosen.kind === 'weekday' || data.plans.some((p) => p.id === chosen.planId)) ? chosen : weekdaySource(data?.weekday ?? 1);
  const planNames = new Map((data?.plans ?? []).map((p) => [p.id, p.name]));
  const itemsOf = (source: DietSource) => (data?.items ?? []).filter((i) => belongsTo(i, source));
  const selectedItems = itemsOf(selected);
  const selectedName = sourceName(selected, planNames);
  /** «el martes», ««Comida fuera»»: the plan on view inside a sentence. */
  const selectedInText = selected.kind === 'weekday' ? `el ${selectedName.toLowerCase()}` : `«${selectedName}»`;

  const rename = async () => {
    if (selected.kind !== 'plan') return;
    const name = (await showPrompt('Nombre del plan', { value: selectedName, maxLength: PLAN_NAME_MAX }))?.trim();
    if (!name || name === selectedName) return;
    if (await dietPlanNameTaken(db, name, selected.planId)) {
      showSnackbar('Ya hay un plan con ese nombre');
      return;
    }
    await renameDietPlan(db, selected.planId, name);
    await reload();
  };

  const removePlan = () => {
    if (selected.kind !== 'plan' || !data) return;
    const { planId } = selected;
    showDialog(`¿Borrar «${selectedName}»?`, 'Se borra el plan con sus alimentos. Lo que marcaste otros días se queda.', [
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await deleteDietPlan(db, planId, data.date);
          setChosen(null);
          await reload();
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  function menu() {
    const actions: SheetAction[] = [];
    if (tab === 'plans') {
      if (selected.kind === 'plan') actions.push({ text: 'Cambiar nombre', icon: 'pencil-outline', onPress: rename });
      // Copying an empty plan would only empty the others.
      if (selectedItems.length > 0) {
        actions.push({
          text: selected.kind === 'weekday' ? `Copiar ${selectedInText} a…` : 'Copiar a un día…',
          icon: 'content-copy',
          onPress: () => setSheet('copy'),
        });
      }
    }
    actions.push(
      { text: 'Objetivos del día', icon: 'target', onPress: () => router.push('/objetivos') },
      { text: 'Catálogo de alimentos', icon: 'food-apple-outline', onPress: () => router.push('/alimentos') },
    );
    if (tab === 'plans' && selected.kind === 'plan') {
      actions.push({ text: 'Borrar plan', icon: 'trash-can-outline', destructive: true, onPress: removePlan });
    }
    showActions(actions);
  }
  useEffect(() => {
    openMenu.current = menu;
  });

  if (!data) return <Loading />;

  const { date, weekday } = data;
  const sources = mealSources(weekday, data.overrides);
  const progress = dayProgress(data.items, sources, data.eaten);
  const ticked = tickedMeals(data.eaten);
  const todayPlan = dayPlan(sources, ticked);
  const kcalOf = (source: DietSource) => `${formatNumber(sumMacros(itemsOf(source).map(itemMacros)).kcal, 0)}${NBSP}kcal`;

  const toggle = async (ids: number[], eaten: boolean) => {
    await setEaten(db, date, ids, eaten, Date.now());
    await reload();
  };

  /** «Cambiar»: today follows another plan; the meals with something ticked stay as they were eaten. */
  const changePlan = async (target: DietSource) => {
    setSheet(null);
    const before = data.overrides;
    const { sources: next, kept } = switchDayPlan(sources, ticked, target);
    // Nothing to change, nothing to undo: the plan the day is already on, or every meal has ticks.
    if (MEALS.every((m) => sameSource(next[m.key], sources[m.key]))) {
      if (kept.length > 0 && MEALS.every((m) => ticked.has(m.key))) showSnackbar('Todas las comidas de hoy tienen algo marcado: se quedan como están');
      return;
    }
    await setDietDayOverrides(db, date, overridesOf(weekday, next));
    await reload();
    showSnackbar([`Hoy: ${sourceName(target, planNames)}`, keptMealsLine(kept)].filter(Boolean).join('. '), {
      label: 'Deshacer',
      onPress: async () => {
        await setDietDayOverrides(db, date, before);
        await reload();
      },
    });
  };

  const saveGrams = async (target: DietItem, grams: number) => {
    setItem(null);
    await updateDietItemGrams(db, target.id, grams, date);
    await reload();
  };

  const remove = async (target: DietItem) => {
    setItem(null);
    const removed = await removeDietItem(db, target.id, date);
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
    setSheet(null);
    const replaced = await copyDietDay(db, selected, to, date);
    await reload();
    showSnackbar(selected.kind === 'weekday' ? `Plan del ${selectedName.toLowerCase()} copiado` : `«${selectedName}» copiado`, {
      label: 'Deshacer',
      onPress: async () => {
        await restoreDietDays(db, to, replaced);
        await reload();
      },
    });
  };

  /** A new plan of a day, empty or starting as the one on view; the error to show, if any. */
  const create = async (name: string, copyOnView: boolean): Promise<string | null> => {
    if (await dietPlanNameTaken(db, name)) return 'Ya hay un plan con ese nombre';
    const id = await createDietPlan(db, name, copyOnView ? selected : null);
    setSheet(null);
    setChosen(planSource(id));
    await reload();
    return null;
  };

  const pastDays = ISO_WEEKDAYS.filter((d) => d < weekday).map((d) => ({ day: d, eaten: data.week.get(localDateString(dateOfWeekday(data.now, d, 0))) }));

  return (
    <Screen>
      <Segmented<Tab>
        options={[
          { value: 'today', label: 'Hoy' },
          { value: 'plans', label: 'Planes' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'today' ? (
        <>
          <ListGroup>
            {/* The name first (a long one of the user's has two lines there); the count may take a second line with large type. */}
            <ListRow
              left={<RowIcon name="silverware-fork-knife" />}
              title={sourceName(todayPlan, planNames)}
              subtitle={<AppText variant="secondary">{`Plan de hoy · ${mealsLine(progress) ?? 'sin alimentos'}`}</AppText>}
              onPress={() => setSheet('swap')}
            />
          </ListGroup>

          {progress.meals.length === 0 ? (
            <EmptyState
              icon="silverware-clean"
              title="Hoy no hay nada en el plan"
              text="Añade alimentos en Planes o cambia el plan de hoy."
            />
          ) : (
            <EatenTotals eaten={progress.eaten} planned={progress.planned} />
          )}

          {progress.meals.map((meal) => (
            <TodayMeal
              key={meal.meal}
              meal={meal}
              // Said only when it is not the plan of the day: a meal eaten before changing it.
              from={sameSource(meal.source, todayPlan) ? null : sourceName(meal.source, planNames)}
              onToggle={toggle}
            />
          ))}

          {pastDays.length > 0 ? (
            <Section label="Esta semana">
              <ListGroup>
                {pastDays.map(({ day, eaten }) => (
                  <View key={day} style={styles.weekRow}>
                    <AppText variant="bodySm" style={{ flex: 1 }}>
                      {WEEKDAY_NAMES[day]}
                    </AppText>
                    <AppText variant="secondary" tabular numberOfLines={1}>
                      {eaten ? eatenLine({ kcal: eaten.macros.kcal, meals: eaten.meals }) : 'Nada marcado'}
                    </AppText>
                  </View>
                ))}
              </ListGroup>
            </Section>
          ) : null}
        </>
      ) : (
        <>
          <View style={styles.plans}>
            <DayPicker
              multiple={false}
              value={selected.kind === 'weekday' ? [selected.weekday] : []}
              onChange={(days) => {
                if (days[0]) setChosen(weekdaySource(days[0]));
              }}
            />
            <View style={styles.chips}>
              {data.plans.map((plan) => (
                <Chip
                  key={plan.id}
                  label={plan.name}
                  selected={sameSource(selected, planSource(plan.id))}
                  onPress={() => setChosen(planSource(plan.id))}
                />
              ))}
              <Chip label="+ Plan de día" color={colors.muted} onPress={() => setSheet('new')} />
            </View>
          </View>

          <View style={styles.totals}>
            <Segmented<TotalsView>
              options={[
                { value: 'day', label: selected.kind === 'weekday' ? 'Día' : 'Plan' },
                { value: 'week', label: 'Media semanal' },
              ]}
              value={view}
              onChange={setView}
            />
            <PlanTotals
              totals={
                view === 'day'
                  ? sumMacros(selectedItems.map(itemMacros))
                  : averageMacros(ISO_WEEKDAYS.map((d) => sumMacros(itemsOf(weekdaySource(d)).map(itemMacros))))
              }
              targets={data.targets}
            />
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
            const items = selectedItems.filter((i) => i.meal === meal.key);
            const kcal = sumMacros(items.map(itemMacros)).kcal;
            return (
              <Section key={meal.key} label={meal.label} right={items.length > 0 ? `${formatNumber(kcal, 0)}${NBSP}kcal` : undefined}>
                <ListGroup>
                  {items.map((i) => (
                    <FoodRow key={i.id} item={i} onPress={() => setItem(i)} />
                  ))}
                  <AddRow
                    title="Añadir alimento"
                    onPress={() =>
                      router.push({
                        pathname: '/alimentos',
                        params:
                          selected.kind === 'weekday'
                            ? { pickDay: String(selected.weekday), pickMeal: meal.key }
                            : { pickPlan: String(selected.planId), pickMeal: meal.key },
                      })
                    }
                  />
                </ListGroup>
              </Section>
            );
          })}
        </>
      )}

      <Sheet
        visible={item !== null}
        title={item?.foodName ?? ''}
        onClose={() => setItem(null)}
        action={item ? <Button kind="danger" icon="minus-circle-outline" title="Quitar" onPress={() => remove(item)} /> : null}>
        {item ? <GramsEditor key={item.id} item={item} onSave={(grams) => saveGrams(item, grams)} /> : null}
      </Sheet>

      <Sheet
        visible={sheet === 'copy'}
        title={selected.kind === 'weekday' ? `Copiar ${selectedInText} a…` : `Copiar ${selectedInText} a un día`}
        onClose={() => setSheet(null)}>
        {sheet === 'copy' ? <CopyDays from={selected.kind === 'weekday' ? selected.weekday : null} onCopy={copy} /> : null}
      </Sheet>

      <Sheet visible={sheet === 'new'} title="Nuevo plan de día" onClose={() => setSheet(null)}>
        {sheet === 'new' ? (
          <NewPlan
            copyLabel={
              selectedItems.length === 0
                ? null
                : selected.kind === 'weekday'
                  ? `Empezar con lo del ${selectedName.toLowerCase()}`
                  : `Empezar con lo de «${selectedName}»`
            }
            onCreate={create}
          />
        ) : null}
      </Sheet>

      <Sheet visible={sheet === 'swap'} title="Plan de hoy" onClose={() => setSheet(null)}>
        <ScrollView style={{ flexGrow: 0 }}>
          <ListGroup style={{ backgroundColor: colors.cardAlt }}>
            <PlanChoice
              title={WEEKDAY_NAMES[weekday]}
              subtitle={`El de siempre · ${kcalOf(weekdaySource(weekday))}`}
              selected={sameSource(todayPlan, weekdaySource(weekday))}
              onPress={() => changePlan(weekdaySource(weekday))}
            />
            {data.plans.map((plan) => (
              <PlanChoice
                key={plan.id}
                title={plan.name}
                subtitle={kcalOf(planSource(plan.id))}
                selected={sameSource(todayPlan, planSource(plan.id))}
                onPress={() => changePlan(planSource(plan.id))}
              />
            ))}
          </ListGroup>
        </ScrollView>
        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">Como otro día</AppText>
          <DayPicker
            multiple={false}
            hide={[weekday]}
            value={todayPlan.kind === 'weekday' && todayPlan.weekday !== weekday ? [todayPlan.weekday] : []}
            onChange={(days) => {
              if (days[0]) changePlan(weekdaySource(days[0]));
            }}
          />
        </View>
        <AppText variant="caption">
          {data.plans.length === 0
            ? 'Solo cambia hoy. En Planes puedes crear planes de día para cuando comes distinto.'
            : 'Solo cambia hoy. Las comidas con algo marcado se quedan como están.'}
        </AppText>
      </Sheet>
    </Screen>
  );
}

/** A meal of today: its circle ticks it whole, each food ticks itself. */
function TodayMeal({
  meal,
  from,
  onToggle,
}: {
  meal: MealProgress<DietItem>;
  from: string | null;
  onToggle: (ids: number[], eaten: boolean) => void;
}) {
  const label = MEAL_LABEL[meal.meal];
  return (
    <View style={{ gap: spacing.sm }}>
      <MealTickHeader
        label={from ? `${label} · ${from}` : label}
        kcal={meal.planned.kcal}
        done={meal.done}
        onToggle={() =>
          onToggle(
            meal.items.map((i) => i.id),
            !meal.done,
          )
        }
      />
      <ListGroup>
        {meal.items.map((i) => (
          <TickRow key={i.id} item={i} eaten={meal.eatenIds.has(i.id)} onToggle={() => onToggle([i.id], !meal.eatenIds.has(i.id))} />
        ))}
      </ListGroup>
    </View>
  );
}

/** A plan in «Plan de hoy»: the one the day is on is marked. */
function PlanChoice({ title, subtitle, selected, onPress }: { title: string; subtitle: string; selected: boolean; onPress: () => void }) {
  return (
    <ListRow
      left={<Icon name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={selected ? colors.primary : colors.muted} />}
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      chevron={false}
    />
  );
}

function NewPlan({ copyLabel, onCreate }: { copyLabel: string | null; onCreate: (name: string, copy: boolean) => Promise<string | null> }) {
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(copyLabel !== null);
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = useBusy();
  return (
    <>
      <TextField
        label="Nombre"
        value={name}
        onChangeText={(text) => {
          setName(text);
          setError(null);
        }}
        placeholder="Día de descanso"
        maxLength={PLAN_NAME_MAX}
        error={error ?? undefined}
        autoFocus
      />
      {copyLabel ? (
        <ListGroup style={{ backgroundColor: colors.cardAlt }}>
          <FormRow>
            <SwitchRow label={copyLabel} value={copy} onValueChange={setCopy} />
          </FormRow>
        </ListGroup>
      ) : null}
      <Button
        size="lg"
        title="Crear"
        disabled={!name.trim() || busy}
        onPress={run(async () => setError(await onCreate(name, copy && copyLabel !== null)))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  plans: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  totals: { gap: spacing.md },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
