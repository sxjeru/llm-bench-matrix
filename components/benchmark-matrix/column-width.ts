import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from "react";
import { resolveProviderBrandColorForDarkTheme } from "@/lib/provider-config";
import {
  BENCHMARK_COLUMN_WIDTH_KEY,
  CATEGORY_COLUMN_WIDTH_KEY,
  COLUMN_WIDTH_STORAGE_DEBOUNCE_MS,
  COMPARE_BADGE_DEFAULT_EXPANDED_WIDTH,
  COMPARE_BASELINE_DEFAULT_EXPANDED_WIDTH,
  DEFAULT_BENCHMARK_COLUMN_WIDTH,
  DEFAULT_CATEGORY_COLUMN_WIDTH,
  DEFAULT_MODEL_COLUMN_BASELINE_WIDTH,
  MAX_BENCHMARK_COLUMN_WIDTH,
  MAX_CATEGORY_COLUMN_WIDTH,
  MAX_MODEL_COLUMN_WIDTH,
  MIN_BENCHMARK_COLUMN_WIDTH,
  MIN_CATEGORY_COLUMN_WIDTH,
  MIN_MODEL_COLUMN_RESIZE_WIDTH
} from "./constants";
import { formatComparisonDeltaValue } from "./formatters";
import {
  getMatrixCellDisplayValue,
  isLowerBetterBenchmark
} from "./scoring";
import type {
  MatrixCellEntry,
  MatrixInputRow,
  ProviderIdentity
} from "./types";
import { saveColumnWidthBySource } from "./persistence";
import {
  areColumnWidthMapsEqual,
  clampColumnWidth,
  compareMatrixCellEntryRecency,
  getLatestMatrixCellEntry,
  resolveMatrixCellAggregateModeFromEntries,
  getColumnWidthOverrideKey,
  getMatrixCellSourceValueDedupKey,
  getMatrixCellValueIdentity,
  getMatrixGroupingKey,
  getModelColumnWidthKey,
  getSourceValueDeltaRaw,
  getSourceValueDisplayItem,
  type SourceValueMode
} from "./utils";
import { isSourceHeaderPrefixMatch } from "./model-matching";

export type ColumnResizeState = {
  columnKey: string;
  startX: number;
  startWidth: number;
  minWidth: number;
  maxWidth: number;
};

export type ModelColumnMeta = {
  modelName: string;
  columnWidthKey: string;
  providerName: string;
  color: string;
  columnWidth: number;
  isSourceMatched: boolean;
  isSourceMatchedFirst: boolean;
  isSourceMatchedLast: boolean;
};

type MutableRefValue<T> = {
  current: T;
};

type SourceMatchedGroupBoundaryByModel = {
  firstSet: Set<string>;
  lastSet: Set<string>;
};

type BuildAutoModelWidthMapOptions = {
  modelColumns: readonly string[];
  coveragePrunedRows: readonly MatrixInputRow[];
  showDuplicateRows: boolean;
  displaySourceValuesInCells: boolean;
  displaySourceValueDeltasInCells: boolean;
  activeSource: string;
  sourceValueMode: SourceValueMode;
};

type BuildModelColumnMetaOptions = {
  modelColumns: readonly string[];
  modelProviderMap: Map<string, ProviderIdentity>;
  modelProviderBrandColorMap: Map<string, string | null>;
  sourceMatchedModelSet: Set<string>;
  sourceMatchedGroupBoundaryByModel: SourceMatchedGroupBoundaryByModel;
  columnWidthOverrideKeySet: Set<string>;
  autoModelWidthMap: Map<string, number>;
  activeColumnWidthMap: Record<string, number>;
  compareModelSet: Set<string>;
  compareBaselineModelName: string | null;
  activeSource: string;
};

type UseMatrixColumnResizeOptions = {
  activeSourceRef: MutableRefValue<string>;
  columnResizeStateRef: MutableRefValue<ColumnResizeState | null>;
  headerInteractionSuppressUntilRef: MutableRefValue<number>;
  resizingColumnKey: string | null;
  setActiveColumnWidthMap: Dispatch<SetStateAction<Record<string, number>>>;
  setColumnWidthOverrideKeys: Dispatch<SetStateAction<readonly string[]>>;
  setResizingColumnKey: Dispatch<SetStateAction<string | null>>;
};

const EMPTY_AUTO_MODEL_WIDTH_MAP: Map<string, number> = new Map();

