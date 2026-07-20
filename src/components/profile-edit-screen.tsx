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
      phone: phone.trim() || null,
      company_name: companyName.trim() || null,
      contact_email: email || null,
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

          <View>
            <Input
              label={t('profile.phoneLabelOptional')}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('profile.phonePlaceholder')}
              keyboardType="phone-pad"
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
});
