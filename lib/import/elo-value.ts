import { parseImportPairValue } from "@/lib/import/pair-value";
import { hasMagnitudeSuffix } from "@/lib/import/scaled-amount";

export type EloCandidateValueInput = {
  rawValue: string;
  valueNum: number | null;
  valueNum2: number | null;
};

export type ValueMagnitudeFlags = {
  firstHasMagnitude: boolean;
  secondHasMagnitude: boolean;
};

export type EloCandidateSlotFlags = {
  firstIsElo: boolean;
  secondIsElo: boolean;
};

function isOverHundredValue(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value > 100;
}

/**
 * 按段判断单值或双值 raw 文本是否带 k/K/M/B/T 量级后缀。
 * 双值单元格左右段独立判断；单值单元格作用于主数值段（若仅 valueNum2 非空也复用同一段判断）。
 */
export function resolveValueMagnitudeFlags(rawValue: string | null | undefined): ValueMagnitudeFlags {
  const normalizedRaw = rawValue?.trim() ?? "";
  if (!normalizedRaw) {
    return {
      firstHasMagnitude: false,
      secondHasMagnitude: false
    };
  }

  const pair = parseImportPairValue(normalizedRaw);
  if (pair) {
    return {
      firstHasMagnitude: hasMagnitudeSuffix(pair.first),
      secondHasMagnitude: hasMagnitudeSuffix(pair.second)
    };
  }

  const singleHasMagnitude = hasMagnitudeSuffix(normalizedRaw);
  return {
    firstHasMagnitude: singleHasMagnitude,
    secondHasMagnitude: singleHasMagnitude
  };
}

/**
 * 按段判定单元格中 `valueNum` / `valueNum2` 是否属于可触发 Elo 启发式的 >100 数值。
 *
 * 带 k/K/M/B/T 量级后缀的片段（如 `$1.2M`、`128K`、`1.5B`）换算后会 >100，
 * 但它们代表金额/上下文长度/参数量等量级值而非 Elo 分数，按段排除；
 * 双值单元格两侧独立判断（如 `$1.2M / 1215` 仅右侧 `1215` 命中）。
 */
export function resolveEloCandidateSlots(input: EloCandidateValueInput): EloCandidateSlotFlags {
  const firstOverHundred = isOverHundredValue(input.valueNum);
  const secondOverHundred = isOverHundredValue(input.valueNum2);
  if (!firstOverHundred && !secondOverHundred) {
    return {
      firstIsElo: false,
      secondIsElo: false
    };
  }

  const { firstHasMagnitude, secondHasMagnitude } = resolveValueMagnitudeFlags(input.rawValue);
  return {
    firstIsElo: firstOverHundred && !firstHasMagnitude,
    secondIsElo: secondOverHundred && !secondHasMagnitude
  };
}

/**
 * 判断导入单元格是否包含可触发 Elo 启发式的 >100 数值。
 */
export function hasEloCandidateValue(input: EloCandidateValueInput): boolean {
  const { firstIsElo, secondIsElo } = resolveEloCandidateSlots(input);
  return firstIsElo || secondIsElo;
}
