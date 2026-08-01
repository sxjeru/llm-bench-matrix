import {
  SCATTER_LABEL_CHAR_WIDTH_RATIO,
  SCATTER_LABEL_CJK_WIDTH_RATIO
} from "./constants";
import type {
  ScatterAxisBounds,
  ScatterLabelAnchor,
  ScatterLabelBox,
  ScatterLabelCandidate,
  ScatterLabelLayoutOptions,
  ScatterPlacedLabel
} from "./types";

type Box = ScatterLabelBox;

type Placement = {
  anchor: ScatterLabelAnchor;
  x: number;
  y: number;
  textAnchor: "start" | "middle" | "end";
  box: Box;
};

/** 锚位尝试顺序：右侧最自然，其次左侧，再退到上下与斜角。 */
const ANCHOR_ORDER: readonly ScatterLabelAnchor[] = [
  "right",
  "left",
  "top",
  "bottom",
  "top-right",
  "bottom-right"
];

const CJK_PATTERN = /[⺀-鿿가-퟿豈-﫿︰-﹏＀-￯]/;

/**
 * 文本宽度估算。
 *
 * 刻意不量测 DOM：布局要在测试里可复现，也要能在 SVG 首帧就定下来，
 * 拿不到真实字体度量。西文按平均字宽近似，CJK 按整宽计。
 */
export function estimateLabelWidth(text: string, fontSize: number): number {
  let width = 0;

  for (const char of text) {
    width += CJK_PATTERN.test(char) ? SCATTER_LABEL_CJK_WIDTH_RATIO : SCATTER_LABEL_CHAR_WIDTH_RATIO;
  }

  return width * fontSize;
}

function boxFrom(
  x: number,
  y: number,
  textAnchor: "start" | "middle" | "end",
  width: number,
  height: number
): Box {
  const left = textAnchor === "start" ? x : textAnchor === "end" ? x - width : x - width / 2;

  return {
    left,
    right: left + width,
    top: y - height / 2,
    bottom: y + height / 2
  };
}

function buildPlacement(
  anchor: ScatterLabelAnchor,
  candidate: ScatterLabelCandidate,
  width: number,
  height: number,
  offset: number
): Placement {
  switch (anchor) {
    case "left": {
      const x = candidate.cx - offset;
      return { anchor, x, y: candidate.cy, textAnchor: "end", box: boxFrom(x, candidate.cy, "end", width, height) };
    }
    case "top": {
      const y = candidate.cy - offset - height / 2;
      return { anchor, x: candidate.cx, y, textAnchor: "middle", box: boxFrom(candidate.cx, y, "middle", width, height) };
    }
    case "bottom": {
      const y = candidate.cy + offset + height / 2;
      return { anchor, x: candidate.cx, y, textAnchor: "middle", box: boxFrom(candidate.cx, y, "middle", width, height) };
    }
    case "top-right": {
      const x = candidate.cx + offset;
      const y = candidate.cy - offset;
      return { anchor, x, y, textAnchor: "start", box: boxFrom(x, y, "start", width, height) };
    }
    case "bottom-right": {
      const x = candidate.cx + offset;
      const y = candidate.cy + offset;
      return { anchor, x, y, textAnchor: "start", box: boxFrom(x, y, "start", width, height) };
    }
    case "right":
    default: {
      const x = candidate.cx + offset;
      return { anchor: "right", x, y: candidate.cy, textAnchor: "start", box: boxFrom(x, candidate.cy, "start", width, height) };
    }
  }
}

function intersects(left: Box, right: Box): boolean {
  return !(
    left.right <= right.left ||
    left.left >= right.right ||
    left.bottom <= right.top ||
    left.top >= right.bottom
  );
}

function isInsideBounds(box: Box, bounds: ScatterAxisBounds): boolean {
  return (
    box.left >= bounds.left &&
    box.right <= bounds.right &&
    box.top >= bounds.top &&
    box.bottom <= bounds.bottom
  );
}

function clampIntoBounds(placement: Placement, bounds: ScatterAxisBounds): Placement {
  const width = placement.box.right - placement.box.left;
  const height = placement.box.bottom - placement.box.top;

  const maxLeft = Math.max(bounds.left, bounds.right - width);
  const clampedLeft = Math.min(Math.max(placement.box.left, bounds.left), maxLeft);
  const maxTop = Math.max(bounds.top, bounds.bottom - height);
  const clampedTop = Math.min(Math.max(placement.box.top, bounds.top), maxTop);

  const deltaX = clampedLeft - placement.box.left;
  const deltaY = clampedTop - placement.box.top;

  return {
    ...placement,
    x: placement.x + deltaX,
    y: placement.y + deltaY,
    box: {
      left: clampedLeft,
      right: clampedLeft + width,
      top: clampedTop,
      bottom: clampedTop + height
    }
  };
}

/**
 * 贪心放置模型名标签。
 *
 * 高优先级先占位（前沿点 > 分数高者），每个标签依次试 6 个锚位，
 * 与已放置标签、以及所有散点本身做 AABB 碰撞检测。
 * `auto` 模式放不下就跳过 —— 宁可少几个标签，也不要糊成一团；
 * 被跳过的点依然能靠悬浮看到完整信息。
 */
export function layoutScatterLabels(
  candidates: readonly ScatterLabelCandidate[],
  bounds: ScatterAxisBounds,
  options: ScatterLabelLayoutOptions
): ScatterPlacedLabel[] {
  if (options.mode === "none" || candidates.length === 0) return [];

  const height = options.fontSize;
  const offset = options.dotRadius + options.gap;

  // 所有散点都是障碍物：标签压住别人的点比压住别人的字更难读
  const obstacles: Box[] = candidates.map((candidate) => ({
    left: candidate.cx - options.dotRadius,
    right: candidate.cx + options.dotRadius,
    top: candidate.cy - options.dotRadius,
    bottom: candidate.cy + options.dotRadius
  }));

  const ordered = [...candidates].sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.key.localeCompare(right.key);
  });

  const placed: ScatterPlacedLabel[] = [];

  ordered.forEach((candidate) => {
    const width = estimateLabelWidth(candidate.text, options.fontSize);
    const placements = ANCHOR_ORDER.map((anchor) =>
      buildPlacement(anchor, candidate, width, height, offset)
    );

    const fits = placements.find(
      (placement) =>
        isInsideBounds(placement.box, bounds) &&
        !obstacles.some((obstacle) => intersects(placement.box, obstacle))
    );

    if (fits) {
      obstacles.push(fits.box);
      placed.push({
        key: candidate.key,
        text: candidate.text,
        x: fits.x,
        y: fits.y,
        textAnchor: fits.textAnchor,
        anchor: fits.anchor
      });
      return;
    }

    if (options.mode !== "all") return;

    // 强制模式：先退到「只要不出界」，再退到夹回边界内
    const inBounds = placements.find((placement) => isInsideBounds(placement.box, bounds));
    const forced = inBounds ?? clampIntoBounds(placements[0]!, bounds);

    obstacles.push(forced.box);
    placed.push({
      key: candidate.key,
      text: candidate.text,
      x: forced.x,
      y: forced.y,
      textAnchor: forced.textAnchor,
      anchor: forced.anchor
    });
  });

  return placed;
}

/** 已放置标签的占位矩形，供描边背景与测试断言复用同一套几何。 */
export function getPlacedLabelBox(
  label: Pick<ScatterPlacedLabel, "text" | "x" | "y" | "textAnchor">,
  fontSize: number
): ScatterLabelBox {
  return boxFrom(label.x, label.y, label.textAnchor, estimateLabelWidth(label.text, fontSize), fontSize);
}
