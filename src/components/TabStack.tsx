import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, headerOptions } from '@/theme';
import { setNativeTabBarHeight } from './layers';

/**
 * The layout of each tab (1.5.6): a native stack with one screen, so its title and its buttons
 * (`navigation.setOptions`) go in a native header, like every other screen of the app. On iOS that
 * is the header of iOS 26, the buttons in their glass, over the native tab bar; on Android, the
 * header the JS tabs used to draw (they no longer draw one).
 */
export function TabStack({ title }: { title: string }) {
  return (
    <>
      {Platform.OS === 'ios' ? <NativeTabBarHeight /> : null}
      <Stack screenOptions={{ ...headerOptions, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" options={{ title }} />
      </Stack>
    </>
  );
}

/** The floating bar never takes less than this above the bottom of the screen. */
const MIN_TAB_BAR = 56;

/**
 * The native tab bar of iOS cannot be measured: inside a tab the safe area includes it, so the tab
 * in front tells the Snackbar how much of the bottom it takes.
 */
function NativeTabBarHeight() {
  const insets = useSafeAreaInsets();
  const owner = useRef({}).current;
  const height = Math.max(insets.bottom, (initialWindowMetrics?.insets.bottom ?? 0) + MIN_TAB_BAR);
  useFocusEffect(
    useCallback(() => {
      setNativeTabBarHeight(owner, height);
      return () => setNativeTabBarHeight(owner, null);
    }, [owner, height]),
  );
  return null;
}
