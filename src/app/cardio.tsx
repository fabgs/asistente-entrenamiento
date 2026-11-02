import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Chip, Icon, Loading, NumberRow, Row, Screen, TextField, type IconName } from '@/components/ui';
import {
  addCardio,
  archiveCardio,
  listCardio,
  updateCardio,
  type CardioActivity,
} from '@/db/repositories/cardio';
import {
  DEFAULT_PLANS,
  describePlan,
  PLAN_KIND_LABEL,
  planSeconds,
  type CardioPlan,
  type CardioTracking,
  type PlanKind,
} from '@/domain/cardioPlan';
import { formatClock } from '@/domain/format';
import { ISO_WEEKDAYS, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { rescheduleDailyReminders } from '@/services/dailyReminder';
import { colors, radius, spacing } from '@/theme';

export default function CardioScreen() {
  const db = useDb();
  const [editing, setEditing] = useState<number | null>(null);
  const { data, reload } = useLoader((db) => listCardio(db));

  if (!data) return <Loading />;

  const changed = async () => {
    await rescheduleDailyReminders(db);
    await reload();
  };

  const add = async (weekday: IsoWeekday) => {
    const id = await addCardio(db, weekday, { name: 'Nueva actividad', target: null, intensity: null, notes: null });
    setEditing(id);
    await changed();
  };

  return (
    <Screen>
      {ISO_WEEKDAYS.map((weekday) => (
        <Card key={weekday}>
          <AppText variant="heading">{WEEKDAY_NAMES[weekday]}</AppText>
          {data
            .filter((a) => a.weekday === weekday)
            .map((activity) =>
              editing === activity.id ? (
                <ActivityForm
                  key={activity.id}
                  activity={activity}
                  onDone={async () => {
                    setEditing(null);
                    await changed();
                  }}
                />
              ) : (
                <Pressable key={activity.id} style={styles.row} onPress={() => setEditing(activity.id)}>
                  <Icon name={TRACKING[activity.tracking].icon} size={20} color={colors.muted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText>
                      {activity.name}
                      {activity.target ? ` · ${activity.target}` : ''}
                    </AppText>
                    <AppText variant="small">
                      {[
                        activity.tracking === 'timer' && activity.plan
                          ? `${PLAN_KIND_LABEL[activity.plan.kind]} · ${describePlan(activity.plan)}`
                          : activity.intensity,
                        activity.notes,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </AppText>
                  </View>
                </Pressable>
              ),
            )}
          <Button kind="ghost" title="+ Añadir actividad" onPress={() => add(weekday)} />
        </Card>
      ))}
    </Screen>
  );
}

const TRACKING: Record<CardioTracking, { label: string; icon: IconName; help: string }> = {
  check: { label: 'Solo marcar', icon: 'checkbox-marked-outline', help: 'Se marca como hecha en Hoy.' },
  gps: { label: 'GPS', icon: 'map-marker-path', help: 'Graba la ruta, la distancia y el ritmo (caminar, correr).' },
  timer: { label: 'Temporizador', icon: 'timer-outline', help: 'Cuenta atrás por fases con aviso en cada cambio (bici, HIIT).' },
};

function ActivityForm({ activity, onDone }: { activity: CardioActivity; onDone: () => void }) {
  const db = useDb();
  const [tracking, setTracking] = useState(activity.tracking);
  const [plan, setPlan] = useState<CardioPlan>(activity.plan ?? DEFAULT_PLANS.liss);
  const [name, setName] = useState(activity.name);
  const [target, setTarget] = useState(activity.target ?? '');
  const [intensity, setIntensity] = useState(activity.intensity ?? '');
  const [notes, setNotes] = useState(activity.notes ?? '');

  const save = async () => {
    if (!name.trim()) return;
    await updateCardio(db, activity.id, {
      name: name.trim(),
      target: target.trim() || null,
      intensity: intensity.trim() || null,
      notes: notes.trim() || null,
      tracking,
      plan: tracking === 'timer' ? plan : null,
    });
    onDone();
  };

  const remove = async () => {
    await archiveCardio(db, activity.id);
    onDone();
  };

  return (
    <View style={styles.form}>
      <TextField label="Actividad" value={name} onChangeText={setName} placeholder="Caminar" />
      <TextField label="Objetivo" value={target} onChangeText={setTarget} placeholder="5 km, 30 min…" />
      <TextField label="Intensidad" value={intensity} onChangeText={setIntensity} placeholder="Baja (LISS)" />
      <TextField label="Notas" value={notes} onChangeText={setNotes} />
      <AppText variant="small">Cómo se registra</AppText>
      <Row>
        {(Object.keys(TRACKING) as CardioTracking[]).map((t) => (
          <Chip key={t} label={TRACKING[t].label} selected={tracking === t} onPress={() => setTracking(t)} />
        ))}
      </Row>
      <AppText variant="small">{TRACKING[tracking].help}</AppText>
      {tracking === 'timer' ? <PlanEditor plan={plan} onChange={setPlan} /> : null}
      <Row>
        <Button title="Guardar" onPress={save} disabled={!name.trim()} />
        <Button kind="danger" title="Quitar" onPress={remove} />
      </Row>
    </View>
  );
}

function PlanEditor({ plan, onChange }: { plan: CardioPlan; onChange: (plan: CardioPlan) => void }) {
  const min = (m: number) => `${m} min`;
  const sec = (s: number) => `${s} s`;
  const set = <K extends string>(key: K) => (value: number) => onChange({ ...plan, [key]: value } as CardioPlan);

  return (
    <View style={styles.plan}>
      <Row>
        {(Object.keys(DEFAULT_PLANS) as PlanKind[]).map((k) => (
          <Chip
            key={k}
            label={k.toUpperCase()}
            selected={plan.kind === k}
            onPress={() => plan.kind !== k && onChange(DEFAULT_PLANS[k])}
          />
        ))}
      </Row>
      <AppText variant="small">{PLAN_KIND_LABEL[plan.kind]}</AppText>
      {plan.kind === 'liss' ? (
        <NumberRow label="Duración" value={plan.minutes} onChange={set('minutes')} step={5} min={1} format={min} />
      ) : null}
      {plan.kind === 'miss' ? (
        <>
          <NumberRow label="Calentamiento" value={plan.warmupMin} onChange={set('warmupMin')} format={min} />
          <NumberRow label="Intensidad media" value={plan.mainMin} onChange={set('mainMin')} step={5} min={1} format={min} />
          <NumberRow label="Enfriamiento" value={plan.cooldownMin} onChange={set('cooldownMin')} format={min} />
        </>
      ) : null}
      {plan.kind === 'hiit' ? (
        <>
          <NumberRow label="Calentamiento" value={plan.warmupMin} onChange={set('warmupMin')} format={min} />
          <NumberRow label="Rondas" value={plan.rounds} onChange={set('rounds')} min={1} />
          <NumberRow label="Sprint" value={plan.workSec} onChange={set('workSec')} step={5} min={5} format={sec} />
          <NumberRow label="Recuperación" value={plan.restSec} onChange={set('restSec')} step={5} min={5} format={sec} />
          <NumberRow label="Enfriamiento" value={plan.cooldownMin} onChange={set('cooldownMin')} format={min} />
        </>
      ) : null}
      <AppText variant="muted">
        Total {formatClock(planSeconds(plan) * 1000)} · {describePlan(plan)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  plan: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
  },
  form: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
