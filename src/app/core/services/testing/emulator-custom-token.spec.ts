import { emulatorCustomToken } from './emulator-custom-token';

describe('emulatorCustomToken', () => {
  // A JWT segment is base64url without padding. Reversed here by hand, so the
  // check does not lean on the encoder it is checking.
  const decode = (segment: string): Record<string, unknown> => {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as Record<
      string,
      unknown
    >;
  };

  it('names the uid in an unsigned JWT the auth emulator accepts', () => {
    // Runs of '>' and '?' encode to '+' and '/' in plain base64 whatever their
    // offset, and the header's own length leaves padding behind, so a token
    // built with btoa alone fails the last check.
    const uid = 'rival->>>>>-?????';

    const token = emulatorCustomToken(uid);
    const segments = token.split('.');

    expect(segments.length).toBe(3);
    const [header, payload, signature] = segments;
    expect(decode(header)).toEqual({ alg: 'none', typ: 'JWT' });
    const claims = decode(payload);
    expect(claims['uid']).toBe(uid);
    expect(claims['aud']).toBe(
      'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'
    );
    expect(claims['exp'] as number).toBeGreaterThan(claims['iat'] as number);
    expect(signature).toBe('');
    for (const segment of segments) {
      expect(segment).toMatch(/^[A-Za-z0-9_-]*$/);
    }
  });
});
