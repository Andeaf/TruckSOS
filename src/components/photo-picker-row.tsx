import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pickFromCamera, pickFromLibrary, type PickedImage } from '@/lib/media';

/**
 * Rând de thumbnail-uri pentru poze selectate local, cu „+" (galerie SAU cameră,
 * la alegerea userului) și „x" de eliminare per poză (PLAN_FAZA9.md §8).
 * Componentă controlată, reutilizabilă în formularul de anunț (9.1) și chat (9.2).
 * Nu urcă nimic — doar gestionează selecția locală; upload-ul se face de caller.
 */

interface PhotoPickerRowProps {
  photos: PickedImage[];
  onAdd: (images: PickedImage[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

const THUMB = 76;

export function PhotoPickerRow({ photos, onAdd, onRemove, disabled }: PhotoPickerRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  function handleAddPress() {
    if (disabled) return;
    Alert.alert(t('photos.sourceTitle'), undefined, [
      {
        text: t('photos.sourceLibrary'),
        onPress: async () => {
          const imgs = await pickFromLibrary();
          if (imgs.length > 0) onAdd(imgs);
        },
      },
      {
        text: t('photos.sourceCamera'),
        onPress: async () => {
          const imgs = await pickFromCamera();
          if (imgs.length > 0) onAdd(imgs);
        },
      },
      { text: t('photos.cancel'), style: 'cancel' },
    ]);
  }

  return (
    <View style={styles.row}>
      {photos.map((photo, index) => (
        <View key={`${photo.uri}-${index}`} style={styles.thumbWrap}>
          <Image
            source={{ uri: photo.uri }}
            style={styles.thumb}
            contentFit="cover"
            transition={100}
          />
          <Pressable
            onPress={() => onRemove(index)}
            style={styles.removeBtn}
            hitSlop={8}
            accessibilityLabel={t('photos.remove')}>
            <MaterialIcons name="close" size={14} color="#fff" />
          </Pressable>
        </View>
      ))}

      <Pressable
        onPress={handleAddPress}
        disabled={disabled}
        style={[styles.addTile, { borderColor: theme.textSecondary, opacity: disabled ? 0.5 : 1 }]}
        hitSlop={4}>
        <MaterialIcons name="add-a-photo" size={22} color={theme.textSecondary} />
        <ThemedText themeColor="textSecondary" type="small" style={styles.addText}>
          {t('photos.add')}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  thumbWrap: {
    width: THUMB,
    height: THUMB,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.card,
    backgroundColor: '#00000010',
  },
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
  addText: {
    fontSize: 11,
    textAlign: 'center',
  },
});
