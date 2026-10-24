import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/ui/button';
import { PhotoViewer } from '@/components/photo-viewer';
import { RatingBadge } from '@/components/rating-badge';
import { RemoteImage } from '@/components/remote-image';
import { ReportSheet } from '@/components/report-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UserPickerSheet } from '@/components/user-picker-sheet';
import { formatListingPrice } from '@/components/market-card';
import { Radius, Spacing } from '@/constants/theme';
import { useBack } from '@/hooks/use-back';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useSignedUrl } from '@/hooks/use-signed-urls';
import {
  deleteMarketListing,
  fetchMarketListing,
  fetchMarketListingPhotos,
  setMarketListingStatus,
  startMarketConversation,
  type MarketListingWithSeller,
  type MarketPhotoWithUrl,
} from '@/hooks/use-market';
import { startDirectConversation } from '@/hooks/use-chat';
import { displayName } from '@/lib/display-name';
import type { Role } from '@/types/database';

/**
 * Detaliu anunț Market (PLAN_FAZA19.md §3.3): galerie full-width cu pager + viewer,
 * preț/categorie/descriere, secțiune vânzător (profil public pe rolul REAL), contact
 * prin chat (fără telefon — garantat și de server), report; pe anunțul propriu:
 * Editează / Vândut / Șterge.
 */

interface MarketDetailScreenProps {
  role: Extract<Role, 'driver' | 'mechanic'>;
}

