import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';

/**
 * Wrappere peste image-picker + media-library (PLAN_FAZA9.md §8).
 * Toate incluse în Expo Go SDK 54 — fără development build.
 */

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

function toPicked(assets: ImagePicker.ImagePickerAsset[]): PickedImage[] {
  return assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
}

/**
 * Selectare din galerie — una sau mai multe poze.
 * Nu cerem permisiune explicită: pickerul de sistem o gestionează singur.
 * `quality: 1` — compresia reală o face `compressImage` la upload (resize + JPEG).
 */
export async function pickFromLibrary(): Promise<PickedImage[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    quality: 1,
  });
  if (result.canceled) return [];
  return toPicked(result.assets);
}

/** Captură cu camera — o poză. Cere permisiune de cameră. */
export async function pickFromCamera(): Promise<PickedImage[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (result.canceled) return [];
  return toPicked(result.assets);
}

/**
 * Salvează în galeria telefonului o poză de la un URL (semnat) remote.
 * Descarcă întâi în cache (nativ), apoi `saveToLibraryAsync`. Cere permisiune
 * de scriere în galerie. Întoarce `false` la refuz sau eroare.
 */
export async function downloadToGallery(remoteUrl: string): Promise<boolean> {
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true); // writeOnly
    if (!perm.granted) return false;
    const dest = new File(Paths.cache, `trucksos-${Date.now()}.jpg`);
    const file = await File.downloadFileAsync(remoteUrl, dest);
    await MediaLibrary.saveToLibraryAsync(file.uri);
    return true;
  } catch {
    return false;
  }
}