type UseMatrixColumnWidthsOptions = BuildAutoModelWidthMapOptions & {
  activeSourceRef: MutableRefValue<string>;
  activeColumnWidthMap: Record<string, number>;
  setActiveColumnWidthMap: Dispatch<SetStateAction<Record<string, number>>>;
  columnWidthBySourceRef: MutableRefValue<Record<string, Record<string, number>>>;
  columnWidthPersistTimeoutRef: MutableRefValue<number | null>;
  columnWidthOverrideKeys: readonly string[];
  isColumnWidthLoaded: boolean;
  sourceTabMatchLabel: string;
  modelProviderMap: Map<string, ProviderIdentity>;
  modelProviderBrandColorMap: Map<string, string | null>;
  compareModelSet: Set<string>;
  compareBaselineModelName: string | null;
};

function createMeasureTextWidth(): (text: string, font: string) => number {
  if (typeof document === "undefined") {
    return (text: string) => text.length * 7;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return (text: string) => text.length * 7;
  }

  return (text: string, font: string) => {
    context.font = font;
    return context.measureText(text).width;
  };
}

export function buildAutoModelWidthMap({
  modelColumns,
  coveragePrunedRows,
  showDuplicateRows,
  displaySourceValuesInCells,
  displaySourceValueDeltasInCells,
  activeSource,
  sourceValueMode
}: BuildAutoModelWidthMapOptions): Map<string, number> {
  const map = new Map<string, number>();
  const valueWidthByModel = new Map<string, number>();
  const measureTextWidth = createMeasureTextWidth();
  const entriesByGroup = new Map<string, MatrixCellEntry[]>();
  const preferredEntryByGroup = new Map<string, MatrixCellEntry>();
  const higherIsBetterByGroup = new Map<string, boolean>();
  const modelNameByGroup = new Map<string, string>();

  coveragePrunedRows.forEach((row) => {
    const groupKey = `${getMatrixGroupingKey(row, showDuplicateRows)}::${row.modelName}`;

    const entry: MatrixCellEntry = {
      recordId: row.recordId ?? null,
      valueRaw: row.valueRaw,
      valueNum: row.valueNum,
      valueNum2: row.valueNum2 ?? null,
      valueNote: row.valueNote ?? null,
      source: row.source ?? null,
      benchTime: row.benchTime
    };

    if (!entriesByGroup.has(groupKey)) {
      entriesByGroup.set(groupKey, []);
      const rowHigherIsBetter = typeof row.higherIsBetter === "boolean"
        ? row.higherIsBetter
        : !isLowerBetterBenchmark(row.benchmarkName, row.benchmarkType);
      higherIsBetterByGroup.set(groupKey, rowHigherIsBetter);
    }
    entriesByGroup.get(groupKey)!.push(entry);

    const groupHigherIsBetter = higherIsBetterByGroup.get(groupKey) ?? true;
    const groupEntries = entriesByGroup.get(groupKey) ?? [entry];
    if (resolveMatrixCellAggregateModeFromEntries(groupEntries) === "latest") {
      const latest = getLatestMatrixCellEntry(groupEntries);
      if (latest) preferredEntryByGroup.set(groupKey, latest);
    } else {
      const preferred = preferredEntryByGroup.get(groupKey);
      if (!preferred || (entry.valueNum !== null && (preferred.valueNum === null || (groupHigherIsBetter ? entry.valueNum > preferred.valueNum : entry.valueNum < preferred.valueNum)))) {
        preferredEntryByGroup.set(groupKey, entry);
      }
    }

    modelNameByGroup.set(groupKey, row.modelName);
  });

  entriesByGroup.forEach((entries, groupKey) => {
    const modelName = modelNameByGroup.get(groupKey);
    if (!modelName || entries.length === 0) return;

    const preferredEntry = resolveMatrixCellAggregateModeFromEntries(entries) === "latest"
      ? (getLatestMatrixCellEntry(entries) ?? preferredEntryByGroup.get(groupKey) ?? entries[0]!)
      : (preferredEntryByGroup.get(groupKey) ?? entries[0]!);
    const displayValue = getMatrixCellDisplayValue(
      preferredEntry.valueNum,
      preferredEntry.valueNum2,
      preferredEntry.valueRaw,
      preferredEntry.valueNote
    );

    const uniqueEntriesMap = new Map<string, MatrixCellEntry>();
    entries.forEach((entry) => {
      const dedupKey = getMatrixCellSourceValueDedupKey(entry);
      const existing = uniqueEntriesMap.get(dedupKey);
      if (!existing || compareMatrixCellEntryRecency(entry, existing) > 0) {
        uniqueEntriesMap.set(dedupKey, entry);
      }
    });

    const uniqueEntries = Array.from(uniqueEntriesMap.values());
    const valueIdentitySet = new Set(uniqueEntries.map((entry) => getMatrixCellValueIdentity(entry)));
    const noteText = (preferredEntry.valueNote ?? "").trim();
    const hasMeaningfulMultipleValues = uniqueEntries.length > 1 && valueIdentitySet.size > 1;
    const questionMarkPadding = hasMeaningfulMultipleValues || noteText.length > 0 ? 16 : 0;
    const groupHigherIsBetter = higherIsBetterByGroup.get(groupKey) ?? true;
    const sourceValueItem = hasMeaningfulMultipleValues
      ? getSourceValueDisplayItem(uniqueEntries, activeSource, groupHigherIsBetter, sourceValueMode)
      : null;
    const sourceDeltaRaw = displaySourceValueDeltasInCells && hasMeaningfulMultipleValues
      ? getSourceValueDeltaRaw(uniqueEntries, activeSource, groupHigherIsBetter, sourceValueMode)
      : null;
    const sourceDeltaPadding = sourceDeltaRaw !== null
      ? Math.min(28, 9 + formatComparisonDeltaValue(sourceDeltaRaw).length * 3)
      : 0;

    const compactDisplayValue = displayValue.replace(/\s*\/\s*/g, "/");
    const sourceValueWidth = displaySourceValuesInCells && sourceValueItem
      ? measureTextWidth(sourceValueItem.displayValue, "600 14px Inter, ui-sans-serif, system-ui") + 18 + questionMarkPadding + sourceDeltaPadding
      : 0;
    const measured = Math.max(
      measureTextWidth(compactDisplayValue, "600 14px Inter, ui-sans-serif, system-ui") + 18 + questionMarkPadding,
      sourceValueWidth
    );
    const previous = valueWidthByModel.get(modelName) ?? 0;

    if (measured > previous) {
      valueWidthByModel.set(modelName, measured);
    }
  });

  modelColumns.forEach((modelName) => {
    const valueWidth = valueWidthByModel.get(modelName) ?? 0;
    const autoWidth = clampColumnWidth(
      Math.max(DEFAULT_MODEL_COLUMN_BASELINE_WIDTH, valueWidth),
      MIN_MODEL_COLUMN_RESIZE_WIDTH,
      MAX_MODEL_COLUMN_WIDTH
    );

    map.set(getModelColumnWidthKey(modelName), autoWidth);
  });

  return map;
}

