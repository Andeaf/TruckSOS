import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TruckFormSheet } from '@/components/truck-form-sheet';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useSavedTrucks, addTruck, updateTruck, deleteTruck } from '@/hooks/use-trucks';
import type { Truck } from '@/types/database';

export default function DriverProfileScreen() {
  const { profile, signOut, updateProfile } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { trucks, refresh } = useSavedTrucks();

  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [showTruckForm, setShowTruckForm] = useState(false);
  const [editingTruck, setEditingTruck] = useState<Pick<Truck, 'id' | 'make' | 'model' | 'year' | 'nickname'> | null>(null);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  function handleEdit() {
    setFullName(profile?.full_name ?? '');
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

  function handleAddTruck() {
    setEditingTruck(null);
    setShowTruckForm(true);
  }

  function handleEditTruck(truck: Truck) {
    setEditingTruck({ id: truck.id, make: truck.make, model: truck.model, year: truck.year, nickname: truck.nickname });
    setShowTruckForm(true);
  }

  function handleDeleteTruck(id: string) {
    Alert.alert(
      t('truck.deleteConfirmTitle'),
      t('truck.deleteConfirmMessage'),
      [
        { text: t('truck.deleteConfirmCancel'), style: 'cancel' },
        {
          text: t('truck.deleteConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            const err = await deleteTruck(id);
            if (!err) refresh();
          },
        },
      ]
    );
  }

  async function handleSaveTruck(data: { make: string; model: string; year: number; nickname: string | null }) {
    const err = editingTruck
      ? await updateTruck(editingTruck.id, data)
      : await addTruck({ ...data, driver_id: profile!.id });
    if (!err) {
      setShowTruckForm(false);
      refresh();
    }
  }

  function truckLabel(truck: Truck) {
    const base = `${truck.make} ${truck.model} ${truck.year}`;
    return truck.nickname ? `${truck.nickname} — ${base}` : base;
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText type="subtitle">
          {isEditing ? t('profile.editTitle') : t('profile.myProfileTitle')}
        </ThemedText>
        {!isEditing ? (
          <Pressable onPress={handleEdit} hitSlop={12}>
            <MaterialIcons name="edit" size={22} color={theme.textSecondary} />
          </Pressable>
        ) : (
          <Pressable onPress={handleCancel} hitSlop={12}>
            <MaterialIcons name="close" size={22} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {isEditing ? (
            <>
              <Input
                label={t('profile.nameLabel')}
                value={fullName}
                onChangeText={setFullName}
                placeholder={t('profile.namePlaceholder')}
                autoCapitalize="words"
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
                  {t('driver.profile.phoneHint')}
                </ThemedText>
              </View>

              {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

              <Button title={t('profile.saveButton')} onPress={handleSave} loading={saving} />
            </>
          ) : (
            <>
              <ThemedView type="backgroundElement" style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="person" size={16} color="#208AEF" />
                  <ThemedText type="smallBold">{t('profile.nameLabel')}</ThemedText>
                </View>
                <ThemedText>{profile?.full_name}</ThemedText>
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="phone" size={16} color="#208AEF" />
                  <ThemedText type="smallBold">{t('profile.phoneLabel')}</ThemedText>
                </View>
                <ThemedText themeColor={profile?.phone ? undefined : 'textSecondary'}>
                  {profile?.phone || t('profile.emptyField')}
                </ThemedText>
                <ThemedText themeColor="textSecondary" type="small">
                  {t('driver.profile.phoneHint')}
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

          {/* Camioane salvate — vizibil în ambele moduri */}
          <View style={styles.trucksSectionWrapper}>
            <View style={styles.trucksSectionHeader}>
              <ThemedText type="smallBold">{t('truck.savedTitle')}</ThemedText>
              <Pressable onPress={handleAddTruck} hitSlop={12}>
                <MaterialIcons name="add" size={24} color="#208AEF" />
              </Pressable>
            </View>

            {trucks.length === 0 ? (
              <ThemedText themeColor="textSecondary" type="small">
                {t('truck.emptyTrucks')}
              </ThemedText>
            ) : (
              trucks.map((truck) => (
                <ThemedView key={truck.id} type="backgroundElement" style={styles.truckCard}>
                  <ThemedText style={styles.truckLabel}>{truckLabel(truck)}</ThemedText>
                  <View style={styles.truckActions}>
                    <Pressable onPress={() => handleEditTruck(truck)} hitSlop={10}>
                      <MaterialIcons name="edit" size={18} color={theme.textSecondary} />
                    </Pressable>
                    <Pressable onPress={() => handleDeleteTruck(truck.id)} hitSlop={10}>
                      <MaterialIcons name="delete" size={18} color={theme.textSecondary} />
                    </Pressable>
                  </View>
                </ThemedView>
              ))
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      <TruckFormSheet
        visible={showTruckForm}
        initialData={editingTruck ?? undefined}
        onSave={handleSaveTruck}
        onClose={() => setShowTruckForm(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  section: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
  trucksSectionWrapper: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  trucksSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  truckCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  truckLabel: { flex: 1, fontSize: 14 },
  truckActions: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginLeft: Spacing.two,
  },
});
