import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Loading, Row, Screen, TextField } from '@/components/ui';
import {
  addCardio,
  archiveCardio,
  listCardio,
  updateCardio,
  type CardioActivity,
} from '@/db/repositories/cardio';
import { ISO_WEEKDAYS, WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb, useLoader } from '@/hooks/data';
import { rescheduleDailyReminders } from '@/services/dailyReminder';
import { colors, spacing } from '@/theme';

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
                  <AppText>
                    {activity.name}
                    {activity.target ? ` · ${activity.target}` : ''}
                  </AppText>
                  {activity.intensity || activity.notes ? (
                    <AppText variant="small">{[activity.intensity, activity.notes].filter(Boolean).join(' · ')}</AppText>
                  ) : null}
                </Pressable>
              ),
            )}
          <Button kind="ghost" title="+ Añadir actividad" onPress={() => add(weekday)} />
        </Card>
      ))}
    </Screen>
  );
}

function ActivityForm({ activity, onDone }: { activity: CardioActivity; onDone: () => void }) {
  const db = useDb();
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
      <Row>
        <Button title="Guardar" onPress={save} disabled={!name.trim()} />
        <Button kind="danger" title="Quitar" onPress={remove} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  form: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
