import { StyleSheet, Text, View } from 'react-native';

import { RemoteImage } from '@/components/remote-image';
import { Radius } from '@/constants/theme';

/**
 * Avatar rotund (PLAN_FAZA10.md §2). Componentă PURĂ: primește URL-ul deja semnat,
 * ca listele să ceară toate URL-urile într-un singur batch (`useSignedUrls`).
 * Fără poză → inițialele numelui pe un fundal derivat determinist din nume.
 */

/** Fundaluri pentru inițiale — contrast suficient cu text alb, în ambele teme. */
const FALLBACK_COLORS = ['#164F9E', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

export interface AvatarProps {
  /** URL semnat; `undefined` cât timp se semnează sau dacă userul n-are poză. */
  url?: string;
  name?: string | null;
  size?: number;
  /** Fundal explicit pentru inițiale (chatul de grup: culoarea stabilă a userului,
   * derivată din id — aceeași cu numele din bulă). Fără el: derivat din nume. */
  color?: string;
}

export function Avatar({ url, name, size = 40, color }: AvatarProps) {
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
    <View style={[styles.fallback, dimensions, { backgroundColor: color ?? colorFor(name) }]}>
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
  const source = name ?? '';
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) % 1000003;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#FFFFFF', fontWeight: '800' },
});