export function buildActiveColumnWidthMap(
  savedForSource: Record<string, number>,
  autoModelWidthMap: Map<string, number>
): Record<string, number> {
  const nextMap: Record<string, number> = {
    ...savedForSource,
    [CATEGORY_COLUMN_WIDTH_KEY]: clampColumnWidth(
      savedForSource[CATEGORY_COLUMN_WIDTH_KEY] ?? DEFAULT_CATEGORY_COLUMN_WIDTH,
      MIN_CATEGORY_COLUMN_WIDTH,
      MAX_CATEGORY_COLUMN_WIDTH
    ),
    [BENCHMARK_COLUMN_WIDTH_KEY]: clampColumnWidth(
      savedForSource[BENCHMARK_COLUMN_WIDTH_KEY] ?? DEFAULT_BENCHMARK_COLUMN_WIDTH,
      MIN_BENCHMARK_COLUMN_WIDTH,
      MAX_BENCHMARK_COLUMN_WIDTH
    )
  };

  autoModelWidthMap.forEach((autoWidth, modelWidthKey) => {
    const stored = savedForSource[modelWidthKey];
    nextMap[modelWidthKey] = clampColumnWidth(
      stored ?? autoWidth,
      MIN_MODEL_COLUMN_RESIZE_WIDTH,
      MAX_MODEL_COLUMN_WIDTH
    );
  });

  return nextMap;
}

export function buildCategoryColumnWidth(activeColumnWidthMap: Record<string, number>): number {
  return clampColumnWidth(
    activeColumnWidthMap[CATEGORY_COLUMN_WIDTH_KEY] ?? DEFAULT_CATEGORY_COLUMN_WIDTH,
    MIN_CATEGORY_COLUMN_WIDTH,
    MAX_CATEGORY_COLUMN_WIDTH
  );
}

