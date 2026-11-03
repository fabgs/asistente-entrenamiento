import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { canDrawOverlays, isIgnoringBatteryOptimizations, stopRestCountdown } from '../../modules/rest-timer';

// Android channels are immutable once created: bump the suffix when changing sound or importance.
export const REST_CHANNEL_ID = 'rest-timer-v1';
export const DAILY_CHANNEL_ID = 'daily-reminder-v1';
export const REST_SOUND = 'rest_end.wav';

export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      priority: Notifications.AndroidNotificationPriority.MAX,
    }),
  });
}

export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REST_CHANNEL_ID, {
    name: 'Fin del descanso',
    description: 'Suena cuando termina el descanso entre series',
    importance: Notifications.AndroidImportance.MAX,
    sound: REST_SOUND,
    enableVibrate: true,
    vibrationPattern: [0, 400, 200, 400, 200, 700],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
  });
  await Notifications.setNotificationChannelAsync(DAILY_CHANNEL_ID, {
    name: 'Recordatorio diario',
    description: 'Lo que toca entrenar hoy',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export interface PermissionState {
  notifications: boolean;
  exactAlarms: boolean;
  overlay: boolean;
  /** The app is out of battery optimization; null if this build cannot tell. */
  batteryUnrestricted: boolean | null;
}

export async function getPermissionState(): Promise<PermissionState> {
  const android = Platform.OS === 'android';
  const notifications = (await Notifications.getPermissionsAsync()).granted;
  const exactAlarms = android ? (await Notifications.getExactAlarmPermissionsAsync()).granted : true;
  return {
    notifications,
    exactAlarms,
    overlay: canDrawOverlays(),
    batteryUnrestricted: android ? isIgnoringBatteryOptimizations() : true,
  };
}

export async function requestNotificationPermission(): Promise<boolean> {
  return (await Notifications.requestPermissionsAsync()).granted;
}

export async function requestExactAlarmPermission(): Promise<void> {
  if (Platform.OS === 'android') await Notifications.requestExactAlarmPermissionsAsync();
}

const androidPackage = () => Constants.expoConfig?.android?.package ?? 'com.fabgs.entreno';

/** Asks Android to stop optimizing battery for the app, so alarms are not delayed. */
export async function openBatteryOptimizationSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      { data: `package:${androidPackage()}` },
    );
  } catch {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
    );
  }
}

/** "Display over other apps" permission, needed for the floating rest bubble. */
export async function openOverlaySettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_OVERLAY_PERMISSION, {
    data: `package:${androidPackage()}`,
  });
}

export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
    extra: { 'android.provider.extra.APP_PACKAGE': androidPackage() },
  });
}

/** Cancels every pending alarm and reminder (after wiping or restoring data). */
export async function resetNotifications(): Promise<void> {
  stopRestCountdown();
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.dismissAllNotificationsAsync();
}

export async function countScheduledNotifications(): Promise<number> {
  return (await Notifications.getAllScheduledNotificationsAsync()).length;
}
