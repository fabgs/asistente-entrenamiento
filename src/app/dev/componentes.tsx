import { Redirect } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { showActions, showDialog, showPrompt, showSnackbar } from '@/components/Dialog';
import { BodyMap, HEAT } from '@/components/BodyMap';
import { SuggestionAction, SuggestionLine } from '@/components/Recommendation';
import { SlotRow } from '@/components/SlotRow';
import { Sheet } from '@/components/Sheet';
import { SprintTable } from '@/components/Sprint';
import {
  AddRow,
  AppText,
  Block,
  Button,
  Card,
  CheckMark,
  Chip,
  DayPicker,
  EmptyState,
  ErrorState,
  ExerciseIcon,
  FloatingButton,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  MuscleTags,
  ProgressBar,
  Row,
  RowIcon,
  Screen,
  Section,
  Segmented,
  Stat,
  StatRow,
  Stepper,
  SwitchRow,
  Tag,
  TextField,
  Value,
  type TagTone,
} from '@/components/ui';
import type { Slot } from '@/db/repositories/routines';
import type { WeightChange } from '@/db/repositories/weightChanges';
import { MUSCLE_KEYS, PATTERN_LABEL, type MovementPattern, type Muscle } from '@/domain/muscles';
import type { LapRow } from '@/domain/sprint';
import type { IsoWeekday } from '@/domain/types';
import { colors, spacing, type, type TypeName } from '@/theme';

const SAMPLE_UP: WeightChange = {
  id: 0,
  slotId: 0,
  sessionId: null,
  fromKg: 35,
  toKg: 37.5,
  reason: 'Media de 14,7 reps, por encima de 12',
  source: 'progression',
  status: 'pending',
  createdAt: 0,
  decidedAt: null,
};
const SAMPLE_DOWN: WeightChange = {
  ...SAMPLE_UP,
  fromKg: 5,
  toKg: 2.5,
  reason: 'Media de 14, por debajo de 15, dos sesiones seguidas',
};

/**
 * Every component in each of its states, to check the system on the phone (in the sun: whether 500,
 * 600 and 700 can be told apart and whether borderless cards stand out). Development builds only.
 */
/** Every state of a row: good, the fastest, weak GPS (≈), no GPS (–) and still measuring (…). */
const SPRINT_ROWS: LapRow[] = [
  { number: 1, timeMs: 11_800, distanceM: 74.2, topSpeedMs: 8.3, quality: 'good', settled: true },
  { number: 2, timeMs: 11_400, distanceM: 75.6, topSpeedMs: 8.6, quality: 'good', settled: true },
  { number: 3, timeMs: 12_300, distanceM: 71.9, topSpeedMs: 7.9, quality: 'weak', settled: true },
  { number: 4, timeMs: 12_000, distanceM: null, topSpeedMs: null, quality: 'none', settled: true },
  { number: 5, timeMs: 12_600, distanceM: null, topSpeedMs: null, quality: null, settled: false },
];

/** An exercise of a routine in its states: with a weight, ballast, bodyweight alone, two dumbbells without muscles. */
const SLOT: Slot = {
  id: 1,
  routineId: 1,
  exerciseId: 1,
  exerciseName: 'Remo con barra (90º)',
  exerciseType: 'external',
  exerciseIncrementKg: null,
  exercisePair: false,
  position: 0,
  weightKg: 35,
  sets: 3,
  target: { kind: 'range', min: 10, max: 12 },
  perSide: false,
  unit: 'reps',
  progression: 'load',
  allowDecrease: true,
  incrementKg: null,
  restSeconds: null,
  note: null,
};

const PATTERN_MUSCLE: Record<MovementPattern, Muscle> = {
  push: 'chest',
  pull: 'lats',
  arms: 'biceps',
  legs: 'quads',
  hinge: 'hamstrings',
  core: 'abs',
};

/** Every muscle at a level, 0 to 4 in turn, to see each step of the ramp on the body. */
const SAMPLE_LEVELS = Object.fromEntries(MUSCLE_KEYS.map((m, i) => [m, i % 5])) as Record<Muscle, number>;

