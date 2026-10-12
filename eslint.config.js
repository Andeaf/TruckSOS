// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // dist/ și .expo/ sunt generate; funcțiile Edge rulează pe Deno (importuri `npm:`),
    // pe care resolver-ul de Node nu le înțelege.
    ignores: ["dist/*", ".expo/*", "supabase/functions/*"],
  }
]);
