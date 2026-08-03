import { describe, expect, test } from "vitest";
import {
  inferModalitiesFromCategory,
  inferTypeFromPreambleLine,
  normalizeModalityList,
  normalizeModalityName
} from "@/lib/modality";

describe("modality helpers", () => {
  test("normalizeModalityName 识别 vision / visual / vlm", () => {
    expect(normalizeModalityName("Vision")).toBe("Vision");
    expect(normalizeModalityName("visual reasoning")).toBe("Vision");
    expect(normalizeModalityName("VLM Arena")).toBe("Vision");
  });

  test("normalizeModalityName 识别 audio / video / multimodal", () => {
    expect(normalizeModalityName("Audio")).toBe("Audio");
    expect(normalizeModalityName("Long Video")).toBe("Video");
    expect(normalizeModalityName("multi-modal")).toBe("Multimodal");
    expect(normalizeModalityName("多模态")).toBe("Multimodal");
  });

  test("normalizeModalityList 空输入与 fallback", () => {
    expect(normalizeModalityList()).toEqual(["Text"]);
    expect(normalizeModalityList([])).toEqual(["Text"]);
    expect(normalizeModalityList(undefined, "Visual QA")).toEqual(["Vision"]);
    expect(normalizeModalityList(["Text", "Vision"])).toEqual(["Vision"]);
    expect(normalizeModalityList(["Vision", "Video"])).toEqual(["Video"]);
  });

  test("inferModalitiesFromCategory / inferTypeFromPreambleLine", () => {
    expect(inferModalitiesFromCategory(null)).toEqual(["Text"]);
    expect(inferModalitiesFromCategory("Visual Reasoning")).toEqual(["Vision"]);
    expect(inferModalitiesFromCategory("STEM")).toEqual(["Text"]);
    expect(inferTypeFromPreambleLine("VLM Arena")).toBe("Vision");
    expect(inferTypeFromPreambleLine("General")).toBeNull();
  });
});
