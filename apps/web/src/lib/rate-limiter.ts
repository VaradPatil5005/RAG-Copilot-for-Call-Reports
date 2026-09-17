interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

// Periodic cleanup of expired rate limit keys every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore.entries()) {
      if (now > entry.resetAt) {
        memoryStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Institutional sliding-window rate limiter for sensitive endpoints.
 * @param identifier Unique key e.g. `ip:127.0.0.1:signup` or `phone:+91987...:otp`
 * @param limit Maximum allowed requests within the window
 * @param windowSeconds Window duration in seconds
 */
export function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(identifier);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowSeconds * 1000;
    memoryStore.set(identifier, { count: 1, resetAt });
    return {
      success: true,
      remaining: limit - 1,
      resetInSeconds: windowSeconds,
    };
  }

  if (entry.count >= limit) {
    const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);
    return {
      success: false,
      remaining: 0,
      resetInSeconds: Math.max(resetInSeconds, 1),
    };
  }

  entry.count += 1;
  const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);
  return {
    success: true,
    remaining: limit - entry.count,
    resetInSeconds,
  };
}
