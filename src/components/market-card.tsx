import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { RemoteImage } from '@/components/remote-image';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import type { MarketListing } from '@/types/database';

/**
 * Card de grilă Market (design final 23 iul, după screenshot): 2 coloane, imagine
 * sus ~110px (fallback: placeholder + iconiță outline), corp cu titlu 13/700 pe max
 * 2 rânduri, categorie 11/600 terțiar, preț 14/800 pe tokenul `price`.
 * Umbra de card doar pe light (în dark suprafața e suficientă — regula redesignului).
 */

interface MarketCardProps {
  listing: MarketListing;
  coverUrl?: string;
  onPress: () => void;
  /** 26 iul: aspectul „dreptunghi" (listă pe un rând: poză pătrată stânga + detalii). */
  horizontal?: boolean;
}

export function formatListingPrice(listing: Pick<MarketListing, 'price' | 'currency'>): string {
  return `${Number(listing.price).toLocaleString()} ${listing.currency}`;
}

export function MarketCard({ listing, coverUrl, onPress, horizontal = false }: MarketCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const sold = listing.status === 'sold';

  if (horizontal) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
        <ThemedView
          type="backgroundElement"
          style={[styles.card, styles.rowCard, scheme === 'light' && Shadows.card]}>
          <View style={styles.rowCoverWrap}>
            {coverUrl ? (
              <RemoteImage
                uri={coverUrl}
                style={[styles.rowCover, { backgroundColor: theme.backgroundSelected }]}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <View style={[styles.rowCover, styles.coverFallback, { backgroundColor: theme.backgroundSelected }]}>
                <Feather name="image" size={22} color={theme.textTertiary} />
              </View>
            )}
            {sold ? (
              <View style={styles.soldBadge}>
                <ThemedText style={styles.soldText}>{t('market.soldBadge')}</ThemedText>
              </View>
            ) : null}
          </View>
          <View style={styles.rowBody}>
            <View>
              <ThemedText numberOfLines={2} style={styles.rowTitle}>
                {listing.title}
              </ThemedText>
              <ThemedText numberOfLines={1} style={[styles.rowCategory, { color: theme.textTertiary }]}>
                {t(`market.categories.${listing.category}`)}
              </ThemedText>
            </View>
            {/* Prețul: dreapta-jos (spec 26 iul). */}
            <ThemedText numberOfLines={1} style={[styles.rowPrice, { color: theme.price }]}>
              {formatListingPrice(listing)}
            </ThemedText>
          </View>
        </ThemedView>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
      <ThemedView
        type="backgroundElement"
        style={[styles.card, scheme === 'light' && Shadows.card]}>
        <View style={styles.coverWrap}>
          {/* Fundalul fallback-ului și cât se încarcă poza (15 oct): un cover care încă
              se descarcă (sau a picat și reîncearcă) nu mai lasă cardul alb, ca „fără poză". */}
          {coverUrl ? (
            <RemoteImage
              uri={coverUrl}
              style={[styles.cover, { backgroundColor: theme.backgroundSelected }]}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={[styles.cover, styles.coverFallback, { backgroundColor: theme.backgroundSelected }]}>
              <Feather name="image" size={24} color={theme.textTertiary} />
            </View>
          )}
          {sold ? (
            <View style={styles.soldBadge}>
              <ThemedText style={styles.soldText}>{t('market.soldBadge')}</ThemedText>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          <ThemedText numberOfLines={2} style={styles.title}>
            {listing.title}
          </ThemedText>
          <ThemedText
            numberOfLines={1}
            style={[styles.category, { color: theme.textTertiary }]}>
            {t(`market.categories.${listing.category}`)}
          </ThemedText>
          <ThemedText numberOfLines={1} style={[styles.price, { color: theme.price }]}>
            {formatListingPrice(listing)}
          </ThemedText>
        </View>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Lățimea o dă coloana FlatList-ului (numColumns=2 + gap din columnWrapper).
  wrap: { flex: 1 },
  pressed: { opacity: 0.85 },
  card: {
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  coverWrap: { position: 'relative' },
  cover: {
    width: '100%',
    height: 110,
  },
  coverFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  soldBadge: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  soldText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  body: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  // minHeight pe 2 rânduri ca prețurile să se alinieze pe orizontală între carduri.
  title: { fontSize: 13, fontWeight: '700', lineHeight: 17, minHeight: 34 },
  category: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  price: { fontSize: 14, fontWeight: '800', marginTop: 6 },
  // Aspectul „dreptunghi" (26 iul): rând orizontal, poza 96 lățime pe TOATĂ înălțimea.
  // Poza e strat ABSOLUT în caseta de 96: `height:'100%'` pe expo-image cădea pe
  // dimensiunea intrinsecă a pozei (card uriaș + listă blocată) când părintele era
  // dimensionat prin stretch. Înălțimea rândului o dă DOAR corpul (minHeight 96).
  rowCard: { flexDirection: 'row', alignItems: 'stretch', minHeight: 96 },
  rowCoverWrap: { width: 96, position: 'relative', overflow: 'hidden' },
  rowCover: { ...StyleSheet.absoluteFillObject },
  rowBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'space-between',
    gap: 6,
  },
  rowTitle: { fontSize: 15, fontWeight: '700', lineHeight: 19 },
  rowCategory: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  rowPrice: { fontSize: 16, fontWeight: '800', alignSelf: 'flex-end' },
});
