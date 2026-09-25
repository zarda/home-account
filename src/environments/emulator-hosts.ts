/**
 * Where the local Firebase emulators listen. Declared apart from emulators.ts
 * because the `emulators` configuration replaces that file with
 * emulators.on.ts at module resolution: a type imported from './emulators'
 * inside the replacement would resolve to the replacement itself.
 */
export interface EmulatorHost {
  host: string;
  port: number;
}

export interface EmulatorHosts {
  /** connectAuthEmulator takes a URL, the other three a host and a port. */
  auth: { url: string };
  firestore: EmulatorHost;
  storage: EmulatorHost;
  functions: EmulatorHost;
}
