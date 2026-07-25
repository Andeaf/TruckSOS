import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

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
}

export function formatListingPrice(listing: Pick<MarketListing, 'price' | 'currency'>): string {
  return `${Number(listing.price).toLocaleString()} ${listing.currency}`;
}

export function MarketCard({ listing, coverUrl, onPress }: MarketCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const sold = listing.status === 'sold';

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
      <ThemedView
        type="backgroundElement"
        style={[styles.card, scheme === 'light' && Shadows.card]}>
        <View style={styles.coverWrap}>
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.cover} contentFit="cover" transition={150} />
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
});
