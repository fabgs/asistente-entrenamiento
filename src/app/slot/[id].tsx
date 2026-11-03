import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { showActions, showDialog } from '@/components/Dialog';
import { FormRow } from '@/components/FormRow';
import { OpenChange } from '@/components/Recommendation';
import {
  AppText,
  BottomBar,
  Button,
  Card,
  DurationField,
  EmptyState,
  HeaderButton,
  ListGroup,
  ListRow,
  Loading,
  NumberRow,
  Screen,
  Section,
  Segmented,
  Stepper,
  SwitchRow,
  TextField,
} from '@/components/ui';
import {
  archiveSlot,
  getRoutine,
  getSlot,
  isBodyweight,
  prescriptionOf,
  samePrescription,
  updateSlotPrescription,
  type Routine,
  type Slot,
  type SlotPrescription,
} from '@/db/repositories/routines';
import { slotHistory, type SlotPerformance } from '@/db/repositories/sessions';
import { getSettings } from '@/db/repositories/settings';
import { listOpenChanges, setSlotWeightManually, type WeightChange } from '@/db/repositories/weightChanges';
import { formatCountdown, formatKg, formatSetGroups, formatTarget } from '@/domain/format';
import type { ProgressionKind, RepTarget, RepUnit } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { queueWrite, reschedule, useSaveGuard } from '@/hooks/editing';

const TARGET_KINDS: { value: RepTarget['kind']; label: string }[] = [
  { value: 'range', label: 'Rango' },
  { value: 'fixed', label: 'Fijo' },
  { value: 'failure', label: 'Al fallo' },
];
const UNITS: { value: RepUnit; label: string }[] = [
  { value: 'reps', label: 'Reps' },
  { value: 'steps', label: 'Pasos' },
  { value: 'seconds', label: 'Segundos' },
];
/** Label of the fixed count, in the unit being counted. */
const FIXED_LABEL: Record<RepUnit, string> = { reps: 'Repeticiones', steps: 'Pasos', seconds: 'Segundos' };
const PROGRESSIONS: { value: ProgressionKind; label: string }[] = [
  { value: 'load', label: 'Automática' },
  { value: 'manual', label: 'Manual' },
];

/** The exercise of a routine: its weight and prescription, saved with one «Guardar». */
export default function SlotEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const slotId = Number(id);
  const { data, reload } = useLoader(async (db) => {
    const slot = await getSlot(db, slotId);
    if (!slot) return null;
    const settings = await getSettings(db);
    return {
      slot,
      routine: await getRoutine(db, slot.routineId),
      defaultIncrement: slot.exerciseIncrementKg ?? settings.defaultIncrementKg,
      defaultRest: settings.restSecondsDefault,
      change: (await listOpenChanges(db)).find((c) => c.slotId === slotId) ?? null,
      last: (await slotHistory(db, slotId, 1))[0] ?? null,
    };
  });

  if (data === undefined) {
    return (
      <>
        {/* The title is the name of the exercise, not known yet. */}
        <Stack.Screen options={{ title: '' }} />
        <Loading />
      </>
    );
  }
  if (data === null) {
    return (
      <Screen>
        <EmptyState icon="dumbbell" title="Este ejercicio ya no está en la rutina" />
      </Screen>
    );
  }
  return <SlotForm key={data.slot.id} {...data} onChanged={reload} />;
}

