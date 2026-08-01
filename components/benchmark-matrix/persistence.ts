import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  COLUMN_WIDTH_BY_SOURCE_STORAGE_KEY,
  DEFAULT_HEATMAP_ALPHA,
  DEFAULT_HEATMAP_PALETTE_HEX,
  EXPORT_PRESET_STORAGE_KEY,
  HEATMAP_PALETTE_STORAGE_KEY,
  HEATMAP_PRESETS,
  MODEL_ORDER_BY_SOURCE_STORAGE_KEY,
  MODEL_SELECTION_BY_SOURCE_STORAGE_KEY,
  PARAMS_ROWS_IN_OVERALL_STORAGE_KEY,
  PRICE_ROWS_IN_OVERALL_STORAGE_KEY,
  SHOW_CATEGORY_STORAGE_KEY,
  SHOW_DUPLICATE_STORAGE_KEY,
  SHOW_PARAMS_ROWS_STORAGE_KEY,
  SHOW_PRICE_ROWS_STORAGE_KEY,
  SHOW_SOURCE_VALUES_STORAGE_KEY,
  EXPORT_FOOTNOTE_ENABLED_STORAGE_KEY
} from "./constants";
import { clampHeatmapAlpha, normalizeHexColor } from "./colors";
import { isExportPresetKey } from "./export-image";
import type {
  ExportPresetKey,
  HeatmapPaletteHex,
  HeatmapPresetKey,
  HeatmapPresetSelection
} from "./types";
import {
  enqueueStateUpdate,
  normalizeColumnWidthBySource
} from "./utils";

type MutableRefValue<T> = {
  current: T;
};

type MatrixPreferenceStorageOptions = {
  modelSelectionBySourceRef: MutableRefValue<Record<string, string[]>>;
  setIsModelSelectionLoaded: Dispatch<SetStateAction<boolean>>;
  modelOrderBySource: Record<string, string[]>;
  setModelOrderBySource: Dispatch<SetStateAction<Record<string, string[]>>>;
  isModelOrderLoaded: boolean;
  setIsModelOrderLoaded: Dispatch<SetStateAction<boolean>>;
  columnWidthBySourceRef: MutableRefValue<Record<string, Record<string, number>>>;
  setIsColumnWidthLoaded: Dispatch<SetStateAction<boolean>>;
  showCategoryLoadedRef: MutableRefValue<boolean>;
  showCategory: boolean;
  setShowCategory: Dispatch<SetStateAction<boolean>>;
  showDuplicateLoadedRef: MutableRefValue<boolean>;
  showDuplicateRows: boolean;
  setShowDuplicateRows: Dispatch<SetStateAction<boolean>>;
  showSourceValuesLoadedRef: MutableRefValue<boolean>;
  showSourceValues: boolean;
  setShowSourceValues: Dispatch<SetStateAction<boolean>>;
  showPriceRowsLoadedRef: MutableRefValue<boolean>;
  showPriceRows: boolean;
  setShowPriceRows: Dispatch<SetStateAction<boolean>>;
  showParamsRowsLoadedRef: MutableRefValue<boolean>;
  showParamsRows: boolean;
  setShowParamsRows: Dispatch<SetStateAction<boolean>>;
  priceRowsInOverallLoadedRef: MutableRefValue<boolean>;
  priceRowsInOverall: boolean;
  setPriceRowsInOverall: Dispatch<SetStateAction<boolean>>;
  paramsRowsInOverallLoadedRef: MutableRefValue<boolean>;
  paramsRowsInOverall: boolean;
  setParamsRowsInOverall: Dispatch<SetStateAction<boolean>>;
};

type ExportPresetStorageOptions = {
  exportPresetLoadedRef: MutableRefValue<boolean>;
  exportPreset: ExportPresetKey;
  setExportPreset: Dispatch<SetStateAction<ExportPresetKey>>;
  exportIncludeFootnoteLoadedRef: MutableRefValue<boolean>;
  exportIncludeFootnote: boolean;
  setExportIncludeFootnote: Dispatch<SetStateAction<boolean>>;
};

