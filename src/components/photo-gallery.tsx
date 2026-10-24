import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { PhotoViewer, type ViewerPhoto } from '@/components/photo-viewer';
import { RemoteImage } from '@/components/remote-image';
import { Radius, Spacing } from '@/constants/theme';

/**
 * Rând read-only de thumbnail-uri pentru pozele unui anunț (PLAN_FAZA9.md §8, R9).
 * Tap pe o poză → `PhotoViewer` full-screen, deschis pe poza atinsă.
 * Extras din ecranul de detaliu ca să nu-l mai umflăm (deja mare).
 */

interface PhotoGalleryProps {
  photos: ViewerPhoto[];
}

const THUMB = 88;

export function PhotoGallery({ photos }: PhotoGalleryProps) {
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (photos.length === 0) return null;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}>
        {photos.map((photo, index) => (
          <Pressable
            key={photo.id}
            onPress={() => setOpenAt(index)}
            style={({ pressed }) => pressed && styles.pressed}>
            <RemoteImage
              uri={photo.url}
              style={styles.thumb}
              contentFit="cover"
              transition={150}
            />
          </Pressable>
        ))}
      </ScrollView>

      {openAt !== null ? (
        <PhotoViewer
          visible
          photos={photos}
          initialIndex={openAt}
          onClose={() => setOpenAt(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.card,
    backgroundColor: '#00000010',
  },
  pressed: { opacity: 0.7 },
});
