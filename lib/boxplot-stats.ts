/**
 * 计算分位数
 */
export function quantile(sortedArray: number[], q: number): number {
  if (sortedArray.length === 0) return 0;
  if (sortedArray.length === 1) return sortedArray[0];

  const pos = (sortedArray.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;

  if (sortedArray[base + 1] !== undefined) {
    return sortedArray[base] + rest * (sortedArray[base + 1] - sortedArray[base]);
  }
  return sortedArray[base];
}

/**
 * 计算箱线图统计数据
 */
export interface BoxPlotStats {
  benchmark: string;
  benchmarkName?: string;
  modelName?: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
  count: number;
}

export function calculateBoxPlotStats(values: number[]): Omit<BoxPlotStats, 'benchmark'> {
  if (values.length === 0) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0, outliers: [], count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;

  // 计算须（whiskers）的范围：Q1 - 1.5*IQR 到 Q3 + 1.5*IQR
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  // 找到在围栏内的最小值和最大值
  const valuesInRange = sorted.filter(v => v >= lowerFence && v <= upperFence);
  const min = valuesInRange[0] ?? q1;
  const max = valuesInRange[valuesInRange.length - 1] ?? q3;

  // 异常值是在围栏外的点
  const outliers = sorted.filter(v => v < lowerFence || v > upperFence);

  return {
    min,
    q1,
    median,
    q3,
    max,
    outliers,
    count: values.length
  };
}