export function MarketDetailScreen({ role }: MarketDetailScreenProps) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const { width } = useWindowDimensions();
  const base = role === 'driver' ? '/(driver)/market' : '/(mechanic)/market';
  const goBack = useBack(base);

  const [listing, setListing] = useState<MarketListingWithSeller | null>(null);
  const [photos, setPhotos] = useState<MarketPhotoWithUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [contacting, setContacting] = useState(false);
  const [busy, setBusy] = useState(false);

  const sellerAvatarUrl = useSignedUrl(listing?.seller?.avatar_path);

  // Refresh la focus: editarea (push-uită deasupra) modifică datele.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [l, p] = await Promise.all([
          fetchMarketListing(id ?? ''),
          fetchMarketListingPhotos(id ?? ''),
        ]);
        if (!active) return;
        setListing(l);
        setPhotos(p);
        setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [id]),
  );

  const isOwner = !!listing && listing.seller_id === session?.user.id;
  const sold = listing?.status === 'sold';

  // Faza 19.6: share — trimite anunțul de market unui alt utilizator (cardul 19.4
  // pe primul mesaj, prin parametrul listingId al rutei de conversație).
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const handleShareTo = async (targetId: string) => {
    if (!listing || sharing) return;
    setSharing(true);
    const { conversationId, error } = await startDirectConversation(targetId);
    setSharing(false);
    setShareOpen(false);
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
      params: { id: conversationId, listingId: listing.id },
    } as never);
  };

  async function handleContact() {
    if (!listing || contacting) return;
    setContacting(true);
    const { conversationId, error } = await startMarketConversation(listing.id);
    setContacting(false);
    if (error === 'blocked_by_you') {
      Alert.alert(t('market.contactBlockedTitle'), t('market.contactBlockedMessage'));
      return;
    }
    if (error || !conversationId) {
      Alert.alert(t('common.error'));
      return;
    }
    // listingId: primul mesaj trimis va purta cardul anunțului (Faza 19.4).
    router.push({
      pathname: role === 'driver' ? '/(driver)/conversations/[id]' : '/(mechanic)/conversations/[id]',
      params: { id: conversationId, listingId: listing.id },
    } as never);
  }

  function handleOpenSeller() {
    if (!listing?.seller || listing.seller.deleted_at) return;
    // Rolul REAL al vânzătorului decide ecranul de profil (nu rolul privitorului).
    if (listing.seller.role === 'mechanic') {
      router.push({
        pathname: role === 'driver' ? '/(driver)/mechanic-profile/[id]' : '/(mechanic)/public-profile/[id]',
        params: { id: listing.seller_id },
      } as never);
    } else {
      router.push({
        pathname: role === 'driver' ? '/(driver)/public-profile/[id]' : '/(mechanic)/public-profile/[id]',
        params: { id: listing.seller_id },
      } as never);
    }
  }

  async function handleToggleSold() {
    if (!listing || busy) return;
    const next = sold ? 'active' : 'sold';
    const confirmKey = sold ? 'market.relistConfirm' : 'market.soldConfirm';
    Alert.alert(t(`${confirmKey}Title`), t(`${confirmKey}Message`), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t(`${confirmKey}Ok`),
        onPress: async () => {
          setBusy(true);
          const err = await setMarketListingStatus(listing.id, next);
          setBusy(false);
          if (err) {
            // Re-listarea poate lovi plafonul de 20 anunțuri active (trigger DB).
            Alert.alert(
              t('common.error'),
              err.includes('listing_limit_reached') ? t('market.limitReachedMessage') : undefined,
            );
            return;
          }
          setListing({ ...listing, status: next });
        },
      },
    ]);
  }

  function handleDelete() {
    if (!listing || busy) return;
    Alert.alert(t('market.deleteConfirmTitle'), t('market.deleteConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('market.deleteConfirmOk'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const err = await deleteMarketListing(
            listing.id,
            photos.map((p) => p.storage_path),
          );
          setBusy(false);
          if (err) {
            Alert.alert(t('common.error'));
            return;
          }
          goBack();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader title={t('market.detailTitle')} onBack={goBack} />
        <ActivityIndicator style={styles.loader} color={theme.textSecondary} />
      </ThemedView>
    );
  }

  if (!listing) {
    // Inexistent SAU ascuns de RLS (blocare) — indistinctibil, intenționat.
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader title={t('market.detailTitle')} onBack={goBack} />
        <View style={styles.notFound}>
          <MaterialIcons name="search-off" size={40} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary">{t('market.notFound')}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  const createdLabel = new Date(listing.created_at).toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('market.detailTitle')}
        onBack={goBack}
        right={
          <View style={styles.headerActions}>
            {/* Faza 19.6: share — trimite anunțul unui mecanic sau șofer. */}
            <Pressable
              onPress={() => setShareOpen(true)}
              hitSlop={8}
              accessibilityLabel={t('attach.shareTitle')}>
              <MaterialIcons name="share" size={22} color={theme.onHeader} />
            </Pressable>
            {!isOwner ? (
              <Pressable onPress={() => setReportOpen(true)} hitSlop={8}>
                <MaterialIcons name="flag" size={22} color={theme.onHeader} />
              </Pressable>
            ) : null}
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Galeria: pager orizontal full-width; tap → viewer-ul full-screen existent. */}
        {photos.length > 0 ? (
          <View>
            <FlatList
              data={photos}
              keyExtractor={(p) => p.id}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) =>
                setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / width))
              }
              renderItem={({ item, index }) => (
                <Pressable onPress={() => setViewerAt(index)}>
                  <RemoteImage
                    uri={item.url}
                    style={{ width, aspectRatio: 4 / 3 }}
                    contentFit="cover"
                    transition={150}
                  />
                </Pressable>
              )}
            />
            {photos.length > 1 ? (
              <View style={styles.dots}>
                {photos.map((p, i) => (
                  <View
                    key={p.id}
                    style={[
                      styles.dot,
                      { backgroundColor: i === photoIndex ? '#fff' : 'rgba(255,255,255,0.45)' },
                    ]}
                  />
                ))}
              </View>
            ) : null}
            {sold ? (
              <View style={styles.soldOverlay}>
                <ThemedText style={styles.soldOverlayText}>{t('market.soldBadge')}</ThemedText>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.title}>
            {listing.title}
          </ThemedText>
          <ThemedText style={[styles.price, { color: theme.brand }]}>
            {formatListingPrice(listing)}
          </ThemedText>
          <View style={styles.metaRow}>
            <View style={[styles.categoryChip, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="small">{t(`market.categories.${listing.category}`)}</ThemedText>
            </View>
            <ThemedText themeColor="textSecondary" type="small">
              {createdLabel}
            </ThemedText>
          </View>
        </View>

        {sold && !isOwner ? (
          <View style={[styles.soldBanner, { backgroundColor: theme.backgroundSelected }]}>
            <MaterialIcons name="check-circle" size={18} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary">{t('market.soldBanner')}</ThemedText>
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText type="smallBold">{t('market.descriptionLabel')}</ThemedText>
          <ThemedText style={styles.description}>{listing.description}</ThemedText>
        </View>

        {/* Vânzătorul */}
        <Pressable
          onPress={handleOpenSeller}
          style={({ pressed }) => [
            styles.sellerRow,
            { backgroundColor: theme.backgroundElement },
            pressed && styles.pressed,
          ]}>
          <Avatar url={sellerAvatarUrl} name={listing.seller?.full_name} size={44} />
          <View style={styles.sellerInfo}>
            <ThemedText style={styles.sellerName} numberOfLines={1}>
              {displayName(listing.seller, t)}
            </ThemedText>
            {listing.seller?.role === 'mechanic' ? (
              <RatingBadge
                avg={listing.seller.rating_avg}
                count={listing.seller.rating_count}
              />
            ) : (
              <ThemedText themeColor="textSecondary" type="small">
                {t('market.sellerDriver')}
              </ThemedText>
            )}
          </View>
          <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
        </Pressable>

        {/* Acțiuni */}
        {isOwner ? (
          <View style={styles.ownerActions}>
            <Button
              title={t('market.editButton')}
              onPress={() =>
                router.push({ pathname: `${base}/edit/[id]`, params: { id: listing.id } } as never)
              }
            />
            <Button
              title={sold ? t('market.relistButton') : t('market.markSoldButton')}
              variant="secondary"
              onPress={handleToggleSold}
              loading={busy}
            />
            <Pressable onPress={handleDelete} style={styles.deleteRow} hitSlop={8}>
              <MaterialIcons name="delete-outline" size={18} color="#ef4444" />
              <ThemedText style={styles.deleteText}>{t('market.deleteButton')}</ThemedText>
            </Pressable>
          </View>
        ) : !sold ? (
          <View style={styles.contactWrap}>
            <Button
              title={t('market.contactButton')}
              onPress={handleContact}
              loading={contacting}
            />
          </View>
        ) : null}
      </ScrollView>

      {shareOpen ? (
        <UserPickerSheet
          visible
          title={t('attach.shareTitle')}
          onClose={() => setShareOpen(false)}
          onPick={(user) => handleShareTo(user.id)}
        />
      ) : null}

      {viewerAt !== null ? (
        <PhotoViewer
          visible
          photos={photos.map((p) => ({ id: p.id, url: p.url }))}
          initialIndex={viewerAt}
          onClose={() => setViewerAt(null)}
        />
      ) : null}

      <ReportSheet
        visible={reportOpen}
        reportedUserId={listing.seller_id}
        listingId={listing.id}
        contentSnapshot={`${listing.title}\n${listing.description}`}
        imagePathSnapshot={photos[0]?.storage_path ?? null}
        onClose={() => setReportOpen(false)}
        onSubmitted={() => {
          setReportOpen(false);
          Alert.alert(t('report.submittedTitle'), t('report.submitted'));
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  container: { flex: 1 },
  loader: { marginTop: Spacing.six },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  content: { paddingBottom: Spacing.six },
  dots: {
    position: 'absolute',
    bottom: Spacing.two,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: Radius.circle },
  soldOverlay: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  soldOverlayText: { color: '#fff', fontWeight: '800' },
  section: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.one,
  },
  title: { fontSize: 22, lineHeight: 28 },
  price: { fontSize: 24, fontWeight: '800' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  categoryChip: {
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  soldBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  description: { lineHeight: 22 },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.four,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  sellerInfo: { flex: 1, gap: 2 },
  sellerName: { fontSize: 16, fontWeight: '700' },
  contactWrap: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  ownerActions: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.two,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  deleteText: { color: '#ef4444', fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
