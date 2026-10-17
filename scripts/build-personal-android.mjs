import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = {
  ...process.env,
  // Use the Android UnifiedPush bridge; retain our independent update channel.
  VITE_AMSG_NATIVE_PUSH: 'true',
  VITE_APK_UPDATE_MANIFEST_URL: '',
  VITE_UMAMI_SCRIPT_URL: '',
  VITE_UMAMI_WEBSITE_ID: '',
  VITE_HIDE_BUILD_BADGE: '1',
};
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(process.execPath, ['scripts/build-chat-preview-css.mjs']);
run(process.execPath, ['scripts/build-workers.mjs']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'capacitor']);
run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android']);
const signed = Boolean(env.NUOMI_KEYSTORE);
const gradle = env.NUOMI_GRADLE || (process.platform === 'win32' ? 'gradlew.bat' : './gradlew');
if (!env.NUOMI_GRADLE && !existsSync(`${root}/android/gradlew`)) {
  throw new Error('Android Gradle wrapper is missing.');
}
run(gradle, [signed ? 'assembleRelease' : 'assembleDebug', '--console=plain'], `${root}/android`);
console.log(`APK: android/app/build/outputs/apk/${signed ? 'release/app-release.apk' : 'debug/app-debug.apk'}`);
