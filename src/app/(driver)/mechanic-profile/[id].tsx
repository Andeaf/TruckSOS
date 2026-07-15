import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';
import { Avatar } from '@/components/avatar';
import { RatingBadge, Stars } from '@/components/rating-badge';
import { RatingSheet } from '@/components/rating-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-auth';
import { startDirectConversation } from '@/hooks/use-chat';
import { useFavorites } from '@/hooks/use-favorites';
import { useTheme } from '@/hooks/use-theme';
import { useCanRate, useMechanicReviews, useMyRatingFor } from '@/hooks/use-ratings';
import { useSignedUrl } from '@/hooks/use-signed-urls';
import { displayName, isDeletedUser } from '@/lib/display-name';
import type { Profile } from '@/types/database';

type PublicProfile = Pick<
  Profile,
  'full_name' | 'specialization' | 'activity_zone' | 'rating_avg' | 'rating_count' | 'avatar_path' | 'deleted_at'
>;

async function fetchPublicProfile(mechanicId: string): Promise<PublicProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, specialization, activity_zone, rating_avg, rating_count, avatar_path, deleted_at')
    .eq('id', mechanicId)
    .single();
  return (data as PublicProfile) ?? null;
}

async function fetchMechanicPhone(mechanicId: string): Promise<string | null> {
  const { data } = await supabase.rpc('get_mechanic_phone', {
    p_mechanic_id: mechanicId,
  } as never);
  return (data as string | null) ?? null;
}

export default function MechanicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const goBack = useBack();

  const router = useRouter();
  const { session } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contacting, setContacting] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const avatarUrl = useSignedUrl(profile?.avatar_path);

  // Eligibilitatea (anunț `resolved` comun) e ACEEAȘI condiție pe care o impune RLS —
  // o verificăm doar ca să nu arătăm un buton care oricum ar fi refuzat.
  const canRate = useCanRate(id, session?.user.id);
  const { rating: myRating, refresh: refreshMyRating } = useMyRatingFor(id, session?.user.id);
  const { reviews, refresh: refreshReviews } = useMechanicReviews(id);
  const { favoriteIds, toggleFavorite, refresh: refreshFavorites } = useFavorites();
  const isFavorite = favoriteIds.has(id);

  useEffect(() => { refreshFavorites(); }, [refreshFavorites]);

  async function handleContact() {
    if (contacting) return;
    setContacting(true);
    const { conversationId } = await startDirectConversation(id);
    setContacting(false);
    if (conversationId) {
      router.push({
        pathname: '/(driver)/conversations/[id]' as never,
        params: { id: conversationId },
      });
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [prof, ph] = await Promise.all([
      fetchPublicProfile(id),
      fetchMechanicPhone(id),
    ]);
    setProfile(prof);
    setPhone(ph);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color="#208AEF" />
      </ThemedView>
    );
  }

  if (!profile) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="textSecondary">{t('driver.mechanicProfile.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  // Cont șters (piatră-funerară): nu mai poți iniția acțiuni cu el (contact, favorit, rating).
  const deleted = isDeletedUser(profile);

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('driver.mechanicProfile.title')}
        onBack={goBack}
        right={
          deleted ? undefined : (
            // Pe banda albastră steaua brand nu s-ar vedea → albă (decizie R4).
            <Pressable
              onPress={() => toggleFavorite(id)}
              hitSlop={12}
              accessibilityLabel={t('favorites.toggle')}>
              <MaterialIcons
                name={isFavorite ? 'star' : 'star-outline'}
                size={26}
                color={theme.onHeader}
              />
            </Pressable>
          )
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Avatar url={avatarUrl} name={displayName(profile, t)} size={72} />
          <ThemedText type="smallBold">{displayName(profile, t)}</ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="star" size={16} color="#f59e0b" />
            <ThemedText type="smallBold">{t('rating.sectionTitle')}</ThemedText>
          </View>
          <RatingBadge avg={profile.rating_avg} count={profile.rating_count} />

          {canRate && !deleted ? (
            <Pressable
              onPress={() => setSheetVisible(true)}
              style={({ pressed }) => [styles.rateButton, pressed && styles.pressed]}>
              <MaterialIcons name="star" size={16} color="#f59e0b" />
              <ThemedText style={styles.rateButtonText}>
                {myRating ? t('rating.editButton') : t('rating.rateButton')}
              </ThemedText>
            </Pressable>
          ) : null}

          {/* Review-uri ANONIME: doar stele + comentariu, fără cine le-a scris. */}
          {reviews.length > 0 ? (
            <View style={styles.reviews}>
              {reviews.map((review) => (
                <View key={review.id} style={styles.review}>
                  <Stars value={review.stars} />
                  {review.comment ? (
                    <ThemedText themeColor="textSecondary" type="small" style={styles.reviewComment}>
                      &quot;{review.comment}&quot;
                    </ThemedText>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
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

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="phone" size={16} color="#208AEF" />
            <ThemedText type="smallBold">{t('profile.phoneLabel')}</ThemedText>
          </View>
          {phone ? (
            <ThemedText>{phone}</ThemedText>
          ) : (
            <>
              <ThemedText themeColor="textSecondary">{t('profile.emptyField')}</ThemedText>
              <ThemedText themeColor="textSecondary" type="small">
                {t('driver.mechanicProfile.phoneHint')}
              </ThemedText>
            </>
          )}
        </ThemedView>

        {/* Un cont șters nu mai poate fi contactat (n-are cine să răspundă). */}
        {deleted ? null : (
          <Pressable
            onPress={handleContact}
            disabled={contacting}
            style={({ pressed }) => [styles.contactButton, (pressed || contacting) && styles.pressed]}>
            {contacting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="chat" size={18} color="#fff" />
            )}
            <ThemedText style={styles.contactButtonText}>
              {t('driver.mechanicProfile.contactButton')}
            </ThemedText>
          </Pressable>
        )}
      </ScrollView>

      {sheetVisible && session ? (
        <RatingSheet
          visible
          mechanicId={id}
          mechanicName={displayName(profile, t)}
          driverId={session.user.id}
          initialStars={myRating?.stars}
          initialComment={myRating?.comment}
          onClose={() => setSheetVisible(false)}
          onSaved={() => {
            setSheetVisible(false);
            // Media e denormalizată pe profil (trigger) → reîncărcăm profilul, nu doar lista.
            load();
            refreshMyRating();
            refreshReviews();
          }}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  identity: { alignItems: 'center', gap: Spacing.two, paddingBottom: Spacing.two },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  section: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.control,
    backgroundColor: '#208AEF',
    marginTop: Spacing.two,
  },
  contactButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  rateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
  },
  rateButtonText: { color: '#f59e0b', fontSize: 14, fontWeight: '600' },
  reviews: { gap: Spacing.two, marginTop: Spacing.one },
  review: { gap: 2 },
  reviewComment: { fontStyle: 'italic' },
  pressed: { opacity: 0.7 },
});
