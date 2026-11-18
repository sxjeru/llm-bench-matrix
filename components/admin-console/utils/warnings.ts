const MANUAL_REVIEW_WARNING_TYPES = new Set([
  "mixed-magnitude-import-value",
  "non-numeric-import-value",
  "duplicate-check-skipped"
]);

export type TextImportWarningSummary = {
  totalCount: number;
  manualReviewCount: number;
  autoHandledCount: number;
};

export function isManualReviewTextImportWarning(warning: unknown): boolean {
  if (!warning || typeof warning !== "object") return false;
  const candidate = warning as Record<string, unknown>;
  if (candidate.requiresManualReview === true) return true;
  return typeof candidate.type === "string" && MANUAL_REVIEW_WARNING_TYPES.has(candidate.type);
}

export function summarizeTextImportWarnings(
  rawWarnings: unknown,
  reportedCount?: unknown
): TextImportWarningSummary {
  const warnings = Array.isArray(rawWarnings) ? rawWarnings : [];
  const manualReviewCount = warnings.filter(isManualReviewTextImportWarning).length;
  const parsedReportedCount = Number(reportedCount ?? 0);
  const safeReportedCount = Number.isFinite(parsedReportedCount) && parsedReportedCount > 0
    ? Math.floor(parsedReportedCount)
    : 0;
  const totalCount = Math.max(safeReportedCount, warnings.length);
  const autoHandledCount = Math.max(0, totalCount - manualReviewCount);

  return {
    totalCount,
    manualReviewCount,
    autoHandledCount
  };
}

export function formatTextImportWarningSummary(
  mode: "preview" | "import",
  rawWarnings: unknown,
  reportedCount?: unknown
): string | null {
  const { totalCount, manualReviewCount, autoHandledCount } = summarizeTextImportWarnings(
    rawWarnings,
    reportedCount
  );

  if (totalCount === 0) return null;

  if (mode === "preview") {
    if (manualReviewCount === 0) {
      return `检测到 ${totalCount} 条解析警告（导入时会自动清洗/修正）`;
    }
    if (autoHandledCount === 0) {
      return `检测到 ${totalCount} 条解析警告（需人工核对，导入不会自动修正）`;
    }
    return `检测到 ${totalCount} 条解析警告（其中 ${manualReviewCount} 条需人工核对，不会自动修正；${autoHandledCount} 条导入时会自动清洗/修正）`;
  }

  if (manualReviewCount === 0) {
    return `已自动处理 ${totalCount} 条解析警告`;
  }
  if (autoHandledCount === 0) {
    return `存在 ${totalCount} 条需人工核对的解析警告（未自动修正，请人工核对）`;
  }
  return `检测到 ${totalCount} 条解析警告（已自动处理 ${autoHandledCount} 条，另有 ${manualReviewCount} 条未自动修正，请人工核对）`;
}

export function formatTextImportWarningDetail(warning: unknown): string | null {
  if (!warning || typeof warning !== "object") return null;

  const candidate = warning as Record<string, unknown>;
  const contextParts: string[] = [];

  if (typeof candidate.rowNumber === "number") {
    contextParts.push(`行 ${candidate.rowNumber}`);
  }

  if (Array.isArray(candidate.rowNumbers)) {
    const rowNumbers = Array.from(
      new Set(
        candidate.rowNumbers
          .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
          .sort((a, b) => a - b)
      )
    );

    if (rowNumbers.length > 0) {
      contextParts.push(`行 ${rowNumbers.join(", ")}`);
    }
  }

  if (typeof candidate.modelName === "string" && candidate.modelName.trim()) {
    contextParts.push(`模型 ${candidate.modelName.trim()}`);
  }

  if (typeof candidate.benchmarkName === "string" && candidate.benchmarkName.trim()) {
    contextParts.push(`指标 ${candidate.benchmarkName.trim()}`);
  }

  if (typeof candidate.benchmarkType === "string" && candidate.benchmarkType.trim()) {
    contextParts.push(`类型 ${candidate.benchmarkType.trim()}`);
  }

  if (typeof candidate.source === "string" && candidate.source.trim()) {
    contextParts.push(`来源 ${candidate.source.trim()}`);
  }

  const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";
  const action = typeof candidate.action === "string" ? candidate.action.trim() : "";
  const mainText = [reason, action].filter(Boolean).join("；");

  if (!mainText) return null;
  if (contextParts.length === 0) return mainText;

  return `${contextParts.join(" / ")}：${mainText}`;
}

export function extractTextImportWarningDetails(rawWarnings: unknown): string[] {
  if (!Array.isArray(rawWarnings)) return [];

  const details = rawWarnings
    .map((item) => formatTextImportWarningDetail(item))
    .filter((item): item is string => Boolean(item));

  const LIMIT = 50;
  if (details.length <= LIMIT) {
    return details;
  }

  return [...details.slice(0, LIMIT), `...其余 ${details.length - LIMIT} 条未展开`];
}
