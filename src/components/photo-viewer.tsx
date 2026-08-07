import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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
 * Zoom (cerere 7 aug): pinch cu punct focal + pan cu limite + dublu-tap, pe
 * gesture-handler/reanimated (deja în proiect, merg în Expo Go pe iOS și Android).
 * Cât timp poza e zoomată, paginarea listei se oprește (`scrollEnabled`) — pan-ul
 * mută poza, nu slide-ul; la revenirea la 1x paginarea reînvie. La schimbarea
 * slide-ului, pozele neactive se resetează la 1x.
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

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

function clampWorklet(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

interface ZoomablePhotoProps {
  url: string;
  width: number;
  height: number;
  /** Poza curent afișată — cele neactive își resetează zoom-ul. */
  isActive: boolean;
  /** Anunță părintele că poza e zoomată → oprește paginarea FlatList-ului. */
  onZoomChange: (zoomed: boolean) => void;
}

function ZoomablePhoto({ url, width, height, isActive, onZoomChange }: ZoomablePhotoProps) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startTX = useSharedValue(0);
  const startTY = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);
  // Stare React (nu shared value): pan-ul se (de)activează prin re-render al gestului.
  const [zoomed, setZoomed] = useState(false);

  const setZoomedBoth = useCallback(
    (z: boolean) => {
      setZoomed(z);
      onZoomChange(z);
    },
    [onZoomChange]
  );

  useEffect(() => {
    // Slide părăsit → reset la 1x. Nu chemăm onZoomChange: flag-ul părintelui
    // privește poza ACTIVĂ (care își gestionează singură starea).
    if (isActive) return;
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
    setZoomed(false);
  }, [isActive, scale, tx, ty]);

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      startScale.value = scale.value;
      startTX.value = tx.value;
      startTY.value = ty.value;
      startFocalX.value = e.focalX;
      startFocalY.value = e.focalY;
      // Blochează paginarea IMEDIAT (nu la primul update): altfel, pe Android,
      // FlatList-ul poate „fura" mișcarea orizontală a degetelor în timpul pinch-ului.
      runOnJS(setZoomedBoth)(true);
    })
    .onUpdate((e) => {
      const s = clampWorklet(startScale.value * e.scale, 1, MAX_SCALE);
      const ratio = s / startScale.value;
      scale.value = s;
      // Punctul de sub degete rămâne pe loc: translate-ul compensează scalarea
      // (transformarea e translate→scale, cu scalarea în jurul centrului).
      tx.value = e.focalX - width / 2 - (startFocalX.value - width / 2 - startTX.value) * ratio;
      ty.value = e.focalY - height / 2 - (startFocalY.value - height / 2 - startTY.value) * ratio;
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        scale.value = withTiming(1, { duration: 150 });
        tx.value = withTiming(0, { duration: 150 });
        ty.value = withTiming(0, { duration: 150 });
        runOnJS(setZoomedBoth)(false);
      } else {
        // Readu poza în limite (marginile nu pot intra în interiorul ecranului).
        const maxTX = (width * (scale.value - 1)) / 2;
        const maxTY = (height * (scale.value - 1)) / 2;
        tx.value = withTiming(clampWorklet(tx.value, -maxTX, maxTX), { duration: 150 });
        ty.value = withTiming(clampWorklet(ty.value, -maxTY, maxTY), { duration: 150 });
        runOnJS(setZoomedBoth)(true);
      }
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onStart(() => {
      startTX.value = tx.value;
      startTY.value = ty.value;
    })
    .onUpdate((e) => {
      const maxTX = (width * (scale.value - 1)) / 2;
      const maxTY = (height * (scale.value - 1)) / 2;
      tx.value = clampWorklet(startTX.value + e.translationX, -maxTX, maxTX);
      ty.value = clampWorklet(startTY.value + e.translationY, -maxTY, maxTY);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(250)
    .onEnd((e) => {
      if (scale.value > 1) {
        scale.value = withTiming(1, { duration: 180 });
        tx.value = withTiming(0, { duration: 180 });
        ty.value = withTiming(0, { duration: 180 });
        runOnJS(setZoomedBoth)(false);
      } else {
        // Zoom pe punctul atins: t = (centru − tap) · (s − 1), limitat la margini.
        const s = DOUBLE_TAP_SCALE;
        const maxTX = (width * (s - 1)) / 2;
        const maxTY = (height * (s - 1)) / 2;
        scale.value = withTiming(s, { duration: 180 });
        tx.value = withTiming(clampWorklet((width / 2 - e.x) * (s - 1), -maxTX, maxTX), {
          duration: 180,
        });
        ty.value = withTiming(clampWorklet((height / 2 - e.y) * (s - 1), -maxTY, maxTY), {
          duration: 180,
        });
        runOnJS(setZoomedBoth)(true);
      }
    });

  // Race: dublu-tap-ul nu așteaptă după pan (pan-ul cere mișcare, tap-urile nu au),
  // iar pinch+pan rulează simultan pentru zoom-and-drag natural.
  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width, height }, animatedStyle]}>
        <Image source={{ uri: url }} style={styles.zoomImage} contentFit="contain" transition={150} />
      </Animated.View>
    </GestureDetector>
  );
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
  // Poza activă e zoomată → paginarea se oprește (pan-ul aparține pozei).
  const [zoomed, setZoomed] = useState(false);

  const current = photos[index];

  async function handleDownload() {
    if (!current || downloading) return;
    setDownloading(true);
    const result = await downloadToGallery(current.url);
    setDownloading(false);
    if (result === 'saved') {
      Alert.alert(t('photos.downloadOk'));
    } else if (result === 'permission-denied') {
      // Mesaj distinct de eroarea de rețea: userul poate repara singur, din setările OS.
      Alert.alert(t('photos.downloadDeniedTitle'), t('photos.downloadDeniedBody'), [
        { text: t('photos.cancel'), style: 'cancel' },
        { text: t('photos.openSettings'), onPress: () => Linking.openSettings() },
      ]);
    } else {
      Alert.alert(t('photos.downloadFailed'));
    }
  }

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      {/* GestureHandlerRootView propriu: Modal-ul RN e o fereastră nativă separată —
          fără root-ul ăsta, gesturile RNGH (pinch/pan/tap) nu pornesc pe Android. */}
      <GestureHandlerRootView style={styles.container}>
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
          }
          renderItem={({ item }) => (
            <ZoomablePhoto
              url={item.url}
              width={width}
              height={height}
              isActive={item.id === current?.id}
              onZoomChange={setZoomed}
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
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  zoomImage: { width: '100%', height: '100%' },
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
