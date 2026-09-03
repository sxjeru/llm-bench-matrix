import {
  ALL_SOURCE_COLUMN_COVERAGE_THRESHOLD,
  ALL_SOURCE_ROW_COVERAGE_THRESHOLD,
  MODEL_INFO_CATEGORY_LABEL,
  PARAMS_ACTIVE_RATIO_ROW_KEY,
  PARAMS_ROW_KEY,
  PRICE_CACHE_INPUT_ROW_KEY,
  PRICE_CATEGORY_LABEL,
  PRICE_INPUT_ROW_KEY,
  PRICE_OUTPUT_ROW_KEY,
  RELEASE_DATE_ROW_KEY,
  SOURCE_ALL,
  SOURCE_NEW_LATEST_COUNT,
  SOURCE_NEW_WINDOW_MS
} from "./constants";
import {
  compareModelNameByColumnOrder,
  compareSourceTabKeysByVersion,
  getModelFamilyMatchKey
} from "./model-matching";
import {
  buildDenseRankMap,
  buildOverallScoreDisplayDecimalsMap,
  getBenchmarkBestComparableScore,
  getBenchmarkComparableScore,
  getMatrixCellDisplayValue,
  getMatrixRowComparableScore,
  getSortedQuantile,
  hasMatrixCellPairRawValue,
  isLowerBetterBenchmark
} from "./scoring";
import { calculateBoxPlotStats } from "@/lib/boxplot-stats";
import { formatParamsBillions, formatPricePerMillion } from "./formatters";
import type {
  IndexedMatrixInputRow,
  BenchmarkRankingData,
  BenchmarkRankingScaleMode,
  MatrixCell,
  MatrixCellEntry,
  MatrixInputRow,
  MatrixRow,
  ModelParamsInfo,
  ModelPriceInfo,
  OverallModelSummary,
  OverallScoreDisplayItem,
  ProviderIdentity,
  RowSortColumn,
  RowSortMode
} from "./types";
import {
  applySourceMeta,
  aggregateMatrixCellEntries,
  compareMatrixCellEntryRecency,
  getMatrixCellSourceValueDedupKey,
  getMatrixCellValueIdentity,
  getMatrixGroupingKey,
  getSourceKey,
  getSourceLabel,
  getSourceValueEntry,
  hasMeaningfulMatrixRawValue,
  isAaSecondaryCategory,
  isArtificialAnalysisSource,
  normalizeMatchToken,
  normalizeModalityList,
  parseTimestampMs,
  pickPreferredBenchmarkDisplayName,
  resolveMatrixCellAggregateModeFromEntries
} from "./utils";
import type { SourceValueMode } from "./utils";

export type SourceOption = { key: string; label: string };

export type AllRowsIndex = {
  modelProviderMap: Map<string, ProviderIdentity>;
  modelProviderBrandColorMap: Map<string, string | null>;
  providerDisplayNameBrandColorMap: Map<string, string | null>;
  rowsByModel: Map<string, IndexedMatrixInputRow[]>;
  rowsByGroupingKey: Map<string, IndexedMatrixInputRow[]>;
};

export type CoverageMetaByModel = Map<
  string,
  { providerName: string; coveredCount: number; coverageRate: number; isBaseModel: boolean }
>;

export type ProviderGroup = {
  providerName: string;
  models: string[];
};

export type DisplayedCoverageMetaByModel = {
  displayedRowCount: number;
  metaMap: Map<string, { coveredCount: number; coverageRate: number }>;
};

export type HeaderUniqueCounts = {
  category: number;
  benchmark: number;
};

export type OverallHeatRange = {
  minRawScore: number | null;
  maxRawScore: number | null;
};

export function buildSourceOptions(rows: MatrixInputRow[], allSourceOptions: string[]): SourceOption[] {
  const rowSourceKeys = rows.map((row) => getSourceKey(row.source));
  const externalSourceKeys = allSourceOptions.map((source) => getSourceKey(source));
  const keys = Array.from(new Set([...rowSourceKeys, ...externalSourceKeys])).sort(compareSourceTabKeysByVersion);

  return [
    { key: SOURCE_ALL, label: "All" },
    ...keys.map((key) => ({ key, label: getSourceLabel(key) }))
  ];
}

export function buildFirstRowSourceOptions(
  sourceOptions: SourceOption[],
  allRows: MatrixInputRow[]
): SourceOption[] {
  const earliestTimestampBySource = new Map<string, number>();
  const earliestRecordIdBySource = new Map<string, number>();

  for (const row of allRows) {
    const sourceKey = getSourceKey(row.source);
    if (sourceKey === SOURCE_ALL) continue;

    const timeStr = row.updatedAt || row.benchTime;
    if (timeStr) {
      const parsed = parseTimestampMs(timeStr);
      if (parsed !== null) {
        const prev = earliestTimestampBySource.get(sourceKey);
        if (prev === undefined || parsed < prev) {
          earliestTimestampBySource.set(sourceKey, parsed);
        }
      }
    }

    if (typeof row.recordId === "number" && Number.isFinite(row.recordId)) {
      const prevId = earliestRecordIdBySource.get(sourceKey);
      if (prevId === undefined || row.recordId < prevId) {
        earliestRecordIdBySource.set(sourceKey, row.recordId);
      }
    }
  }

  let allOption: SourceOption | null = null;
  const aaOptions: SourceOption[] = [];
  const otherOptions: SourceOption[] = [];

  for (const opt of sourceOptions) {
    if (opt.key === SOURCE_ALL) {
      allOption = opt;
    } else if (isArtificialAnalysisSource(opt.key)) {
      aaOptions.push(opt);
    } else {
      otherOptions.push(opt);
    }
  }

  aaOptions.sort((a, b) => compareSourceTabKeysByVersion(a.key, b.key));

  otherOptions.sort((a, b) => {
    const timeA = earliestTimestampBySource.get(a.key);
    const timeB = earliestTimestampBySource.get(b.key);
    if (timeA !== undefined && timeB !== undefined) {
      if (timeA !== timeB) return timeB - timeA;
    } else if (timeA !== undefined) {
      return -1;
    } else if (timeB !== undefined) {
      return 1;
    }

    const idA = earliestRecordIdBySource.get(a.key);
    const idB = earliestRecordIdBySource.get(b.key);
    if (idA !== undefined && idB !== undefined) {
      if (idA !== idB) return idB - idA;
    } else if (idA !== undefined) {
      return -1;
    } else if (idB !== undefined) {
      return 1;
    }

    return compareSourceTabKeysByVersion(a.key, b.key);
  });

  return [
    ...(allOption ? [allOption] : []),
    ...aaOptions,
    ...otherOptions
  ];
}

export function buildSourceNewStateByKey(
  allRows: MatrixInputRow[],
  sourceNewReferenceTime: number | null
): Map<string, { updatedAtMs: number; isNew: boolean }> {
  const latestTimeStrBySource = new Map<string, string>();

  allRows.forEach((row) => {
    const sourceKey = getSourceKey(row.source);
    if (sourceKey === SOURCE_ALL) return;

    const timeStr = row.updatedAt || row.benchTime;
    if (!timeStr) return;

    const prev = latestTimeStrBySource.get(sourceKey);
    if (prev === undefined || timeStr > prev) {
      latestTimeStrBySource.set(sourceKey, timeStr);
    }
  });

  const latestUpdateBySource = new Map<string, number>();
  latestTimeStrBySource.forEach((timeStr, sourceKey) => {
    const parsed = parseTimestampMs(timeStr);
    if (parsed !== null) {
      latestUpdateBySource.set(sourceKey, parsed);
    }
  });

  if (sourceNewReferenceTime === null) {
    return new Map(
      Array.from(latestUpdateBySource.entries(), ([sourceKey, updatedAtMs]) => [
        sourceKey,
        { updatedAtMs, isNew: false }
      ])
    );
  }

  const latestSourceKeys = new Set(
    Array.from(latestUpdateBySource.entries())
      .sort(([keyA, timeA], [keyB, timeB]) => timeB - timeA || keyA.localeCompare(keyB))
      .slice(0, SOURCE_NEW_LATEST_COUNT)
      .map(([sourceKey]) => sourceKey)
  );

  const stateByKey = new Map<string, { updatedAtMs: number; isNew: boolean }>();
  latestUpdateBySource.forEach((updatedAtMs, sourceKey) => {
    const ageMs = sourceNewReferenceTime - updatedAtMs;
    const isRecent = ageMs >= 0 && ageMs <= SOURCE_NEW_WINDOW_MS;
    const isLatest = latestSourceKeys.has(sourceKey);

    stateByKey.set(sourceKey, { updatedAtMs, isNew: isRecent || isLatest });
  });

  return stateByKey;
}

export function buildRowsBySource(rows: MatrixInputRow[]): Map<string, MatrixInputRow[]> {
  const map = new Map<string, MatrixInputRow[]>();

  rows.forEach((row) => {
    const sourceKey = getSourceKey(row.source);
    let bucket = map.get(sourceKey);
    if (!bucket) {
      bucket = [];
      map.set(sourceKey, bucket);
    }
    // All 视图只按 source 分桶，不改写 benchmarkType / modalities；
    // 非 All 再由 resolveBaseSourceRows 做 source 元信息投影。
    bucket.push(row);
  });

  return map;
}

export function buildRowsWithSourceMeta(rows: MatrixInputRow[]): MatrixInputRow[] {
  return rows.map((row) => applySourceMeta(row));
}

