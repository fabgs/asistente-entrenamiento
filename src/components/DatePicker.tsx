import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { setDatePickerPresenter, type DatePickRequest } from './datePick';
import { Sheet } from './Sheet';
import { Button } from './ui';

/** The iOS sheet of `pickDate` (datePick.ts): the system wheel and «Listo». Mounted once, at the root. */
export function DatePickerHost() {
  const [request, setRequest] = useState<DatePickRequest | null>(null);
  const [draft, setDraft] = useState<Date>(new Date(0));
  useEffect(() => {
    setDatePickerPresenter((next) => {
      if (next) setDraft(next.value);
      setRequest(next);
    });
    return () => setDatePickerPresenter(null);
  }, []);

  return (
    <Sheet visible={request !== null} title={request?.title ?? ''} onClose={() => setRequest(null)}>
      {request ? (
        <DateTimePicker
          value={draft}
          mode={request.mode}
          display="spinner"
          locale="es-ES"
          maximumDate={request.maximumDate}
          onChange={(_, date) => {
            if (date) setDraft(date);
          }}
        />
      ) : null}
      <Button
        size="lg"
        title="Listo"
        onPress={() => {
          request?.onPick(draft);
          setRequest(null);
        }}
      />
    </Sheet>
  );
}
