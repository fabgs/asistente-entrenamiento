import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { HEAT } from '@/components/BodyMap';
import { UnmappedRow } from '@/components/MuscleWeek';
import { Sheet } from '@/components/Sheet';
import { AppText, Card, Icon, ListGroup, ListRow, Loading, Screen, Section } from '@/components/ui';
import { loadMuscleWeek, type MuscleWeekData } from '@/db/repositories/muscles';
import {
  contributionsTo,
  formatSetsOfPlan,
  MUSCLE_GROUPS,
  MUSCLE_INFO,
  muscleLabel,
  muscleLevel,
  muscleWeek,
  setsPerMuscle,
  totalSets,
  type Muscle,
  type MuscleWeek,
} from '@/domain/muscles';
import { localDateString } from '@/domain/schedule';
import { useLoader } from '@/hooks/data';
import { colors, radius, spacing } from '@/theme';

/** Sets a week at the end of every bar: the same scale for all, so the 10–20 range is one column. */
const AXIS = 25;
const RANGE = [10, 20] as const;

const at = (sets: number): `${number}%` => `${(Math.min(sets, AXIS) / AXIS) * 100}%`;

/** Sets per muscle this week against the plan, with the range of the evidence (PLAN.md §6.9). */
export default function MusclesScreen() {
  const { data } = useLoader((db) => loadMuscleWeek(db, localDateString(new Date())));
  const [open, setOpen] = useState<Muscle | null>(null);
  if (!data) return <Loading />;

  const rows = muscleWeek(setsPerMuscle(data.done, data.musclesOf), setsPerMuscle(data.planned, data.musclesOf));
  return (
    <Screen>
      {data.unmapped.length > 0 ? (
        <ListGroup>
          <UnmappedRow ids={data.unmapped} />
        </ListGroup>
      ) : null}

      <Section label="Esta semana" right={formatSetsOfPlan(totalSets(data.done), totalSets(data.planned), true)}>
        <Card>
          <Legend />
          <AppText variant="caption">Cada serie suma 1 a su músculo principal y 0,5 a los secundarios.</AppText>
        </Card>
      </Section>

      {MUSCLE_GROUPS.map((group) => (
        <Section key={group.key} label={group.label}>
          <ListGroup>
            {rows
              .filter((r) => MUSCLE_INFO[r.muscle].group === group.key)
              .map((r) => (
                <MuscleRow key={r.muscle} week={r} onPress={() => setOpen(r.muscle)} />
              ))}
          </ListGroup>
        </Section>
      ))}

      <Sheet visible={open !== null} title={open ? muscleLabel(open) : ''} onClose={() => setOpen(null)}>
        {open ? <Contributions muscle={open} data={data} onOpen={() => setOpen(null)} /> : null}
      </Sheet>
    </Screen>
  );
}

function Legend() {
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.legendFill, { backgroundColor: HEAT[3] }]} />
        <AppText variant="caption">Hechas</AppText>
      </View>
      <View style={styles.legendItem}>
        <View style={styles.legendMark} />
        <AppText variant="caption">Tu plan</AppText>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendFill, { backgroundColor: colors.muscleTint }]} />
        <AppText variant="caption">De 10 a 20</AppText>
      </View>
    </View>
  );
}

/** A muscle: its name, «6 de 11» (with ✓ once the plan is done) and the bar. Opens what adds to it. */
function MuscleRow({ week, onPress }: { week: MuscleWeek; onPress: () => void }) {
  const { muscle, done, planned } = week;
  const complete = planned > 0 && done >= planned;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.pressed }}
      accessibilityRole="button"
      accessibilityLabel={`${muscleLabel(muscle)}: ${formatSetsOfPlan(done, planned, true)}${complete ? ', plan hecho' : ''}`}
      style={styles.row}>
      <View style={styles.head}>
        <AppText variant="rowTitle" style={styles.flex}>
          {muscleLabel(muscle)}
        </AppText>
        <AppText variant="rowValue" tabular>
          {formatSetsOfPlan(done, planned)}
        </AppText>
        {complete ? <Icon name="check-circle" size={18} color={colors.primary} /> : null}
      </View>
      <View style={styles.track}>
        <View style={[styles.range, { left: at(RANGE[0]), width: at(RANGE[1] - RANGE[0]) }]} />
        <View style={[styles.fill, { width: at(done), backgroundColor: HEAT[muscleLevel(done)] }]} />
        {planned > 0 ? <View style={[styles.mark, { left: at(planned) }]} /> : null}
      </View>
    </Pressable>
  );
}

/** The exercises behind a muscle's figure: sets done this week of those planned. Each opens its editor. */
function Contributions({ muscle, data, onOpen }: { muscle: Muscle; data: MuscleWeekData; onOpen: () => void }) {
  const items = contributionsTo(muscle, data.done, data.planned, data.musclesOf);
  if (items.length === 0) {
    return <AppText variant="secondary">Ningún ejercicio de tu plan ni de esta semana trabaja este músculo.</AppText>;
  }
  return (
    <ScrollView style={styles.sheetScroll}>
      <ListGroup style={{ backgroundColor: colors.cardAlt }}>
        {items.map((c) => (
          <ListRow
            key={c.exerciseId}
            title={data.names.get(c.exerciseId) ?? ''}
            subtitle={c.role === 'primary' ? 'Principal' : 'Secundario: cuenta la mitad'}
            right={formatSetsOfPlan(c.done, c.planned)}
            onPress={() => {
              onOpen();
              router.push(`/ejercicio/${c.exerciseId}`);
            }}
          />
        ))}
      </ListGroup>
    </ScrollView>
  );
}

const BAR = 8;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendFill: { width: 16, height: BAR, borderRadius: 2 },
  legendMark: { width: 2, height: BAR + 6, backgroundColor: colors.text },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm, minHeight: 56 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  track: { height: BAR, borderRadius: radius.pill, backgroundColor: colors.cardAlt, marginVertical: 3 },
  range: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.muscleTint },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.pill },
  mark: { position: 'absolute', top: -3, bottom: -3, width: 2, marginLeft: -1, backgroundColor: colors.text },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
});
