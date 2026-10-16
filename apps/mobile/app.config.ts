import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'US-002 Synthetic Vault',
  slug: 'financial-manager-us002',
  version: '0.0.1',
  platforms: ['android', 'ios'],
  orientation: 'portrait',
  updates: { enabled: false },
  android: {
    package: 'com.miudos.financialmanager.us002',
    allowBackup: false,
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  ios: {
    bundleIdentifier: 'com.miudos.financialmanager.us002',
    supportsTablet: true,
  },
  plugins: [
    './spikes/us-002/with-android-build.cjs',
    ['expo-sqlite', { useSQLCipher: true, enableFTS: false }],
    ['expo-secure-store', { configureAndroidBackup: true }],
  ],
};

export default config;
