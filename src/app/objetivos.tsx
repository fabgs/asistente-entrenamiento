import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { BackTo } from '@/components/WeightRules';
import {
  AppText,
  Button,
  Card,
  Divider,
  Icon,
  ListGroup,
  ListRow,
  Loading,
  NumberRow,
  RowIcon,
  Screen,
  Segmented,
  Stat,
  StatRow,
  Value,
} from '@/components/ui';
import { getProfile, latestWeight, nutritionTargetsOf, updateProfile, type Profile } from '@/db/repositories/settings';
import {
  ACTIVITY_LEVELS,
  activityLabel,
  DEFAULT_PER_KG,
  deficitFor,
  GOAL_NAMES,
  goalLabel,
  goalOf,
  gramsPerKgLabel,
  missingForTargets,
  mlPerKgLabel,
  PER_KG_LIMITS,
  sameFactor,
  waterLPerKg,
  waterMlPerKg,
  type Goal,
} from '@/domain/bodyProfile';
import { formatNumber, NBSP } from '@/domain/format';
import type { NutritionTargets } from '@/domain/nutrition';
import { localDateString } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

const DEFAULT_GOAL_KCAL = 400;

/**
 * The daily targets (PLAN.md §4) with what sets them besides the body data: the goal and the
 * activity, so that changing them shows the new figures on the same screen. From Perfil and Dieta.
 */
export default function TargetsScreen() {
  const { data } = useLoader(async (db) => ({
    today: localDateString(new Date()),
    profile: await getProfile(db),
    weightKg: await latestWeight(db),
  }));
  if (!data) return <Loading />;
  return <TargetsBody key={JSON.stringify(data.profile)} initial={data.profile} weightKg={data.weightKg} today={data.today} />;
}

function TargetsBody({ initial, weightKg, today }: { initial: Profile; weightKg: number | null; today: string }) {
  const db = useDb();
  const [profile, setProfile] = useState(initial);
  const [sheet, setSheet] = useState<'activity' | 'goal' | PerKg | null>(null);
  const targets = nutritionTargetsOf(profile, weightKg, today);
  const missing = missingForTargets({ ...profile, weightKg });

  const save = (patch: Partial<Profile>) => {
    setProfile((p) => ({ ...p, ...patch }));
    void updateProfile(db, patch);
  };

  return (
    <Screen>
      <Targets targets={targets} missing={missing} />
      {targets && targets.kcalOver > 0 ? <NoCarbsRow targets={targets} /> : null}

      <ListGroup>
        <ListRow title="Objetivo" right={goalLabel(profile.deficitKcal)} onPress={() => setSheet('goal')} />
        <ListRow title="Actividad" right={activityLabel(profile.activityFactor)} onPress={() => setSheet('activity')} />
      </ListGroup>

      <ListGroup>
        <ListRow title="Proteína" right={gramsPerKgLabel(profile.proteinGPerKg)} onPress={() => setSheet('protein')} />
        <ListRow title="Grasa" right={gramsPerKgLabel(profile.fatGPerKg)} onPress={() => setSheet('fat')} />
        <ListRow title="Agua" right={mlPerKgLabel(waterMlPerKg(profile.waterLPerKg))} onPress={() => setSheet('water')} />
      </ListGroup>

      {targets ? (
        <ListGroup>
          <ListRow title="Metabolismo basal" right={<Value value={formatNumber(targets.bmr, 0)} unit="kcal" size="rowValue" />} />
          <ListRow title="Gasto total" right={<Value value={formatNumber(targets.tdee, 0)} unit="kcal" size="rowValue" />} />
          <ListRow title="IMC" right={<Value value={formatNumber(targets.bmi, 1)} size="rowValue" />} />
        </ListGroup>
      ) : null}

      <Sheet visible={sheet === 'activity'} title="Actividad" onClose={() => setSheet(null)}>
        <View style={styles.sheetList}>
          <ListGroup>
            {ACTIVITY_LEVELS.map((level) => (
              <ListRow
                key={level.factor}
                title={activityLabel(level.factor)}
                right={sameFactor(level.factor, profile.activityFactor) ? <Icon name="check" size={22} color={colors.primary} /> : undefined}
                chevron={false}
                onPress={() => {
                  save({ activityFactor: level.factor });
                  setSheet(null);
                }}
              />
            ))}
          </ListGroup>
        </View>
      </Sheet>

      <GoalSheet
        open={sheet === 'goal'}
        deficitKcal={profile.deficitKcal}
        targets={targets}
        onChange={(deficitKcal) => save({ deficitKcal })}
        onClose={() => setSheet(null)}
      />

      <PerKgSheet
        kind={sheet === 'protein' || sheet === 'fat' || sheet === 'water' ? sheet : null}
        profile={profile}
        weightKg={weightKg}
        targets={targets}
        missing={missing}
        onChange={save}
        onClose={() => setSheet(null)}
      />
    </Screen>
  );
}

