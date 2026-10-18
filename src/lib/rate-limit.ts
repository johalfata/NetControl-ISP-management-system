/**
 * Pembatas laju sederhana berbasis memori proses.
 *
 * Catatan operasional: bila aplikasi dijalankan pada lebih dari satu instance,
 * batas ini berlaku per instance. Untuk deployment multi-instance, gunakan
 * pembatas berbasis penyimpanan bersama (Redis) — lihat README bagian keamanan.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

/** Catat satu percobaan untuk `key`; kembalikan apakah masih diizinkan. */
export function consumeRateLimit(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: limit - bucket.count, retryAfterSec: 0 };
}

/** Bersihkan bucket untuk key tertentu (mis. setelah login sukses). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

export function rateLimitKeyForIp(scope: string, ip: string | null): string {
  return `${scope}:ip:${ip ?? "unknown"}`;
}

export function rateLimitKeyForIdentity(scope: string, identity: string): string {
  return `${scope}:id:${identity.trim().toLowerCase()}`;
}