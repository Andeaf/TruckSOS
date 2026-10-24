import { StyleSheet, Text, View } from 'react-native';

import { RemoteImage } from '@/components/remote-image';
import { Radius } from '@/constants/theme';
import { USER_PALETTE, stableHash, userColor } from '@/lib/user-color';

/**
 * Avatar rotund (PLAN_FAZA10.md §2). Componentă PURĂ: primește URL-ul deja semnat,
 * ca listele să ceară toate URL-urile într-un singur batch (`useSignedUrls`).
 * Fără poză → inițialele numelui pe un fundal derivat determinist din nume.
 */

export interface AvatarProps {
  /** URL semnat; `undefined` cât timp se semnează sau dacă userul n-are poză. */
  url?: string;
  name?: string | null;
  size?: number;
  /** Fundal explicit pentru inițiale (chatul de grup: culoarea stabilă a userului,
   * derivată din id — aceeași cu numele din bulă). Fără el: derivat din nume. */
  color?: string;
  /** Id-ul utilizatorului: fundalul inițialelor = culoarea lui stabilă (aceeași cu numele din chat). */
  userId?: string;
}

export function Avatar({ url, name, size = 40, color, userId }: AvatarProps) {
  const dimensions = { width: size, height: size, borderRadius: Radius.circle };

  if (url) {
    return (
      <RemoteImage
        uri={url}
        style={dimensions}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
      />
    );
  }

  return (
    <View style={[styles.fallback, dimensions, { backgroundColor: color ?? (userId ? userColor(userId, 'light') : colorFor(name)) }]}>
      {/* Inițialele NU urmează scara de font a sistemului (8 oct): cercul are mărime
          fixă, iar la „Foarte mare" literele ieșeau din el și se descentrau. */}
      <Text style={[styles.initials, { fontSize: size * 0.4 }]} maxFontSizeMultiplier={1}>
        {initials(name)}
      </Text>
    </View>
  );
}

function initials(name?: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.slice(0, 2).map((word) => word[0]);
  return letters.join('').toUpperCase();
}

function colorFor(name?: string | null): string {
  return USER_PALETTE[stableHash(name ?? '') % USER_PALETTE.length].light;
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#FFFFFF', fontWeight: '800' },
});
