// `URL` din node:url, nu cel global: tsconfig include lib-ul DOM, iar fileURLToPath cere tipul din Node.
import { URL, fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Testele unitare ale logicii pure din client (faza 10.4): rulează în Node, fără React Native.
 * Modulele native (react-native, expo-*, AsyncStorage, clientul Supabase) se înlocuiesc în fiecare
 * test cu `vi.mock` (vezi tests/unit/mocks/). Aliasurile oglindesc `paths` din tsconfig.json.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/assets\//, replacement: fileURLToPath(new URL('./assets/', import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
