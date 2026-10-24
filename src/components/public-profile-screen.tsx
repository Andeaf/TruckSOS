import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/avatar';
import { RatingBadge } from '@/components/rating-badge';
import { ReportSheet } from '@/components/report-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useAccountGate } from '@/hooks/use-account-gate';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { useBlocked } from '@/hooks/use-blocked';
import { startDirectConversation } from '@/hooks/use-chat';
import { fetchGuestProfile } from '@/hooks/use-guest-data';
import { useTheme } from '@/hooks/use-theme';
import { useSignedUrl } from '@/hooks/use-signed-urls';
import { displayName, isDeletedUser } from '@/lib/display-name';
import { getGuestFavorites, toggleGuestFavorite } from '@/lib/guest-favorites';
import { shareContact } from '@/lib/share-contact';
import type { Profile, Role } from '@/types/database';

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
  'full_name' | 'role' | 'avatar_path' | 'specialization' | 'activity_zone' | 'company_name' | 'contact_email' | 'address' | 'vat_number' | 'rating_avg' | 'rating_count' | 'deleted_at'
>;

async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, role, avatar_path, specialization, activity_zone, company_name, contact_email, address, vat_number, rating_avg, rating_count, deleted_at')
    .eq('id', userId)
    .single();
  return (data as unknown as PublicProfile) ?? null;
}

/** 1.1 (B3): profilul din `guest_profiles` pe forma ecranului — adresa, TVA-ul și e-mailul
 * de contact nu există pentru oaspeți (D3), deci rămân goale și secțiunile lor se ascund. */
async function fetchGuestPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data } = await fetchGuestProfile(userId);
  if (!data) return null;
  return {
    full_name: data.full_name,
    role: data.role,
    avatar_path: data.avatar_path,
    specialization: data.specialization,
    activity_zone: data.activity_zone,
    company_name: data.company_name,
    contact_email: null,
    address: null,
    vat_number: null,
    rating_avg: data.rating_avg,
    rating_count: data.rating_count,
    deleted_at: null,
  };
}

/**
 * `guest` (1.1, B3): ecranul oaspetelui (`/(guest)/mechanics/[id]`, și pentru linkul
 * `/p/<id>`) — datele din `guest_profiles`, fără adresă/TVA/e-mail; raportarea, blocarea
 * și conversația deschid pop-upul de cont; steaua de favorit e locală (D5). `role`
 * contează doar pentru rutarea conversației, deci lipsește la oaspete.
 */
