import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { showSnackbar } from '@/components/Dialog';
import { LineChart } from '@/components/LineChart';
import { Sheet } from '@/components/Sheet';
import {
  AppText,
  Button,
  Card,
  Divider,
  TabHeaderButton,
  Icon,
  ListGroup,
  ListRow,
  Loading,
  NumberRow,
  RowIcon,
  Screen,
  Section,
  Segmented,
  Stat,
  StatRow,
  Stepper,
  Value,
} from '@/components/ui';
import {
  deleteWeight,
  getProfile,
  listWeights,
  logWeight,
  nutritionTargetsOf,
  updateProfile,
  type Profile,
  type WeightEntry,
} from '@/db/repositories/settings';
import {
  ACTIVITY_LEVELS,
  activityLabel,
  deficitFor,
  formatWeightDelta,
  GOAL_NAMES,
  goalLabel,
  goalOf,
  missingForTargets,
  sameFactor,
  type Goal,
} from '@/domain/bodyProfile';
import { formatDateWithYear, formatNumber, formatShortDate, NBSP } from '@/domain/format';
import { ageOn, type NutritionTargets, type Sex } from '@/domain/nutrition';
import { localDateString, pickerStartDate, today as todayDate } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

const RECENT_WEIGHTS = 10;
const FIRST_WEIGHT_KG = 70;
const FIRST_HEIGHT_CM = 170;
const DEFAULT_GOAL_KCAL = 400;

export default function ProfileScreen() {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <TabHeaderButton icon="cog-outline" label="Ajustes" onPress={() => router.push('/ajustes')} />,
    });
  }, [navigation]);

  const { data, reload } = useLoader(async (db) => ({
    today: localDateString(new Date()),
    profile: await getProfile(db),
    weights: await listWeights(db),
  }));

  if (!data) return <Loading />;
  // Remounts when the profile changed elsewhere (a restored copy), not on every edit made here.
  return (
    <ProfileBody
      key={JSON.stringify(data.profile)}
      initial={data.profile}
      weights={data.weights}
      today={data.today}
      onWeightsChanged={reload}
    />
  );
}

type SheetState = { kind: 'weight'; entry: WeightEntry | null } | { kind: 'activity' } | { kind: 'goal' } | null;

function ProfileBody({
  initial,
  weights,
  today,
  onWeightsChanged,
}: {
  initial: Profile;
  /** Newest first. */
  weights: WeightEntry[];
  today: string;
  onWeightsChanged: () => Promise<void>;
}) {
  const db = useDb();
  const [profile, setProfile] = useState(initial);
  const [sheet, setSheet] = useState<SheetState>(null);
  const weight = weights[0]?.weightKg ?? null;
  const targets = nutritionTargetsOf(profile, weight, today);

  const save = (patch: Partial<Profile>) => {
    setProfile((p) => ({ ...p, ...patch }));
    void updateProfile(db, patch);
  };

  const saveWeight = async (date: string, kg: number) => {
    setSheet(null);
    await logWeight(db, date, kg);
    await onWeightsChanged();
  };

  const removeWeight = async (entry: WeightEntry) => {
    setSheet(null);
    if (!(await deleteWeight(db, entry.date))) return;
    await onWeightsChanged();
    showSnackbar('Pesaje borrado', {
      label: 'Deshacer',
      onPress: async () => {
        await logWeight(db, entry.date, entry.weightKg);
        await onWeightsChanged();
      },
    });
  };

  return (
    <Screen>
      <Section label="Objetivos del día">
        <Targets targets={targets} missing={missingForTargets({ ...profile, weightKg: weight })} />
      </Section>

      <Section label="Peso corporal">
        <Button kind="secondary" icon="plus" title="Registrar peso" onPress={() => setSheet({ kind: 'weight', entry: null })} />
        <WeightHistory weights={weights} onOpen={(entry) => setSheet({ kind: 'weight', entry })} />
      </Section>

      <Section label="Mis datos">
        <ListGroup>
          <ListRow
            title="Fecha de nacimiento"
            subtitle={profile.birthDate ? `${ageOn(profile.birthDate, today)} años` : undefined}
            right={<RowValue text={profile.birthDate ? shortDateWithYear(profile.birthDate) : null} />}
            onPress={() => pickBirthDate(profile.birthDate, (birthDate) => save({ birthDate }))}
          />
          <View style={styles.inlineRow}>
            <NumberRow
              label="Altura"
              value={profile.heightCm ?? FIRST_HEIGHT_CM}
              onChange={(cm) => save({ heightCm: profile.heightCm === null ? FIRST_HEIGHT_CM : cm })}
              min={100}
              max={230}
              format={(cm) => (profile.heightCm === null ? '–' : `${formatNumber(cm)}${NBSP}cm`)}
            />
          </View>
          <View style={[styles.inlineRow, styles.segmentRow]}>
            <AppText variant="rowTitle" style={{ flex: 1 }}>
              Sexo
            </AppText>
            <Segmented<Sex>
              style={styles.sex}
              options={[
                { value: 'male', label: 'Hombre' },
                { value: 'female', label: 'Mujer' },
              ]}
              value={profile.sex}
              onChange={(sex) => save({ sex })}
            />
          </View>
          <ListRow
            title="Actividad"
            right={<RowValue text={activityLabel(profile.activityFactor)} />}
            onPress={() => setSheet({ kind: 'activity' })}
          />
          <ListRow
            title="Objetivo"
            right={<RowValue text={goalLabel(profile.deficitKcal)} />}
            onPress={() => setSheet({ kind: 'goal' })}
          />
        </ListGroup>
      </Section>

      <WeightSheet
        open={sheet?.kind === 'weight'}
        entry={sheet?.kind === 'weight' ? sheet.entry : null}
        start={sheet?.kind === 'weight' ? (sheet.entry?.weightKg ?? weight ?? FIRST_WEIGHT_KG) : FIRST_WEIGHT_KG}
        canDelete={weights.length > 1}
        onClose={() => setSheet(null)}
        onSave={(kg) => saveWeight(sheet?.kind === 'weight' && sheet.entry ? sheet.entry.date : today, kg)}
        onDelete={removeWeight}
      />

      <Sheet visible={sheet?.kind === 'activity'} title="Actividad" onClose={() => setSheet(null)}>
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
        open={sheet?.kind === 'goal'}
        deficitKcal={profile.deficitKcal}
        onChange={(deficitKcal) => save({ deficitKcal })}
        onClose={() => setSheet(null)}
      />
    </Screen>
  );
}

