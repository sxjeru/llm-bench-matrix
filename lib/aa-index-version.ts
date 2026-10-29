/**
 * AA 指数版本号的解析与比较。
 *
 * 单独成文件的原因：服务端导入（`lib/admin-service.ts`）也要按版本判断
 * 「这次导入是重复同步还是一次重新评测」，而 `lib/aa-index-revisions.ts`
 * 依赖前端组件模块，不能被服务端直接引用。
 */

/**
 * 从 valueNote 中提取显式的版本标记（v5 / v4.1 / Intelligence Index v5）。
 *
 * 必须带 `v` 前缀：valueNote 同时承载人工备注，像 "2026-10-28 更新" 或
 * "GPT-5.5 数据" 这类文本里的数字并不是版本号，不能据此切断版本。
 */
export function extractAaVersionFromNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const match = note.trim().match(/\bv(\d+(?:\.\d+)*)\b/i);
  return match ? `v${match[1]}` : null;
}

/** 把 "v4.1" / "4.1" 解析成 [4, 1]；不做模糊匹配，避免把日期、模型名当成版本 */
export function parseAaVersionParts(version: string | null | undefined): number[] | null {
  if (!version) return null;
  const match = version.trim().match(/^v?(\d+(?:\.\d+)*)$/i);
  if (!match) return null;
  const parts = match[1]!.split(".").map((part) => Number.parseInt(part, 10));
  return parts.every((part) => Number.isFinite(part)) ? parts : null;
}

/** 归一化成 "v5" 形式；无法识别返回 null */
export function normalizeAaVersion(version: string | null | undefined): string | null {
  const parts = parseAaVersionParts(version);
  return parts ? `v${parts.join(".")}` : null;
}

/** left 比 right 新返回正数，旧返回负数，相同返回 0；任一方无法识别时返回 null */
export function compareAaVersions(
  left: string | null | undefined,
  right: string | null | undefined
): number | null {
  const leftParts = parseAaVersionParts(left);
  const rightParts = parseAaVersionParts(right);
  if (!leftParts || !rightParts) return null;

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}
