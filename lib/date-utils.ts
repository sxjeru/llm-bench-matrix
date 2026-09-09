/**
 * 日期规范化与输入格式化工具
 */

/**
 * 格式化输入的日期文本为标准 YYYY-MM-DD（或 YYYY-MM）。
 *
 * 兼容处理常见用户输入与格式瑕疵：
 * - 多余的 0 / 错位（如 "2026-09-011" -> "2026-09-11"，"2026-09-001" -> "2026-09-01"）
 * - 单数字月份/日期（如 "2026-9-1" -> "2026-09-01"）
 * - 分隔符兼容（如 "2026/09/11", "2026.9.1", "2026_09_11", "2026年9月11日"）
 * - 纯数字紧凑格式（如 "20260911" -> "2026-09-11", "202609" -> "2026-09"）
 * - 年月格式（如 "2024-08", "2024-8" -> "2024-08"）
 *
 * 若无法按日期模式匹配，则保留原修整后的字符串，不打断用户。
 */
export function formatReleaseDateInput(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // 替换常见的中文年月日、斜杠、点号、下划线为标准短横线，并去除首尾连字符
  const cleaned = trimmed
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/[./_]/g, "-")
    .replace(/\s+/g, "")
    .replace(/^-+|-+$/g, "");

  // 1. 紧凑 8 位纯数字：YYYYMMDD
  if (/^\d{8}$/.test(cleaned)) {
    const y = cleaned.slice(0, 4);
    const m = cleaned.slice(4, 6);
    const d = cleaned.slice(6, 8);
    return `${y}-${m}-${d}`;
  }

  // 2. 紧凑 6 位纯数字：YYYYMM
  if (/^\d{6}$/.test(cleaned)) {
    const y = cleaned.slice(0, 4);
    const m = cleaned.slice(4, 6);
    return `${y}-${m}`;
  }

  // 3. 年-月-日：YYYY-M(M)-D(D) 或前导 0 瑕疵如 2026-09-011
  const ymdMatch = /^(\d{4})-(\d{1,3})-(\d{1,3})$/.exec(cleaned);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = String(Number.parseInt(ymdMatch[2], 10)).padStart(2, "0");
    const d = String(Number.parseInt(ymdMatch[3], 10)).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 4. 年-月：YYYY-M(M)
  const ymMatch = /^(\d{4})-(\d{1,3})$/.exec(cleaned);
  if (ymMatch) {
    const y = ymMatch[1];
    const m = String(Number.parseInt(ymMatch[2], 10)).padStart(2, "0");
    return `${y}-${m}`;
  }

  return trimmed;
}

export function normalizeReleaseDate(raw: string | null | undefined): string | null {
  const formatted = formatReleaseDateInput(raw);
  return formatted || null;
}

