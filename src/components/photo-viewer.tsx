import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { downloadToGallery } from '@/lib/media';

/**
 * Vizualizator full-screen pentru poze remote (PLAN_FAZA9.md §8).
 * Fără pachet extern: `Modal` + `FlatList` cu paginare orizontală + `expo-image`.
 * Fundal negru, indiferent de temă — e un lightbox, nu o suprafață a app-ului.
 *
 * `showDownload` e folosit din chat (Etapa 9.2.3); în detaliul anunțului lipsește.
 */

export interface ViewerPhoto {
  id: string;
  url: string;
}

interface PhotoViewerProps {
  visible: boolean;
  photos: ViewerPhoto[];
  initialIndex?: number;
  showDownload?: boolean;
  onClose: () => void;
}

export function PhotoViewer({
  visible,
  photos,
  initialIndex = 0,
  showDownload = false,
  onClose,
}: PhotoViewerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const [downloading, setDownloading] = useState(false);

  const current = photos[index];

  async function handleDownload() {
    if (!current || downloading) return;
    setDownloading(true);
    const ok = await downloadToGallery(current.url);
    setDownloading(false);
    Alert.alert(t(ok ? 'photos.downloadOk' : 'photos.downloadFailed'));
  }

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.container}>
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
          }
          renderItem={({ item }) => (
            <Image
              source={{ uri: item.url }}
              style={{ width, height }}
              contentFit="contain"
              transition={150}
            />
          )}
        />

        <Pressable
          onPress={onClose}
          style={[styles.iconButton, styles.closeButton, { top: insets.top + Spacing.two }]}
          hitSlop={12}
          accessibilityLabel={t('photos.close')}>
          <MaterialIcons name="close" size={24} color="#fff" />
        </Pressable>

        {showDownload ? (
          <Pressable
            onPress={handleDownload}
            disabled={downloading}
            style={[styles.iconButton, styles.downloadButton, { top: insets.top + Spacing.two }]}
            hitSlop={12}
            accessibilityLabel={t('photos.download')}>
            {downloading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="file-download" size={24} color="#fff" />
            )}
          </Pressable>
        ) : null}

        {photos.length > 1 ? (
          <View style={[styles.counter, { bottom: insets.bottom + Spacing.four }]}>
            <ThemedText style={styles.counterText}>
              {t('photos.counter', { current: index + 1, total: photos.length })}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  iconButton: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: Radius.circle,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: { left: Spacing.four },
  downloadButton: { right: Spacing.four },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.control,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  counterText: { color: '#fff', fontSize: 14 },
});
