import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
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
  deficitFor,
  GOAL_NAMES,
  goalLabel,
  goalOf,
  missingForTargets,
  sameFactor,
  type Goal,
} from '@/domain/bodyProfile';
import { formatNumber } from '@/domain/format';
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
  const [sheet, setSheet] = useState<'activity' | 'goal' | null>(null);
  const targets = nutritionTargetsOf(profile, weightKg, today);

  const save = (patch: Partial<Profile>) => {
    setProfile((p) => ({ ...p, ...patch }));
    void updateProfile(db, patch);
  };

  return (
    <Screen>
      <Targets targets={targets} missing={missingForTargets({ ...profile, weightKg })} />

      <ListGroup>
        <ListRow title="Objetivo" right={goalLabel(profile.deficitKcal)} onPress={() => setSheet('goal')} />
        <ListRow title="Actividad" right={activityLabel(profile.activityFactor)} onPress={() => setSheet('activity')} />
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
        onChange={(deficitKcal) => save({ deficitKcal })}
        onClose={() => setSheet(null)}
      />
    </Screen>
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
  onChange,
  onClose,
}: {
  open: boolean;
  deficitKcal: number;
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
      <Button size="lg" title="Listo" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  kcal: { padding: spacing.lg, gap: spacing.xs },
  sheetList: { marginHorizontal: -spacing.lg },
});
