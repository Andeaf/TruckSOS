import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import { useTheme } from '@/hooks/use-theme';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TruckPickerSheet } from '@/components/truck-picker-sheet';
import { PhotoPickerRow } from '@/components/photo-picker-row';
import { Radius, Spacing } from '@/constants/theme';
import type { PickedImage } from '@/lib/media';
import { useAccountGate } from '@/hooks/use-account-gate';
import { useAuth } from '@/hooks/use-auth';
import { usePushPermissionRequest } from '@/hooks/use-push-permission-request';
import { createAnnouncement } from '@/hooks/use-announcements';
import {
  clearAnnouncementDraft,
  loadAnnouncementDraft,
  saveAnnouncementDraft,
} from '@/lib/announcement-draft';
import { uploadAnnouncementPhotos } from '@/hooks/use-announcement-photos';
import { useSavedTrucks } from '@/hooks/use-trucks';
import { getCurrentCoords } from '@/lib/location';

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Formularul de anunț nou — partajat între roluri (tiparul MarketFormScreen):
 * mecanicii postează identic cu transportatorii (5 aug); diferă doar ruta de back.
 */
/**
 * `guest` (1.1, B3): oaspetele completează formularul; „Publică” salvează draftul local
 * (B2 copiază pozele în documentDirectory) și deschide pop-upul de cont. La deschidere,
 * un draft existent precompletează formularul — și pentru oaspete, și pentru contul nou
 * creat după el; după publicarea reușită draftul se șterge.
 */
