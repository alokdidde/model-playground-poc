/**
 * Half-width of a 95% confidence interval for a mean (normal approximation:
 * 1.96 × sample standard deviation / √n). Null below 2 samples.
 *
 * Good enough to show how much a leaderboard average can move: with 5
 * judged answers it is wide, with 100 it is narrow. Judge scores are bounded
 * and not normal, so treat it as a guide, not a test.
 */
export function ci95HalfWidth(xs: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  return (1.96 * Math.sqrt(variance)) / Math.sqrt(n);
}

/** Nearest-rank percentile (p in 0-100). Null for no values. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}
