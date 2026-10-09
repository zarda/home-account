import { opaqueRowId, toHex } from './opaque-id.utils';

describe('opaque-id.utils', () => {
  // A Firestore-style rule id (20 characters) and a 13-digit millisecond stamp:
  // the two inputs a recurring posting id used to spell out.
  const ruleId = 'q7Lx2mPaVn9RtB4cKd1Z';
  const ms = 1_760_000_000_123;

  it('encodes bytes as zero-padded lower-case hex', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 171, 255]))).toBe('00010f10abff');
  });

  it('is deterministic', async () => {
    const first = await opaqueRowId('rec', ruleId, ms);
    const second = await opaqueRowId('rec', ruleId, ms);

    expect(second).toBe(first);
  });

  it('is 32 lower-case hex characters, with no underscore or slash', async () => {
    const ids = await Promise.all([
      opaqueRowId('rec', ruleId, ms),
      opaqueRowId('rec', ruleId, ms + 86_400_000),
      opaqueRowId('scan', 'a1b2c3d4e5f60718293a4b5c6d7e8f90', 0),
      opaqueRowId('scan', 'a1b2c3d4e5f60718293a4b5c6d7e8f90', 7),
    ]);

    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(id).not.toContain('_');
      expect(id).not.toContain('/');
    }
  });

  it('contains neither an input id nor the millisecond value', async () => {
    const id = await opaqueRowId('rec', ruleId, ms);

    expect(id).not.toContain(ruleId);
    expect(id.includes(String(ms))).toBe(false);
  });

  it('contains no hex-only input id either', async () => {
    // The rule id above is not hex, so it could never appear in a hex output
    // and its check proves little. A hex-only id is the input that could.
    const hexSeed = '0123456789abcdef0123456789abcdef';
    const hexRule = 'deadbeef00112233';

    const [scan, rec] = await Promise.all([
      opaqueRowId('scan', hexSeed, 0),
      opaqueRowId('rec', hexRule, ms),
    ]);

    expect(scan).not.toContain(hexSeed);
    expect(scan).not.toContain(hexSeed.slice(0, 8));
    expect(rec).not.toContain(hexRule);
    expect(rec).not.toContain(hexRule.slice(0, 8));
  });

  it('gives two indexes of one seed no shared 4-character prefix', async () => {
    const seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const ids = await Promise.all(
      [0, 1, 2, 3, 4, 5].map(index => opaqueRowId('scan', seed, index))
    );

    const prefixes = ids.map(id => id.slice(0, 4));
    expect(new Set(prefixes).size).toBe(ids.length);
  });

  it('keeps the two kinds apart for the same parts', async () => {
    const rec = await opaqueRowId('rec', ruleId, ms);
    const scan = await opaqueRowId('scan', ruleId, ms);

    expect(rec).not.toBe(scan);
  });

  it('keeps part boundaries and part types in the preimage', async () => {
    // A separator inside a part must not slide a boundary: ('a:b', 'c') and
    // ('a', 'b:c') are different inputs.
    const [left, right] = await Promise.all([
      opaqueRowId('rec', 'a:b', 'c'),
      opaqueRowId('rec', 'a', 'b:c'),
    ]);
    expect(left).not.toBe(right);

    // The string '5' and the number 5 are different inputs too.
    const [text, num] = await Promise.all([
      opaqueRowId('scan', 'x', '5'),
      opaqueRowId('scan', 'x', 5),
    ]);
    expect(text).not.toBe(num);
  });

  // PIN, not a behaviour check: these exact ids are what persisted rows carry
  // and a retry recomputes. A changed preimage, prefix or cut would silently
  // re-id them, and a retried write would then duplicate the row it had
  // already created. If this fails, the helper changed; do not just update
  // the literals.
  it('pins the exact ids for known inputs', async () => {
    expect(await opaqueRowId('rec', 'rule1', 1)).toBe('c5f49f1c8d24ddb3423ef31980c05ce1');
    expect(await opaqueRowId('scan', '0123456789abcdef0123456789abcdef', 0)).toBe(
      '071013a6631227ed7c099b245af187c8'
    );
  });
});
