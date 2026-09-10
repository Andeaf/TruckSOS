import { View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

/**
 * Iconiță de tab cu bulină-punct opțională (noutăți Feed/Candidaturi din Faza 14.10,
 * Market din 8 sept 2026).
 *
 * De ce punct și nu `tabBarBadge`: pe web, peste 1024px, bara devine `WebSidebar`,
 * care randează DOAR `options.tabBarIcon` și `tabBarLabel` — `tabBarBadge` e ignorat
 * acolo (vezi web-sidebar.tsx). Punctul desenat în interiorul iconiței apare pe
 * ambele. Badge-ul numeric al Chatului rămâne pe `tabBarBadge`, cu limitarea știută.
 *
 * Trăia local în `(mechanic)/_layout.tsx`; mutat aici pe 8 sept, când bulina de
 * Market a avut nevoie de el și în layout-ul șoferului.
 */
export function TabIcon({
  name,
  color,
  size,
  dot,
}: {
  name: keyof typeof Feather.glyphMap;
  color: string;
  size: number;
  dot?: boolean;
}) {
  return (
    <View>
      <Feather name={name} size={size} color={color} />
      {dot ? <View style={styles.dot} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: -3,
    right: -5,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
});