export function buildBenchmarkColumnWidth(activeColumnWidthMap: Record<string, number>): number {
  return clampColumnWidth(
    activeColumnWidthMap[BENCHMARK_COLUMN_WIDTH_KEY] ?? DEFAULT_BENCHMARK_COLUMN_WIDTH,
    MIN_BENCHMARK_COLUMN_WIDTH,
    MAX_BENCHMARK_COLUMN_WIDTH
  );
}

export function buildSourceMatchedModelSet(
  modelColumns: readonly string[],
  sourceTabMatchLabel: string
): Set<string> {
  if (!sourceTabMatchLabel) return new Set<string>();

  return new Set(
    modelColumns.filter((modelName) => isSourceHeaderPrefixMatch(modelName, sourceTabMatchLabel))
  );
}

export function buildSourceMatchedGroupBoundaryByModel(
  modelColumns: readonly string[],
  sourceMatchedModelSet: Set<string>
): SourceMatchedGroupBoundaryByModel {
  const firstSet = new Set<string>();
  const lastSet = new Set<string>();

  modelColumns.forEach((modelName, index) => {
    if (!sourceMatchedModelSet.has(modelName)) return;

    const previousModel = modelColumns[index - 1];
    const nextModel = modelColumns[index + 1];
    const hasPreviousMatched = previousModel ? sourceMatchedModelSet.has(previousModel) : false;
    const hasNextMatched = nextModel ? sourceMatchedModelSet.has(nextModel) : false;

    if (!hasPreviousMatched) {
      firstSet.add(modelName);
    }

    if (!hasNextMatched) {
      lastSet.add(modelName);
    }
  });

  return {
    firstSet,
    lastSet
  };
}

export function buildColumnWidthOverrideKeySet(columnWidthOverrideKeys: readonly string[]): Set<string> {
  return new Set(columnWidthOverrideKeys);
}

export function buildModelColumnMeta({
  modelColumns,
  modelProviderMap,
  modelProviderBrandColorMap,
  sourceMatchedModelSet,
  sourceMatchedGroupBoundaryByModel,
  columnWidthOverrideKeySet,
  autoModelWidthMap,
  activeColumnWidthMap,
  compareModelSet,
  compareBaselineModelName,
  activeSource
}: BuildModelColumnMetaOptions): ModelColumnMeta[] {
  return modelColumns.map((modelName) => {
    const providerIdentity = modelProviderMap.get(modelName);
    const providerName = providerIdentity?.displayName ?? "Unknown";
    const canonicalProviderName = providerIdentity?.canonicalName ?? providerName;
    const columnWidthKey = getModelColumnWidthKey(modelName);
    const autoWidth = autoModelWidthMap.get(columnWidthKey) ?? DEFAULT_MODEL_COLUMN_BASELINE_WIDTH;
    const storedWidth = activeColumnWidthMap[columnWidthKey];
    const isCompareSelected = compareModelSet.has(modelName);
    const isCompareBaseline = compareBaselineModelName === modelName;
    const hasManualWidthOverride = columnWidthOverrideKeySet.has(
      getColumnWidthOverrideKey(activeSource, columnWidthKey)
    );
    const compareExpandedDefaultWidth = isCompareBaseline
      ? COMPARE_BASELINE_DEFAULT_EXPANDED_WIDTH
      : COMPARE_BADGE_DEFAULT_EXPANDED_WIDTH;
    const shouldApplyCompareExpandedDefault = isCompareSelected && !hasManualWidthOverride;
    const preferredWidth = shouldApplyCompareExpandedDefault
      ? Math.max(storedWidth ?? autoWidth, compareExpandedDefaultWidth)
      : (storedWidth ?? autoWidth);
    const columnWidth = clampColumnWidth(
      preferredWidth,
      MIN_MODEL_COLUMN_RESIZE_WIDTH,
      MAX_MODEL_COLUMN_WIDTH
    );

    return {
      modelName,
      columnWidthKey,
      providerName,
      color: resolveProviderBrandColorForDarkTheme(canonicalProviderName, modelProviderBrandColorMap.get(modelName) ?? null),
      columnWidth,
      isSourceMatched: sourceMatchedModelSet.has(modelName),
      isSourceMatchedFirst: sourceMatchedGroupBoundaryByModel.firstSet.has(modelName),
      isSourceMatchedLast: sourceMatchedGroupBoundaryByModel.lastSet.has(modelName)
    };
  });
}

