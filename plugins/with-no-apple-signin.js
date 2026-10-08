// 8 oct 2026 — login-ul social e OPRIT în 1.0.7 (`extra.socialLogin.enabled: false`),
// dar `expo-apple-authentication` rămâne instalat pentru 1.0.8, iar @expo/prebuild-config
// îi aplică AUTOMAT pluginul (lista `versionedExpoSDKPackages`), care pune NECONDIȚIONAT
// entitlement-ul `com.apple.developer.applesignin`. Cu el, build-ul iOS cere un profil de
// provisionare nou (rulare interactivă cu login Apple — exact ce a picat la primul build
// 1.0.7). Pluginul ăsta scoate entitlement-ul după ce l-au pus celelalte, deci profilul
// vechi rămâne valabil. La 1.0.8: șterge-l din app.json (și pune `ios.usesAppleSignIn`).
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withNoAppleSignIn(config) {
  return withEntitlementsPlist(config, (config) => {
    delete config.modResults['com.apple.developer.applesignin'];
    return config;
  });
};
