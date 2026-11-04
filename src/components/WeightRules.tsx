import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Settings } from '@/db/repositories/settings';
import { formatKg } from '@/domain/format';
import {
  DEFAULT_PROGRESSION,
  INCREMENT_LIMITS,
  lowerExamples,
  raiseExamples,
  SESSIONS_BELOW_LIMITS,
  type RuleExample,
} from '@/domain/progression';
import type { ProgressionMode } from '@/domain/types';
import { colors, radius, spacing } from '@/theme';
import { Sheet } from './Sheet';
import { AppText, Button, Icon, ListGroup, ListRow, NumberRow, Row, Section, Segmented } from './ui';

type Rules = Pick<Settings, 'defaultIncrementKg' | 'progressionMode' | 'sessionsBelowToDecrease'>;

const MODE_NAMES: Record<ProgressionMode, { short: string; long: string }> = {
  average: { short: 'Por la media', long: 'La media pasa del máximo' },
  strict: { short: 'Todas las series', long: 'Todas las series llegan al máximo' },
};

const sessionsLabel = (n: number) => `Tras ${n} ${n === 1 ? 'sesión' : 'sesiones'}`;

/** The rules work from the next workout on: suggestions already made are not rewritten (PLAN.md §6.2). */
const FROM_NEXT = 'Cuenta desde el próximo entreno';

/**
 * Ajustes · «Sugerencias de peso» (PLAN.md §8): the default increment and when the weight goes up
 * or down, each in a sheet that saves at once and shows what it does with an example worked out by
 * the engine itself.
 */
export function WeightRulesSection({
  rules,
  ownIncrements,
  onChange,
}: {
  rules: Rules;
  /** Exercises with their own increment, which the default does not touch. */
  ownIncrements: number;
  onChange: (patch: Partial<Rules>) => void;
}) {
  const [open, setOpen] = useState<'increment' | 'raise' | 'lower' | null>(null);
  const engine = { defaultIncrementKg: rules.defaultIncrementKg, mode: rules.progressionMode, sessionsBelowToDecrease: rules.sessionsBelowToDecrease };
  const close = () => setOpen(null);

  return (
    <Section label="Sugerencias de peso">
      <ListGroup>
        <ListRow title="Incremento" right={formatKg(rules.defaultIncrementKg)} onPress={() => setOpen('increment')} />
        <ListRow title="Cuándo subir" right={MODE_NAMES[rules.progressionMode].short} onPress={() => setOpen('raise')} />
        <ListRow title="Cuándo bajar" right={sessionsLabel(rules.sessionsBelowToDecrease)} onPress={() => setOpen('lower')} />
      </ListGroup>

      <Sheet visible={open === 'increment'} title="Incremento" onClose={close}>
        <NumberRow
          label="Cada vez"
          value={rules.defaultIncrementKg}
          onChange={(defaultIncrementKg) => onChange({ defaultIncrementKg })}
          step={INCREMENT_LIMITS.step}
          min={INCREMENT_LIMITS.min}
          max={INCREMENT_LIMITS.max}
          format={formatKg}
        />
        <View style={styles.notes}>
          <AppText variant="secondary">
            {`Con 35 kg: subir a ${formatKg(35 + rules.defaultIncrementKg)} o bajar a ${formatKg(35 - rules.defaultIncrementKg)}. También es el paso de − y + al cambiar el peso en el entreno.`}
          </AppText>
          {ownIncrements > 0 ? (
            <AppText variant="secondary">
              {ownIncrements === 1
                ? '1 ejercicio tiene incremento propio y no cambia.'
                : `${ownIncrements} ejercicios tienen incremento propio y no cambian.`}
            </AppText>
          ) : null}
          <AppText variant="caption">{FROM_NEXT}</AppText>
        </View>
        <BackTo
          visible={rules.defaultIncrementKg !== DEFAULT_PROGRESSION.defaultIncrementKg}
          label={`Volver a ${formatKg(DEFAULT_PROGRESSION.defaultIncrementKg)}`}
          onPress={() => onChange({ defaultIncrementKg: DEFAULT_PROGRESSION.defaultIncrementKg })}
        />
        <Button size="lg" title="Listo" onPress={close} />
      </Sheet>

      <Sheet visible={open === 'raise'} title="Cuándo subir el peso" onClose={close}>
        <ListGroup style={{ backgroundColor: colors.cardAlt }}>
          {(['average', 'strict'] as const).map((mode) => (
            <ListRow
              key={mode}
              title={MODE_NAMES[mode].long}
              chevron={false}
              right={rules.progressionMode === mode ? <Icon name="check" size={22} color={colors.primary} /> : undefined}
              onPress={() => onChange({ progressionMode: mode })}
            />
          ))}
        </ListGroup>
        <Example title="Ejemplo en 10–12 reps con 35 kg" lines={raiseExamples(engine)} />
        <AppText variant="caption">{FROM_NEXT}</AppText>
        <Button size="lg" title="Listo" onPress={close} />
      </Sheet>

      <Sheet visible={open === 'lower'} title="Cuándo bajar el peso" onClose={close}>
        <View style={styles.field}>
          <AppText variant="label">Sesiones seguidas por debajo del mínimo</AppText>
          <Segmented
            options={Array.from({ length: SESSIONS_BELOW_LIMITS.max - SESSIONS_BELOW_LIMITS.min + 1 }, (_, i) => {
              const n = String(SESSIONS_BELOW_LIMITS.min + i);
              return { value: n, label: n };
            })}
            value={String(rules.sessionsBelowToDecrease)}
            onChange={(n) => onChange({ sessionsBelowToDecrease: Number(n) })}
          />
        </View>
        <Example title="Ejemplo en 10–12 reps con 20 kg" lines={lowerExamples(engine)} />
        <View style={styles.notes}>
          <AppText variant="secondary">Solo en los ejercicios con «Proponer bajar el peso».</AppText>
          <AppText variant="caption">{FROM_NEXT}</AppText>
        </View>
        <Button size="lg" title="Listo" onPress={close} />
      </Sheet>
    </Section>
  );
}

/** Sessions and what the suggestion would say: «14, 12 y 11 · Subir a 37,5 kg». */
function Example({ title, lines }: { title: string; lines: RuleExample[] }) {
  return (
    <View style={styles.example}>
      <AppText variant="label">{title}</AppText>
      {lines.map((l) => (
        <Row key={l.label} between>
          <AppText variant="bodySm" tabular style={styles.flex}>
            {l.label}
          </AppText>
          <AppText variant="rowValue" tabular>
            {l.outcome}
          </AppText>
        </Row>
      ))}
    </View>
  );
}

/** «Volver a 2,5 kg», only while the value is not the default one. */
export function BackTo({ visible, label, onPress }: { visible: boolean; label: string; onPress: () => void }) {
  if (!visible) return null;
  return <Button kind="text" title={label} onPress={onPress} style={styles.backTo} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notes: { gap: spacing.xs },
  field: { gap: spacing.sm },
  // Same corners and text inset as the list of choices above it.
  example: { gap: spacing.sm, backgroundColor: colors.cardAlt, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backTo: { alignSelf: 'flex-start' },
});
