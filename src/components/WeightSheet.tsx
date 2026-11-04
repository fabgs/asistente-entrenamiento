import { useState } from 'react';
import type { WeightEntry } from '@/db/repositories/settings';
import { formatDateWithYear, formatNumber } from '@/domain/format';
import { Sheet } from './Sheet';
import { AppText, Button, Stepper } from './ui';

/**
 * Today's weight (`entry` null) or a past weigh-in: a stepper of 0,1 kg that starts at `start`.
 * A weigh-in can be deleted unless it is the only one (the targets need a weight).
 */
export function WeightSheet({
  open,
  entry,
  start,
  canDelete,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  entry: WeightEntry | null;
  start: number;
  canDelete: boolean;
  onClose: () => void;
  onSave: (kg: number) => void;
  onDelete: (entry: WeightEntry) => void;
}) {
  return (
    <Sheet
      visible={open}
      title={entry ? formatDateWithYear(entry.date) : 'Registrar peso'}
      onClose={onClose}
      action={
        entry && canDelete ? (
          <Button kind="danger" icon="trash-can-outline" title="Borrar" onPress={() => onDelete(entry)} />
        ) : null
      }>
      {/* Keyed so that every opening starts again from the last weight. */}
      {open ? <WeightPicker key={entry?.date ?? 'new'} start={start} onSave={onSave} /> : null}
    </Sheet>
  );
}

function WeightPicker({ start, onSave }: { start: number; onSave: (kg: number) => void }) {
  const [kg, setKg] = useState(start);
  return (
    <>
      <AppText variant="label" style={{ textAlign: 'center' }}>
        Peso en kg
      </AppText>
      <Stepper big decimal typing={false} value={kg} onChange={setKg} step={0.1} min={20} format={(v) => formatNumber(v, 1)} />
      <Button size="lg" title="Guardar" disabled={kg <= 0} onPress={() => onSave(kg)} />
    </>
  );
}
