import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DashboardProvider } from "@/components/dashboard-provider";
import { HomeBenchmarkMatrix } from "@/components/home-benchmark-matrix";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";
import {
  encodePublicDashboardSnapshot,
  type PublicDashboardSnapshot
} from "@/lib/dashboard-snapshot-cache";

const matrixProps = vi.fn();

vi.mock("@/components/benchmark-matrix", () => ({
  BenchmarkMatrix: (props: unknown) => {
    matrixProps(props);
    return <div data-testid="benchmark-matrix" />;
  }
}));

const ROWS: MatrixInputRow[] = [
  {
    recordId: 1,
    providerName: "openai",
    modelName: "GPT-5",
    benchmarkName: "MMLU",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "88.1",
    valueNum: 88.1,
    modalities: ["Text"]
  },
  {
    recordId: 2,
    providerName: "anthropic",
    modelName: "Claude",
    benchmarkName: "MMLU",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "N/A",
    // null 表示「无可比数值」，必须穿过编解码后依然是 null
    valueNum: null,
    higherIsBetter: false
  }
];

const SNAPSHOT: PublicDashboardSnapshot = {
  versions: {
    dashboard: "dashboard-version",
    pricing: "pricing-version",
    settings: "settings-version"
  },
  rows: ROWS,
  sourceOptions: ["text:only"],
  stats: {
    providerCount: 1,
    modelCount: 2,
    benchmarkCount: 3,
    totalRecords: 4
  },
  modelPrices: [],
  modelParams: [],
  exportFootnoteAlign: "center"
};

describe("DashboardProvider", () => {
  afterEach(() => {
    matrixProps.mockReset();
    vi.unstubAllGlobals();
  });

  test("先显示加载态，再把解码后的行式快照交给矩阵", async () => {
    const fetchMock = vi.fn(async () => Response.json(encodePublicDashboardSnapshot(SNAPSHOT)));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DashboardProvider>
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在加载矩阵数据");

    await waitFor(() => {
      expect(screen.getByTestId("benchmark-matrix")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/public/dashboard", {
      signal: expect.any(AbortSignal)
    });
    expect(matrixProps).toHaveBeenLastCalledWith(expect.objectContaining({
      rows: ROWS,
      sourceOptions: ["text:only"],
      modelPrices: [],
      modelParams: [],
      exportFootnoteAlign: "center"
    }));
  });

  test("不再手动带 If-None-Match，交给浏览器按 ETag 复检", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("If-None-Match")).toBeNull();
      return Response.json(encodePublicDashboardSnapshot(SNAPSHOT));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DashboardProvider>
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("benchmark-matrix")).toBeInTheDocument();
    });
  });

  test("响应非 2xx 时展示带状态码的错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));

    render(
      <DashboardProvider>
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Failed to load dashboard snapshot: 500"
      );
    });
    expect(screen.queryByTestId("benchmark-matrix")).not.toBeInTheDocument();
  });

  test("请求抛错时展示错误信息而非停在加载态", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    render(
      <DashboardProvider>
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("network down");
    });
  });

  test("卸载时中断在途请求", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {
        // 永不结算，模拟卸载时仍在途的请求
      });
    }));

    const { unmount } = render(
      <DashboardProvider>
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
