import { EnvironmentInjector, InjectionToken, inject, runInInjectionContext } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import type {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from '@angular/fire/functions';
import type { HouseholdInviteMail } from '../../models';

/**
 * Where inviteToHousehold is deployed (functions/src/index.ts sets it for
 * every function). getFunctions() defaults to us-central1, where nothing
 * answers: the 404 comes back as functions/not-found, which reads like "no
 * account uses that address".
 */
export const HOUSEHOLD_FUNCTIONS_REGION = 'asia-east1';

export const HOUSEHOLD_INVITE_FUNCTION = 'inviteToHousehold';

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

/** Where a local Functions emulator listens. */
export interface FunctionsEmulatorHost {
  host: string;
  port: number;
}

/** The three Functions SDK calls the seam makes. */
export interface FunctionsSdk {
  getFunctions: typeof getFunctions;
  httpsCallable: typeof httpsCallable;
  connectFunctionsEmulator: typeof connectFunctionsEmulator;
}

export interface HouseholdInviteCallableOptions {
  /** The Functions emulator to call instead of the deployed function; none by default. */
  emulator?: FunctionsEmulatorHost | null;
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
 * How HouseholdService sends an invite. A token so a spec or a smoke suite
 * can stand in for the deployed function without the Functions SDK.
 */
export const HOUSEHOLD_INVITE_CALLABLE = new InjectionToken<HouseholdInviteCallable>(
  'HOUSEHOLD_INVITE_CALLABLE',
  {
    providedIn: 'root',
    factory: () => createHouseholdInviteCallable(inject(EnvironmentInjector))
  }
);
