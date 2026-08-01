"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { describeMetricDirection } from "./metrics";
import type { ScatterMetric, ScatterMetricGroup } from "./types";

type MetricComboboxProps = {
  id: string;
  /** 无障碍标签，例如「X 轴」 */
  axisName: string;
  metric: ScatterMetric | null;
  metricGroups: ScatterMetricGroup[];
  onChange: (key: string) => void;
  /** 输入内容变化时回传，供上层顺带放开低覆盖指标 */
  onQueryChange?: (query: string) => void;
};

type FlatOption = {
  metric: ScatterMetric;
  index: number;
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
 * 指标动辄上百条，原生 `<select>` 只能靠首字母跳转，找一条 benchmark 要翻很久。
 * 这里做成「输入即筛选」的组合框：分类分组保留，键盘上下键与回车照常可用。
 */
export function MetricCombobox({
  id,
  axisName,
  metric,
  metricGroups,
  onChange,
  onQueryChange
}: MetricComboboxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

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

  const flatOptions = useMemo<FlatOption[]>(() => {
    const options: FlatOption[] = [];
    filteredGroups.forEach((group) => {
      group.metrics.forEach((item) => {
        options.push({ metric: item, index: options.length });
      });
    });
    return options;
  }, [filteredGroups]);

  // 结果集变小后旧下标可能越界，渲染期直接钳一下即可，不必再多走一轮 setState
  const activeOptionIndex = activeIndex < flatOptions.length ? activeIndex : 0;

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    onQueryChange?.("");
  }, [onQueryChange]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) close();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, close]);

  // 键盘移动高亮时把选项滚进可视区
  useEffect(() => {
    if (!isOpen) return;
    listRef.current
      ?.querySelector(`[data-option-index="${activeOptionIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeOptionIndex]);

  const selectOption = useCallback(
    (key: string) => {
      onChange(key);
      close();
    },
    [onChange, close]
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setActiveIndex(0);
    if (!isOpen) setIsOpen(true);
    onQueryChange?.(value);
  };

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
        selectOption(option.metric.key);
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

  return (
    <div className="scatter-combobox" ref={rootRef}>
      <Search size={13} className="scatter-combobox-icon" aria-hidden="true" />

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
        // 关闭时显示当前选中项，展开后清空成搜索框，用占位符提示原选择
        value={isOpen ? query : metric?.label ?? ""}
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
            filteredGroups.map((group) => (
              <li key={group.category} role="presentation">
                <div className="scatter-combobox-group">{group.category}</div>
                <ul role="group" aria-label={group.category}>
                  {group.metrics.map((item) => {
                    const option = flatOptions.find((entry) => entry.metric.key === item.key);
                    const optionIndex = option?.index ?? -1;
                    const isActive = optionIndex === activeOptionIndex;
                    const isSelected = item.key === metric?.key;

                    return (
                      <li
                        key={item.key}
                        id={`${listId}-${optionIndex}`}
                        role="option"
                        aria-selected={isSelected}
                        data-option-index={optionIndex}
                        className={`scatter-combobox-option ${isActive ? "is-active" : ""} ${
                          isSelected ? "is-selected" : ""
                        }`}
                        // 用 mousedown 抢在 blur 之前挡住失焦，否则点击会先关掉列表
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectOption(item.key)}
                        onMouseEnter={() => setActiveIndex(optionIndex)}
                      >
                        <span className="scatter-combobox-option-label">{item.label}</span>
                        <span
                          className={`scatter-combobox-option-direction ${
                            item.higherIsBetter ? "is-up" : "is-down"
                          }`}
                        >
                          {item.higherIsBetter ? "↑" : "↓"} {describeMetricDirection(item)}
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
    </div>
  );
}
