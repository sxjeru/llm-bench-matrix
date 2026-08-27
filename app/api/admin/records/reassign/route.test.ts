import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/admin/records/reassign/route";
import { requireAdmin } from "@/lib/admin-auth";
import {
  reassignRecordBenchmark,
  reassignRecordModel,
  reassignRecordSource
} from "@/lib/admin-records-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-records-service", () => ({
  reassignRecordBenchmark: vi.fn(),
  reassignRecordModel: vi.fn(),
  reassignRecordSource: vi.fn()
}));

function jsonRequest(body: unknown) {
  return new Request("https://example.com/api/admin/records/reassign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/admin/records/reassign", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(reassignRecordBenchmark).mockReset();
    vi.mocked(reassignRecordModel).mockReset();
    vi.mocked(reassignRecordSource).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(reassignRecordBenchmark).mockResolvedValue({ moved: 1, skipped: 0, deleted: 0 });
    vi.mocked(reassignRecordModel).mockResolvedValue({ moved: 2, skipped: 0, deleted: 0 });
    vi.mocked(reassignRecordSource).mockResolvedValue({ moved: 4 });
  });

  test("未授权时不变更归属", async () => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireAdmin).mockResolvedValue(denied);

    const response = await POST(
      jsonRequest({
        entityType: "benchmark",
        fromBenchmarkId: 11,
        target: { benchmarkId: 12 }
      })
    );

    expect(response.status).toBe(401);
    expect(reassignRecordBenchmark).not.toHaveBeenCalled();
  });

  test("缺少 target 返回 400", async () => {
    const response = await POST(
      jsonRequest({
        entityType: "benchmark",
        fromBenchmarkId: 11,
        target: {}
      })
    );

    expect(response.status).toBe(400);
    expect(reassignRecordBenchmark).not.toHaveBeenCalled();
    expect(reassignRecordModel).not.toHaveBeenCalled();
    expect(reassignRecordSource).not.toHaveBeenCalled();
  });

  test("按 entityType 分发到 benchmark / model / source", async () => {
    const benchmark = await POST(
      jsonRequest({
        entityType: "benchmark",
        fromBenchmarkId: 11,
        target: { benchmarkId: 12 },
        conflictStrategy: "overwrite",
        scope: { modelIds: [1] }
      })
    );
    expect(benchmark.status).toBe(200);
    expect(reassignRecordBenchmark).toHaveBeenCalledWith({
      fromBenchmarkId: 11,
      target: { benchmarkId: 12 },
      scope: { modelIds: [1] },
      conflictStrategy: "overwrite"
    });

    const model = await POST(
      jsonRequest({
        entityType: "model",
        fromModelId: 1,
        target: { modelName: "Model B", providerName: "OpenAI" }
      })
    );
    expect(model.status).toBe(200);
    expect(reassignRecordModel).toHaveBeenCalledWith({
      fromModelId: 1,
      target: { modelName: "Model B", providerName: "OpenAI" },
      scope: undefined,
      conflictStrategy: undefined
    });

    const source = await POST(
      jsonRequest({
        entityType: "source",
        fromSource: "text:old",
        toSource: "text:new",
        scope: { sourceMode: "specific", source: "text:old" }
      })
    );
    expect(source.status).toBe(200);
    expect(reassignRecordSource).toHaveBeenCalledWith({
      fromSource: "text:old",
      toSource: "text:new",
      scope: { sourceMode: "specific", source: "text:old" }
    });
  });

  test("目标 source 相同映射 400", async () => {
    vi.mocked(reassignRecordSource).mockRejectedValue(
      new Error("目标 source 与当前 source 相同，无需变更归属")
    );

    const response = await POST(
      jsonRequest({
        entityType: "source",
        fromSource: "text:src",
        toSource: "text:src"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "目标 source 与当前 source 相同，无需变更归属"
    });
  });
});
