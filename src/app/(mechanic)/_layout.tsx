import { Tabs } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useUnreadCounts } from '@/hooks/use-chat';
import { useChannels, useChannelUnreadCount } from '@/hooks/use-channel-chat';
import { RadiusFilterProvider } from '@/hooks/use-radius-filter';

export default function MechanicLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { session } = useAuth();
  const { counts: unreadCounts } = useUnreadCounts(session?.user.id);
  const { channels } = useChannels();
  const globalChannel = channels.find((c) => c.type === 'global');
  const { count: channelUnread } = useChannelUnreadCount(session?.user.id, globalChannel?.id);
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0) + channelUnread;

  return (
    <RadiusFilterProvider>
    <Tabs
      // Back-ul fizic urcă în istoricul REAL de navigare (tabul anterior), nu sare
      // direct pe primul tab — comportamentul implicit („firstRoute").
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#22c55e',
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background },
      }}>
      {/* Harta prima, lângă Feed: sunt două vederi peste aceleași anunțuri deschise. */}
      <Tabs.Screen
        name="map"
        options={{
          title: t('mechanic.tabs.map'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="map" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: t('mechanic.tabs.feed'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="directions-car" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="applications"
        options={{
          title: t('mechanic.tabs.applications'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="assignment" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="conversations"
        options={{
          title: t('mechanic.tabs.conversations'),
          tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="chat" size={size} color={color} />
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
        name="profile"
        options={{
          title: t('profile.tabTitle'),
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="public-profile" options={{ href: null }} />
    </Tabs>
    </RadiusFilterProvider>
  );
}
