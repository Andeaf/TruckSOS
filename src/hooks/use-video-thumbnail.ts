import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';

/**
 * Thumbnail-ul unei bule-video (23 aug): generat PE DEVICE din URL-ul semnat al
 * videoclipului (expo-video-thumbnails citește remote prin range requests — nu
 * descarcă tot fișierul). Decizie asumată: nu stocăm thumbnail-uri în Storage —
 * zero spațiu ocupat pe server, zero migrări; costul e o generare per device,
 * amortizată de cache-ul de mai jos (per sesiune, cheia = id-ul mesajului).
 *
 * Pe WEB modulul nu există → întoarcem null, bula arată tile-ul generic cu play.
 */
const thumbCache = new Map<string, string>();

export function useVideoThumbnail(
  messageId: string,
  videoUrl: string | undefined,
): string | null {
  const [uri, setUri] = useState<string | null>(thumbCache.get(messageId) ?? null);

  useEffect(() => {
    if (uri || !videoUrl || Platform.OS === 'web') return;
    let alive = true;
    VideoThumbnails.getThumbnailAsync(videoUrl, { time: 0, quality: 0.6 })
      .then((result) => {
        thumbCache.set(messageId, result.uri);
        if (alive) setUri(result.uri);
      })
      .catch(() => {
        // Fără thumbnail (URL expirat / codec exotic): rămâne tile-ul cu play.
      });
    return () => {
      alive = false;
    };
  }, [messageId, videoUrl, uri]);

  return uri;
}