export function buildAllRowsIndex(indexedSourceRows: MatrixInputRow[], showDuplicateRows: boolean): AllRowsIndex {
  const modelProviderMap = new Map<string, ProviderIdentity>();
  const modelProviderBrandColorMap = new Map<string, string | null>();
  const providerDisplayNameBrandColorMap = new Map<string, string | null>();
  const rowsByModel = new Map<string, IndexedMatrixInputRow[]>();
  const rowsByGroupingKey = new Map<string, IndexedMatrixInputRow[]>();

  indexedSourceRows.forEach((row) => {
    if (!modelProviderMap.has(row.modelName)) {
      const displayName = row.providerDisplayName?.trim() || row.providerName || "Unknown";
      modelProviderMap.set(row.modelName, {
        canonicalName: row.providerName || "Unknown",
        displayName
      });
      modelProviderBrandColorMap.set(row.modelName, row.providerBrandColor ?? null);

      if (!providerDisplayNameBrandColorMap.has(displayName)) {
        providerDisplayNameBrandColorMap.set(displayName, row.providerBrandColor ?? null);
      }
    }

    const indexed: IndexedMatrixInputRow = {
      row,
      matrixKey: getMatrixGroupingKey(row, showDuplicateRows)
    };

    if (!rowsByModel.has(row.modelName)) {
      rowsByModel.set(row.modelName, []);
    }
    rowsByModel.get(row.modelName)!.push(indexed);

    if (!rowsByGroupingKey.has(indexed.matrixKey)) {
      rowsByGroupingKey.set(indexed.matrixKey, []);
    }
    rowsByGroupingKey.get(indexed.matrixKey)!.push(indexed);
  });

  return {
    modelProviderMap,
    modelProviderBrandColorMap,
    providerDisplayNameBrandColorMap,
    rowsByModel,
    rowsByGroupingKey
  };
}

export function buildCoveredModelsByGroupingKey(allRowsIndex: AllRowsIndex): Map<string, Set<string>> {
  const coveredMap = new Map<string, Set<string>>();

  allRowsIndex.rowsByGroupingKey.forEach((groupedRows, matrixKey) => {
    const coveredModels = new Set<string>();

    groupedRows.forEach(({ row }) => {
      if (!hasMeaningfulMatrixRawValue(row.valueRaw)) return;
      coveredModels.add(row.modelName);
    });

    if (coveredModels.size > 0) {
      coveredMap.set(matrixKey, coveredModels);
    }
  });

  return coveredMap;
}

/** 是否所有行都落在同一个 source 上；发现第二个就停，不必建全量 Set */
function hasSingleSourceKey(rows: MatrixInputRow[]): boolean {
  if (rows.length === 0) return false;

  const firstSourceKey = getSourceKey(rows[0]!.source);
  for (let index = 1; index < rows.length; index += 1) {
    if (getSourceKey(rows[index]!.source) !== firstSourceKey) return false;
  }

  return true;
}

/** 是否只有一个分组键；同样只需找到第二个不同值即可判定 */
function hasSingleGroupingKey(rows: MatrixInputRow[], showDuplicateRows: boolean): boolean {
  if (rows.length === 0) return false;

  const firstKey = getMatrixGroupingKey(rows[0]!, showDuplicateRows);
  for (let index = 1; index < rows.length; index += 1) {
    if (getMatrixGroupingKey(rows[index]!, showDuplicateRows) !== firstKey) return false;
  }

  return true;
}

export function resolveBaseSourceRows(
  allRows: MatrixInputRow[],
  rows: MatrixInputRow[],
  scopedRowsBySource: Map<string, MatrixInputRow[]>,
  allRowsBySource: Map<string, MatrixInputRow[]>,
  activeSource: string,
  showDuplicateRows: boolean
): MatrixInputRow[] {
  if (activeSource === SOURCE_ALL) {
    if (rows.length === 0) {
      return allRows;
    }

    // 这里只关心「恰好一个 source」且「分组键不超过一个」，
    // 原先为此建了两个全量 Set（各遍历两万行、其中一个还要逐行求分组键）。
    // 改成发现第二个不同值就收手；source 已经多于一个时，分组键根本不用看。
    if (!hasSingleSourceKey(rows) || !hasSingleGroupingKey(rows, showDuplicateRows)) {
      return rows;
    }

    return allRows;
  }

  const sourceScopedRows = scopedRowsBySource.get(activeSource) ?? allRowsBySource.get(activeSource) ?? [];
  if (sourceScopedRows.length > 0) {
    return buildRowsWithSourceMeta(sourceScopedRows);
  }

  return rows;
}

export function buildBaseBenchmarkKeySet(baseSourceRows: MatrixInputRow[], showDuplicateRows: boolean): Set<string> {
  const keys = new Set<string>();
  baseSourceRows.forEach((row) => {
    keys.add(getMatrixGroupingKey(row, showDuplicateRows));
  });
  return keys;
}

export function buildBaseModelNameSet(baseSourceRows: MatrixInputRow[]): Set<string> {
  return new Set(baseSourceRows.map((row) => row.modelName));
}

export function buildCoverageMetaByModel(
  allRowsIndex: AllRowsIndex,
  baseBenchmarkKeySet: Set<string>,
  baseModelNameSet: Set<string>
): CoverageMetaByModel {
  const modelCoveredBenchmarkKeys = new Map<string, Set<string>>();

  baseBenchmarkKeySet.forEach((matrixKey) => {
    const groupedRows = allRowsIndex.rowsByGroupingKey.get(matrixKey);
    if (!groupedRows || groupedRows.length === 0) return;

    groupedRows.forEach(({ row }) => {
      if (!modelCoveredBenchmarkKeys.has(row.modelName)) {
        modelCoveredBenchmarkKeys.set(row.modelName, new Set<string>());
      }
      modelCoveredBenchmarkKeys.get(row.modelName)!.add(matrixKey);
    });
  });

  const totalBenchmarkCount = baseBenchmarkKeySet.size;
  const metaMap: CoverageMetaByModel = new Map();

  for (const [modelName, providerIdentity] of allRowsIndex.modelProviderMap.entries()) {
    const coveredCount = modelCoveredBenchmarkKeys.get(modelName)?.size ?? 0;
    if (coveredCount <= 0) continue;

    const providerName = providerIdentity.displayName || "Unknown";

    metaMap.set(modelName, {
      providerName,
      coveredCount,
      coverageRate: totalBenchmarkCount > 0 ? coveredCount / totalBenchmarkCount : 0,
      isBaseModel: baseModelNameSet.has(modelName)
    });
  }

  return metaMap;
}

export function buildProviderGroups(coverageMetaByModel: CoverageMetaByModel, sourceModelHint: string): ProviderGroup[] {
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const map = new Map<string, string[]>();

  coverageMetaByModel.forEach((meta, modelName) => {
    if (!map.has(meta.providerName)) {
      map.set(meta.providerName, []);
    }
    map.get(meta.providerName)!.push(modelName);
  });

  return Array.from(map.entries())
    .map(([providerName, modelList]) => {
      const models = [...modelList].sort((left, right) => {
        const leftMeta = coverageMetaByModel.get(left);
        const rightMeta = coverageMetaByModel.get(right);

        const leftIsBase = leftMeta?.isBaseModel ? 1 : 0;
        const rightIsBase = rightMeta?.isBaseModel ? 1 : 0;
        if (rightIsBase !== leftIsBase) {
          return rightIsBase - leftIsBase;
        }

        const leftCoverage = leftMeta?.coverageRate ?? 0;
        const rightCoverage = rightMeta?.coverageRate ?? 0;
        if (rightCoverage !== leftCoverage) {
          return rightCoverage - leftCoverage;
        }

        return compareModelNameByColumnOrder(left, right, collator);
      });

      const providerCoverageAverage = models.length > 0
        ? models.reduce((acc, modelName) => acc + (coverageMetaByModel.get(modelName)?.coverageRate ?? 0), 0) / models.length
        : 0;

      const normalizedProvider = normalizeMatchToken(providerName);
      const isSourceRelated = sourceModelHint.length > 0 && (
        normalizedProvider.includes(sourceModelHint) ||
        models.some((modelName) => normalizeMatchToken(modelName).includes(sourceModelHint))
      );

      return {
        providerName,
        models,
        providerCoverageAverage,
        isSourceRelated
      };
    })
    .sort((left, right) => {
      const leftSourceRelated = left.isSourceRelated ? 1 : 0;
      const rightSourceRelated = right.isSourceRelated ? 1 : 0;
      if (rightSourceRelated !== leftSourceRelated) {
        return rightSourceRelated - leftSourceRelated;
      }

      if (right.providerCoverageAverage !== left.providerCoverageAverage) {
        return right.providerCoverageAverage - left.providerCoverageAverage;
      }

      if (right.models.length !== left.models.length) {
        return right.models.length - left.models.length;
      }

      return left.providerName.localeCompare(right.providerName, "zh-Hans-CN", { sensitivity: "base" });
    })
    .map((item) => ({
      providerName: item.providerName,
      models: item.models
    }));
}

