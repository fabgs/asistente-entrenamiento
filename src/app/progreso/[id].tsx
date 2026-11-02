import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChangeArrow } from '@/components/Recommendation';
import { LineChart } from '@/components/LineChart';
import { AppText, Card, Chip, Loading, Row, Screen } from '@/components/ui';
import { getExercise } from '@/db/repositories/exercises';
import { exerciseSessions, exerciseWeightChanges } from '@/db/repositories/progress';
import { formatKg, formatNumber, formatShortDate } from '@/domain/format';
import { computeRecords, summarize } from '@/domain/progress';
import { localDateString } from '@/domain/schedule';
import { useLoader } from '@/hooks/data';
import { colors, spacing } from '@/theme';

/** Progress of one exercise across all routines (PLAN.md §6.6). */
export default function ExerciseProgressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseId = Number(id);

  const { data } = useLoader(async (db) => ({
    exercise: await getExercise(db, exerciseId),
    sessions: await exerciseSessions(db, exerciseId),
    changes: await exerciseWeightChanges(db, exerciseId),
  }));

  if (!data) return <Loading />;
  if (!data.exercise) {
    return (
      <Screen>
        <AppText>No se encontró el ejercicio.</AppText>
      </Screen>
    );
  }

  const { sessions, changes } = data;
  const records = computeRecords(sessions);
  const chronological = [...sessions].reverse().map((s) => ({ label: formatShortDate(s.date), ...summarize(s.sets) }));
  const hasWeight = chronological.some((s) => s.topWeightKg > 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: data.exercise.name }} />
      {sessions.length === 0 ? <AppText variant="muted">Aún no has hecho este ejercicio.</AppText> : null}

      {sessions.length > 0 ? (
        <Card>
          <AppText variant="heading">Récords</AppText>
          {records.maxWeight ? (
            <RecordRow
              label="Peso máximo"
              value={`${formatKg(records.maxWeight.kg)} × ${records.maxWeight.reps}`}
              date={records.maxWeight.date}
            />
          ) : null}
          {records.maxReps ? (
            <RecordRow
              label="Más repeticiones"
              value={records.maxReps.kg > 0 ? `${records.maxReps.reps} con ${formatKg(records.maxReps.kg)}` : `${records.maxReps.reps}`}
              date={records.maxReps.date}
            />
          ) : null}
          {records.maxVolume ? (
            <RecordRow label="Mayor volumen" value={`${formatNumber(records.maxVolume.kg, 0)} kg`} date={records.maxVolume.date} />
          ) : null}
        </Card>
      ) : null}

      {chronological.length >= 2 ? (
        <Card style={{ gap: spacing.lg }}>
          {hasWeight ? (
            <LineChart
              title="Peso de trabajo"
              points={chronological.map((s) => ({ label: s.label, value: s.topWeightKg }))}
              format={formatKg}
            />
          ) : null}
          <LineChart
            title="Repeticiones totales por sesión"
            points={chronological.map((s) => ({ label: s.label, value: s.totalReps }))}
            format={(v) => formatNumber(v, 0)}
          />
          <AppText variant="small">Toca o arrastra sobre la gráfica para ver cada sesión.</AppText>
        </Card>
      ) : sessions.length === 1 ? (
        <AppText variant="small">Con dos sesiones o más verás aquí la evolución.</AppText>
      ) : null}

      {sessions.length > 0 ? (
        <Card>
          <AppText variant="heading">Sesiones</AppText>
          {sessions.map((s) => {
            const weight = Math.max(0, ...s.sets.map((set) => set.weightKg ?? 0));
            return (
              <Pressable key={s.sessionId} style={styles.row} onPress={() => router.push(`/workout/resumen/${s.sessionId}`)}>
                <Row between>
                  <AppText>{formatShortDate(s.date)}</AppText>
                  {s.imported ? <Chip label="Excel" /> : null}
                </Row>
                <AppText variant="muted">
                  {weight > 0 ? `${formatKg(weight)} · ` : ''}
                  {s.sets.map((set) => set.reps).join(' · ')}
                </AppText>
                {s.routineName ? <AppText variant="small">{s.routineName}</AppText> : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {changes.length > 0 ? (
        <Card>
          <AppText variant="heading">Cambios de peso</AppText>
          {changes.map((c) => (
            <View key={c.id} style={styles.row}>
              <ChangeArrow change={c} />
              <AppText variant="small">
                {c.source === 'manual' ? 'Cambio manual' : c.status === 'applied' ? 'Recomendación aplicada' : 'Recomendación ignorada'}
                {' · '}
                {formatShortDate(localDateString(new Date(c.decidedAt ?? c.createdAt)))} · {c.routineName}
              </AppText>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function RecordRow({ label, value, date }: { label: string; value: string; date: string }) {
  return (
    <Row between>
      <AppText variant="muted">{label}</AppText>
      <AppText>
        <AppText style={{ fontWeight: '700' }}>{value}</AppText>
        <AppText variant="small"> · {formatShortDate(date)}</AppText>
      </AppText>
    </Row>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
});
