import { describe, expect, test } from "vitest";

import {
  estimateLabelWidth,
  getPlacedLabelBox,
  layoutScatterLabels
} from "@/components/model-scatter/label-layout";
import type {
  ScatterAxisBounds,
  ScatterLabelCandidate,
  ScatterLabelLayoutOptions
} from "@/components/model-scatter/types";

const BOUNDS: ScatterAxisBounds = { left: 0, top: 0, right: 600, bottom: 400 };

const OPTIONS: ScatterLabelLayoutOptions = {
  fontSize: 11,
  dotRadius: 5.5,
  gap: 3,
  mode: "auto"
};

function candidate(
  key: string,
  cx: number,
  cy: number,
  priority = 0,
  text = key
): ScatterLabelCandidate {
  return { key, text, cx, cy, priority };
}

function boxesOverlap(
  left: ReturnType<typeof getPlacedLabelBox>,
  right: ReturnType<typeof getPlacedLabelBox>
): boolean {
  return !(
    left.right <= right.left ||
    left.left >= right.right ||
    left.bottom <= right.top ||
    left.top >= right.bottom
  );
}

describe("estimateLabelWidth", () => {
  test("西文按平均字宽近似", () => {
    expect(estimateLabelWidth("AB", 11)).toBeCloseTo(2 * 0.58 * 11, 5);
  });

  test("CJK 按整宽计，明显宽于同字数西文", () => {
    expect(estimateLabelWidth("中文模型", 11)).toBeGreaterThan(estimateLabelWidth("abcd", 11));
    expect(estimateLabelWidth("中文", 11)).toBeCloseTo(2 * 11, 5);
  });

  test("空串宽度为 0", () => {
    expect(estimateLabelWidth("", 11)).toBe(0);
  });
});

