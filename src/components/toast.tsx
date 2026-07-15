import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';

/**
 * Toast tranzitoriu, controlat prin prop-ul `message`: când devine ne-null apare
 * cu fade, stă ~1.4s, apoi dispare și cheamă `onHide` (care golește mesajul).
 * Pastilă întunecată + text alb — lizibilă în ambele teme, ca pilula orei de pe poze.
 * `pointerEvents="none"`: nu prinde tap-uri, nu blochează chatul dedesubt.
 */

interface ToastProps {
  message: string | null;
  onHide: () => void;
  /** Ridică toast-ul deasupra barei de input a chatului. */
  bottomOffset?: number;
}

export function Toast({ message, onHide, bottomOffset = 0 }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onHide();
      });
    }, 1400);
    return () => clearTimeout(timer);
  }, [message, opacity, onHide]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.toast, { opacity, bottom: insets.bottom + bottomOffset + Spacing.six }]}>
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '80%',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.badge,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  text: { color: '#fff', fontSize: 13, textAlign: 'center' },
});
