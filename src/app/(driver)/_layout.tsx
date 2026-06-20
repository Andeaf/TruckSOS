import { Tabs } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/use-theme';

export default function DriverLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#208AEF',
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen
        name="announcements"
        options={{
          title: 'Anunturile mele',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="list-alt" size={size} color={color} />
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