/** Value of a row, or «Elegir» while it is missing. */
function RowValue({ text }: { text: string | null }) {
  return text ? (
    <AppText variant="rowValue" tabular>
      {text}
    </AppText>
  ) : (
    <AppText variant="secondary">Elegir</AppText>
  );
}

/** "25 jun 1995" */
const shortDateWithYear = (iso: string) => `${formatShortDate(iso)} ${iso.slice(0, 4)}`;

/** The system calendar, as DateField opens it, but from a row. */
function pickBirthDate(value: string | null, onChange: (iso: string) => void) {
  DateTimePickerAndroid.open({
    value: pickerStartDate(value, 25),
    mode: 'date',
    maximumDate: todayDate(),
    onChange: (event, date) => {
      if (event.type === 'set' && date) onChange(localDateString(date));
    },
  });
}

function Targets({ targets, missing }: { targets: NutritionTargets | null; missing: string | null }) {
  if (!targets) {
    return (
      <ListGroup>
        <ListRow
          left={<RowIcon name="account-alert-outline" color={colors.warning} />}
          title="Completa tu perfil"
          subtitle={missing ?? undefined}
        />
      </ListGroup>
    );
  }
  const grams = (g: number) => formatNumber(g, 0);
  return (
    <>
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
      <ListGroup>
        <ListRow title="Metabolismo basal" right={<Value value={formatNumber(targets.bmr, 0)} unit="kcal" size="rowValue" />} />
        <ListRow title="Gasto total" right={<Value value={formatNumber(targets.tdee, 0)} unit="kcal" size="rowValue" />} />
        <ListRow title="IMC" right={<Value value={formatNumber(targets.bmi, 1)} size="rowValue" />} />
      </ListGroup>
    </>
  );
}

function WeightHistory({ weights, onOpen }: { weights: WeightEntry[]; onOpen: (entry: WeightEntry) => void }) {
  const [showAll, setShowAll] = useState(false);
  if (weights.length === 0) return null;
  const oldest = weights[weights.length - 1];
  const visible = showAll ? weights : weights.slice(0, RECENT_WEIGHTS);

  return (
    <>
      {weights.length > 1 ? (
        <Card>
          <LineChart
            title="Evolución"
            points={[...weights].reverse().map((w) => ({ label: formatShortDate(w.date), value: w.weightKg }))}
            format={(v) => `${formatNumber(v)} kg`}
            tickFormat={(v) => formatNumber(v, 1)}
          />
          <AppText variant="caption">
            {formatWeightDelta(weights[0].weightKg - oldest.weightKg)} desde el {formatDateWithYear(oldest.date)}
          </AppText>
        </Card>
      ) : null}
      <ListGroup>
        {visible.map((w) => (
          <ListRow
            key={w.date}
            title={formatDateWithYear(w.date)}
            right={<Value value={formatNumber(w.weightKg)} unit="kg" size="rowValue" />}
            onPress={() => onOpen(w)}
          />
        ))}
        {weights.length > RECENT_WEIGHTS ? (
          <ListRow
            title={showAll ? 'Ver menos' : `Ver los ${weights.length} pesajes`}
            right={<Icon name={showAll ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />}
            onPress={() => setShowAll(!showAll)}
            chevron={false}
          />
        ) : null}
      </ListGroup>
    </>
  );
}

/**
 * Today's weight (`entry` null) or a past weigh-in: a stepper of 0,1 kg that starts at `start`.
 * A weigh-in can be deleted unless it is the only one (the targets need a weight).
 */
function WeightSheet({
  open,
  entry,
  start,
  canDelete,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  entry: WeightEntry | null;
  start: number;
  canDelete: boolean;
  onClose: () => void;
  onSave: (kg: number) => void;
  onDelete: (entry: WeightEntry) => void;
}) {
  return (
    <Sheet
      visible={open}
      title={entry ? formatDateWithYear(entry.date) : 'Registrar peso'}
      onClose={onClose}
      action={
        entry && canDelete ? (
          <Button kind="danger" icon="trash-can-outline" title="Borrar" onPress={() => onDelete(entry)} />
        ) : null
      }>
      {/* Keyed so that every opening starts again from the last weight. */}
      {open ? <WeightPicker key={entry?.date ?? 'new'} start={start} onSave={onSave} /> : null}
    </Sheet>
  );
}

function WeightPicker({ start, onSave }: { start: number; onSave: (kg: number) => void }) {
  const [kg, setKg] = useState(start);
  return (
    <>
      <AppText variant="label" style={{ textAlign: 'center' }}>
        Peso en kg
      </AppText>
      <Stepper big decimal typing={false} value={kg} onChange={setKg} step={0.1} min={20} format={(v) => formatNumber(v, 1)} />
      <Button size="lg" title="Guardar" disabled={kg <= 0} onPress={() => onSave(kg)} />
    </>
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
  inlineRow: { paddingHorizontal: spacing.lg },
  segmentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  sex: { width: 200 },
  sheetList: { marginHorizontal: -spacing.lg },
});
