import {
  Eye,
  Headphones,
  Layers,
  Video
} from "lucide-react";
import type { CompareDirection, MatrixCellEntry, MatrixInputRow } from "./types";
import { SOURCE_EMPTY } from "./constants";
import { blendColor } from "./colors";

export function getModelColumnWidthKey(modelName: string): string {
  return `model:${modelName}`;
}

export function getColumnWidthOverrideKey(sourceKey: string, columnKey: string): string {
  return `${sourceKey}::${columnKey}`;
}

export function clampColumnWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function normalizeColumnWidthBySource(input: unknown): Record<string, Record<string, number>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const normalizedBySource: Record<string, Record<string, number>> = {};

  Object.entries(input as Record<string, unknown>).forEach(([sourceKey, widthMapRaw]) => {
    if (!widthMapRaw || typeof widthMapRaw !== "object" || Array.isArray(widthMapRaw)) return;

    const normalizedMap: Record<string, number> = {};

    Object.entries(widthMapRaw as Record<string, unknown>).forEach(([columnKey, value]) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      normalizedMap[columnKey] = Math.max(1, Math.round(value));
    });

    normalizedBySource[sourceKey] = normalizedMap;
  });

  return normalizedBySource;
}

export function areColumnWidthMapsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) return false;

  for (const [key, value] of leftEntries) {
    if (right[key] !== value) return false;
  }

  return true;
}

export function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export function getSourceKey(source: string | null): string {
  const cleaned = source?.trim();
  return cleaned ? cleaned : SOURCE_EMPTY;
}

export function getSourceLabel(sourceKey: string): string {
  if (sourceKey === SOURCE_EMPTY) {
    return "未标注";
  }
  return sourceKey;
}

export function sourceTabDisplayLabel(sourceKey: string): string {
  const rawLabel = getSourceLabel(sourceKey);
  const colonIndex = rawLabel.indexOf(":");
  if (colonIndex < 0) return rawLabel;

  const stripped = rawLabel.slice(colonIndex + 1).trim();
  return stripped.length > 0 ? stripped : rawLabel;
}

export function normalizeBenchmarkKeyFallback(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeBenchmarkDuplicateToken(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s\-_]+/g, "")
    .replace(/[^a-z0-9().]+/g, "");
}

export function pickPreferredBenchmarkDisplayName(current: string, candidate: string): string {
  const currentTrimmed = current.trim();
  const candidateTrimmed = candidate.trim();
  if (!currentTrimmed) return candidateTrimmed;
  if (!candidateTrimmed) return currentTrimmed;

  const currentHasParentheses = /[（(][^()（）]+[)）]/.test(currentTrimmed);
  const candidateHasParentheses = /[（(][^()（）]+[)）]/.test(candidateTrimmed);

  if (currentHasParentheses !== candidateHasParentheses) {
    return currentHasParentheses ? candidateTrimmed : currentTrimmed;
  }

  return currentTrimmed.length <= candidateTrimmed.length ? currentTrimmed : candidateTrimmed;
}

export function getBenchmarkDuplicateKey(canonicalKey: string | null | undefined, benchmarkName: string): string {
  const normalizedCanonical = canonicalKey?.trim().toLowerCase() ?? "";
  if (normalizedCanonical.length > 0) {
    const splitIndex = normalizedCanonical.indexOf(":");
    if (splitIndex > 0) {
      const token = normalizeBenchmarkDuplicateToken(normalizedCanonical.slice(0, splitIndex));
      if (token.length > 0) return token;
    }
    if (splitIndex < 0) {
      const token = normalizeBenchmarkDuplicateToken(normalizedCanonical);
      if (token.length > 0) return token;
    }
  }

  const fallbackToken = normalizeBenchmarkDuplicateToken(benchmarkName);
  if (fallbackToken.length > 0) {
    return fallbackToken;
  }

  const fallback = normalizeBenchmarkKeyFallback(benchmarkName);
  return fallback.length > 0 ? fallback : benchmarkName.trim().toLowerCase();
}

export function getMatrixGroupingKey(
  row: Pick<MatrixInputRow, "benchmarkType" | "benchmarkName" | "benchmarkCanonicalKey">,
  showDuplicateRows: boolean
): string {
  if (showDuplicateRows) {
    const category = row.benchmarkType || "General";
    return `raw::${category}::${row.benchmarkName}`;
  }

  const duplicateKey = getBenchmarkDuplicateKey(row.benchmarkCanonicalKey, row.benchmarkName);
  return `merged::${duplicateKey}`;
}

export function normalizeModalityName(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return "Text";
  if (normalized.includes("vision") || normalized.includes("vlm")) return "Vision";
  if (normalized.includes("audio")) return "Audio";
  if (normalized.includes("video")) return "Video";
  if (normalized.includes("multimodal") || normalized.includes("multi-modal") || normalized.includes("多模态")) {
    return "Multimodal";
  }
  return "Text";
}

