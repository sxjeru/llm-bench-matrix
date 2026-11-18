import { parseImportPairValue } from "@/lib/import/pair-value";
import { hasMagnitudeSuffix } from "@/lib/import/scaled-amount";

export type EloCandidateValueInput = {
  rawValue: string;
  valueNum: number | null;
  valueNum2: number | null;
};

function isOverHundredValue(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value > 100;
}

/**
 * 判断导入单元格是否包含可触发 Elo 启发式的 >100 数值。
 *
 * 带 k/K/M/B/T 量级后缀的片段（如 `$1.2M`、`128K`、`1.5B`）换算后会 >100，
 * 但它们代表金额/上下文长度/参数量等量级值而非 Elo 分数，按段排除；
 * 双值单元格两侧独立判断（如 `$1.2M / 1215` 仍会因右侧 `1215` 命中）。
 */
export function hasEloCandidateValue(input: EloCandidateValueInput): boolean {
  const firstOverHundred = isOverHundredValue(input.valueNum);
  const secondOverHundred = isOverHundredValue(input.valueNum2);
  if (!firstOverHundred && !secondOverHundred) {
    return false;
  }

  const normalizedRaw = input.rawValue.trim();
  const pair = parseImportPairValue(normalizedRaw);
  if (pair) {
    return (
      (firstOverHundred && !hasMagnitudeSuffix(pair.first))
      || (secondOverHundred && !hasMagnitudeSuffix(pair.second))
    );
  }

  return (firstOverHundred || secondOverHundred) && !hasMagnitudeSuffix(normalizedRaw);
}
