import { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  TAB_BAR_WEB_STYLE,
  tabLabel,
  useTabBarNativeStyle,
  useTabLabelFontSize,
} from '@/components/tab-label';
import { AdminTabBar, useWideLayout } from '@/components/web-sidebar';
import { useTheme } from '@/hooks/use-theme';
import { fetchPendingReportsCount } from '@/hooks/use-admin';
import { formatBadge } from '@/lib/badge';

/** Grupul admin (Faza 16). Paralel cu (driver)/(mechanic). */
export default function AdminLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [pending, setPending] = useState(0);
  // Web pe ecran lat: sidebar-ul admin din design (10b–10e), cu logout jos.
  const wide = useWideLayout();
  // Inaltimea + respiroul de jos ale barei pe nativ (vezi nota din tab-label).
  const tabBarNative = useTabBarNativeStyle();

  // Badge rapoarte: query de count, reîmprospătat la fiecare tap pe tab (fără Realtime — lecția Fazei 6).
  const refreshPending = useCallback(() => {
    fetchPendingReportsCount().then(({ data }) => setPending(data));
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  // Font comun pentru toate etichetele barei — cea mai lungă dictează mărimea.
  const tabFontSize = useTabLabelFontSize([
    t('admin.tabs.dashboard'),
    t('admin.tabs.reports'),
    t('admin.tabs.users'),
    t('admin.tabs.content'),
  ]);

  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <AdminTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.textTertiary,
        tabBarStyle: {
          ...TAB_BAR_WEB_STYLE,
          ...tabBarNative,
          backgroundColor: theme.barBackground,
          borderTopWidth: 1,
          borderTopColor: theme.separator,
        },
        // Iconița+eticheta stau ancorate sus în bară — le coborâm puțin spre centru.
        tabBarItemStyle: { paddingTop: 4 },
      }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('admin.tabs.dashboard'),
          tabBarLabel: tabLabel(t('admin.tabs.dashboard'), tabFontSize),
          tabBarIcon: ({ color, size }) => <Feather name="grid" size={size} color={color} />,
        }}
        listeners={{ tabPress: refreshPending }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('admin.tabs.reports'),
          tabBarLabel: tabLabel(t('admin.tabs.reports'), tabFontSize),
          tabBarBadge: pending > 0 ? formatBadge(pending) : undefined,
          tabBarIcon: ({ color, size }) => <Feather name="flag" size={size} color={color} />,
        }}
        listeners={{ tabPress: refreshPending }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: t('admin.tabs.users'),
          tabBarLabel: tabLabel(t('admin.tabs.users'), tabFontSize),
          tabBarIcon: ({ color, size }) => <Feather name="users" size={size} color={color} />,
        }}
        listeners={{ tabPress: refreshPending }}
      />
      <Tabs.Screen
        name="content"
        options={{
          title: t('admin.tabs.content'),
          tabBarLabel: tabLabel(t('admin.tabs.content'), tabFontSize),
          tabBarIcon: ({ color, size }) => <Feather name="file-text" size={size} color={color} />,
        }}
        listeners={{ tabPress: refreshPending }}
      />
      {/* Ecran deschis din Panou, ascuns din bară și din sidebar (href: null). */}
      <Tabs.Screen name="purge-accounts" options={{ href: null, title: t('admin.purge.title') }} />
    </Tabs>
  );
}
