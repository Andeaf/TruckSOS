import { useEffect, useMemo, useRef, useState } from 'react';

import { subscribeRetryTriggers } from '@/lib/retry-triggers';
import {
  LIST_MIN_VALIDITY_MS,
  getCachedUrl,
  localExpiry,
  signPaths,
} from '@/lib/signed-url-cache';

/**
 * URL-urile semnate trăiesc 60 min (SIGNED_URL_TTL): după atâta timp în fundal,
 * ecranul încă montat le ține pe cele moarte → pozele nu se mai încarcă până la
 * o remontare (bug raportat 10 sept: „pozele nu se încarcă dacă nu dau refresh").
 * La revenirea în prim-plan (sau la rețea revenită — 15 oct) re-semnăm URL-urile
 * care mai au sub LIST_MIN_VALIDITY_MS (15 min, adică mai vechi de 45 min).
 * Pragul e per URL, nu per instanță (7.3): din cache-ul global pot veni URL-uri
 * semnate de alt ecran, mai vechi decât montarea acestuia.
 */

/** URL-urile din cache-ul global pentru path-urile date (sincron, fără rețea). */
function fromCache(paths: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  paths.forEach((p) => {
    const url = p ? getCachedUrl(p, undefined, LIST_MIN_VALIDITY_MS) : undefined;
    if (url) map[p] = url;
  });
  return map;
}

/**
 * Mapare path → URL semnat pentru o listă de path-uri care CREȘTE în timp
 * (mesajele de chat sosesc prin Realtime). Cere URL-uri doar pentru path-urile
 * nevăzute încă, într-un singur apel batch (R3); ce s-a semnat deja — aici SAU în
 * alt ecran (cache-ul global, AUDIT #29) — se refolosește fără cerere.
 *
 * Path-urile pe care RLS nu le permite pur și simplu lipsesc din mapare — callerul
 * le tratează ca „poză indisponibilă", fără thumbnail spart.
 */
export function useSignedUrls(paths: string[]): Record<string, string> {
  // Pornește direct cu ce știe cache-ul: la remontare poza nu mai clipește.
  const [urls, setUrls] = useState<Record<string, string>>(() => fromCache(paths));
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  // Path-uri deja cerute (reușite SAU eșuate) — evită re-cererea la fiecare render.
  const requested = useRef(new Set<string>());
  // Path-uri cerute fără rezultat (RLS, rețea, token expirat): se reîncearcă la
  // revenirea în prim-plan sau la rețea revenită — o semnare picată fără rețea nu
  // mai lasă poza moartă pe veci (înainte, „cerut" însemna „gata, nu mai întreb").
  const failed = useRef(new Set<string>());
  const mounted = useRef(true);
  // Incrementat când vrem să re-rulăm semnarea fără ca `paths` să se fi schimbat.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(
    () =>
      subscribeRetryTriggers(() => {
        const now = Date.now();
        // URL-urile pe cale să expire → semnate din nou (cache-ul dă unul proaspăt
        // dacă alt ecran l-a re-semnat deja).
        const stale = Object.entries(urlsRef.current)
          .filter(([, url]) => {
            // Pe ceasul telefonului (review 7.3): ora din token poate fi decalată.
            const exp = localExpiry(url);
            return exp != null && exp - now < LIST_MIN_VALIDITY_MS;
          })
          .map(([path]) => path);
        if (stale.length === 0 && failed.current.size === 0) return;
        stale.forEach((p) => requested.current.delete(p));
        failed.current.forEach((p) => requested.current.delete(p));
        failed.current.clear();
        setEpoch((e) => e + 1);
      }),
    [],
  );

  useEffect(() => {
    const missing = paths.filter((p) => p && !requested.current.has(p));
    if (missing.length === 0) return;

    missing.forEach((p) => requested.current.add(p));

    // FĂRĂ „active = false" la cleanup: `paths` se schimbă la fiecare mesaj nou,
    // iar vechea gardă arunca rezultatul batch-ului aflat în zbor — path-urile lui
    // rămâneau „cerute" dar fără URL, deci pozele mai vechi nu se mai încărcau
    // când sosea un mesaj în timpul semnării (a doua cauză a bugului din 10 sept).
    // Singura gardă necesară e demontarea (fără setState pe componentă moartă).
    signPaths(missing, { minValidityMs: LIST_MIN_VALIDITY_MS }).then((fresh) => {
      if (!mounted.current) return;
      const changed = Object.entries(fresh).some(([p, url]) => urlsRef.current[p] !== url);
      if (changed) setUrls((prev) => ({ ...prev, ...fresh }));
      missing.forEach((p) => {
        if (!fresh[p]) failed.current.add(p);
      });
    });
  }, [paths, epoch]);

  // Path-uri apărute între timp (ex. profilul s-a încărcat) și deja în cache:
  // întoarse din prima randare, fără să aștepte efectul de mai sus.
  return useMemo(() => {
    let out = urls;
    paths.forEach((p) => {
      if (!p || out[p]) return;
      const url = getCachedUrl(p, undefined, LIST_MIN_VALIDITY_MS);
      if (!url) return;
      if (out === urls) out = { ...urls };
      out[p] = url;
    });
    return out;
  }, [urls, paths]);
}

/** Un singur path (ex. avatarul unui profil). `undefined` cât timp se semnează. */
export function useSignedUrl(path: string | null | undefined): string | undefined {
  const paths = useMemo(() => (path ? [path] : []), [path]);
  const urls = useSignedUrls(paths);
  return path ? urls[path] : undefined;
}
