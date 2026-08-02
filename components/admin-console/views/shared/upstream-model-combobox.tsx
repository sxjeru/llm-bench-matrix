"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";
import type { ExternalUpstreamModel } from "../../types";

type UpstreamModelComboboxProps = {
  modelName: string;
  value: string | null;
  selectedLabel: string;
  options: ExternalUpstreamModel[];
  disabled?: boolean;
  onChange: (externalModelId: string | null) => void;
};

type FloatingPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "bottom" | "top";
};

const UNBOUND_OPTION = {
  externalModelId: "",
  label: "（不绑定）",
  secondary: "清除当前绑定"
} as const;

function formatUpstreamOptionLabel(option: ExternalUpstreamModel) {
  return option.externalCreator
    ? `${option.externalModelName} — ${option.externalCreator}`
    : option.externalModelName;
}

function matchesUpstreamOption(option: ExternalUpstreamModel, query: string) {
  if (!query) return true;
  return (
    option.externalModelName.toLowerCase().includes(query) ||
    (option.externalCreator ?? "").toLowerCase().includes(query) ||
    (option.externalModelSlug ?? "").toLowerCase().includes(query) ||
    option.externalModelId.toLowerCase().includes(query)
  );
}

function measureFloatingPosition(root: HTMLElement | null): FloatingPosition | null {
  const rect = root?.getBoundingClientRect();
  if (!rect) return null;

  const gap = 4;
  const preferredMaxHeight = 280;
  const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
  const spaceAbove = rect.top - gap - 8;
  const placement = spaceBelow >= 160 || spaceBelow >= spaceAbove ? "bottom" : "top";
  const maxHeight = Math.max(120, Math.min(preferredMaxHeight, placement === "bottom" ? spaceBelow : spaceAbove));

  return {
    left: rect.left,
    top: placement === "bottom" ? rect.bottom + gap : rect.top - gap,
    width: Math.max(rect.width, 280),
    maxHeight,
    placement
  };
}

export function UpstreamModelCombobox({
  modelName,
  value,
  selectedLabel,
  options,
  disabled = false,
  onChange
}: UpstreamModelComboboxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<FloatingPosition | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const displayLabel = selectedLabel || UNBOUND_OPTION.label;

  const filteredOptions = useMemo(() => {
    const matched = options.filter((option) => matchesUpstreamOption(option, normalizedQuery));
    const unboundMatches =
      !normalizedQuery ||
      UNBOUND_OPTION.label.toLowerCase().includes(normalizedQuery) ||
      UNBOUND_OPTION.secondary.toLowerCase().includes(normalizedQuery);

    return {
      showUnbound: unboundMatches,
      options: matched
    };
  }, [options, normalizedQuery]);

  const flatOptions = useMemo(() => {
    const next: Array<{ externalModelId: string | null; label: string; secondary?: string }> = [];
    if (filteredOptions.showUnbound) {
      next.push({
        externalModelId: null,
        label: UNBOUND_OPTION.label,
        secondary: UNBOUND_OPTION.secondary
      });
    }
    for (const option of filteredOptions.options) {
      next.push({
        externalModelId: option.externalModelId,
        label: formatUpstreamOptionLabel(option),
        secondary: option.externalModelSlug ?? undefined
      });
    }
    return next;
  }, [filteredOptions]);

  const activeOptionIndex = activeIndex < flatOptions.length ? activeIndex : 0;

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
    setPosition(null);
  }, []);

  const updatePosition = useCallback(() => {
    const next = measureFloatingPosition(rootRef.current);
    if (next) setPosition(next);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition, flatOptions.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
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
    (externalModelId: string | null) => {
      onChange(externalModelId);
      close();
    },
    [onChange, close]
  );

  const openList = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    setActiveIndex(0);
  }, [disabled]);

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
    setActiveIndex(0);
    if (!isOpen) setIsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openList();
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
      if (!option) return;
      event.preventDefault();
      selectOption(option.externalModelId);
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

  const dropdown =
    isOpen && position && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="admin-upstream-combobox-list"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
              transform: position.placement === "top" ? "translateY(-100%)" : undefined
            }}
          >
            {flatOptions.length === 0 ? (
              <li className="admin-upstream-combobox-empty" role="presentation">
                没有匹配的上游条目
              </li>
            ) : (
              flatOptions.map((option, optionIndex) => {
                const isActive = optionIndex === activeOptionIndex;
                const isSelected = (option.externalModelId ?? "") === (value ?? "");

                return (
                  <li
                    key={`${option.externalModelId ?? "unbound"}-${optionIndex}`}
                    id={`${listId}-${optionIndex}`}
                    role="option"
                    aria-selected={isSelected}
                    data-option-index={optionIndex}
                    className={`admin-upstream-combobox-option ${isActive ? "is-active" : ""} ${
                      isSelected ? "is-selected" : ""
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOption(option.externalModelId)}
                    onMouseEnter={() => setActiveIndex(optionIndex)}
                  >
                    <span className="admin-upstream-combobox-option-label">{option.label}</span>
                    {option.secondary ? (
                      <span className="admin-upstream-combobox-option-secondary">{option.secondary}</span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>,
          document.body
        )
      : null;

  return (
    <div className={`admin-upstream-combobox ${disabled ? "is-disabled" : ""}`} ref={rootRef}>
      <Search size={13} className="admin-upstream-combobox-icon" aria-hidden="true" />
      <input
        type="text"
        role="combobox"
        className="admin-upstream-combobox-input"
        autoComplete="off"
        disabled={disabled}
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={`${modelName} 的上游条目`}
        aria-activedescendant={
          isOpen && flatOptions[activeOptionIndex] ? `${listId}-${activeOptionIndex}` : undefined
        }
        value={isOpen ? query : displayLabel}
        placeholder={isOpen ? displayLabel || "搜索上游条目…" : "搜索或选择上游条目"}
        title={displayLabel}
        onChange={(event) => handleQueryChange(event.target.value)}
        onFocus={openList}
        onClick={openList}
        onKeyDown={handleKeyDown}
      />
      {value && !disabled ? (
        <button
          type="button"
          className="admin-upstream-combobox-clear"
          aria-label={`清除 ${modelName} 的上游绑定`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectOption(null)}
        >
          <X size={12} />
        </button>
      ) : (
        <ChevronDown size={14} className="admin-upstream-combobox-caret" aria-hidden="true" />
      )}
      {dropdown}
    </div>
  );
}
