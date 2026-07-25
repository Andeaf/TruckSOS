/** Fără diacritice + lowercase: „Brașov" se găsește și tastând „brasov". */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Potrivire multi-cuvânt: fiecare cuvânt din query trebuie găsit în cel puțin un
 * câmp (AND între cuvinte, OR între câmpuri) — „volvo brasov" găsește anunțul cu
 * camion Volvo din Brașov chiar dacă cele două apar în câmpuri diferite.
 */
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystacks = fields.filter(Boolean).map((f) => normalizeSearch(f as string));
  return words.every((word) => haystacks.some((h) => h.includes(word)));
}
