import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import { Alert, Linking, Platform } from 'react-native';

import i18n from '@/i18n';
import { webDownload } from '@/lib/web-download';

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
/** Max poze într-o singură selecție (Faza 14.8). iOS respectă selectionLimit; pe Android
 *  pickerul de sistem poate ignora limita, de aceea callerii taie surplusul suplimentar. */
export const MAX_PHOTOS = 10;

export async function pickFromLibrary(): Promise<PickedImage[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_PHOTOS,
    quality: 1,
  });
  if (result.canceled) return [];
  return toPicked(result.assets);
}

/** Captură cu camera — o poză. Cere permisiune de cameră. */
export async function pickFromCamera(): Promise<PickedImage[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    // Refuz PERSISTENT (canAskAgain=false — pe iOS după primul refuz, mereu): fără
    // mesaj, butonul „Fă o poză" ar părea mort; singura ieșire e din setările OS
    // (PLAN_FAZA17.md §1.1). La refuz re-întrebabil (Android) rămânem tăcuți ca înainte.
    if (!perm.canAskAgain) {
      Alert.alert(i18n.t('photos.cameraDeniedTitle'), i18n.t('photos.cameraDeniedBody'), [
        { text: i18n.t('photos.cancel'), style: 'cancel' },
        { text: i18n.t('photos.openSettings'), onPress: () => Linking.openSettings() },
      ]);
    }
    return [];
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (result.canceled) return [];
  return toPicked(result.assets);
}

/** Videoclip ales/filmat pentru chat (23 aug). Singura limită reală e MĂRIMEA
 *  (`MAX_VIDEO_SIZE`, 50 MB — cerere user 23 aug: 10 era prea puțin), validată în
 *  chat-screen; durata plafonează DOAR înregistrarea din aplicație (nativ). */
export const MAX_VIDEO_DURATION_S = 60;

export interface PickedVideo {
  uri: string;
  name: string;
  size: number;
  mimeType?: string;
  /** Milisecunde; null când pickerul nu o raportează (unele galerii Android). */
  durationMs: number | null;
}

/** Numele fișierului pentru un videoclip: cel din picker sau unul generat cu
 *  extensia reală din URI (iOS filmează .mov, Android .mp4). */
function videoAsset(asset: ImagePicker.ImagePickerAsset): PickedVideo {
  const extMatch = /\.(\w{2,4})$/.exec(asset.uri);
  const ext = (extMatch?.[1] ?? 'mp4').toLowerCase();
  let size = asset.fileSize ?? 0;
  if (!size && Platform.OS !== 'web') {
    try {
      size = new File(asset.uri).size ?? 0;
    } catch {
      size = 0;
    }
  }
  return {
    uri: asset.uri,
    name: asset.fileName ?? `video-${Date.now()}.${ext}`,
    size,
    mimeType: asset.mimeType ?? `video/${ext === 'mov' ? 'quicktime' : ext}`,
    durationMs: asset.duration ?? null,
  };
}

export interface PickedMedia {
  images: PickedImage[];
  videos: PickedVideo[];
}

/**
 * Galerie MIXTĂ poze + video (cerere user 23 aug, „ca pe WhatsApp"): o singură
 * selecție servește ambele tipuri — chat-screen trimite pozele prin conducta de
 * imagini și videoclipurile prin cea de fișiere. Anunțurile rămân pe
 * `pickFromLibrary` (doar poze, intenționat).
 */
export async function pickMediaFromLibrary(): Promise<PickedMedia> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_PHOTOS,
    quality: 1,
  });
  if (result.canceled) return { images: [], videos: [] };
  const images: PickedImage[] = [];
  const videos: PickedVideo[] = [];
  for (const asset of result.assets) {
    if (asset.type === 'video') videos.push(videoAsset(asset));
    else images.push({ uri: asset.uri, width: asset.width, height: asset.height });
  }
  return { images, videos };
}

/**
 * Filmare din aplicație — plafonată nativ la `MAX_VIDEO_DURATION_S` (60s). Pe iOS
 * cerem calitate medie (H.264, rezoluție moderată) ca un clip întreg să încapă
 * lejer în plafonul video de 50 MB; Android nu oferă transcodare la picker —
 * rămâne plafonul din chat-screen. Compresie reală nu există în Expo Go.
 */
export async function recordVideo(): Promise<PickedVideo | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    // Aceeași UX ca la poze: la refuz persistent, singura ieșire e din setările OS.
    if (!perm.canAskAgain) {
      Alert.alert(i18n.t('photos.cameraDeniedTitle'), i18n.t('photos.cameraDeniedBody'), [
        { text: i18n.t('photos.cancel'), style: 'cancel' },
        { text: i18n.t('photos.openSettings'), onPress: () => Linking.openSettings() },
      ]);
    }
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    videoMaxDuration: MAX_VIDEO_DURATION_S,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return videoAsset(result.assets[0]);
}

export type GalleryDownloadResult = 'saved' | 'permission-denied' | 'error';

/**
 * Salvează în galeria telefonului o poză de la un URL (semnat) remote.
 * Descarcă întâi în cache (nativ), apoi `saveToLibraryAsync`. Cere permisiune
 * de scriere în galerie (write-only: pe iOS = „Add Photos Only", suficientă).
 * Refuzul de permisiune se întoarce distinct de eroare, ca UI-ul să poată
 * trimite userul la setări (PLAN_FAZA17.md §1.1).
 */
export async function downloadToGallery(remoteUrl: string): Promise<GalleryDownloadResult> {
  // Web (7 aug): nu există galerie/MediaLibrary — descărcarea browserului e echivalentul.
  if (Platform.OS === 'web') {
    try {
      await webDownload(remoteUrl, `trucksos-${Date.now()}.jpg`);
      return 'saved';
    } catch {
      return 'error';
    }
  }
  let dest: File | null = null;
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true); // writeOnly
    if (!perm.granted) return 'permission-denied';
    dest = new File(Paths.cache, `trucksos-${Date.now()}.jpg`);
    const file = await File.downloadFileAsync(remoteUrl, dest);
    await MediaLibrary.saveToLibraryAsync(file.uri);
    return 'saved';
  } catch {
    return 'error';
  } finally {
    // Fișierul temp nu mai e necesar după salvarea în galerie — best-effort.
    try {
      dest?.delete();
    } catch {}
  }
}
