// A custom token for signing a smoke suite's client in as a uid it names.
//
// The auth emulator accepts unsigned custom tokens, which is what lets a
// second client authenticate as the uid the first one was granted, or one
// client move to another account without signing out first. No deployed
// project would honour one: the signature segment is empty.
//
// This file compiles into the app program (tsconfig.app.json excludes only
// *.spec.ts, not testing helpers), so it stays jasmine-free.

/** The audience the emulator checks on a custom token. */
const IDENTITY_TOOLKIT_AUDIENCE =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

/** The issuer the Admin SDK names on a custom token it mints for the emulator. */
const EMULATOR_SERVICE_ACCOUNT = 'firebase-auth-emulator@example.com';

/** JWT segments are base64url without padding: plain btoa is not enough. */
function base64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * An unsigned JWT naming `uid`, for `signInWithCustomToken` against the auth
 * emulator. Valid for an hour from the moment it is built.
 */
export function emulatorCustomToken(uid: string): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({
      iss: EMULATOR_SERVICE_ACCOUNT,
      sub: EMULATOR_SERVICE_ACCOUNT,
      aud: IDENTITY_TOOLKIT_AUDIENCE,
      iat: now,
      exp: now + 3600,
      uid
    }),
    ''
  ].join('.');
}
