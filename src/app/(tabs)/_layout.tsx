import { useIsFocused } from 'expo-router';
import { BottomTabBar, Tabs, type BottomTabBarProps, type BottomTabNavigationOptions } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { setTabBarHeight } from '@/components/layers';
import { Icon, type IconName } from '@/components/ui';
import { colors, headerOptions, type } from '@/theme';

type IconProps = Parameters<NonNullable<BottomTabNavigationOptions['tabBarIcon']>>[0];

function TabIcon({ name, color, size }: IconProps & { name: IconName }) {
  return <Icon name={name} color={color as string} size={size} />;
}

export default function TabsLayout() {
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
      screenOptions={{
        ...headerOptions,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        tabBarLabelStyle: type.tag,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}>
      <Tabs.Screen
        name="index"
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
