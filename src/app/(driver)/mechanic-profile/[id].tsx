import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

type PublicProfile = Pick<Profile, 'full_name' | 'specialization' | 'activity_zone'>;

async function fetchPublicProfile(mechanicId: string): Promise<PublicProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, specialization, activity_zone')
    .eq('id', mechanicId)
    .single();
  return (data as PublicProfile) ?? null;
}

async function fetchMechanicPhone(mechanicId: string): Promise<string | null> {
  const { data } = await supabase.rpc('get_mechanic_phone', {
    p_mechanic_id: mechanicId,
  } as never);
  return (data as string | null) ?? null;
}

export default function MechanicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const goBack = useBack();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [prof, ph] = await Promise.all([
        fetchPublicProfile(id),
        fetchMechanicPhone(id),
      ]);
      setProfile(prof);
      setPhone(ph);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color="#208AEF" />
      </ThemedView>
    );
  }

  if (!profile) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="textSecondary">{t('driver.mechanicProfile.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>
          {t('driver.mechanicProfile.title')}
        </ThemedText>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="person" size={16} color="#208AEF" />
            <ThemedText type="smallBold">{t('profile.nameLabel')}</ThemedText>
          </View>
          <ThemedText>{profile.full_name}</ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="build" size={16} color="#208AEF" />
            <ThemedText type="smallBold">{t('profile.specializationLabel')}</ThemedText>
          </View>
          <ThemedText themeColor={profile.specialization ? undefined : 'textSecondary'}>
            {profile.specialization || t('profile.emptyField')}
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="place" size={16} color="#208AEF" />
            <ThemedText type="smallBold">{t('profile.activityZoneLabel')}</ThemedText>
          </View>
          <ThemedText themeColor={profile.activity_zone ? undefined : 'textSecondary'}>
            {profile.activity_zone || t('profile.emptyField')}
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="phone" size={16} color="#208AEF" />
            <ThemedText type="smallBold">{t('profile.phoneLabel')}</ThemedText>
          </View>
          {phone ? (
            <ThemedText>{phone}</ThemedText>
          ) : (
            <>
              <ThemedText themeColor="textSecondary">{t('profile.emptyField')}</ThemedText>
              <ThemedText themeColor="textSecondary" type="small">
                {t('driver.mechanicProfile.phoneHint')}
              </ThemedText>
            </>
          )}
        </ThemedView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  title: { fontSize: 22, lineHeight: 30 },
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
});
