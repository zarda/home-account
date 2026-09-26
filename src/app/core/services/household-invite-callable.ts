import { EnvironmentInjector, InjectionToken, inject, runInInjectionContext } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import type {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from '@angular/fire/functions';
import type { HouseholdInviteMail } from '../../models';
import { EMULATOR_HOSTS, type EmulatorHosts } from '../../../environments/emulators';

/**
 * Where inviteToHousehold is deployed (functions/src/index.ts sets it for
 * every function). getFunctions() defaults to us-central1, where nothing
 * answers: the 404 comes back as functions/not-found, which reads like "no
 * account uses that address".
 */
export const HOUSEHOLD_FUNCTIONS_REGION = 'asia-east1';

export const HOUSEHOLD_INVITE_FUNCTION = 'inviteToHousehold';

/**
 * How long the callable waits on the mail before it answers:
 * INVITE_MAIL_DEADLINE_MS in functions/src/household-invite-handler.ts. The
 * handler imports the Functions runtime, so the client keeps a copy; the
 * functions test household-client-mirrors.test.ts fails when the two differ.
 */
export const INVITE_MAIL_DEADLINE_MS = 10_000;

export interface HouseholdInviteRequest {
  householdId: string;
  email: string;
  /** The inviter's app language; the mail is written in it. */
  locale: string;
}

/** All the callable returns: never the invitee's name. */
export interface HouseholdInviteResponse {
  inviteId: string;
  mail: HouseholdInviteMail;
}

export type HouseholdInviteCallable = (request: HouseholdInviteRequest) => Promise<HouseholdInviteResponse>;

/** The three Functions SDK calls the seam makes. */
export interface FunctionsSdk {
  getFunctions: typeof getFunctions;
  httpsCallable: typeof httpsCallable;
  connectFunctionsEmulator: typeof connectFunctionsEmulator;
}

export interface HouseholdInviteCallableOptions {
  /** The Functions emulator to call instead of the deployed function; none by default. */
  emulator?: EmulatorHosts['functions'] | null;
  /** Loads the Functions SDK. */
  loadSdk?: () => Promise<FunctionsSdk>;
}

// A dynamic import: the Functions SDK is needed only by an owner sending an
// invite, so it stays out of the initial bundle.
const loadFunctionsSdk = (): Promise<FunctionsSdk> => import('@angular/fire/functions');

/**
 * The invite callable, built on its first use. Nothing is loaded or resolved
 * at construction: the Firebase app, the SDK and the Functions instance are
 * all first touched by an invite, inside the captured injector's context,
 * which the @angular/fire wrappers need to run without warning.
 *
 * A failed load is not kept, so the next invite loads again: a chunk that
 * failed to fetch offline must not break invites for the rest of the session.
 */
export function createHouseholdInviteCallable(
  injector: EnvironmentInjector,
  options: HouseholdInviteCallableOptions = {}
): HouseholdInviteCallable {
  const emulator = options.emulator ?? null;
  const loadSdk = options.loadSdk ?? loadFunctionsSdk;
  type Call = (request: HouseholdInviteRequest) => Promise<{ data: HouseholdInviteResponse }>;
  let callable: Promise<Call> | null = null;

  const build = async (): Promise<Call> => {
    const app = runInInjectionContext(injector, () => inject(FirebaseApp));
    const sdk = await loadSdk();
    return runInInjectionContext(injector, () => {
      const functions = sdk.getFunctions(app, HOUSEHOLD_FUNCTIONS_REGION);
      if (emulator) {
        sdk.connectFunctionsEmulator(functions, emulator.host, emulator.port);
      }
      return sdk.httpsCallable<HouseholdInviteRequest, HouseholdInviteResponse>(
        functions,
        HOUSEHOLD_INVITE_FUNCTION
      );
    });
  };

  return async request => {
    callable ??= build().catch(error => {
      callable = null;
      throw error;
    });
    const call = await callable;
    const result = await runInInjectionContext(injector, () => call(request));
    return result.data;
  };
}

/**
 * The token's own factory: the deployed function, or the Functions emulator
 * the `emulators` build names. Runs in an injection context. The hosts and the
 * loader are parameters for the spec; the unit build compiles the committed,
 * null hosts.
 */
export function householdInviteCallableFactory(
  hosts: EmulatorHosts | null = EMULATOR_HOSTS,
  loadSdk?: () => Promise<FunctionsSdk>,
  injector: EnvironmentInjector = inject(EnvironmentInjector)
): HouseholdInviteCallable {
  return createHouseholdInviteCallable(injector, { emulator: hosts?.functions ?? null, loadSdk });
}

/**
 * How HouseholdService sends an invite. A token so a spec or a smoke suite
 * can stand in for the deployed function without the Functions SDK.
 */
export const HOUSEHOLD_INVITE_CALLABLE = new InjectionToken<HouseholdInviteCallable>(
  'HOUSEHOLD_INVITE_CALLABLE',
  {
    providedIn: 'root',
    factory: () => householdInviteCallableFactory()
  }
);
