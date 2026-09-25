import type { EmulatorHosts } from './emulator-hosts';

export type { EmulatorHosts };

/**
 * Swapped in for emulators.ts by the `emulators` build configuration only.
 * The ports are firebase.json's emulators block; build-configurations.spec.ts
 * fails when the two differ. Typed as the committed file is, so every consumer
 * type-checks the same way in both builds.
 */
export const EMULATOR_HOSTS: EmulatorHosts | null = {
  auth: { url: 'http://127.0.0.1:9099' },
  firestore: { host: '127.0.0.1', port: 8080 },
  storage: { host: '127.0.0.1', port: 9199 },
  functions: { host: '127.0.0.1', port: 5001 },
};
