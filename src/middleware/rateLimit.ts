import type { MiddlewareHandler } from "hono";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Fixed window length in ms (default 60 000). */
  windowMs?: number;
  /** Requests allowed per window per key (default 30). */
  max?: number;
}

/**
 * Fixed-window rate limiter keyed by Authorization header (falling back to
 * client address). Protects the chat pipeline from cost/DoS abuse before
 * any embedding or LLM work happens.
 */
export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 30;
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const now = Date.now();
    const key = c.req.header("authorization") ?? c.req.header("x-forwarded-for") ?? "anonymous";

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    // Opportunistic cleanup so long-lived processes don't grow unbounded.
    if (buckets.size > 1_000) {
      for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k);
      }
    }

    if (bucket.count > max) {
      c.header("retry-after", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    await next();
  };
}
