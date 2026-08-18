import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import { isValidHexColor, resolveProviderBrandColorForDarkTheme } from "@/lib/provider-config";
import { SOURCE_ALL, SOURCE_EMPTY } from "./constants";
import { formatTooltipTime } from "./formatters";
import type { MatrixInputRow, RowSortMode } from "./types";
import {
  buildSourceNewStateByKey,
  buildSourceOptions,
  type SourceOption
} from "./selectors";
import { getModelFamilyMatchKey } from "./model-matching";
import {
  areStringArraysEqual,
  getSourceKey,
  normalizeMatchToken,
  sourceTabDisplayLabel
} from "./utils";

type MutableRefValue<T> = {
  current: T;
};

type UseMatrixSourceTabsOptions = {
  rows: MatrixInputRow[];
  allRows: MatrixInputRow[];
  allSourceOptions: string[];
  isClientReady: boolean;
  urlSyncEnabled: boolean;
  pathname: string;
  searchParams: Pick<URLSearchParams, "get" | "toString">;
  sourceNewReferenceTime: number | null;
  overflowSourceKeys: string[];
  setOverflowSourceKeys: Dispatch<SetStateAction<string[]>>;
  setIsSourceOverflowMenuOpen: Dispatch<SetStateAction<boolean>>;
  sourceTabsViewportRef: MutableRefValue<HTMLDivElement | null>;
  sourceTabsMeasureRef: MutableRefValue<HTMLDivElement | null>;
  skipSelectionPersistenceOnceRef: MutableRefValue<boolean>;
  setRowSortState: Dispatch<SetStateAction<{ column: "category" | "benchmark"; mode: RowSortMode }>>;
};

type SourceProviderMatch = {
  rank: number;
  sourceDistance: number;
  providerName: string;
  providerBrandColor: string | null;
};

function getRowProviderDisplayName(row: MatrixInputRow): string {
  return row.providerDisplayName?.trim() || row.providerName || "Unknown";
}

function getSourceProviderMatchRank(sourceLabel: string, row: MatrixInputRow): number | null {
  const sourceToken = normalizeMatchToken(sourceLabel);
  if (!sourceToken) return null;

  const modelToken = normalizeMatchToken(row.modelName);
  if (modelToken === sourceToken) return 0;
  if (modelToken.startsWith(sourceToken)) return 1;
  if (modelToken.includes(sourceToken)) return 2;

  const sourceFamilyKey = getModelFamilyMatchKey(sourceLabel);
  if (sourceFamilyKey && getModelFamilyMatchKey(row.modelName) === sourceFamilyKey) {
    return 3;
  }

  const providerToken = normalizeMatchToken(getRowProviderDisplayName(row));
  if (providerToken && sourceToken.includes(providerToken)) return 4;
  if (sourceFamilyKey && getModelFamilyMatchKey(getRowProviderDisplayName(row)) === sourceFamilyKey) {
    return 4;
  }

  return null;
}

function buildSourceTabTextColorByKey(
  allRows: MatrixInputRow[],
  sourceOptions: SourceOption[]
): Map<string, string> {
  const colorByKey = new Map<string, string>();

  for (const source of sourceOptions) {
    if (source.key === SOURCE_ALL || source.key === SOURCE_EMPTY) continue;

    const sourceLabel = sourceTabDisplayLabel(source.key).trim();
    let bestMatch: SourceProviderMatch | null = null;

    for (const row of allRows) {
      const rank = getSourceProviderMatchRank(sourceLabel, row);
      if (rank === null) continue;

      const sourceDistance = getSourceKey(row.source) === source.key ? 0 : 1;
      const candidate: SourceProviderMatch = {
        rank,
        sourceDistance,
        providerName: getRowProviderDisplayName(row),
        providerBrandColor: row.providerBrandColor ?? null
      };

      if (
        !bestMatch ||
        candidate.rank < bestMatch.rank ||
        (candidate.rank === bestMatch.rank && candidate.sourceDistance < bestMatch.sourceDistance)
      ) {
        bestMatch = candidate;
      }
    }

    if (bestMatch?.providerBrandColor && isValidHexColor(bestMatch.providerBrandColor)) {
      colorByKey.set(
        source.key,
        resolveProviderBrandColorForDarkTheme(bestMatch.providerName, bestMatch.providerBrandColor)
      );
    }
  }

  return colorByKey;
}

