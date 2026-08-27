import { beforeAll, describe, expect, test } from "vitest";

import type { hasRecordMutationScope as HasRecordMutationScope } from "@/lib/admin-records-service";

let hasRecordMutationScope: typeof HasRecordMutationScope;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  const service = await import("@/lib/admin-records-service");
  hasRecordMutationScope = service.hasRecordMutationScope;
});

describe("hasRecordMutationScope", () => {
  test("没有模型 / 指标 / source 限定时视为无范围", () => {
    expect(hasRecordMutationScope({})).toBe(false);
    expect(hasRecordMutationScope({ sourceMode: "all", modelIds: [], benchmarkIds: [] })).toBe(false);
    expect(hasRecordMutationScope({ modelIds: [0, -1] })).toBe(false);
  });

  test("任一显式筛选即构成变更范围", () => {
    expect(hasRecordMutationScope({ modelIds: [1] })).toBe(true);
    expect(hasRecordMutationScope({ benchmarkIds: [11] })).toBe(true);
    expect(hasRecordMutationScope({ sourceMode: "empty" })).toBe(true);
    expect(hasRecordMutationScope({ sourceMode: "specific", source: "text:src" })).toBe(true);
  });
});