describe("layoutScatterLabels", () => {
  test("mode 为 none 时不产出任何标签", () => {
    const placed = layoutScatterLabels([candidate("A", 100, 100)], BOUNDS, { ...OPTIONS, mode: "none" });
    expect(placed).toEqual([]);
  });

  test("空候选返回空", () => {
    expect(layoutScatterLabels([], BOUNDS, OPTIONS)).toEqual([]);
  });

  test("孤立点放在首选的右侧锚位", () => {
    const [placed] = layoutScatterLabels([candidate("A", 100, 100)], BOUNDS, OPTIONS);

    expect(placed.anchor).toBe("right");
    expect(placed.textAnchor).toBe("start");
    expect(placed.x).toBeGreaterThan(100);
    expect(placed.y).toBe(100);
  });

  test("互不干扰的点都用首选锚位", () => {
    const placed = layoutScatterLabels(
      [candidate("A", 60, 60), candidate("B", 300, 300)],
      BOUNDS,
      OPTIONS
    );

    expect(placed).toHaveLength(2);
    expect(placed.every((label) => label.anchor === "right")).toBe(true);
  });

  test("右侧冲突时换到备选锚位而非直接放弃", () => {
    const placed = layoutScatterLabels(
      [candidate("AB", 100, 100, 10), candidate("CD", 100, 103, 0)],
      BOUNDS,
      OPTIONS
    );

    expect(placed).toHaveLength(2);
    const first = placed.find((label) => label.key === "AB");
    const second = placed.find((label) => label.key === "CD");

    expect(first?.anchor).toBe("right");
    expect(second?.anchor).not.toBe("right");
  });

  test("高优先级先占首选锚位", () => {
    const placed = layoutScatterLabels(
      [candidate("low", 100, 100, 0), candidate("high", 100, 103, 99)],
      BOUNDS,
      OPTIONS
    );

    expect(placed.find((label) => label.key === "high")?.anchor).toBe("right");
    expect(placed.find((label) => label.key === "low")?.anchor).not.toBe("right");
  });

  test("auto 模式下所有锚位都放不下就跳过", () => {
    const tightBounds: ScatterAxisBounds = { left: 0, top: 0, right: 60, bottom: 30 };
    const crowded = [
      candidate("XXXXXXXX", 30, 15, 5),
      candidate("YYYYYYYY", 30, 15, 4),
      candidate("ZZZZZZZZ", 30, 15, 3)
    ];

    expect(layoutScatterLabels(crowded, tightBounds, OPTIONS)).toEqual([]);
  });

  test("all 模式强制放置，并把标签夹回绘图区内", () => {
    const tightBounds: ScatterAxisBounds = { left: 0, top: 0, right: 60, bottom: 30 };
    const crowded = [
      candidate("XXXXXXXX", 30, 15, 5),
      candidate("YYYYYYYY", 30, 15, 4)
    ];

    const placed = layoutScatterLabels(crowded, tightBounds, { ...OPTIONS, mode: "all" });

    expect(placed).toHaveLength(2);
    placed.forEach((label) => {
      const box = getPlacedLabelBox(label, OPTIONS.fontSize);
      expect(box.left).toBeGreaterThanOrEqual(tightBounds.left);
      expect(box.top).toBeGreaterThanOrEqual(tightBounds.top);
    });
  });

  test("靠近右边界的点改用左侧锚位以免出界", () => {
    const [placed] = layoutScatterLabels(
      [candidate("LongModelName", 595, 200)],
      BOUNDS,
      OPTIONS
    );

    expect(placed?.anchor).toBe("left");
    expect(getPlacedLabelBox(placed!, OPTIONS.fontSize).right).toBeLessThanOrEqual(BOUNDS.right);
  });

  test("auto 模式下已放置的标签两两不重叠", () => {
    const grid: ScatterLabelCandidate[] = [];
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        grid.push(candidate(`m${row}-${column}`, 40 + column * 26, 40 + row * 22, row * 8 + column));
      }
    }

    const placed = layoutScatterLabels(grid, BOUNDS, OPTIONS);
    expect(placed.length).toBeGreaterThan(0);

    const boxes = placed.map((label) => getPlacedLabelBox(label, OPTIONS.fontSize));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(boxesOverlap(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });

  test("标签不会压住任何散点", () => {
    const grid: ScatterLabelCandidate[] = [];
    for (let index = 0; index < 24; index += 1) {
      grid.push(candidate(`model-${index}`, 50 + (index % 6) * 40, 50 + Math.floor(index / 6) * 36, index));
    }

    const placed = layoutScatterLabels(grid, BOUNDS, OPTIONS);
    const placedByKey = new Map(placed.map((label) => [label.key, label]));

    grid.forEach((point) => {
      const dotBox = {
        left: point.cx - OPTIONS.dotRadius,
        right: point.cx + OPTIONS.dotRadius,
        top: point.cy - OPTIONS.dotRadius,
        bottom: point.cy + OPTIONS.dotRadius
      };

      placedByKey.forEach((label) => {
        expect(boxesOverlap(getPlacedLabelBox(label, OPTIONS.fontSize), dotBox)).toBe(false);
      });
    });
  });

  test("同一输入产出完全一致的布局", () => {
    const input = [
      candidate("alpha", 120, 130, 3),
      candidate("beta", 124, 133, 3),
      candidate("gamma", 400, 200, 1)
    ];

    expect(layoutScatterLabels(input, BOUNDS, OPTIONS)).toEqual(
      layoutScatterLabels(input, BOUNDS, OPTIONS)
    );
  });

  test("优先级相同时按 key 稳定排序，与输入顺序无关", () => {
    const forward = layoutScatterLabels(
      [candidate("aaa", 100, 100, 1), candidate("bbb", 100, 103, 1)],
      BOUNDS,
      OPTIONS
    );
    const reversed = layoutScatterLabels(
      [candidate("bbb", 100, 103, 1), candidate("aaa", 100, 100, 1)],
      BOUNDS,
      OPTIONS
    );

    expect(forward).toEqual(reversed);
  });
});
