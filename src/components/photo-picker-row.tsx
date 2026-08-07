import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ActionSheet } from '@/components/action-sheet';
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
  /** Numărul maxim de poze (Faza 14.8). Butonul „+" se blochează la atingere. */
  max?: number;
}

const THUMB = 76;
const DEFAULT_MAX = 10;

export function PhotoPickerRow({ photos, onAdd, onRemove, disabled, max = DEFAULT_MAX }: PhotoPickerRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const atLimit = photos.length >= max;

  // Adaugă cel mult până la limită; dacă selecția depășește, taie surplusul și explică.
  function addClamped(imgs: PickedImage[]) {
    const remaining = max - photos.length;
    if (remaining <= 0) return;
    if (imgs.length > remaining) {
      onAdd(imgs.slice(0, remaining));
      Alert.alert(t('photos.limitReachedTitle'), t('photos.limitReached', { max }));
    } else {
      onAdd(imgs);
    }
  }

  // Sheet tematizat în locul fostului Alert.alert nativ (nestilizabil, fără
  // închidere la tap în afară).
  const [sourceOpen, setSourceOpen] = useState(false);

  function handleAddPress() {
    if (disabled || atLimit) return;
    setSourceOpen(true);
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

      {!atLimit ? (
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
      ) : (
        <View style={[styles.addTile, styles.limitTile, { borderColor: theme.textSecondary }]}>
          <ThemedText themeColor="textSecondary" type="small" style={styles.addText}>
            {t('photos.limitReached', { max })}
          </ThemedText>
        </View>
      )}

      <ActionSheet
        visible={sourceOpen}
        title={t('photos.sourceTitle')}
        actions={[
          {
            label: t('photos.sourceLibrary'),
            icon: 'photo-library',
            onPress: async () => {
              const imgs = await pickFromLibrary();
              if (imgs.length > 0) addClamped(imgs);
            },
          },
          {
            label: t('photos.sourceCamera'),
            icon: 'photo-camera',
            onPress: async () => {
              const imgs = await pickFromCamera();
              if (imgs.length > 0) addClamped(imgs);
            },
          },
        ]}
        onClose={() => setSourceOpen(false)}
      />
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
  limitTile: {
    borderStyle: 'solid',
    paddingHorizontal: Spacing.one,
  },
});
