import {
  AI_ANSWER_INCOMPLETE,
  AI_CLOUD_UNAVAILABLE,
  AI_NO_PROVIDER,
  AI_QUEUED_OFFLINE,
  ReceiptProcessingError,
  parseAIError,
} from './ai-error.utils';

/**
 * Pure classification of a provider or pipeline failure. Lived on
 * AIImportService until the strategy service needed it too, at which point
 * the only way to call it without a dependency cycle was to make it a util.
 */
describe('parseAIError', () => {
  const cases: { input: string; type: string; retryable: boolean }[] = [
    { input: '429 too many requests', type: 'rate_limit', retryable: true },
    { input: 'RESOURCE_EXHAUSTED', type: 'rate_limit', retryable: true },
    { input: '401 unauthorized', type: 'auth', retryable: false },
    { input: 'API_KEY_INVALID', type: 'auth', retryable: false },
    { input: 'network failure: failed to fetch', type: 'network', retryable: true },
    { input: '402 payment required billing', type: 'quota', retryable: false },
    { input: '503 service unavailable', type: 'server', retryable: true },
    { input: 'request timed out', type: 'timeout', retryable: true },
    { input: 'Request was aborted.', type: 'timeout', retryable: true },
  ];

  cases.forEach(({ input, type, retryable }) => {
    it(`classifies "${input}" as ${type}`, () => {
      const parsed = parseAIError(new Error(input));
      expect(parsed.type).toBe(type as never);
      expect(parsed.retryable).toBe(retryable);
      expect(parsed.message.length).toBeGreaterThan(0);
    });
  });

  it('reads a cancelled request as the timeout that caused it', () => {
    const cancelled = new Error('The operation was cancelled');
    cancelled.name = 'AbortError';
    const parsed = parseAIError(cancelled);
    expect(parsed.type).toBe('timeout');
    expect(parsed.message).toContain('timed out');
  });

  it('hands the no-provider throw to the screen as a key, not as English', () => {
    const parsed = parseAIError(new Error(AI_NO_PROVIDER));
    expect(parsed.type).toBe('auth');
    expect(parsed.retryable).toBeFalse();
    expect(parsed.messageKey).toBe('import.errorNoProvider');
  });

  it('classifies the cloud-unreachable throw as a retryable network condition', () => {
    const parsed = parseAIError(new Error(AI_CLOUD_UNAVAILABLE));
    expect(parsed.type).toBe('network');
    expect(parsed.retryable).toBeTrue();
    expect(parsed.messageKey).toBe('import.errorCloudUnavailable');
  });

  it('classifies a queued-offline throw as a network condition', () => {
    const parsed = parseAIError(new Error(AI_QUEUED_OFFLINE));
    expect(parsed.type).toBe('network');
    expect(parsed.messageKey).toBe('import.errorQueuedOffline');
  });

  it('leaves a provider its own wording, which cannot be translated', () => {
    const parsed = parseAIError(new Error('something weird happened'));
    expect(parsed.messageKey).toBeUndefined();
    expect(parsed.type).toBe('unknown');
    expect(parsed.retryable).toBeTrue();
    expect(parsed.message).toContain('something weird happened');
  });

  it('handles non-Error inputs', () => {
    expect(parseAIError('plain string 429').type).toBe('rate_limit');
  });

  it('classifies an unreadable answer as its own retryable class', () => {
    const parsed = parseAIError(new Error(AI_ANSWER_INCOMPLETE));
    expect(parsed.type).toBe('incomplete');
    expect(parsed.messageKey).toBe('import.errorAnswerIncomplete');
    expect(parsed.retryable).toBeTrue();
  });

  it('never shows the JSON parser its own words', () => {
    // What the bug looked like on the screen, in both engines' wording.
    for (const message of [
      "JSON Parse error: Expected ']'",
      "Expected ',' or ']' after array element in JSON at position 147",
      // A third wording, observed from a real cut-off answer during the QA
      // run: where the break lands decides which sentence the engine picks,
      // which is why this branch tests the error's type and not its words.
      'Unterminated string in JSON at position 1688',
    ]) {
      const parsed = parseAIError(new SyntaxError(message));
      expect(parsed.type).withContext(message).toBe('incomplete');
      expect(parsed.message).withContext(message).not.toContain('JSON');
    }
  });

  it('does not read a character offset as a status code', () => {
    // 'in JSON at position 502' contains 502, and every status test below the
    // ladder's top is a substring test — so this used to be reportable as an
    // outage the service never had.
    const parsed = parseAIError(
      new SyntaxError("Expected ',' or ']' after array element in JSON at position 502")
    );
    expect(parsed.type).toBe('incomplete');
  });

  it('classifies a wrapped parse failure by its cause', () => {
    const wrapped = new ReceiptProcessingError(
      { engine: 'cloud', provider: 'claude', durationMs: 10 },
      new Error(AI_ANSWER_INCOMPLETE)
    );
    expect(parseAIError(wrapped).type).toBe('incomplete');
  });

  it('classifies a ReceiptProcessingError by its cause, name included', () => {
    // The strategy service wraps the provider's throw; the abort name lives
    // on the cause, and unwrapping is what keeps a timeout a timeout.
    const cause = new Error('The operation was cancelled');
    cause.name = 'AbortError';
    const wrapped = new ReceiptProcessingError(
      { engine: 'cloud', provider: 'gemini', durationMs: 10 },
      cause
    );
    expect(wrapped.message).toBe('The operation was cancelled');
    expect(parseAIError(wrapped).type).toBe('timeout');
  });
});
