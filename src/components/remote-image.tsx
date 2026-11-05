import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import {
  Image,
  type ImageErrorEventData,
  type ImageLoadEventData,
  type ImageProps,
} from 'expo-image';

import { subscribeRetryTriggers } from '@/lib/retry-triggers';
import {
  getCachedUrl,
  localExpiry,
  rememberSignedUrl,
  signPaths,
  thumbnailCacheKey,
} from '@/lib/signed-url-cache';
import {
  IMAGE_TRANSFORMS_ENABLED,
  signedUrlExpiry,
  signedUrlPath,
  type ImageTransform,
} from '@/lib/storage';

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
 *  3. Token expirat (ecran ținut > 1h): re-semnează path-ul înainte să reîncerce,
 *     prin cache-ul global (7.3), deci și celelalte ecrane primesc URL-ul nou.
 *  4. (7.3, AUDIT #29) Citește sincron cache-ul global de URL-uri: dacă știe un URL
 *     mai proaspăt pentru același path decât cel primit, îl folosește (fără token
 *     mort la remontare); URL-urile primite îl alimentează la rândul lor.
 *  5. `thumbnailWidth`: miniatură prin Image Transformations — DOAR cu
 *     IMAGE_TRANSFORMS_ENABLED; oprit, prop-ul nu schimbă nimic.
 */

export type RemoteImageProps = Omit<ImageProps, 'source'> & {
  /** URL-ul pozei — de regulă semnat Supabase; merge și cu orice alt URL http(s). */
  uri: string;
  /**
   * Lățimea afișată (dp): cere o miniatură în loc de poza întreagă. Ignorat cât
   * timp IMAGE_TRANSFORMS_ENABLED e false sau `uri` nu e un URL semnat al nostru.
   */
  thumbnailWidth?: number;
};

/** Pauzele reîncercărilor automate; după ele se așteaptă un declanșator extern. */
const RETRY_DELAYS_MS = [1500, 4000, 10000];
/** Un token care expiră în mai puțin de atât e tratat ca expirat (descărcarea durează). */
const EXPIRY_MARGIN_MS = 60_000;
/** Re-semnarea după expirare cere un URL cu cel puțin atât rămas — nu înapoi pe cel mort. */
const RESIGN_MIN_VALIDITY_MS = 5 * 60_000;
/** Lățimi standard (px) pentru miniaturi: puține chei de cache, indiferent de telefon. */
const THUMBNAIL_WIDTHS = [64, 128, 256, 384, 512, 768, 1024];

function thumbnailTransform(width: number): ImageTransform {
  const px = Math.ceil(width * PixelRatio.get());
  const bucket =
    THUMBNAIL_WIDTHS.find((w) => w >= px) ?? THUMBNAIL_WIDTHS[THUMBNAIL_WIDTHS.length - 1];
  return { width: bucket, resize: 'cover' };
}

/** Dintre două URL-uri semnate ale aceluiași path, cel care expiră mai târziu. */
function laterUrl(current: string, candidate: string | undefined): string {
  if (!candidate || candidate === current) return current;
  const a = signedUrlExpiry(current);
  const b = signedUrlExpiry(candidate);
  return a != null && b != null && b > a ? candidate : current;
}

export function RemoteImage({ uri, thumbnailWidth, onLoad, onError, ...rest }: RemoteImageProps) {
  // Intră în `key`: remontarea e singura reîncercare sigură pe ambele platforme.
  const [attempt, setAttempt] = useState(0);
  // URL re-semnat după expirarea tokenului, legat de `uri`-ul (și varianta) pentru
  // care s-a cerut (un `uri` nou de la părinte îl face irelevant de la sine).
  const [resigned, setResigned] = useState<{ forUri: string; thumb: boolean; url: string } | null>(
    null,
  );
  // Miniatura a picat (semnare sau încărcare) pentru acest `uri` → poza întreagă.
  const [thumbFailedFor, setThumbFailedFor] = useState<string | null>(null);
  // O randare în plus după ce miniatura a intrat în cache (citită sincron mai jos).
  const [, setThumbReady] = useState(0);
  const failed = useRef(false);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const path = useMemo(() => signedUrlPath(uri), [uri]);
  const thumbWidth =
    IMAGE_TRANSFORMS_ENABLED && path && thumbnailWidth && thumbFailedFor !== uri
      ? thumbnailTransform(thumbnailWidth).width
      : null;
  const transform = useMemo<ImageTransform | undefined>(
    () => (thumbWidth ? { width: thumbWidth, resize: 'cover' } : undefined),
    [thumbWidth],
  );

  let effectiveUri: string | undefined;
  let cacheKey: string | undefined;
  if (transform && path) {
    effectiveUri =
      resigned?.forUri === uri && resigned.thumb ? resigned.url : getCachedUrl(path, transform);
    cacheKey = thumbnailCacheKey(path, transform);
  } else {
    const base = resigned?.forUri === uri && !resigned.thumb ? resigned.url : uri;
    effectiveUri = path ? laterUrl(base, getCachedUrl(path)) : base;
    cacheKey = signedUrlPath(effectiveUri) ?? undefined;
  }

  const effectiveUriRef = useRef(effectiveUri);
  effectiveUriRef.current = effectiveUri;
  const uriRef = useRef(uri);
  uriRef.current = uri;
  const pathRef = useRef(path);
  pathRef.current = path;
  const transformRef = useRef(transform);
  transformRef.current = transform;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // URL nou de la părinte (re-semnare în batch, altă poză) → stare curată; URL-ul
  // primit (poate semnat direct de ecran, fără cache) devine cunoscut tuturor.
  useEffect(() => {
    failed.current = false;
    failures.current = 0;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    rememberSignedUrl(uri);
  }, [uri]);

  // Miniatura lipsă din cache → o semnăm; eșec → poza întreagă (flag-ul oprit: nu rulează).
  useEffect(() => {
    if (!transform || !path || getCachedUrl(path, transform)) return;
    const forUri = uri;
    signPaths([path], { transform }).then((map) => {
      if (!mounted.current || uriRef.current !== forUri) return;
      if (map[path]) setThumbReady((n) => n + 1);
      else setThumbFailedFor(forUri);
    });
  }, [uri, path, transform]);

  const retry = useCallback(async () => {
    timer.current = null;
    const forUri = uriRef.current;
    const current = effectiveUriRef.current;
    const currentPath = pathRef.current;
    const currentTransform = transformRef.current;
    // Pe ceasul telefonului (review 7.3): cu ceasul în urmă, ora din token ar amâna re-semnarea.
    const expiry = current ? localExpiry(current) : null;
    if (currentPath && expiry != null && expiry - Date.now() < EXPIRY_MARGIN_MS) {
      let fresh: string | undefined;
      try {
        const map = await signPaths([currentPath], {
          transform: currentTransform,
          minValidityMs: RESIGN_MIN_VALIDITY_MS,
        });
        fresh = map[currentPath];
      } catch {
        // Fără rețea: reîncercăm cu URL-ul vechi, iar eșecul lui reintră în scară.
      }
      // Între timp părintele a dat alt URL (altă poză sau re-semnare în batch) →
      // rezultatul e al pozei vechi; nu-l legăm de cea nouă.
      if (!mounted.current || uriRef.current !== forUri) return;
      if (fresh) setResigned({ forUri, thumb: !!currentTransform, url: fresh });
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
      // Miniatura încă nesemnată: fără sursă (fundalul din stil), nu poza întreagă descărcată degeaba.
      source={effectiveUri ? { uri: effectiveUri, cacheKey } : null}
      onLoad={(event: ImageLoadEventData) => {
        failed.current = false;
        failures.current = 0;
        onLoad?.(event);
      }}
      onError={(event: ImageErrorEventData) => {
        if (transform) {
          // Miniatura nu merge (ex. Transformations oprit în Dashboard) → poza întreagă,
          // cu scara normală de reîncercări.
          setThumbFailedFor(uri);
          return;
        }
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
