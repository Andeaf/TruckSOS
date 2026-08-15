import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { TAB_BAR_WEB_STYLE, tabLabel, useTabLabelFontSize } from '@/components/tab-label';
import { AppTabBar, useWideLayout } from '@/components/web-sidebar';
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
  name: keyof typeof Feather.glyphMap;
  color: string;
  size: number;
  dot?: boolean;
}) {
  return (
    <View>
      <Feather name={name} size={size} color={color} />
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

  // Web pe ecran lat: aceleași rute, dar ca bară laterală (design „Web Redesign").
  const wide = useWideLayout();
  // Font comun pentru toate etichetele barei — cea mai lungă dictează mărimea.
  const tabFontSize = useTabLabelFontSize([
    t('mechanic.tabs.map'),
    t('mechanic.tabs.feed'),
    t('mechanic.tabs.applications'),
    t('mechanic.tabs.conversations'),
    t('market.tabTitle'),
  ]);

  return (
    <Tabs
      // Back-ul fizic duce MEREU spre tab-ul de start (Harta), nu prin istoricul
      // de tab-uri (cerere 7 aug, consecvent cu șoferul); de pe Hartă,
      // useExitConfirm întreabă dacă închide aplicația.
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
      {/* Harta prima, lângă Feed: sunt două vederi peste aceleași anunțuri deschise. */}
      <Tabs.Screen
        name="map"
        options={{
          title: t('mechanic.tabs.map'),
          tabBarLabel: tabLabel(t('mechanic.tabs.map'), tabFontSize),
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
          tabBarLabel: tabLabel(t('mechanic.tabs.feed'), tabFontSize),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="truck" size={size} color={color} dot={feedNew} />
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
          tabBarLabel: tabLabel(t('mechanic.tabs.applications'), tabFontSize),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="clipboard" size={size} color={color} dot={appsNew} />
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
          tabBarLabel: tabLabel(t('mechanic.tabs.conversations'), tabFontSize),
          tabBarBadge: totalUnread > 0 ? formatBadge(totalUnread) : undefined,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="message-circle" size={size} color={color} />
          ),
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
      {/* Faza 19: Market ia locul Profilului în bară (strict — restul ordinii neatins). */}
      <Tabs.Screen
        name="market"
        options={{
          title: t('market.tabTitle'),
          tabBarLabel: tabLabel(t('market.tabTitle'), tabFontSize),
          tabBarIcon: ({ color, size }) => <TabIcon name="shopping-bag" size={size} color={color} />,
        }}
        listeners={{
          tabPress: () => {
            refreshFeed();
            refreshApps();
          },
        }}
      />
      {/* Profilul se deschide din butonul-avatar al antetului (ScreenHeader.profileButton). */}
      <Tabs.Screen name="profile" options={{ href: null }} />
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
