import { describe, expect, test } from "vitest";
import {
  extractModelVariantToken,
  compareModelVariantPriority,
  compareSourceTabKeysByVersion,
  compareModelNameByColumnOrder,
  extractModelTierToken,
  getModelFamilyMatchKey
} from "../benchmark-matrix/model-matching";

describe("model-matching variant sorting", () => {
  test("extractModelVariantToken should extract ultra and super", () => {
    expect(extractModelVariantToken("Nemotron 3 Ultra")).toEqual({
      familyKey: "nemotron 3",
      variant: "ultra"
    });
    expect(extractModelVariantToken("Nemotron 3 Super")).toEqual({
      familyKey: "nemotron 3",
      variant: "super"
    });
    expect(extractModelVariantToken("Nemotron 3 Nano")).toEqual({
      familyKey: "nemotron 3",
      variant: "nano"
    });
  });

  test("compareModelVariantPriority should sort ultra > super > nano", () => {
    // A negative number means left is higher priority and comes first.
    expect(compareModelVariantPriority("ultra", "super")).toBeLessThan(0);
    expect(compareModelVariantPriority("super", "nano")).toBeLessThan(0);
    expect(compareModelVariantPriority("ultra", "nano")).toBeLessThan(0);
  });

  test("compareSourceTabKeysByVersion should sort ultra > super > nano", () => {
    // Nemotron 3 Ultra should come before Nemotron 3 Super
    expect(compareSourceTabKeysByVersion("text:Nemotron 3 Ultra", "text:Nemotron 3 Super")).toBeLessThan(0);
    // Nemotron 3 Super should come before Nemotron 3 Nano
    expect(compareSourceTabKeysByVersion("text:Nemotron 3 Super", "text:Nemotron 3 Nano")).toBeLessThan(0);
  });

  test("comparators should sort same-version xxB models by larger size first", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    expect(compareSourceTabKeysByVersion("text:Ornith-1.0-27B", "text:Ornith-1.0-9B")).toBeLessThan(0);
    expect(compareSourceTabKeysByVersion("text:Ornith-1.0-9B", "text:Ornith-1.0-27B")).toBeGreaterThan(0);
    expect(compareModelNameByColumnOrder("Ornith-1.0-27B", "Ornith-1.0-9B", collator)).toBeLessThan(0);
  });

  test("compareModelNameByColumnOrder should sort ultra > super > nano", () => {
    const collator = new Intl.Collator("en");

    // Nemotron 3 Ultra should come before Nemotron 3 Super
    expect(compareModelNameByColumnOrder("Nemotron 3 Ultra", "Nemotron 3 Super", collator)).toBeLessThan(0);
    // Nemotron 3 Super should come before Nemotron 3 Nano
    expect(compareModelNameByColumnOrder("Nemotron 3 Super", "Nemotron 3 Nano", collator)).toBeLessThan(0);
  });

  test("comparators should keep preview models after the matching stable model", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    expect(compareSourceTabKeysByVersion("text:HY3", "text:HY3 Preview")).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("HY3", "HY3 Preview", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("HY3 Preview", "HY3", collator)).toBeGreaterThan(0);

    const sorted = ["HY2", "HY3 Preview", "HY3"].sort((left, right) => (
      compareModelNameByColumnOrder(left, right, collator)
    ));
    expect(sorted).toEqual(["HY3", "HY3 Preview", "HY2"]);
  });

  test("compareModelNameByColumnOrder should sort Claude tier models by version before tier", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    // Version is primary, so Claude Sonnet 5 should come before Claude Opus 4.8.
    expect(compareModelNameByColumnOrder("Claude Sonnet 5", "Claude Opus 4.8", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Opus 4.8", "Claude Sonnet 5", collator)).toBeGreaterThan(0);

    // Within the same version, tier priority is mythos > fable > opus > sonnet > haiku.
    expect(compareModelNameByColumnOrder("Claude Mythos 5", "Claude Fable 5", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Fable 5", "Claude Opus 5", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Opus 5", "Claude Sonnet 5", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Sonnet 5", "Claude Haiku 5", collator)).toBeLessThan(0);

    // Versioned tier models should sort before preview names without an explicit version.
    expect(compareModelNameByColumnOrder("Claude Fable 5", "Claude Mythos Preview", collator)).toBeLessThan(0);

    // Alternate Claude name order should still be grouped under the same tier family.
    expect(extractModelTierToken("Claude 5 Sonnet")).toEqual({
      familyKey: "claude",
      tier: "sonnet"
    });

    expect(compareModelNameByColumnOrder("Claude Fable 5", "Claude Opus 4.8", collator)).toBeLessThan(0);

    // And they should be grouped together under the same family check.
    expect(getModelFamilyMatchKey("Claude Mythos 5")).toBe("claude");
    expect(getModelFamilyMatchKey("Claude Mythos Preview")).toBe("claude");
    expect(getModelFamilyMatchKey("Claude Fable 5")).toBe("claude");
    expect(getModelFamilyMatchKey("Claude Opus 4.8")).toBe("claude");
    expect(getModelFamilyMatchKey("Claude 5 Sonnet")).toBe("claude");

    // Claude Mythos Preview should be after mythos and fable, but before others
    expect(compareModelNameByColumnOrder("Claude Mythos 5", "Claude Mythos Preview", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Fable 5", "Claude Mythos Preview", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Mythos Preview", "Claude Opus 5", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Mythos Preview", "Claude Sonnet 5", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Mythos Preview", "Claude Haiku 5", collator)).toBeLessThan(0);

    // Unversioned checks
    expect(compareModelNameByColumnOrder("Claude Mythos", "Claude Mythos Preview", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Fable", "Claude Mythos Preview", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Mythos Preview", "Claude Opus", collator)).toBeLessThan(0);
  });

  test("compareModelNameByColumnOrder should sort GPT variants by sol ultra > pro > sol > terra > luna", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    // Relative order: GPT-4-sol-ultra > GPT-4-pro > GPT-4-sol > GPT-4-terra > GPT-4-luna
    expect(compareModelNameByColumnOrder("GPT-4-sol-ultra", "GPT-4-pro", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("GPT-4-pro", "GPT-4-sol", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("GPT-4-sol", "GPT-4-terra", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("GPT-4-terra", "GPT-4-luna", collator)).toBeLessThan(0);
    
    // Greater than base check
    expect(compareModelNameByColumnOrder("GPT-4-luna", "GPT-4", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("GPT-4-terra", "GPT-4", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("GPT-4-sol", "GPT-4", collator)).toBeLessThan(0);

    // Also with spaces
    expect(compareModelNameByColumnOrder("GPT-4 sol ultra", "GPT-4 pro", collator)).toBeLessThan(0);

    // Also compareSourceTabKeysByVersion
    expect(compareSourceTabKeysByVersion("text:GPT-4-sol-ultra", "text:GPT-4-pro")).toBeLessThan(0);
    expect(compareSourceTabKeysByVersion("text:GPT-4-pro", "text:GPT-4-sol")).toBeLessThan(0);
    expect(compareSourceTabKeysByVersion("text:GPT-4-sol", "text:GPT-4-terra")).toBeLessThan(0);
    expect(compareSourceTabKeysByVersion("text:GPT-4-terra", "text:GPT-4-luna")).toBeLessThan(0);
    expect(compareSourceTabKeysByVersion("text:GPT-4-luna", "text:GPT-4")).toBeLessThan(0);
  });

  test("Muse Spark models should be grouped in the same family and sorted with 1.1 before base/thinking", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    // Grouping checks
    expect(getModelFamilyMatchKey("Muse Spark Thinking")).toBe("musespark");
    expect(getModelFamilyMatchKey("Muse Spark 1.1")).toBe("musespark");
    expect(getModelFamilyMatchKey("Muse Spark")).toBe("musespark");

    // Sorting checks: Muse Spark 1.1 should come before Muse Spark / Muse Spark Thinking
    expect(compareModelNameByColumnOrder("Muse Spark 1.1", "Muse Spark Thinking", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Muse Spark 1.1", "Muse Spark", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Muse Spark Thinking", "Muse Spark", collator)).toBeLessThan(0);

    // Source tabs should also put versioned Muse Spark ahead of the unversioned base name.
    expect(compareSourceTabKeysByVersion("text:Muse Spark 1.1", "text:Muse Spark")).toBeLessThan(0);
    expect(compareSourceTabKeysByVersion("text:Muse Spark", "text:Muse Spark 1.1")).toBeGreaterThan(0);
    expect(
      ["text:Muse Spark", "text:Muse Spark Thinking", "text:Muse Spark 1.1"].sort(compareSourceTabKeysByVersion)
    ).toEqual(["text:Muse Spark 1.1", "text:Muse Spark", "text:Muse Spark Thinking"]);
  });
});

