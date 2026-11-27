/**
 * Exponential backoff with "full jitter":
 *   delay = random(0, min(cap, base * 2^(attempt - 1)))
 *
 * Randomising the whole delay (not just adding a little noise) spreads
 * retries from many clients evenly, so they do not all hit the provider
 * again at the same instant after a shared 429.
 * See https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export function fullJitterDelay(
  attempt: number,
  { baseMs = 500, capMs = 20_000, random = Math.random }: { baseMs?: number; capMs?: number; random?: () => number } = {},
): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

/**
 * When the server tells us how long to wait (Retry-After), wait at least that
 * long, plus a small random spread so waiting clients do not stampede.
 */
export function delayHonoringRetryAfter(
  attempt: number,
  retryAfterMs: number | undefined,
  opts?: Parameters<typeof fullJitterDelay>[1],
): number {
  const jittered = fullJitterDelay(attempt, opts);
  if (retryAfterMs === undefined) return jittered;
  const spread = Math.floor((opts?.random ?? Math.random)() * Math.min(1_000, retryAfterMs * 0.2 + 100));
  return Math.max(retryAfterMs + spread, jittered);
}

/** setTimeout as a promise that rejects early if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