export function AnnouncementFormScreen({
  role,
  guest = false,
}: {
  role: 'driver' | 'mechanic';
  guest?: boolean;
}) {
  const { session } = useAuth();
  const { requireAccount } = useAccountGate();
  const { request: requestPushPermission } = usePushPermissionRequest();
  const { t } = useTranslation();
  const guard = useSubmitGuard();
  const theme = useTheme();
  const goBack = useBack(
    guest
      ? '/(guest)/announcements'
      : role === 'driver'
        ? '/(driver)/announcements'
        : '/(mechanic)/feed',
  );
  const { trucks, refresh: refreshTrucks } = useSavedTrucks(!guest);

  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [truckSectionOpen, setTruckSectionOpen] = useState(false);
  const [truckMake, setTruckMake] = useState('');
  const [truckModel, setTruckModel] = useState('');
  const [truckYearStr, setTruckYearStr] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [chassisNumber, setChassisNumber] = useState('');
  const [latitudeStr, setLatitudeStr] = useState('');
  const [longitudeStr, setLongitudeStr] = useState('');
  const [photos, setPhotos] = useState<PickedImage[]>([]);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  // Draftul salvat ca oaspete (B2) precompletează formularul, o singură dată la deschidere.
  useEffect(() => {
    let active = true;
    loadAnnouncementDraft().then((draft) => {
      if (!active || !draft) return;
      setDescription(draft.description);
      setLocation(draft.location);
      setTruckMake(draft.truckMake);
      setTruckModel(draft.truckModel);
      setTruckYearStr(draft.truckYearStr);
      setPlateNumber(draft.plateNumber);
      setChassisNumber(draft.chassisNumber);
      setLatitudeStr(draft.latitudeStr);
      setLongitudeStr(draft.longitudeStr);
      setPhotos(draft.photos);
      if (draft.truckMake || draft.truckModel || draft.truckYearStr || draft.plateNumber || draft.chassisNumber) {
        setTruckSectionOpen(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Guard „modificări nesalvate": intercepteză back-ul din header, back-ul
  // hardware și swipe-ul. `savedRef` lasă trecerea liberă după un submit reușit.
  const navigation = useNavigation();
  const savedRef = useRef(false);
  const latRef = useRef<TextInput>(null);
  const lngRef = useRef<TextInput>(null);
  const descRef = useRef<TextInput>(null);
  const modelRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const plateRef = useRef<TextInput>(null);
  const chassisRef = useRef<TextInput>(null);
  const isDirty =
    description.trim() !== '' ||
    location.trim() !== '' ||
    truckMake.trim() !== '' ||
    truckModel.trim() !== '' ||
    truckYearStr.trim() !== '' ||
    plateNumber.trim() !== '' ||
    chassisNumber.trim() !== '' ||
    latitudeStr.trim() !== '' ||
    longitudeStr.trim() !== '' ||
    photos.length > 0;

  usePreventRemove(isDirty, ({ data }) => {
    if (savedRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    Alert.alert(
      t('driver.announcements.discardTitle'),
      t('driver.announcements.discardMessage'),
      [
        { text: t('driver.announcements.discardCancel'), style: 'cancel' },
        {
          text: t('driver.announcements.discardOk'),
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
      ],
    );
  });

  async function handleUseMyLocation() {
    setGpsLoading(true);
    setError('');
    const result = await getCurrentCoords();
    setGpsLoading(false);
    if ('error' in result) {
      setError(
        result.error === 'denied'
          ? t('driver.announcements.errorLocationPermission')
          : t('driver.announcements.errorLocationUnavailable'),
      );
      return;
    }
    setLatitudeStr(String(result.latitude));
    setLongitudeStr(String(result.longitude));
  }

  function handlePickerSelect(data: {
    make: string;
    model: string;
    year: number;
    plate_number: string | null;
    chassis_number: string | null;
  }) {
    setTruckMake(data.make);
    setTruckModel(data.model);
    setTruckYearStr(String(data.year));
    setPlateNumber(data.plate_number ?? '');
    setChassisNumber(data.chassis_number ?? '');
    setTruckSectionOpen(true);
  }

  function handleAddPhotos(imgs: PickedImage[]) {
    setPhotos((prev) => [...prev, ...imgs]);
  }

  function handleRemovePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!description.trim()) { setError(t('driver.announcements.errorDescription')); return; }
    if (!location.trim()) { setError(t('driver.announcements.errorLocation')); return; }
    if (!session && !guest) return;

    let truckYear: number | null = null;
    if (truckYearStr.trim()) {
      const parsed = parseInt(truckYearStr.trim(), 10);
      if (isNaN(parsed) || parsed < 1950 || parsed > CURRENT_YEAR) {
        setError(t('truck.yearError', { maxYear: CURRENT_YEAR }));
        return;
      }
      truckYear = parsed;
    }

    // Coordonate opționale: virgulă→punct (RO/DE), ambele-sau-niciuna, interval.
    const latRaw = latitudeStr.trim().replace(',', '.');
    const longRaw = longitudeStr.trim().replace(',', '.');
    let latitude: number | null = null;
    let longitude: number | null = null;
    if (latRaw || longRaw) {
      if (!latRaw || !longRaw) { setError(t('driver.announcements.errorCoordsBoth')); return; }
      const latNum = parseFloat(latRaw);
      const longNum = parseFloat(longRaw);
      if (
        isNaN(latNum) || isNaN(longNum) ||
        latNum < -90 || latNum > 90 || longNum < -180 || longNum > 180
      ) {
        setError(t('driver.announcements.errorCoordsRange'));
        return;
      }
      latitude = latNum;
      longitude = longNum;
    }

    if (guest || !session) {
      // Oaspete: draftul rămâne pe telefon și se publică după crearea contului.
      await saveAnnouncementDraft({
        description,
        location,
        truckMake,
        truckModel,
        truckYearStr,
        plateNumber,
        chassisNumber,
        latitudeStr,
        longitudeStr,
        photos,
      });
      // Draftul e salvat → ieșirea spre înregistrare nu mai cere confirmarea „renunți?”.
      savedRef.current = true;
      setError('');
      requireAccount('publish');
      return;
    }

    setLoading(true);
    setError('');
    const { id, error: createErr } = await createAnnouncement(
      session.user.id,
      description.trim(),
      location.trim(),
      {
        truckMake: truckMake.trim() || undefined,
        truckModel: truckModel.trim() || undefined,
        truckYear,
        plateNumber: plateNumber.trim().toUpperCase() || undefined,
        chassisNumber: chassisNumber.trim().toUpperCase() || undefined,
        latitude,
        longitude,
      },
    );

    if (createErr || !id) {
      setLoading(false);
      setError(createErr ?? t('common.error'));
      return;
    }

    // Anunțul e creat; urcăm pozele (best-effort, loading-ul acoperă și upload-ul).
    // Dacă vreuna eșuează, anunțul rămâne creat, dar șoferul TREBUIE să afle.
    let photosFailed = false;
    if (photos.length > 0) {
      const { failed } = await uploadAnnouncementPhotos(id, photos);
      if (failed > 0) {
        photosFailed = true;
        Alert.alert(
          t('driver.announcements.photosFailedTitle'),
          t('driver.announcements.photosFailedMessage', { count: failed }),
        );
      }
    }

    // Anunțul început ca oaspete e publicat → draftul (și pozele copiate) dispar.
    await clearAnnouncementDraft();
    setLoading(false);
    savedRef.current = true;
    goBack();
    // 1.1 (7.6): primul moment cu sens pentru notificări (ofertele vin prin push) → dialogul
    // sistemului, dacă încă nu s-a decis. Nu peste alerta „pozele n-au urcat”: două ferestre
    // una peste alta, iar alerta despre poze e mai importantă.
    if (!photosFailed) requestPushPermission('announcement-published');
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('driver.announcements.newTitle')} onBack={goBack} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled">

          <Input
            label={t('driver.announcements.locationLabel')}
            value={location}
            onChangeText={setLocation}
            placeholder={t('driver.announcements.locationPlaceholder')}
            autoCapitalize="sentences"
            returnKeyType="next"
            onSubmitEditing={() => latRef.current?.focus()}
            required
          />

          <View style={styles.coordsSection}>
            <ThemedText type="smallBold">{t('driver.announcements.coordsSectionTitle')}</ThemedText>
            <View style={styles.coordsRow}>
              <View style={styles.coordsField}>
                <Input
                  ref={latRef}
                  label={t('driver.announcements.latitudeLabel')}
                  value={latitudeStr}
                  onChangeText={setLatitudeStr}
                  placeholder={t('driver.announcements.coordsPlaceholderLat')}
                  keyboardType="numbers-and-punctuation"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => lngRef.current?.focus()}
                />
              </View>
              <View style={styles.coordsField}>
                <Input
                  ref={lngRef}
                  label={t('driver.announcements.longitudeLabel')}
                  value={longitudeStr}
                  onChangeText={setLongitudeStr}
                  placeholder={t('driver.announcements.coordsPlaceholderLong')}
                  keyboardType="numbers-and-punctuation"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => descRef.current?.focus()}
                />
              </View>
            </View>
            <Pressable
              onPress={handleUseMyLocation}
              disabled={gpsLoading}
              style={({ pressed }) => [
                styles.outlineButton,
                { borderColor: theme.brand },
                pressed && styles.pressed,
              ]}
              hitSlop={8}>
              {gpsLoading ? (
                <ActivityIndicator size="small" color={theme.brand} />
              ) : (
                <MaterialIcons name="my-location" size={16} color={theme.brand} />
              )}
              <ThemedText style={[styles.outlineButtonText, { color: theme.brand }]}>
                {t('driver.announcements.useMyLocation')}
              </ThemedText>
            </Pressable>
          </View>

          <Input
            ref={descRef}
            label={t('driver.announcements.descriptionLabel')}
            value={description}
            onChangeText={setDescription}
            placeholder={t('driver.announcements.descriptionPlaceholder')}
            autoCapitalize="sentences"
            multiline
            numberOfLines={5}
            style={styles.textarea}
            required
          />

          <View style={styles.photosSection}>
            <ThemedText type="smallBold">{t('driver.announcements.photosLabel')}</ThemedText>
            <ThemedText themeColor="textSecondary" type="small">
              {t('driver.announcements.photosHint')}
            </ThemedText>
            <PhotoPickerRow
              photos={photos}
              onAdd={handleAddPhotos}
              onRemove={handleRemovePhoto}
              disabled={loading}
            />
          </View>

          {trucks.length > 0 ? (
            <Pressable onPress={() => setShowPicker(true)} style={styles.selectSavedButton} hitSlop={8}>
              <MaterialIcons name="local-shipping" size={16} color={theme.brand} />
              <ThemedText style={[styles.selectSavedText, { color: theme.brand }]}>
                {t('truck.selectSaved')}
              </ThemedText>
            </Pressable>
          ) : null}

          {/* Buton vizibil (7 aug, decizie user) — fostul text mic se pierdea pe pagină. */}
          <Pressable
            onPress={() => setTruckSectionOpen((v) => !v)}
            style={({ pressed }) => [
              styles.outlineButton,
              { borderColor: theme.brand },
              pressed && styles.pressed,
            ]}
            hitSlop={8}>
            <MaterialIcons
              name={truckSectionOpen ? 'expand-less' : 'expand-more'}
              size={16}
              color={theme.brand}
            />
            <ThemedText style={[styles.outlineButtonText, { color: theme.brand }]}>
              {truckSectionOpen
                ? t('truck.sectionToggleHide')
                : t('truck.sectionToggleAdd')}
            </ThemedText>
          </Pressable>

          {truckSectionOpen ? (
            <View style={styles.truckSection}>
              <Input
                label={t('truck.makeLabel')}
                value={truckMake}
                onChangeText={setTruckMake}
                placeholder={t('truck.makePlaceholder')}
                autoCapitalize="words"
                returnKeyType="next"
                onSubmitEditing={() => modelRef.current?.focus()}
              />
              <Input
                ref={modelRef}
                label={t('truck.modelLabel')}
                value={truckModel}
                onChangeText={setTruckModel}
                placeholder={t('truck.modelPlaceholder')}
                autoCapitalize="characters"
                returnKeyType="next"
                onSubmitEditing={() => yearRef.current?.focus()}
              />
              <Input
                ref={yearRef}
                label={t('truck.yearLabel')}
                value={truckYearStr}
                onChangeText={setTruckYearStr}
                placeholder={t('truck.yearPlaceholder')}
                keyboardType="number-pad"
                maxLength={4}
                returnKeyType="next"
                onSubmitEditing={() => plateRef.current?.focus()}
              />
              <Input
                ref={plateRef}
                label={t('truck.plateLabel')}
                value={plateNumber}
                onChangeText={setPlateNumber}
                placeholder={t('truck.platePlaceholder')}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                returnKeyType="next"
                onSubmitEditing={() => chassisRef.current?.focus()}
              />
              {/* 7 aug (decizie user): seria de șasiu e atribut al CAMIONULUI — stă cu
                  restul detaliilor lui, opțională ca ele (nu mai e câmp obligatoriu de
                  anunț). Se precompletează din camionul ales și rămâne salvată PE anunț,
                  ca mecanicii s-o vadă la detalii fără acces la garajul șoferului. */}
              <Input
                ref={chassisRef}
                label={t('truck.chassisLabel')}
                value={chassisNumber}
                onChangeText={setChassisNumber}
                placeholder={t('truck.chassisPlaceholder')}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
                returnKeyType="done"
                // „done" doar închide tastatura: publicarea (push la mecanici) rămâne pe buton (review 7.7)
              />
            </View>
          ) : null}

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <Button title={t('driver.announcements.submitButton')} onPress={() => void guard(handleSubmit)} loading={loading} />

          <ThemedText themeColor="textSecondary" type="small" style={styles.requiredNote}>
            {t('common.requiredNote')}
          </ThemedText>

          {/* Expirare automată (23 aug): anunțurile deschise se anulează singure la
              30h (era 72h până pe 4 sept 2026), iar pozele se șterg — userul află DE LA
              POSTARE, nu cu surpriză. Pragul real e HOURS din EF cleanup-announcements. */}
          <ThemedText themeColor="textSecondary" type="small" style={styles.requiredNote}>
            {t('driver.announcements.autoExpireNote')}
          </ThemedText>
        </ScrollView>
      </KeyboardAvoidingView>

      <TruckPickerSheet
        visible={showPicker}
        trucks={trucks}
        driverId={session?.user.id ?? ''}
        onSelect={handlePickerSelect}
        onRefresh={refreshTrucks}
        onClose={() => setShowPicker(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  form: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  textarea: {
    height: 120,
    textAlignVertical: 'top',
    paddingTop: Spacing.two,
  },
  selectSavedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.one,
  },
  selectSavedText: { fontSize: 14, fontWeight: '500' },
  coordsSection: { gap: Spacing.two },
  photosSection: { gap: Spacing.two },
  // Stil comun butoanelor secundare din formular (GPS + detalii camion).
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1.5,
    // borderColor vine inline din theme.brand.
  },
  outlineButtonText: { fontSize: 14, fontWeight: '600' },
  coordsRow: { flexDirection: 'row', gap: Spacing.two },
  coordsField: { flex: 1 },
  pressed: { opacity: 0.7 },
  truckSection: {
    gap: Spacing.three,
  },
  error: { color: '#ef4444', fontSize: 14 },
  requiredNote: { textAlign: 'center' },
});