export function buildHiddenResizeHandleKeys(modelColumnMeta: readonly ModelColumnMeta[]): Set<string> {
  const hidden = new Set<string>();

  modelColumnMeta.forEach((model, index) => {
    if (model.isSourceMatchedFirst) {
      if (index === 0) {
        hidden.add(BENCHMARK_COLUMN_WIDTH_KEY);
      } else {
        const previousModel = modelColumnMeta[index - 1];
        if (previousModel) {
          hidden.add(previousModel.columnWidthKey);
        }
      }
    }

    if (model.isSourceMatchedLast) {
      hidden.add(model.columnWidthKey);
    }
  });

  return hidden;
}

export function useMatrixColumnResize({
  activeSourceRef,
  columnResizeStateRef,
  headerInteractionSuppressUntilRef,
  resizingColumnKey,
  setActiveColumnWidthMap,
  setColumnWidthOverrideKeys,
  setResizingColumnKey
}: UseMatrixColumnResizeOptions) {
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = columnResizeStateRef.current;
      if (!resizeState) return;

      const overrideKey = getColumnWidthOverrideKey(activeSourceRef.current, resizeState.columnKey);
      setColumnWidthOverrideKeys((prev) => (prev.includes(overrideKey) ? prev : [...prev, overrideKey]));

      const nextWidth = clampColumnWidth(
        resizeState.startWidth + (event.clientX - resizeState.startX),
        resizeState.minWidth,
        resizeState.maxWidth
      );

      setActiveColumnWidthMap((prev) => {
        if (prev[resizeState.columnKey] === nextWidth) {
          return prev;
        }
        return {
          ...prev,
          [resizeState.columnKey]: nextWidth
        };
      });
    };

    const stopResize = () => {
      if (!columnResizeStateRef.current) return;
      headerInteractionSuppressUntilRef.current = Math.max(
        headerInteractionSuppressUntilRef.current,
        Date.now() + 180
      );
      columnResizeStateRef.current = null;
      setResizingColumnKey(null);
      document.body.classList.remove("column-resizing");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("column-resizing");
    };
  }, [
    activeSourceRef,
    columnResizeStateRef,
    headerInteractionSuppressUntilRef,
    setActiveColumnWidthMap,
    setColumnWidthOverrideKeys,
    setResizingColumnKey
  ]);

  const suppressHeaderInteractionsFor = useCallback((durationMs = 180) => {
    headerInteractionSuppressUntilRef.current = Math.max(
      headerInteractionSuppressUntilRef.current,
      Date.now() + durationMs
    );
  }, [headerInteractionSuppressUntilRef]);

  const beginColumnResize = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    columnKey: string,
    currentWidth: number,
    minWidth: number,
    maxWidth: number
  ) => {
    event.preventDefault();
    event.stopPropagation();

    columnResizeStateRef.current = {
      columnKey,
      startX: event.clientX,
      startWidth: currentWidth,
      minWidth,
      maxWidth
    };

    setResizingColumnKey(columnKey);
    document.body.classList.add("column-resizing");
    suppressHeaderInteractionsFor();
  }, [columnResizeStateRef, setResizingColumnKey, suppressHeaderInteractionsFor]);

  const shouldSuppressHeaderInteractions = useCallback((): boolean => {
    if (resizingColumnKey !== null) return true;
    return Date.now() < headerInteractionSuppressUntilRef.current;
  }, [headerInteractionSuppressUntilRef, resizingColumnKey]);

  return {
    beginColumnResize,
    shouldSuppressHeaderInteractions
  };
}