function SlotForm({
  slot,
  routine,
  defaultIncrement,
  defaultRest,
  change,
  last,
  onChanged,
}: {
  slot: Slot;
  routine: Routine | null;
  defaultIncrement: number;
  defaultRest: number;
  change: WeightChange | null;
  last: SlotPerformance | null;
  onChanged: () => void;
}) {
  const db = useDb();
  const t = slot.target;
  const bodyweight = isBodyweight(slot);
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
  // Untouched (null), the weight follows the slot: applying a suggestion here changes it.
  const [weightEdit, setWeightEdit] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const savedWeight = slot.weightKg ?? 0;
  const weight = weightEdit ?? savedWeight;
  const target: RepTarget =
    kind === 'range' ? { kind, min, max } : kind === 'fixed' ? { kind, reps: fixed } : { kind, minus };
  const prescription: SlotPrescription = {
    sets,
    target,
    perSide,
    unit,
    progression,
    allowDecrease,
    incrementKg: ownIncrement ? increment : null,
    restSeconds: ownRest ? rest : null,
    note: note.trim() || null,
  };
  const weightChanged = weight !== savedWeight;
  const dirty = weightChanged || !samePrescription(prescription, prescriptionOf(slot));
  const automatic = progression === 'load';

  const save = async () => {
    await queueWrite(async () => {
      await updateSlotPrescription(db, slot.id, prescription);
      // Only a real change is logged: as a manual change, which expires the open suggestions.
      if (weightChanged) await setSlotWeightManually(db, slot.id, bodyweight && weight === 0 ? null : weight);
    });
    reschedule(db);
    return true;
  };
  const leave = useSaveGuard(dirty, save);

  const submit = async () => {
    setSaving(true);
    try {
      await save();
      leave();
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    showDialog(
      '¿Quitar de la rutina?',
      `«${slot.exerciseName}» deja de estar en ${routine ? `«${routine.name}»` : 'la rutina'}. Las series que ya hiciste siguen en el historial.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: async () => {
            await queueWrite(() => archiveSlot(db, slot.id));
            reschedule(db);
            leave();
          },
        },
      ],
    );

  // Pushing one end of the range past the other moves both.
  const changeMin = (value: number) => {
    setMin(value);
    if (value > max) setMax(value);
  };
  const changeMax = (value: number) => {
    setMax(value);
    if (value < min) setMin(value);
  };

  const formatWeight = (kg: number) => (kg > 0 ? formatKg(kg) : bodyweight ? 'Peso corporal' : 'Sin carga');
  const lastTime = last ? formatSetGroups(last.reps.map((reps) => ({ weightKg: last.weightKg, reps })), bodyweight) : null;

  return (
    <Screen
      footer={
        <BottomBar>
          <Button size="lg" title="Guardar" disabled={!dirty || saving} onPress={submit} style={styles.flex} />
        </BottomBar>
      }>
      <Stack.Screen
        options={{
          title: slot.exerciseName,
          headerRight: () => (
            <HeaderButton
              icon="dots-vertical"
              label="Más acciones"
              onPress={() =>
                showActions([
                  { text: 'Quitar de la rutina', icon: 'minus-circle-outline', destructive: true, onPress: remove },
                ])
              }
            />
          ),
        }}
      />
      <AppText variant="secondary">
        {[routine?.name, `${sets} × ${formatTarget(target, unit, perSide)}`].filter(Boolean).join(' · ')}
      </AppText>

      <Section label={bodyweight ? 'Lastre' : 'Peso'}>
        <Card>
          <Stepper
            decimal
            value={weight}
            onChange={setWeightEdit}
            step={ownIncrement ? increment : defaultIncrement}
            format={formatWeight}
          />
          {change ? (
            <OpenChange
              change={change}
              onChanged={() => {
                setWeightEdit(null);
                onChanged();
              }}
            />
          ) : null}
        </Card>
      </Section>

      <Section label="Series y repeticiones">
        <ListGroup>
          <FormRow>
            <NumberRow label="Series" value={sets} onChange={setSets} min={1} max={20} />
          </FormRow>
          <FormRow padded>
            <Segmented options={TARGET_KINDS} value={kind} onChange={setKind} />
          </FormRow>
          {kind === 'range' ? (
            <FormRow>
              <NumberRow label="Mínimo" value={min} onChange={changeMin} min={1} max={100} />
            </FormRow>
          ) : null}
          {kind === 'range' ? (
            <FormRow>
              <NumberRow label="Máximo" value={max} onChange={changeMax} min={1} max={100} />
            </FormRow>
          ) : null}
          {kind === 'fixed' ? (
            <FormRow>
              <NumberRow label={FIXED_LABEL[unit]} value={fixed} onChange={setFixed} min={1} max={100} />
            </FormRow>
          ) : null}
          {kind === 'failure' ? (
            <FormRow>
              <NumberRow label="Reps en reserva" value={minus} onChange={setMinus} max={5} />
            </FormRow>
          ) : null}
          <FormRow padded>
            <Segmented options={UNITS} value={unit} onChange={setUnit} />
          </FormRow>
          <FormRow>
            <SwitchRow label="Por lado" value={perSide} onValueChange={setPerSide} />
          </FormRow>
        </ListGroup>
      </Section>

      {/* «Al fallo» never changes the weight: there is no progression to set. */}
      {kind !== 'failure' ? (
        <Section label="Progresión">
          <ListGroup>
            <FormRow padded>
              <Segmented options={PROGRESSIONS} value={progression} onChange={setProgression} />
            </FormRow>
            {automatic && kind === 'range' ? (
              <FormRow>
                <SwitchRow
                  label="Proponer bajar el peso"
                  subtitle="Si no llegas al mínimo"
                  value={allowDecrease}
                  onValueChange={setAllowDecrease}
                />
              </FormRow>
            ) : null}
            {automatic ? (
              <FormRow>
                <SwitchRow
                  label="Incremento propio"
                  subtitle={`Por defecto ${formatKg(defaultIncrement)}`}
                  value={ownIncrement}
                  onValueChange={setOwnIncrement}
                />
              </FormRow>
            ) : null}
            {automatic && ownIncrement ? (
              <FormRow>
                <NumberRow label="Incremento" value={increment} onChange={setIncrement} step={0.5} min={0.5} format={formatKg} />
              </FormRow>
            ) : null}
          </ListGroup>
        </Section>
      ) : null}

      <Section label="Descanso entre series">
        <ListGroup>
          <FormRow>
            <SwitchRow
              label="Descanso propio"
              subtitle={`Por defecto ${formatCountdown(defaultRest * 1000)}`}
              value={ownRest}
              onValueChange={setOwnRest}
            />
          </FormRow>
          {ownRest ? (
            <FormRow padded>
              <DurationField value={rest} onChange={setRest} />
            </FormRow>
          ) : null}
        </ListGroup>
      </Section>

      <TextField label="Nota" value={note} onChangeText={setNote} multiline help="Se ve en la serie" />

      {lastTime ? (
        <ListGroup>
          <ListRow
            title="Últimas sesiones"
            subtitle={lastTime}
            onPress={() => router.push(`/progreso/${slot.exerciseId}`)}
          />
        </ListGroup>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
