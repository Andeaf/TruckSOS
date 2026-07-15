import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/avatar';
import { RatingBadge } from '@/components/rating-badge';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useBack } from '@/hooks/use-back';
import { useSignedUrl } from '@/hooks/use-signed-urls';
import type { Profile } from '@/types/database';

/**
 * Profil public generic (Faza 14.4), refolosit de ambele grupuri de rute prin câte
 * un route subțire. Arată nume + avatar + rol pentru oricine; pentru un mecanic adaugă
 * rating + specializare + zonă. NU arată telefonul (rămâne protejat prin RPC-urile
 * dedicate). `profiles_select_all` permite deja citirea oricărui profil.
 *
 * Excepție: un transportator care apasă pe un mecanic în chatul PRIVAT ajunge pe ecranul
 * bogat `mechanic-profile` (cu Contact/rating/favorite), nu aici — decizia de rutare o ia
 * ecranul de chat.
 */

type PublicProfile = Pick<
  Profile,
  'full_name' | 'role' | 'avatar_path' | 'specialization' | 'activity_zone' | 'rating_avg' | 'rating_count'
>;

async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, role, avatar_path, specialization, activity_zone, rating_avg, rating_count')
    .eq('id', userId)
    .single();
  return (data as unknown as PublicProfile) ?? null;
}

export function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  // Ecran mereu deschis prin push (din chat) → back-ul urcă în stivă; fallback-ul „/"
  // (index → redirect pe grupul corect) acoperă doar cazul rar fără istoric.
  const goBack = useBack('/');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const avatarUrl = useSignedUrl(profile?.avatar_path);

  const load = useCallback(async () => {
    setLoading(true);
    setProfile(await fetchPublicProfile(id));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color="#208AEF" />
      </ThemedView>
    );
  }

  if (!profile) {
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader title={t('publicProfile.title')} onBack={goBack} />
        <View style={styles.centered}>
          <ThemedText themeColor="textSecondary">{t('publicProfile.notFound')}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  const isMechanic = profile.role === 'mechanic';

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('publicProfile.title')} onBack={goBack} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Avatar url={avatarUrl} name={profile.full_name} size={72} />
          <ThemedText type="smallBold">{profile.full_name}</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            {t(`auth.roleSelect.${profile.role}Title`)}
          </ThemedText>
        </View>

        {isMechanic ? (
          <>
            <ThemedView type="backgroundElement" style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="star" size={16} color="#f59e0b" />
                <ThemedText type="smallBold">{t('rating.sectionTitle')}</ThemedText>
              </View>
              <RatingBadge avg={profile.rating_avg} count={profile.rating_count} />
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="build" size={16} color="#208AEF" />
                <ThemedText type="smallBold">{t('profile.specializationLabel')}</ThemedText>
              </View>
              <ThemedText themeColor={profile.specialization ? undefined : 'textSecondary'}>
                {profile.specialization || t('profile.emptyField')}
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="place" size={16} color="#208AEF" />
                <ThemedText type="smallBold">{t('profile.activityZoneLabel')}</ThemedText>
              </View>
              <ThemedText themeColor={profile.activity_zone ? undefined : 'textSecondary'}>
                {profile.activity_zone || t('profile.emptyField')}
              </ThemedText>
            </ThemedView>
          </>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  identity: { alignItems: 'center', gap: Spacing.one, paddingBottom: Spacing.two },
  content: { padding: Spacing.four, gap: Spacing.three },
  section: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
