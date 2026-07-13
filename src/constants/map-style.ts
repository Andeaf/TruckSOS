/**
 * Stil întunecat pentru Google Maps (Android), aplicat când tema REZOLVATĂ a
 * aplicației e dark — deci respectă și override-ul manual din Setări, nu doar
 * tema sistemului. Pe iOS (Apple Maps) `customMapStyle` e ignorat: harta urmează
 * automat tema sistemului.
 *
 * Paletă aliniată cu `Colors.dark` (fundal aproape negru, apă albastru-închis,
 * drumuri gri-mediu), ca harta să nu „ardă" ecranul lângă restul UI-ului.
 */
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d1d1d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a6' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d1d1d' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ color: '#3c4043' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#7a7f85' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#1f2b20' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#2f3134' }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#3a3d41' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#4a4d52' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9aa0a6' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#2b2b2b' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#12263a' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4e6d8c' }],
  },
];

/** Fallback când n-avem permisiune de locație: centrul României, la nivel de țară. */
export const ROMANIA_REGION = {
  latitude: 45.9,
  longitude: 25.0,
  latitudeDelta: 4,
  longitudeDelta: 4,
};

/** Zoom pe poziția mecanicului: ~15 km în jur. */
export const USER_REGION_DELTA = 0.15;
