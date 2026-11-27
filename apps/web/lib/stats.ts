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
