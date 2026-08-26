/**
 * A small in-memory rate limiter for public endpoints. Pure logic with the
 * clock injected, so it is testable like the rest of lib/; the process-wide
 * instances live in the route modules that use them.
 *
 * Honest limits of the approach, accepted on purpose: state is per process,
 * so a dev-server reload or a redeploy forgets everything, and a second
 * instance would not share counts. One Railway instance, demo traffic; a
 * shared store is the upgrade seam if that ever changes.
 */

export type RateLimiterConfig = {
  /** Sliding-window length for the request count. */
  windowMs: number;
  /** Requests allowed per key per window. */
  maxPerWindow: number;
  /** Consecutive failures (bad codes) before the key is cooled down. */
  failStreakLimit: number;
  /** Cooldown length once the streak limit is hit. */
  cooldownMs: number;
};

type Bucket = {
  windowStart: number;
  count: number;
  failStreak: number;
  cooldownUntil: number;
  lastSeen: number;
};

export type RateCheck = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Keys idle this long are swept whenever the map grows past PRUNE_AT. */
const IDLE_MS = 60 * 60 * 1000;
const PRUNE_AT = 5000;

export function createRateLimiter(config: RateLimiterConfig) {
  const buckets = new Map<string, Bucket>();

  function bucketFor(key: string, now: number): Bucket {
    let b = buckets.get(key);
    if (!b) {
      if (buckets.size >= PRUNE_AT) {
        for (const [k, old] of buckets) {
          if (now - old.lastSeen > IDLE_MS) buckets.delete(k);
        }
      }
      b = { windowStart: now, count: 0, failStreak: 0, cooldownUntil: 0, lastSeen: now };
      buckets.set(key, b);
    }
    b.lastSeen = now;
    return b;
  }

  return {
    /** Counts the request and answers whether it may proceed. */
    check(key: string, now: number): RateCheck {
      const b = bucketFor(key, now);
      if (now < b.cooldownUntil) {
        return { allowed: false, retryAfterSeconds: Math.ceil((b.cooldownUntil - now) / 1000) };
      }
      if (now - b.windowStart >= config.windowMs) {
        b.windowStart = now;
        b.count = 0;
      }
      b.count += 1;
      if (b.count > config.maxPerWindow) {
        const retryMs = b.windowStart + config.windowMs - now;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
      }
      return { allowed: true };
    },

    /** A refused code. Enough of these in a row starts the cooldown. */
    recordFailure(key: string, now: number): void {
      const b = bucketFor(key, now);
      b.failStreak += 1;
      if (b.failStreak >= config.failStreakLimit) {
        b.cooldownUntil = now + config.cooldownMs;
        b.failStreak = 0;
      }
    },

    /** A valid code resets the streak: a guest mistyping is not an attacker. */
    recordSuccess(key: string, now: number): void {
      bucketFor(key, now).failStreak = 0;
    },
  };
}
