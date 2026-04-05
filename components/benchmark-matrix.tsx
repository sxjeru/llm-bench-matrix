"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, Expand, Eye, EyeOff, Filter, Layers, Minimize2 } from "lucide-react";

type MatrixInputRow = {
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  benchTime: string;
  valueRaw: string;
  valueNum: number | null;
  source: string | null;
};

type MatrixCellEntry = {
  valueRaw: string;
  valueNum: number | null;
  source: string | null;
  benchTime: string;
};

type MatrixCell = {
  valueRaw: string;
  valueNum: number | null;
  source: string | null;
  benchTime: string;
  allEntries: MatrixCellEntry[];
  hasMultipleValues: boolean;
};

type MatrixRow = {
  category: string;
  benchmark: string;
  cells: Map<string, MatrixCell>;
  rowDataCount: number;
  rowNumericCount: number;
  minNum: number | null;
  maxNum: number | null;
};

type Props = {
  rows: MatrixInputRow[];
};

const SOURCE_ALL = "__ALL__";
const SOURCE_EMPTY = "__EMPTY__";
const SHOW_CATEGORY_STORAGE_KEY = "benchmark-matrix:show-category";

function getSourceKey(source: string | null): string {
  const cleaned = source?.trim();
  return cleaned ? cleaned : SOURCE_EMPTY;
}

function getSourceLabel(sourceKey: string): string {
  if (sourceKey === SOURCE_EMPTY) {
    return "未标注";
  }
  return sourceKey;
}

function sourceTabDisplayLabel(sourceKey: string): string {
  const rawLabel = getSourceLabel(sourceKey);
  const colonIndex = rawLabel.indexOf(":");
  if (colonIndex < 0) return rawLabel;

  const stripped = rawLabel.slice(colonIndex + 1).trim();
  return stripped.length > 0 ? stripped : rawLabel;
}

function getProviderBrandColor(providerName: string | null | undefined): string {
  const normalized = (providerName ?? "").trim().toLowerCase();

  if (normalized.includes("openai") || normalized.includes("gpt")) return "#34d399";
  if (normalized.includes("anthropic") || normalized.includes("claude")) return "#e09a0e";
  if (normalized.includes("google") || normalized.includes("gemini") || normalized.includes("gemma")) return "#4285f4";
  if (normalized.includes("meta") || normalized.includes("llama")) return "#3b82f6";
  if (normalized.includes("qwen") || normalized.includes("alibaba")) return "#a16dfa";
  if (normalized.includes("deepseek")) return "#14b8a6";
  if (normalized.includes("xai") || normalized.includes("grok")) return "#cecece";

  const fallbackPalette = [
    "#f180b9",
    "#ffa98f",
    "#6cc9de",
  ];
  const hash = normalized.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return fallbackPalette[hash % fallbackPalette.length];
}

function lerp(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t);
}

function blendColor(from: [number, number, number], to: [number, number, number], t: number) {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)] as const;
}

function getHeatCellStyle(valueNum: number | null, minNum: number | null, maxNum: number | null) {
  if (valueNum === null || minNum === null || maxNum === null) {
    return {} as const;
  }

  if (minNum === maxNum) {
    return {
      backgroundColor: "rgba(255, 238, 111, 0.52)",
      color: "#0f172a",
      textShadow: "0 0 1px rgba(0, 0, 0, 0.28)",
      WebkitTextStroke: "0.25px rgba(0, 0, 0, 0.25)"
    } as const;
  }

  const ratio = Math.min(1, Math.max(0, (valueNum - minNum) / (maxNum - minNum)));

  const red: [number, number, number] = [255, 155, 128];
  const yellow: [number, number, number] = [255, 238, 111];
  const green: [number, number, number] = [161, 212, 140];

  const color = ratio <= 0.5
    ? blendColor(red, yellow, ratio / 0.5)
    : blendColor(yellow, green, (ratio - 0.5) / 0.5);

  return {
    backgroundColor: `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.52)`,
    color: "#0f172a",
    textShadow: "0 0 1px rgba(0, 0, 0, 0.28)",
    WebkitTextStroke: "0.25px rgba(0, 0, 0, 0.25)"
  } as const;
}

function formatTooltipTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export function BenchmarkMatrix({ rows }: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const showCategoryLoadedRef = useRef(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCategory, setShowCategory] = useState(true);
  const [isModelFilterExpanded, setIsModelFilterExpanded] = useState(false);
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [activeCellTooltip, setActiveCellTooltip] = useState<{
    x: number;
    y: number;
    entries: MatrixCellEntry[];
  } | null>(null);

  const sourceOptions = useMemo(() => {
    const keys = Array.from(new Set(rows.map((row) => getSourceKey(row.source)))).sort((a, b) =>
      getSourceLabel(a).localeCompare(getSourceLabel(b), "zh-Hans-CN")
    );

    return [
      { key: SOURCE_ALL, label: "全部" },
      ...keys.map((key) => ({ key, label: getSourceLabel(key) }))
    ];
  }, [rows]);

  const [activeSource, setActiveSource] = useState(SOURCE_ALL);

  useEffect(() => {
    const sourceFromUrl = searchParams.get("source");
    if (!sourceFromUrl) {
      setActiveSource(SOURCE_ALL);
      return;
    }

    const isKnown = sourceOptions.some((item) => item.key === sourceFromUrl);
    setActiveSource(isKnown ? sourceFromUrl : SOURCE_ALL);
  }, [searchParams, sourceOptions]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SHOW_CATEGORY_STORAGE_KEY);
      if (saved === "0" || saved === "1") {
        setShowCategory(saved === "1");
      }
    } catch {
      // ignore storage access errors gracefully
    }

    showCategoryLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!showCategoryLoadedRef.current) return;

    try {
      window.localStorage.setItem(SHOW_CATEGORY_STORAGE_KEY, showCategory ? "1" : "0");
    } catch {
      // ignore storage access errors gracefully
    }
  }, [showCategory]);

  function setSourceAndUrl(nextSource: string) {
    setActiveSource(nextSource);

    const params = new URLSearchParams(searchParams.toString());
    if (nextSource === SOURCE_ALL) {
      params.delete("source");
    } else {
      params.set("source", nextSource);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const providerGroups = useMemo(() => {
    const map = new Map<string, Set<string>>();

    rows.forEach((row) => {
      const provider = row.providerName || "Unknown";
      if (!map.has(provider)) {
        map.set(provider, new Set<string>());
      }
      map.get(provider)!.add(row.modelName);
    });

    return Array.from(map.entries())
      .map(([providerName, modelSet]) => ({
        providerName,
        models: Array.from(modelSet).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
      }))
      .sort((a, b) => a.providerName.localeCompare(b.providerName, "zh-Hans-CN"));
  }, [rows]);

  const allModelNames = useMemo(
    () => providerGroups.flatMap((group) => group.models).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    [providerGroups]
  );

  const [selectedModels, setSelectedModels] = useState<string[]>(allModelNames);

  useEffect(() => {
    setSelectedModels((prev) => {
      if (prev.length === 0) {
        return allModelNames;
      }

      const allSet = new Set(allModelNames);
      const kept = prev.filter((model) => allSet.has(model));
      return kept.length > 0 ? kept : allModelNames;
    });
  }, [allModelNames]);

  useEffect(() => {
    const listener = () => {
      setIsFullscreen(document.fullscreenElement === sectionRef.current);
    };

    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  const selectedModelSet = useMemo(() => new Set(selectedModels), [selectedModels]);

  const modelProviderMap = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      if (!map.has(row.modelName)) {
        map.set(row.modelName, row.providerName);
      }
    });
    return map;
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const sourceMatched = activeSource === SOURCE_ALL || getSourceKey(row.source) === activeSource;
      const modelMatched = selectedModelSet.has(row.modelName);
      return sourceMatched && modelMatched;
    });
  }, [rows, activeSource, selectedModelSet]);

  const modelColumns = useMemo(() => {
    return Array.from(new Set(filteredRows.map((row) => row.modelName))).sort((a, b) =>
      a.localeCompare(b, "zh-Hans-CN")
    );
  }, [filteredRows]);

  const modelColumnMeta = useMemo(() => {
    return modelColumns.map((modelName) => {
      const providerName = modelProviderMap.get(modelName) ?? "Unknown";
      const columnWidth = Math.min(112, Math.max(72, Math.round(modelName.length * 6.8)));

      return {
        modelName,
        providerName,
        color: getProviderBrandColor(providerName),
        columnWidth
      };
    });
  }, [modelColumns, modelProviderMap]);

  const matrixRows = useMemo(() => {
    const matrixMap = new Map<string, MatrixRow>();

    filteredRows.forEach((row) => {
      const category = row.benchmarkType || "General";
      const benchmark = row.benchmarkName;
      const matrixKey = `${category}::${benchmark}`;

      if (!matrixMap.has(matrixKey)) {
        matrixMap.set(matrixKey, {
          category,
          benchmark,
          cells: new Map<string, MatrixCell>(),
          rowDataCount: 0,
          rowNumericCount: 0,
          minNum: null,
          maxNum: null
        });
      }

      const matrixRow = matrixMap.get(matrixKey)!;
      if (!matrixRow.cells.has(row.modelName)) {
        matrixRow.cells.set(row.modelName, {
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
          source: row.source,
          benchTime: row.benchTime,
          allEntries: [
            {
              valueRaw: row.valueRaw,
              valueNum: row.valueNum,
              source: row.source,
              benchTime: row.benchTime
            }
          ],
          hasMultipleValues: false
        });
      } else {
        const existingCell = matrixRow.cells.get(row.modelName)!;
        existingCell.allEntries.push({
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
          source: row.source,
          benchTime: row.benchTime
        });
        existingCell.hasMultipleValues = existingCell.allEntries.length > 1;

        if (row.valueNum !== null && (existingCell.valueNum === null || row.valueNum > existingCell.valueNum)) {
          existingCell.valueNum = row.valueNum;
          existingCell.valueRaw = row.valueRaw;
          existingCell.source = row.source;
          existingCell.benchTime = row.benchTime;
        }
      }
    });

    return Array.from(matrixMap.values())
      .map((matrixRow) => {
        const numericValues = Array.from(matrixRow.cells.values())
          .map((cell) => cell.valueNum)
          .filter((value): value is number => value !== null && Number.isFinite(value));

        const rowDataCount = matrixRow.cells.size;
        const rowNumericCount = numericValues.length;

        return {
          ...matrixRow,
          rowDataCount,
          rowNumericCount,
          minNum: numericValues.length > 0 ? Math.min(...numericValues) : null,
          maxNum: numericValues.length > 0 ? Math.max(...numericValues) : null
        };
      })
      .sort((a, b) => {
        if (a.rowDataCount !== b.rowDataCount) {
          return b.rowDataCount - a.rowDataCount;
        }

        if (a.rowNumericCount !== b.rowNumericCount) {
          return b.rowNumericCount - a.rowNumericCount;
        }

        const categoryCompare = a.category.localeCompare(b.category, "zh-Hans-CN");
        if (categoryCompare !== 0) return categoryCompare;
        return a.benchmark.localeCompare(b.benchmark, "zh-Hans-CN");
      });
  }, [filteredRows]);

  function toggleModel(modelName: string, checked: boolean) {
    setSelectedModels((prev) => {
      const set = new Set(prev);
      if (checked) {
        set.add(modelName);
      } else {
        set.delete(modelName);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    });
  }

  function toggleProvider(providerName: string, checked: boolean) {
    const group = providerGroups.find((item) => item.providerName === providerName);
    if (!group) return;

    setSelectedModels((prev) => {
      const set = new Set(prev);
      group.models.forEach((model) => {
        if (checked) {
          set.add(model);
        } else {
          set.delete(model);
        }
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    });
  }

  function selectAllModels() {
    setSelectedModels(allModelNames);
  }

  function clearAllModels() {
    setSelectedModels([]);
  }

  async function toggleFullscreen() {
    if (!sectionRef.current) return;

    try {
      if (document.fullscreenElement === sectionRef.current) {
        await document.exitFullscreen();
      } else {
        await sectionRef.current.requestFullscreen();
      }
    } catch {
      // ignore fullscreen API errors gracefully
    }
  }

  return (
    <section className="card" ref={sectionRef} style={isFullscreen ? { paddingTop: 8 } : undefined}>
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="tabs tabs-boxed bg-base-200/70 p-1">
          {sourceOptions.map((source) => (
            <button
              key={source.key}
              type="button"
              role="tab"
              className={`tab transition-all ${
                activeSource === source.key
                  ? "tab-active !rounded-xl !bg-primary/50 !text-primary-content font-semibold shadow-[0_0_0_0px_rgba(93,167,255,0.55),0_4px_20px_rgba(93,167,255,0.22)] scale-[1.01]"
                  : "hover:!rounded-xl hover:bg-base-100/60"
              }`}
              onClick={() => setSourceAndUrl(source.key)}
            >
              {source.key === SOURCE_ALL ? source.label : sourceTabDisplayLabel(source.key)}
            </button>
          ))}
        </div>

        <button type="button" className="btn btn-sm btn-outline ml-auto" onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize2 size={15} /> : <Expand size={15} />}
          {isFullscreen ? "退出全屏" : "全屏显示表格"}
        </button>

        <button
          type="button"
          className="btn btn-xs btn-ghost"
          onClick={() => setShowCategory((prev) => !prev)}
        >
          {showCategory ? <Eye size={14} /> : <EyeOff size={14} />}
          显示类别列
        </button>
      </div>

      <div className={`${isFullscreen ? "mt-2" : ""} rounded-box border border-base-300/70 bg-base-200/35 p-3`}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs opacity-80">
          <Layers size={14} />
          <span>模型层叠筛选：点击可展开具体模型列表</span>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            style={{ marginLeft: 4 }}
            onClick={() => setIsModelFilterExpanded((prev) => !prev)}
          >
            {isModelFilterExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {isModelFilterExpanded ? "收起模型筛选" : "展开模型筛选"}
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2 opacity-100">
            <div className="flex items-center gap-1 text-xs opacity-75">
              <Filter size={14} />
              已选模型 {selectedModels.length}/{allModelNames.length}
            </div>

            <button type="button" className="btn btn-xs btn-ghost" onClick={selectAllModels}>
              全选模型
            </button>
            <button type="button" className="btn btn-xs btn-ghost" onClick={clearAllModels}>
              清空模型
            </button>
          </div>
        </div>

        {isModelFilterExpanded ? (
          <div className={`grid grid-cols-1 gap-2 md:grid-cols-2 ${isFullscreen ? "xl:grid-cols-6" : "xl:grid-cols-4"}`}>
            {providerGroups.map((group) => {
              const selectedCount = group.models.filter((model) => selectedModelSet.has(model)).length;
              const providerChecked = selectedCount > 0 && selectedCount === group.models.length;

              return (
                <details key={group.providerName} className="rounded-lg border border-base-300/70 bg-base-100/70 px-2 py-1">
                  <summary className="flex list-none items-center justify-between gap-2 cursor-pointer py-1">
                    <label
                      className="inline-flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs"
                        checked={providerChecked}
                        onChange={(e) => toggleProvider(group.providerName, e.target.checked)}
                      />
                      <span className="text-sm font-medium" style={{ color: getProviderBrandColor(group.providerName) }}>
                        {group.providerName}
                      </span>
                    </label>
                    <span className="text-xs opacity-70">{selectedCount}/{group.models.length}</span>
                  </summary>

                  <div className="grid grid-cols-1 gap-1 pb-2 pt-1">
                    {group.models.map((model) => (
                      <label key={`${group.providerName}-${model}`} className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={selectedModelSet.has(model)}
                          onChange={(e) => toggleModel(model, e.target.checked)}
                        />
                        <span className="truncate" title={model}>{model}</span>
                      </label>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        ) : null}
      </div>

      <div
        style={{
          overflow: "auto",
          maxHeight: isFullscreen
            ? `calc(100vh - ${isModelFilterExpanded ? 170 : 120}px)`
            : "98vh",
          borderRadius: 10,
          border: "1px solid rgba(53, 73, 116, 0.35)"
        }}
      >
        <table>
          <thead>
            <tr>
              {showCategory ? (
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 20,
                    width: 150,
                    minWidth: 150,
                    maxWidth: 150,
                    padding: "6px 8px",
                    background: "rgba(20, 27, 45, 0.96)",
                    backdropFilter: "blur(6px)",
                    whiteSpace: "nowrap"
                  }}
                >
                  Category
                </th>
              ) : null}

              <th
                style={{
                  position: "sticky",
                  top: 0,
                  left: 0,
                  zIndex: 35,
                  minWidth: 180,
                  padding: "6px 8px",
                  background: "rgba(20, 27, 45, 0.98)",
                  backdropFilter: "blur(6px)",
                  boxShadow: "8px 0 12px rgba(2, 6, 23, 0.35)",
                  whiteSpace: "nowrap"
                }}
              >
                Benchmark
              </th>

              {modelColumnMeta.map((model) => (
                <th
                  key={model.modelName}
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 20,
                    width: model.columnWidth,
                    minWidth: model.columnWidth,
                    maxWidth: 120,
                    padding: "6px 6px",
                    background: "rgba(20, 27, 45, 0.96)",
                    backdropFilter: "blur(6px)"
                  }}
                >
                  <div
                    style={{
                      color: model.color,
                      fontWeight: 700,
                      lineHeight: 1.15,
                      wordBreak: "break-word"
                    }}
                  >
                    {model.modelName}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrixRows.map((matrixRow) => {
              const rowKey = `${matrixRow.category}::${matrixRow.benchmark}`;
              const isHoveredRow = hoveredRowKey === rowKey;
              const isSelectedRow = selectedRowKey === rowKey;
              const rowBorderColor = isSelectedRow
                ? "rgba(94, 234, 212, 0.78)"
                : isHoveredRow
                  ? "rgba(148, 163, 184, 0.45)"
                  : null;
              const rowFrameStyle = isSelectedRow
                ? {
                    outline: "1px solid rgba(94, 234, 212, 0.78)",
                    outlineOffset: "-2px",
                    boxShadow: "0 0 0 1px rgba(94, 234, 212, 0.36), 0 0 12px rgba(45, 212, 191, 0.25)"
                  }
                : isHoveredRow
                  ? {
                      outline: "1px solid rgba(148, 163, 184, 0.38)",
                      outlineOffset: "-2px",
                      boxShadow: "0 0 8px rgba(148, 163, 184, 0.2)"
                    }
                  : undefined;
              const rowCellLineStyle = rowBorderColor
                ? {
                    borderTopWidth: 1,
                    borderTopStyle: "solid" as const,
                    borderTopColor: rowBorderColor,
                    borderBottomColor: rowBorderColor,
                    backgroundImage: isSelectedRow
                      ? "linear-gradient(rgba(45, 212, 191, 0.10), rgba(45, 212, 191, 0.10))"
                      : "linear-gradient(rgba(148, 163, 184, 0.05), rgba(148, 163, 184, 0.05))",
                    boxShadow: isSelectedRow
                      ? "inset 0 1px 0 rgba(94, 234, 212, 0.5), inset 0 -1px 0 rgba(94, 234, 212, 0.5)"
                      : "inset 0 1px 0 rgba(148, 163, 184, 0.3), inset 0 -1px 0 rgba(148, 163, 184, 0.3)"
                  }
                : undefined;
              const rowLeftEdgeStyle = {
                borderLeft: `1px solid ${rowBorderColor ?? "transparent"}`
              };
              const rowRightEdgeStyle = {
                borderRight: `1px solid ${rowBorderColor ?? "transparent"}`
              };

              return (
              <tr
                key={rowKey}
                onMouseEnter={() => setHoveredRowKey(rowKey)}
                onMouseLeave={() => setHoveredRowKey((prev) => (prev === rowKey ? null : prev))}
                onClick={() => setSelectedRowKey((prev) => (prev === rowKey ? null : rowKey))}
                style={{ cursor: "pointer", ...rowFrameStyle }}
              >
                {showCategory ? (
                  <td
                    style={{
                      width: 150,
                      minWidth: 150,
                      maxWidth: 150,
                      padding: "6px 8px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      ...rowCellLineStyle,
                      ...rowLeftEdgeStyle
                    }}
                    title={matrixRow.category}
                  >
                    {matrixRow.category}
                  </td>
                ) : null}

                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 12,
                    minWidth: 180,
                    padding: "6px 8px",
                    backgroundColor: "rgba(20, 27, 45, 0.96)",
                    boxShadow: "8px 0 12px rgba(2, 6, 23, 0.28)",
                    whiteSpace: "nowrap",
                    ...rowCellLineStyle,
                    ...(showCategory ? {} : rowLeftEdgeStyle)
                  }}
                >
                  {matrixRow.benchmark}
                </td>

                {modelColumnMeta.map((model, modelIndex) => {
                  const cell = matrixRow.cells.get(model.modelName);
                  const cellNum = cell?.valueNum ?? null;
                  const rawText = cell?.valueRaw ?? "--";
                  const allEntries = cell?.allEntries ?? [];
                  const valueIdentitySet = new Set(
                    allEntries.map((entry) =>
                      entry.valueNum !== null ? `num:${entry.valueNum}` : `raw:${entry.valueRaw}`
                    )
                  );
                  const hasMultipleValues = (cell?.hasMultipleValues ?? false) && valueIdentitySet.size > 1;
                  const uniqueEntries = Array.from(
                    new Map(
                      allEntries.map((entry) => [
                        `${entry.valueRaw}__${entry.source ?? ""}__${entry.benchTime}`,
                        entry
                      ])
                    ).values()
                  );
                  const isMaxCell =
                    cellNum !== null &&
                    matrixRow.maxNum !== null &&
                    cellNum === matrixRow.maxNum;
                  const heatStyle = getHeatCellStyle(cellNum, matrixRow.minNum, matrixRow.maxNum);
                  const heatBackground =
                    (heatStyle as { backgroundColor?: string }).backgroundColor ?? "rgba(20, 27, 45, 0.96)";
                  const hasHeatColor = cellNum !== null && matrixRow.minNum !== null && matrixRow.maxNum !== null;

                  return (
                    <td
                      key={`${matrixRow.category}::${matrixRow.benchmark}::${model.modelName}`}
                      style={{
                        ...heatStyle,
                        backgroundColor: heatBackground,
                        borderBottomColor: hasHeatColor ? "rgba(255, 255, 255, 0.08)" : undefined,
                        padding: "4px 6px",
                        paddingRight: hasMultipleValues ? "22px" : "6px",
                        fontSize: "14px",
                        lineHeight: 1.2,
                        whiteSpace: "nowrap",
                        position: "relative",
                        fontWeight: isMaxCell ? 800 : undefined,
                        textDecoration: isMaxCell ? "underline" : undefined,
                        textDecorationColor: isMaxCell ? "rgba(15, 23, 42, 0.35)" : undefined,
                        textDecorationThickness: isMaxCell ? "1px" : undefined,
                        textUnderlineOffset: isMaxCell ? "2px" : undefined,
                        ...rowCellLineStyle,
                        ...(modelIndex === modelColumnMeta.length - 1 ? rowRightEdgeStyle ?? {} : {})
                      }}
                    >
                      <span>{rawText}</span>
                      {hasMultipleValues ? (
                        <span
                          className="absolute right-1 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 cursor-help items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
                          onMouseEnter={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setActiveCellTooltip({
                              x: rect.left + rect.width / 2,
                              y: rect.top - 6,
                              entries: uniqueEntries
                            });
                          }}
                          onMouseLeave={() => setActiveCellTooltip(null)}
                        >
                          ?
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      {activeCellTooltip ? (
        <div
          className="pointer-events-none fixed z-[2600] w-[320px] max-w-[320px] rounded-xl border border-white/20 bg-slate-900/96 p-2 text-left text-[11px] font-medium text-slate-100 shadow-2xl backdrop-blur-lg"
          style={{
            left: activeCellTooltip.x,
            top: activeCellTooltip.y,
            transform: "translate(-50%, -100%)"
          }}
        >
          <span className="mb-1 block text-[10px] text-slate-300">该单元格存在多条记录</span>
          <span className="block max-h-44 space-y-1 overflow-auto">
            {activeCellTooltip.entries.map((entry) => (
              <span
                key={`${entry.valueRaw}-${entry.source ?? "-"}-${entry.benchTime}`}
                className="block rounded-md bg-white/5 px-2 py-1 leading-4"
              >
                {entry.valueRaw}
                <span className="opacity-80"> · {entry.source ?? "unknown-source"} · {formatTooltipTime(entry.benchTime)}</span>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {matrixRows.length === 0 ? (
        <div className="mt-3 text-sm opacity-75">当前筛选条件下暂无数据。</div>
      ) : null}
    </section>
  );
}
