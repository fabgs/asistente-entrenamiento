import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { showSnackbar } from '@/components/Dialog';
import { LineChart } from '@/components/LineChart';
import { MuscleWeekSection } from '@/components/MuscleWeek';
import { WeightSheet } from '@/components/WeightSheet';
import {
  AppText,
  Button,
  Card,
  TabHeaderButton,
  ListGroup,
  ListRow,
  Loading,
  NumberRow,
  RowIcon,
  Screen,
  Section,
  Segmented,
  Value,
} from '@/components/ui';
import { loadMuscleWeek, type MuscleWeekData } from '@/db/repositories/muscles';
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
import { formatWeightDelta, goalLabel, missingForTargets } from '@/domain/bodyProfile';
import { formatDateWithYear, formatNumber, formatShortDate, NBSP } from '@/domain/format';
import { ageOn, type Sex } from '@/domain/nutrition';
import { localDateString, pickerStartDate, today as todayDate } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

/** The rest are in their own screen (`pesos.tsx`), which loads them as it scrolls. */
const RECENT_WEIGHTS = 3;
const FIRST_WEIGHT_KG = 70;
const FIRST_HEIGHT_CM = 170;

/**
 * Your body (PLAN.md §4): the muscles of the week, the weight and the data the targets come from.
 * The targets themselves, with the goal and the activity, are in `objetivos.tsx`.
 */
export default function ProfileScreen() {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <TabHeaderButton icon="cog-outline" label="Ajustes" onPress={() => router.push('/ajustes')} />,
    });
  }, [navigation]);

  const { data, reload } = useLoader(async (db) => {
    const today = localDateString(new Date());
    return {
      today,
      profile: await getProfile(db),
      weights: await listWeights(db),
      muscles: await loadMuscleWeek(db, today),
    };
  });

  if (!data) return <Loading />;
  // Remounts when the profile changed elsewhere (a restored copy, the targets screen), not on every edit made here.
  return (
    <ProfileBody
      key={JSON.stringify(data.profile)}
      initial={data.profile}
      weights={data.weights}
      muscles={data.muscles}
      today={data.today}
      onWeightsChanged={reload}
    />
  );
}

function ProfileBody({
  initial,
  weights,
  muscles,
  today,
  onWeightsChanged,
}: {
  initial: Profile;
  /** Newest first. */
  weights: WeightEntry[];
  muscles: MuscleWeekData;
  today: string;
  onWeightsChanged: () => Promise<void>;
}) {
  const db = useDb();
  const [profile, setProfile] = useState(initial);
  const [sheet, setSheet] = useState<{ entry: WeightEntry | null } | null>(null);
  const weight = weights[0]?.weightKg ?? null;
  const targets = nutritionTargetsOf(profile, weight, today);
  const missing = missingForTargets({ ...profile, weightKg: weight });

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
      {missing ? (
        <ListGroup>
          <ListRow left={<RowIcon name="account-alert-outline" color={colors.warning} />} title="Completa tu perfil" subtitle={missing} />
        </ListGroup>
      ) : null}

      <MuscleWeekSection week={muscles} sex={profile.sex} />

      <Section label="Peso corporal">
        <Button kind="secondary" icon="plus" title="Registrar peso" onPress={() => setSheet({ entry: null })} />
        <WeightHistory weights={weights} onOpen={(entry) => setSheet({ entry })} />
      </Section>

      <ListGroup>
        <ListRow
          title="Objetivos del día"
          subtitle={goalLabel(profile.deficitKcal)}
          right={targets ? <Value value={formatNumber(targets.targetKcal, 0)} unit="kcal" size="rowValue" /> : undefined}
          onPress={() => router.push('/objetivos')}
        />
      </ListGroup>

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
        </ListGroup>
      </Section>

      <WeightSheet
        open={sheet !== null}
        entry={sheet?.entry ?? null}
        start={sheet?.entry?.weightKg ?? weight ?? FIRST_WEIGHT_KG}
        canDelete={weights.length > 1}
        onClose={() => setSheet(null)}
        onSave={(kg) => saveWeight(sheet?.entry ? sheet.entry.date : today, kg)}
        onDelete={removeWeight}
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

function WeightHistory({ weights, onOpen }: { weights: WeightEntry[]; onOpen: (entry: WeightEntry) => void }) {
  if (weights.length === 0) return null;
  const oldest = weights[weights.length - 1];

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
        {weights.slice(0, RECENT_WEIGHTS).map((w) => (
          <ListRow
            key={w.date}
            title={formatDateWithYear(w.date)}
            right={<Value value={formatNumber(w.weightKg)} unit="kg" size="rowValue" />}
            onPress={() => onOpen(w)}
          />
        ))}
        {weights.length > RECENT_WEIGHTS ? (
          <ListRow title="Todos los pesajes" right={String(weights.length)} onPress={() => router.push('/pesos')} />
        ) : null}
      </ListGroup>
    </>
  );
}

const styles = StyleSheet.create({
  inlineRow: { paddingHorizontal: spacing.lg },
  segmentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  sex: { width: 200 },
});
