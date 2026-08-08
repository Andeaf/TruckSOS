import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BottomTabBar, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { Avatar } from '@/components/avatar';
import { HeaderGradientDirection } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { displayName } from '@/lib/display-name';

/**
 * Navigația laterală a variantei WEB pe ecrane late (design „Web Redesign", 8a–8e):
 * bara de tab-uri de jos e potrivită pe telefon, dar pe un monitor lasă navigarea
 * la 800px distanță de conținut. Peste prag, aceleași rute devin o coloană navy
 * fixă, cu marcă sus și profilul jos.
 *
 * Se montează prin `tabBar` + `tabBarPosition` (react-navigation v7): sub prag
 * întoarcem EXACT bara implicită, deci telefonul rămâne neatins.
 */

/** Peste această lățime aplicația primește bara laterală (design: 1280px). */
export const SIDEBAR_BREAKPOINT = 1024;
const SIDEBAR_WIDTH = 220;

export function useWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= SIDEBAR_BREAKPOINT;
}

export function AppTabBar(props: BottomTabBarProps) {
  const wide = useWideLayout();
  if (!wide) return <BottomTabBar {...props} />;
  return <WebSidebar {...props} />;
}

/**
 * Varianta admin (design 10b–10e): fundal navy plin (nu gradient), eticheta de
 * secțiune „Administrare", iar jos profilul cu rolul și butonul de ieșire din
 * cont — adminul nu are ecran de profil, deci rândul nu navighează nicăieri.
 */
export function AdminTabBar(props: BottomTabBarProps) {
  const wide = useWideLayout();
  if (!wide) return <BottomTabBar {...props} />;
  return <WebSidebar {...props} admin />;
}

function WebSidebar({ state, descriptors, navigation, admin }: BottomTabBarProps & { admin?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const avatarPath = profile?.avatar_path ?? null;
  const urls = useSignedUrls(avatarPath ? [avatarPath] : []);

  const inner = (
    <>
      <View style={styles.brand}>
        <View style={styles.brandMark}>
          <Feather name="truck" size={18} color="#FFFFFF" />
        </View>
        <Text style={styles.brandName}>TruckSOS</Text>
      </View>

      {admin ? <Text style={styles.sectionLabel}>{t('admin.sidebar.section')}</Text> : null}

      <View style={styles.items}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          // Rutele ascunse din bară (`href: null` — profil, istoric, profiluri
          // publice) nu apar nici aici. Atenție: expo-router CONSUMĂ `href` și îl
          // traduce în `tabBarItemStyle.display = 'none'` (vezi
          // expo-router/build/layouts/TabsClient.js) — deci ăsta e marcajul de
          // verificat, nu `options.href`, care nu mai există la acest nivel.
          const itemStyle = StyleSheet.flatten(options.tabBarItemStyle);
          if (itemStyle?.display === 'none') return null;

          const focused = state.index === index;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : (options.title ?? route.name);
          const icon = options.tabBarIcon?.({
            focused,
            color: focused ? '#FFFFFF' : 'rgba(255,255,255,0.72)',
            size: 18,
          });

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              onPress={() => {
                // Același eveniment ca la bara de jos: ecranele care ascultă
                // `tabPress` (ex. Chat, care revine la lista de conversații)
                // se comportă identic pe desktop.
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={({ pressed }) => [
                styles.item,
                focused && styles.itemActive,
                pressed && !focused && styles.itemPressed,
              ]}>
              {icon}
              <Text
                numberOfLines={1}
                style={[styles.itemLabel, focused && styles.itemLabelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {admin ? (
        <View style={styles.profile}>
          <Avatar
            url={avatarPath ? urls[avatarPath] : undefined}
            name={profile ? displayName(profile, t) : undefined}
            size={34}
          />
          <View style={styles.profileInfo}>
            <Text numberOfLines={1} style={styles.profileName}>
              {profile ? displayName(profile, t) : ''}
            </Text>
            <Text style={styles.profileAction}>{t('admin.sidebar.role')}</Text>
          </View>
          <Pressable
            onPress={signOut}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('admin.logout')}>
            <Feather name="log-out" size={17} color="rgba(255,255,255,0.6)" />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => router.push('/profile' as never)}
          style={({ pressed }) => [styles.profile, pressed && styles.itemPressed]}>
          <Avatar
            url={avatarPath ? urls[avatarPath] : undefined}
            name={profile ? displayName(profile, t) : undefined}
            size={34}
          />
          <View style={styles.profileInfo}>
            <Text numberOfLines={1} style={styles.profileName}>
              {profile ? displayName(profile, t) : ''}
            </Text>
            <Text style={styles.profileAction}>{t('profile.viewProfile')}</Text>
          </View>
        </Pressable>
      )}
    </>
  );

  if (admin) return <View style={[styles.sidebar, styles.sidebarAdmin]}>{inner}</View>;
  return (
    <LinearGradient
      colors={['#164F9E', '#0E3A7D']}
      start={HeaderGradientDirection.start}
      end={HeaderGradientDirection.end}
      style={styles.sidebar}>
      {inner}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: SIDEBAR_WIDTH,
    paddingTop: 18,
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingTop: 2,
    paddingBottom: 18,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  sidebarAdmin: { backgroundColor: '#0B1F3D' },
  sectionLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  items: { gap: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  itemActive: { backgroundColor: 'rgba(255,255,255,0.16)' },
  itemPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  itemLabel: { flex: 1, color: 'rgba(255,255,255,0.72)', fontSize: 14, fontWeight: '600' },
  itemLabelActive: { color: '#FFFFFF', fontWeight: '700' },
  profile: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  profileInfo: { flex: 1, minWidth: 0 },
  profileName: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  profileAction: {
    color: '#FFFFFF',
    opacity: 0.6,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
});
