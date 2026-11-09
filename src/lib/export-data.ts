import { Alert, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import i18n from '@/i18n';
import { translateDbError } from '@/lib/db-errors';
import { supabase } from '@/lib/supabase';

/**
 * „Descarcă datele mele” (1.1, faza 6.4 — GDPR art. 20). RPC-ul `export_my_data()` (migrarea
 * 20261109000600) întoarce ca JSON tot ce e al contului; serverul îl dă o dată la 24 h
 * (`rate_limited`, DETAIL `export`). Plafonul se consumă la apelul RPC, deci după un răspuns reușit
 * fișierul nu trebuie pierdut: dacă foaia de partajare pică, arătăm calea fișierului scris.
 *
 * Nativ: fișier în cache cu API-ul `File` / `Paths` din expo-file-system 19 (SDK 54:
 * https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/ — `create()` apoi `write()`), apoi foaia
 * de partajare (expo-sharing). Web: Blob + `<a download>`.
 */
export async function exportMyData(): Promise<{ error: string | null }> {
  let data: unknown;
  try {
    const { data: result, error } = await supabase.rpc('export_my_data');
    if (error) return { error: exportErrorText(error) };
    data = result;
  } catch (e) {
    return { error: translateDbError(e) };
  }

  const json = JSON.stringify(data, null, 2);
  const name = exportFileName(new Date());

  if (Platform.OS === 'web') {
    try {
      downloadOnWeb(json, name);
      return { error: null };
    } catch (e) {
      console.warn('[export] descărcarea în browser a eșuat:', e);
      return { error: i18n.t('settings.exportError') };
    }
  }

  let file: File;
  try {
    file = new File(Paths.cache, name);
    // `create()` aruncă dacă fișierul există (un export anterior din aceeași zi rămas în cache).
    if (file.exists) file.delete();
    file.create();
    file.write(json);
  } catch (e) {
    console.warn('[export] scrierea fișierului a eșuat:', e);
    return { error: i18n.t('settings.exportError') };
  }

  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: i18n.t('settings.exportDialogTitle'),
      });
      return { error: null };
    }
  } catch (e) {
    console.warn('[export] foaia de partajare a eșuat:', e);
  }
  // Fără foaie de partajare (sau a picat): fișierul e scris, spunem unde.
  Alert.alert(
    i18n.t('settings.exportSavedTitle'),
    i18n.t('settings.exportSavedMessage'),
  );
  return { error: null };
}

/** `trucksos-export-YYYY-MM-DD.json`, după data locală a telefonului. */
function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `trucksos-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

function exportErrorText(error: { code?: string; message?: string }): string {
  // Al doilea export în 24 h (DETAIL `export`; singurul `rate_limited` al acestui RPC).
  if (error.message === 'rate_limited') return i18n.t('settings.exportRateLimited');
  // PGRST202: RPC-ul nu există încă pe server (înainte de migrarea fazei 6) → mesajul generic.
  if (error.code === 'PGRST202') return i18n.t('settings.exportError');
  return translateDbError(error);
}

function downloadOnWeb(json: string, name: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revocare întârziată (ca în web-download.ts): imediat, unele browsere anulează descărcarea.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
