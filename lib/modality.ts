export const MODALITY_OPTIONS = ["Text", "Vision", "Audio", "Video", "Multimodal"] as const;
export type ModalityName = (typeof MODALITY_OPTIONS)[number];

export const MULTIMODAL_HINT_PATTERN = /(\bmultimodal(?:ity)?\b|\bmulti[\s-_]?modal(?:ity)?\b|多模态)/i;

/** 论文表头中可当作模态提示/噪声过滤的 token */
export const PAPER_MODALITY_HINT_TOKENS = new Set([
  "text",
  "vision",
  "visual",
  "vlm",
  "audio",
  "video",
  "multimodal",
  "multimodality",
  "multi",
  "modal",
  "视觉",
  "语音",
  "音频",
  "视频",
  "多模态",
  "文本"
]);

export function isMultimodalHint(input: string): boolean {
  return MULTIMODAL_HINT_PATTERN.test(input);
}

function matchModalityKeyword(normalized: string): Exclude<ModalityName, "Text"> | null {
  if (!normalized) return null;
  if (
    normalized.includes("vision")
    || normalized.includes("visual")
    || normalized.includes("vlm")
  ) {
    return "Vision";
  }
  if (normalized.includes("audio")) return "Audio";
  if (normalized.includes("video")) return "Video";
  if (isMultimodalHint(normalized)) return "Multimodal";
  return null;
}

export function normalizeModalityName(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return "Text";
  return matchModalityKeyword(normalized) ?? "Text";
}

/**
 * 归一化模态列表。
 * - 空输入默认 Text
 * - 若提供 fallbackType 且 input 为空，则用 fallbackType 推断
 * - 存在非 Text 时去掉 Text；存在 Video 时去掉 Vision
 */
export function normalizeModalityList(
  input?: string[] | null,
  fallbackType?: string
): string[] {
  const source = input && input.length > 0
    ? input
    : fallbackType !== undefined
      ? [fallbackType]
      : [];

  if (source.length === 0) return ["Text"];

  const normalized = source
    .map((item) => normalizeModalityName(item))
    .filter(Boolean);

  const unique = normalized.length > 0 ? Array.from(new Set(normalized)) : ["Text"];
  const withoutText = unique.some((item) => item !== "Text")
    ? unique.filter((item) => item !== "Text")
    : unique;

  const withoutVision = withoutText.includes("Video")
    ? withoutText.filter((item) => item !== "Vision")
    : withoutText;

  return withoutVision.length > 0 ? withoutVision : ["Text"];
}

/** 从 benchmark 分类/分组标题推断模态列表 */
export function inferModalitiesFromCategory(category: string | null | undefined): string[] {
  if (!category?.trim()) return ["Text"];
  return normalizeModalityList([category]);
}

/** 从 preamble / 分组标题行推断 type hint；未知则返回 null */
export function inferTypeFromPreambleLine(line: string): string | null {
  const normalized = line.trim().toLowerCase();
  if (!normalized) return null;
  return matchModalityKeyword(normalized);
}
