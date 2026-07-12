import { useEffect, useRef, useState } from 'react';

import { signedUrls } from '@/lib/storage';

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

  useEffect(() => {
    const missing = paths.filter((p) => p && !requested.current.has(p));
    if (missing.length === 0) return;

    missing.forEach((p) => requested.current.add(p));
    let active = true;

    signedUrls(missing).then((fresh) => {
      if (active && Object.keys(fresh).length > 0) {
        setUrls((prev) => ({ ...prev, ...fresh }));
      }
    });

    return () => { active = false; };
  }, [paths]);

  return urls;
}
