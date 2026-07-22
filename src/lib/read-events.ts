// Semnal LOCAL „am marcat ceva ca citit pe ACEST device" pentru badge-urile de tab.
// Stingerea bulinei nu poate depinde de round-trip-ul Realtime pe message_reads/
// channel_reads: abonarea poate muri tăcut într-o sesiune lungă, iar bulina rămânea
// aprinsă (server: 0 necitite) până la restart — văzut pe Android, 21 iul 2026.
// Realtime rămâne doar pentru sincronizarea ÎNTRE device-uri.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Abonează un badge; întoarce funcția de dezabonare (potrivit direct în useEffect). */
export function onReadsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** De apelat după orice upsert reușit în message_reads/channel_reads. */
export function emitReadsChanged(): void {
  listeners.forEach((l) => l());
}
