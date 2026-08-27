import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { AdminConsole } from "@/components/admin-console";
import { renderReady } from "@/tests/flush-microtasks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

type AdminConsoleProps = Parameters<typeof AdminConsole>[0];

function createJsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload
  } as Response;
}

function mockFetchSequence(...payloads: unknown[]) {
  const queuedPayloads = [...payloads];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    if (url.startsWith("/api/admin/benchmarks/value-overlap")) {
      return createJsonResponse({ conflictCount: 0, overlapCount: 0 });
    }
    return createJsonResponse(queuedPayloads.shift() ?? {});
  });

  const globalFetchWrapper = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url === "/api/admin/benchmarks/preview-value-overlap") {
      return createJsonResponse({ stats: [] });
    }

    return fetchMock(url, init);
  };

  vi.stubGlobal("fetch", globalFetchWrapper);
  return fetchMock;
}

function buildProps(): AdminConsoleProps {
  return {
    providers: [{ id: 1, name: "OpenAI", slug: "openai" }],
    models: [{ id: 1, providerId: 1, modelName: "Model A", canonicalKey: "model-a" }],
    benchmarks: [{ id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] }],
    sourceOptions: ["text:sample"],
    mergedRecords: [],
    initialSettings: {}
  };
}

const matrixAxis = {
  models: [
    {
      modelId: 1,
      modelName: "Model A",
      providerId: 1,
      providerName: "OpenAI",
      providerDisplayName: "OpenAI",
      recordCount: 1
    }
  ],
  benchmarks: [
    {
      benchmarkId: 11,
      benchmarkName: "Bench-1",
      benchmarkType: "Type-A",
      unit: "%",
      higherIsBetter: true,
      modalities: ["Text"],
      recordCount: 1
    }
  ]
};

const emptyMatrix = {
  generatedAt: "2026-04-01T00:00:00.000Z",
  ...matrixAxis,
  models: [{ ...matrixAxis.models[0], recordCount: 0 }],
  benchmarks: [{ ...matrixAxis.benchmarks[0], recordCount: 0 }],
  cells: [],
  totalRecordCount: 0,
  visibleRecordCount: 0,
  modelTotalCount: 1,
  benchmarkTotalCount: 1,
  truncated: { models: false, benchmarks: false },
  limits: { modelLimit: 40, benchmarkLimit: 30 }
};

const filledMatrix = {
  generatedAt: "2026-04-01T00:00:00.000Z",
  ...matrixAxis,
  cells: [
    {
      modelId: 1,
      benchmarkId: 11,
      recordId: 101,
      recordIds: [101],
      recordCount: 1,
      valueRaw: "77",
      valueNum: 77,
      valueNum2: null,
      valueNote: null,
      source: "text:src",
      benchTime: "2026-04-01T00:00:00.000Z"
    }
  ],
  totalRecordCount: 1,
  visibleRecordCount: 1,
  modelTotalCount: 1,
  benchmarkTotalCount: 1,
  truncated: { models: false, benchmarks: false },
  limits: { modelLimit: 40, benchmarkLimit: 30 }
};

const saveResult = {
  ok: true,
  inserted: 0,
  updated: 1,
  deleted: 0,
  unchanged: 0,
  ignoredEmpty: 0,
  nonNumeric: [],
  prunedSourceMeta: 0
};

function recordsCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/admin/records"));
}

async function openRecordsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "数据管理" }));
}

async function enterCellEdit(cell: HTMLElement) {
  fireEvent.mouseDown(cell);
  fireEvent.mouseUp(document);
  return screen.findByLabelText("单元格数值");
}

function commitCellEditor(editor: HTMLElement, value: string) {
  fireEvent.change(editor, { target: { value } });
  fireEvent.keyDown(editor, { key: "Enter" });
}

describe("AdminConsole records tab", () => {
  test("切换到数据管理会加载矩阵", async () => {
    const fetchMock = mockFetchSequence(emptyMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);

    await openRecordsTab(user);

    await waitFor(() => {
      expect(recordsCalls(fetchMock).length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("heading", { name: "数据管理" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "数据管理" })).toHaveAttribute("aria-selected", "true");
  });

  test("编辑已有单元格后保存会提交草稿 payload", async () => {
    const fetchMock = mockFetchSequence(filledMatrix, saveResult, filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTab(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    expect(cell).toHaveTextContent("77");

    const editor = await enterCellEdit(cell);
    commitCellEditor(editor, "88");

    expect(await screen.findByRole("button", { name: "保存更改（已修改 1 项）" })).toBeEnabled();
    expect(cell).toHaveAttribute("data-dirty", "true");

    await user.click(screen.getByRole("button", { name: "保存更改（已修改 1 项）" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/admin/records" && init?.method === "POST"
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
        drafts: [
          {
            modelId: 1,
            benchmarkId: 11,
            recordId: 101,
            recordIds: [101],
            valueRaw: "88",
            originalValueRaw: "77",
            source: "text:src",
            isDeleted: false
          }
        ]
      });
    });

    await waitFor(() => {
      expect(screen.getByText("保存完成：修改 1")).toBeInTheDocument();
    });
  });

  test("全部 source 视图不能新增空单元格，选定具体 source 后可以", async () => {
    const fetchMock = mockFetchSequence(emptyMatrix, emptyMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTab(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    expect(screen.getByText(/当前是「全部 source」视图/)).toBeInTheDocument();

    const editor = await enterCellEdit(cell);
    commitCellEditor(editor, "12");

    await waitFor(() => {
      expect(
        screen.getByText("新增单元格前请先在 source 筛选里选定具体数据源（或「无 source」）")
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "保存更改" })).toBeDisabled();

    await user.click(screen.getByLabelText("Source 筛选"));
    await user.click(screen.getByRole("button", { name: "text:sample" }));

    await waitFor(() => {
      expect(recordsCalls(fetchMock).length).toBeGreaterThan(1);
    });

    const filteredCell = await screen.findByTestId("record-cell-1-11");
    const filteredEditor = await enterCellEdit(filteredCell);
    commitCellEditor(filteredEditor, "12");

    expect(await screen.findByRole("button", { name: "保存更改（已修改 1 项）" })).toBeEnabled();
    expect(filteredCell).toHaveAttribute("data-dirty", "true");
  });

  test("清空选区会把已有格标成待删除", async () => {
    mockFetchSequence(filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTab(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(document);

    expect(cell).toHaveAttribute("data-selected", "true");
    await user.click(screen.getByRole("button", { name: "清空选区" }));

    expect(cell).toHaveAttribute("data-pending-delete", "true");
    expect(screen.getByText("待清空 1 格")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存更改（已修改 1 项）" })).toBeEnabled();
  });

  test("无筛选批量删除需要勾选确认后才提交 allowUnfiltered", async () => {
    const fetchMock = mockFetchSequence(filledMatrix, { deleted: 1, prunedSourceMeta: 0 }, filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTab(user);

    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByRole("button", { name: "全部删除" }));

    const confirmButton = screen.getByRole("button", { name: "确认删除 1 条" });
    expect(confirmButton).toBeDisabled();

    await user.click(
      screen.getByText("当前没有任何筛选条件，这会清空 benchmark_values 全表。我确认要这么做。")
    );
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith("/api/admin/records/batch-delete")
      );
      expect(deleteCall).toBeTruthy();
      expect(JSON.parse(String(deleteCall?.[1]?.body))).toEqual({
        scope: {
          sourceMode: "all",
          source: null,
          modelIds: [],
          benchmarkIds: []
        },
        allowUnfiltered: true
      });
    });
  });
});