type PerKg = 'protein' | 'fat' | 'water';

const PER_KG: Record<
  PerKg,
  {
    title: string;
    limits: { min: number; max: number; step: number };
    /** The value as the stepper edits it: g/kg, or ml/kg for water. */
    read: (p: Profile) => number;
    write: (v: number) => Partial<Profile>;
    label: (v: number) => string;
    initial: number;
    /** What it gives a day with the current weight. */
    perDay: (v: number, weightKg: number) => { value: string; unit: string };
  }
> = {
  protein: {
    title: 'Proteína',
    limits: PER_KG_LIMITS.protein,
    read: (p) => p.proteinGPerKg,
    write: (v) => ({ proteinGPerKg: v }),
    label: gramsPerKgLabel,
    initial: DEFAULT_PER_KG.proteinGPerKg,
    perDay: (v, kg) => ({ value: formatNumber(v * kg, 0), unit: 'g' }),
  },
  fat: {
    title: 'Grasa',
    limits: PER_KG_LIMITS.fat,
    read: (p) => p.fatGPerKg,
    write: (v) => ({ fatGPerKg: v }),
    label: gramsPerKgLabel,
    initial: DEFAULT_PER_KG.fatGPerKg,
    perDay: (v, kg) => ({ value: formatNumber(v * kg, 0), unit: 'g' }),
  },
  water: {
    title: 'Agua',
    limits: PER_KG_LIMITS.water,
    read: (p) => waterMlPerKg(p.waterLPerKg),
    write: (v) => ({ waterLPerKg: waterLPerKg(v) }),
    label: mlPerKgLabel,
    initial: DEFAULT_PER_KG.waterMlPerKg,
    perDay: (v, kg) => ({ value: formatNumber((v * kg) / 1000, 1), unit: 'L' }),
  },
};

/**
 * Protein, fat or water per kg of body weight, with what it gives a day with your weight and what is
 * left for carbohydrates: changing it shows its effect at once. Saves at once.
 */
function PerKgSheet({
  kind,
  profile,
  weightKg,
  targets,
  missing,
  onChange,
  onClose,
}: {
  kind: PerKg | null;
  profile: Profile;
  weightKg: number | null;
  targets: NutritionTargets | null;
  missing: string | null;
  onChange: (patch: Partial<Profile>) => void;
  onClose: () => void;
}) {
  const spec = PER_KG[kind ?? 'protein'];
  const value = spec.read(profile);
  return (
    <Sheet visible={kind !== null} title={spec.title} onClose={onClose}>
      <NumberRow
        label="Por kilo de peso"
        value={value}
        onChange={(v) => onChange(spec.write(v))}
        step={spec.limits.step}
        min={spec.limits.min}
        max={spec.limits.max}
        format={spec.label}
      />
      {weightKg !== null ? (
        <StatRow>
          <Stat label={`Al día con ${formatNumber(weightKg)} kg`} {...spec.perDay(value, weightKg)} />
          {kind !== 'water' && targets ? <Stat label="Quedan para hidratos" value={formatNumber(targets.carbsG, 0)} unit="g" /> : null}
        </StatRow>
      ) : (
        <AppText variant="secondary">Registra tu peso en el Perfil para ver los gramos</AppText>
      )}
      {kind !== 'water' && targets && targets.kcalOver > 0 ? <NoCarbsRow targets={targets} /> : null}
      {kind !== 'water' && !targets && weightKg !== null && missing ? <AppText variant="caption">{`Para los hidratos: ${missing.charAt(0).toLowerCase()}${missing.slice(1)}`}</AppText> : null}
      <BackTo
        visible={Math.abs(value - spec.initial) > 1e-9}
        label={`Volver a ${spec.label(spec.initial)}`}
        onPress={() => onChange(spec.write(spec.initial))}
      />
      <Button size="lg" title="Listo" onPress={onClose} />
    </Sheet>
  );
}

