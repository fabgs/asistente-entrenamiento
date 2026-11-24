import { useIsFocused } from 'expo-router';
import { BottomTabBar, Tabs, type BottomTabBarProps, type BottomTabNavigationOptions } from 'expo-router/js-tabs';
import { NativeTabs } from 'expo-router/native-tabs';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { setTabBarHeight } from '@/components/layers';
import { Icon, type IconName } from '@/components/ui';
import { colors, type } from '@/theme';

type IconProps = Parameters<NonNullable<BottomTabNavigationOptions['tabBarIcon']>>[0];

function TabIcon({ name, color, size }: IconProps & { name: IconName }) {
  return <Icon name={name} color={color as string} size={size} />;
}

/**
 * Each tab is a folder with its own layout (TabStack, 1.5.6): a stack with a native header. The
 * routes stay the same: «/», «/rutinas», «/historial», «/dieta», «/perfil».
 */
export default function TabsLayout() {
  return Platform.OS === 'ios' ? <IosTabs /> : <JsTabs />;
}

/**
 * iOS (1.5.6): the system's tab bar, the floating Liquid Glass pill of iOS 26, with SF Symbols. It
 * cannot be measured: each tab tells the Snackbar its height (TabStack).
 */
function IosTabs() {
  return (
    <NativeTabs tintColor={colors.primary}>
      <NativeTabs.Trigger name="(hoy)">
        <NativeTabs.Trigger.Label>Hoy</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="rutinas">
        <NativeTabs.Trigger.Label>Rutinas</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'dumbbell', selected: 'dumbbell.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="historial">
        <NativeTabs.Trigger.Label>Historial</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="dieta">
        <NativeTabs.Trigger.Label>Dieta</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="fork.knife" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="perfil">
        <NativeTabs.Trigger.Label>Perfil</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

/** Android: the JS tabs; each tab draws its own header (TabStack). */
function JsTabs() {
  // While the tabs are in front, a Snackbar goes above their bar.
  const focused = useIsFocused();
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    setTabBarHeight(focused ? barHeight : 0);
  }, [focused, barHeight]);

  return (
    <Tabs
      tabBar={(props: BottomTabBarProps) => (
        <View onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}>
          <BottomTabBar {...props} />
        </View>
      )}
      // The header is the native one of each tab's stack (TabStack, 1.5.6).
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        tabBarLabelStyle: type.tag,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}>
      <Tabs.Screen
        name="(hoy)"
        options={{ title: 'Hoy', tabBarIcon: (p) => <TabIcon name="calendar-today" {...p} /> }}
      />
      <Tabs.Screen
        name="rutinas"
        options={{ title: 'Rutinas', tabBarIcon: (p) => <TabIcon name="dumbbell" {...p} /> }}
      />
      <Tabs.Screen
        name="historial"
        options={{ title: 'Historial', tabBarIcon: (p) => <TabIcon name="history" {...p} /> }}
      />
      <Tabs.Screen
        name="dieta"
        options={{ title: 'Dieta', tabBarIcon: (p) => <TabIcon name="food-apple" {...p} /> }}
      />
      <Tabs.Screen
        name="perfil"
        options={{ title: 'Perfil', tabBarIcon: (p) => <TabIcon name="account" {...p} /> }}
      />
    </Tabs>
  );
}
