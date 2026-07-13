import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Avatar } from '@/components/avatar';
import { Radius } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';
import { pickFromCamera, pickFromLibrary, type PickedImage } from '@/lib/media';
import { deletePhotos, uploadAvatar } from '@/lib/storage';

/**
 * Avatarul PROPRIU, cu schimbare/ștergere (PLAN_FAZA10.md §2, §4).
 * Fluxul de schimbare: upload path nou → UPDATE profiles → ștergerea obiectului vechi.
 * Dacă ștergerea vechiului eșuează rămâne un fișier orfan (~40 KB) — nu blocăm userul.
 */
export function AvatarPicker({ size = 96 }: { size?: number }) {
  const { session, profile, updateProfile } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);

  const paths = useMemo(
    () => (profile?.avatar_path ? [profile.avatar_path] : []),
    [profile?.avatar_path]
  );
  const urls = useSignedUrls(paths);
  const url = profile?.avatar_path ? urls[profile.avatar_path] : undefined;

  async function upload(images: PickedImage[]) {
    const image = images[0];
    const userId = session?.user.id;
    if (!image || !userId) return;

    setBusy(true);
    const previous = profile?.avatar_path ?? null;
    const { path, error } = await uploadAvatar(userId, image);

    if (path) {
      const updateError = await updateProfile({ avatar_path: path });
      if (updateError) {
        // Profilul n-a fost actualizat → obiectul proaspăt urcat rămâne nefolosit.
        void deletePhotos([path]);
      } else if (previous) {
        void deletePhotos([previous]);
      }
      if (updateError) Alert.alert(t('profile.avatarError'));
    } else if (error) {
      Alert.alert(t('profile.avatarError'));
    }
    setBusy(false);
  }

  async function remove() {
    const previous = profile?.avatar_path;
    if (!previous) return;

    setBusy(true);
    const updateError = await updateProfile({ avatar_path: null });
    if (updateError) Alert.alert(t('profile.avatarError'));
    else void deletePhotos([previous]);
    setBusy(false);
  }

  const actions: SheetAction[] = [
    {
      label: t('photos.sourceLibrary'),
      icon: 'photo-library',
      onPress: async () => upload(await pickFromLibrary()),
    },
    {
      label: t('photos.sourceCamera'),
      icon: 'photo-camera',
      onPress: async () => upload(await pickFromCamera()),
    },
    ...(profile?.avatar_path
      ? [{ label: t('profile.avatarRemove'), icon: 'delete' as const, destructive: true, onPress: remove }]
      : []),
  ];

  return (
    <>
      <Pressable onPress={() => setSheetVisible(true)} disabled={busy}>
        <Avatar url={url} name={profile?.full_name} size={size} />

        {busy ? (
          <View style={[styles.overlay, { borderRadius: Radius.circle }]}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : (
          <View
            style={[styles.badge, { backgroundColor: theme.brand, borderColor: theme.background }]}>
            <MaterialIcons name="photo-camera" size={14} color="#FFFFFF" />
          </View>
        )}
      </Pressable>

      <ActionSheet
        visible={sheetVisible}
        title={t('profile.avatarTitle')}
        actions={actions}
        onClose={() => setSheetVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: Radius.circle,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
