import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterChips } from '@/components/ui/filter-chips';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '@/constants/currencies';
import { useBack } from '@/hooks/use-back';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  MARKET_CATEGORIES,
  createMarketListing,
  deleteMarketPhoto,
  fetchMarketListing,
  fetchMarketListingPhotos,
  updateMarketListing,
  updateMarketPhotoPosition,
  uploadMarketPhotoAt,
} from '@/hooks/use-market';
import { pickFromCamera, pickFromLibrary, type PickedImage } from '@/lib/media';
import type { MarketCategory } from '@/types/database';

/**
 * Formularul de anunț Market (creare + editare — PLAN_FAZA19.md §3.5).
 * Pozele sunt o listă MIXTĂ (existente remote + noi locale) cu cover = prima;
 * long-press pe orice thumbnail → „fă cover" (mutare în față — §8.6: fără drag în v1).
 * La editare, ștergerile și pozițiile se aplică LA SALVARE, nu imediat.
 */

const MAX_PHOTOS = 10;
const THUMB = 76;

type FormPhoto =
  | { kind: 'remote'; id: string; storage_path: string; url: string }
  | { kind: 'local'; img: PickedImage };

interface MarketFormScreenProps {
  role: 'driver' | 'mechanic';
  /** Prezent = editare. */
  listingId?: string;
}

