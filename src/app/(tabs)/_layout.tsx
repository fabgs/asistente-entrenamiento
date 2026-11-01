import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, type BottomTabNavigationOptions } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { colors } from '@/theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type IconProps = Parameters<NonNullable<BottomTabNavigationOptions['tabBarIcon']>>[0];

function TabIcon({ name, color, size }: IconProps & { name: IconName }) {
  return <MaterialCommunityIcons name={name} color={color as string} size={size} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
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
