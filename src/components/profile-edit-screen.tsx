import { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { isValidPhone, isValidVat, normalizePhone, normalizeVat } from '@/lib/profile-validation';

/**
 * Editarea profilului, ecran propriu (PLAN_FAZA10.md §4) — înlocuiește modul
 * `isEditing` inline de dinainte. Câmpurile profesionale apar doar la mecanic.
 * Ieșirea cu modificări nesalvate cere confirmare (ca la formularul de anunț, Faza 8).
 */
export function ProfileEditScreen({ backPath }: { backPath: string }) {
  const { profile, updateProfile } = useAuth();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const goBack = useBack(backPath);

  const isMechanic = profile?.role === 'mechanic';

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [companyName, setCompanyName] = useState(profile?.company_name ?? '');
  const [contactEmail, setContactEmail] = useState(profile?.contact_email ?? '');
  const [address, setAddress] = useState(profile?.address ?? '');
  const [vatNumber, setVatNumber] = useState(profile?.vat_number ?? '');
  const [specialization, setSpecialization] = useState(profile?.specialization ?? '');
  const [activityZone, setActivityZone] = useState(profile?.activity_zone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // După salvare lăsăm navigarea să treacă fără să mai întrebăm.
  const savedRef = useRef(false);

  const isDirty =
    fullName !== (profile?.full_name ?? '') ||
    phone !== (profile?.phone ?? '') ||
    companyName !== (profile?.company_name ?? '') ||
    contactEmail !== (profile?.contact_email ?? '') ||
    address !== (profile?.address ?? '') ||
    vatNumber !== (profile?.vat_number ?? '') ||
    (isMechanic &&
      (specialization !== (profile?.specialization ?? '') ||
        activityZone !== (profile?.activity_zone ?? '')));

  usePreventRemove(isDirty, ({ data }) => {
    if (savedRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    Alert.alert(t('profile.discardTitle'), t('profile.discardMessage'), [
      { text: t('profile.discardCancel'), style: 'cancel' },
      {
        text: t('profile.discardOk'),
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  async function handleSave() {
    if (!fullName.trim()) {
      setError(t('profile.errorNameRequired'));
      return;
    }
    // Faza 18: telefonul e OBLIGATORIU la ambele roluri (aplicație de urgență —
    // contactul telefonic e funcția centrală). Obligativitatea se impune AICI,
    // aplicativ: conturile vechi cu telefon gol sunt forțate abia la prima editare.
    if (!phone.trim()) {
      setError(t('profile.errorPhoneRequired'));
      return;
    }
    if (!isValidPhone(phone)) {
      setError(t('profile.errorPhoneInvalid'));
      return;
    }
    // Adresă + TVA: obligatorii la mecanici (prestatori, afișate public),
    // opționale la transportatori. Formatul TVA se verifică oriunde e completat.
    if (isMechanic && !address.trim()) {
      setError(t('profile.errorAddressRequired'));
      return;
    }
    const vat = normalizeVat(vatNumber);
    if (isMechanic && !vat) {
      setError(t('profile.errorVatRequired'));
      return;
    }
    if (vat && !isValidVat(vatNumber)) {
      setError(t('profile.errorVatInvalid'));
      return;
    }
    const email = contactEmail.trim();
    // Validare minimă de format: ceva@ceva.ceva, fără spații. Câmpul e opțional.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('profile.errorEmailInvalid'));
      return;
    }
    setSaving(true);
    setError('');

    const err = await updateProfile({
      full_name: fullName.trim(),
      phone: normalizePhone(phone),
      company_name: companyName.trim() || null,
      contact_email: email || null,
      address: address.trim() || null,
      vat_number: vat || null,
      ...(isMechanic
        ? {
            specialization: specialization.trim() || null,
            activity_zone: activityZone.trim() || null,
          }
        : {}),
    });

    setSaving(false);
    if (err) {
      setError(t('profile.errorSave'));
      return;
    }
    savedRef.current = true;
    goBack();
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('profile.editTitle')} onBack={goBack} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Input
            label={t('profile.nameLabel')}
            value={fullName}
            onChangeText={setFullName}
            placeholder={t('profile.namePlaceholder')}
            autoCapitalize="words"
            required
          />

          <Input
            label={t('profile.companyLabel')}
            value={companyName}
            onChangeText={setCompanyName}
            placeholder={t('profile.companyPlaceholder')}
            autoCapitalize="words"
          />

          {isMechanic ? (
            <>
              <Input
                label={t('profile.specializationLabel')}
                value={specialization}
                onChangeText={setSpecialization}
                placeholder={t('profile.specializationPlaceholder')}
                autoCapitalize="sentences"
                multiline
                numberOfLines={3}
                style={styles.textarea}
              />
              <Input
                label={t('profile.activityZoneLabel')}
                value={activityZone}
                onChangeText={setActivityZone}
                placeholder={t('profile.activityZonePlaceholder')}
                autoCapitalize="sentences"
              />
            </>
          ) : null}

          {/* Faza 18: adresă + TVA — obligatorii la mecanic (afișate public), opționale la șofer. */}
          <View>
            <Input
              label={t('profile.addressLabel')}
              value={address}
              onChangeText={setAddress}
              placeholder={t('profile.addressPlaceholder')}
              autoCapitalize="sentences"
              required={isMechanic}
            />
            {isMechanic ? (
              <ThemedText themeColor="textSecondary" type="small" style={styles.phoneHint}>
                {t('profile.addressHint')}
              </ThemedText>
            ) : null}
          </View>

          <Input
            label={t('profile.vatLabel')}
            value={vatNumber}
            onChangeText={setVatNumber}
            placeholder={t('profile.vatPlaceholder')}
            autoCapitalize="characters"
            autoCorrect={false}
            required={isMechanic}
          />

          <View>
            <Input
              label={t('profile.phoneLabel')}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('profile.phonePlaceholder')}
              keyboardType="phone-pad"
              required
            />
            <ThemedText themeColor="textSecondary" type="small" style={styles.phoneHint}>
              {isMechanic ? t('profile.phoneHint') : t('driver.profile.phoneHint')}
            </ThemedText>
          </View>

          <View>
            <Input
              label={t('profile.emailLabel')}
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder={t('profile.emailPlaceholder')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ThemedText themeColor="textSecondary" type="small" style={styles.phoneHint}>
              {t('profile.emailHint')}
            </ThemedText>
          </View>

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <Button title={t('profile.saveButton')} onPress={handleSave} loading={saving} />

          <ThemedText themeColor="textSecondary" type="small" style={styles.requiredNote}>
            {t('common.requiredNote')}
          </ThemedText>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  textarea: { height: 80, textAlignVertical: 'top', paddingTop: Spacing.two },
  phoneHint: { marginTop: Spacing.one, paddingHorizontal: Spacing.one },
  error: { color: '#ef4444', fontSize: 14 },
  requiredNote: { textAlign: 'center' },
});
