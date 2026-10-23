import { describe, expect, it } from "vitest";
import { scoreAverage } from "./labels.ts";

describe("scoreAverage", () => {
  it("averages only scored dimensions and never invents a score", () => {
    expect(scoreAverage({})).toBeNull();
    expect(scoreAverage({ audience_relevance: 5, ease: 3 })).toBe(4);
    expect(scoreAverage({ audience_relevance: 9 })).toBeNull();
  });
});
