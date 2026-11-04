import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { applyChange, dismissChange, undoChange, type WeightChange } from '@/db/repositories/weightChanges';
import { formatKg } from '@/domain/format';
import { useDb } from '@/hooks/data';
import { colors, radius, spacing } from '@/theme';
import { AppText, Button, Icon, useArmed, useBusy } from './ui';

const isUp = (change: WeightChange) => (change.toKg ?? 0) > (change.fromKg ?? 0);
/** "Subir a 12,5 kg" / "Bajar a 17,5 kg": the button says what happens. */
const moveLabel = (change: WeightChange) => `${isUp(change) ? 'Subir' : 'Bajar'} a ${formatKg(change.toKg ?? 0)}`;
const arrowColor = (change: WeightChange) => (isUp(change) ? colors.up : colors.down);

export function ChangeArrow({ change, size = 16 }: { change: WeightChange; size?: number }) {
  return <Icon name={isUp(change) ? 'arrow-up-bold' : 'arrow-down-bold'} size={size} color={arrowColor(change)} />;
}

/**
 * A weight suggestion to decide on (Hoy and the summary); nothing is applied automatically.
 * «Mantener» leaves it as a quiet suggestion that can still be applied later.
 */
export function RecommendationBox({ change, onChanged }: { change: WeightChange; onChanged: () => void }) {
  const db = useDb();
  const act = (fn: () => Promise<void>) => async () => {
    await fn();
    onChanged();
  };

  if (change.status === 'dismissed') return <SuggestionLine change={change} onChanged={onChanged} />;
  if (change.status === 'expired') return <AppText variant="caption">Sustituida por otra sugerencia.</AppText>;
  if (change.status === 'applied') {
    return (
      <View style={styles.appliedRow}>
        <Icon name="check" size={16} color={colors.primary} />
        <AppText variant="bodySm" weight="600" style={{ flex: 1 }}>
          Ahora {formatKg(change.toKg ?? 0)}
        </AppText>
        <Button kind="text" title="Deshacer" onPress={act(() => undoChange(db, change.id))} />
      </View>
    );
  }
  return (
    <View style={styles.box}>
      <View style={styles.headRow}>
        <ChangeArrow change={change} size={18} />
        <AppText variant="label" weight="600">
          Sugerencia de peso
        </AppText>
      </View>
      <AppText variant="bodySm">{change.reason}</AppText>
      <View style={styles.buttons}>
        <Button kind="tonal" title={moveLabel(change)} onPress={act(() => applyChange(db, change.id))} style={{ flex: 1 }} />
        <Button
          kind="secondary"
          title={`Mantener ${formatKg(change.fromKg ?? 0)}`}
          onPress={act(() => dismissChange(db, change.id))}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

/**
 * One line: «Sugerencia: subir a 12,5 kg», with a small «Aplicar» unless `readOnly` (the workout
 * list applies it in the set itself). In the set screen (`onApply`/`onUndo`), once applied it reads
 * «Ahora 12,5 kg · Deshacer». `boxed` puts it on a surface of its own, with «Aplicar» inside: under
 * an exercise of a list, so it does not float between rows.
 */
export function SuggestionLine({
  change,
  onChanged,
  readOnly = false,
  applied = false,
  boxed = false,
  onApply,
  onUndo,
}: {
  change: WeightChange;
  onChanged?: () => void;
  readOnly?: boolean;
  applied?: boolean;
  boxed?: boolean;
  onApply?: () => Promise<void>;
  onUndo?: () => Promise<void>;
}) {
  const db = useDb();
  const armed = useArmed(applied ? 'applied' : 'open');
  const [busy, run] = useBusy();
  const apply =
    onApply ??
    (async () => {
      await applyChange(db, change.id);
      onChanged?.();
    });

  if (applied) {
    return (
      <View style={styles.line} pointerEvents={armed && !busy ? 'auto' : 'none'}>
        <Icon name="check" size={16} color={colors.primary} />
        <AppText variant="secondary" weight="600" style={styles.lineText} numberOfLines={2}>
          Ahora {formatKg(change.toKg ?? 0)}
        </AppText>
        {onUndo ? <Button kind="text" title="Deshacer" onPress={run(onUndo)} /> : null}
      </View>
    );
  }
  return (
    <View style={[styles.line, boxed && styles.lineBox]} pointerEvents={armed && !busy ? 'auto' : 'none'}>
      <ChangeArrow change={change} />
      <AppText variant="secondary" weight="600" style={styles.lineText} numberOfLines={2}>
        Sugerencia: {moveLabel(change).toLowerCase()}
      </AppText>
      {readOnly ? null : (
        <Pressable
          onPress={run(apply)}
          hitSlop={8}
          style={styles.smallTonal}
          accessibilityRole="button"
          accessibilityLabel={`Aplicar: ${moveLabel(change).toLowerCase()}`}>
          <AppText variant="secondary" weight="600" style={{ color: colors.primary }}>
            Aplicar
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The weight suggestion in the set screen, under the weight and before the first set: tapping it
 * applies it and it turns into «Deshacer» in the same place and size. Taps are ignored for 600 ms
 * after each change, so a double tap does not undo it.
 */
export function SuggestionAction({
  change,
  applied,
  bodyweight,
  onApply,
  onUndo,
}: {
  change: WeightChange;
  applied: boolean;
  bodyweight: boolean;
  onApply: () => Promise<void>;
  onUndo: () => Promise<void>;
}) {
  const armed = useArmed(applied ? 'applied' : 'pending');
  const [busy, run] = useBusy();
  // «Deshacer» keeps the height of the suggestion, whose reason may take two lines.
  const [pendingHeight, setPendingHeight] = useState<number>();
  const before = change.fromKg ? formatKg(change.fromKg) : bodyweight ? 'peso corporal' : formatKg(0);
  const title = applied ? 'Deshacer' : moveLabel(change);
  const detail = applied ? `Vuelve a ${before}` : change.reason;
  return (
    <View pointerEvents={armed && !busy ? 'auto' : 'none'}>
      <Pressable
        onPress={run(applied ? onUndo : onApply)}
        onLayout={applied ? undefined : (e) => setPendingHeight(e.nativeEvent.layout.height)}
        android_ripple={{ color: colors.ripple }}
        style={[styles.action, applied && styles.actionUndo, applied && { minHeight: pendingHeight ?? 64 }]}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${detail}`}
        accessibilityHint={applied ? undefined : 'También para las próximas sesiones'}>
        {applied ? <Icon name="undo" size={20} /> : <ChangeArrow change={change} size={20} />}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="rowValue" numberOfLines={1} style={{ color: applied ? colors.text : colors.primary }}>
            {title}
          </AppText>
          <AppText variant="caption" numberOfLines={3}>
            {detail}
          </AppText>
        </View>
      </Pressable>
    </View>
  );
}

/** Pending suggestions get the full decision; ignored ones, the quiet line. */
export function OpenChange({
  change,
  onChanged,
  quiet = false,
  boxed = false,
}: {
  change: WeightChange;
  onChanged: () => void;
  quiet?: boolean;
  boxed?: boolean;
}) {
  if (change.status === 'pending' && !quiet) return <RecommendationBox change={change} onChanged={onChanged} />;
  return <SuggestionLine change={change} onChanged={onChanged} boxed={boxed} />;
}

/** Why the weight stays the same (summary). `manual`: there is no rule, the reason says so itself. */
export function NoChangeLine({ reason, manual = false }: { reason: string; manual?: boolean }) {
  return (
    <View style={styles.headRow}>
      <Icon name="equal" size={16} color={colors.muted} />
      <AppText variant="muted" style={{ flex: 1 }}>
        {manual ? reason : `Se mantiene: ${reason.charAt(0).toLowerCase() + reason.slice(1)}`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  appliedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  lineText: { flex: 1, color: colors.text },
  // «Aplicar» (32 dp) sits 6 dp from the top, bottom and end of the 44 dp line.
  lineBox: { backgroundColor: colors.cardAlt, borderRadius: radius.lg, paddingLeft: spacing.md, paddingRight: 6 },
  smallTonal: {
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    justifyContent: 'center',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    overflow: 'hidden',
  },
  actionUndo: { backgroundColor: colors.cardAlt },
});
