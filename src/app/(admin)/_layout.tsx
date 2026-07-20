import { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/use-theme';
import { fetchPendingReportsCount } from '@/hooks/use-admin';
import { formatBadge } from '@/lib/badge';

/** Grupul admin (Faza 16). Paralel cu (driver)/(mechanic); tint indigo, distinct vizual. */
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
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('admin.tabs.dashboard'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="dashboard" size={size} color={color} />
          ),
        }}
        listeners={{ tabPress: refreshPending }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('admin.tabs.reports'),
          tabBarBadge: pending > 0 ? formatBadge(pending) : undefined,
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="report" size={size} color={color} />
          ),
        }}
        listeners={{ tabPress: refreshPending }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: t('admin.tabs.users'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="people" size={size} color={color} />
          ),
        }}
        listeners={{ tabPress: refreshPending }}
      />
      <Tabs.Screen
        name="content"
        options={{
          title: t('admin.tabs.content'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="article" size={size} color={color} />
          ),
        }}
        listeners={{ tabPress: refreshPending }}
      />
    </Tabs>
  );
}
