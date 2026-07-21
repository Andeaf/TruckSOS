import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { Radius } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';

/**
 * Hartă mică, necontrolabilă, cu un singur pin (PLAN_FAZA11.md §3).
 * Înlocuiește coordonatele-text de pe ecranele de detaliu; butonul
 * „Deschide în Maps" rămâne dedesubt, pentru navigație reală.
 *
 * `liteMode` (Android): randează o imagine statică în loc de o hartă vie — mai ieftin
 * și nu fură gesturile de scroll ale ecranului în care e încastrată.
 * `cacheEnabled` (iOS): echivalentul Apple Maps — după încărcare harta devine imagine.
 * Varianta de web e în `mini-map.web.tsx` (react-native-maps nu rulează pe web).
 */
export function MiniMap({
  latitude,
  longitude,
  height = 160,
}: {
  latitude: number;
  longitude: number;
  height?: number;
}) {
  const theme = useTheme();
  const scheme = useResolvedScheme();

  return (
    <View style={[styles.wrapper, { height }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        liteMode={Platform.OS === 'android'}
        cacheEnabled={Platform.OS === 'ios'}
        userInterfaceStyle={scheme}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}>
        <Marker coordinate={{ latitude, longitude }} pinColor={theme.brand} />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
});
