import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, Chip, DateField, Loading, Row, Screen, TextField } from '@/components/ui';
import {
  getProfile,
  latestWeight,
  listWeights,
  loadNutritionTargets,
  logWeight,
  updateProfile,
  type Profile,
} from '@/db/repositories/settings';
import { formatNumber } from '@/domain/format';
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

      {data.weights.length > 0 ? (
        <Card>
          <AppText variant="heading">Registro de peso</AppText>
          {data.weights.slice(0, 10).map((w) => (
            <Line key={w.date} label={w.date} value={`${formatNumber(w.weightKg)} kg`} />
          ))}
        </Card>
      ) : null}

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

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <AppText variant={strong ? 'body' : 'muted'}>{label}</AppText>
      <AppText style={strong ? { color: colors.primary, fontWeight: '800' } : undefined}>{value}</AppText>
    </Row>
  );
}
