// In-memory login rate limiter.
//
// Strategy: a sliding 60-second window allows MAX_ATTEMPTS bad attempts per
// `email:ip` key.  Once exceeded the key is locked out for an increasing
// duration (1m → 2m → 4m → 8m → 15m, capped).  A successful login clears
// the bucket via `recordSuccessfulLogin`.
//
// LIMITATIONS:
//   - Per-process Map; lost on server restart and not shared across
//     instances.  Acceptable for dev / single-pod prod.
//   - TODO: swap to Upstash Redis (`@upstash/ratelimit` + `@upstash/redis`)
//     once UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are provisioned.

type Bucket = {
  count: number;
  windowStart: number;
  lockUntil: number;
  consecutiveLockouts: number;
};

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
// 1m, 2m, 4m, 8m, 15m
const LOCKOUT_DURATIONS_MS = [60_000, 120_000, 240_000, 480_000, 900_000];

// Periodic GC so a long-lived process doesn't leak memory.
const GC_INTERVAL_MS = 5 * 60_000;
let gcTimer: NodeJS.Timeout | null = null;
function ensureGc() {
  if (gcTimer || typeof setInterval === "undefined") return;
  gcTimer = setInterval(() => {
    const now = Date.now();
    // Map iteration via forEach to avoid TS downlevelIteration requirement
    buckets.forEach((b, k) => {
      if (b.lockUntil < now && now - b.windowStart > WINDOW_MS * 10) {
        buckets.delete(k);
      }
    });
  }, GC_INTERVAL_MS);
  // Don't keep the process alive just for GC.
  (gcTimer as any).unref?.();
}

export async function checkLoginRate(
  key: string
): Promise<{ ok: boolean; retryAfter?: number }> {
  ensureGc();
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { count: 0, windowStart: now, lockUntil: 0, consecutiveLockouts: 0 };
    buckets.set(key, b);
  }

  // Currently locked out?
  if (b.lockUntil > now) {
    return { ok: false, retryAfter: Math.ceil((b.lockUntil - now) / 1000) };
  }

  // Reset the window if it has elapsed.
  if (now - b.windowStart >= WINDOW_MS) {
    b.windowStart = now;
    b.count = 0;
  }

  // Already used up the budget in this window: lock out.
  if (b.count >= MAX_ATTEMPTS) {
    const idx = Math.min(b.consecutiveLockouts, LOCKOUT_DURATIONS_MS.length - 1);
    const lockoutMs = LOCKOUT_DURATIONS_MS[idx];
    b.lockUntil = now + lockoutMs;
    b.consecutiveLockouts++;
    b.count = 0;
    b.windowStart = now;
    return { ok: false, retryAfter: Math.ceil(lockoutMs / 1000) };
  }

  b.count++;
  return { ok: true };
}

/** Call after a successful login to forgive the key. */
export function recordSuccessfulLogin(key: string) {
  buckets.delete(key);
}

/** Helper to derive a stable key from a request. */
export function loginRateKey(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}:${ip || "unknown"}`;
}
