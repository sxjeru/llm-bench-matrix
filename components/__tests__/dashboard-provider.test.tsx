import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DashboardProvider } from "@/components/dashboard-provider";
import { HomeBenchmarkMatrix } from "@/components/home-benchmark-matrix";
import { HomeMetrics } from "@/components/home-metrics";
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

const STATS_URL = "/api/public/dashboard/stats";
const SNAPSHOT_URL = "/api/public/dashboard";

type RouteHandler = (init?: RequestInit) => Promise<Response>;

/**
 * 指标卡与矩阵各走一个端点，测试里必须按 URL 分派，
 * 否则轻量统计那一路会误命中完整快照的载荷，掩盖真实时序。
 */
function stubFetchByRoute(routes: { stats?: RouteHandler; snapshot?: RouteHandler } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === STATS_URL) {
      return routes.stats?.(init) ?? Response.json({ stats: SNAPSHOT.stats });
    }

    if (url === SNAPSHOT_URL) {
      return routes.snapshot?.(init) ?? Response.json(encodePublicDashboardSnapshot(SNAPSHOT));
    }

    throw new Error(`unexpected fetch: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function createDeferredResponse() {
  let settle!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

describe("DashboardProvider", () => {
  afterEach(() => {
    matrixProps.mockReset();
    vi.unstubAllGlobals();
  });

  test("先显示加载态，再把解码后的行式快照交给矩阵", async () => {
    const fetchMock = stubFetchByRoute();

    render(
      <DashboardProvider>
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在加载矩阵数据");

    await waitFor(() => {
      expect(screen.getByTestId("benchmark-matrix")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(SNAPSHOT_URL, {
      signal: expect.any(AbortSignal)
    });
    expect(fetchMock).toHaveBeenCalledWith(STATS_URL, {
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
    const assertNoIfNoneMatch: RouteHandler = async (init) => {
      expect(new Headers(init?.headers).get("If-None-Match")).toBeNull();
      return Response.json(encodePublicDashboardSnapshot(SNAPSHOT));
    };

    stubFetchByRoute({
      snapshot: assertNoIfNoneMatch,
      stats: async (init) => {
        expect(new Headers(init?.headers).get("If-None-Match")).toBeNull();
        return Response.json({ stats: SNAPSHOT.stats });
      }
    });

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
    stubFetchByRoute({ snapshot: async () => new Response(null, { status: 500 }) });

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
    stubFetchByRoute({
      snapshot: async () => {
        throw new Error("network down");
      }
    });

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
    const capturedSignals: Array<AbortSignal | undefined> = [];
    stubFetchByRoute({
      stats: async (init) => {
        capturedSignals.push(init?.signal ?? undefined);
        return new Promise<Response>(() => {
          // 永不结算，模拟卸载时仍在途的请求
        });
      },
      snapshot: async (init) => {
        capturedSignals.push(init?.signal ?? undefined);
        return new Promise<Response>(() => {
          // 永不结算，模拟卸载时仍在途的请求
        });
      }
    });

    const { unmount } = render(
      <DashboardProvider>
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    expect(capturedSignals).toHaveLength(2);
    expect(capturedSignals.every((signal) => signal?.aborted === false)).toBe(true);

    unmount();

    expect(capturedSignals.every((signal) => signal?.aborted === true)).toBe(true);
  });

  test("统计端点先到时指标卡立即出数值，矩阵仍留在加载态", async () => {
    const pendingSnapshot = createDeferredResponse();
    stubFetchByRoute({ snapshot: () => pendingSnapshot.promise });

    render(
      <DashboardProvider>
        <HomeMetrics />
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Providers").parentElement).toHaveTextContent("1");
    });
    expect(screen.getByText("Models").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Benchmarks").parentElement).toHaveTextContent("3");
    expect(screen.getByText("总记录").parentElement).toHaveTextContent("4");

    // 关键点：这一刻矩阵还没有任何数据，卡片却已经有值了
    expect(screen.getByRole("status")).toHaveTextContent("正在加载矩阵数据");
    expect(screen.queryByTestId("benchmark-matrix")).not.toBeInTheDocument();

    pendingSnapshot.settle(Response.json(encodePublicDashboardSnapshot(SNAPSHOT)));

    await waitFor(() => {
      expect(screen.getByTestId("benchmark-matrix")).toBeInTheDocument();
    });
    expect(screen.getByText("Providers").parentElement).toHaveTextContent("1");
  });

  test("统计端点失败不影响矩阵，指标卡由快照兜底", async () => {
    stubFetchByRoute({ stats: async () => new Response(null, { status: 500 }) });

    render(
      <DashboardProvider>
        <HomeMetrics />
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("benchmark-matrix")).toBeInTheDocument();
    });

    // 附属请求挂掉不得写进 error，矩阵与卡片都照常
    expect(screen.getByText("Providers").parentElement).toHaveTextContent("1");
    expect(screen.getByText("总记录").parentElement).toHaveTextContent("4");
  });

  test("快照抢先到达时，迟到的统计响应不覆盖快照里的权威值", async () => {
    const pendingStats = createDeferredResponse();
    stubFetchByRoute({ stats: () => pendingStats.promise });

    render(
      <DashboardProvider>
        <HomeMetrics />
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("benchmark-matrix")).toBeInTheDocument();
    });

    // 两次请求之间数据发生了变动，统计端点给出与快照不同的数字
    pendingStats.settle(Response.json({
      stats: { providerCount: 99, modelCount: 99, benchmarkCount: 99, totalRecords: 99 }
    }));

    await waitFor(() => {
      expect(screen.getByText("Providers").parentElement).toHaveTextContent("1");
    });
    expect(screen.getByText("总记录").parentElement).toHaveTextContent("4");
  });
});