/** Protein and fat alone pass the kcal of the day: the carbohydrate target is 0, not negative. */
function NoCarbsRow({ targets }: { targets: NutritionTargets }) {
  return (
    <ListGroup>
      <ListRow
        left={<RowIcon name="alert-outline" color={colors.warning} />}
        title="No quedan hidratos"
        // Two lines at most: the kcal must not be cut («…de tus 240…»).
        subtitle={
          <AppText variant="secondary" numberOfLines={2}>
            {`Proteína y grasa ya pasan de tus ${formatNumber(targets.targetKcal, 0)}${NBSP}kcal`}
          </AppText>
        }
      />
    </ListGroup>
  );
}

/** Calories and macros of the day, or what is still missing to work them out. */
function Targets({ targets, missing }: { targets: NutritionTargets | null; missing: string | null }) {
  if (!targets) {
    return (
      <ListGroup>
        <ListRow
          left={<RowIcon name="account-alert-outline" color={colors.warning} />}
          title="Completa tu perfil"
          subtitle={missing ?? undefined}
          onPress={() => router.navigate('/perfil')}
        />
      </ListGroup>
    );
  }
  const grams = (g: number) => formatNumber(g, 0);
  return (
    <Card flush>
      <View style={styles.kcal}>
        <AppText variant="label">Calorías objetivo</AppText>
        <Value value={formatNumber(targets.targetKcal, 0)} unit="kcal" size="numberL" />
      </View>
      <Divider />
      <StatRow>
        <Stat label="Proteína" value={grams(targets.proteinG)} unit="g" />
        <Stat label="Grasa" value={grams(targets.fatG)} unit="g" />
      </StatRow>
      <Divider />
      <StatRow>
        <Stat label="Hidratos" value={grams(targets.carbsG)} unit="g" />
        <Stat label="Agua" value={formatNumber(targets.waterL, 1)} unit="L" />
      </StatRow>
    </Card>
  );
}

/** Lose, keep or gain, and by how much a day: stored as a signed deficit. */
function GoalSheet({
  open,
  deficitKcal,
  targets,
  onChange,
  onClose,
}: {
  open: boolean;
  deficitKcal: number;
  targets: NutritionTargets | null;
  onChange: (deficitKcal: number) => void;
  onClose: () => void;
}) {
  const { goal, kcal } = goalOf(deficitKcal);
  // Remembers the amount while «Mantener» is chosen, so going back restores it.
  const [amount, setAmount] = useState(kcal || DEFAULT_GOAL_KCAL);
  const [chosen, setChosen] = useState<Goal>(goal);

  const choose = (next: Goal) => {
    setChosen(next);
    onChange(deficitFor(next, amount));
  };
  const changeAmount = (next: number) => {
    setAmount(next);
    onChange(deficitFor(chosen, next));
  };

  return (
    <Sheet visible={open} title="Objetivo" onClose={onClose}>
      <Segmented<Goal>
        options={(['lose', 'keep', 'gain'] as const).map((g) => ({ value: g, label: GOAL_NAMES[g] }))}
        value={chosen}
        onChange={choose}
      />
      {chosen !== 'keep' ? (
        <NumberRow label="kcal al día" value={amount} onChange={changeAmount} step={50} min={50} max={1500} />
      ) : null}
      {targets && targets.kcalOver > 0 ? <NoCarbsRow targets={targets} /> : null}
      <Button size="lg" title="Listo" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  kcal: { padding: spacing.lg, gap: spacing.xs },
  sheetList: { marginHorizontal: -spacing.lg },
});
