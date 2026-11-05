// Signs release builds with the app's own key. `expo prebuild` regenerates android/, so the
// signing config is injected here. The key and its passwords live outside the repo, in the user's
// ~/.gradle/gradle.properties (ENTRENO_UPLOAD_*); without them, release builds keep the template's
// debug key. scripts/sign_release.py then adds the rotation lineage (see AGENTS.md).
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_CONFIG = `
        release {
            if (project.hasProperty('ENTRENO_UPLOAD_STORE_FILE')) {
                storeFile file(ENTRENO_UPLOAD_STORE_FILE)
                storePassword ENTRENO_UPLOAD_STORE_PASSWORD
                keyAlias ENTRENO_UPLOAD_KEY_ALIAS
                keyPassword ENTRENO_UPLOAD_KEY_PASSWORD
            }
        }`;

function addReleaseSigning(gradle) {
  if (gradle.includes('ENTRENO_UPLOAD_STORE_FILE')) return gradle;
  const debugConfig = /(signingConfigs \{\s*debug \{[^}]*\})/;
  if (!debugConfig.test(gradle)) throw new Error('withReleaseSigning: no signingConfigs.debug in app/build.gradle');
  let out = gradle.replace(debugConfig, `$1${RELEASE_CONFIG}`);
  const releaseUsesDebug = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseUsesDebug.test(out)) throw new Error('withReleaseSigning: release build type not found in app/build.gradle');
  out = out.replace(
    releaseUsesDebug,
    "$1signingConfig project.hasProperty('ENTRENO_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
  );
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = addReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
