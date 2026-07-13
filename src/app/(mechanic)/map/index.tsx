import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import MapView, { Marker, type Region } from 'react-native-maps';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DARK_MAP_STYLE, ROMANIA_REGION, USER_REGION_DELTA } from '@/constants/map-style';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useOpenAnnouncements, type AnnouncementWithDriver } from '@/hooks/use-announcements';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { useViewedAnnouncements } from '@/hooks/use-viewed-announcements';
import { getCurrentCoords } from '@/lib/location';

/**
 * Harta mecanicului (PLAN_FAZA11.md §2): un pin per anunț deschis CU coordonate.
 * Anunțurile fără GPS nu pot fi plasate — nu le inventăm poziția (fără geocodare),
 * doar le numărăm, ca mecanicul să știe că harta nu e lista completă.
 */

/** Anunț cu coordonate garantat non-null — îngustăm tipul o singură dată, la filtrare. */
type Located = AnnouncementWithDriver & { latitude: number; longitude: number };

function hasCoords(a: AnnouncementWithDriver): a is Located {
  return a.latitude != null && a.longitude != null;
}

export default function MechanicMapScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const router = useRouter();
  const timeAgo = useTimeAgo();
  const { session } = useAuth();
  const { announcements, refresh } = useOpenAnnouncements();
  const { viewed, refresh: refreshViewed } = useViewedAnnouncements(session?.user.id);

  // `initialRegion` se aplică o singură dată, la montare → randăm harta abia după ce
  // știm de unde pornim (poziția mecanicului sau, la refuz/eroare, centrul României).
  const [region, setRegion] = useState<Region | null>(null);
  const [selected, setSelected] = useState<Located | null>(null);

  useEffect(() => {
    let active = true;
    getCurrentCoords().then((result) => {
      if (!active) return;
      setRegion(
        'latitude' in result
          ? {
              latitude: result.latitude,
              longitude: result.longitude,
              latitudeDelta: USER_REGION_DELTA,
              longitudeDelta: USER_REGION_DELTA,
            }
          : ROMANIA_REGION
      );
    });
    return () => { active = false; };
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      // La întoarcerea din detaliu, pinul tocmai deschis trebuie să devină „văzut".
      refreshViewed();
    }, [refresh, refreshViewed])
  );

  const located = announcements.filter(hasCoords);
  const missingCount = announcements.length - located.length;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('mechanic.map.title')}
        subtitle={t('mechanic.map.pinCount', { count: located.length })}
      />

      {region ? (
        <View style={styles.mapWrapper}>
          <MapView
            style={StyleSheet.absoluteFill}
            initialRegion={region}
            showsUserLocation
            showsMyLocationButton
            toolbarEnabled={false}
            customMapStyle={scheme === 'dark' ? DARK_MAP_STYLE : undefined}
            onPress={() => setSelected(null)}>
            {located.map((item) => (
              <Marker
                key={item.id}
                coordinate={{ latitude: item.latitude, longitude: item.longitude }}
                // Anunțurile nedeschise încă ies în evidență; restul se estompează.
                pinColor={viewed.has(item.id) ? '#9aa0a6' : theme.brand}
                onPress={() => setSelected(item)}
              />
            ))}
          </MapView>

          {missingCount > 0 ? (
            <ThemedView type="backgroundElement" style={styles.missingBanner}>
              <MaterialIcons name="location-off" size={14} color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" type="small">
                {t('mechanic.map.missingCount', { count: missingCount })}
              </ThemedText>
            </ThemedView>
          ) : null}

          {selected ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/(mechanic)/feed/[id]' as never,
                  params: { id: selected.id },
                })
              }
              style={({ pressed }) => [styles.cardWrapper, pressed && styles.pressed]}>
              <ThemedView type="backgroundElement" style={styles.card}>
                <View style={styles.cardHeader}>
                  <MaterialIcons name="location-on" size={16} color={theme.brand} />
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.cardTitle}>
                    {selected.location}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {timeAgo(selected.created_at)}
                  </ThemedText>
                </View>

                <ThemedText themeColor="textSecondary" type="small" numberOfLines={2}>
                  {selected.description}
                </ThemedText>

                <View style={styles.cardFooter}>
                  <ThemedText themeColor="textSecondary" type="small" numberOfLines={1}>
                    {selected.driver?.full_name ?? ''}
                  </ThemedText>
                  <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
                </View>
              </ThemedView>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapWrapper: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  missingBanner: {
    position: 'absolute',
    top: Spacing.three,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.card,
    // Umbra ține banda lizibilă peste orice zonă a hărții.
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  cardWrapper: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Radius.card,
    gap: Spacing.two,
    ...Platform.select({
      android: { elevation: 6 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
      },
    }),
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  cardTitle: { flex: 1 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pressed: { opacity: 0.9 },
});
