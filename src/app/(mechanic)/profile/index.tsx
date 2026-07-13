import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AvatarPicker } from '@/components/avatar-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';

export default function MechanicProfileScreen() {
  const { profile, signOut, updateProfile } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();

  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [specialization, setSpecialization] = useState(profile?.specialization ?? '');
  const [activityZone, setActivityZone] = useState(profile?.activity_zone ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  function handleEdit() {
    setFullName(profile?.full_name ?? '');
    setSpecialization(profile?.specialization ?? '');
    setActivityZone(profile?.activity_zone ?? '');
    setPhone(profile?.phone ?? '');
    setError('');
    setSuccessMsg('');
    setIsEditing(true);
  }

  function handleCancel() {
    setIsEditing(false);
    setError('');
  }

  async function handleSave() {
    if (!fullName.trim()) {
      setError(t('profile.errorNameRequired'));
      return;
    }
    setSaving(true);
    setError('');
    setSuccessMsg('');
    const err = await updateProfile({
      full_name: fullName.trim(),
      specialization: specialization.trim() || null,
      activity_zone: activityZone.trim() || null,
      phone: phone.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError(t('profile.errorSave'));
      return;
    }
    setSuccessMsg(t('profile.savedSuccess'));
    setIsEditing(false);
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={isEditing ? t('profile.editTitle') : t('profile.myProfileTitle')}
        right={
          <Pressable onPress={isEditing ? handleCancel : handleEdit} hitSlop={12}>
            <MaterialIcons
              name={isEditing ? 'close' : 'edit'}
              size={22}
              color={theme.onHeader}
            />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          <View style={styles.avatarRow}>
            <AvatarPicker />
          </View>

          {/* Câmpuri editabile */}
          {isEditing ? (
            <>
              <Input
                label={t('profile.nameLabel')}
                value={fullName}
                onChangeText={setFullName}
                placeholder={t('profile.namePlaceholder')}
                autoCapitalize="words"
              />
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
              <View>
                <Input
                  label={t('profile.phoneLabel')}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder={t('profile.phonePlaceholder')}
                  keyboardType="phone-pad"
                />
                <ThemedText themeColor="textSecondary" type="small" style={styles.phoneHint}>
                  {t('profile.phoneHint')}
                </ThemedText>
              </View>

              {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

              <Button title={t('profile.saveButton')} onPress={handleSave} loading={saving} />
            </>
          ) : (
            <>
              <ThemedView type="backgroundElement" style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="person" size={16} color="#22c55e" />
                  <ThemedText type="smallBold">{t('profile.nameLabel')}</ThemedText>
                </View>
                <ThemedText>{profile?.full_name}</ThemedText>
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="build" size={16} color="#22c55e" />
                  <ThemedText type="smallBold">{t('profile.specializationLabel')}</ThemedText>
                </View>
                <ThemedText themeColor={profile?.specialization ? undefined : 'textSecondary'}>
                  {profile?.specialization || t('profile.emptyField')}
                </ThemedText>
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="place" size={16} color="#22c55e" />
                  <ThemedText type="smallBold">{t('profile.activityZoneLabel')}</ThemedText>
                </View>
                <ThemedText themeColor={profile?.activity_zone ? undefined : 'textSecondary'}>
                  {profile?.activity_zone || t('profile.emptyField')}
                </ThemedText>
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="phone" size={16} color="#22c55e" />
                  <ThemedText type="smallBold">{t('profile.phoneLabel')}</ThemedText>
                </View>
                <ThemedText themeColor={profile?.phone ? undefined : 'textSecondary'}>
                  {profile?.phone || t('profile.emptyField')}
                </ThemedText>
                <ThemedText themeColor="textSecondary" type="small">
                  {t('profile.phoneHint')}
                </ThemedText>
              </ThemedView>

              {successMsg ? (
                <ThemedText style={styles.success}>{successMsg}</ThemedText>
              ) : null}

              <Pressable onPress={signOut} style={styles.signOutRow} hitSlop={8}>
                <MaterialIcons name="logout" size={18} color="#ef4444" />
                <ThemedText style={styles.signOutText}>{t('common.signOut')}</ThemedText>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  avatarRow: { alignItems: 'center' },
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
  textarea: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: Spacing.two,
  },
  phoneHint: {
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.one,
  },
  error: { color: '#ef4444', fontSize: 14 },
  success: { color: '#22c55e', fontSize: 14, textAlign: 'center' },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    alignSelf: 'center',
    marginTop: Spacing.two,
    padding: Spacing.two,
  },
  signOutText: { color: '#ef4444', fontSize: 15 },
});
