import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TruckFormSheet } from '@/components/truck-form-sheet';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useSavedTrucks, addTruck, updateTruck, deleteTruck } from '@/hooks/use-trucks';
import type { Truck } from '@/types/database';

export default function DriverProfileScreen() {
  const { profile, signOut, updateProfile } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { trucks, refresh } = useSavedTrucks();

  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [showTruckForm, setShowTruckForm] = useState(false);
  const [editingTruck, setEditingTruck] = useState<Pick<Truck, 'id' | 'make' | 'model' | 'year' | 'nickname' | 'plate_number'> | null>(null);

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
    setEditingTruck({ id: truck.id, make: truck.make, model: truck.model, year: truck.year, nickname: truck.nickname, plate_number: truck.plate_number });
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

  async function handleSaveTruck(data: { make: string; model: string; year: number; nickname: string | null; plate_number: string | null }) {
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

              <Pressable
                onPress={() => router.push('/(driver)/history' as never)}
                style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}>
                <MaterialIcons name="history" size={18} color="#208AEF" />
                <ThemedText style={styles.historyText}>{t('driver.history.title')}</ThemedText>
                <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
              </Pressable>

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
                  <View style={styles.truckInfo}>
                    <ThemedText style={styles.truckLabel}>{truckLabel(truck)}</ThemedText>
                    {truck.plate_number ? (
                      <ThemedText themeColor="textSecondary" type="small">
                        {t('truck.plateLabel')}: {truck.plate_number}
                      </ThemedText>
                    ) : null}
                  </View>
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
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
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
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: '#208AEF',
  },
  historyText: { flex: 1, color: '#208AEF', fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
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
    borderRadius: Radius.card,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  truckInfo: { flex: 1, gap: 2 },
  truckLabel: { fontSize: 14 },
  truckActions: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginLeft: Spacing.two,
  },
});
