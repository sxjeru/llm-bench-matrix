// Re-export all types
export * from "./types";

// Re-export all constants
export * from "./constants";

// Re-export all functions from scoring module
export {
  isLowerBetterBenchmark,
  getBenchmarkComparableScore,
  getSortedQuantile,
  buildDenseRankMap,
  buildOverallScoreDisplayDecimalsMap,
  __buildOverallScoreDisplayDecimalsMapForTest,
  getMatrixCellDisplayValue
} from "./scoring";

// Re-export all functions from formatters module
export {
  formatTooltipTime,
  formatValueNumForDisplay,
  formatComparisonDeltaValue
} from "./formatters";

// Re-export all functions from colors module
export {
  lerp,
  blendColor,
  normalizeHexColor,
  clampHeatmapAlpha,
  hexToRgbTuple,
  rgbaFromHex,
  getHeatCellStyle
} from "./colors";

// Re-export all functions from model-matching module
export {
  extractModelVersionToken,
  compareSourceTabKeysByVersion,
  extractModelScaleToken,
  extractModelVariantToken,
  compareModelVariantPriority,
  compareModelNameByColumnOrder,
  isSourceHeaderPrefixMatch
} from "./model-matching";

// Re-export all functions from utils module
export {
  getModelColumnWidthKey,
  getColumnWidthOverrideKey,
  clampColumnWidth,
  normalizeColumnWidthBySource,
  areColumnWidthMapsEqual,
  areStringArraysEqual,
  getSourceKey,
  getSourceLabel,
  sourceTabDisplayLabel,
  normalizeBenchmarkKeyFallback,
  normalizeBenchmarkDuplicateToken,
  pickPreferredBenchmarkDisplayName,
  getBenchmarkDuplicateKey,
  getMatrixGroupingKey,
  normalizeModalityName,
  normalizeModalityList,
  renderModalityBadge,
  normalizeMatchToken,
  hasMeaningfulMatrixRawValue,
  getMatrixCellValueIdentity,
  getMatrixCellSourceValueDedupKey,
  isCompareModifierClick,
  isSelectionModifierClick,
  clampCompareIntensity,
  getCompareDeltaBadgeStyle
} from "./utils";

// Re-export all functions from export-image module
export {
  isExportPresetKey,
  canEncodeCanvasMimeType,
  dataUrlToBlob,
  getMimeTypeFallbackChain,
  getEncoderQuality,
  mimeTypeToFormat,
  buildSourceFrameShadows,
  __buildSourceFrameShadowsForTest,
  buildCompareBaselineShadows,
  __buildCompareBaselineShadowsForTest,
  applyExportSourceFrameFallback,
  __applyExportSourceFrameFallbackForTest,
  applyExportCompareBaselineFallback,
  __applyExportCompareBaselineFallbackForTest,
  applyExportOverallRowNudgeFallback,
  resolveCaptureDimensions,
  __resolveCaptureDimensionsForTest,
  loadHtml2Canvas,
  renderElementToImageBlob,
  withTimeout
} from "./export-image";
