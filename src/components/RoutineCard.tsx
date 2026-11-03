import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { isBodyweight, type Routine, type Slot } from '@/db/repositories/routines';
import { applyChange, type WeightChange } from '@/db/repositories/weightChanges';
import { formatLoad, formatTarget } from '@/domain/format';
import { WEEKDAY_NAMES } from '@/domain/schedule';
import type { IsoWeekday } from '@/domain/types';
import { useDb } from '@/hooks/data';
import { colors, spacing } from '@/theme';
import { OpenChange, SuggestionLine } from './Recommendation';
import { AppText, Button, Card, Icon, IconButton, RowIcon, SectionLabel, Tag, useBusy } from './ui';

/** "Lunes", "Lunes y jueves", "Lunes, miércoles y viernes" or "Sin día". */
export function weekdaysLabel(days: IsoWeekday[]): string {
  const names = days.map((d, i) => (i === 0 ? WEEKDAY_NAMES[d] : WEEKDAY_NAMES[d].toLowerCase()));
  if (names.length === 0) return 'Sin día';
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0];
}

/** "7 ejercicios · 19 series" or "Sin ejercicios". */
export function routineCounts(slots: Slot[]): string {
  if (slots.length === 0) return 'Sin ejercicios';
  const sets = slots.reduce((sum, s) => sum + s.sets, 0);
  return `${slots.length} ${slots.length === 1 ? 'ejercicio' : 'ejercicios'} · ${sets} ${sets === 1 ? 'serie' : 'series'}`;
}

const suggestionsLabel = (n: number) => (n === 1 ? '1 sugerencia' : `${n} sugerencias`);

/** Cards unfolded while the app is open; on purpose not saved (D30). */
const unfolded = new Set<string>();

interface CardBase {
  routine: Routine;
  slots: Slot[];
  /** Open weight changes (pending and dismissed) of any slot: the card picks those of its own. */
  openChanges: WeightChange[];
  /** After a suggestion is applied or decided from the card. */
  onChanged: () => void;
}

/** Hoy: the state of the routine, its start button and the suggestions to decide on. */
interface TodayCardProps extends CardBase {
  mode: 'today';
  /** «Empezar rutina» or «Continuar entreno» (with play); without it there is no button. */
  startLabel?: string;
  onStart?: () => void;
  /** «En curso» Tag, or the check of a routine already done today. */
  state?: 'running' | 'done';
}

/** Rutinas: the days, the pencil to its editor and compact suggestions with «Aplicar». */
interface RoutinesCardProps extends CardBase {
  mode: 'routines';
  onEdit: () => void;
  /** Tapping an exercise opens its editor (the row then has a chevron). */
  onOpenSlot?: (slot: Slot) => void;
}

export type RoutineCardProps = TodayCardProps | RoutinesCardProps;

/**
 * A routine folded to its title, with its exercises and weights unfolded. Folded at first; what is
 * unfolded stays so while the app is open (each mode on its own).
 */
