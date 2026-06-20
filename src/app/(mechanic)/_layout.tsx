import { Tabs } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/use-theme';

export default function MechanicLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#22c55e',
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Anunturi',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="directions-car" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="conversations"
        options={{
          title: 'Conversatii',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="chat" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
