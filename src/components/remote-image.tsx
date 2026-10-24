import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  type ImageErrorEventData,
  type ImageLoadEventData,
  type ImageProps,
} from 'expo-image';

import { subscribeRetryTriggers } from '@/lib/retry-triggers';
import { signedUrl, signedUrlExpiry, signedUrlPath } from '@/lib/storage';

/**
 * Poză remote (URL semnat Supabase) care se repară singură — înlocuiește
 * `expo-image` pentru TOT conținutul utilizatorilor: chat, Market, anunțuri,
 * avatare, viewer. Pozele LOCALE (picker, thumbnail video) rămân pe `Image`.
 *
 * Raport 15 oct 2026: pe rețea slabă, pozele din chat și cover-urile din Market
 * rămâneau goale până la repornirea app-ului, deși viewerul (montat proaspăt) le
 * afișa. Cauza: `expo-image` NU reîncearcă o încărcare picată — pe Android,
 * re-setarea aceleiași surse e ignorată (reține sursa CERUTĂ, nu pe cea reușită),
 * iar nimic din app nu schimba sursa sau remonta poza.
 *
 * Ce face:
 *  1. `cacheKey` = path-ul din Storage, nu URL-ul: tokenul se schimbă la fiecare
 *     semnare (fiecare focus pe Market, fiecare deschidere de chat), deci cache-ul
 *     pe disc nu nimerea niciodată și TOATE pozele se descărcau din nou — cu
 *     șanse de a pica. Obiectele sunt imuabile (uuid în path, `upsert: false`),
 *     deci cheia stabilă e sigură; pozele văzute se afișează și offline.
 *  2. La eroare: reîncercări cu pauze crescânde, prin remontare (`key`) — singura
 *     cale sigură pe ambele platforme; apoi așteaptă un declanșator extern:
 *     prim-plan sau rețea revenită (lib/retry-triggers).
 *  3. Token expirat (ecran ținut > 1h): re-semnează path-ul înainte să reîncerce.
 */

export type RemoteImageProps = Omit<ImageProps, 'source'> & {
  /** URL-ul pozei — de regulă semnat Supabase; merge și cu orice alt URL http(s). */
  uri: string;
};

/** Pauzele reîncercărilor automate; după ele se așteaptă un declanșator extern. */
const RETRY_DELAYS_MS = [1500, 4000, 10000];
/** Un token care expiră în mai puțin de atât e tratat ca expirat (descărcarea durează). */
const EXPIRY_MARGIN_MS = 60_000;

export function RemoteImage({ uri, onLoad, onError, ...rest }: RemoteImageProps) {
  // Intră în `key`: remontarea e singura reîncercare sigură pe ambele platforme.
  const [attempt, setAttempt] = useState(0);
  // URL re-semnat după expirarea tokenului, legat de `uri`-ul pentru care s-a cerut
  // (un `uri` nou de la părinte îl face irelevant de la sine).
  const [resigned, setResigned] = useState<{ forUri: string; url: string } | null>(null);
  const failed = useRef(false);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const effectiveUri = resigned?.forUri === uri ? resigned.url : uri;
  const effectiveUriRef = useRef(effectiveUri);
  effectiveUriRef.current = effectiveUri;
  const uriRef = useRef(uri);
  uriRef.current = uri;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // URL nou de la părinte (re-semnare în batch, altă poză) → stare curată.
  useEffect(() => {
    failed.current = false;
    failures.current = 0;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [uri]);

  const retry = useCallback(async () => {
    timer.current = null;
    const forUri = uriRef.current;
    const current = effectiveUriRef.current;
    const expiry = signedUrlExpiry(current);
    if (expiry != null && expiry - Date.now() < EXPIRY_MARGIN_MS) {
      const path = signedUrlPath(current);
      let fresh: string | null = null;
      try {
        fresh = path ? await signedUrl(path) : null;
      } catch {
        // Fără rețea: reîncercăm cu URL-ul vechi, iar eșecul lui reintră în scară.
      }
      // Între timp părintele a dat alt URL (altă poză sau re-semnare în batch) →
      // rezultatul e al pozei vechi; nu-l legăm de cea nouă.
      if (!mounted.current || uriRef.current !== forUri) return;
      if (fresh) setResigned({ forUri, url: fresh });
    }
    // Reîncercarea e „în zbor": un declanșator extern n-o mai dublează; dacă pică,
    // onError o marchează iar.
    failed.current = false;
    setAttempt((a) => a + 1);
  }, []);

  useEffect(
    () =>
      subscribeRetryTriggers(() => {
        if (!failed.current || timer.current) return;
        // Declanșator extern: scara pauzelor pornește iar de la zero.
        failures.current = 0;
        timer.current = setTimeout(retry, Math.random() * 800);
      }),
    [retry],
  );

  return (
    <Image
      key={attempt}
      {...rest}
      source={{ uri: effectiveUri, cacheKey: signedUrlPath(effectiveUri) ?? undefined }}
      onLoad={(event: ImageLoadEventData) => {
        failed.current = false;
        failures.current = 0;
        onLoad?.(event);
      }}
      onError={(event: ImageErrorEventData) => {
        failed.current = true;
        const n = failures.current++;
        if (n < RETRY_DELAYS_MS.length && !timer.current) {
          // Jitter: zeci de poze picate pe un ecran nu reîncearcă în aceeași clipă.
          timer.current = setTimeout(retry, RETRY_DELAYS_MS[n] + Math.random() * 500);
        }
        onError?.(event);
      }}
    />
  );
}
