import { vi } from 'vitest';

/**
 * AsyncStorage în memorie (fără disc). Se creează în `vi.hoisted` din fiecare test, ca aceeași
 * instanță să supraviețuiască lui `vi.resetModules()` (simulează repornirea aplicației: modulul
 * testat pierde memoria, „discul” rămâne). `failures` face o operație să arunce, ca la un disc
 * plin / indisponibil.
 */
export type StorageOperation = 'getItem' | 'setItem' | 'removeItem' | 'getAllKeys' | 'multiRemove';

export function createMemoryStorage() {
  const store = new Map<string, string>();
  const failures = new Set<StorageOperation>();

  function check(operation: StorageOperation) {
    if (failures.has(operation)) throw new Error(`storage ${operation} failed`);
  }

  const api = {
    getItem: vi.fn(async (key: string): Promise<string | null> => {
      check('getItem');
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string): Promise<void> => {
      check('setItem');
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string): Promise<void> => {
      check('removeItem');
      store.delete(key);
    }),
    getAllKeys: vi.fn(async (): Promise<string[]> => {
      check('getAllKeys');
      return [...store.keys()];
    }),
    multiRemove: vi.fn(async (keys: readonly string[]): Promise<void> => {
      check('multiRemove');
      keys.forEach((key) => store.delete(key));
    }),
  };

  return {
    store,
    failures,
    api,
    /** Golește „discul”, erorile simulate și istoricul apelurilor (în `beforeEach`). */
    reset() {
      store.clear();
      failures.clear();
      Object.values(api).forEach((fn) => fn.mockClear());
    },
  };
}

export type MemoryStorage = ReturnType<typeof createMemoryStorage>;
