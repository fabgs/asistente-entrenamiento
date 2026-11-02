import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { showDialog } from '@/components/Dialog';
import { LineChart } from '@/components/LineChart';
import { AppText, Button, Card, Chip, DateField, Loading, Row, Screen, TextField } from '@/components/ui';
import {
  deleteWeight,
  getProfile,
  latestWeight,
  listWeights,
  loadNutritionTargets,
  logWeight,
  updateProfile,
  type Profile,
  type WeightEntry,
} from '@/db/repositories/settings';
import { formatDateWithYear, formatNumber, formatShortDate } from '@/domain/format';
import { ageOn } from '@/domain/nutrition';
import { localDateString } from '@/domain/schedule';
import { useDb, useLoader } from '@/hooks/data';
import { colors } from '@/theme';

const ACTIVITY_FACTORS = [1.2, 1.375, 1.5, 1.55, 1.725];
const parseNumber = (text: string) => Number(text.replace(',', '.'));

export default function ProfileScreen() {
  const { data, reload } = useLoader(async (db) => {
    const today = localDateString(new Date());
    return {
      today,
      profile: await getProfile(db),
      weight: await latestWeight(db),
      weights: await listWeights(db),
      targets: await loadNutritionTargets(db, today),
    };
  });

  if (!data) return <Loading />;
  const t = data.targets;

  return (
    <Screen>
      <ProfileForm key={JSON.stringify(data.profile) + data.weight} profile={data.profile} weight={data.weight} onSaved={reload} />

      <Card>
        <AppText variant="heading">Objetivos diarios</AppText>
        {t ? (
          <>
            {data.profile.birthDate ? <Line label="Edad" value={`${ageOn(data.profile.birthDate, data.today)} años`} /> : null}
            <Line label="Metabolismo basal (TMB)" value={`${formatNumber(t.bmr, 0)} kcal`} />
            <Line label="Gasto total" value={`${formatNumber(t.tdee, 0)} kcal`} />
            <Line label="Calorías objetivo" value={`${formatNumber(t.targetKcal, 0)} kcal`} strong />
            <Line label="Proteína" value={`${formatNumber(t.proteinG, 0)} g`} />
            <Line label="Grasa" value={`${formatNumber(t.fatG, 0)} g`} />
            <Line label="Carbohidratos" value={`${formatNumber(t.carbsG, 0)} g`} />
            <Line label="Agua" value={`${formatNumber(t.waterL, 1)} L`} />
            <Line label="IMC" value={formatNumber(t.bmi, 1)} />
          </>
        ) : (
          <AppText variant="muted">Rellena fecha de nacimiento, altura y peso para ver los cálculos.</AppText>
        )}
      </Card>

      {data.weights.length > 0 ? <WeightCard weights={data.weights} onChanged={reload} /> : null}

      <Button kind="secondary" title="Ajustes y notificaciones" onPress={() => router.push('/ajustes')} />
    </Screen>
  );
}

