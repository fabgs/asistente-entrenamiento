import { StyleSheet, View } from 'react-native';
import { applyChange, dismissChange, undoChange, type WeightChange } from '@/db/repositories/weightChanges';
import { formatKg } from '@/domain/format';
import { useDb } from '@/hooks/data';
import { colors, radius, spacing } from '@/theme';
import { AppText, Button, Row } from './ui';

const isUp = (change: WeightChange) => (change.toKg ?? 0) > (change.fromKg ?? 0);

export function ChangeArrow({ change }: { change: WeightChange }) {
  const up = isUp(change);
  return (
    <AppText style={{ color: up ? colors.up : colors.down, fontWeight: '700' }}>
      {up ? '↑' : '↓'} {formatKg(change.fromKg ?? 0)} → {formatKg(change.toKg ?? 0)}
    </AppText>
  );
}

/** A weight recommendation the user decides on; nothing is applied automatically. */
export function RecommendationBox({
  change,
  onChanged,
  onLater,
  title,
}: {
  change: WeightChange;
  onChanged: () => void;
  onLater?: () => void;
  title?: string;
}) {
  const db = useDb();
  const act = (fn: () => Promise<void>) => async () => {
    await fn();
    onChanged();
  };

  return (
    <View style={[styles.box, change.status !== 'pending' && styles.quiet]}>
      {title ? <AppText variant="small">{title}</AppText> : null}
      <ChangeArrow change={change} />
      <AppText variant="small">{change.reason}</AppText>
      {change.status === 'pending' ? (
        <Row>
          <Button title="Aplicar" onPress={act(() => applyChange(db, change.id))} />
          <Button kind="secondary" title="Ignorar" onPress={act(() => dismissChange(db, change.id))} />
          {onLater ? <Button kind="ghost" title="Ahora no" onPress={onLater} /> : null}
        </Row>
      ) : change.status === 'dismissed' ? (
        <Row>
          <AppText variant="small">Ignorada, sigue disponible como sugerencia</AppText>
          <Button kind="ghost" title="Aplicar" onPress={act(() => applyChange(db, change.id))} />
        </Row>
      ) : change.status === 'applied' ? (
        <Row>
          <AppText style={{ color: colors.primary }}>Aplicado ✓</AppText>
          <Button kind="ghost" title="Deshacer" onPress={act(() => undoChange(db, change.id))} />
        </Row>
      ) : (
        <AppText variant="small">Sustituida por otra recomendación</AppText>
      )}
    </View>
  );
}

/** Quiet reminder on the exercise of a recommendation that was ignored or postponed. */
export function SuggestionLine({ change, onChanged }: { change: WeightChange; onChanged: () => void }) {
  const db = useDb();
  const apply = async () => {
    await applyChange(db, change.id);
    onChanged();
  };
  return (
    <Row style={styles.suggestion}>
      <AppText variant="small" style={{ flex: 1 }}>
        Sugerencia:{' '}
        <AppText variant="small" style={{ color: isUp(change) ? colors.up : colors.down, fontWeight: '700' }}>
          {isUp(change) ? '↑' : '↓'} {formatKg(change.toKg ?? 0)}
        </AppText>
      </AppText>
      <Button kind="ghost" title="Aplicar" onPress={apply} style={styles.suggestionButton} />
    </Row>
  );
}

/** Full box while a decision is pending, quiet line once it was ignored or postponed. */
export function OpenChange({
  change,
  onChanged,
  quiet = false,
}: {
  change: WeightChange;
  onChanged: () => void;
  quiet?: boolean;
}) {
  if (change.status === 'pending' && !quiet) return <RecommendationBox change={change} onChanged={onChanged} />;
  return <SuggestionLine change={change} onChanged={onChanged} />;
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  quiet: { borderLeftColor: colors.border },
  suggestion: {
    justifyContent: 'space-between',
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    paddingLeft: spacing.md,
  },
  suggestionButton: { paddingVertical: spacing.sm },
});
