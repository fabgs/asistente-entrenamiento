import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { RecommendationBox } from '@/components/Recommendation';
import {
  AppText,
  Button,
  Card,
  Chip,
  Divider,
  Loading,
  Row,
  Screen,
  Stepper,
  SwitchRow,
  TextField,
} from '@/components/ui';
import {
  archiveSlot,
  getRoutine,
  getSlot,
  isBodyweight,
  updateSlotPrescription,
  type Slot,
} from '@/db/repositories/routines';
import { slotHistory } from '@/db/repositories/sessions';
import { getSettings } from '@/db/repositories/settings';
import { listOpenChanges, setSlotWeightManually } from '@/db/repositories/weightChanges';
import { formatCountdown, formatKg, formatLoad, formatTarget, parseDuration } from '@/domain/format';
import type { ProgressionKind, RepTarget, RepUnit } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { rescheduleDailyReminders } from '@/services/dailyReminder';
import { colors } from '@/theme';

export default function SlotEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const slotId = Number(id);
  const db = useDb();

  const { data, reload } = useLoader(async (db) => {
    const slot = await getSlot(db, slotId);
    if (!slot) return null;
    const settings = await getSettings(db);
    return {
      slot,
      routine: await getRoutine(db, slot.routineId),
      defaultIncrement: slot.exerciseIncrementKg ?? settings.defaultIncrementKg,
      defaultRest: settings.restSecondsDefault,
      change: (await listOpenChanges(db)).find((c) => c.slotId === slotId),
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

  const { slot } = data;

  const remove = () =>
    Alert.alert('Quitar ejercicio', `«${slot.exerciseName}» se quitará de la rutina. Su historial se conserva.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: async () => {
          await archiveSlot(db, slot.id);
          await rescheduleDailyReminders(db);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <AppText variant="title">{slot.exerciseName}</AppText>
      <AppText variant="muted">
        {data.routine?.name} · {slot.sets} × {formatTarget(slot.target, slot.unit, slot.perSide)}
      </AppText>
      {data.change ? <RecommendationBox title="Recomendación de peso" change={data.change} onChanged={reload} /> : null}
      <WeightEditor
        key={`${slot.weightKg}`}
        slot={slot}
        increment={slot.incrementKg ?? data.defaultIncrement}
        onSaved={reload}
      />
      <PrescriptionForm
        key={slot.id}
        slot={slot}
        defaultIncrement={data.defaultIncrement}
        defaultRest={data.defaultRest}
        onSaved={reload}
      />
      {data.history.length > 0 ? (
        <Card>
          <AppText variant="heading">Últimas sesiones</AppText>
          {data.history.map((h) => (
            <AppText key={h.sessionId} variant="muted">
              {formatLoad(h.weightKg, isBodyweight(slot))} · {h.reps.join(' · ')}
            </AppText>
          ))}
        </Card>
      ) : null}
      <Button kind="danger" title="Quitar de la rutina" onPress={remove} />
    </Screen>
  );
}

function WeightEditor({ slot, increment, onSaved }: { slot: Slot; increment: number; onSaved: () => void }) {
  const db = useDb();
  const [weight, setWeight] = useState(slot.weightKg ?? 0);
  const bodyweight = isBodyweight(slot);
  const unchanged = weight === (slot.weightKg ?? 0);

  const save = async () => {
    await setSlotWeightManually(db, slot.id, bodyweight && weight === 0 ? null : weight);
    onSaved();
  };

  return (
    <Card>
      <AppText variant="heading">{bodyweight ? 'Lastre' : 'Peso'}</AppText>
      <AppText variant="small">Actual: {formatLoad(slot.weightKg, bodyweight)}</AppText>
      <Stepper big decimal value={weight} onChange={setWeight} step={increment} format={formatKg} />
      <Button big title="Guardar peso" onPress={save} disabled={unchanged} />
    </Card>
  );
}

const TARGET_KINDS: { key: RepTarget['kind']; label: string }[] = [
  { key: 'range', label: 'Rango' },
  { key: 'fixed', label: 'Fijo' },
  { key: 'failure', label: 'Al fallo' },
];
const UNITS: { key: RepUnit; label: string }[] = [
  { key: 'reps', label: 'Reps' },
  { key: 'steps', label: 'Pasos' },
  { key: 'seconds', label: 'Segundos' },
];
const PROGRESSIONS: { key: ProgressionKind; label: string }[] = [
  { key: 'load', label: 'Automática' },
  { key: 'manual', label: 'Manual' },
];

function PrescriptionForm({
  slot,
  defaultIncrement,
  defaultRest,
  onSaved,
}: {
  slot: Slot;
  defaultIncrement: number;
  defaultRest: number;
  onSaved: () => void;
}) {
  const db = useDb();
  const t = slot.target;
  const [sets, setSets] = useState(slot.sets);
  const [kind, setKind] = useState(t.kind);
  const [min, setMin] = useState(t.kind === 'range' ? t.min : 8);
  const [max, setMax] = useState(t.kind === 'range' ? t.max : 12);
  const [fixed, setFixed] = useState(t.kind === 'fixed' ? t.reps : 10);
  const [minus, setMinus] = useState(t.kind === 'failure' ? t.minus : 0);
  const [perSide, setPerSide] = useState(slot.perSide);
  const [unit, setUnit] = useState(slot.unit);
  const [progression, setProgression] = useState(slot.progression);
  const [allowDecrease, setAllowDecrease] = useState(slot.allowDecrease);
  const [ownIncrement, setOwnIncrement] = useState(slot.incrementKg !== null);
  const [increment, setIncrement] = useState(slot.incrementKg ?? defaultIncrement);
  const [ownRest, setOwnRest] = useState(slot.restSeconds !== null);
  const [rest, setRest] = useState(slot.restSeconds ?? defaultRest);
  const [note, setNote] = useState(slot.note ?? '');
  const [saved, setSaved] = useState(false);

  const target: RepTarget =
    kind === 'range'
      ? { kind, min: Math.min(min, max), max: Math.max(min, max) }
      : kind === 'fixed'
        ? { kind, reps: fixed }
        : { kind, minus };

  const touch =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setSaved(false);
      setter(value);
    };

  const save = async () => {
    await updateSlotPrescription(db, slot.id, {
      sets,
      target,
      perSide,
      unit,
      progression,
      allowDecrease,
      incrementKg: ownIncrement ? increment : null,
      restSeconds: ownRest ? rest : null,
      note: note.trim() || null,
    });
    await rescheduleDailyReminders(db);
    setSaved(true);
    onSaved();
  };

  return (
    <Card>
      <AppText variant="heading">Series y repeticiones</AppText>
      <AppText variant="small">Series</AppText>
      <Stepper value={sets} onChange={touch(setSets)} min={1} />

      <AppText variant="small">Objetivo</AppText>
      <Row>
        {TARGET_KINDS.map((k) => (
          <Chip key={k.key} label={k.label} selected={kind === k.key} onPress={() => touch(setKind)(k.key)} />
        ))}
      </Row>
      {kind === 'range' ? (
        <>
          <AppText variant="small">Mínimo</AppText>
          <Stepper value={min} onChange={touch(setMin)} min={1} />
          <AppText variant="small">Máximo</AppText>
          <Stepper value={max} onChange={touch(setMax)} min={1} />
        </>
      ) : kind === 'fixed' ? (
        <>
          <AppText variant="small">Repeticiones</AppText>
          <Stepper value={fixed} onChange={touch(setFixed)} min={1} />
        </>
      ) : (
        <Row>
          {[0, 1, 2].map((m) => (
            <Chip
              key={m}
              label={m === 0 ? 'Al fallo' : `Fallo −${m}`}
              selected={minus === m}
              onPress={() => touch(setMinus)(m)}
            />
          ))}
        </Row>
      )}

      <AppText variant="small">Unidad</AppText>
      <Row>
        {UNITS.map((u) => (
          <Chip key={u.key} label={u.label} selected={unit === u.key} onPress={() => touch(setUnit)(u.key)} />
        ))}
      </Row>
      <SwitchRow label="Por lado (cada pierna o brazo)" value={perSide} onValueChange={touch(setPerSide)} />

      <Divider />
      <AppText variant="heading">Progresión</AppText>
      <Row>
        {PROGRESSIONS.map((p) => (
          <Chip
            key={p.key}
            label={p.label}
            selected={progression === p.key}
            onPress={() => touch(setProgression)(p.key)}
          />
        ))}
      </Row>
      <AppText variant="small">
        {progression === 'load'
          ? 'Al terminar te propone subir o bajar el peso según el rango (nunca lo cambia sin que lo aceptes).'
          : 'Sin propuestas de peso: solo intentas superar tus reps.'}
      </AppText>
      {progression === 'load' ? (
        <>
          <SwitchRow label="Proponer bajar si no llego al mínimo" value={allowDecrease} onValueChange={touch(setAllowDecrease)} />
          <SwitchRow
            label={`Incremento propio (por defecto ${formatKg(defaultIncrement)})`}
            value={ownIncrement}
            onValueChange={touch(setOwnIncrement)}
          />
          {ownIncrement ? (
            <Stepper decimal value={increment} onChange={touch(setIncrement)} step={0.5} min={0.25} format={formatKg} />
          ) : null}
        </>
      ) : null}

      <Divider />
      <SwitchRow
        label={`Descanso propio (por defecto ${formatCountdown(defaultRest * 1000)})`}
        value={ownRest}
        onValueChange={touch(setOwnRest)}
      />
      {ownRest ? (
        <Stepper
          value={rest}
          onChange={touch(setRest)}
          step={15}
          min={15}
          format={(s) => formatCountdown(s * 1000)}
          parse={parseDuration}
          toText={String}
        />
      ) : null}
      <TextField label="Nota (se ve durante el entreno)" value={note} onChangeText={touch(setNote)} multiline />

      <Button title="Guardar cambios" onPress={save} />
      {saved ? <AppText style={{ color: colors.primary }}>Guardado ✓</AppText> : null}
    </Card>
  );
}
