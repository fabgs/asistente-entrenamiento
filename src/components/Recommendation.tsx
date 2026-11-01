import { StyleSheet, View } from 'react-native';
import { applyChange, dismissChange, undoChange, type WeightChange } from '@/db/repositories/weightChanges';
import { formatKg } from '@/domain/format';
import { useDb } from '@/hooks/data';
import { colors, radius, spacing } from '@/theme';
import { AppText, Button, Row } from './ui';

export function ChangeArrow({ change }: { change: WeightChange }) {
  const up = (change.toKg ?? 0) > (change.fromKg ?? 0);
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
    <View style={styles.box}>
      {title ? <AppText variant="small">{title}</AppText> : null}
      <ChangeArrow change={change} />
      <AppText variant="small">{change.reason}</AppText>
      {change.status === 'pending' ? (
        <Row>
          <Button title="Aplicar" onPress={act(() => applyChange(db, change.id))} />
          <Button kind="secondary" title="Ignorar" onPress={act(() => dismissChange(db, change.id))} />
          {onLater ? <Button kind="ghost" title="Ahora no" onPress={onLater} /> : null}
        </Row>
      ) : change.status === 'applied' ? (
        <Row>
          <AppText style={{ color: colors.primary }}>Aplicado ✓</AppText>
          <Button kind="ghost" title="Deshacer" onPress={act(() => undoChange(db, change.id))} />
        </Row>
      ) : (
        <AppText variant="small">{change.status === 'dismissed' ? 'Ignorado' : 'Sustituido por otra recomendación'}</AppText>
      )}
    </View>
  );
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
});