export default function ComponentCatalog() {
  const [segment, setSegment] = useState<'a' | 'b' | 'c'>('a');
  const [days, setDays] = useState<IsoWeekday[]>([1, 3, 5]);
  const [reps, setReps] = useState(10);
  const [kg, setKg] = useState(37.5);
  const [text, setText] = useState('');
  const [on, setOn] = useState(true);
  const [done, setDone] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [applied, setApplied] = useState(false);
  const [lineApplied, setLineApplied] = useState(false);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <Screen>
      <Section label="Escala tipográfica">
        <Card>
          {(Object.keys(type) as TypeName[]).map((name) => (
            <AppText key={name} variant={name} numberOfLines={1}>
              {name} {type[name].fontSize}/{type[name].fontWeight}
            </AppText>
          ))}
        </Card>
      </Section>

      <Section label="Pesos 500 · 600 · 700">
        <Card>
          {(['500', '600', '700'] as const).map((w) => (
            <AppText key={w} variant="bodySm" weight={w}>
              Serie 2 de 3 · peso {w}
            </AppText>
          ))}
        </Card>
      </Section>

      <Section label="Superficies">
        <Card>
          <AppText>Card sobre el fondo</AppText>
          <Block>
            <AppText variant="bodySm">Block dentro de una Card</AppText>
          </Block>
        </Card>
        <Row style={{ gap: spacing.sm }}>
          {(['primary', 'accent', 'warning', 'danger', 'muted', 'border'] as const).map((c) => (
            <View key={c} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors[c] }} />
          ))}
        </Row>
      </Section>

      <Section label="Botones">
        <Button size="xl" icon="check-bold" title="Serie hecha" onPress={() => {}} />
        <Button size="lg" title="Primario lg" onPress={() => {}} />
        <Button kind="secondary" icon="plus" title="Secundario md" onPress={() => {}} />
        <Button kind="tonal" title="Tonal: subir a 12,5 kg" onPress={() => {}} />
        <Button kind="tonalDanger" title="Borrar (confirmación)" onPress={() => {}} />
        <Button disabled title="Deshabilitado" onPress={() => {}} />
        <Row between>
          <Button kind="text" title="Texto" onPress={() => {}} />
          <Button kind="danger" icon="trash-can-outline" title="Borrar" onPress={() => {}} />
        </Row>
        <Row>
          <IconButton icon="share-variant" label="Compartir" onPress={() => {}} />
          <IconButton icon="dots-vertical" label="Más" onPress={() => {}} />
          <IconButton icon="pencil-outline" label="Editar" onPress={() => {}} color={colors.muted} />
          <IconButton icon="pencil-outline" label="Deshabilitado" onPress={() => {}} disabled />
        </Row>
        <View style={{ backgroundColor: colors.cardAlt, padding: spacing.md, borderRadius: 16, gap: spacing.sm, alignItems: 'flex-start' }}>
          <Row>
            <FloatingButton text="3D" label="3D" onPress={() => {}} />
            <FloatingButton icon="arrow-expand" label="Ampliar" onPress={() => {}} />
            <FloatingButton pill icon="fit-to-screen-outline" text="Ver todo" label="Ver todo" onPress={() => {}} />
          </Row>
          <Segmented
            onMap
            style={{ width: 96 }}
            options={[
              { value: 'a', label: '2D' },
              { value: 'b', label: '3D' },
            ]}
            value={segment === 'c' ? 'a' : segment}
            onChange={setSegment}
          />
        </View>
      </Section>

      <Section label="Selección">
        <Segmented
          options={[
            { value: 'a', label: 'Ritmo' },
            { value: 'b', label: 'Velocidad' },
            { value: 'c', label: 'Altitud', disabled: true },
          ]}
          value={segment}
          onChange={setSegment}
        />
        <DayPicker value={days} onChange={setDays} />
        <Row>
          <Chip label="1:30" onPress={() => {}} />
          <Chip label="2:30" selected onPress={() => {}} />
          <CheckMark done={done} onPress={() => setDone(!done)} />
        </Row>
        <Row>
          {(['neutral', 'success', 'warning', 'info', 'danger'] as TagTone[]).map((tone) => (
            <Tag key={tone} label={tone} tone={tone} />
          ))}
          <Tag label="Pruebas" tone="warning" icon="flask-outline" />
        </Row>
      </Section>

      <Section label="Cifras">
        <Value value="5,14" unit="km" size="display" />
        <Value value="11:32" unit="/km" size="metric" />
        <Value value="37,5" unit="kg" size="numberL" />
        <StatRow>
          <Stat label="Duración" value="1 h" />
          <Stat label="Series" value="11" caption="Sin contar 2 aproximaciones" />
          <Stat label="Volumen" value="1900" unit="kg" />
        </StatRow>
        <ProgressBar progress={0.4} />
        <ProgressBar progress={0.38} color={colors.accent} height={6} />
      </Section>

      <Section label="Entradas">
        <Stepper big value={reps} onChange={setReps} />
        <Stepper decimal value={kg} onChange={setKg} step={2.5} typing={false} />
        <TextField label="Título" value={text} onChangeText={setText} placeholder="Caminar" maxLength={40} />
        <TextField label="Peso" value="" onChangeText={() => {}} suffix="kg" error="Escribe un número" keyboard="decimal" />
        <ListGroup>
          <SwitchRow label="Pantalla siempre encendida" subtitle="Durante el entreno" value={on} onValueChange={setOn} />
        </ListGroup>
      </Section>

      <Section label="Listas" right="3">
        <ListGroup inset={72}>
          <ListRow title="Una línea con chevron" onPress={() => {}} left={<RowIcon name="dumbbell" />} />
          <ListRow
            title="Dos líneas con valor"
            subtitle="Vie 30 oct · 11 series"
            right="20 kg"
            onPress={() => {}}
            left={<RowIcon name="walk" />}
          />
          <ListRow title="Con Tag" right={<Tag label="Importado" />} left={<RowIcon name="history" />} onPress={() => {}} />
          <ListRow title="Deshabilitada" disabled left={<RowIcon name="lock-outline" />} />
          <AddRow title="Añadir ejercicio" onPress={() => {}} />
        </ListGroup>
      </Section>

      <Section label="Capas">
        <Button kind="secondary" title="Hoja" onPress={() => setSheet(true)} />
        <Button
          kind="secondary"
          title="Menú de acciones"
          onPress={() =>
            showActions([
              { text: 'Corregir series', icon: 'pencil-outline', onPress: () => {} },
              { text: 'Borrar entreno', icon: 'trash-can-outline', destructive: true, onPress: () => {} },
            ])
          }
        />
        <Button
          kind="secondary"
          title="Diálogo"
          onPress={() =>
            showDialog('¿Borrar la caminata?', 'Desaparece del historial y no se puede deshacer.', [
              { text: 'Borrar', style: 'destructive' },
              { text: 'Cancelar', style: 'cancel' },
            ])
          }
        />
        <Button kind="secondary" title="Diálogo con título" onPress={() => showPrompt('Título', { value: '', placeholder: 'Caminar', maxLength: 40 })} />
        <Button kind="secondary" title="Snackbar" onPress={() => showSnackbar('Serie borrada', { label: 'Deshacer', onPress: () => {} })} />
      </Section>

      <Section label="Sugerencia de peso">
        <Card>
          <SuggestionAction
            change={SAMPLE_UP}
            applied={applied}
            bodyweight={false}
            onApply={async () => setApplied(true)}
            onUndo={async () => setApplied(false)}
          />
          <SuggestionAction change={SAMPLE_DOWN} applied={false} bodyweight={false} onApply={async () => {}} onUndo={async () => {}} />
          <SuggestionLine
            change={SAMPLE_UP}
            applied={lineApplied}
            onApply={async () => setLineApplied(true)}
            onUndo={async () => setLineApplied(false)}
          />
        </Card>
      </Section>

      <Section label="Músculos">
        <ListGroup inset={72}>
          {(Object.keys(PATTERN_LABEL) as MovementPattern[]).map((p) => (
            <ListRow key={p} left={<ExerciseIcon muscles={{ primary: [PATTERN_MUSCLE[p]], secondary: [] }} />} title={PATTERN_LABEL[p]} />
          ))}
          <ListRow left={<ExerciseIcon muscles={undefined} />} title="Sin músculos" />
        </ListGroup>
        <Card>
          <MuscleTags muscles={{ primary: ['lats', 'upper_back'], secondary: ['lower_back', 'rear_delts', 'biceps'] }} />
        </Card>
        <ListGroup inset={72}>
          <SlotRow slot={SLOT} muscles={{ primary: ['lats'], secondary: [] }} onPress={() => {}} />
          <SlotRow slot={{ ...SLOT, exerciseName: 'Fondos en paralelas lastrados', exerciseType: 'bodyweight', weightKg: 15 }} muscles={{ primary: ['chest'], secondary: [] }} onPress={() => {}} />
          <SlotRow slot={{ ...SLOT, exerciseName: 'Dominadas pronas', exerciseType: 'bodyweight', weightKg: null, target: { kind: 'failure', minus: 1 } }} muscles={{ primary: ['lats'], secondary: [] }} />
          <SlotRow slot={{ ...SLOT, exerciseName: 'Sentadilla Búlgara lastrada', exercisePair: true, weightKg: 10, perSide: true }} muscles={undefined} onPress={() => {}} />
        </ListGroup>
        <Card>
          <AppText variant="label">Cada nivel, de 0 a 4</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {HEAT.map((c) => (
              <View key={c} style={{ flex: 1, height: 24, borderRadius: 6, backgroundColor: c }} />
            ))}
          </View>
          <BodyMap levels={SAMPLE_LEVELS} sex="male" width={140} selected="rear_delts" />
          <BodyMap levels={SAMPLE_LEVELS} sex="female" width={140} />
        </Card>
      </Section>

      <Section label="Sprints">
        <SprintTable rows={SPRINT_ROWS} onPickLast={() => showSnackbar('Quitar el último sprint')} />
      </Section>

      <Section label="Estados">
        <Card>
          <EmptyState icon="walk" title="Sin cardio todavía" text="Aquí verás tus caminatas." action={<Button kind="secondary" title="Ir a Hoy" onPress={() => {}} />} />
        </Card>
        <Card>
          <ErrorState text="No se pudo subir la copia." onRetry={() => {}} />
        </Card>
        <Row>
          <Icon name="check-circle" size={20} color={colors.primary} />
          <AppText variant="bodySm">Activado</AppText>
          <Icon name="alert-circle" size={20} color={colors.warning} />
          <AppText variant="bodySm">Falta</AppText>
        </Row>
      </Section>

      <Sheet
        visible={sheet}
        title="Serie 2"
        onClose={() => setSheet(false)}
        action={<Button kind="danger" icon="trash-can-outline" title="Borrar" onPress={() => setSheet(false)} />}>
        <Stepper value={reps} onChange={setReps} typing={false} />
        <Button size="lg" title="Guardar" onPress={() => setSheet(false)} />
      </Sheet>
    </Screen>
  );
}
