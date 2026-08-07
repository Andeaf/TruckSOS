import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useUnreadCounts } from '@/hooks/use-chat';
import { useChannels, useChannelUnreadCount } from '@/hooks/use-channel-chat';
import { formatBadge } from '@/lib/badge';

/** Eticheta de tab din design: 11px, weight 700 pe activ / 600 pe inactiv. */
function tabLabel(label: string) {
  return function TabLabel({ focused, color }: { focused: boolean; color: string }) {
    return (
      <Text style={{ fontSize: 11, fontWeight: focused ? '700' : '600', color }}>{label}</Text>
    );
  };
}

export default function DriverLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { session } = useAuth();
  const { counts: unreadCounts } = useUnreadCounts(session?.user.id);
  const { channels } = useChannels();
  const globalChannel = channels.find((c) => c.type === 'global');
  const { count: channelUnread } = useChannelUnreadCount(session?.user.id, globalChannel?.id);
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0) + channelUnread;

  return (
    <Tabs
      // Back-ul fizic duce MEREU spre tab-ul de start (Anunțuri), nu prin istoricul
      // de tab-uri (cerere 7 aug: „de oriunde ajung pe pagina de anunțuri"); de pe
      // Anunțuri, useExitConfirm întreabă dacă închide aplicația.
      backBehavior="initialRoute"
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
        name="announcements"
        options={{
          title: t('driver.tabs.announcements'),
          tabBarLabel: tabLabel(t('driver.tabs.announcements')),
          tabBarIcon: ({ color, size }) => <Feather name="list" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="conversations"
        options={{
          title: t('driver.tabs.conversations'),
          tabBarLabel: tabLabel(t('driver.tabs.conversations')),
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
          tabBarLabel: tabLabel(t('search.tabTitle')),
          tabBarIcon: ({ color, size }) => <Feather name="search" size={size} color={color} />,
        }}
      />
      {/* Faza 19: Market ia locul Profilului în bară (strict — restul ordinii neatins). */}
      <Tabs.Screen
        name="market"
        options={{
          title: t('market.tabTitle'),
          tabBarLabel: tabLabel(t('market.tabTitle')),
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