export function buildAllModelNames(providerGroups: ProviderGroup[]): string[] {
  return providerGroups.flatMap((group) => group.models).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function buildDefaultSelectedModels(allModelNames: string[], baseModelNameSet: Set<string>): string[] {
  const selectableSet = new Set(allModelNames);
  return Array.from(baseModelNameSet)
    .filter((modelName) => selectableSet.has(modelName))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function buildDefaultAllSourceModels(
  allModelNames: string[],
  defaultSelectedModels: string[],
  baseModelNameSet: Set<string>
): string[] {
  return baseModelNameSet.size <= 1
    ? [...allModelNames]
    : [...defaultSelectedModels];
}

export function buildFilteredRows(
  allRowsIndex: AllRowsIndex,
  selectedModelSet: Set<string>,
  selectedModels: string[],
  baseBenchmarkKeySet: Set<string>,
  benchmarkSearchQuery: string = ""
): MatrixInputRow[] {
  if (selectedModelSet.size === 0 || baseBenchmarkKeySet.size === 0) {
    return [];
  }

  const result: MatrixInputRow[] = [];
  const normalizedQuery = benchmarkSearchQuery.trim().toLowerCase();

  selectedModels.forEach((modelName) => {
    const indexedRows = allRowsIndex.rowsByModel.get(modelName);
    if (!indexedRows || indexedRows.length === 0) {
      return;
    }

    indexedRows.forEach((indexed) => {
      if (baseBenchmarkKeySet.has(indexed.matrixKey)) {
        if (normalizedQuery) {
          const matchName = indexed.row.benchmarkName?.toLowerCase().includes(normalizedQuery);
          const matchType = indexed.row.benchmarkType?.toLowerCase().includes(normalizedQuery);
          if (!matchName && !matchType) {
            return;
          }
        }
        result.push(indexed.row);
      }
    });
  });

  return result;
}

export type BuildCoveragePrunedRowsOptions = {
  /**
   * 始终保留的 benchmarkType（全匹配）。
   * 这些行不参与「默认隐藏 Performance」规则，裁剪后也会补回，
   * 供散点轴下拉等场景在关闭「含低覆盖」时仍能选到 Cost / Performance。
   */
  alwaysKeepBenchmarkTypes?: ReadonlySet<string>;
};

function rowIdentityKey(row: MatrixInputRow, showDuplicateRows: boolean): string {
  return `${getMatrixGroupingKey(row, showDuplicateRows)}::${row.modelName}`;
}

function mergeAlwaysKeepBenchmarkRows(
  prunedRows: MatrixInputRow[],
  filteredRows: MatrixInputRow[],
  showDuplicateRows: boolean,
  alwaysKeepBenchmarkTypes: ReadonlySet<string> | undefined
): MatrixInputRow[] {
  if (!alwaysKeepBenchmarkTypes || alwaysKeepBenchmarkTypes.size === 0) {
    return prunedRows;
  }

  const present = new Set(prunedRows.map((row) => rowIdentityKey(row, showDuplicateRows)));
  const extras = filteredRows.filter((row) => {
    if (!alwaysKeepBenchmarkTypes.has(row.benchmarkType)) return false;
    return !present.has(rowIdentityKey(row, showDuplicateRows));
  });

  return extras.length > 0 ? [...prunedRows, ...extras] : prunedRows;
}

export function buildCoveragePrunedRows(
  activeSource: string,
  filteredRows: MatrixInputRow[],
  showDuplicateRows: boolean,
  showLowCoverageRows: boolean,
  options?: BuildCoveragePrunedRowsOptions
): MatrixInputRow[] {
  const alwaysKeepBenchmarkTypes = options?.alwaysKeepBenchmarkTypes;

  if (activeSource !== SOURCE_ALL || showLowCoverageRows) {
    return filteredRows;
  }

  // All 默认隐藏低覆盖时，同步隐藏分类精确为 Performance 的行；
  // alwaysKeep 的类型不参与覆盖率裁剪，最后再并回结果。
  const eligibleRows = filteredRows.filter((row) => {
    if (alwaysKeepBenchmarkTypes?.has(row.benchmarkType)) return false;
    return row.benchmarkType !== "Performance";
  });

  if (eligibleRows.length === 0) {
    return mergeAlwaysKeepBenchmarkRows(
      eligibleRows,
      filteredRows,
      showDuplicateRows,
      alwaysKeepBenchmarkTypes
    );
  }

  const candidateModels = Array.from(new Set(eligibleRows.map((row) => row.modelName)));
  if (candidateModels.length === 0) {
    return mergeAlwaysKeepBenchmarkRows(
      eligibleRows,
      filteredRows,
      showDuplicateRows,
      alwaysKeepBenchmarkTypes
    );
  }

  const rowModelsWithValue = new Map<string, Set<string>>();
  eligibleRows.forEach((row) => {
    if (!hasMeaningfulMatrixRawValue(row.valueRaw)) return;

    const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
    if (!rowModelsWithValue.has(matrixKey)) {
      rowModelsWithValue.set(matrixKey, new Set<string>());
    }
    rowModelsWithValue.get(matrixKey)!.add(row.modelName);
  });

  if (rowModelsWithValue.size === 0) {
    return mergeAlwaysKeepBenchmarkRows(
      eligibleRows,
      filteredRows,
      showDuplicateRows,
      alwaysKeepBenchmarkTypes
    );
  }

  const firstPassRowKeys = new Set<string>();
  rowModelsWithValue.forEach((modelsWithValue, matrixKey) => {
    const rowCoverage = modelsWithValue.size / candidateModels.length;
    if (rowCoverage >= ALL_SOURCE_ROW_COVERAGE_THRESHOLD) {
      firstPassRowKeys.add(matrixKey);
    }
  });

  if (firstPassRowKeys.size === 0) {
    return mergeAlwaysKeepBenchmarkRows(
      eligibleRows,
      filteredRows,
      showDuplicateRows,
      alwaysKeepBenchmarkTypes
    );
  }

  const modelCoveredRowCount = new Map<string, number>();
  firstPassRowKeys.forEach((matrixKey) => {
    const modelsWithValue = rowModelsWithValue.get(matrixKey);
    if (!modelsWithValue) return;

    modelsWithValue.forEach((modelName) => {
      modelCoveredRowCount.set(modelName, (modelCoveredRowCount.get(modelName) ?? 0) + 1);
    });
  });

  const keptModels = new Set<string>();
  modelCoveredRowCount.forEach((coveredRowCount, modelName) => {
    const columnCoverage = coveredRowCount / firstPassRowKeys.size;
    if (columnCoverage >= ALL_SOURCE_COLUMN_COVERAGE_THRESHOLD) {
      keptModels.add(modelName);
    }
  });

  if (keptModels.size === 0) {
    return mergeAlwaysKeepBenchmarkRows(
      eligibleRows,
      filteredRows,
      showDuplicateRows,
      alwaysKeepBenchmarkTypes
    );
  }

  const secondPassRowKeys = new Set<string>();
  rowModelsWithValue.forEach((modelsWithValue, matrixKey) => {
    let keptValueCount = 0;
    modelsWithValue.forEach((modelName) => {
      if (keptModels.has(modelName)) {
        keptValueCount += 1;
      }
    });

    const rowCoverage = keptValueCount / keptModels.size;
    if (rowCoverage >= ALL_SOURCE_ROW_COVERAGE_THRESHOLD) {
      secondPassRowKeys.add(matrixKey);
    }
  });

  if (secondPassRowKeys.size === 0) {
    return mergeAlwaysKeepBenchmarkRows(
      eligibleRows,
      filteredRows,
      showDuplicateRows,
      alwaysKeepBenchmarkTypes
    );
  }

  const prunedRows = eligibleRows.filter((row) => {
    if (!keptModels.has(row.modelName)) return false;
    const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
    return secondPassRowKeys.has(matrixKey);
  });

  const basePruned = prunedRows.length > 0 ? prunedRows : eligibleRows;
  return mergeAlwaysKeepBenchmarkRows(
    basePruned,
    filteredRows,
    showDuplicateRows,
    alwaysKeepBenchmarkTypes
  );
}

export function buildModelColumns(
  coveragePrunedRows: MatrixInputRow[],
  sourceModelHint: string,
  columnSortBenchmarkKey: string | null,
  showDuplicateRows: boolean,
  modelOrderBySource: Record<string, string[]>,
  activeSource: string
): string[] {
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

  const modelStats = new Map<string, { providerName: string; numericCount: number; totalCount: number }>();

  coveragePrunedRows.forEach((row) => {
    const current = modelStats.get(row.modelName) ?? {
      providerName: row.providerDisplayName?.trim() || row.providerName || "Unknown",
      numericCount: 0,
      totalCount: 0
    };

    current.totalCount += 1;
    if (row.valueNum !== null) {
      current.numericCount += 1;
    }

    if (!current.providerName) {
      current.providerName = row.providerDisplayName?.trim() || row.providerName || "Unknown";
    }

    modelStats.set(row.modelName, current);
  });

  const providerStats = new Map<string, { numericCount: number; totalCount: number; models: string[] }>();
  for (const [modelName, stats] of modelStats.entries()) {
    const providerName = stats.providerName || "Unknown";
    const provider = providerStats.get(providerName) ?? { numericCount: 0, totalCount: 0, models: [] };
    provider.numericCount += stats.numericCount;
    provider.totalCount += stats.totalCount;
    provider.models.push(modelName);
    providerStats.set(providerName, provider);
  }

  const baseOrderedModels = (() => {
    if (activeSource !== SOURCE_ALL) {
      const sourceFamilyHint = getModelFamilyMatchKey(sourceModelHint);

      const getSourceMatchRank = (modelName: string, providerName: string | undefined) => {
        if (!sourceModelHint) return 0;

        const normalizedModel = normalizeMatchToken(modelName);
        if (normalizedModel.includes(sourceModelHint)) return 0;

        if (sourceFamilyHint) {
          const modelFamilyKey = getModelFamilyMatchKey(modelName);
          if (modelFamilyKey === sourceFamilyHint) return 1;
        }

        const normalizedProvider = normalizeMatchToken(providerName ?? "");
        if (normalizedProvider.includes(sourceModelHint)) return 1;
        if (sourceFamilyHint && getModelFamilyMatchKey(providerName ?? "") === sourceFamilyHint) return 1;

        return 2;
      };

      const sourceMatchRankByModel = new Map<string, number>();
      const seriesCoverageByRankAndProvider = new Map<string, number>();

      for (const [modelName, stats] of modelStats.entries()) {
        const rank = getSourceMatchRank(modelName, stats.providerName);
        sourceMatchRankByModel.set(modelName, rank);

        const seriesKey = `${rank}::${normalizeMatchToken(stats.providerName)}`;
        seriesCoverageByRankAndProvider.set(
          seriesKey,
          (seriesCoverageByRankAndProvider.get(seriesKey) ?? 0) + stats.numericCount
        );
      }

      return Array.from(modelStats.keys()).sort((leftModel, rightModel) => {
        const leftStats = modelStats.get(leftModel);
        const rightStats = modelStats.get(rightModel);

        const leftRank = sourceMatchRankByModel.get(leftModel) ?? 0;
        const rightRank = sourceMatchRankByModel.get(rightModel) ?? 0;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        const leftSeriesKey = `${leftRank}::${normalizeMatchToken(leftStats?.providerName ?? "")}`;
        const rightSeriesKey = `${rightRank}::${normalizeMatchToken(rightStats?.providerName ?? "")}`;
        const leftSeriesCoverage = seriesCoverageByRankAndProvider.get(leftSeriesKey) ?? 0;
        const rightSeriesCoverage = seriesCoverageByRankAndProvider.get(rightSeriesKey) ?? 0;
        if (rightSeriesCoverage !== leftSeriesCoverage) {
          return rightSeriesCoverage - leftSeriesCoverage;
        }

        const modelNameCompare = compareModelNameByColumnOrder(leftModel, rightModel, collator);
        if (modelNameCompare !== 0) {
          return modelNameCompare;
        }

        if (!leftStats || !rightStats) return 0;
        if (rightStats.numericCount !== leftStats.numericCount) {
          return rightStats.numericCount - leftStats.numericCount;
        }
        if (rightStats.totalCount !== leftStats.totalCount) {
          return rightStats.totalCount - leftStats.totalCount;
        }

        return leftStats.providerName.localeCompare(rightStats.providerName, "zh-Hans-CN", { sensitivity: "base" });
      });
    }

    const orderedProviders = Array.from(providerStats.entries()).sort((a, b) => {
      const left = a[1];
      const right = b[1];
      if (right.numericCount !== left.numericCount) {
        return right.numericCount - left.numericCount;
      }
      if (right.totalCount !== left.totalCount) {
        return right.totalCount - left.totalCount;
      }
      return a[0].localeCompare(b[0], "zh-Hans-CN", { sensitivity: "base" });
    });

    const groupedModels = orderedProviders.flatMap(([, provider]) => {
      return [...provider.models].sort((leftModel, rightModel) => {
        const leftStats = modelStats.get(leftModel);
        const rightStats = modelStats.get(rightModel);
        if (!leftStats || !rightStats) return compareModelNameByColumnOrder(leftModel, rightModel, collator);

        const modelNameCompare = compareModelNameByColumnOrder(leftModel, rightModel, collator);
        if (modelNameCompare !== 0) {
          return modelNameCompare;
        }

        if (rightStats.numericCount !== leftStats.numericCount) {
          return rightStats.numericCount - leftStats.numericCount;
        }
        if (rightStats.totalCount !== leftStats.totalCount) {
          return rightStats.totalCount - leftStats.totalCount;
        }
        return 0;
      });
    });

    if (!sourceModelHint) return groupedModels;

    const matched: string[] = [];
    const others: string[] = [];

    groupedModels.forEach((modelName) => {
      const normalizedModel = normalizeMatchToken(modelName);
      if (normalizedModel.includes(sourceModelHint)) {
        matched.push(modelName);
      } else {
        others.push(modelName);
      }
    });

    matched.sort((left, right) => compareModelNameByColumnOrder(left, right, collator));
    return [...matched, ...others];
  })();

  const orderedByManual = (() => {
    const savedOrder = modelOrderBySource[activeSource] ?? [];
    if (savedOrder.length === 0) return baseOrderedModels;

    const savedIndex = new Map(savedOrder.map((modelName, index) => [modelName, index]));
    const baseIndex = new Map(baseOrderedModels.map((modelName, index) => [modelName, index]));

    return [...baseOrderedModels].sort((left, right) => {
      const leftSaved = savedIndex.get(left);
      const rightSaved = savedIndex.get(right);

      if (leftSaved !== undefined && rightSaved !== undefined) {
        return leftSaved - rightSaved;
      }
      if (leftSaved !== undefined) return -1;
      if (rightSaved !== undefined) return 1;

      return (baseIndex.get(left) ?? 0) - (baseIndex.get(right) ?? 0);
    });
  })();

  if (!columnSortBenchmarkKey) {
    return orderedByManual;
  }

  const benchmarkScoreMap = new Map<string, number>();
  const benchmarkRowsByModel = new Map<string, MatrixInputRow[]>();
  coveragePrunedRows.forEach((row) => {
    if (getMatrixGroupingKey(row, showDuplicateRows) !== columnSortBenchmarkKey) {
      return;
    }

    const modelRows = benchmarkRowsByModel.get(row.modelName) ?? [];
    modelRows.push(row);
    benchmarkRowsByModel.set(row.modelName, modelRows);
  });

  benchmarkRowsByModel.forEach((matchingRows, modelName) => {
    const representativeRow = matchingRows[0];
    if (!representativeRow) return;

    const numericMatchingRows = matchingRows.filter(
      (row) => row.valueNum !== null && Number.isFinite(row.valueNum)
    );
    const allNumericRowsArePairs = numericMatchingRows.length > 0 && numericMatchingRows.every(
      (row) => (row.valueNum2 ?? null) !== null || hasMatrixCellPairRawValue(row.valueRaw)
    );
    if (allNumericRowsArePairs) {
      matchingRows.forEach((row) => {
        const comparableScore = getBenchmarkBestComparableScore(
          row.benchmarkName,
          row.valueNum,
          row.valueNum2 ?? null,
          row.benchmarkType,
          row.higherIsBetter
        );
        if (comparableScore === null) return;

        const previous = benchmarkScoreMap.get(modelName);
        if (previous === undefined || comparableScore > previous) {
          benchmarkScoreMap.set(modelName, comparableScore);
        }
      });
      return;
    }

    const entryRowMap = new Map<MatrixCellEntry, MatrixInputRow>();
    const entries = matchingRows.map((candidate) => {
      const entry: MatrixCellEntry = {
        recordId: candidate.recordId ?? null,
        valueRaw: candidate.valueRaw,
        valueNum: candidate.valueNum,
        valueNum2: candidate.valueNum2 ?? null,
        valueNote: candidate.valueNote ?? null,
        source: candidate.source ?? null,
        benchTime: candidate.benchTime
      };
      entryRowMap.set(entry, candidate);
      return entry;
    });
    const higherIsBetter = matchingRows.some((candidate) => candidate.higherIsBetter === false)
      ? false
      : matchingRows.some((candidate) => candidate.higherIsBetter === true)
        ? true
        : !isLowerBetterBenchmark(representativeRow.benchmarkName, representativeRow.benchmarkType);
    const aggregate = aggregateMatrixCellEntries(
      entries,
      higherIsBetter,
      resolveMatrixCellAggregateModeFromEntries(entries)
    );
    // 重名 benchmark 合并后各行的 name / type 可能不同，可比分要用聚合命中的那一行来算
    const scoringRow = (aggregate.entry ? entryRowMap.get(aggregate.entry) : null) ?? representativeRow;
    const comparableScore = getBenchmarkBestComparableScore(
      scoringRow.benchmarkName,
      aggregate.valueNum,
      aggregate.valueNum2,
      scoringRow.benchmarkType,
      higherIsBetter
    );
    if (comparableScore === null) return;

    const previous = benchmarkScoreMap.get(modelName);
    if (previous === undefined || comparableScore > previous) {
      benchmarkScoreMap.set(modelName, comparableScore);
    }
  });

  const baseOrderIndex = new Map(orderedByManual.map((modelName, index) => [modelName, index]));

  return [...orderedByManual].sort((leftModel, rightModel) => {
    const leftScore = benchmarkScoreMap.get(leftModel);
    const rightScore = benchmarkScoreMap.get(rightModel);

    if (leftScore === undefined && rightScore === undefined) {
      return (baseOrderIndex.get(leftModel) ?? 0) - (baseOrderIndex.get(rightModel) ?? 0);
    }
    if (leftScore === undefined) return 1;
    if (rightScore === undefined) return -1;
    if (rightScore !== leftScore) return rightScore - leftScore;

    return (baseOrderIndex.get(leftModel) ?? 0) - (baseOrderIndex.get(rightModel) ?? 0);
  });
}

export function buildMatrixRows(
  baseSourceRows: MatrixInputRow[],
  coveragePrunedRows: MatrixInputRow[],
  showDuplicateRows: boolean,
  displaySourceValuesInCells: boolean,
  activeSource: string,
  sourceValueMode: SourceValueMode = "latest"
): MatrixRow[] {
  const matrixMap = new Map<
    string,
    MatrixRow & {
      categoryValues: string[];
      benchmarkValues: string[];
    }
  >();

  const prunedGroupingKeys = new Set<string>();
  coveragePrunedRows.forEach((row) => {
    prunedGroupingKeys.add(getMatrixGroupingKey(row, showDuplicateRows));
  });

  baseSourceRows.forEach((row, rowIndex) => {
    const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
    if (!prunedGroupingKeys.has(matrixKey)) return;

    const category = row.benchmarkType || "General";
    const benchmark = row.benchmarkName;
    const normalizedModalities = normalizeModalityList(row.modalities, row.benchmarkType);
    const initialHigherIsBetter = typeof row.higherIsBetter === "boolean"
      ? row.higherIsBetter
      : !isLowerBetterBenchmark(row.benchmarkName, row.benchmarkType);

    if (!matrixMap.has(matrixKey)) {
      matrixMap.set(matrixKey, {
        rowKey: matrixKey,
        category,
        benchmark,
        higherIsBetter: initialHigherIsBetter,
        categoryValues: [category],
        benchmarkValues: [benchmark],
        modalities: normalizedModalities,
        cells: new Map<string, MatrixCell>(),
        firstSeenIndex: rowIndex,
        sourceOrderKey: typeof row.recordId === "number" ? row.recordId : null,
        rowDataCount: 0,
        rowNumericCount: 0,
        minComparable: null,
        maxComparable: null,
        minComparable2: null,
        maxComparable2: null,
        minNum: null,
        maxNum: null,
        minNum2: null,
        maxNum2: null
      });
    }

    const matrixRow = matrixMap.get(matrixKey)!;

    if (row.higherIsBetter === false) {
      matrixRow.higherIsBetter = false;
    }

    if (typeof row.recordId === "number") {
      if (matrixRow.sourceOrderKey === null || row.recordId < matrixRow.sourceOrderKey) {
        matrixRow.sourceOrderKey = row.recordId;
      }
    }

    if (!matrixRow.categoryValues.includes(category)) {
      matrixRow.categoryValues.push(category);
      matrixRow.category = matrixRow.categoryValues.join(" / ");
    }

    if (!matrixRow.benchmarkValues.includes(benchmark)) {
      matrixRow.benchmarkValues.push(benchmark);
      matrixRow.benchmark = showDuplicateRows
        ? matrixRow.benchmarkValues.join(" / ")
        : pickPreferredBenchmarkDisplayName(matrixRow.benchmark, benchmark);
    }

    matrixRow.modalities = normalizeModalityList(
      [...matrixRow.modalities, ...normalizedModalities],
      matrixRow.categoryValues[0] ?? "General"
    );
  });

  coveragePrunedRows.forEach((row) => {
    const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
    const matrixRow = matrixMap.get(matrixKey);
    if (!matrixRow) {
      return;
    }

    if (!matrixRow.cells.has(row.modelName)) {
      const initialEntry: MatrixCellEntry = {
        recordId: row.recordId ?? null,
        valueRaw: row.valueRaw,
        valueNum: row.valueNum,
        valueNum2: row.valueNum2 ?? null,
        valueNote: row.valueNote ?? null,
        source: row.source ?? null,
        benchTime: row.benchTime
      };
      const noteText = (row.valueNote ?? "").trim();

      matrixRow.cells.set(row.modelName, {
        valueRaw: row.valueRaw,
        valueNum: row.valueNum,
        valueNum2: row.valueNum2 ?? null,
        valueNote: row.valueNote ?? null,
        source: row.source ?? null,
        benchTime: row.benchTime,
        allEntries: [initialEntry],
        hasMultipleValues: false,
        uniqueEntries: [initialEntry],
        noteText,
        displayValue: getMatrixCellDisplayValue(row.valueNum, row.valueNum2 ?? null, row.valueRaw, row.valueNote ?? null),
        hasMeaningfulMultipleValues: false,
        hasMultipleActiveSourceValues: false,
        shouldShowQuestionMark: noteText.length > 0 && noteText.toLowerCase() !== "x"
      });
    } else {
      const existingCell = matrixRow.cells.get(row.modelName)!;
      existingCell.allEntries.push({
        recordId: row.recordId ?? null,
        valueRaw: row.valueRaw,
        valueNum: row.valueNum,
        valueNum2: row.valueNum2 ?? null,
        valueNote: row.valueNote ?? null,
        source: row.source ?? null,
        benchTime: row.benchTime
      });
      existingCell.hasMultipleValues = existingCell.allEntries.length > 1;

      const cellHigherIsBetter = matrixRow.higherIsBetter;
      const isCellBetter =
        row.valueNum !== null &&
        existingCell.valueNum !== null &&
        (cellHigherIsBetter
          ? row.valueNum > existingCell.valueNum
          : row.valueNum < existingCell.valueNum);
      if (row.valueNum !== null && (existingCell.valueNum === null || isCellBetter)) {
        existingCell.valueNum = row.valueNum;
        existingCell.valueNum2 = row.valueNum2 ?? null;
        existingCell.valueRaw = row.valueRaw;
        existingCell.valueNote = row.valueNote ?? null;
        existingCell.source = row.source ?? null;
        existingCell.benchTime = row.benchTime;
      }
    }
  });

  return Array.from(matrixMap.values())
    .map((matrixRow) => {
      const finalizedCells = new Map<string, MatrixCell>();

      matrixRow.cells.forEach((cell, modelName) => {
        if (cell.allEntries.length === 1) {
          finalizedCells.set(modelName, cell);
          return;
        }

        const uniqueEntriesMap = new Map<string, MatrixCellEntry>();
        cell.allEntries.forEach((entry) => {
          const dedupKey = getMatrixCellSourceValueDedupKey(entry);
          const existing = uniqueEntriesMap.get(dedupKey);
          if (!existing || compareMatrixCellEntryRecency(entry, existing) > 0) {
            uniqueEntriesMap.set(dedupKey, entry);
          }
        });

        const uniqueEntries = Array.from(uniqueEntriesMap.values());
        const valueIdentitySet = new Set(uniqueEntries.map((entry) => getMatrixCellValueIdentity(entry)));
        const hasMeaningfulMultipleValues = uniqueEntries.length > 1 && valueIdentitySet.size > 1;
        // uniqueEntries 已按「source + 值」去重，当前 source 仍剩多条即代表该 source 内部存在不同取值
        const hasMultipleActiveSourceValues = activeSource !== SOURCE_ALL
          && uniqueEntries.filter((entry) => getSourceKey(entry.source) === activeSource).length > 1;
        // 目前 Source 原值展示并非只认当前 activeSource：当前 source 无记录时会回退到跨 source 的最优值；
        // 命中当前 source 时，多次导入取最新一条（见 getSourceValueEntry）
        const sourceEntry = displaySourceValuesInCells && hasMeaningfulMultipleValues
          ? getSourceValueEntry(uniqueEntries, activeSource, matrixRow.higherIsBetter, sourceValueMode)
          : null;
        // Artificial Analysis 默认展示最新值；其余 source 仍用中位数
        const aggregate = aggregateMatrixCellEntries(
          cell.allEntries,
          matrixRow.higherIsBetter,
          resolveMatrixCellAggregateModeFromEntries(cell.allEntries)
        );
        // 没有 sourceEntry 时整格都以聚合出的那条记录为准：数值、原始文本、货币符号、星标、
        // source 与 benchTime 必须同源，否则会出现「显示 $9.00、排序按 5」这类错位
        const fallbackEntry = aggregate.entry;
        const effectiveValueRaw = sourceEntry ? sourceEntry.valueRaw : fallbackEntry?.valueRaw ?? cell.valueRaw;
        const effectiveValueNum = sourceEntry ? sourceEntry.valueNum : aggregate.valueNum;
        const effectiveValueNum2 = sourceEntry ? sourceEntry.valueNum2 : aggregate.valueNum2;
        const effectiveValueNote = sourceEntry ? sourceEntry.valueNote : fallbackEntry?.valueNote ?? cell.valueNote;
        const effectiveSource = sourceEntry ? sourceEntry.source : fallbackEntry?.source ?? cell.source;
        const effectiveBenchTime = sourceEntry ? sourceEntry.benchTime : fallbackEntry?.benchTime ?? cell.benchTime;
        const noteText = (effectiveValueNote ?? "").trim();

        finalizedCells.set(modelName, {
          ...cell,
          valueRaw: effectiveValueRaw,
          valueNum: effectiveValueNum,
          valueNum2: effectiveValueNum2,
          valueNote: effectiveValueNote,
          source: effectiveSource,
          benchTime: effectiveBenchTime,
          uniqueEntries,
          noteText,
          displayValue: getMatrixCellDisplayValue(effectiveValueNum, effectiveValueNum2, effectiveValueRaw, effectiveValueNote),
          hasMeaningfulMultipleValues,
          hasMultipleActiveSourceValues,
          shouldShowQuestionMark: hasMeaningfulMultipleValues || (noteText.length > 0 && noteText.toLowerCase() !== "x")
        });
      });

      const numericValues = Array.from(finalizedCells.values())
        .map((cell) => cell.valueNum)
        .filter((value): value is number => value !== null && Number.isFinite(value));

      const numericValues2 = Array.from(finalizedCells.values())
        .map((cell) => cell.valueNum2)
        .filter((value): value is number => value !== null && Number.isFinite(value));

      const comparableValues = numericValues.map((valueNum) =>
        getBenchmarkComparableScore(matrixRow.benchmark, valueNum, matrixRow.category, matrixRow.higherIsBetter)
      );

      const comparableValues2 = numericValues2.map((valueNum) =>
        getBenchmarkComparableScore(matrixRow.benchmark, valueNum, matrixRow.category, matrixRow.higherIsBetter)
      );

      const rowDataCount = matrixRow.cells.size;
      const rowNumericCount = numericValues.length;

      return {
        ...matrixRow,
        cells: finalizedCells,
        rowDataCount,
        rowNumericCount,
        minComparable: comparableValues.length > 0 ? Math.min(...comparableValues) : null,
        maxComparable: comparableValues.length > 0 ? Math.max(...comparableValues) : null,
        minComparable2: comparableValues2.length > 0 ? Math.min(...comparableValues2) : null,
        maxComparable2: comparableValues2.length > 0 ? Math.max(...comparableValues2) : null,
        minNum: numericValues.length > 0 ? Math.min(...numericValues) : null,
        maxNum: numericValues.length > 0 ? Math.max(...numericValues) : null,
        minNum2: numericValues2.length > 0 ? Math.min(...numericValues2) : null,
        maxNum2: numericValues2.length > 0 ? Math.max(...numericValues2) : null
      };
    })
    .filter((row) => row.rowDataCount > 0)
    .sort((a, b) => a.firstSeenIndex - b.firstSeenIndex);
}

export function filterMatrixRowsByModalities(matrixRows: MatrixRow[], selectedModalitySet: Set<string>): MatrixRow[] {
  if (selectedModalitySet.size === 0) return [];

  return matrixRows.filter((row) => row.modalities.some((modality) => selectedModalitySet.has(modality)));
}

export function filterMatrixRowsByPresence(
  modalityFilteredMatrixRows: MatrixRow[],
  rowPresenceFilterModel: string | null
): MatrixRow[] {
  if (!rowPresenceFilterModel) return modalityFilteredMatrixRows;

  return modalityFilteredMatrixRows.filter((row) => {
    const cell = row.cells.get(rowPresenceFilterModel);
    if (!cell) return false;
    return cell.displayValue.trim() !== "--";
  });
}

export function buildDisplayedCoverageMetaByModel(
  allModelNames: string[],
  coveredModelsByGroupingKey: Map<string, Set<string>>,
  presenceFilteredMatrixRows: MatrixRow[],
  extraCoverageRows: MatrixRow[] = []
): DisplayedCoverageMetaByModel {
  const displayedRowKeys = Array.from(new Set([
    ...presenceFilteredMatrixRows.map((row) => row.rowKey)
  ]));
  const displayedRowCount = displayedRowKeys.length + extraCoverageRows.length;
  const coveredRowCountByModel = new Map<string, number>();
  const candidateModelSet = new Set(allModelNames);

  displayedRowKeys.forEach((rowKey) => {
    const coveredModels = coveredModelsByGroupingKey.get(rowKey);
    if (!coveredModels || coveredModels.size === 0) return;

    coveredModels.forEach((modelName) => {
      if (!candidateModelSet.has(modelName)) return;
      coveredRowCountByModel.set(modelName, (coveredRowCountByModel.get(modelName) ?? 0) + 1);
    });
  });

  extraCoverageRows.forEach((row) => {
    row.cells.forEach((cell, modelName) => {
      if (!candidateModelSet.has(modelName)) return;
      if (cell.valueNum === null || !Number.isFinite(cell.valueNum)) return;
      coveredRowCountByModel.set(modelName, (coveredRowCountByModel.get(modelName) ?? 0) + 1);
    });
  });

  const metaMap = new Map<string, { coveredCount: number; coverageRate: number }>();
  allModelNames.forEach((modelName) => {
    const coveredCount = coveredRowCountByModel.get(modelName) ?? 0;
    metaMap.set(modelName, {
      coveredCount,
      coverageRate: displayedRowCount > 0 ? coveredCount / displayedRowCount : 0
    });
  });

  return {
    displayedRowCount,
    metaMap
  };
}

function createPriceCell(value: number | null, benchTime: string | null): MatrixCell {
  const displayValue = value === null || !Number.isFinite(value)
    ? "--"
    : formatPricePerMillion(value);
  const valueRaw = displayValue;
  const entry: MatrixCellEntry = {
    valueRaw,
    valueNum: value,
    valueNum2: null,
    valueNote: null,
    source: "models.dev",
    benchTime
  };

  return {
    valueRaw,
    valueNum: value,
    valueNum2: null,
    valueNote: null,
    source: "models.dev",
    benchTime,
    allEntries: [entry],
    hasMultipleValues: false,
    uniqueEntries: [entry],
    noteText: "",
    displayValue,
    hasMeaningfulMultipleValues: false,
    hasMultipleActiveSourceValues: false,
    shouldShowQuestionMark: false
  };
}

export function buildPriceMatrixRows(
  modelColumns: readonly string[],
  modelPrices: readonly ModelPriceInfo[]
): MatrixRow[] {
  const priceByModel = new Map(modelPrices.map((price) => [price.modelName, price]));
  const definitions: Array<{ rowKey: string; benchmark: string; pick: (price: ModelPriceInfo) => number | null }> = [
    { rowKey: PRICE_INPUT_ROW_KEY, benchmark: "Input Price", pick: (price) => price.inputCost },
    { rowKey: PRICE_OUTPUT_ROW_KEY, benchmark: "Output Price", pick: (price) => price.outputCost },
    { rowKey: PRICE_CACHE_INPUT_ROW_KEY, benchmark: "Cache Input Price", pick: (price) => price.cacheReadCost }
  ];

  return definitions.map((definition, index) => {
    const cells = new Map<string, MatrixCell>();
    modelColumns.forEach((modelName) => {
      const price = priceByModel.get(modelName);
      const value = price ? definition.pick(price) : null;
      cells.set(modelName, createPriceCell(value, price?.lastSyncedAt ?? price?.updatedAt ?? null));
    });

    const numericValues = Array.from(cells.values())
      .map((cell) => cell.valueNum)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const comparableValues = numericValues.map((value) => -value);

    return {
      rowKey: definition.rowKey,
      category: PRICE_CATEGORY_LABEL,
      benchmark: definition.benchmark,
      higherIsBetter: false,
      modalities: ["Text"],
      cells,
      firstSeenIndex: -100 + index,
      sourceOrderKey: null,
      rowDataCount: cells.size,
      rowNumericCount: numericValues.length,
      minComparable: comparableValues.length > 0 ? Math.min(...comparableValues) : null,
      maxComparable: comparableValues.length > 0 ? Math.max(...comparableValues) : null,
      minComparable2: null,
      maxComparable2: null,
      minNum: numericValues.length > 0 ? Math.min(...numericValues) : null,
      maxNum: numericValues.length > 0 ? Math.max(...numericValues) : null,
      minNum2: null,
      maxNum2: null,
      isPriceRow: true
    };
  });
}

/**
 * 参数量单元格。
 *
 * `valueNum` 存总参数量而非激活量：列排序、排名弹窗都以它为准，
 * 稠密与 MoE 模型才能放在同一把尺子上比。展示顺序（激活 / 总量）由
 * `displayValue` 单独控制，因此 `valueNum2` 保持 null，避免走 pair 渲染
 * 路径把顺序倒过来。
 */
function createParamsCell(params: ModelParamsInfo | undefined): MatrixCell {
  const total = params?.totalParamsB ?? null;
  const activated = params?.activatedParamsB ?? null;
  const primary = total ?? activated;

  const displayValue = primary === null
    ? "--"
    : total !== null && activated !== null
      ? `${formatParamsBillions(activated)} / ${formatParamsBillions(total)}`
      : formatParamsBillions(primary);

  const noteParts: string[] = [];
  if (params?.isEstimated) noteParts.push("估算值");
  if (total !== null && activated !== null) noteParts.push("MoE（激活 / 总量）");
  if (params?.note) noteParts.push(params.note);
  const noteText = noteParts.join("；");

  const entry: MatrixCellEntry = {
    valueRaw: displayValue,
    valueNum: primary,
    valueNum2: null,
    valueNote: noteText || null,
    source: "model-info",
    benchTime: null
  };

  return {
    valueRaw: displayValue,
    valueNum: primary,
    valueNum2: null,
    valueNote: noteText || null,
    source: "model-info",
    benchTime: null,
    allEntries: [entry],
    hasMultipleValues: false,
    uniqueEntries: [entry],
    noteText,
    displayValue,
    hasMeaningfulMultipleValues: false,
    hasMultipleActiveSourceValues: false,
    shouldShowQuestionMark: false
  };
}

function createActiveRatioCell(params: ModelParamsInfo | undefined): MatrixCell {
  const total = params?.totalParamsB ?? null;
  const activated = params?.activatedParamsB ?? null;
  const ratio = total !== null && activated !== null && total > 0
    ? (activated / total) * 100
    : null;

  const displayValue = ratio === null ? "--" : `${ratio.toFixed(1)}%`;
  const entry: MatrixCellEntry = {
    valueRaw: displayValue,
    valueNum: ratio,
    valueNum2: null,
    valueNote: null,
    source: "model-info",
    benchTime: null
  };

  return {
    valueRaw: displayValue,
    valueNum: ratio,
    valueNum2: null,
    valueNote: null,
    source: "model-info",
    benchTime: null,
    allEntries: [entry],
    hasMultipleValues: false,
    uniqueEntries: [entry],
    noteText: "",
    displayValue,
    hasMeaningfulMultipleValues: false,
    hasMultipleActiveSourceValues: false,
    shouldShowQuestionMark: false
  };
}

export function buildParamsMatrixRows(
  modelColumns: readonly string[],
  modelParams: readonly ModelParamsInfo[]
): MatrixRow[] {
  const paramsByModel = new Map(modelParams.map((params) => [params.modelName, params]));
  const definitions: Array<{
    rowKey: string;
    benchmark: string;
    build: (params: ModelParamsInfo | undefined) => MatrixCell;
  }> = [
    { rowKey: PARAMS_ROW_KEY, benchmark: "Params", build: createParamsCell },
    { rowKey: PARAMS_ACTIVE_RATIO_ROW_KEY, benchmark: "Activated %", build: createActiveRatioCell }
  ];

  return definitions.map((definition, index) => {
    const cells = new Map<string, MatrixCell>();
    modelColumns.forEach((modelName) => {
      cells.set(modelName, definition.build(paramsByModel.get(modelName)));
    });

    const numericValues = Array.from(cells.values())
      .map((cell) => cell.valueNum)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const comparableValues = numericValues.map((value) => -value);

    return {
      rowKey: definition.rowKey,
      category: MODEL_INFO_CATEGORY_LABEL,
      benchmark: definition.benchmark,
      // 参数量与激活占比都以小为好：同等水位下更小的模型更划算
      higherIsBetter: false,
      modalities: ["Text"],
      cells,
      // 排在价格行（-100）之前
      firstSeenIndex: -200 + index,
      sourceOrderKey: null,
      rowDataCount: cells.size,
      rowNumericCount: numericValues.length,
      minComparable: comparableValues.length > 0 ? Math.min(...comparableValues) : null,
      maxComparable: comparableValues.length > 0 ? Math.max(...comparableValues) : null,
      minComparable2: null,
      maxComparable2: null,
      minNum: numericValues.length > 0 ? Math.min(...numericValues) : null,
      maxNum: numericValues.length > 0 ? Math.max(...numericValues) : null,
      minNum2: null,
      maxNum2: null,
      isInfoRow: true
    };
  });
}

export function parseReleaseDateToTimestamp(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/\//g, "-");
  const normalized = /^\d{4}-\d{1,2}$/.test(cleaned) ? `${cleaned}-01` : cleaned;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const ms = Date.UTC(year, month, day);
      return Number.isFinite(ms) ? ms : null;
    }
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function createReleaseDateCell(price: ModelPriceInfo | undefined): MatrixCell {
  const rawDate = price?.releaseDate?.trim() || null;
  const timestamp = parseReleaseDateToTimestamp(rawDate);
  const displayValue = rawDate ?? "--";

  const entry: MatrixCellEntry = {
    valueRaw: displayValue,
    valueNum: timestamp,
    valueNum2: null,
    valueNote: null,
    source: "models.dev",
    benchTime: null
  };

  return {
    valueRaw: displayValue,
    valueNum: timestamp,
    valueNum2: null,
    valueNote: null,
    source: "models.dev",
    benchTime: null,
    allEntries: [entry],
    hasMultipleValues: false,
    uniqueEntries: [entry],
    noteText: "",
    displayValue,
    hasMeaningfulMultipleValues: false,
    hasMultipleActiveSourceValues: false,
    shouldShowQuestionMark: false
  };
}

export function buildReleaseDateMatrixRow(
  modelColumns: readonly string[],
  modelPrices: readonly ModelPriceInfo[]
): MatrixRow {
  const priceByModel = new Map(modelPrices.map((price) => [price.modelName, price]));
  const cells = new Map<string, MatrixCell>();

  modelColumns.forEach((modelName) => {
    cells.set(modelName, createReleaseDateCell(priceByModel.get(modelName)));
  });

  const numericValues = Array.from(cells.values())
    .map((cell) => cell.valueNum)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  return {
    rowKey: RELEASE_DATE_ROW_KEY,
    category: MODEL_INFO_CATEGORY_LABEL,
    benchmark: "Release Date",
    higherIsBetter: true,
    modalities: ["Text"],
    cells,
    firstSeenIndex: -205,
    sourceOrderKey: null,
    rowDataCount: cells.size,
    rowNumericCount: numericValues.length,
    minComparable: numericValues.length > 0 ? Math.min(...numericValues) : null,
    maxComparable: numericValues.length > 0 ? Math.max(...numericValues) : null,
    minComparable2: null,
    maxComparable2: null,
    minNum: numericValues.length > 0 ? Math.min(...numericValues) : null,
    maxNum: numericValues.length > 0 ? Math.max(...numericValues) : null,
    minNum2: null,
    maxNum2: null,
    isInfoRow: true
  };
}

function buildRankingDataFromMatrixRow(
  matrixRow: MatrixRow,
  candidateModelNames: readonly string[],
  visibleModelNames: readonly string[],
  scaleMode: BenchmarkRankingScaleMode
): BenchmarkRankingData {
  const candidateModelSet = new Set(candidateModelNames);
  const visibleModelSet = new Set(visibleModelNames);
  const lowerIsBetter = Boolean(matrixRow.isPriceRow) || !matrixRow.higherIsBetter;
  const numericItems = Array.from(candidateModelSet)
    .map((modelName) => {
      const cell = matrixRow.cells.get(modelName);
      const valueNum = cell?.valueNum ?? null;
      if (valueNum === null || !Number.isFinite(valueNum)) return null;

      return {
        modelName,
        displayValue: cell?.displayValue ?? String(valueNum),
        valueNum,
        comparableScore: getMatrixRowComparableScore(matrixRow, valueNum),
        rank: 0,
        barPercent: 0,
        isVisibleColumn: visibleModelSet.has(modelName),
        cell
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const rankMap = buildDenseRankMap(
    numericItems.map((item) => ({ modelName: item.modelName, score: item.comparableScore })),
    2
  );
  const comparableValues = numericItems.map((item) => item.comparableScore);
  const minComparable = comparableValues.length > 0 ? Math.min(...comparableValues) : null;
  const maxComparable = comparableValues.length > 0 ? Math.max(...comparableValues) : null;
  const comparableRange =
    minComparable !== null && maxComparable !== null
      ? maxComparable - minComparable
      : 0;
  const rawValues = numericItems.map((item) => item.valueNum);
  const canUseFixedScale =
    !matrixRow.isPriceRow &&
    !matrixRow.isInfoRow &&
    rawValues.length > 0 &&
    rawValues.every((value) => value >= 0 && value <= 100);
  const fixedScaleMax = canUseFixedScale && rawValues.every((value) => value >= 0 && value <= 1)
    ? 1
    : 100;
  const effectiveScaleMode = scaleMode === "fixed" && canUseFixedScale ? "fixed" : "relative";
  const scaleLabel = effectiveScaleMode === "fixed"
    ? `0-${fixedScaleMax}`
    : matrixRow.isPriceRow && scaleMode === "fixed"
      ? "Relative price range"
      : "Relative range";

  const items = numericItems
    .map((item) => {
      const toPercent = (scoreVal: number, rawVal: number) => {
        const normalized = effectiveScaleMode === "fixed"
          ? lowerIsBetter
            ? (fixedScaleMax - rawVal) / fixedScaleMax
            : rawVal / fixedScaleMax
          : comparableRange > Number.EPSILON && minComparable !== null
            ? (scoreVal - minComparable) / comparableRange
            : 1;
        return Math.max(0, Math.min(100, normalized * 100));
      };

      const primaryPercent = toPercent(item.comparableScore, item.valueNum);
      const clampedPercent = Math.max(0, Math.min(100, primaryPercent));

      const allEntries = item.cell?.allEntries ?? [];
      const validEntries = allEntries
        .map((entry) => {
          const val = entry.valueNum;
          if (val === null || !Number.isFinite(val)) return null;
          return {
            rawVal: val,
            scoreVal: getMatrixRowComparableScore(matrixRow, val)
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      let boxplot = null;
      if (validEntries.length >= 2) {
        const percents = validEntries.map((e) => toPercent(e.scoreVal, e.rawVal));
        const rawVals = validEntries.map((e) => e.rawVal);

        // percents 已按指标方向归一（越大越优），raw 值则要按 lowerIsBetter 选更优的一侧，
        // 两者才会落在同一条记录上
        const stats = calculateBoxPlotStats(percents, { medianMode: "upper" });
        const rawStats = calculateBoxPlotStats(rawVals, { medianMode: lowerIsBetter ? "lower" : "upper" });

        boxplot = {
          min: stats.min,
          q1: stats.q1,
          median: stats.median,
          q3: stats.q3,
          max: stats.max,
          outliers: stats.outliers,
          count: stats.count,
          rawMin: rawStats.min,
          rawQ1: rawStats.q1,
          rawMedian: rawStats.median,
          rawQ3: rawStats.q3,
          rawMax: rawStats.max,
          rawOutliers: rawStats.outliers
        };
      }

      return {
        modelName: item.modelName,
        displayValue: item.displayValue,
        valueNum: item.valueNum,
        comparableScore: item.comparableScore,
        rank: rankMap.get(item.modelName) ?? 0,
        barPercent: effectiveScaleMode === "relative"
          ? Math.max(7, clampedPercent)
          : clampedPercent > 0
            ? Math.max(4, clampedPercent)
            : 0,
        isVisibleColumn: item.isVisibleColumn,
        boxplot,
        allEntries: item.cell?.allEntries ?? [],
        noteText: item.cell?.noteText ?? ""
      };
    })
    .sort((left, right) => {
      if (right.comparableScore !== left.comparableScore) {
        return right.comparableScore - left.comparableScore;
      }
      return left.modelName.localeCompare(right.modelName, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    });

  return {
    rowKey: matrixRow.rowKey,
    benchmark: matrixRow.benchmark,
    category: matrixRow.category,
    isPriceRow: Boolean(matrixRow.isPriceRow),
    lowerIsBetter,
    scaleMode,
    effectiveScaleMode,
    scaleLabel,
    rankedModelCount: items.length,
    missingModelCount: Math.max(0, candidateModelSet.size - items.length),
    items
  };
}

export function buildBenchmarkRankingData(
  matrixRow: MatrixRow,
  sourceRows: readonly MatrixInputRow[],
  candidateModelNames: readonly string[],
  visibleModelNames: readonly string[],
  showDuplicateRows: boolean,
  scaleMode: BenchmarkRankingScaleMode
): BenchmarkRankingData {
  if (matrixRow.isPriceRow || matrixRow.isInfoRow) {
    return buildRankingDataFromMatrixRow(matrixRow, candidateModelNames, visibleModelNames, scaleMode);
  }

  const matchingRows = sourceRows.filter((row) => getMatrixGroupingKey(row, showDuplicateRows) === matrixRow.rowKey);
  const cellsByModel = new Map<string, MatrixCell>();
  const candidateModelSet = new Set(candidateModelNames);

  matchingRows.forEach((row) => {
    if (!candidateModelSet.has(row.modelName)) return;

    const rowValueNum = row.valueNum;
    const rowValueNum2 = row.valueNum2 ?? null;
    const rowValueNote = row.valueNote ?? null;
    const entry = {
      valueRaw: row.valueRaw,
      valueNum: rowValueNum,
      valueNum2: rowValueNum2,
      valueNote: rowValueNote,
      source: row.source ?? null,
      benchTime: row.benchTime
    };

    const previous = cellsByModel.get(row.modelName);
    if (!previous) {
      const noteText = (rowValueNote ?? "").trim();
      const rowCell: MatrixCell = {
        valueRaw: row.valueRaw,
        valueNum: rowValueNum,
        valueNum2: rowValueNum2,
        valueNote: rowValueNote,
        source: row.source ?? null,
        benchTime: row.benchTime,
        allEntries: [entry],
        hasMultipleValues: false,
        uniqueEntries: [entry],
        noteText,
        displayValue: getMatrixCellDisplayValue(rowValueNum, rowValueNum2, row.valueRaw, rowValueNote),
        hasMeaningfulMultipleValues: false,
        hasMultipleActiveSourceValues: false,
        shouldShowQuestionMark: noteText.length > 0 && noteText.toLowerCase() !== "x"
      };
      cellsByModel.set(row.modelName, rowCell);
    } else {
      previous.allEntries.push(entry);
      previous.hasMultipleValues = previous.allEntries.length > 1;

      if (rowValueNum !== null && Number.isFinite(rowValueNum)) {
        if (previous.valueNum === null || !Number.isFinite(previous.valueNum)) {
          previous.valueRaw = row.valueRaw;
          previous.valueNum = rowValueNum;
          previous.valueNum2 = rowValueNum2;
          previous.valueNote = rowValueNote;
          previous.source = row.source ?? null;
          previous.benchTime = row.benchTime;
          previous.displayValue = getMatrixCellDisplayValue(rowValueNum, rowValueNum2, row.valueRaw, rowValueNote);
        } else {
          const previousScore = getMatrixRowComparableScore(matrixRow, previous.valueNum);
          const nextScore = getMatrixRowComparableScore(matrixRow, rowValueNum);
          if (nextScore > previousScore) {
            previous.valueRaw = row.valueRaw;
            previous.valueNum = rowValueNum;
            previous.valueNum2 = rowValueNum2;
            previous.valueNote = rowValueNote;
            previous.source = row.source ?? null;
            previous.benchTime = row.benchTime;
            previous.displayValue = getMatrixCellDisplayValue(rowValueNum, rowValueNum2, row.valueRaw, rowValueNote);
          }
        }
      }
    }
  });

  // 排名弹窗与主表同一口径：按单元格 source 推断，AA 取最新值
  cellsByModel.forEach((cell) => {
    const aggregate = aggregateMatrixCellEntries(
      cell.allEntries,
      matrixRow.higherIsBetter,
      resolveMatrixCellAggregateModeFromEntries(cell.allEntries)
    );
    if (aggregate.entry) {
      cell.valueRaw = aggregate.entry.valueRaw;
      cell.valueNote = aggregate.entry.valueNote;
      cell.source = aggregate.entry.source;
      cell.benchTime = aggregate.entry.benchTime;
    }
    cell.valueNum = aggregate.valueNum;
    cell.valueNum2 = aggregate.valueNum2;
    cell.displayValue = getMatrixCellDisplayValue(cell.valueNum, cell.valueNum2, cell.valueRaw, cell.valueNote);
  });

  const rankingMatrixRow: MatrixRow = {
    ...matrixRow,
    cells: cellsByModel
  };

  return buildRankingDataFromMatrixRow(rankingMatrixRow, candidateModelNames, visibleModelNames, scaleMode);
}

export function buildModelCoveragePercentMap(displayedCoverageMetaByModel: DisplayedCoverageMetaByModel): Map<string, number> {
  const map = new Map<string, number>();
  displayedCoverageMetaByModel.metaMap.forEach((meta, modelName) => {
    map.set(modelName, Math.round(meta.coverageRate * 100));
  });
  return map;
}

export function buildProviderAverageCoveragePercentMap(
  providerGroups: ProviderGroup[],
  displayedCoverageMetaByModel: DisplayedCoverageMetaByModel
): Map<string, number> {
  const map = new Map<string, number>();

  providerGroups.forEach((group) => {
    if (group.models.length === 0) {
      map.set(group.providerName, 0);
      return;
    }

    const totalCoverage = group.models.reduce((acc, modelName) => {
      return acc + (displayedCoverageMetaByModel.metaMap.get(modelName)?.coverageRate ?? 0);
    }, 0);

    map.set(group.providerName, Math.round((totalCoverage / group.models.length) * 100));
  });

  return map;
}

export function sortMatrixRows(
  presenceFilteredMatrixRows: MatrixRow[],
  rowSortState: { column: RowSortColumn; mode: RowSortMode },
  activeSource: string
): MatrixRow[] {
  const rowsCopy = [...presenceFilteredMatrixRows];
  const effectiveMode = activeSource === SOURCE_ALL && rowSortState.mode === "source"
    ? "data"
    : rowSortState.mode;

  if (effectiveMode === "source") {
    const preferAaCapabilityFirst = isArtificialAnalysisSource(activeSource);

    rowsCopy.sort((a, b) => {
      // 仅 AA 页签：Cost / Performance 沉底，其余评测指标保持 source 序
      if (preferAaCapabilityFirst) {
        const leftSecondary = isAaSecondaryCategory(a.category) ? 1 : 0;
        const rightSecondary = isAaSecondaryCategory(b.category) ? 1 : 0;
        if (leftSecondary !== rightSecondary) {
          return leftSecondary - rightSecondary;
        }
      }

      const leftSourceOrder = a.sourceOrderKey;
      const rightSourceOrder = b.sourceOrderKey;

      if (leftSourceOrder !== null && rightSourceOrder !== null && leftSourceOrder !== rightSourceOrder) {
        return leftSourceOrder - rightSourceOrder;
      }

      if (leftSourceOrder !== null && rightSourceOrder === null) {
        return -1;
      }

      if (leftSourceOrder === null && rightSourceOrder !== null) {
        return 1;
      }

      return a.firstSeenIndex - b.firstSeenIndex;
    });
    return rowsCopy;
  }

  if (effectiveMode === "data") {
    if (rowSortState.column === "category") {
      const categoryDataTotals = new Map<string, number>();
      rowsCopy.forEach((row) => {
        categoryDataTotals.set(row.category, (categoryDataTotals.get(row.category) ?? 0) + row.rowDataCount);
      });

      rowsCopy.sort((a, b) => {
        const totalDiff = (categoryDataTotals.get(b.category) ?? 0) - (categoryDataTotals.get(a.category) ?? 0);
        if (totalDiff !== 0) return totalDiff;

        const categoryCompare = a.category.localeCompare(b.category, "zh-Hans-CN", { sensitivity: "base" });
        if (categoryCompare !== 0) return categoryCompare;

        if (a.rowDataCount !== b.rowDataCount) {
          return b.rowDataCount - a.rowDataCount;
        }

        return a.firstSeenIndex - b.firstSeenIndex;
      });
      return rowsCopy;
    }

    rowsCopy.sort((a, b) => {
      if (a.rowDataCount !== b.rowDataCount) {
        return b.rowDataCount - a.rowDataCount;
      }
      if (a.rowNumericCount !== b.rowNumericCount) {
        return b.rowNumericCount - a.rowNumericCount;
      }
      return a.firstSeenIndex - b.firstSeenIndex;
    });
    return rowsCopy;
  }

  const sortField: RowSortColumn = rowSortState.column;
  rowsCopy.sort((a, b) => {
    const left = sortField === "category" ? a.category : a.benchmark;
    const right = sortField === "category" ? b.category : b.benchmark;
    const compare = left.localeCompare(right, "zh-Hans-CN", { sensitivity: "base" });
    if (compare !== 0) return compare;
    return a.firstSeenIndex - b.firstSeenIndex;
  });
  return rowsCopy;
}

export function buildHeaderUniqueCounts(presenceFilteredMatrixRows: MatrixRow[]): HeaderUniqueCounts {
  const uniqueCategories = new Set<string>();
  const uniqueBenchmarks = new Set<string>();

  presenceFilteredMatrixRows.forEach((row) => {
    uniqueCategories.add(row.category);
    uniqueBenchmarks.add(row.rowKey);
  });

  return {
    category: uniqueCategories.size,
    benchmark: uniqueBenchmarks.size
  };
}

export function buildOverallSummaryByModel(
  presenceFilteredMatrixRows: MatrixRow[],
  modelColumns: readonly string[]
): Map<string, OverallModelSummary> {
  const aggregateByModel = new Map<string, { sum: number; count: number }>();
  modelColumns.forEach((modelName) => {
    aggregateByModel.set(modelName, { sum: 0, count: 0 });
  });

  let totalComparableRows = 0;

  presenceFilteredMatrixRows.forEach((row) => {
    const rowEntries: Array<{ modelName: string; original: number; comparable: number }> = [];

    modelColumns.forEach((modelName) => {
      const cell = row.cells.get(modelName);
      const valueNum = cell?.valueNum;

      if (valueNum === null || valueNum === undefined || !Number.isFinite(valueNum)) {
        return;
      }

      rowEntries.push({
        modelName,
        original: valueNum,
        comparable: getMatrixRowComparableScore(row, valueNum)
      });
    });

    if (rowEntries.length === 0) {
      return;
    }

    totalComparableRows += 1;

    const originalValues = rowEntries.map((entry) => entry.original);
    const minOriginal = Math.min(...originalValues);
    const maxOriginal = Math.max(...originalValues);

    // 价格与模型属性行不是百分制，值域再小也要走对数压缩，不能当成 ratio / percent
    const isSyntheticScaleRow = Boolean(row.isPriceRow) || Boolean(row.isInfoRow);
    const isRatioRow = !isSyntheticScaleRow && minOriginal >= 0 && maxOriginal <= 1.2;
    const isPercentRow = !isSyntheticScaleRow && !isRatioRow && minOriginal >= 0 && maxOriginal <= 100.000001;

    const transformedByEntry = (() => {
      if (isRatioRow) {
        return rowEntries.map((entry) => ({
          modelName: entry.modelName,
          transformed: entry.comparable * 100
        }));
      }

      if (isPercentRow) {
        return rowEntries.map((entry) => ({
          modelName: entry.modelName,
          transformed: entry.comparable
        }));
      }

      const comparableValues = rowEntries.map((entry) => entry.comparable);
      const sortedComparable = [...comparableValues].sort((a, b) => a - b);
      const percentile05 = getSortedQuantile(sortedComparable, 0.05);
      const percentile95 = getSortedQuantile(sortedComparable, 0.95);
      const clippedComparable = comparableValues.map((value) => Math.min(percentile95, Math.max(percentile05, value)));
      const clippedMin = Math.min(...clippedComparable);
      const loggedComparable = clippedComparable.map((value) => Math.log1p(Math.max(0, value - clippedMin)));

      return rowEntries.map((entry, index) => ({
        modelName: entry.modelName,
        transformed: loggedComparable[index] ?? 0
      }));
    })();

    const transformedValues = transformedByEntry.map((entry) => entry.transformed);
    const minTransformed = Math.min(...transformedValues);
    const maxTransformed = Math.max(...transformedValues);

    transformedByEntry.forEach((entry) => {
      const aggregate = aggregateByModel.get(entry.modelName);
      if (!aggregate) return;

      const rowScore = maxTransformed === minTransformed
        ? 50
        : Math.min(100, Math.max(0, ((entry.transformed - minTransformed) / (maxTransformed - minTransformed)) * 100));

      aggregate.sum += rowScore;
      aggregate.count += 1;
    });
  });

  const rawScoreItems = modelColumns.map((modelName) => {
    const aggregate = aggregateByModel.get(modelName) ?? { sum: 0, count: 0 };
    const rawScore = aggregate.count > 0 ? aggregate.sum / aggregate.count : null;
    const coverage = totalComparableRows > 0 ? aggregate.count / totalComparableRows : 0;
    const correctionFactor = 0.9 + 0.1 * coverage;
    const correctedScore = rawScore !== null ? rawScore * correctionFactor : null;

    return {
      modelName,
      rawScore,
      correctedScore,
      coveredRows: aggregate.count,
      totalRows: totalComparableRows,
      coverage,
      correctionFactor
    };
  });

  const rawRankMap = buildDenseRankMap(
    rawScoreItems.map((item) => ({ modelName: item.modelName, score: item.rawScore }))
  );
  const correctedRankMap = buildDenseRankMap(
    rawScoreItems.map((item) => ({ modelName: item.modelName, score: item.correctedScore }))
  );

  const summaryMap = new Map<string, OverallModelSummary>();
  rawScoreItems.forEach((item) => {
    summaryMap.set(item.modelName, {
      rawScore: item.rawScore,
      rawRank: item.rawScore !== null ? (rawRankMap.get(item.modelName) ?? null) : null,
      correctedScore: item.correctedScore,
      correctedRank: item.correctedScore !== null ? (correctedRankMap.get(item.modelName) ?? null) : null,
      coverage: item.coverage,
      coveredRows: item.coveredRows,
      totalRows: item.totalRows,
      correctionFactor: item.correctionFactor
    });
  });

  return summaryMap;
}

export function buildOverallHeatRange(
  modelColumns: readonly string[],
  overallSummaryByModel: Map<string, OverallModelSummary>
): OverallHeatRange {
  const rawScores = modelColumns
    .map((modelName) => overallSummaryByModel.get(modelName)?.rawScore)
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));

  if (rawScores.length === 0) {
    return {
      minRawScore: null,
      maxRawScore: null
    };
  }

  return {
    minRawScore: Math.min(...rawScores),
    maxRawScore: Math.max(...rawScores)
  };
}

export function buildOverallScoreDisplayDecimalsByModel(
  modelColumns: readonly string[],
  overallSummaryByModel: Map<string, OverallModelSummary>
): Map<string, 1 | 2> {
  const items: OverallScoreDisplayItem[] = modelColumns.map((modelName) => {
    const summary = overallSummaryByModel.get(modelName);
    return {
      modelName,
      rawScore: summary?.rawScore ?? null,
      rawRank: summary?.rawRank ?? null
    };
  });

  return buildOverallScoreDisplayDecimalsMap(items);
}
