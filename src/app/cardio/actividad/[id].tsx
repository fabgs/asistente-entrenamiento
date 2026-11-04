import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { showActions, showSnackbar } from '@/components/Dialog';
import { FormRow } from '@/components/FormRow';
import {
  AppText,
  BottomBar,
  Button,
  DurationField,
  EmptyState,
  HeaderButton,
  ListGroup,
  Loading,
  NumberRow,
  Screen,
  Section,
  Segmented,
  TextField,
} from '@/components/ui';
import {
  addCardio,
  archiveCardio,
  cardioFieldsOf,
  getCardio,
  sameCardioFields,
  unarchiveCardio,
  updateCardio,
  type CardioActivity,
} from '@/db/repositories/cardio';
import {
  DEFAULT_PLANS,
  describePlan,
  planSeconds,
  type CardioPlan,
  type CardioTracking,
  type PlanKind,
} from '@/domain/cardioPlan';
import { formatDuration, NBSP } from '@/domain/format';
import { DEFAULT_SPRINT_PLAN, describeSprintPlan, REST_RANGE_S, SPRINTS_RANGE, type SprintPlan } from '@/domain/sprint';
import { ISO_WEEKDAYS, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { emitDataChanged, queueWrite, reschedule, useSaveGuard } from '@/hooks/editing';
import { spacing } from '@/theme';

const TRACKING: { value: CardioTracking; label: string }[] = [
  { value: 'check', label: 'Marcar' },
  { value: 'gps', label: 'GPS' },
  { value: 'timer', label: 'Fases' },
  { value: 'sprint', label: 'Sprints' },
];

/** The one line of help of the screen: what each way of recording does. */
const TRACKING_HELP: Record<CardioTracking, string> = {
  check: 'Se marca como hecha en Hoy',
  gps: 'Graba la ruta, la distancia y el ritmo',
  timer: 'Cuenta atrás por fases, con aviso en cada cambio',
  sprint: 'Un pitido da la salida y paras tú: tiempo, metros y velocidad máxima',
};

const PLAN_KINDS: { value: PlanKind; label: string }[] = [
  { value: 'liss', label: 'LISS' },
  { value: 'miss', label: 'MISS' },
  { value: 'hiit', label: 'HIIT' },
];

/**
 * An activity of the weekly cardio (`id`), or a new one (`id = nueva`, `dia` = ISO weekday): nothing
 * is saved until «Añadir» (D29).
 */
export default function ActivityScreen() {
  const { id, dia } = useLocalSearchParams<{ id: string; dia?: string }>();
  const isNew = id === 'nueva';
  const { data } = useLoader(async (db) => ({ activity: isNew ? null : await getCardio(db, Number(id)) }));

  if (!data) {
    return (
      <>
        <Stack.Screen options={{ title: isNew ? 'Nueva actividad' : 'Editar actividad' }} />
        <Loading />
      </>
    );
  }
  if (!isNew && !data.activity) {
    return (
      <Screen>
        <EmptyState icon="walk" title="Esta actividad ya no existe" />
      </Screen>
    );
  }
  const weekday = data.activity?.weekday ?? ISO_WEEKDAYS.find((d) => String(d) === dia) ?? 1;
  return <ActivityForm key={id} activity={data.activity} weekday={weekday} />;
}

function ActivityForm({ activity, weekday }: { activity: CardioActivity | null; weekday: IsoWeekday }) {
  const db = useDb();
  const [name, setName] = useState(activity?.name ?? '');
  const [target, setTarget] = useState(activity?.target ?? '');
  const [intensity, setIntensity] = useState(activity?.intensity ?? '');
  const [notes, setNotes] = useState(activity?.notes ?? '');
  const [tracking, setTracking] = useState<CardioTracking>(activity?.tracking ?? 'check');
  const [plan, setPlan] = useState<CardioPlan>(activity?.plan ?? DEFAULT_PLANS.liss);
  const [sprint, setSprint] = useState<SprintPlan>(activity?.sprint ?? DEFAULT_SPRINT_PLAN);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fields = {
    name: name.trim(),
    target: target.trim() || null,
    intensity: intensity.trim() || null,
    notes: notes.trim() || null,
    tracking,
    plan: tracking === 'timer' ? plan : null,
    sprint: tracking === 'sprint' ? sprint : null,
  };
  const dirty = activity
    ? !sameCardioFields(fields, cardioFieldsOf(activity))
    : !!(fields.name || fields.target || fields.intensity || fields.notes) || tracking !== 'check';
  const canSave = fields.name !== '' && (activity === null || dirty);

  const save = async () => {
    if (!fields.name) {
      setError('Ponle un nombre');
      return false;
    }
    await queueWrite(async () => {
      if (activity) await updateCardio(db, activity.id, fields);
      else await addCardio(db, weekday, fields);
    });
    reschedule(db);
    return true;
  };
  const leave = useSaveGuard(dirty, save);

  const submit = async () => {
    setSaving(true);
    try {
      if (await save()) leave();
    } finally {
      setSaving(false);
    }
  };

  // Removing is undone from the Snackbar, so it needs no confirmation (D29).
  const remove = async () => {
    if (!activity) return;
    await queueWrite(() => archiveCardio(db, activity.id));
    reschedule(db);
    leave();
    showSnackbar('Actividad quitada.', {
      label: 'Deshacer',
      onPress: async () => {
        await queueWrite(() => unarchiveCardio(db, activity.id));
        reschedule(db);
        emitDataChanged();
      },
    });
  };

  return (
    <Screen
      footer={
        <BottomBar>
          <Button
            size="lg"
            title={activity ? 'Guardar' : 'Añadir'}
            disabled={!canSave || saving}
            onPress={submit}
            style={styles.flex}
          />
        </BottomBar>
      }>
      <Stack.Screen
        options={{
          title: activity ? 'Editar actividad' : 'Nueva actividad',
          headerRight: activity
            ? () => (
                <HeaderButton
                  icon="dots-vertical"
                  label="Más acciones"
                  onPress={() =>
                    showActions([
                      { text: 'Quitar actividad', icon: 'minus-circle-outline', destructive: true, onPress: remove },
                    ])
                  }
                />
              )
            : undefined,
        }}
      />
      <AppText variant="secondary">{`Cardio del ${WEEKDAY_NAMES[weekday].toLowerCase()}`}</AppText>

      <View style={styles.fields}>
        <TextField
          label="Actividad"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError(null);
          }}
          placeholder="Caminar"
          error={error ?? undefined}
        />
        <TextField label="Objetivo" value={target} onChangeText={setTarget} placeholder="5 km, 30 min…" />
        {/* With the timer or the sprints, the plan says the intensity. */}
        {tracking !== 'timer' && tracking !== 'sprint' ? (
          <TextField label="Intensidad" value={intensity} onChangeText={setIntensity} placeholder="Baja, media o alta" />
        ) : null}
      </View>

      <Section label="Cómo se registra">
        <Segmented options={TRACKING} value={tracking} onChange={setTracking} />
        <AppText variant="caption">{TRACKING_HELP[tracking]}</AppText>
      </Section>

      {tracking === 'timer' ? (
        <Section label="Plan">
          <PlanEditor plan={plan} onChange={setPlan} />
        </Section>
      ) : null}

      {tracking === 'sprint' ? (
        <>
          <Section label="Sprints">
            <ListGroup>
              <FormRow>
                <NumberRow
                  label="Sprints"
                  value={sprint.sprints}
                  onChange={(sprints) => setSprint({ ...sprint, sprints })}
                  min={SPRINTS_RANGE[0]}
                  max={SPRINTS_RANGE[1]}
                />
              </FormRow>
            </ListGroup>
          </Section>
          <Section label="Descanso">
            <DurationField
              value={sprint.restSec}
              onChange={(restSec) => setSprint({ ...sprint, restSec })}
              presets={[60, 90, 120, 180]}
              step={15}
              min={REST_RANGE_S[0]}
              max={REST_RANGE_S[1]}
            />
            <AppText variant="secondary">{describeSprintPlan(sprint)}</AppText>
          </Section>
        </>
      ) : null}

      <TextField label="Notas" value={notes} onChangeText={setNotes} />
    </Screen>
  );
}

