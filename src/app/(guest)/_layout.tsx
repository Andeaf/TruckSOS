import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  TAB_BAR_WEB_STYLE,
  tabLabel,
  useTabBarNativeStyle,
  useTabLabelFontSize,
} from '@/components/tab-label';
import { useWideLayout } from '@/components/web-sidebar';
import { TabIcon } from '@/components/ui/tab-icon';
import { RadiusFilterProvider } from '@/hooks/use-radius-filter';
import { useTheme } from '@/hooks/use-theme';

/**
 * 1.1 (B3): grupul OASPEȚILOR (fără cont) — 5 tab-uri peste componentele comune, cu
 * datele din view-urile `guest_*` (rolul `anon`). Fără buline (n-are ce citi „văzut”),
 * fără Realtime, fără profil: antetul arată pastila „Intră în cont” în locul avatarului
 * (`HeaderProfileButton`). Garda din rădăcină (B2) permite grupul doar cu `isGuest`.
 */
export default function GuestLayout() {
  // Filtrul de rază al hărții folosește poziția CURENTĂ a telefonului (nu profilul),
  // deci merge și pentru oaspeți — provider-ul trebuie să învelească tab-urile.
  return (
    <RadiusFilterProvider>
      <GuestTabs />
    </RadiusFilterProvider>
  );
}

function GuestTabs() {
  const theme = useTheme();
  const { t } = useTranslation();
  const wide = useWideLayout();
  const tabBarNative = useTabBarNativeStyle();
  const tabFontSize = useTabLabelFontSize([
    t('guest.tabs.map'),
    t('guest.tabs.announcements'),
    t('guest.tabs.mechanics'),
    t('guest.tabs.market'),
    t('guest.tabs.community'),
  ]);

  return (
    <Tabs
      // Back-ul fizic duce spre tab-ul de start (Anunțuri), ca la celelalte roluri.
      backBehavior="initialRoute"
      initialRouteName="announcements"
      // Fără AppTabBar: bara laterală de web are rândul de profil (→ /profile), pe care
      // oaspetele nu-l are. Pe ecran lat bara standard stă în stânga (tabBarPosition).
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
        tabBarItemStyle: { paddingTop: 4 },
      }}>
      <Tabs.Screen
        name="map"
        options={{
          title: t('guest.tabs.map'),
          tabBarLabel: tabLabel(t('guest.tabs.map'), tabFontSize),
          tabBarIcon: ({ color, size }) => <TabIcon name="map" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: t('guest.tabs.announcements'),
          tabBarLabel: tabLabel(t('guest.tabs.announcements'), tabFontSize),
          tabBarIcon: ({ color, size }) => <TabIcon name="truck" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mechanics"
        options={{
          title: t('guest.tabs.mechanics'),
          tabBarLabel: tabLabel(t('guest.tabs.mechanics'), tabFontSize),
          tabBarIcon: ({ color, size }) => <TabIcon name="tool" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: t('guest.tabs.market'),
          tabBarLabel: tabLabel(t('guest.tabs.market'), tabFontSize),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="shopping-bag" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: t('guest.tabs.community'),
          tabBarLabel: tabLabel(t('guest.tabs.community'), tabFontSize),
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="message-circle" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
