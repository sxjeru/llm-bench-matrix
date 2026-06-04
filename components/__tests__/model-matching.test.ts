import { describe, expect, test } from "vitest";
import {
  extractModelVariantToken,
  compareModelVariantPriority,
  compareSourceTabKeysByVersion,
  compareModelNameByColumnOrder
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
    const collator = new Intl.Collator("en");
    
    // Nemotron 3 Ultra should come before Nemotron 3 Super
    expect(compareSourceTabKeysByVersion("text:Nemotron 3 Ultra", "text:Nemotron 3 Super")).toBeLessThan(0);
    // Nemotron 3 Super should come before Nemotron 3 Nano
    expect(compareSourceTabKeysByVersion("text:Nemotron 3 Super", "text:Nemotron 3 Nano")).toBeLessThan(0);
  });

  test("compareModelNameByColumnOrder should sort ultra > super > nano", () => {
    const collator = new Intl.Collator("en");

    // Nemotron 3 Ultra should come before Nemotron 3 Super
    expect(compareModelNameByColumnOrder("Nemotron 3 Ultra", "Nemotron 3 Super", collator)).toBeLessThan(0);
    // Nemotron 3 Super should come before Nemotron 3 Nano
    expect(compareModelNameByColumnOrder("Nemotron 3 Super", "Nemotron 3 Nano", collator)).toBeLessThan(0);
  });
});
