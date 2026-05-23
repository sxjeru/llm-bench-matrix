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
