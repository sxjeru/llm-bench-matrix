import { MULTIMODAL_HINT_PATTERN } from "../constants";

export function normalizeModalityName(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return "Text";
  if (normalized.includes("vision") || normalized.includes("visual") || normalized.includes("vlm")) return "Vision";
  if (normalized.includes("audio")) return "Audio";
  if (normalized.includes("video")) return "Video";
  if (MULTIMODAL_HINT_PATTERN.test(normalized)) return "Multimodal";
  return "Text";
}

export function normalizeModalityList(input: string[] | undefined): string[] {
  if (!input || input.length === 0) return ["Text"];

  const normalized = input
    .map((item) => normalizeModalityName(item))
    .filter(Boolean);

  const unique = normalized.length > 0 ? Array.from(new Set(normalized)) : ["Text"];
  const withoutText = unique.some((item) => item !== "Text")
    ? unique.filter((item) => item !== "Text")
    : unique;

  const withoutVision = withoutText.includes("Video")
    ? withoutText.filter((item) => item !== "Vision")
    : withoutText;

  if (withoutVision.length === 0) {
    return ["Text"];
  }

  return withoutVision;
}
