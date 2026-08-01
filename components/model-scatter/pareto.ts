/**
 * 帕累托前沿。
 *
 * 「前沿」= 非受支配集合：不存在另一个模型在两个指标上都不差、且至少一个更好。
 * 两根轴的方向各自独立（价格越小越好、分数越大越好），所以先把坐标映射到
 * 「两轴都取最大」的空间，之后所有比较都只需处理一种方向。
 */

export type ParetoInput = {
  key: string;
  x: number;
  y: number;
};

type MaximizedPoint = {
  key: string;
  mx: number;
  my: number;
};

function toMaximizedPoints(
  points: readonly ParetoInput[],
  xHigherIsBetter: boolean,
  yHigherIsBetter: boolean
): MaximizedPoint[] {
  const maximized: MaximizedPoint[] = [];

  points.forEach((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    maximized.push({
      key: point.key,
      mx: xHigherIsBetter ? point.x : -point.x,
      my: yHigherIsBetter ? point.y : -point.y
    });
  });

  return maximized;
}

/**
 * 扫描线求非受支配集合，O(n log n)。
 *
 * 按 mx 降序、my 降序排序后，任何点的「潜在支配者」都排在它前面。
 * 于是只要跟踪目前见过的最大 my 即可判定：
 * - my 更大 → 没人能支配它，入选；
 * - my 相等且 mx 也相等 → 与已入选点完全重合，同为最优，一起保留；
 * - 其余 → 被前面某点支配，淘汰。
 */
export function computeParetoFrontier(
  points: readonly ParetoInput[],
  xHigherIsBetter: boolean,
  yHigherIsBetter: boolean
): Set<string> {
  const frontier = new Set<string>();
  const maximized = toMaximizedPoints(points, xHigherIsBetter, yHigherIsBetter);
  if (maximized.length === 0) return frontier;

  maximized.sort((left, right) => {
    if (right.mx !== left.mx) return right.mx - left.mx;
    return right.my - left.my;
  });

  let bestMy = Number.NEGATIVE_INFINITY;
  let bestMyX = Number.NaN;

  maximized.forEach((point) => {
    if (point.my > bestMy) {
      frontier.add(point.key);
      bestMy = point.my;
      bestMyX = point.mx;
      return;
    }

    if (point.my === bestMy && point.mx === bestMyX) {
      frontier.add(point.key);
    }
  });

  return frontier;
}

/**
 * 把前沿点排成一条可连线的路径。
 *
 * 顺序取「mx 升序」——也就是支配序：沿着这个方向 x 越来越好、y 越来越差。
 * 折线本身与方向无关，但阶梯线需要这个顺序才能算对拐点。
 */
export function orderParetoPath<T extends { x: number; y: number }>(
  points: readonly T[],
  xHigherIsBetter: boolean,
  yHigherIsBetter: boolean
): T[] {
  const signX = xHigherIsBetter ? 1 : -1;
  const signY = yHigherIsBetter ? 1 : -1;

  return [...points].sort((left, right) => {
    const leftMx = left.x * signX;
    const rightMx = right.x * signX;
    if (leftMx !== rightMx) return leftMx - rightMx;
    return right.y * signY - left.y * signY;
  });
}

/**
 * 阶梯线顶点。
 *
 * 在支配序里，相邻两点 p → q 之间，被支配区域的边界拐点落在 `(p.x, q.y)`：
 * 这一段 x 区间上，只有 q 能构成压制，所以边界由 q 的 y 决定。
 */
export function buildParetoStepPoints<T extends { x: number; y: number }>(
  orderedPath: readonly T[]
): Array<{ x: number; y: number }> {
  if (orderedPath.length === 0) return [];

  const stepPoints: Array<{ x: number; y: number }> = [{ x: orderedPath[0].x, y: orderedPath[0].y }];

  for (let index = 1; index < orderedPath.length; index += 1) {
    const previous = orderedPath[index - 1];
    const current = orderedPath[index];
    stepPoints.push({ x: previous.x, y: current.y });
    stepPoints.push({ x: current.x, y: current.y });
  }

  return stepPoints;
}
