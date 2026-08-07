import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AvatarPicker } from '@/components/avatar-picker';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TruckFormSheet } from '@/components/truck-form-sheet';
import { ListRow, RowGroup, SectionLabel } from '@/components/ui/list-row';
import { Radius, Spacing } from '@/constants/theme';
import { useBack } from '@/hooks/use-back';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useSettings } from '@/hooks/use-settings';
import { useSavedTrucks, addTruck, updateTruck, deleteTruck } from '@/hooks/use-trucks';
import type { Truck } from '@/types/database';

/**
 * Profilul șoferului (PLAN_FAZA10.md §4): read-only + navigație.
 * Editarea câmpurilor s-a mutat în `profile/edit` (deschis din Setări).
 */
export default function DriverProfileScreen() {
  const { session, profile, signOut } = useAuth();
  const { setAdminViewAs } = useSettings();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  // Faza 19: profilul nu mai e tab — se deschide push-uit din butonul-avatar al antetului.
  const goBack = useBack('/(driver)/announcements');
  const { trucks, refresh } = useSavedTrucks();

  const [showTruckForm, setShowTruckForm] = useState(false);
  const [editingTruck, setEditingTruck] = useState<Pick<
    Truck,
    'id' | 'make' | 'model' | 'year' | 'nickname' | 'plate_number' | 'chassis_number'
  > | null>(null);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  function handleAddTruck() {
    setEditingTruck(null);
    setShowTruckForm(true);
  }

  function handleEditTruck(truck: Truck) {
    setEditingTruck({
      id: truck.id,
      make: truck.make,
      model: truck.model,
      year: truck.year,
      nickname: truck.nickname,
      plate_number: truck.plate_number,
      chassis_number: truck.chassis_number,
    });
    setShowTruckForm(true);
  }

  function handleDeleteTruck(id: string) {
    Alert.alert(t('truck.deleteConfirmTitle'), t('truck.deleteConfirmMessage'), [
      { text: t('truck.deleteConfirmCancel'), style: 'cancel' },
      {
        text: t('truck.deleteConfirmOk'),
        style: 'destructive',
        onPress: async () => {
          const err = await deleteTruck(id);
          if (!err) refresh();
        },
      },
    ]);
  }

  async function handleSaveTruck(data: {
    make: string;
    model: string;
    year: number;
    nickname: string | null;
    plate_number: string | null;
    chassis_number: string | null;
  }) {
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
      <ScreenHeader title={t('profile.myProfileTitle')} onBack={goBack} />

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView type="backgroundElement" style={styles.identityCard}>
          <AvatarPicker size={64} />
          <View style={styles.identityText}>
            <ThemedText themeColor="textSecondary" type="small">
              {t('profile.connectedAs')}
            </ThemedText>
            <ThemedText type="smallBold" numberOfLines={1}>
              {profile?.full_name}
            </ThemedText>
            <ThemedText themeColor="textSecondary" type="small" numberOfLines={1}>
              {session?.user.email}
            </ThemedText>
          </View>
        </ThemedView>

        <SectionLabel>{t('profile.sectionDetails')}</SectionLabel>
        <RowGroup>
          <ListRow
            icon="history"
            label={t('driver.history.title')}
            onPress={() => router.push('/(driver)/history' as never)}
          />
        </RowGroup>

        <ThemedView type="backgroundElement" style={styles.trucksCard}>
          <View style={styles.trucksHeader}>
            <ThemedText type="smallBold">{t('truck.savedTitle')}</ThemedText>
            <Pressable onPress={handleAddTruck} hitSlop={12}>
              <MaterialIcons name="add" size={24} color={theme.brand} />
            </Pressable>
          </View>

          {trucks.length === 0 ? (
            <ThemedText themeColor="textSecondary" type="small">
              {t('truck.emptyTrucks')}
            </ThemedText>
          ) : (
            trucks.map((truck) => (
              <View key={truck.id} style={styles.truckRow}>
                <View style={styles.truckInfo}>
                  <ThemedText style={styles.truckLabel}>{truckLabel(truck)}</ThemedText>
                  {truck.plate_number ? (
                    <ThemedText themeColor="textSecondary" type="small">
                      {t('truck.plateLabel')}: {truck.plate_number}
                    </ThemedText>
                  ) : null}
                  {truck.chassis_number ? (
                    <ThemedText themeColor="textSecondary" type="small">
                      {t('truck.chassisLabel')}: {truck.chassis_number}
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
              </View>
            ))
          )}
        </ThemedView>

        <SectionLabel>{t('profile.sectionAccount')}</SectionLabel>
        <RowGroup>
          <ListRow
            icon="settings"
            label={t('settings.title')}
            onPress={() => router.push('/(driver)/profile/settings' as never)}
          />
          <ListRow
            icon="description"
            label={t('profile.terms')}
            onPress={() => router.push('/(driver)/profile/terms' as never)}
          />
          <ListRow
            icon="shield"
            label={t('profile.privacy')}
            onPress={() => router.push('/(driver)/profile/privacy' as never)}
          />
        </RowGroup>

        {profile?.role === 'admin' ? (
          <View style={styles.signOut}>
            <RowGroup>
              <ListRow
                icon="admin-panel-settings"
                label={t('admin.backToAdmin')}
                onPress={() => {
                  setAdminViewAs('admin');
                  router.replace('/(admin)/dashboard');
                }}
              />
            </RowGroup>
          </View>
        ) : null}

        <View style={styles.signOut}>
          <ListRow icon="logout" label={t('common.signOut')} destructive onPress={signOut} />
        </View>
      </ScrollView>

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
  content: { padding: Spacing.four, gap: Spacing.two },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  identityText: { flex: 1, gap: 2 },
  trucksCard: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  trucksHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  truckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  truckInfo: { flex: 1, gap: 2 },
  truckLabel: { fontSize: 14 },
  truckActions: { flexDirection: 'row', gap: Spacing.three, marginLeft: Spacing.two },
  signOut: { marginTop: Spacing.three },
});