export function RoutineCard(props: RoutineCardProps) {
  const { routine, slots, openChanges, onChanged } = props;
  const db = useDb();
  const key = `${props.mode}:${routine.id}`;
  const [expanded, setExpanded] = useState(() => unfolded.has(key));
  const open = openChanges.filter((c) => slots.some((s) => s.id === c.slotId));
  const pending = open.filter((c) => c.status === 'pending');
  const canExpand = slots.length > 0;
  const today = props.mode === 'today' ? props : null;
  const openSlot = props.mode === 'routines' ? props.onOpenSlot : undefined;
  const subtitle = today ? routineCounts(slots) : `${weekdaysLabel(routine.weekdays)} · ${routineCounts(slots)}`;

  const toggle = () => {
    if (expanded) unfolded.delete(key);
    else unfolded.add(key);
    setExpanded(!expanded);
  };

  const [, run] = useBusy();
  const applyAll = run(async () => {
    for (const change of pending) await applyChange(db, change.id);
    onChanged();
  });

  return (
    <Card>
      <View style={styles.head}>
        <Pressable
          onPress={toggle}
          disabled={!canExpand}
          style={styles.toggle}
          accessibilityRole="button"
          accessibilityState={canExpand ? { expanded } : undefined}
          accessibilityHint={canExpand ? 'Muestra u oculta los ejercicios' : undefined}>
          {today ? (
            <RowIcon
              name={today.state === 'done' ? 'check-circle' : 'dumbbell'}
              color={today.state === 'done' ? colors.primary : colors.text}
            />
          ) : null}
          <View style={styles.titles}>
            <AppText variant="heading">{routine.name}</AppText>
            <View style={styles.subRow}>
              <AppText variant="secondary">{subtitle}</AppText>
              {today?.state === 'running' ? <Tag label="En curso" tone="info" /> : null}
              {pending.length > 0 ? <Tag label={suggestionsLabel(pending.length)} tone="warning" /> : null}
            </View>
          </View>
          {canExpand ? <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={24} color={colors.muted} /> : null}
        </Pressable>
        {props.mode === 'routines' ? (
          <View style={styles.edit}>
            <IconButton
              icon="pencil-outline"
              label={`Editar ${routine.name}`}
              size={22}
              color={colors.muted}
              onPress={props.onEdit}
            />
          </View>
        ) : null}
      </View>

      {today?.startLabel && today.onStart && today.state !== 'done' ? (
        <Button size="lg" icon="play" title={today.startLabel} onPress={today.onStart} />
      ) : null}

      {expanded && canExpand ? (
        <View>
          <SectionLabel
            flush
            right={
              pending.length > 1 ? (
                <Button kind="text" title={`Aplicar las ${pending.length} sugerencias`} onPress={applyAll} />
              ) : undefined
            }>
            Ejercicios
          </SectionLabel>
          <View style={styles.slots}>
            {slots.map((slot) => {
              const change = open.find((c) => c.slotId === slot.id);
              const suggestion = !change ? null : today ? (
                <OpenChange change={change} onChanged={onChanged} />
              ) : (
                <SuggestionLine change={change} onChanged={onChanged} />
              );
              return (
                <SlotRow
                  key={slot.id}
                  slot={slot}
                  onOpen={openSlot ? () => openSlot(slot) : undefined}
                  suggestion={suggestion}
                />
              );
            })}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/** An exercise of the unfolded card: dividers from edge to edge, the weight in white on the right. */
function SlotRow({ slot, onOpen, suggestion }: { slot: Slot; onOpen?: () => void; suggestion: ReactNode }) {
  const main = (
    <>
      <View style={styles.slotHead}>
        <AppText variant="rowTitle" style={styles.flex}>
          {slot.exerciseName}
        </AppText>
        <AppText variant="rowValue" tabular>
          {formatLoad(slot.weightKg, isBodyweight(slot))}
        </AppText>
        {onOpen ? <Icon name="chevron-right" size={20} color={colors.muted} /> : null}
      </View>
      <AppText variant="secondary">{`${slot.sets} × ${formatTarget(slot.target, slot.unit, slot.perSide)}`}</AppText>
    </>
  );
  return (
    <View style={styles.slot}>
      {onOpen ? (
        <Pressable
          onPress={onOpen}
          android_ripple={{ color: colors.pressed }}
          style={styles.slotMain}
          accessibilityRole="button"
          accessibilityHint="Abre el ejercicio de la rutina">
          {main}
        </Pressable>
      ) : (
        <View style={styles.slotMain}>{main}</View>
      )}
      {suggestion ? <View style={styles.suggestion}>{suggestion}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titles: { flex: 1, gap: spacing.xs },
  subRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  edit: { marginRight: -spacing.md },
  slots: { marginTop: spacing.sm },
  slot: {
    marginHorizontal: -spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  slotMain: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestion: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, marginTop: -spacing.xs },
});
