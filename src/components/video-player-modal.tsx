import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/constants/theme';

/**
 * Player full-screen pentru videoclipurile din chat (23 aug). Aceeași filozofie
 * ca PhotoViewer: lightbox negru indiferent de temă, buton de închidere sus-stânga.
 * Redarea = `expo-video` (SDK 54, inclus în Expo Go, cu suport web) cu controalele
 * NATIVE — seek/pauză/volum vin gratis, nu reinventăm o bară de progres.
 */

interface VideoPlayerModalProps {
  /** URL-ul SEMNAT al videoclipului. */
  url: string;
  onClose: () => void;
}

export function VideoPlayerModal({ url, onClose }: VideoPlayerModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(url, (p) => {
    p.play();
  });

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.container}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls
        />
        <Pressable
          onPress={onClose}
          style={[
            styles.closeButton,
            // Pe web insets.top e 0 — o margine fixă ține butonul departe de colț.
            { top: (Platform.OS === 'web' ? Spacing.four : insets.top) + Spacing.two },
          ]}
          hitSlop={12}
          accessibilityLabel={t('photos.close')}>
          <MaterialIcons name="close" size={24} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
  closeButton: {
    position: 'absolute',
    left: Spacing.four,
    width: 40,
    height: 40,
    borderRadius: Radius.circle,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
});