function ProfileForm({ profile, weight, onSaved }: { profile: Profile; weight: number | null; onSaved: () => void }) {
  const db = useDb();
  const [birthDate, setBirthDate] = useState(profile.birthDate);
  const [height, setHeight] = useState(profile.heightCm ? String(profile.heightCm) : '');
  const [weightText, setWeightText] = useState(weight ? formatNumber(weight) : '');
  const [deficit, setDeficit] = useState(String(profile.deficitKcal));
  const [sex, setSex] = useState(profile.sex);
  const [factor, setFactor] = useState(profile.activityFactor);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const heightCm = parseNumber(height);
    const weightKg = parseNumber(weightText);
    const deficitKcal = parseNumber(deficit);
    if (!(heightCm > 0) || !(weightKg > 0) || Number.isNaN(deficitKcal)) return setError('Revisa altura, peso y déficit');
    setError(null);
    await updateProfile(db, { birthDate, heightCm, sex, activityFactor: factor, deficitKcal });
    if (weightKg !== weight) await logWeight(db, localDateString(new Date()), weightKg);
    onSaved();
  };

  return (
    <Card>
      <AppText variant="heading">Mis datos</AppText>
      <DateField label="Fecha de nacimiento" value={birthDate} onChange={setBirthDate} yearsAgo={25} />
      <Row>
        <View style={{ flex: 1 }}>
          <TextField keyboard="decimal" label="Altura (cm)" value={height} onChangeText={setHeight} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField keyboard="decimal" label="Peso hoy (kg)" value={weightText} onChangeText={setWeightText} />
        </View>
      </Row>
      <TextField keyboard="decimal" label="Déficit (kcal, negativo = superávit)" value={deficit} onChangeText={setDeficit} />
      <AppText variant="small">Sexo</AppText>
      <Row>
        <Chip label="Hombre" selected={sex === 'male'} onPress={() => setSex('male')} />
        <Chip label="Mujer" selected={sex === 'female'} onPress={() => setSex('female')} />
      </Row>
      <AppText variant="small">Factor de actividad</AppText>
      <Row>
        {ACTIVITY_FACTORS.map((f) => (
          <Chip key={f} label={formatNumber(f, 3)} selected={factor === f} onPress={() => setFactor(f)} />
        ))}
      </Row>
      {error ? <AppText style={{ color: colors.danger }}>{error}</AppText> : null}
      <Button title="Guardar" onPress={save} />
    </Card>
  );
}

const RECENT_WEIGHTS = 10;

/** `weights` comes newest first. */
function WeightCard({ weights, onChanged }: { weights: WeightEntry[]; onChanged: () => void }) {
  const db = useDb();
  const [showAll, setShowAll] = useState(false);
  const oldest = weights[weights.length - 1];
  const change = weights[0].weightKg - oldest.weightKg;
  const visible = showAll ? weights : weights.slice(0, RECENT_WEIGHTS);

  const remove = (w: WeightEntry) =>
    showDialog('Borrar pesaje', `${formatNumber(w.weightKg)} kg del ${formatDateWithYear(w.date)}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await deleteWeight(db, w.date);
          onChanged();
        },
      },
    ]);

  return (
    <Card>
      <AppText variant="heading">Peso corporal</AppText>
      {weights.length > 1 ? (
        <>
          <LineChart
            title="Evolución"
            points={[...weights].reverse().map((w) => ({ label: formatShortDate(w.date), value: w.weightKg }))}
            format={(v) => `${formatNumber(v)} kg`}
          />
          <AppText variant="muted">
            {change > 0 ? '+' : ''}
            {formatNumber(change)} kg desde el {formatDateWithYear(oldest.date)}
          </AppText>
        </>
      ) : null}
      {visible.map((w) =>
        weights.length > 1 ? (
          <Pressable key={w.date} onLongPress={() => remove(w)} accessibilityHint="Mantén pulsado para borrarlo">
            <Line label={formatDateWithYear(w.date)} value={`${formatNumber(w.weightKg)} kg`} />
          </Pressable>
        ) : (
          <Line key={w.date} label={formatDateWithYear(w.date)} value={`${formatNumber(w.weightKg)} kg`} />
        ),
      )}
      {weights.length > RECENT_WEIGHTS ? (
        <Button kind="ghost" title={showAll ? 'Ver menos' : `Ver los ${weights.length}`} onPress={() => setShowAll(!showAll)} />
      ) : null}
      <AppText variant="small">
        Se registra al guardar «Peso hoy».{weights.length > 1 ? ' Mantén pulsado un pesaje para borrarlo.' : ''}
      </AppText>
    </Card>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <Row between>
      <AppText variant={strong ? 'body' : 'muted'} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText style={strong ? { color: colors.primary, fontWeight: '800' } : undefined}>{value}</AppText>
    </Row>
  );
}