type HeatmapPaletteStorageOptions = {
  heatmapPaletteLoadedRef: MutableRefValue<boolean>;
  heatmapPalette: HeatmapPaletteHex;
  setHeatmapPalette: Dispatch<SetStateAction<HeatmapPaletteHex>>;
  heatmapAlpha: number;
  setHeatmapAlpha: Dispatch<SetStateAction<number>>;
  heatmapPresetSelection: HeatmapPresetSelection;
  setHeatmapPresetSelection: Dispatch<SetStateAction<HeatmapPresetSelection>>;
};

function loadModelSelectionBySource(): Record<string, string[]> | null {
  try {
    const saved = window.localStorage.getItem(MODEL_SELECTION_BY_SOURCE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const normalizedBySource: Record<string, string[]> = {};

        Object.entries(parsed).forEach(([sourceKey, value]) => {
          if (!Array.isArray(value)) return;

          const normalized = Array.from(
            new Set(value.filter((item): item is string => typeof item === "string"))
          ).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

          normalizedBySource[sourceKey] = normalized;
        });

        return normalizedBySource;
      }
    }
  } catch {
    // ignore storage access errors gracefully
  }

  return null;
}

function loadModelOrderBySource(): Record<string, string[]> | null {
  try {
    const saved = window.localStorage.getItem(MODEL_ORDER_BY_SOURCE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const normalizedBySource: Record<string, string[]> = {};

        Object.entries(parsed).forEach(([sourceKey, value]) => {
          if (!Array.isArray(value)) return;

          normalizedBySource[sourceKey] = Array.from(
            new Set(value.filter((item): item is string => typeof item === "string"))
          );
        });

        return normalizedBySource;
      }
    }
  } catch {
    // ignore storage access errors gracefully
  }

  return null;
}

function loadColumnWidthBySource(): Record<string, Record<string, number>> | null {
  try {
    const saved = window.localStorage.getItem(COLUMN_WIDTH_BY_SOURCE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as unknown;
      return normalizeColumnWidthBySource(parsed);
    }
  } catch {
    // ignore storage access errors gracefully
  }

  return null;
}

function loadStoredBoolean(storageKey: string): boolean | null {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "0" || saved === "1") {
      return saved === "1";
    }
  } catch {
    // ignore storage access errors gracefully
  }

  return null;
}

function saveStoredBoolean(storageKey: string, value: boolean) {
  try {
    window.localStorage.setItem(storageKey, value ? "1" : "0");
  } catch {
    // ignore storage access errors gracefully
  }
}

function loadExportPreset(): ExportPresetKey | null {
  try {
    const saved = window.localStorage.getItem(EXPORT_PRESET_STORAGE_KEY);
    if (saved && isExportPresetKey(saved)) {
      return saved;
    }
  } catch {
    // ignore storage access errors gracefully
  }

  return null;
}

function loadHeatmapPaletteStorage(): {
  palette: HeatmapPaletteHex;
  alpha: number;
  presetSelection: HeatmapPresetSelection;
} | null {
  try {
    const saved = window.localStorage.getItem(HEATMAP_PALETTE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as {
        low?: unknown;
        mid?: unknown;
        high?: unknown;
        alpha?: unknown;
        preset?: unknown;
      };

      const palette: HeatmapPaletteHex = {
        low: normalizeHexColor(typeof parsed.low === "string" ? parsed.low : "", DEFAULT_HEATMAP_PALETTE_HEX.low),
        mid: normalizeHexColor(typeof parsed.mid === "string" ? parsed.mid : "", DEFAULT_HEATMAP_PALETTE_HEX.mid),
        high: normalizeHexColor(typeof parsed.high === "string" ? parsed.high : "", DEFAULT_HEATMAP_PALETTE_HEX.high)
      };

      const presetRaw = typeof parsed.preset === "string" ? parsed.preset : "";
      const isKnownPreset = presetRaw in HEATMAP_PRESETS;
      const presetSelection: HeatmapPresetSelection = isKnownPreset
        ? (presetRaw as HeatmapPresetKey)
        : "custom";
      const parsedAlpha = typeof parsed.alpha === "number" ? parsed.alpha : DEFAULT_HEATMAP_ALPHA;

      return {
        palette,
        alpha: clampHeatmapAlpha(parsedAlpha),
        presetSelection
      };
    }
  } catch {
    // ignore storage access errors gracefully
  }

  return null;
}

