import { describe, it, expect } from 'vitest';
import { createInMemoryRateLimiter } from './rate-limiter';

describe('createInMemoryRateLimiter', () => {
  it('allows up to the limit, then blocks within the same window', () => {
    const t = 1000;
    const limiter = createInMemoryRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect(limiter.consume('a@x.com')).toBe(true);
    expect(limiter.consume('a@x.com')).toBe(true);
    expect(limiter.consume('a@x.com')).toBe(true);
    expect(limiter.consume('a@x.com')).toBe(false); // 4th in-window -> blocked
  });

  it('tracks keys independently', () => {
    const t = 0;
    const limiter = createInMemoryRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(limiter.consume('a@x.com')).toBe(true);
    expect(limiter.consume('a@x.com')).toBe(false);
    expect(limiter.consume('b@x.com')).toBe(true); // different key, own bucket
  });

  it('resets after the window elapses', () => {
    let t = 0;
    const limiter = createInMemoryRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(limiter.consume('a@x.com')).toBe(true);
    expect(limiter.consume('a@x.com')).toBe(false);
    t = 1000; // window elapsed
    expect(limiter.consume('a@x.com')).toBe(true);
  });
});
