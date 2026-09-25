import { unexpectedConsoleErrors } from './firestore-transport-noise';

describe('unexpectedConsoleErrors', () => {
  it("leaves out the SDK's lines about reaching the backend, whichever argument carries them", () => {
    const calls = [
      ['[2026-09-26T00:00:00.000Z]  @firebase/firestore:', 'Firestore (12.0.0): Could not reach Cloud Firestore backend. Backend didn\'t respond within 10 seconds.'],
      ['@firebase/firestore:', 'Firestore (12.0.0): Using maximum backoff delay to prevent overloading the backend.'],
      ['Firestore (12.0.0): Connection', 'WebChannel transport errored: RESOURCE_EXHAUSTED']
    ];

    expect(unexpectedConsoleErrors(calls)).toEqual([]);
  });

  it('keeps every other line, as strings, so a failure names itself', () => {
    const fault = new Error('NG0205: Injector has already been destroyed.');
    const calls = [
      ['ERROR', fault],
      ['@firebase/firestore:', 'Firestore (12.0.0): Uncaught Error in snapshot listener: FirebaseError: [code=permission-denied]']
    ];

    expect(unexpectedConsoleErrors(calls)).toEqual([
      ['ERROR', 'Error: NG0205: Injector has already been destroyed.'],
      ['@firebase/firestore:', 'Firestore (12.0.0): Uncaught Error in snapshot listener: FirebaseError: [code=permission-denied]']
    ]);
  });
});
