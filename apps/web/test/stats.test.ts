import { describe, expect, it } from "vitest";
import { ci95HalfWidth, percentile } from "../lib/stats";

describe("ci95HalfWidth", () => {
  it("is null with fewer than two samples", () => {
    expect(ci95HalfWidth([])).toBeNull();
    expect(ci95HalfWidth([7])).toBeNull();
  });
  it("is zero when every score is the same", () => {
    expect(ci95HalfWidth([8, 8, 8])).toBe(0);
  });
  it("matches 1.96 × sd / √n", () => {
    // sd of [6, 8, 10] is 2 (sample), n = 3
    expect(ci95HalfWidth([6, 8, 10])).toBeCloseTo((1.96 * 2) / Math.sqrt(3), 10);
  });
  it("narrows as the sample grows", () => {
    const small = ci95HalfWidth([6, 10, 6, 10])!;
    const large = ci95HalfWidth(Array.from({ length: 40 }, (_, i) => (i % 2 ? 10 : 6)))!;
    expect(large).toBeLessThan(small);
  });
});

describe("percentile", () => {
  it("uses nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([], 50)).toBeNull();
  });
});
