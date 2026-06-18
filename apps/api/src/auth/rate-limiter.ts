/**
 * Minimal rate limiter port. `consume(key)` returns `true` if the action is allowed (and
 * counts it) or `false` if the key is over its limit for the current window. Used by the
 * resend endpoint to cap per-email attempts (spec 04) without ever leaking account state.
 */
export interface RateLimiter {
  consume(key: string): boolean;
}

export interface RateLimiterOptions {
  /** Max allowed actions per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Clock injection for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * In-memory fixed-window rate limiter. Per-process state — correct for the single-instance
 * v1; a shared/distributed store (Redis) is deferred to deploy hardening (spec 16). When a
 * key's window elapses, its counter resets on the next `consume`.
 */
export function createInMemoryRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? ((): number => Date.now());
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    consume(key: string): boolean {
      const t = now();
      const bucket = buckets.get(key);
      if (!bucket || t >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return true;
      }
      if (bucket.count >= limit) {
        return false;
      }
      bucket.count += 1;
      return true;
    },
  };
}
