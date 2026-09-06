"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, History, Search } from "lucide-react";
import { describeMetricDirection } from "./metrics";
import { SNAPSHOT_MAJOR_MODEL_COUNT_THRESHOLD } from "./constants";
import type { ScatterMetric, ScatterMetricGroup, ScatterMetricSnapshot } from "./types";

type MetricComboboxProps = {
  id: string;
  /** 无障碍标签，例如「X 轴」 */
  axisName: string;
  metric: ScatterMetric | null;
  metricGroups: ScatterMetricGroup[];
  selectedSnapshotId?: string | null;
  overlaySnapshotId?: string | null;
  onChange: (key: string, snapshotId?: string | null) => void;
  onToggleOverlaySnapshot?: (snapshotId: string) => void;
  /** 输入内容变化时回传，供上层顺带放开低覆盖指标 */
  onQueryChange?: (query: string) => void;
};

function matchesQuery(metric: ScatterMetric, category: string, query: string): boolean {
  if (!query) return true;
  return (
    metric.label.toLowerCase().includes(query) ||
    category.toLowerCase().includes(query)
  );
}

/**
 * 可输入筛选的指标选择器。
 *
 * 支持：
 * 1. 拼音/关键词输入即筛选；
 * 2. 鼠标悬浮到有多批次快照的指标（如 AA 指标）时，在右侧展开级联时间快照列表；
 * 3. 直接点击指标行：默认取最新值；
 * 4. 普通点击时间快照：切换主图表至该时间；
 * 5. 按住 Ctrl/Cmd 点击时间快照：半透明叠加该快照作为对比背景。
 */
