import { useEffect, useMemo, useRef, useState } from 'react';

import { subscribeRetryTriggers } from '@/lib/retry-triggers';
import { signedUrls } from '@/lib/storage';

/**
 * URL-urile semnate trăiesc 60 min (SIGNED_URL_TTL): după atâta timp în fundal,
 * ecranul încă montat le ține pe cele moarte → pozele nu se mai încarcă până la
 * o remontare (bug raportat 10 sept: „pozele nu se încarcă dacă nu dau refresh").
 * La revenirea în prim-plan (sau la rețea revenită — 15 oct), dacă PRIMA semnare
 * e mai veche de atât, re-semnăm tot.
 */
const RESIGN_AFTER_MS = 45 * 60 * 1000;

/**
 * Mapare path → URL semnat pentru o listă de path-uri care CREȘTE în timp
 * (mesajele de chat sosesc prin Realtime). Cere URL-uri doar pentru path-urile
 * nevăzute încă, într-un singur apel batch (R3); ce s-a semnat deja se refolosește.
 *
 * Path-urile pe care RLS nu le permite pur și simplu lipsesc din mapare — callerul
 * le tratează ca „poză indisponibilă", fără thumbnail spart.
 */
export function useSignedUrls(paths: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Path-uri deja cerute (reușite SAU eșuate) — evită re-cererea la fiecare render.
  const requested = useRef(new Set<string>());
  // Path-uri cerute fără rezultat (RLS, rețea, token expirat): se reîncearcă la
  // revenirea în prim-plan sau la rețea revenită — o semnare picată fără rețea nu
  // mai lasă poza moartă pe veci (înainte, „cerut" însemna „gata, nu mai întreb").
  const failed = useRef(new Set<string>());
  // Momentul PRIMEI semnări valide (cea mai veche = prima care expiră).
  const firstSignedAt = useRef(0);
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
        const stale =
          firstSignedAt.current > 0 && Date.now() - firstSignedAt.current > RESIGN_AFTER_MS;
        if (stale) {
          // Tot ce știm e pe cale să expire → semnăm din nou, de la zero.
          requested.current.clear();
          failed.current.clear();
          firstSignedAt.current = 0;
          setEpoch((e) => e + 1);
        } else if (failed.current.size > 0) {
          failed.current.forEach((p) => requested.current.delete(p));
          failed.current.clear();
          setEpoch((e) => e + 1);
        }
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
    signedUrls(missing).then((fresh) => {
      if (!mounted.current) return;
      const got = Object.keys(fresh);
      if (got.length > 0) {
        if (firstSignedAt.current === 0) firstSignedAt.current = Date.now();
        setUrls((prev) => ({ ...prev, ...fresh }));
      }
      missing.forEach((p) => {
        if (!fresh[p]) failed.current.add(p);
      });
    });
  }, [paths, epoch]);

  return urls;
}

/** Un singur path (ex. avatarul unui profil). `undefined` cât timp se semnează. */
export function useSignedUrl(path: string | null | undefined): string | undefined {
  const paths = useMemo(() => (path ? [path] : []), [path]);
  const urls = useSignedUrls(paths);
  return path ? urls[path] : undefined;
}
