import { describe, expect, test } from "vitest";

import {
  buildAxisTicks,
  buildLinearTicks,
  buildLogTicks
} from "@/components/model-scatter/ticks";
import { computeAxisDomain } from "@/components/model-scatter/dataset";

function isMultipleOf(value: number, step: number): boolean {
  return Math.abs(value / step - Math.round(value / step)) < 1e-9;
}

describe("buildLinearTicks", () => {
  test("0–100 的分数轴给出整十刻度", () => {
    expect(buildLinearTicks([0, 100])).toEqual([0, 20, 40, 60, 80, 100]);
  });

  test("0–1 的比率轴自适应到 0.2 步长", () => {
    expect(buildLinearTicks([0, 1])).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  test("最大值离 100 尚远时最大刻度贴着数据，不硬撑到 100", () => {
    // 数据 20–62，带留白后约 [17.5, 64.5]
    const domain = computeAxisDomain([20, 45, 62], "linear");
    const ticks = buildLinearTicks(domain);

    expect(ticks.at(-1)).toBeLessThan(70);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(60);
  });

  test("刻度一律落在步长的整数倍上", () => {
    const ticks = buildLinearTicks([32.7, 91.4]);
    expect(ticks.length).toBeGreaterThan(2);

    const step = ticks[1]! - ticks[0]!;
    ticks.forEach((tick) => {
      expect(isMultipleOf(tick, step)).toBe(true);
    });
  });

  test("所有刻度都落在 domain 之内", () => {
    const domain: [number, number] = [17.5, 64.5];
    buildLinearTicks(domain).forEach((tick) => {
      expect(tick).toBeGreaterThanOrEqual(domain[0]);
      expect(tick).toBeLessThanOrEqual(domain[1]);
    });
  });

  test("刻度数量落在可读区间", () => {
    [
      [0, 100],
      [0, 1],
      [17.5, 64.5],
      [0, 3],
      [1200, 9800],
      [0.004, 0.031]
    ].forEach((domain) => {
      const count = buildLinearTicks(domain as [number, number]).length;
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(12);
    });
  });

  test("不产生浮点尾巴", () => {
    buildLinearTicks([0, 1]).forEach((tick) => {
      expect(String(tick).length).toBeLessThanOrEqual(4);
    });
  });

  test("退化 domain 返回空", () => {
    expect(buildLinearTicks([5, 5])).toEqual([]);
    expect(buildLinearTicks([10, 1])).toEqual([]);
    expect(buildLinearTicks([Number.NaN, 10])).toEqual([]);
  });
});

describe("buildLogTicks", () => {
  test("跨度小的价格轴会在量级之间细分", () => {
    // 0.1 ~ 20：只标量级的话整条轴上只有 0.1、1、10 三个刻度
    const ticks = buildLogTicks([0.1, 20]);

    expect(ticks.length).toBeGreaterThanOrEqual(5);
    expect(ticks).toContain(1);
    expect(ticks).toContain(10);
    // 必须出现量级之间的中间刻度
    expect(ticks.some((tick) => tick > 1 && tick < 10)).toBe(true);
    expect(ticks.some((tick) => tick > 0.1 && tick < 1)).toBe(true);
  });

  test("不足一个数量级时仍给得出足够刻度", () => {
    const ticks = buildLogTicks([1.2, 8.5]);

    expect(ticks.length).toBeGreaterThanOrEqual(4);
    ticks.forEach((tick) => {
      expect(tick).toBeGreaterThanOrEqual(1.2);
      expect(tick).toBeLessThanOrEqual(8.5);
    });
  });

  test("跨越多个数量级时退回稀疏的量级刻度", () => {
    const ticks = buildLogTicks([0.001, 10000]);

    expect(ticks.length).toBeLessThanOrEqual(11);
    expect(ticks).toContain(1);
    expect(ticks).toContain(100);
  });

  test("刻度升序且落在 domain 内", () => {
    const domain: [number, number] = [0.05, 45];
    const ticks = buildLogTicks(domain);

    ticks.forEach((tick, index) => {
      expect(tick).toBeGreaterThanOrEqual(domain[0]);
      expect(tick).toBeLessThanOrEqual(domain[1]);
      if (index > 0) expect(tick).toBeGreaterThan(ticks[index - 1]!);
    });
  });

  test("跨度极窄时回退到线性刻度而不是留下空轴", () => {
    const ticks = buildLogTicks([9.9, 10.1]);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  test("非正 domain 返回空", () => {
    expect(buildLogTicks([0, 10])).toEqual([]);
    expect(buildLogTicks([-5, 10])).toEqual([]);
  });

  test("不产生浮点尾巴", () => {
    buildLogTicks([0.1, 20]).forEach((tick) => {
      expect(Number.isFinite(tick)).toBe(true);
      expect(String(tick)).not.toMatch(/\d{8,}/);
    });
  });
});

describe("buildAxisTicks", () => {
  test("按刻度模式分派", () => {
    expect(buildAxisTicks([0, 100], "linear")).toEqual(buildLinearTicks([0, 100], 6));
    expect(buildAxisTicks([0.1, 20], "log")).toEqual(buildLogTicks([0.1, 20]));
  });

  test("targetCount 越大刻度越密", () => {
    const sparse = buildAxisTicks([0, 100], "linear", 4);
    const dense = buildAxisTicks([0, 100], "linear", 10);

    expect(dense.length).toBeGreaterThan(sparse.length);
  });

  test("缩放后的 domain 依旧给出整齐刻度", () => {
    // 模拟放大后的一段区间
    const ticks = buildAxisTicks([41.3, 58.7], "linear", 6);

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    const step = ticks[1]! - ticks[0]!;
    ticks.forEach((tick) => expect(isMultipleOf(tick, step)).toBe(true));
  });
});