export function MarketFormScreen({ role, listingId: listingIdProp }: MarketFormScreenProps) {
  const params = useLocalSearchParams<{ id?: string }>();
  const listingId = listingIdProp ?? params.id;
  const editing = !!listingId;

  const { t } = useTranslation();
  const theme = useTheme();
  const { session } = useAuth();
  const base = role === 'driver' ? '/(driver)/market' : '/(mechanic)/market';
  const goBack = useBack(base);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY.code);
  const [category, setCategory] = useState<MarketCategory | null>(null);
  const [photos, setPhotos] = useState<FormPhoto[]>([]);
  const [removedRemote, setRemovedRemote] = useState<{ id: string; storage_path: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(editing);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  // Editare: populăm formularul din DB o singură dată.
  useEffect(() => {
    if (!editing || !listingId) return;
    let active = true;
    (async () => {
      const [listing, existing] = await Promise.all([
        fetchMarketListing(listingId),
        fetchMarketListingPhotos(listingId),
      ]);
      if (!active || !listing) {
        setInitialLoading(false);
        return;
      }
      setTitle(listing.title);
      setDescription(listing.description);
      setPriceStr(String(listing.price));
      setCurrency(listing.currency);
      setCategory(listing.category);
      setPhotos(existing.map((p) => ({ kind: 'remote', id: p.id, storage_path: p.storage_path, url: p.url })));
      setInitialLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [editing, listingId]);

  // Guard „modificări nesalvate" — modelul din formularul de anunț (Faza 8).
  const navigation = useNavigation();
  const savedRef = useRef(false);
  const isDirty = editing
    ? dirty
    : title.trim() !== '' || description.trim() !== '' || priceStr.trim() !== '' ||
      category !== null || photos.length > 0;

  usePreventRemove(isDirty && !savedRef.current, ({ data }) => {
    Alert.alert(t('market.discardTitle'), t('market.discardMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('market.discardOk'),
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  function markDirty() {
    setDirty(true);
  }

  function handleAddPhotos() {
    if (photos.length >= MAX_PHOTOS) return;
    Alert.alert(t('photos.sourceTitle'), undefined, [
      {
        text: t('photos.sourceLibrary'),
        onPress: async () => {
          const imgs = await pickFromLibrary();
          addClamped(imgs);
        },
      },
      {
        text: t('photos.sourceCamera'),
        onPress: async () => {
          const imgs = await pickFromCamera();
          addClamped(imgs);
        },
      },
      { text: t('photos.cancel'), style: 'cancel' },
    ]);
  }

  function addClamped(imgs: PickedImage[]) {
    if (imgs.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const toAdd = imgs.slice(0, remaining);
    if (imgs.length > remaining) {
      Alert.alert(t('photos.limitReachedTitle'), t('photos.limitReached', { max: MAX_PHOTOS }));
    }
    setPhotos((prev) => [...prev, ...toAdd.map((img) => ({ kind: 'local', img }) as FormPhoto)]);
    markDirty();
  }

  function handleRemovePhoto(index: number) {
    const photo = photos[index];
    if (photo.kind === 'remote') {
      setRemovedRemote((prev) => [...prev, { id: photo.id, storage_path: photo.storage_path }]);
    }
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    markDirty();
  }

  function handleMakeCover(index: number) {
    if (index === 0) return;
    setPhotos((prev) => [prev[index], ...prev.filter((_, i) => i !== index)]);
    markDirty();
    Alert.alert(t('market.coverSetTitle'), t('market.coverSetMessage'));
  }

  async function handleSubmit() {
    if (title.trim().length < 3) {
      setError(t('market.errorTitle'));
      return;
    }
    if (!description.trim()) {
      setError(t('market.errorDescription'));
      return;
    }
    const price = parseFloat(priceStr.trim().replace(',', '.'));
    if (isNaN(price) || price <= 0) {
      setError(t('market.errorPrice'));
      return;
    }
    if (!category) {
      setError(t('market.errorCategory'));
      return;
    }
    if (!session) return;

    setLoading(true);
    setError('');

    const fields = {
      title: title.trim(),
      description: description.trim(),
      price,
      currency,
      category,
    };

    let id = listingId ?? null;
    if (editing && id) {
      const err = await updateMarketListing(id, fields);
      if (err) {
        setLoading(false);
        setError(err.includes('account_banned') ? t('common.error') : t('common.error'));
        return;
      }
    } else {
      const { id: newId, error: createErr } = await createMarketListing(session.user.id, fields);
      if (createErr || !newId) {
        setLoading(false);
        setError(
          createErr?.includes('listing_limit_reached')
            ? t('market.limitReachedMessage')
            : t('common.error'),
        );
        return;
      }
      id = newId;
    }

    // Pozele: ștergerile (doar la editare), apoi pozițiile finale în ordinea listei —
    // remote → update position, local → upload la poziția respectivă. Best-effort.
    for (const removed of removedRemote) {
      await deleteMarketPhoto(removed);
    }
    let failed = 0;
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      if (photo.kind === 'remote') {
        await updateMarketPhotoPosition(photo.id, i);
      } else {
        const ok = await uploadMarketPhotoAt(id, photo.img, i);
        if (!ok) failed++;
      }
    }
    if (failed > 0) {
      Alert.alert(t('market.photosFailedTitle'), t('market.photosFailedMessage', { count: failed }));
    }

    setLoading(false);
    savedRef.current = true;
    goBack();
  }

  if (initialLoading) {
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader title={t(editing ? 'market.editTitle' : 'market.newTitle')} onBack={goBack} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t(editing ? 'market.editTitle' : 'market.newTitle')} onBack={goBack} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Input
            label={t('market.titleLabel')}
            value={title}
            onChangeText={(v) => {
              setTitle(v);
              markDirty();
            }}
            placeholder={t('market.titlePlaceholder')}
            autoCapitalize="sentences"
            maxLength={80}
          />

          <View style={styles.fieldGroup}>
            <ThemedText type="smallBold">{t('market.categoryLabel')}</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
              <FilterChips<MarketCategory>
                options={MARKET_CATEGORIES.map((c) => ({
                  key: c,
                  label: t(`market.categories.${c}`),
                }))}
                value={(category ?? '') as MarketCategory}
                onChange={(c) => {
                  setCategory(c);
                  markDirty();
                }}
              />
            </ScrollView>
          </View>

          <View style={styles.priceRow}>
            <View style={styles.priceField}>
              <Input
                label={t('market.priceLabel')}
                value={priceStr}
                onChangeText={(v) => {
                  setPriceStr(v);
                  markDirty();
                }}
                placeholder="0"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.currencyChips}>
              {SUPPORTED_CURRENCIES.map((c) => {
                const active = currency === c.code;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => {
                      setCurrency(c.code);
                      markDirty();
                    }}
                    style={[
                      styles.currencyChip,
                      active
                        ? { backgroundColor: theme.brand }
                        : { backgroundColor: theme.backgroundElement },
                    ]}>
                    <ThemedText
                      style={[styles.currencyText, { color: active ? '#fff' : theme.textSecondary }]}>
                      {c.code}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Input
            label={t('market.descriptionFieldLabel')}
            value={description}
            onChangeText={(v) => {
              setDescription(v);
              markDirty();
            }}
            placeholder={t('market.descriptionPlaceholder')}
            autoCapitalize="sentences"
            multiline
            numberOfLines={5}
            maxLength={4000}
            style={styles.textarea}
          />

          <View style={styles.fieldGroup}>
            <ThemedText type="smallBold">{t('market.photosLabel')}</ThemedText>
            <ThemedText themeColor="textSecondary" type="small">
              {t('market.photosHint')}
            </ThemedText>
            <View style={styles.photoRow}>
              {photos.map((photo, index) => (
                <Pressable
                  key={photo.kind === 'remote' ? photo.id : `${photo.img.uri}-${index}`}
                  onLongPress={() => handleMakeCover(index)}
                  delayLongPress={300}
                  style={styles.thumbWrap}>
                  <Image
                    source={{ uri: photo.kind === 'remote' ? photo.url : photo.img.uri }}
                    style={styles.thumb}
                    contentFit="cover"
                    transition={100}
                  />
                  {index === 0 ? (
                    <View style={[styles.coverBadge, { backgroundColor: theme.brand }]}>
                      <ThemedText style={styles.coverBadgeText}>{t('market.coverBadge')}</ThemedText>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => handleRemovePhoto(index)}
                    style={styles.removeBtn}
                    hitSlop={8}>
                    <MaterialIcons name="close" size={14} color="#fff" />
                  </Pressable>
                </Pressable>
              ))}

              {photos.length < MAX_PHOTOS ? (
                <Pressable
                  onPress={handleAddPhotos}
                  disabled={loading}
                  style={[styles.addTile, { borderColor: theme.textSecondary }]}
                  hitSlop={4}>
                  <MaterialIcons name="add-a-photo" size={22} color={theme.textSecondary} />
                  <ThemedText themeColor="textSecondary" type="small" style={styles.addText}>
                    {t('photos.add')}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          </View>

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <Button
            title={t(editing ? 'market.saveButton' : 'market.publishButton')}
            onPress={handleSubmit}
            loading={loading}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  form: { padding: Spacing.four, gap: Spacing.three },
  fieldGroup: { gap: Spacing.two },
  // FilterChips vine cu padding orizontal 22 propriu — îl anulăm în context de formular.
  chipsScroll: { marginHorizontal: -22 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  priceField: { flex: 1 },
  currencyChips: { flexDirection: 'row', gap: Spacing.one, paddingBottom: Spacing.one },
  currencyChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.control,
  },
  currencyText: { fontSize: 14, fontWeight: '700' },
  textarea: { height: 120, textAlignVertical: 'top', paddingTop: Spacing.two },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  thumbWrap: { width: THUMB, height: THUMB },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.card,
    backgroundColor: '#00000010',
  },
  coverBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    borderRadius: Radius.badge,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  coverBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: Radius.circle,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addTile: {
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  addText: { fontSize: 11, textAlign: 'center' },
  error: { color: '#ef4444', fontSize: 14 },
});