export function MetricCombobox({
  id,
  axisName,
  metric,
  metricGroups,
  selectedSnapshotId = null,
  overlaySnapshotId = null,
  onChange,
  onToggleOverlaySnapshot,
  onQueryChange
}: MetricComboboxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // 当前悬浮触发级联子菜单的指标与其定位锚点
  const [submenuState, setSubmenuState] = useState<{
    metric: ScatterMetric;
    top: number;
    left: number;
    placement: "right" | "left";
  } | null>(null);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return metricGroups;

    return metricGroups
      .map((group) => ({
        category: group.category,
        metrics: group.metrics.filter((item) => matchesQuery(item, group.category, normalizedQuery))
      }))
      .filter((group) => group.metrics.length > 0);
  }, [metricGroups, normalizedQuery]);

  const { renderGroups, flatOptions } = useMemo(() => {
    const flat: ScatterMetric[] = [];
    const groups = filteredGroups.map((group) => {
      const startIndex = flat.length;
      flat.push(...group.metrics);
      return { ...group, startIndex };
    });
    return { renderGroups: groups, flatOptions: flat };
  }, [filteredGroups]);

  const activeOptionIndex = activeIndex < flatOptions.length ? activeIndex : 0;

  const closeSubmenu = useCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setSubmenuState(null);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    closeSubmenu();
    onQueryChange?.("");
  }, [closeSubmenu, onQueryChange]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        !rootRef.current?.contains(target) &&
        !submenuRef.current?.contains(target)
      ) {
        close();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) return;
    listRef.current
      ?.querySelector(`[data-option-index="${activeOptionIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeOptionIndex]);

  const selectOption = useCallback(
    (key: string, snapshotId: string | null = null) => {
      onChange(key, snapshotId);
      close();
    },
    [onChange, close]
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setActiveIndex(0);
    closeSubmenu();
    if (!isOpen) setIsOpen(true);
    onQueryChange?.(value);
  };

  const scheduleOpenSubmenu = useCallback(
    (targetMetric: ScatterMetric, element: HTMLElement) => {
      if (hoverTimeoutRef.current) {
        window.clearTimeout(hoverTimeoutRef.current);
      }

      if (!targetMetric.snapshots || targetMetric.snapshots.length <= 1) {
        setSubmenuState(null);
        return;
      }

      hoverTimeoutRef.current = window.setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const submenuWidth = 230;
        const fitsRight = rect.right + submenuWidth + 8 <= window.innerWidth;
        const left = fitsRight ? rect.right + 4 : Math.max(8, rect.left - submenuWidth - 4);
        const top = Math.min(rect.top - 4, window.innerHeight - 320);

        setSubmenuState({
          metric: targetMetric,
          top: Math.max(8, top),
          left,
          placement: fitsRight ? "right" : "left"
        });
      }, 100);
    },
    []
  );

  const scheduleCloseSubmenu = useCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setSubmenuState(null);
    }, 150);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (flatOptions.length === 0) return;

      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((previous) => (previous + step + flatOptions.length) % flatOptions.length);
      return;
    }

    if (event.key === "Enter") {
      if (!isOpen) return;
      const option = flatOptions[activeOptionIndex];
      if (option) {
        event.preventDefault();
        selectOption(option.key);
      }
      return;
    }

    if (event.key === "Escape") {
      if (!isOpen) return;
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "Tab" && isOpen) {
      close();
    }
  };

  // 计算展示标签：如果当前选中了特定历史快照，在输入框展示快照标签
  const displayValue = useMemo(() => {
    if (!metric) return "";
    if (!selectedSnapshotId) return metric.label;
    const snapshot = metric.snapshots?.find((s) => s.id === selectedSnapshotId);
    return snapshot ? `${metric.label} [${snapshot.label}]` : metric.label;
  }, [metric, selectedSnapshotId]);

  const inputValue = isOpen ? query : displayValue;
  const hasContent = Boolean(inputValue && inputValue.trim().length > 0);

  return (
    <div className={`scatter-combobox${hasContent ? " has-content" : ""}`} ref={rootRef}>
      {!hasContent ? (
        <Search size={13} className="scatter-combobox-icon" aria-hidden="true" />
      ) : null}

      <input
        id={id}
        type="text"
        role="combobox"
        className="scatter-combobox-input"
        autoComplete="off"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={`${axisName}指标`}
        aria-activedescendant={
          isOpen && flatOptions[activeOptionIndex] ? `${listId}-${activeOptionIndex}` : undefined
        }
        value={inputValue}
        placeholder={isOpen ? metric?.label ?? "搜索指标…" : "选择指标…"}
        onChange={(event) => handleQueryChange(event.target.value)}
        onFocus={() => setIsOpen(true)}
        onClick={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />

      <ChevronDown size={14} className="scatter-combobox-caret" aria-hidden="true" />

      {isOpen ? (
        <ul className="scatter-combobox-list" id={listId} role="listbox" ref={listRef}>
          {flatOptions.length === 0 ? (
            <li className="scatter-combobox-empty" role="presentation">
              没有匹配的指标
            </li>
          ) : (
            renderGroups.map((group) => (
              <li key={group.category} role="presentation">
                <div className="scatter-combobox-group">{group.category}</div>
                <ul role="group" aria-label={group.category}>
                  {group.metrics.map((item, itemIndex) => {
                    const optionIndex = group.startIndex + itemIndex;
                    const isActive = optionIndex === activeOptionIndex;
                    const isSelected = item.key === metric?.key;
                    const hasSnapshots = Boolean(item.snapshots && item.snapshots.length > 1);

                    return (
                      <li
                        key={item.key}
                        id={`${listId}-${optionIndex}`}
                        role="option"
                        aria-selected={isSelected}
                        data-option-index={optionIndex}
                        className={`scatter-combobox-option ${isActive ? "is-active" : ""} ${
                          isSelected ? "is-selected" : ""
                        } ${hasSnapshots ? "has-snapshots" : ""}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectOption(item.key)}
                        onMouseEnter={(event) => {
                          setActiveIndex(optionIndex);
                          scheduleOpenSubmenu(item, event.currentTarget);
                        }}
                        onMouseLeave={() => {
                          scheduleCloseSubmenu();
                        }}
                      >
                        <span className="scatter-combobox-option-label-wrapper">
                          <span className="scatter-combobox-option-label">{item.label}</span>
                          {hasSnapshots ? (
                            <span
                              className="scatter-combobox-snapshot-tag"
                              title={`${item.snapshots.length} 个历史评测快照`}
                            >
                              <History size={11} className="inline mr-0.5" />
                              {item.snapshots.length}
                            </span>
                          ) : null}
                        </span>

                        <span className="scatter-combobox-option-meta">
                          <span
                            className={`scatter-combobox-option-direction ${
                              item.higherIsBetter ? "is-up" : "is-down"
                            }`}
                          >
                            {item.higherIsBetter ? "↑" : "↓"} {describeMetricDirection(item)}
                          </span>
                          {hasSnapshots ? (
                            <ChevronRight size={13} className="scatter-combobox-flyout-arrow" />
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {/* 级联右侧快照时间列表子菜单 */}
      {isOpen && submenuState ? (
        <div
          ref={submenuRef}
          className="scatter-combobox-submenu"
          style={{
            position: "fixed",
            top: submenuState.top,
            left: submenuState.left,
            zIndex: 100
          }}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) {
              window.clearTimeout(hoverTimeoutRef.current);
            }
          }}
          onMouseLeave={() => {
            scheduleCloseSubmenu();
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="scatter-combobox-submenu-header">
            <span className="font-semibold">{submenuState.metric.label}</span>
            <div className="scatter-combobox-submenu-hint">
              按住 Ctrl 点击可半透明叠加对比
            </div>
          </div>

          <div className="scatter-combobox-submenu-list">
            {/* 默认最新 */}
            {(() => {
              const isDefaultSelected =
                submenuState.metric.key === metric?.key && !selectedSnapshotId;

              return (
                <div
                  className={`scatter-combobox-submenu-item ${isDefaultSelected ? "is-selected" : ""}`}
                  onClick={() => selectOption(submenuState.metric.key, null)}
                >
                  <div className="scatter-combobox-submenu-item-title">
                    <span>最新数据（默认）</span>
                    {isDefaultSelected ? (
                      <span className="scatter-combobox-badge-new">当前</span>
                    ) : null}
                  </div>
                  <div className="scatter-combobox-submenu-item-sub">
                    取各模型最新导入成绩
                  </div>
                </div>
              );
            })()}

            {(() => {
              const snapshots = submenuState.metric.snapshots;
              const isMajor = (s: ScatterMetricSnapshot) =>
                Boolean(s.isMajorRevision ?? s.modelCount > SNAPSHOT_MAJOR_MODEL_COUNT_THRESHOLD);
              const majorSnapshots = snapshots.filter(isMajor);
              const otherSnapshots = snapshots.filter((s) => !isMajor(s));

              const renderSnapshotItem = (snapshot: ScatterMetricSnapshot) => {
                const isSelected =
                  submenuState.metric.key === metric?.key &&
                  selectedSnapshotId === snapshot.id;
                const isOverlay = overlaySnapshotId === snapshot.id;

                return (
                  <div
                    key={snapshot.id}
                    className={`scatter-combobox-submenu-item ${isSelected ? "is-selected" : ""} ${
                      isOverlay ? "is-overlay" : ""
                    }`}
                    onClick={(event) => {
                      if (event.ctrlKey || event.metaKey) {
                        event.stopPropagation();
                        onToggleOverlaySnapshot?.(snapshot.id);
                        return;
                      }
                      selectOption(submenuState.metric.key, snapshot.id);
                    }}
                  >
                    <div className="scatter-combobox-submenu-item-title">
                      <span className="font-medium text-slate-100">{snapshot.label}</span>
                      <div className="flex items-center gap-1.5">
                        {isOverlay ? (
                          <span className="text-amber-400 text-[10.5px] font-semibold">
                            [已叠加背景]
                          </span>
                        ) : null}
                        {isSelected ? (
                          <span className="scatter-combobox-badge-new">当前</span>
                        ) : null}
                        <span className="scatter-combobox-badge-count">
                          {snapshot.modelCount} 模型
                        </span>
                      </div>
                    </div>
                  </div>
                );
              };

              return (
                <>
                  {majorSnapshots.length > 0 ? (
                    <>
                      <div className="scatter-combobox-submenu-divider">
                        主要变动
                      </div>
                      {majorSnapshots.map(renderSnapshotItem)}
                    </>
                  ) : null}

                  {otherSnapshots.length > 0 ? (
                    <>
                      <div className="scatter-combobox-submenu-divider">
                        {majorSnapshots.length > 0 ? "其他历史快照" : "历史快照批次"}
                      </div>
                      {otherSnapshots.map(renderSnapshotItem)}
                    </>
                  ) : null}
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </div>
  );
}
