import type { EmulatorHosts } from './emulator-hosts';

export type { EmulatorHosts };

/**
 * The emulators the app connects to, or null for the Firebase project the
 * environment names. Null in every build but `emulators` (angular.json), which
 * replaces this file with emulators.on.ts; build-configurations.spec.ts fails
 * when any other configuration touches it.
 *
 * A separate file rather than a flag on the environment: environment.ts
 * re-exports a gitignored local file, and neither it, the CI stubs nor the
 * production secret declare such a flag, so reading one would not compile.
 */
export const EMULATOR_HOSTS: EmulatorHosts | null = null;
