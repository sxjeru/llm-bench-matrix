import { describe, expect, test } from "vitest";
import {
  buildSourceLookupCandidates,
  getSourceKey,
  getSourceLabel,
  isAaSecondaryCategory,
  isArtificialAnalysisSource,
  normalizeNameParenthesisSpacing,
  normalizeTextImportSource,
  sourceTabDisplayLabel,
  SOURCE_EMPTY
} from "@/lib/source-utils";

describe("source-utils", () => {
  describe("getSourceKey & getSourceLabel & sourceTabDisplayLabel", () => {
    test("handles empty source", () => {
      expect(getSourceKey(null)).toBe(SOURCE_EMPTY);
      expect(getSourceKey(undefined)).toBe(SOURCE_EMPTY);
      expect(getSourceKey("")).toBe(SOURCE_EMPTY);
      expect(getSourceKey("   ")).toBe(SOURCE_EMPTY);
      expect(getSourceLabel(SOURCE_EMPTY)).toBe("未标注");
      expect(sourceTabDisplayLabel(SOURCE_EMPTY)).toBe("未标注");
    });

    test("handles normal source", () => {
      expect(getSourceKey("text:Artificial Analysis")).toBe("text:Artificial Analysis");
      expect(getSourceLabel("text:Artificial Analysis")).toBe("text:Artificial Analysis");
      expect(sourceTabDisplayLabel("text:Artificial Analysis")).toBe("Artificial Analysis");
      expect(sourceTabDisplayLabel("Artificial Analysis")).toBe("Artificial Analysis");
      expect(sourceTabDisplayLabel("prefix:")).toBe("prefix:");
    });
  });

  describe("isArtificialAnalysisSource", () => {
    test("identifies Artificial Analysis source correctly", () => {
      expect(isArtificialAnalysisSource(null)).toBe(false);
      expect(isArtificialAnalysisSource(undefined)).toBe(false);
      expect(isArtificialAnalysisSource("text:S1")).toBe(false);
      expect(isArtificialAnalysisSource("text:Artificial Analysis")).toBe(true);
      expect(isArtificialAnalysisSource("Artificial Analysis")).toBe(true);
      expect(isArtificialAnalysisSource("text:artificial analysis")).toBe(true);
      expect(isArtificialAnalysisSource("vision:Artificial Analysis")).toBe(true);
    });
  });

  describe("isAaSecondaryCategory", () => {
    test("detects cost and performance categories", () => {
      expect(isAaSecondaryCategory("Cost")).toBe(true);
      expect(isAaSecondaryCategory("Performance")).toBe(true);
      expect(isAaSecondaryCategory("cost / pricing")).toBe(true);
      expect(isAaSecondaryCategory("Coding / Performance")).toBe(true);
      expect(isAaSecondaryCategory("Coding")).toBe(false);
      expect(isAaSecondaryCategory("Overall")).toBe(false);
      expect(isAaSecondaryCategory("Reasoning")).toBe(false);
    });
  });

  describe("normalizeNameParenthesisSpacing", () => {
    test("handles empty and whitespace-only strings", () => {
      expect(normalizeNameParenthesisSpacing("")).toBe("");
      expect(normalizeNameParenthesisSpacing("   ")).toBe("");
    });

    test("formats parenthesis spacing and normalizes hyphen variants", () => {
      expect(normalizeNameParenthesisSpacing("Model(v2)")).toBe("Model (v2)");
      expect(normalizeNameParenthesisSpacing("Model（v2）")).toBe("Model （v2）");
      expect(normalizeNameParenthesisSpacing("Model  (v2) ")).toBe("Model (v2)");
      expect(normalizeNameParenthesisSpacing("Model—A(test)")).toBe("Model-A (test)");
    });
  });

  describe("normalizeTextImportSource & buildSourceLookupCandidates", () => {
    test("normalizeTextImportSource prefixes plain text with text: and preserves existing text: prefix", () => {
      expect(normalizeTextImportSource(null)).toBeNull();
      expect(normalizeTextImportSource("")).toBeNull();
      expect(normalizeTextImportSource("Artificial Analysis")).toBe("text:Artificial Analysis");
      expect(normalizeTextImportSource("text:Artificial Analysis")).toBe("text:Artificial Analysis");
    });

    test("buildSourceLookupCandidates returns prefixed, raw, and unprefixed candidates", () => {
      const candidates = buildSourceLookupCandidates("Artificial Analysis");
      expect(candidates).toContain("Artificial Analysis");
      expect(candidates).toContain("text:Artificial Analysis");

      const candidates2 = buildSourceLookupCandidates("text:Artificial Analysis");
      expect(candidates2).toContain("text:Artificial Analysis");
      expect(candidates2).toContain("Artificial Analysis");
    });
  });
});

