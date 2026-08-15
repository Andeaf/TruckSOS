import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { TAB_BAR_WEB_STYLE, tabLabel, useTabLabelFontSize } from '@/components/tab-label';
import { AppTabBar, useWideLayout } from '@/components/web-sidebar';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useUnreadCounts } from '@/hooks/use-chat';
import { useChannels, useChannelUnreadCount } from '@/hooks/use-channel-chat';
import { formatBadge } from '@/lib/badge';

export default function DriverLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { session } = useAuth();
  const { counts: unreadCounts } = useUnreadCounts(session?.user.id);
  const { channels } = useChannels();
  const globalChannel = channels.find((c) => c.type === 'global');
  const { count: channelUnread } = useChannelUnreadCount(session?.user.id, globalChannel?.id);
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0) + channelUnread;
  // Web pe ecran lat: aceleași rute, dar ca bară laterală (design „Web Redesign").
  const wide = useWideLayout();
  // Font comun pentru toate etichetele barei — cea mai lungă dictează mărimea.
  const tabFontSize = useTabLabelFontSize([
    t('driver.tabs.announcements'),
    t('driver.tabs.conversations'),
    t('search.tabTitle'),
    t('market.tabTitle'),
  ]);

  return (
    <Tabs
      // Back-ul fizic duce MEREU spre tab-ul de start (Anunțuri), nu prin istoricul
      // de tab-uri (cerere 7 aug: „de oriunde ajung pe pagina de anunțuri"); de pe
      // Anunțuri, useExitConfirm întreabă dacă închide aplicația.
      backBehavior="initialRoute"
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.textTertiary,
        tabBarStyle: {
          ...TAB_BAR_WEB_STYLE,
          backgroundColor: theme.barBackground,
          borderTopWidth: 1,
          borderTopColor: theme.separator,
        },
        // Iconița+eticheta stau ancorate sus în bară — le coborâm puțin spre centru.
        tabBarItemStyle: { paddingTop: 4 },
      }}>
      <Tabs.Screen
        name="announcements"
        options={{
          title: t('driver.tabs.announcements'),
          tabBarLabel: tabLabel(t('driver.tabs.announcements'), tabFontSize),
          tabBarIcon: ({ color, size }) => <Feather name="list" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="conversations"
        options={{
          title: t('driver.tabs.conversations'),
          tabBarLabel: tabLabel(t('driver.tabs.conversations'), tabFontSize),
          tabBarBadge: totalUnread > 0 ? formatBadge(totalUnread) : undefined,
          tabBarIcon: ({ color, size }) => (
            <Feather name="message-circle" size={size} color={color} />
          ),
        }}
        listeners={({ navigation }) => ({
          // Tap pe tab-ul Chat → mereu lista de conversații, nu un chat rămas deschis
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('conversations', { screen: 'index' });
          },
        })}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t('search.tabTitle'),
          tabBarLabel: tabLabel(t('search.tabTitle'), tabFontSize),
          tabBarIcon: ({ color, size }) => <Feather name="search" size={size} color={color} />,
        }}
      />
      {/* Faza 19: Market ia locul Profilului în bară (strict — restul ordinii neatins). */}
      <Tabs.Screen
        name="market"
        options={{
          title: t('market.tabTitle'),
          tabBarLabel: tabLabel(t('market.tabTitle'), tabFontSize),
          tabBarIcon: ({ color, size }) => <Feather name="shopping-bag" size={size} color={color} />,
        }}
      />
      {/* Profilul se deschide din butonul-avatar al antetului (ScreenHeader.profileButton). */}
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="mechanic-profile" options={{ href: null }} />
      <Tabs.Screen name="public-profile" options={{ href: null }} />
      {/* Istoricul se deschide din Profil, nu are tab propriu. */}
      <Tabs.Screen name="history" options={{ href: null }} />
    </Tabs>
  );
}
