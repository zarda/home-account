// Keeps an emulator run CI-shaped for whatever provider key the build-time
// environment happens to carry (#424). GeminiService builds a client from
// environment.geminiApiKey (gemini.service.ts:68,73) and logs as it does
// (:89,:99,:111); the gitignored local environment a developer runs smoke
// against often carries a real one, while CI's stub (see ci.yml's "Create
// local environment stubs" step) never does. Left alone, the same suite
// prints lines on a developer machine that CI never sees, purely because of
// which machine happened to run it.
//
// geminiApiKey is the only provider key the build-time environment ever
// carries — OpenAI and Claude are configured per-account through Firestore,
// never through environment.ts — so it is the only field to strip.
//
// No restore, unlike the hand-rolled beforeAll/afterAll versions this
// replaces: specs load as ES modules into one Karma bundle, and jasmine only
// starts once every module has finished evaluating (silence-firebase-
// warnings.ts leans on the same ordering). A module-scope call here runs
// ahead of every spec in the bundle, so stripping once makes the *whole* run
// CI-shaped rather than one file's share of it — restoring would only
// reopen the gap for whatever runs after. Nothing downstream reads this
// field back, and deleting an absent property is a no-op, so the call is
// idempotent no matter how many files make it.
//
// Call this at module scope beside silenceFirebaseWarnings() in any smoke
// file that can construct a provider service — directly, through the
// façade, or through a routed component that reaches one.
import { environment } from '../../../../environments/environment';

export function stripProviderKeys(): void {
  delete (environment as { geminiApiKey?: string }).geminiApiKey;
}