export function normalizeModalityList(input: string[] | undefined, benchmarkType: string): string[] {
  const source = input && input.length > 0 ? input : [benchmarkType];

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

export function renderModalityBadge(modalityInput: string, key: string) {
  const modality = normalizeModalityName(modalityInput);

  if (modality === "Text") {
    return (
      <span key={key} className="inline-flex items-center rounded-md px-1 text-[10px] opacity-70" title="Text">
        T
      </span>
    );
  }

  if (modality === "Vision") {
    return (
      <span key={key} className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-cyan-300" title="Vision">
        <Eye size={11} />
      </span>
    );
  }

  if (modality === "Audio") {
    return (
      <span key={key} className="inline-flex items-center rounded-md bg-purple-500/15 px-1.5 py-0.5 text-purple-300" title="Audio">
        <Headphones size={11} />
      </span>
    );
  }

  if (modality === "Video") {
    return (
      <span key={key} className="inline-flex items-center rounded-md bg-pink-500/15 px-1.5 py-0.5 text-pink-300" title="Video">
        <Video size={11} />
      </span>
    );
  }

  return (
    <span
      key={key}
      className="inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300"
      title="Multimodal"
    >
      <Layers size={11} />
    </span>
  );
}

export function normalizeMatchToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function hasMeaningfulMatrixRawValue(rawValue: string): boolean {
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return false;

  return !new Set(["-", "--", "—", "na", "n/a", "null", "none"]).has(normalized);
}

export function getMatrixCellValueIdentity(entry: MatrixCellEntry): string {
  if (entry.valueNum !== null || entry.valueNum2 !== null) {
    return `num:${entry.valueNum ?? ""}|${entry.valueNum2 ?? ""}`;
  }

  return `raw:${entry.valueRaw}`;
}

export function getMatrixCellSourceValueDedupKey(entry: MatrixCellEntry): string {
  return `${entry.source ?? ""}__${getMatrixCellValueIdentity(entry)}`;
}

export function isCompareModifierClick(event: Pick<React.MouseEvent<HTMLElement>, "ctrlKey" | "metaKey">): boolean {
  return event.ctrlKey || event.metaKey;
}

export function isSelectionModifierClick(event: Pick<React.MouseEvent<HTMLElement>, "shiftKey">): boolean {
  return event.shiftKey;
}

export function clampCompareIntensity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function getCompareDeltaBadgeStyle(
  direction: CompareDirection,
  intensity: number,
  exportMode: boolean
): {
  textColor: string;
  borderColor: string;
  backgroundColor: string;
  separatorColor: string;
  boxShadow: string;
  textShadow: string;
  textStroke: string;
} {
  const safeIntensity = clampCompareIntensity(intensity);

  if (direction === "flat") {
    const borderAlpha = exportMode ? 0.74 : 0.62;
    const color = "rgba(236, 241, 249, 0.98)";
    return {
      textColor: color,
      borderColor: `rgba(148, 163, 184, ${borderAlpha})`,
      backgroundColor: "rgba(19, 28, 45, 0.9)",
      separatorColor: "rgba(148, 163, 184, 0.58)",
      boxShadow: exportMode
        ? "0 0 0 1px rgba(148, 163, 184, 0.24), 0 1px 2px rgba(2, 6, 23, 0.64)"
        : "0 1px 2px rgba(2, 6, 23, 0.62), 0 0 8px rgba(2, 6, 23, 0.24)",
      textShadow: "0 1px 1px rgba(2, 6, 23, 0.9)",
      textStroke: "0.2px rgba(2, 6, 23, 0.8)"
    };
  }

  const bgStart = direction === "up" ? ([22, 76, 56] as const) : ([108, 26, 36] as const);
  const bgEnd = direction === "up" ? ([7, 94, 69] as const) : ([126, 19, 31] as const);
  const borderStart = direction === "up" ? ([45, 180, 132] as const) : ([241, 92, 113] as const);
  const borderEnd = direction === "up" ? ([52, 211, 153] as const) : ([248, 113, 113] as const);
  const textColor = direction === "up" ? "rgba(236, 253, 245, 0.98)" : "rgba(255, 241, 242, 0.98)";

  const [bgR, bgG, bgB] = blendColor(bgStart, bgEnd, safeIntensity);
  const [bdR, bdG, bdB] = blendColor(borderStart, borderEnd, safeIntensity);
  const borderAlpha = exportMode ? 0.9 : 0.84;
  const separatorAlpha = exportMode ? 0.78 : 0.65;
  const glowAlpha = exportMode ? 0.12 : 0.22;

  return {
    textColor,
    borderColor: `rgba(${bdR}, ${bdG}, ${bdB}, ${borderAlpha})`,
    backgroundColor: `rgba(${bgR}, ${bgG}, ${bgB}, 0.93)`,
    separatorColor: `rgba(${bdR}, ${bdG}, ${bdB}, ${separatorAlpha})`,
    boxShadow: exportMode
      ? `0 0 0 1px rgba(${bdR}, ${bdG}, ${bdB}, 0.22), 0 1px 2px rgba(2, 6, 23, 0.66)`
      : `0 1px 2px rgba(2, 6, 23, 0.62), 0 0 8px rgba(${bdR}, ${bdG}, ${bdB}, ${glowAlpha})`,
    textShadow: "0 1px 1px rgba(2, 6, 23, 0.88)",
    textStroke: "0.2px rgba(2, 6, 23, 0.85)"
  };
}
