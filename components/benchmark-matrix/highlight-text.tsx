import type { ReactNode } from "react";

import { getSearchHighlightPlan } from "./search-match";

export interface HighlightTextProps {
  text: string | null | undefined;
  query?: string | null;
  className?: string;
  highlightClassName?: string;
}

function renderPlainText(text: string, className?: string): ReactNode {
  return className ? <span className={className}>{text}</span> : text;
}

/**
 * 高亮文本中匹配搜索词的部分。
 *
 * 1. 无搜索词或未命中时直接返回原始文本，不产生高亮节点；
 * 2. 关键词由 search-match 统一拆分并转义正则特殊字符，忽略大小写但保留原文大小写；
 * 3. 整段命中时只渲染一个 <mark>，避免冗余节点；
 * 4. 部分命中时保留 sr-only 完整文本（供辅助技术一次性朗读完整名称），
 *    视觉分片交给 aria-hidden 容器，避免同一段文字被读两遍。
 */
export function HighlightText({
  text,
  query,
  className,
  highlightClassName = "matrix-search-highlight"
}: HighlightTextProps): ReactNode {
  if (!text) return null;

  const plan = query ? getSearchHighlightPlan(query) : null;
  if (!plan) {
    return renderPlainText(text, className);
  }

  const parts = text.split(plan.pattern);
  if (parts.length <= 1) {
    return renderPlainText(text, className);
  }

  // 整段命中：只留一个 mark，不需要额外的辅助文本层。
  if (parts.length === 3 && !parts[0] && !parts[2]) {
    const markNode = <mark className={highlightClassName}>{text}</mark>;
    return className ? <span className={className}>{markNode}</span> : markNode;
  }

  const content = parts.map((part, index) => {
    if (!part || !plan.normalizedTokens.has(part.toLowerCase())) return part;
    return (
      <mark key={index} className={highlightClassName}>
        {part}
      </mark>
    );
  });

  return (
    <span className={className}>
      {/*
        隐藏的完整文本副本：供辅助技术一次性朗读完整名称。
        select-none 避免框选时被复制成两份，opacity-0 保证导出图片时不会漏出这层文字。
      */}
      <span className="sr-only select-none opacity-0">{text}</span>
      <span aria-hidden="true">{content}</span>
    </span>
  );
}