export function saveModelSelectionBySource(value: Record<string, string[]>) {
  try {
    window.localStorage.setItem(MODEL_SELECTION_BY_SOURCE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore storage access errors gracefully
  }
}

export function saveModelOrderBySource(value: Record<string, string[]>) {
  try {
    window.localStorage.setItem(MODEL_ORDER_BY_SOURCE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore storage access errors gracefully
  }
}

export function saveColumnWidthBySource(value: Record<string, Record<string, number>>) {
  try {
    window.localStorage.setItem(COLUMN_WIDTH_BY_SOURCE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore storage access errors gracefully
  }
}

export function useMatrixPreferenceStorage({
  modelSelectionBySourceRef,
  setIsModelSelectionLoaded,
  modelOrderBySource,
  setModelOrderBySource,
  isModelOrderLoaded,
  setIsModelOrderLoaded,
  columnWidthBySourceRef,
  setIsColumnWidthLoaded,
  showCategoryLoadedRef,
  showCategory,
  setShowCategory,
  showDuplicateLoadedRef,
  showDuplicateRows,
  setShowDuplicateRows,
  showSourceValuesLoadedRef,
  showSourceValues,
  setShowSourceValues,
  showPriceRowsLoadedRef,
  showPriceRows,
  setShowPriceRows,
  showParamsRowsLoadedRef,
  showParamsRows,
  setShowParamsRows,
  priceRowsInOverallLoadedRef,
  priceRowsInOverall,
  setPriceRowsInOverall,
  paramsRowsInOverallLoadedRef,
  paramsRowsInOverall,
  setParamsRowsInOverall
}: MatrixPreferenceStorageOptions) {
  useEffect(() => {
    const nextSelectionBySource = loadModelSelectionBySource();

    enqueueStateUpdate(() => {
      if (nextSelectionBySource) {
        modelSelectionBySourceRef.current = nextSelectionBySource;
      }
      setIsModelSelectionLoaded(true);
    });
  }, [modelSelectionBySourceRef, setIsModelSelectionLoaded]);

  useEffect(() => {
    const nextModelOrderBySource = loadModelOrderBySource();

    enqueueStateUpdate(() => {
      if (nextModelOrderBySource) {
        setModelOrderBySource(nextModelOrderBySource);
      }
      setIsModelOrderLoaded(true);
    });
  }, [setIsModelOrderLoaded, setModelOrderBySource]);

  useEffect(() => {
    if (!isModelOrderLoaded) return;

    saveModelOrderBySource(modelOrderBySource);
  }, [modelOrderBySource, isModelOrderLoaded]);

  useEffect(() => {
    const nextColumnWidthBySource = loadColumnWidthBySource();

    enqueueStateUpdate(() => {
      if (nextColumnWidthBySource) {
        columnWidthBySourceRef.current = nextColumnWidthBySource;
      }
      setIsColumnWidthLoaded(true);
    });
  }, [columnWidthBySourceRef, setIsColumnWidthLoaded]);

  useEffect(() => {
    const nextShowCategory = loadStoredBoolean(SHOW_CATEGORY_STORAGE_KEY);

    enqueueStateUpdate(() => {
      if (nextShowCategory !== null) {
        setShowCategory(nextShowCategory);
      }
      showCategoryLoadedRef.current = true;
    });
  }, [setShowCategory, showCategoryLoadedRef]);

  useEffect(() => {
    const nextShowDuplicateRows = loadStoredBoolean(SHOW_DUPLICATE_STORAGE_KEY);

    enqueueStateUpdate(() => {
      if (nextShowDuplicateRows !== null) {
        setShowDuplicateRows(nextShowDuplicateRows);
      }
      showDuplicateLoadedRef.current = true;
    });
  }, [setShowDuplicateRows, showDuplicateLoadedRef]);

  useEffect(() => {
    const nextShowSourceValues = loadStoredBoolean(SHOW_SOURCE_VALUES_STORAGE_KEY);

    enqueueStateUpdate(() => {
      if (nextShowSourceValues !== null) {
        setShowSourceValues(nextShowSourceValues);
      }
      showSourceValuesLoadedRef.current = true;
    });
  }, [setShowSourceValues, showSourceValuesLoadedRef]);

  useEffect(() => {
    const nextShowPriceRows = loadStoredBoolean(SHOW_PRICE_ROWS_STORAGE_KEY);

    enqueueStateUpdate(() => {
      if (nextShowPriceRows !== null) {
        setShowPriceRows(nextShowPriceRows);
      }
      showPriceRowsLoadedRef.current = true;
    });
  }, [setShowPriceRows, showPriceRowsLoadedRef]);

  useEffect(() => {
    const nextShowParamsRows = loadStoredBoolean(SHOW_PARAMS_ROWS_STORAGE_KEY);

    enqueueStateUpdate(() => {
      if (nextShowParamsRows !== null) {
        setShowParamsRows(nextShowParamsRows);
      }
      showParamsRowsLoadedRef.current = true;
    });
  }, [setShowParamsRows, showParamsRowsLoadedRef]);

  useEffect(() => {
    const nextPriceRowsInOverall = loadStoredBoolean(PRICE_ROWS_IN_OVERALL_STORAGE_KEY);

    enqueueStateUpdate(() => {
      if (nextPriceRowsInOverall !== null) {
        setPriceRowsInOverall(nextPriceRowsInOverall);
      }
      priceRowsInOverallLoadedRef.current = true;
    });
  }, [setPriceRowsInOverall, priceRowsInOverallLoadedRef]);

  useEffect(() => {
    const nextParamsRowsInOverall = loadStoredBoolean(PARAMS_ROWS_IN_OVERALL_STORAGE_KEY);

    enqueueStateUpdate(() => {
      if (nextParamsRowsInOverall !== null) {
        setParamsRowsInOverall(nextParamsRowsInOverall);
      }
      paramsRowsInOverallLoadedRef.current = true;
    });
  }, [setParamsRowsInOverall, paramsRowsInOverallLoadedRef]);

  useEffect(() => {
    if (!showCategoryLoadedRef.current) return;

    saveStoredBoolean(SHOW_CATEGORY_STORAGE_KEY, showCategory);
  }, [showCategory, showCategoryLoadedRef]);

  useEffect(() => {
    if (!showDuplicateLoadedRef.current) return;

    saveStoredBoolean(SHOW_DUPLICATE_STORAGE_KEY, showDuplicateRows);
  }, [showDuplicateRows, showDuplicateLoadedRef]);

  useEffect(() => {
    if (!showSourceValuesLoadedRef.current) return;

    saveStoredBoolean(SHOW_SOURCE_VALUES_STORAGE_KEY, showSourceValues);
  }, [showSourceValues, showSourceValuesLoadedRef]);

  useEffect(() => {
    if (!showPriceRowsLoadedRef.current) return;

    saveStoredBoolean(SHOW_PRICE_ROWS_STORAGE_KEY, showPriceRows);
  }, [showPriceRows, showPriceRowsLoadedRef]);

  useEffect(() => {
    if (!showParamsRowsLoadedRef.current) return;

    saveStoredBoolean(SHOW_PARAMS_ROWS_STORAGE_KEY, showParamsRows);
  }, [showParamsRows, showParamsRowsLoadedRef]);

  useEffect(() => {
    if (!priceRowsInOverallLoadedRef.current) return;

    saveStoredBoolean(PRICE_ROWS_IN_OVERALL_STORAGE_KEY, priceRowsInOverall);
  }, [priceRowsInOverall, priceRowsInOverallLoadedRef]);

  useEffect(() => {
    if (!paramsRowsInOverallLoadedRef.current) return;

    saveStoredBoolean(PARAMS_ROWS_IN_OVERALL_STORAGE_KEY, paramsRowsInOverall);
  }, [paramsRowsInOverall, paramsRowsInOverallLoadedRef]);
}

export function useExportPresetStorage({
  exportPresetLoadedRef,
  exportPreset,
  setExportPreset,
  exportIncludeFootnoteLoadedRef,
  exportIncludeFootnote,
  setExportIncludeFootnote
}: ExportPresetStorageOptions) {
  useEffect(() => {
    const nextExportPreset = loadExportPreset();

    enqueueStateUpdate(() => {
      if (nextExportPreset) {
        setExportPreset(nextExportPreset);
      }
      exportPresetLoadedRef.current = true;
    });
  }, [exportPresetLoadedRef, setExportPreset]);

  useEffect(() => {
    if (!exportPresetLoadedRef.current) return;

    try {
      window.localStorage.setItem(EXPORT_PRESET_STORAGE_KEY, exportPreset);
    } catch {
      // ignore storage access errors gracefully
    }
  }, [exportPreset, exportPresetLoadedRef]);

  useEffect(() => {
    const nextIncludeFootnote = loadStoredBoolean(EXPORT_FOOTNOTE_ENABLED_STORAGE_KEY);

    enqueueStateUpdate(() => {
      if (nextIncludeFootnote !== null) {
        setExportIncludeFootnote(nextIncludeFootnote);
      }
      exportIncludeFootnoteLoadedRef.current = true;
    });
  }, [setExportIncludeFootnote, exportIncludeFootnoteLoadedRef]);

  useEffect(() => {
    if (!exportIncludeFootnoteLoadedRef.current) return;

    saveStoredBoolean(EXPORT_FOOTNOTE_ENABLED_STORAGE_KEY, exportIncludeFootnote);
  }, [exportIncludeFootnote, exportIncludeFootnoteLoadedRef]);
}

export function useHeatmapPaletteStorage({
  heatmapPaletteLoadedRef,
  heatmapPalette,
  setHeatmapPalette,
  heatmapAlpha,
  setHeatmapAlpha,
  heatmapPresetSelection,
  setHeatmapPresetSelection
}: HeatmapPaletteStorageOptions) {
  useEffect(() => {
    const nextHeatmap = loadHeatmapPaletteStorage();

    enqueueStateUpdate(() => {
      if (nextHeatmap) {
        setHeatmapPalette(nextHeatmap.palette);
        setHeatmapAlpha(nextHeatmap.alpha);
        setHeatmapPresetSelection(nextHeatmap.presetSelection);
      }
      heatmapPaletteLoadedRef.current = true;
    });
  }, [heatmapPaletteLoadedRef, setHeatmapAlpha, setHeatmapPalette, setHeatmapPresetSelection]);

  useEffect(() => {
    if (!heatmapPaletteLoadedRef.current) return;

    try {
      window.localStorage.setItem(
        HEATMAP_PALETTE_STORAGE_KEY,
        JSON.stringify({
          ...heatmapPalette,
          alpha: heatmapAlpha,
          preset: heatmapPresetSelection
        })
      );
    } catch {
      // ignore storage access errors gracefully
    }
  }, [heatmapPalette, heatmapAlpha, heatmapPresetSelection, heatmapPaletteLoadedRef]);
}
