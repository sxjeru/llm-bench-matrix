import { describe, expect, test } from "vitest";

import { SOURCE_NEW_WINDOW_MS } from "@/components/benchmark-matrix/constants";
import { buildSourceNewStateByKey } from "@/components/benchmark-matrix/selectors";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";

function createRow(source: string, timeStr: string): MatrixInputRow {
  return {
    providerName: "Provider",
    modelName: `Model ${source}`,
    benchmarkName: "Bench",
    benchmarkType: "General",
    benchTime: timeStr,
    valueRaw: "80",
    valueNum: 80,
    source
  };
}

describe("buildSourceNewStateByKey", () => {
  test("客户端未就绪时不标记 new", () => {
    const state = buildSourceNewStateByKey(
      [
        createRow("text:Alpha", "2026-05-09T10:00:00.000Z"),
        createRow("text:Beta", "2026-05-08T10:00:00.000Z")
      ],
      null
    );

    expect(state.get("text:Alpha")).toEqual({ updatedAtMs: Date.parse("2026-05-09T10:00:00.000Z"), isNew: false });
    expect(state.get("text:Beta")).toEqual({ updatedAtMs: Date.parse("2026-05-08T10:00:00.000Z"), isNew: false });
  });

  test("始终标记最后两个更新的 source，即使超出近期窗口", () => {
    const referenceTime = Date.parse("2026-06-10T12:00:00.000Z");
    const state = buildSourceNewStateByKey(
      [
        createRow("text:Alpha", "2026-05-09T10:00:00.000Z"),
        createRow("text:Beta", "2026-04-02T00:00:00.000Z"),
        createRow("text:Gamma", "2026-05-03T00:00:00.000Z")
      ],
      referenceTime
    );

    expect(state.get("text:Alpha")?.isNew).toBe(true);
    expect(state.get("text:Gamma")?.isNew).toBe(true);
    expect(state.get("text:Beta")?.isNew).toBe(false);
  });

  test("近期窗口内的 source 即使不是最后两个也会标记 new", () => {
    const latest = "2026-05-10T10:00:00.000Z";
    const second = "2026-05-09T10:00:00.000Z";
    const recentThird = "2026-05-08T12:00:00.000Z";
    const referenceTime = Date.parse("2026-05-10T12:00:00.000Z");

    expect(referenceTime - Date.parse(recentThird)).toBeLessThanOrEqual(SOURCE_NEW_WINDOW_MS);

    const state = buildSourceNewStateByKey(
      [
        createRow("text:Alpha", latest),
        createRow("text:Beta", second),
        createRow("text:Gamma", recentThird)
      ],
      referenceTime
    );

    expect(state.get("text:Alpha")?.isNew).toBe(true);
    expect(state.get("text:Beta")?.isNew).toBe(true);
    expect(state.get("text:Gamma")?.isNew).toBe(true);
  });
});