export function useMatrixSourceTabs({
  rows,
  allRows,
  allSourceOptions,
  isClientReady,
  urlSyncEnabled,
  pathname,
  searchParams,
  sourceNewReferenceTime,
  overflowSourceKeys,
  setOverflowSourceKeys,
  setIsSourceOverflowMenuOpen,
  sourceTabsViewportRef,
  sourceTabsMeasureRef,
  skipSelectionPersistenceOnceRef,
  setRowSortState
}: UseMatrixSourceTabsOptions) {
  const sourceOptions = useMemo(
    () => buildSourceOptions(rows, allSourceOptions),
    [rows, allSourceOptions]
  );

  const [activeSource, setActiveSource] = useState(SOURCE_ALL);
  const activeSourceRef = useRef(SOURCE_ALL);
  const pendingSourceSyncRef = useRef<string | null>(null);

  const hasSourceData = useMemo(
    () => allSourceOptions.length > 0
      || allRows.some((row) => row.source?.trim()),
    [allSourceOptions, allRows]
  );
  const overflowSourceKeySet = useMemo(() => new Set(overflowSourceKeys), [overflowSourceKeys]);
  const [promotedOverflowSourceKey, setPromotedOverflowSourceKey] = useState<string | null>(null);
  const visibleSourceOptions = useMemo(
    () => sourceOptions.filter((source) => !overflowSourceKeySet.has(source.key)),
    [sourceOptions, overflowSourceKeySet]
  );
  const overflowSourceOptions = useMemo(
    () => sourceOptions.filter((source) => overflowSourceKeySet.has(source.key)),
    [sourceOptions, overflowSourceKeySet]
  );
  const overflowSourceMenuOptions = useMemo(
    () => sourceOptions.filter((source) => (
      overflowSourceKeySet.has(source.key) || source.key === promotedOverflowSourceKey
    )),
    [sourceOptions, overflowSourceKeySet, promotedOverflowSourceKey]
  );
  const sourceNewStateByKey = useMemo(
    () => buildSourceNewStateByKey(allRows, sourceNewReferenceTime),
    [allRows, sourceNewReferenceTime]
  );
  const sourceTabTextColorByKey = useMemo(
    () => buildSourceTabTextColorByKey(allRows, sourceOptions),
    [allRows, sourceOptions]
  );

  const getSourceTabDisplayText = (source: SourceOption) => (
    source.key === SOURCE_ALL ? source.label : sourceTabDisplayLabel(source.key)
  );
  const getSourceTabTextColor = (source: SourceOption) => sourceTabTextColorByKey.get(source.key) ?? null;
  const getSourceTabTitle = (source: SourceOption) => {
    const displayText = getSourceTabDisplayText(source);
    const newState = sourceNewStateByKey.get(source.key);
    if (!newState) return displayText;

    const formattedTime = formatTooltipTime(new Date(newState.updatedAtMs).toISOString());
    return newState.isNew
      ? `${displayText} · ${formattedTime} · 最近更新`
      : `${displayText} · ${formattedTime}`;
  };

  useEffect(() => {
    if (!urlSyncEnabled) return;

    const sourceFromUrl = searchParams.get("source");
    const isKnown = sourceFromUrl
      ? sourceOptions.some((item) => item.key === sourceFromUrl)
      : false;
    const nextSource = sourceFromUrl && isKnown ? sourceFromUrl : SOURCE_ALL;

    const pendingSource = pendingSourceSyncRef.current;
    if (pendingSource) {
      if (nextSource === pendingSource) {
        pendingSourceSyncRef.current = null;
      } else {
        return;
      }
    }

    setActiveSource((prev) => {
      if (prev === nextSource) return prev;
      skipSelectionPersistenceOnceRef.current = true;
      return nextSource;
    });

    if (activeSourceRef.current !== nextSource) {
      const nextMode: RowSortMode = nextSource === SOURCE_ALL ? "data" : "source";
      setRowSortState((prev) => (prev.mode === nextMode ? prev : { ...prev, mode: nextMode }));
    }
  }, [urlSyncEnabled, searchParams, sourceOptions, setRowSortState, skipSelectionPersistenceOnceRef]);

  useLayoutEffect(() => {
    if (!isClientReady) return;

    const allKeys = sourceOptions.map((item) => item.key);

    const computeOverflowKeys = () => {
      const viewportElement = sourceTabsViewportRef.current;
      const measureElement = sourceTabsMeasureRef.current;

      if (!viewportElement || !measureElement || allKeys.length === 0) {
        setOverflowSourceKeys((prev) => (prev.length > 0 ? [] : prev));
        setPromotedOverflowSourceKey((prev) => (prev === null ? prev : null));
        return;
      }

      const availableWidth = viewportElement.clientWidth;
      const widthByKey = new Map<string, number>();

      measureElement.querySelectorAll<HTMLElement>("[data-source-tab-measure='item']").forEach((node) => {
        const key = node.dataset.sourceTabMeasureKey;
        if (!key) return;

        const width = Math.ceil(node.getBoundingClientRect().width);
        if (width > 0) {
          widthByKey.set(key, width);
        }
      });

      const overflowMeasureNode = measureElement.querySelector<HTMLElement>("[data-source-tab-measure='more']");
      const overflowButtonWidth = Math.ceil(overflowMeasureNode?.getBoundingClientRect().width ?? 72);

      const hasValidMeasurements =
        availableWidth > 0 &&
        allKeys.every((key) => (widthByKey.get(key) ?? 0) > 0);

      if (!hasValidMeasurements) {
        setOverflowSourceKeys((prev) => (prev.length > 0 ? [] : prev));
        setPromotedOverflowSourceKey((prev) => (prev === null ? prev : null));
        return;
      }

      const totalWidth = allKeys.reduce((sum, key) => sum + (widthByKey.get(key) ?? 0), 0);
      if (totalWidth <= availableWidth) {
        setOverflowSourceKeys((prev) => (prev.length > 0 ? [] : prev));
        setPromotedOverflowSourceKey((prev) => (prev === null ? prev : null));
        return;
      }

      const widthLimit = Math.max(availableWidth - overflowButtonWidth - 8, 0);
      if (widthLimit <= 0) {
        const fallbackVisibleKeys = allKeys.includes(activeSource) ? [activeSource] : allKeys.slice(0, 1);
        const fallbackVisibleSet = new Set(fallbackVisibleKeys);
        const nextOverflowKeys = allKeys.filter((key) => !fallbackVisibleSet.has(key));
        const nextPromotedOverflowSourceKey =
          activeSource !== SOURCE_ALL && fallbackVisibleSet.has(activeSource) && allKeys[0] !== activeSource
            ? activeSource
            : null;

        setOverflowSourceKeys((prev) => (areStringArraysEqual(prev, nextOverflowKeys) ? prev : nextOverflowKeys));
        setPromotedOverflowSourceKey((prev) => (
          prev === nextPromotedOverflowSourceKey ? prev : nextPromotedOverflowSourceKey
        ));
        return;
      }

      const visibleKeys: string[] = [];
      let usedWidth = 0;

      for (const key of allKeys) {
        const width = widthByKey.get(key) ?? 0;
        if (usedWidth + width <= widthLimit || visibleKeys.length === 0) {
          visibleKeys.push(key);
          usedWidth += width;
        } else {
          break;
        }
      }
      const forceIncludeKey = (key: string, mandatory: boolean) => {
        if (!allKeys.includes(key) || visibleKeys.includes(key)) return;

        const width = widthByKey.get(key) ?? 0;

        while (visibleKeys.length > 0 && usedWidth + width > widthLimit) {
          const removed = visibleKeys.pop();
          if (!removed) break;
          usedWidth -= widthByKey.get(removed) ?? 0;
        }

        if (usedWidth + width <= widthLimit || visibleKeys.length === 0) {
          visibleKeys.push(key);
          usedWidth += width;
          return;
        }

        if (mandatory) {
          visibleKeys.splice(0, visibleKeys.length, key);
          usedWidth = width;
        }
      };

      forceIncludeKey(activeSource, true);
      if (activeSource !== SOURCE_ALL) {
        forceIncludeKey(SOURCE_ALL, false);
      }

      const orderMap = new Map(allKeys.map((key, index) => [key, index]));
      const visibleSet = new Set(
        Array.from(new Set(visibleKeys)).sort(
          (left, right) => (orderMap.get(left) ?? 0) - (orderMap.get(right) ?? 0)
        )
      );

      const nextOverflowKeys = allKeys.filter((key) => !visibleSet.has(key));
      const activeSourceOrder = orderMap.get(activeSource) ?? -1;
      const nextPromotedOverflowSourceKey =
        activeSource !== SOURCE_ALL &&
        visibleSet.has(activeSource) &&
        nextOverflowKeys.some((key) => (orderMap.get(key) ?? -1) < activeSourceOrder)
          ? activeSource
          : null;

      setOverflowSourceKeys((prev) => (areStringArraysEqual(prev, nextOverflowKeys) ? prev : nextOverflowKeys));
      setPromotedOverflowSourceKey((prev) => (
        prev === nextPromotedOverflowSourceKey ? prev : nextPromotedOverflowSourceKey
      ));
      if (nextOverflowKeys.length === 0) {
        setIsSourceOverflowMenuOpen(false);
      }
    };

    computeOverflowKeys();

    let observer: ResizeObserver | null = null;
    const handleWindowResize = () => {
      computeOverflowKeys();
    };

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        computeOverflowKeys();
      });

      if (sourceTabsViewportRef.current) {
        observer.observe(sourceTabsViewportRef.current);
      }
    } else {
      window.addEventListener("resize", handleWindowResize);
    }

    return () => {
      observer?.disconnect();
      if (!observer) {
        window.removeEventListener("resize", handleWindowResize);
      }
    };
  }, [
    isClientReady,
    sourceOptions,
    activeSource,
    sourceTabsMeasureRef,
    sourceTabsViewportRef,
    setIsSourceOverflowMenuOpen,
    setOverflowSourceKeys
  ]);

  function setSourceAndUrl(nextSource: string) {
    setIsSourceOverflowMenuOpen(false);

    const isSameSource = activeSourceRef.current === nextSource;
    if (!isSameSource) {
      skipSelectionPersistenceOnceRef.current = true;
      pendingSourceSyncRef.current = urlSyncEnabled ? nextSource : null;
      setActiveSource(nextSource);
      const nextMode: RowSortMode = nextSource === SOURCE_ALL ? "data" : "source";
      setRowSortState((prev) => (prev.mode === nextMode ? prev : { ...prev, mode: nextMode }));
    }

    if (!urlSyncEnabled) return;

    const params = new URLSearchParams(searchParams.toString());
    const nextSourceParam = nextSource === SOURCE_ALL ? null : nextSource;

    // 点击已选中的页签且 URL 已一致时，跳过无效的历史状态更新
    if (isSameSource && params.get("source") === nextSourceParam) return;

    if (nextSourceParam === null) {
      params.delete("source");
    } else {
      params.set("source", nextSourceParam);
    }

    const query = params.toString();
    window.history.replaceState(window.history.state, "", query ? `${pathname}?${query}` : pathname);
  }

  return {
    sourceOptions,
    activeSource,
    activeSourceRef,
    hasSourceData,
    visibleSourceOptions,
    overflowSourceOptions,
    overflowSourceMenuOptions,
    promotedOverflowSourceKey,
    sourceNewStateByKey,
    getSourceTabDisplayText,
    getSourceTabTextColor,
    getSourceTabTitle,
    setSourceAndUrl
  };
}
