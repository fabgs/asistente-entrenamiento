import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

export interface DatePickRequest {
  value: Date;
  mode: 'date' | 'time';
  /** The title of the sheet on iOS («Fecha de nacimiento», «Hora del aviso»). */
  title: string;
  maximumDate?: Date;
  onPick: (date: Date) => void;
}

let present: ((request: DatePickRequest | null) => void) | null = null;

/** DatePickerHost registers itself here. */
export function setDatePickerPresenter(presenter: typeof present): void {
  present = presenter;
}

/**
 * The system's date or time picker. Android has its dialog; iOS (1.5.6) has no dialog that opens on
 * its own, so the wheel goes in a sheet with «Listo» (DatePickerHost, mounted once at the root).
 */
export function pickDate(request: DatePickRequest): void {
  if (Platform.OS === 'android') {
    DateTimePickerAndroid.open({
      value: request.value,
      mode: request.mode,
      is24Hour: true,
      maximumDate: request.maximumDate,
      onChange: (event, date) => {
        if (event.type === 'set' && date) request.onPick(date);
      },
    });
    return;
  }
  present?.(request);
}
