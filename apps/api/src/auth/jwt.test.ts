import { describe, it, expect } from 'vitest';
import { createAccessTokenService } from './jwt';

const SECRET = 'a-test-secret-that-is-at-least-32-bytes-long!!';
const claims = { userId: '11111111-1111-1111-1111-111111111111', orgId: '22222222-2222-2222-2222-222222222222' };

describe('AccessTokenService', () => {
  it('round-trips claims', async () => {
    const svc = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
    const token = await svc.sign(claims);
    expect(token.split('.')).toHaveLength(3); // JWS compact
    expect(await svc.verify(token)).toEqual(claims);
  });

  it('rejects a token signed with a different secret', async () => {
    const a = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
    const b = createAccessTokenService({ secret: 'a-totally-different-secret-32-bytes-xx', ttlSeconds: 900 });
    const token = await a.sign(claims);
    expect(await b.verify(token)).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const svc = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
    const token = await svc.sign(claims);
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect(await svc.verify(tampered)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const svc = createAccessTokenService({ secret: SECRET, ttlSeconds: -1 }); // already expired
    const token = await svc.sign(claims);
    expect(await svc.verify(token)).toBeNull();
  });

  it('rejects garbage', async () => {
    const svc = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
    expect(await svc.verify('not-a-jwt')).toBeNull();
    expect(await svc.verify('')).toBeNull();
  });
});