const minutes = (m: number) => `${m}${NBSP}min`;
const seconds = (s: number) => `${s}${NBSP}s`;

interface PlanField {
  key: string;
  label: string;
  value: number;
  step?: number;
  min?: number;
  format?: (value: number) => string;
}

function planFields(plan: CardioPlan): PlanField[] {
  switch (plan.kind) {
    case 'liss':
      return [{ key: 'minutes', label: 'Duración', value: plan.minutes, step: 5, min: 1, format: minutes }];
    case 'miss':
      return [
        { key: 'warmupMin', label: 'Calentamiento', value: plan.warmupMin, format: minutes },
        { key: 'mainMin', label: 'Intensidad media', value: plan.mainMin, step: 5, min: 1, format: minutes },
        { key: 'cooldownMin', label: 'Enfriamiento', value: plan.cooldownMin, format: minutes },
      ];
    case 'hiit':
      return [
        { key: 'warmupMin', label: 'Calentamiento', value: plan.warmupMin, format: minutes },
        { key: 'rounds', label: 'Rondas', value: plan.rounds, min: 1 },
        { key: 'workSec', label: 'Sprint', value: plan.workSec, step: 5, min: 5, format: seconds },
        { key: 'restSec', label: 'Recuperación', value: plan.restSec, step: 5, min: 5, format: seconds },
        { key: 'cooldownMin', label: 'Enfriamiento', value: plan.cooldownMin, format: minutes },
      ];
  }
}

function PlanEditor({ plan, onChange }: { plan: CardioPlan; onChange: (plan: CardioPlan) => void }) {
  const total = formatDuration(planSeconds(plan) * 1000);
  return (
    <>
      <Segmented options={PLAN_KINDS} value={plan.kind} onChange={(kind) => onChange(DEFAULT_PLANS[kind])} />
      <ListGroup>
        {planFields(plan).map((f) => (
          <FormRow key={f.key}>
            <NumberRow
              label={f.label}
              value={f.value}
              onChange={(value) => onChange({ ...plan, [f.key]: value } as CardioPlan)}
              step={f.step}
              min={f.min}
              format={f.format}
            />
          </FormRow>
        ))}
      </ListGroup>
      <AppText variant="secondary">{plan.kind === 'liss' ? `Total ${total}` : `Total ${total} · ${describePlan(plan)}`}</AppText>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fields: { gap: spacing.lg },
});
