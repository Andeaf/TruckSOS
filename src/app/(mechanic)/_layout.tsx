import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useUnreadCounts } from '@/hooks/use-chat';
import { useChannels, useChannelUnreadCount } from '@/hooks/use-channel-chat';
import { useFeedBadge, useApplicationsBadge } from '@/hooks/use-mechanic-badges';
import { RadiusFilterProvider } from '@/hooks/use-radius-filter';
import { formatBadge } from '@/lib/badge';

/** Iconiță de tab cu buline-punct opțională (noutăți Feed/Candidaturi, Faza 14.10). */
function TabIcon({
  name,
  color,
  size,
  dot,
}: {
  name: keyof typeof MaterialIcons.glyphMap;
  color: string;
  size: number;
  dot?: boolean;
}) {
  return (
    <View>
      <MaterialIcons name={name} size={size} color={color} />
      {dot ? <View style={styles.dot} /> : null}
    </View>
  );
}

export default function MechanicLayout() {
  // RadiusFilterProvider trebuie să învelească componenta care citește `useRadiusFilter`
  // (bulina de Feed respectă raza activă) — de aceea tab-urile sunt un copil separat.
  return (
    <RadiusFilterProvider>
      <MechanicTabs />
    </RadiusFilterProvider>
  );
}

function MechanicTabs() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { counts: unreadCounts } = useUnreadCounts(userId);
  const { channels } = useChannels();
  const globalChannel = channels.find((c) => c.type === 'global');
  const { count: channelUnread } = useChannelUnreadCount(userId, globalChannel?.id);
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0) + channelUnread;

  const { hasNew: feedNew, refresh: refreshFeed, markSeen: markFeedSeen } = useFeedBadge(userId);
  const {
    hasNew: appsNew,
    refresh: refreshApps,
    markSeen: markAppsSeen,
  } = useApplicationsBadge(userId);

  return (
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
          tabBarIcon: ({ color, size }) => <TabIcon name="map" size={size} color={color} />,
        }}
        listeners={{
          tabPress: () => {
            refreshFeed();
            refreshApps();
          },
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: t('mechanic.tabs.feed'),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="directions-car" size={size} color={color} dot={feedNew} />
          ),
        }}
        listeners={{
          // Deschiderea Feed-ului = „văzut": stinge bulina (scrie feed_last_seen).
          tabPress: () => {
            markFeedSeen();
            refreshApps();
          },
        }}
      />
      <Tabs.Screen
        name="applications"
        options={{
          title: t('mechanic.tabs.applications'),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="assignment" size={size} color={color} dot={appsNew} />
          ),
        }}
        listeners={{
          tabPress: () => {
            markAppsSeen();
            refreshFeed();
          },
        }}
      />
      <Tabs.Screen
        name="conversations"
        options={{
          title: t('mechanic.tabs.conversations'),
          tabBarBadge: totalUnread > 0 ? formatBadge(totalUnread) : undefined,
          tabBarIcon: ({ color, size }) => <TabIcon name="chat" size={size} color={color} />,
        }}
        listeners={({ navigation }) => ({
          // Tap pe tab-ul Chat → mereu lista de conversații, nu un chat rămas deschis
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('conversations', { screen: 'index' });
            refreshFeed();
            refreshApps();
          },
        })}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile.tabTitle'),
          tabBarIcon: ({ color, size }) => <TabIcon name="person" size={size} color={color} />,
        }}
        listeners={{
          tabPress: () => {
            refreshFeed();
            refreshApps();
          },
        }}
      />
      <Tabs.Screen name="public-profile" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: -3,
    right: -5,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
});
