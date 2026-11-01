import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RecommendationBox } from '@/components/Recommendation';
import { AppText, Button, Card, Loading, Screen, Stepper } from '@/components/ui';
import { getRoutine, getSlot, isBodyweight, type Slot } from '@/db/repositories/routines';
import { slotHistory } from '@/db/repositories/sessions';
import { getSettings } from '@/db/repositories/settings';
import { listPendingChanges, setSlotWeightManually } from '@/db/repositories/weightChanges';
import { formatKg, formatLoad, formatTarget } from '@/domain/format';
import { useDb, useLoader } from '@/hooks/data';

export default function SlotWeightScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const slotId = Number(id);

  const { data, reload } = useLoader(async (db) => {
    const slot = await getSlot(db, slotId);
    if (!slot) return null;
    return {
      slot,
      routine: await getRoutine(db, slot.routineId),
      increment: slot.incrementKg ?? slot.exerciseIncrementKg ?? (await getSettings(db)).defaultIncrementKg,
      change: (await listPendingChanges(db)).find((c) => c.slotId === slotId),
      history: await slotHistory(db, slotId, 5),
    };
  });

  if (data === undefined) return <Loading />;
  if (data === null) {
    return (
      <Screen>
        <AppText>No se encontró el ejercicio.</AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="title">{data.slot.exerciseName}</AppText>
      <AppText variant="muted">
        {data.routine?.name} · {data.slot.sets} × {formatTarget(data.slot.target, data.slot.unit, data.slot.perSide)}
      </AppText>
      {data.change ? <RecommendationBox title="Recomendación pendiente" change={data.change} onChanged={reload} /> : null}
      <WeightEditor key={`${data.slot.weightKg}`} slot={data.slot} increment={data.increment} />
      {data.history.length > 0 ? (
        <Card>
          <AppText variant="heading">Últimas sesiones</AppText>
          {data.history.map((h) => (
            <AppText key={h.sessionId} variant="muted">
              {formatLoad(h.weightKg, isBodyweight(data.slot))} · {h.reps.join(' · ')}
            </AppText>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function WeightEditor({ slot, increment }: { slot: Slot; increment: number }) {
  const db = useDb();
  const [weight, setWeight] = useState(slot.weightKg ?? 0);
  const bodyweight = isBodyweight(slot);
  const unchanged = weight === (slot.weightKg ?? 0);

  const save = async () => {
    await setSlotWeightManually(db, slot.id, bodyweight && weight === 0 ? null : weight);
    router.back();
  };

  return (
    <Card>
      <AppText variant="heading">{bodyweight ? 'Lastre' : 'Peso'}</AppText>
      <AppText variant="small">Actual: {formatLoad(slot.weightKg, bodyweight)}</AppText>
      <Stepper big value={weight} onChange={setWeight} step={increment} format={formatKg} />
      <Button big title="Guardar peso" onPress={save} disabled={unchanged} />
    </Card>
  );
}
