/** Fixed-window in-memory rate limiter. Good enough for a single-instance deployment. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  hit(key: string): { ok: boolean; retryAfterSec: number } {
    const now = Date.now();
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    }
    const e = this.hits.get(key);
    if (!e || e.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return { ok: true, retryAfterSec: 0 };
    }
    e.count++;
    if (e.count > this.limit) return { ok: false, retryAfterSec: Math.ceil((e.reset - now) / 1000) };
    return { ok: true, retryAfterSec: 0 };
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}