export function PublicProfileScreen({ role, guest = false }: { role?: Role; guest?: boolean }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  // Ecran mereu deschis prin push (din chat) → back-ul urcă în stivă; fallback-ul „/"
  // (index → redirect pe grupul corect) acoperă doar cazul rar fără istoric.
  const goBack = useBack(guest ? '/(guest)/mechanics' : '/');
  const theme = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const { requireAccount } = useAccountGate();
  const [guestFavorite, setGuestFavorite] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportVisible, setReportVisible] = useState(false);
  const avatarUrl = useSignedUrl(profile?.avatar_path);
  const { blockedIds, block, unblock } = useBlocked();
  const isBlocked = blockedIds.has(id);
  // Nu te poți raporta pe tine însuți — și nici un cont deja șters (nu mai are ce modera).
  // Aceleași condiții valorează și pentru blocare.
  const canReport = !!session && session.user.id !== id && !isDeletedUser(profile);

  // Blochează/Deblochează (Faza 18) — starea vine din propriile blocări (useBlocked).
  const handleToggleBlock = useCallback(() => {
    if (isBlocked) {
      Alert.alert(t('block.unblockConfirmTitle'), t('block.unblockConfirmBody'), [
        { text: t('block.cancel'), style: 'cancel' },
        { text: t('block.unblock'), onPress: () => unblock(id) },
      ]);
    } else {
      Alert.alert(t('block.confirmTitle'), t('block.confirmBody'), [
        { text: t('block.cancel'), style: 'cancel' },
        {
          text: t('block.confirm'),
          style: 'destructive',
          onPress: async () => {
            const err = await block(id);
            if (err) Alert.alert(t('block.error'));
          },
        },
      ]);
    }
  }, [isBlocked, id, t, block, unblock]);

  // „Începe o conversație privată" (10 aug) — același flux ca „Contactează" de pe
  // ecranul bogat de mecanic: start_direct_conversation e universal (19.6), serverul
  // întoarce conversația existentă dacă perechea are deja una.
  const [contacting, setContacting] = useState(false);
  const handleStartConversation = useCallback(async () => {
    if (contacting) return;
    if (isBlocked) {
      Alert.alert(t('block.blockedByYouTitle'), t('block.blockedByYou'), [
        { text: t('block.cancel'), style: 'cancel' },
        { text: t('block.unblock'), onPress: () => unblock(id) },
      ]);
      return;
    }
    setContacting(true);
    const { conversationId, error } = await startDirectConversation(id);
    setContacting(false);
    if (error === 'blocked_by_you') {
      Alert.alert(t('newConversation.blockedTitle'), t('newConversation.blockedBody'));
      return;
    }
    if (error || !conversationId) {
      Alert.alert(t('common.error'));
      return;
    }
    router.push({
      pathname:
        role === 'driver' ? '/(driver)/conversations/[id]' : '/(mechanic)/conversations/[id]',
      params: { id: conversationId },
    } as never);
  }, [contacting, isBlocked, id, t, unblock, router, role]);

  // Partajarea contactului ÎN AFARA aplicației (7 sept): WhatsApp, Messenger, SMS… prin
  // sheet-ul nativ; linkul deschide profilul în aplicație sau duce la instalare.
  // Merge și pe propriul profil (își trimite cineva contactul unui client).
  const handleShare = useCallback(async () => {
    if (!profile) return;
    try {
      const result = await shareContact(
        { id, name: displayName(profile, t), role: profile.role },
        t,
      );
      if (result === 'copied') Alert.alert(t('shareContact.copied'));
    } catch {
      Alert.alert(t('shareContact.error'));
    }
  }, [id, profile, t]);

  const load = useCallback(async () => {
    setLoading(true);
    setProfile(await (guest ? fetchGuestPublicProfile(id) : fetchPublicProfile(id)));
    setLoading(false);
  }, [id, guest]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!guest) return;
    let active = true;
    getGuestFavorites().then((ids) => {
      if (active) setGuestFavorite(ids.includes(id));
    });
    return () => {
      active = false;
    };
  }, [guest, id]);

  const handleToggleGuestFavorite = useCallback(async () => {
    const ids = await toggleGuestFavorite(id);
    setGuestFavorite(ids.includes(id));
  }, [id]);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={theme.brand} />
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
      <ScreenHeader
        title={t('publicProfile.title')}
        onBack={goBack}
        right={
          !isDeletedUser(profile) ? (
            <View style={styles.headerActions}>
              <Pressable
                onPress={handleShare}
                hitSlop={12}
                accessibilityLabel={t('shareContact.action')}>
                <MaterialIcons name="share" size={24} color={theme.onHeader} />
              </Pressable>
              {guest && isMechanic ? (
                <Pressable
                  onPress={handleToggleGuestFavorite}
                  hitSlop={12}
                  accessibilityLabel={t('favorites.toggle')}>
                  <MaterialIcons
                    name={guestFavorite ? 'star' : 'star-outline'}
                    size={24}
                    color={theme.onHeader}
                  />
                </Pressable>
              ) : null}
              {guest ? (
                <>
                  <Pressable
                    onPress={() => requireAccount('report')}
                    hitSlop={12}
                    accessibilityLabel={t('report.title')}>
                    <MaterialIcons name="flag" size={24} color={theme.onHeader} />
                  </Pressable>
                  <Pressable
                    onPress={() => requireAccount('block')}
                    hitSlop={12}
                    accessibilityLabel={t('block.action')}>
                    <MaterialIcons name="block" size={24} color={theme.onHeader} />
                  </Pressable>
                </>
              ) : canReport ? (
                <>
                  <Pressable
                    onPress={() => setReportVisible(true)}
                    hitSlop={12}
                    accessibilityLabel={t('report.title')}>
                    <MaterialIcons name="flag" size={24} color={theme.onHeader} />
                  </Pressable>
                  <Pressable
                    onPress={handleToggleBlock}
                    hitSlop={12}
                    accessibilityLabel={isBlocked ? t('block.unblockAction') : t('block.action')}>
                    <MaterialIcons
                      name={isBlocked ? 'person-off' : 'block'}
                      size={24}
                      color={theme.onHeader}
                    />
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : undefined
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Avatar url={avatarUrl} name={displayName(profile, t)} size={72} userId={id} />
          <ThemedText type="smallBold">{displayName(profile, t)}</ThemedText>
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
                <MaterialIcons name="build" size={16} color={theme.brand} />
                <ThemedText type="smallBold">{t('profile.specializationLabel')}</ThemedText>
              </View>
              <ThemedText themeColor={profile.specialization ? undefined : 'textSecondary'}>
                {profile.specialization || t('profile.emptyField')}
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="place" size={16} color={theme.brand} />
                <ThemedText type="smallBold">{t('profile.activityZoneLabel')}</ThemedText>
              </View>
              <ThemedText themeColor={profile.activity_zone ? undefined : 'textSecondary'}>
                {profile.activity_zone || t('profile.emptyField')}
              </ThemedText>
            </ThemedView>

            {/* Faza 18: adresă + TVA — publice DOAR la mecanici (informații de prestator).
                Oaspeții nu le primesc (D3) → secțiunile lipsesc, nu apar ca „necompletat”. */}
            {!guest ? (
            <>
            <ThemedView type="backgroundElement" style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="home-work" size={16} color={theme.brand} />
                <ThemedText type="smallBold">{t('profile.addressLabel')}</ThemedText>
              </View>
              <ThemedText themeColor={profile.address ? undefined : 'textSecondary'}>
                {profile.address || t('profile.emptyField')}
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="receipt-long" size={16} color={theme.brand} />
                <ThemedText type="smallBold">{t('profile.vatLabel')}</ThemedText>
              </View>
              <ThemedText themeColor={profile.vat_number ? undefined : 'textSecondary'}>
                {profile.vat_number || t('profile.emptyField')}
              </ThemedText>
            </ThemedView>
            </>
            ) : null}
          </>
        ) : null}

        {/* Firmă + email de contact — publice, la ambele roluri. */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="business" size={16} color={theme.brand} />
            <ThemedText type="smallBold">{t('profile.companyLabel')}</ThemedText>
          </View>
          <ThemedText themeColor={profile.company_name ? undefined : 'textSecondary'}>
            {profile.company_name || t('profile.emptyField')}
          </ThemedText>
        </ThemedView>

        {!guest ? (
        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="email" size={16} color={theme.brand} />
            <ThemedText type="smallBold">{t('profile.emailLabel')}</ThemedText>
          </View>
          <ThemedText themeColor={profile.contact_email ? undefined : 'textSecondary'}>
            {profile.contact_email || t('profile.emptyField')}
          </ThemedText>
        </ThemedView>
        ) : null}

        {/* Aceleași condiții ca raportarea: nu pe tine însuți, nu pe un cont șters.
            Oaspetele vede butonul, dar el deschide pop-upul de cont. */}
        {canReport || guest ? (
          <Pressable
            onPress={guest ? () => requireAccount('contact') : handleStartConversation}
            disabled={contacting}
            style={({ pressed }) => [
              styles.contactButton,
              { backgroundColor: theme.primary },
              (pressed || contacting) && styles.pressed,
            ]}>
            {contacting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="chat" size={18} color="#fff" />
            )}
            <ThemedText style={styles.contactButtonText}>
              {t('publicProfile.startConversation')}
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>

      {reportVisible ? (
        <ReportSheet
          visible
          reportedUserId={id}
          onClose={() => setReportVisible(false)}
          onSubmitted={() => {
            setReportVisible(false);
            Alert.alert(t('report.submittedTitle'), t('report.submitted'));
          }}
        />
      ) : null}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.control,
    // backgroundColor vine inline din theme.primary.
    marginTop: Spacing.two,
  },
  contactButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
