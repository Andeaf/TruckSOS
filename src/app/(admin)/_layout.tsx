import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/use-theme';
import { fetchPendingReportsCount } from '@/hooks/use-admin';
import { formatBadge } from '@/lib/badge';

/** Eticheta de tab din design: 11px, weight 700 pe activ / 600 pe inactiv. */
function tabLabel(label: string) {
  return function TabLabel({ focused, color }: { focused: boolean; color: string }) {
    return (
      <Text style={{ fontSize: 11, fontWeight: focused ? '700' : '600', color }}>{label}</Text>
    );
  };
}

/** Grupul admin (Faza 16). Paralel cu (driver)/(mechanic). */
export default function AdminLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [pending, setPending] = useState(0);

  // Badge rapoarte: query de count, reîmprospătat la fiecare tap pe tab (fără Realtime — lecția Fazei 6).
  const refreshPending = useCallback(() => {
    fetchPendingReportsCount().then(({ data }) => setPending(data));
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.barBackground,
          borderTopWidth: 1,
          borderTopColor: theme.separator,
        },
      }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('admin.tabs.dashboard'),
          tabBarLabel: tabLabel(t('admin.tabs.dashboard')),
          tabBarIcon: ({ color, size }) => <Feather name="grid" size={size} color={color} />,
        }}
        listeners={{ tabPress: refreshPending }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('admin.tabs.reports'),
          tabBarLabel: tabLabel(t('admin.tabs.reports')),
          tabBarBadge: pending > 0 ? formatBadge(pending) : undefined,
          tabBarIcon: ({ color, size }) => <Feather name="flag" size={size} color={color} />,
        }}
        listeners={{ tabPress: refreshPending }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: t('admin.tabs.users'),
          tabBarLabel: tabLabel(t('admin.tabs.users')),
          tabBarIcon: ({ color, size }) => <Feather name="users" size={size} color={color} />,
        }}
        listeners={{ tabPress: refreshPending }}
      />
      <Tabs.Screen
        name="content"
        options={{
          title: t('admin.tabs.content'),
          tabBarLabel: tabLabel(t('admin.tabs.content')),
          tabBarIcon: ({ color, size }) => <Feather name="file-text" size={size} color={color} />,
        }}
        listeners={{ tabPress: refreshPending }}
      />
    </Tabs>
  );
}
