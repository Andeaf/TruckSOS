import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import i18n from '@/i18n';
import { errorMessageOf, type NetworkReport } from '@/lib/network-diagnosis';
import { supabase } from '@/lib/supabase';

/**
 * Coada locală de diagnostice de rețea (13 oct 2026) → tabela `client_diagnostics`.
 *
 * Când diagnosticul rulează, serverul e tocmai inaccesibil, deci rezultatul NU poate
 * pleca pe loc: îl ținem în AsyncStorage (max 20 de intrări, cele mai vechi cad) și
 * îl urcăm la prima ocazie în care avem sesiune — după login sau la o schimbare de
 * sesiune (use-auth). RLS: fiecare rând cu user_id = auth.uid(); citesc doar adminii.
 * Doar date tehnice (fără email/parolă/conținut) — vezi politica, „Date tehnice".
 */
const QUEUE_KEY = 'diagnostics:queue';
const MAX_ENTRIES = 20;

export interface DiagnosticEntry {
  occurred_at: string;
  kind: string;
  diagnosis: string;
  error_message: string | null;
  probes: NetworkReport['probes'];
  network: NetworkReport['network'];
  clock_drift_ms: number | null;
  platform: string;
  os_version: string | null;
  device_model: string | null;
  app_version: string | null;
  locale: string | null;
}

// `clock_drift_ms` e int4 în DB: un ceas dat cu luni (chiar cazul „clock") ar depăși ±2^31 ms
// și serverul ar refuza tot lotul.
const INT4_MAX = 2147483647;
function clampInt4(n: number): number {
  return Math.max(-INT4_MAX, Math.min(INT4_MAX, n));
}

export function buildDiagnosticEntry(
  kind: string,
  error: unknown,
  report: NetworkReport
): DiagnosticEntry {
  return {
    occurred_at: new Date().toISOString(),
    kind: kind.slice(0, 40),
    diagnosis: report.diagnosis,
    error_message: errorMessageOf(error),
    probes: report.probes,
    network: report.network,
    clock_drift_ms: report.clockDriftMs === null ? null : clampInt4(Math.round(report.clockDriftMs)),
    platform: Platform.OS,
    os_version: Device.osVersion ?? null,
    device_model: Device.modelName ?? null,
    app_version: Constants.expoConfig?.version ?? null,
    locale: i18n.language ?? null,
  };
}

async function readQueue(): Promise<DiagnosticEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as DiagnosticEntry[]) : [];
  } catch {
    return [];
  }
}

export async function queueDiagnostic(entry: DiagnosticEntry): Promise<void> {
  if (__DEV__) console.warn('[diag]', entry.kind, entry.diagnosis, JSON.stringify(entry.probes));
  try {
    const queue = await readQueue();
    queue.push(entry);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_ENTRIES)));
  } catch {
    // Jurnal best-effort; nu afectăm ecranul.
  }
}

let flushing = false;

/** Urcă ce s-a strâns, dacă există sesiune. Sigur de apelat oricând, oricât de des. */
export async function flushDiagnostics(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const queue = await readQueue();
    if (queue.length === 0) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const rows = queue.map((e) => ({ ...e, user_id: session.user.id }));
    const { error } = await supabase.from('client_diagnostics').insert(rows as never);
    // Orice refuz al serverului (tabela lipsă PGRST205/42P01, CHECK, tip de date) → aruncăm
    // lotul: sunt doar diagnostice, iar reîncercarea la nesfârșit ar bloca și rândurile bune.
    // Fără cod = eroare de rețea → rămân în coadă pentru data viitoare.
    if (!error || error.code) {
      await AsyncStorage.removeItem(QUEUE_KEY);
    } else if (__DEV__) {
      console.warn('[diag] upload eșuat:', error.message);
    }
  } catch {
    // Reîncercăm la următoarea ocazie.
  } finally {
    flushing = false;
  }
}