export function useMatrixColumnWidths({
  modelColumns,
  coveragePrunedRows,
  showDuplicateRows,
  displaySourceValuesInCells,
  displaySourceValueDeltasInCells,
  activeSource,
  sourceValueMode,
  activeSourceRef,
  activeColumnWidthMap,
  setActiveColumnWidthMap,
  columnWidthBySourceRef,
  columnWidthPersistTimeoutRef,
  columnWidthOverrideKeys,
  isColumnWidthLoaded,
  sourceTabMatchLabel,
  modelProviderMap,
  modelProviderBrandColorMap,
  compareModelSet,
  compareBaselineModelName
}: UseMatrixColumnWidthsOptions) {
  const autoModelWidthMap = useMemo(
    () => {
      if (!isColumnWidthLoaded) return EMPTY_AUTO_MODEL_WIDTH_MAP;

      return buildAutoModelWidthMap({
        modelColumns,
        coveragePrunedRows,
        showDuplicateRows,
        displaySourceValuesInCells,
        displaySourceValueDeltasInCells,
        activeSource,
        sourceValueMode
      });
    },
    [isColumnWidthLoaded, modelColumns, coveragePrunedRows, showDuplicateRows, displaySourceValuesInCells, displaySourceValueDeltasInCells, activeSource, sourceValueMode]
  );

  useEffect(() => {
    if (!isColumnWidthLoaded) return;

    const savedForSource = columnWidthBySourceRef.current[activeSource] ?? {};
    const nextMap = buildActiveColumnWidthMap(savedForSource, autoModelWidthMap);

    setActiveColumnWidthMap((prev) => (areColumnWidthMapsEqual(prev, nextMap) ? prev : nextMap));
  }, [activeSource, autoModelWidthMap, columnWidthBySourceRef, isColumnWidthLoaded, setActiveColumnWidthMap]);

  useEffect(() => {
    if (!isColumnWidthLoaded) return;

    const sourceKey = activeSourceRef.current;
    const previousForSource = columnWidthBySourceRef.current[sourceKey] ?? {};

    if (areColumnWidthMapsEqual(previousForSource, activeColumnWidthMap)) {
      return;
    }

    columnWidthBySourceRef.current = {
      ...columnWidthBySourceRef.current,
      [sourceKey]: activeColumnWidthMap
    };

    if (columnWidthPersistTimeoutRef.current !== null) {
      window.clearTimeout(columnWidthPersistTimeoutRef.current);
    }

    columnWidthPersistTimeoutRef.current = window.setTimeout(() => {
      columnWidthPersistTimeoutRef.current = null;

      saveColumnWidthBySource(columnWidthBySourceRef.current);
    }, COLUMN_WIDTH_STORAGE_DEBOUNCE_MS);
  }, [activeColumnWidthMap, activeSourceRef, columnWidthBySourceRef, columnWidthPersistTimeoutRef, isColumnWidthLoaded]);

  useEffect(() => {
    return () => {
      if (columnWidthPersistTimeoutRef.current !== null) {
        window.clearTimeout(columnWidthPersistTimeoutRef.current);
        columnWidthPersistTimeoutRef.current = null;
      }
    };
  }, [columnWidthPersistTimeoutRef]);

  const categoryColumnWidth = useMemo(
    () => buildCategoryColumnWidth(activeColumnWidthMap),
    [activeColumnWidthMap]
  );

  const benchmarkColumnWidth = useMemo(
    () => buildBenchmarkColumnWidth(activeColumnWidthMap),
    [activeColumnWidthMap]
  );

  const sourceMatchedModelSet = useMemo(
    () => buildSourceMatchedModelSet(modelColumns, sourceTabMatchLabel),
    [modelColumns, sourceTabMatchLabel]
  );

  const sourceMatchedGroupBoundaryByModel = useMemo(
    () => buildSourceMatchedGroupBoundaryByModel(modelColumns, sourceMatchedModelSet),
    [modelColumns, sourceMatchedModelSet]
  );

  const columnWidthOverrideKeySet = useMemo(
    () => buildColumnWidthOverrideKeySet(columnWidthOverrideKeys),
    [columnWidthOverrideKeys]
  );

  const modelColumnMeta = useMemo(
    () => buildModelColumnMeta({
      modelColumns,
      modelProviderMap,
      modelProviderBrandColorMap,
      sourceMatchedModelSet,
      sourceMatchedGroupBoundaryByModel,
      columnWidthOverrideKeySet,
      autoModelWidthMap,
      activeColumnWidthMap,
      compareModelSet,
      compareBaselineModelName,
      activeSource
    }),
    [
      modelColumns,
      modelProviderMap,
      modelProviderBrandColorMap,
      sourceMatchedModelSet,
      sourceMatchedGroupBoundaryByModel,
      columnWidthOverrideKeySet,
      autoModelWidthMap,
      activeColumnWidthMap,
      compareModelSet,
      compareBaselineModelName,
      activeSource
    ]
  );

  const hiddenResizeHandleKeys = useMemo(
    () => buildHiddenResizeHandleKeys(modelColumnMeta),
    [modelColumnMeta]
  );

  return {
    categoryColumnWidth,
    benchmarkColumnWidth,
    modelColumnMeta,
    hiddenResizeHandleKeys
  };
}
