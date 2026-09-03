import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AdminConsole } from "@/components/admin-console";
import { renderReady } from "@/tests/flush-microtasks";

const refreshMock = vi.fn();

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: refreshMock
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
    if (url.startsWith("/api/admin/records/source-entities")) {
      const next = queuedPayloads[0];
      if (next && typeof next === "object" && ("modelIds" in next || "benchmarkIds" in next)) {
        return createJsonResponse(queuedPayloads.shift() ?? {});
      }
      return createJsonResponse({ modelIds: [1], benchmarkIds: [11] });
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

const multiValueMatrix = {
  generatedAt: "2026-04-01T00:00:00.000Z",
  ...matrixAxis,
  cells: [
    {
      modelId: 1,
      benchmarkId: 11,
      recordId: 101,
      recordIds: [101, 102],
      recordCount: 2,
      valueRaw: "77",
      valueNum: 77,
      valueNum2: null,
      valueNote: "latest",
      source: "text:new",
      benchTime: "2026-04-01T00:00:00.000Z",
      records: [
        {
          id: 101,
          valueRaw: "77",
          valueNum: 77,
          valueNum2: null,
          valueNote: "latest",
          source: "text:new",
          benchTime: "2026-04-01T00:00:00.000Z"
        },
        {
          id: 102,
          valueRaw: "66",
          valueNum: 66,
          valueNum2: null,
          valueNote: null,
          source: null,
          benchTime: "2026-03-01T00:00:00.000Z"
        }
      ]
    }
  ],
  totalRecordCount: 2,
  visibleRecordCount: 2,
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
  await user.click(screen.getByRole("tab", { name: "矩阵编辑" }));
}

async function openRecordsTabAndFilter(user: ReturnType<typeof userEvent.setup>, sourceName = "全部 source") {
  await openRecordsTab(user);
  await user.click(screen.getByLabelText("Source 筛选"));
  await user.click(screen.getByRole("button", { name: sourceName }));
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
  test("切换到矩阵编辑不会自动加载，选择筛选规则后才会加载矩阵", async () => {
    const fetchMock = mockFetchSequence(emptyMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);

    await openRecordsTab(user);

    expect(recordsCalls(fetchMock).length).toBe(0);
    expect(screen.getByRole("heading", { name: "矩阵编辑" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "矩阵编辑" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("请先在上方选择筛选条件以加载数据矩阵")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Source 筛选"));
    await user.click(screen.getByRole("button", { name: "全部 source" }));

    await waitFor(() => {
      expect(recordsCalls(fetchMock).length).toBeGreaterThan(0);
    });
  });

  test("编辑已有单元格后保存会提交草稿 payload", async () => {
    const fetchMock = mockFetchSequence(filledMatrix, saveResult, filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

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

  test("单击多值单元格会打开详情弹窗并提交 details API", async () => {
    const fetchMock = mockFetchSequence(
      multiValueMatrix,
      { ok: true, updated: 1, deleted: 0, nonNumeric: [] },
      multiValueMatrix
    );
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    expect(cell).toHaveTextContent("2 条");

    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(document);

    expect(await screen.findByRole("dialog", { name: "编辑单元格内的 2 条记录" })).toBeInTheDocument();
    expect(screen.queryByLabelText("单元格数值")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("记录 101 原始值"));
    await user.type(screen.getByLabelText("记录 101 原始值"), "88");
    await user.click(screen.getByRole("button", { name: "保存全部记录" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/admin/records/details" && init?.method === "POST"
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
        records: [
          {
            id: 101,
            modelId: 1,
            benchmarkId: 11,
            valueRaw: "88",
            source: "text:new",
            benchTime: "2026-04-01T00:00:00.000Z",
            valueNote: "latest",
            isDeleted: false
          }
        ]
      });
    });

    await waitFor(() => {
      expect(screen.getByText("多值记录保存完成：修改 1")).toBeInTheDocument();
    });
  });

  test("全部 source 视图不能新增空单元格，选定具体 source 后可以", async () => {
    const fetchMock = mockFetchSequence(emptyMatrix, emptyMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user, "全部 source");

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
    await user.click(screen.getByRole("button", { name: "sample" }));

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
    await openRecordsTabAndFilter(user);

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
    await openRecordsTabAndFilter(user);

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

  test("批量填入选区并保存草稿", async () => {
    const fetchMock = mockFetchSequence(filledMatrix, saveResult, filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(document);

    const fillInput = screen.getByLabelText("批量填值");
    await user.type(fillInput, "95");

    const fillButton = screen.getByRole("button", { name: "填入选区（1 格）" });
    await user.click(fillButton);

    expect(cell).toHaveTextContent("95");
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
            valueRaw: "95",
            originalValueRaw: "77",
            source: "text:src",
            isDeleted: false
          }
        ]
      });
    });
  });

  test("批量归一化触发 API 并提示成功", async () => {
    const fetchMock = mockFetchSequence(
      filledMatrix,
      { ok: true, targetScale: 1, updated: 1, unchanged: 0 },
      filledMatrix
    );
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByRole("button", { name: "归一化为 1" }));

    await waitFor(() => {
      const normalizeCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith("/api/admin/records/batch-normalize")
      );
      expect(normalizeCall).toBeTruthy();
      expect(JSON.parse(String(normalizeCall?.[1]?.body))).toEqual({
        scope: {
          sourceMode: "all",
          source: null,
          modelIds: [],
          benchmarkIds: []
        },
        targetScale: 1
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/已归一化为 1 量纲/)).toBeInTheDocument();
    });
  });

  test("分拆双值向导扫描候选并提交分拆", async () => {
    const fetchMock = mockFetchSequence(
      filledMatrix,
      {
        generatedAt: "2026-04-01T00:00:00.000Z",
        candidates: [
          {
            benchmarkId: 11,
            benchmarkName: "Bench-1",
            benchmarkType: "Type-A",
            dualValueCount: 1,
            totalCount: 1,
            sampleValues: ["77 / 88"],
            valueDetails: [
              {
                recordId: 101,
                valueRaw: "77 / 88",
                valueNum: 77,
                valueNum2: 88,
                modelName: "Model A",
                source: "text:src",
                valueNote: "paired",
                benchTime: "2026-04-01T00:00:00.000Z"
              }
            ]
          }
        ]
      },
      {
        ok: true,
        sourceBenchmarkId: 11,
        sourceBenchmarkLabel: "Bench-1 (Type-A)",
        firstBenchmarkId: 11,
        firstBenchmarkLabel: "Bench-1 (Type-A)",
        secondBenchmarkId: 12,
        secondBenchmarkLabel: "Bench-1 (2) (Type-A)",
        splitCount: 1,
        createdCount: 1,
        skipped: 0
      },
      filledMatrix
    );
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByRole("button", { name: "分拆双值" }));

    expect(await screen.findByText("分拆双值")).toBeInTheDocument();
    expect(await screen.findByText("双值 1/1")).toBeInTheDocument();

    await user.hover(screen.getByTitle("悬浮查看全部双值信息"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("77 / 88");
    expect(tooltip).toHaveTextContent("Model A");
    expect(tooltip).toHaveTextContent("src");
    expect(tooltip).toHaveTextContent("paired");

    await user.click(screen.getByRole("button", { name: "执行分拆" }));

    await waitFor(() => {
      const splitCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/admin/records/split-pair-values" && init?.method === "POST"
      );
      expect(splitCall).toBeTruthy();
      expect(JSON.parse(String(splitCall?.[1]?.body))).toEqual({
        benchmarkId: 11,
        first: { benchmarkId: 11 },
        second: { benchmarkName: "Bench-1 (2)", benchmarkType: "Type-A" },
        scope: {
          sourceMode: "all",
          source: null,
          modelIds: [],
          benchmarkIds: []
        }
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/双值分拆完成/)).toBeInTheDocument();
    });
  });

  test("分拆双值可从下拉列表选择已有 benchmark", async () => {
    const fetchMock = mockFetchSequence(
      filledMatrix,
      {
        generatedAt: "2026-04-01T00:00:00.000Z",
        candidates: [
          {
            benchmarkId: 11,
            benchmarkName: "Bench-1",
            benchmarkType: "Type-A",
            dualValueCount: 1,
            totalCount: 1,
            sampleValues: ["77 / 88"],
            valueDetails: []
          }
        ]
      },
      {
        ok: true,
        sourceBenchmarkId: 11,
        sourceBenchmarkLabel: "Bench-1 (Type-A)",
        firstBenchmarkId: 11,
        firstBenchmarkLabel: "Bench-1 (Type-A)",
        secondBenchmarkId: 12,
        secondBenchmarkLabel: "Bench-2 (Type-A)",
        splitCount: 1,
        createdCount: 1,
        skipped: 0
      },
      filledMatrix
    );
    const user = userEvent.setup();
    const props = buildProps();
    props.benchmarks = [
      ...props.benchmarks,
      { id: 12, benchmarkName: "Bench-2", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTabAndFilter(user);
    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByRole("button", { name: "分拆双值" }));
    await screen.findByText("双值 1/1");

    await user.selectOptions(screen.getByLabelText("第二个值选择已有 benchmark"), "12");
    await user.click(screen.getByRole("button", { name: "执行分拆" }));

    await waitFor(() => {
      const splitCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/admin/records/split-pair-values" && init?.method === "POST"
      );
      expect(splitCall).toBeTruthy();
      expect(JSON.parse(String(splitCall?.[1]?.body))).toMatchObject({
        benchmarkId: 11,
        first: { benchmarkId: 11 },
        second: { benchmarkId: 12 }
      });
    });
  });

  test("分拆双值在两个目标相同时禁用提交按钮", async () => {
    mockFetchSequence(
      filledMatrix,
      {
        generatedAt: "2026-04-01T00:00:00.000Z",
        candidates: [
          {
            benchmarkId: 11,
            benchmarkName: "Bench-1",
            benchmarkType: "Type-A",
            dualValueCount: 1,
            totalCount: 1,
            sampleValues: ["77 / 88"],
            valueDetails: []
          }
        ]
      }
    );
    const user = userEvent.setup();
    const props = buildProps();
    props.benchmarks = [
      ...props.benchmarks,
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTabAndFilter(user);
    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByRole("button", { name: "分拆双值" }));
    await screen.findByText("双值 1/1");

    await user.selectOptions(screen.getByLabelText("第二个值选择已有 benchmark"), "11");
    expect(screen.getByRole("button", { name: "执行分拆" })).toBeDisabled();
  });

  test("列头点击打开归属变更弹窗并提交", async () => {
    const fetchMock = mockFetchSequence(
      filledMatrix,
      {
        ok: true,
        entityType: "benchmark",
        movedCount: 1,
        skippedCount: 0,
        deletedTargetCount: 0,
        conflictCount: 0,
        createdTarget: false,
        fromLabel: "Bench-1 (Type-A)",
        targetLabel: "Bench-2 (Type-A)"
      },
      filledMatrix
    );
    const user = userEvent.setup();

    const props = buildProps();
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] },
      { id: 12, benchmarkName: "Bench-2", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTabAndFilter(user);

    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByTitle("点击变更「Bench-1」这一行的归属"));

    expect(await screen.findByText("变更行归属：Bench-1")).toBeInTheDocument();

    await user.click(screen.getByLabelText("目标 benchmark"));
    await user.click(screen.getByRole("option", { name: "Bench-2 (Type-A)" }));

    await user.click(screen.getByRole("button", { name: "确认变更归属" }));

    await waitFor(() => {
      const reassignCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/admin/records/reassign" && init?.method === "POST"
      );
      expect(reassignCall).toBeTruthy();
      expect(JSON.parse(String(reassignCall?.[1]?.body))).toEqual({
        entityType: "benchmark",
        fromBenchmarkId: 11,
        conflictStrategy: "keep-both",
        target: { benchmarkId: 12 },
        scope: {
          sourceMode: "all",
          source: null,
          modelIds: [],
          benchmarkIds: []
        }
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/归属已变更：Bench-1 \(Type-A\) → Bench-2 \(Type-A\)/)).toBeInTheDocument();
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  test("行归属变更后自动刷新指标下拉框内容", async () => {
    const reassignedMatrix = {
      ...filledMatrix,
      benchmarks: [
        {
          benchmarkId: 12,
          benchmarkName: "Bench-2",
          benchmarkType: "Type-A",
          unit: "%",
          higherIsBetter: true,
          modalities: ["Text"],
          recordCount: 1
        }
      ],
      cells: [
        {
          ...filledMatrix.cells[0],
          benchmarkId: 12
        }
      ]
    };

    mockFetchSequence(
      filledMatrix,
      {
        ok: true,
        entityType: "benchmark",
        fromId: 11,
        targetId: 12,
        movedCount: 1,
        skippedCount: 0,
        deletedTargetCount: 0,
        conflictCount: 0,
        createdTarget: false,
        fromLabel: "Bench-1 (Type-A)",
        targetLabel: "Bench-2 (Type-A)"
      },
      reassignedMatrix
    );
    const user = userEvent.setup();

    const props = buildProps();
    // Initially, props only have Bench-1
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTabAndFilter(user);

    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByTitle("点击变更「Bench-1」这一行的归属"));

    expect(await screen.findByText("变更行归属：Bench-1")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "新建" }));
    await user.type(screen.getByLabelText("新 benchmark 名称"), "Bench-2");
    await user.click(screen.getByRole("button", { name: "确认变更归属" }));

    await waitFor(() => {
      expect(screen.getByText(/归属已变更：Bench-1 \(Type-A\) → Bench-2 \(Type-A\)/)).toBeInTheDocument();
    });

    // Verify that the benchmark filter dropdown now contains Bench-2 without a page reload
    await user.click(screen.getByLabelText("指标筛选"));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /Bench-2/ })).toBeInTheDocument();
    });
  });

  test("选取 source 后，模型和指标下拉框只展示该 source 包含的实体", async () => {
    const fetchMock = mockFetchSequence(filledMatrix);
    const user = userEvent.setup();

    const props = buildProps();
    props.models = [
      { id: 1, providerId: 1, modelName: "Model A", canonicalKey: "model-a" },
      { id: 2, providerId: 1, modelName: "Model B", canonicalKey: "model-b" }
    ];
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] },
      { id: 12, benchmarkName: "Bench-2", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTab(user);

    await user.click(screen.getByLabelText("模型筛选"));
    expect(screen.getByText("Model A")).toBeInTheDocument();
    expect(screen.getByText("Model B")).toBeInTheDocument();
    await user.click(screen.getByLabelText("模型筛选"));

    await user.click(screen.getByLabelText("Source 筛选"));
    await user.click(screen.getByRole("button", { name: "sample" }));

    await waitFor(() => {
      expect(recordsCalls(fetchMock).length).toBeGreaterThan(0);
    });

    await user.click(screen.getByLabelText("模型筛选"));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Model A" })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: "Model B" })).not.toBeInTheDocument();
    });
    await user.click(screen.getByLabelText("模型筛选"));

    await user.click(screen.getByLabelText("指标筛选"));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /Bench-1/ })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: /Bench-2/ })).not.toBeInTheDocument();
    });
  });

  test("切换 source 后会丢掉不在范围内的已选模型，并重新加载矩阵", async () => {
    const fetchMock = mockFetchSequence(filledMatrix, filledMatrix, filledMatrix);
    const user = userEvent.setup();

    const props = buildProps();
    props.models = [
      { id: 1, providerId: 1, modelName: "Model A", canonicalKey: "model-a" },
      { id: 2, providerId: 1, modelName: "Model B", canonicalKey: "model-b" }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTab(user);

    await user.click(screen.getByLabelText("模型筛选"));
    await user.click(screen.getByRole("checkbox", { name: "Model B" }));

    await waitFor(() => {
      expect(recordsCalls(fetchMock).some(([url]) => String(url).includes("modelIds=2"))).toBe(true);
    });

    await user.click(screen.getByLabelText("Source 筛选"));
    await user.click(screen.getByRole("button", { name: "sample" }));

    await waitFor(() => {
      const recordGets = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).startsWith("/api/admin/records?") && !init?.method
      );
      const lastUrl = String(recordGets.at(-1)?.[0] ?? "");
      expect(lastUrl).toContain("sourceMode=specific");
      expect(lastUrl).not.toContain("modelIds=2");
    });

    await user.click(screen.getByLabelText("模型筛选"));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Model A" })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: "Model B" })).not.toBeInTheDocument();
    });
  });

  test("在具体 source 下归属变更后，已选指标 ID 会平滑迁移为目标 ID 并用新条件加载矩阵", async () => {
    const reassignedMatrix = {
      ...filledMatrix,
      benchmarks: [
        {
          benchmarkId: 12,
          benchmarkName: "Bench-2",
          benchmarkType: "Type-A",
          unit: "%",
          higherIsBetter: true,
          modalities: ["Text"],
          recordCount: 1
        }
      ],
      cells: [
        {
          ...filledMatrix.cells[0],
          benchmarkId: 12
        }
      ]
    };

    const fetchMock = mockFetchSequence(
      // 1. Initial matrix load after selecting source
      filledMatrix,
      // 2. Matrix load after selecting benchmark 11
      filledMatrix,
      // 3. Reassign POST response
      {
        ok: true,
        entityType: "benchmark",
        fromId: 11,
        targetId: 12,
        movedCount: 1,
        skippedCount: 0,
        deletedTargetCount: 0,
        conflictCount: 0,
        createdTarget: false,
        fromLabel: "Bench-1 (Type-A)",
        targetLabel: "Bench-2 (Type-A)"
      },
      // 4. Source entities refresh after reassign (source now has benchmark 12)
      { modelIds: [1], benchmarkIds: [12] },
      // 5. Matrix reload with new benchmark 12
      reassignedMatrix
    );
    const user = userEvent.setup();

    const props = buildProps();
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] },
      { id: 12, benchmarkName: "Bench-2", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTab(user);

    // Select source sample
    await user.click(screen.getByLabelText("Source 筛选"));
    await user.click(screen.getByRole("button", { name: "sample" }));

    // Select benchmark 11
    await user.click(screen.getByLabelText("指标筛选"));
    await user.click(screen.getByRole("checkbox", { name: /Bench-1/ }));

    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByTitle("点击变更「Bench-1」这一行的归属"));

    expect(await screen.findByText("变更行归属：Bench-1")).toBeInTheDocument();

    await user.click(screen.getByLabelText("目标 benchmark"));
    await user.click(screen.getByRole("option", { name: "Bench-2 (Type-A)" }));
    await user.click(screen.getByRole("button", { name: "确认变更归属" }));

    await waitFor(() => {
      expect(screen.getByText(/归属已变更：Bench-1 \(Type-A\) → Bench-2 \(Type-A\)/)).toBeInTheDocument();
    });

    // Verify matrix was reloaded with benchmarkIds=12 (and not empty or 11)
    await waitFor(() => {
      const recordGets = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).startsWith("/api/admin/records?") && !init?.method
      );
      const lastUrl = String(recordGets.at(-1)?.[0] ?? "");
      expect(lastUrl).toContain("benchmarkIds=12");
      expect(lastUrl).not.toContain("benchmarkIds=11");
    });
  });

  test("在具体 source 下批量删除导致已选指标脱离范围时，自动裁剪筛选 ID 并以裁剪后条件刷新矩阵", async () => {
    const fetchMock = mockFetchSequence(
      // 1. Initial matrix load after selecting source
      filledMatrix,
      // 2. Matrix load after selecting benchmark 11
      filledMatrix,
      // 3. Batch delete POST response
      { ok: true, deleted: 1, prunedSourceMeta: 1 },
      // 4. Source entities refresh after delete (benchmark 11 is now pruned/empty)
      { modelIds: [1], benchmarkIds: [] },
      // 5. Matrix reload with aligned/pruned filters
      emptyMatrix
    );
    const user = userEvent.setup();

    const props = buildProps();
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTab(user);

    // Select source sample
    await user.click(screen.getByLabelText("Source 筛选"));
    await user.click(screen.getByRole("button", { name: "sample" }));

    // Select benchmark 11
    await user.click(screen.getByLabelText("指标筛选"));
    await user.click(screen.getByRole("checkbox", { name: /Bench-1/ }));

    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByRole("button", { name: "全部删除" }));

    expect(await screen.findByText("删除当前筛选范围内的全部数据")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /确认删除/ }));

    await waitFor(() => {
      expect(screen.getByText("已删除 1 条记录")).toBeInTheDocument();
    });

    // Verify matrix was reloaded with the pruned filter (without benchmarkIds=11)
    await waitFor(() => {
      const recordGets = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).startsWith("/api/admin/records?") && !init?.method
      );
      const lastUrl = String(recordGets.at(-1)?.[0] ?? "");
      expect(lastUrl).toContain("sourceMode=specific");
      expect(lastUrl).not.toContain("benchmarkIds=11");
    });
  });

  test("行归属弹窗左下角点击删除该行，若筛选中已勾选该行则自动从已选 benchmarkIds 移除并刷新矩阵", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockFetchSequence(
      // 1. Matrix load after picking benchmark 11 in filter
      filledMatrix,
      // 2. Delete row POST response
      { ok: true, deleted: 1, prunedSourceMeta: 0 },
      // 3. Matrix reload after deletion (with benchmarkIds=11 removed)
      emptyMatrix
    );
    const user = userEvent.setup();

    const props = buildProps();
    await renderReady(<AdminConsole {...props} />);
    await openRecordsTab(user);

    // Filter by benchmark 11
    await user.click(screen.getByLabelText("指标筛选"));
    await user.click(screen.getByRole("checkbox", { name: /Bench-1/ }));

    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByTitle("点击变更「Bench-1」这一行的归属"));

    expect(await screen.findByText("变更行归属：Bench-1")).toBeInTheDocument();
    const deleteRowBtn = screen.getByRole("button", { name: "删除该行" });
    expect(deleteRowBtn).toBeInTheDocument();

    await user.click(deleteRowBtn);

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/admin/records/batch-delete" && init?.method === "POST"
      );
      expect(deleteCall).toBeTruthy();
      expect(JSON.parse(String(deleteCall?.[1]?.body))).toEqual({
        scope: {
          sourceMode: "all",
          source: null,
          modelIds: [],
          benchmarkIds: [11]
        }
      });
    });

    await waitFor(() => {
      expect(screen.getByText("已删除行「Bench-1」的 1 条记录")).toBeInTheDocument();
    });

    // Verify matrix reloaded without benchmarkIds=11
    await waitFor(() => {
      const recordGets = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).startsWith("/api/admin/records?") && !init?.method
      );
      const lastUrl = String(recordGets.at(-1)?.[0] ?? "");
      expect(lastUrl).not.toContain("benchmarkIds=11");
    });

    // Verify filter combobox is reset to "全部指标"
    expect(screen.getByRole("button", { name: "指标筛选" })).toHaveTextContent("全部指标");
  });

  test("列归属弹窗左下角点击删除该列，若筛选中已勾选该列则自动从已选 modelIds 移除并刷新矩阵", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockFetchSequence(
      // 1. Matrix load after picking model 1 in filter
      filledMatrix,
      // 2. Delete col POST response
      { ok: true, deleted: 1, prunedSourceMeta: 0 },
      // 3. Matrix reload after deletion (with modelIds=1 removed)
      emptyMatrix
    );
    const user = userEvent.setup();

    const props = buildProps();
    await renderReady(<AdminConsole {...props} />);
    await openRecordsTab(user);

    // Filter by model 1
    await user.click(screen.getByLabelText("模型筛选"));
    await user.click(screen.getByRole("checkbox", { name: "Model A" }));

    await screen.findByTestId("record-cell-1-11");
    await user.click(screen.getByTitle("点击变更「Model A」这一列的归属"));

    expect(await screen.findByText("变更列归属：Model A")).toBeInTheDocument();
    const deleteColBtn = screen.getByRole("button", { name: "删除该列" });
    expect(deleteColBtn).toBeInTheDocument();

    await user.click(deleteColBtn);

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/admin/records/batch-delete" && init?.method === "POST"
      );
      expect(deleteCall).toBeTruthy();
      expect(JSON.parse(String(deleteCall?.[1]?.body))).toEqual({
        scope: {
          sourceMode: "all",
          source: null,
          modelIds: [1],
          benchmarkIds: []
        }
      });
    });

    await waitFor(() => {
      expect(screen.getByText("已删除列「Model A」的 1 条记录")).toBeInTheDocument();
    });

    // Verify matrix reloaded without modelIds=1
    await waitFor(() => {
      const recordGets = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).startsWith("/api/admin/records?") && !init?.method
      );
      const lastUrl = String(recordGets.at(-1)?.[0] ?? "");
      expect(lastUrl).not.toContain("modelIds=1");
    });

    // Verify filter combobox is reset to "全部模型"
    expect(screen.getByRole("button", { name: "模型筛选" })).toHaveTextContent("全部模型");
  });

  test("点击筛选下拉框（Source/模型/指标）后自动对焦到其中的搜索框", async () => {
    const user = userEvent.setup();
    const props = buildProps();
    await renderReady(<AdminConsole {...props} />);
    await openRecordsTab(user);

    // 1. 点击 Source 筛选下拉框
    const sourceBtn = screen.getByRole("button", { name: "Source 筛选" });
    await user.click(sourceBtn);
    const sourceInput = screen.getByRole("textbox", { name: "搜索 source" });
    expect(sourceInput).toBeInTheDocument();
    expect(sourceInput).toHaveFocus();

    // 关闭 Source 下拉框
    await user.click(sourceBtn);

    // 2. 点击 模型 筛选下拉框
    const modelBtn = screen.getByRole("button", { name: "模型筛选" });
    await user.click(modelBtn);
    const modelInput = screen.getByRole("textbox", { name: "搜索模型" });
    expect(modelInput).toBeInTheDocument();
    expect(modelInput).toHaveFocus();

    // 关闭 模型 下拉框
    await user.click(modelBtn);

    // 3. 点击 指标 筛选下拉框
    const benchmarkBtn = screen.getByRole("button", { name: "指标筛选" });
    await user.click(benchmarkBtn);
    const benchmarkInput = screen.getByRole("textbox", { name: "搜索指标" });
    expect(benchmarkInput).toBeInTheDocument();
    expect(benchmarkInput).toHaveFocus();
  });

  test("按住 Ctrl 点击单元格可选取该格子，不进入编辑模式", async () => {
    mockFetchSequence(filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    expect(cell).toHaveAttribute("data-selected", "false");

    fireEvent.mouseDown(cell, { ctrlKey: true });
    fireEvent.mouseUp(document, { ctrlKey: true });

    expect(screen.queryByLabelText("单元格数值")).toBeNull();
    expect(cell).toHaveAttribute("data-selected", "true");
    expect(screen.getByText("填入选区（1 格）")).toBeInTheDocument();
  });

  test("按住 Ctrl 点击多值单元格可直接选取，不打开多值编辑器弹窗", async () => {
    mockFetchSequence(multiValueMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    fireEvent.mouseDown(cell, { ctrlKey: true });
    fireEvent.mouseUp(document, { ctrlKey: true });

    expect(cell).toHaveAttribute("data-selected", "true");
    expect(screen.queryByText(/多值编辑/)).toBeNull();
  });

  test("按住 Ctrl 点击行头/列头可快速选取整行/整列", async () => {
    mockFetchSequence(filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    expect(cell).toHaveAttribute("data-selected", "false");

    const rowBtn = screen.getByTitle("点击变更「Bench-1」这一行的归属");
    fireEvent.click(rowBtn, { ctrlKey: true });

    expect(cell).toHaveAttribute("data-selected", "true");
    expect(screen.queryByText(/变更行归属/)).toBeNull();
  });

  test("按住 Ctrl 选区后支持 Ctrl+C / copy 复制表格选区数据", async () => {
    mockFetchSequence(filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    fireEvent.mouseDown(cell, { ctrlKey: true });
    fireEvent.mouseUp(document, { ctrlKey: true });
    expect(cell).toHaveAttribute("data-selected", "true");

    const setData = vi.fn();
    const clipboardData = {
      setData,
      getData: vi.fn()
    };
    fireEvent.copy(document, { clipboardData });

    expect(setData).toHaveBeenCalledWith("text/plain", "77");
    expect(setData).toHaveBeenCalledWith("text/html", "<table><tr><td>77</td></tr></table>");
  });

  test("按住 Ctrl 选取单元格后按 Backspace/Delete 可批量清空", async () => {
    mockFetchSequence(filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    fireEvent.mouseDown(cell, { ctrlKey: true });
    fireEvent.mouseUp(document, { ctrlKey: true });
    expect(cell).toHaveAttribute("data-selected", "true");

    fireEvent.keyDown(document, { key: "Delete" });

    expect(cell).toHaveAttribute("data-dirty", "true");
    expect(cell).toHaveAttribute("data-pending-delete", "true");
    expect(screen.getByText("待清空 1 格")).toBeInTheDocument();
  });

  test("当选取单行某几个单元格时，点行头可修改选取的几个值的 benchmark 归属", async () => {
    const fetchMock = mockFetchSequence(
      filledMatrix,
      {
        ok: true,
        entityType: "benchmark",
        movedCount: 1,
        skippedCount: 0,
        deletedTargetCount: 0,
        conflictCount: 0,
        createdTarget: false,
        fromLabel: "Bench-1 (Type-A)",
        targetLabel: "Bench-2 (Type-A)"
      },
      filledMatrix
    );

    const user = userEvent.setup();
    const props = buildProps();
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] },
      { id: 12, benchmarkName: "Bench-2", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    // 按住 Ctrl 选取单个格子（单行单列）
    fireEvent.mouseDown(cell, { ctrlKey: true });
    fireEvent.mouseUp(document, { ctrlKey: true });
    expect(cell).toHaveAttribute("data-selected", "true");

    // 行头应显示「已选 1 格」
    expect(screen.getByText("已选 1 格")).toBeInTheDocument();

    // 点击行头按钮
    await user.click(screen.getByTitle("点击变更「Bench-1」这一行的归属"));

    // 弹窗标题应体现针对所选模型的变更
    expect(await screen.findByText("变更选定数值的指标归属：Bench-1（已选 1 个模型）")).toBeInTheDocument();
    expect(screen.getByText("限定模型:")).toBeInTheDocument();

    await user.click(screen.getByLabelText("目标 benchmark"));
    await user.click(screen.getByRole("option", { name: "Bench-2 (Type-A)" }));

    await user.click(screen.getByRole("button", { name: "确认变更归属" }));

    await waitFor(() => {
      const reassignCall = fetchMock.mock.calls.find(
        ([callUrl, init]) => callUrl === "/api/admin/records/reassign" && init?.method === "POST"
      );
      expect(reassignCall).toBeTruthy();
      expect(JSON.parse(String(reassignCall?.[1]?.body))).toEqual({
        entityType: "benchmark",
        fromBenchmarkId: 11,
        conflictStrategy: "keep-both",
        modelIds: [1],
        target: { benchmarkId: 12 },
        scope: {
          sourceMode: "all",
          source: null,
          modelIds: [1],
          benchmarkIds: []
        }
      });
    });
  });

  test("弹窗打开时阻断矩阵键盘快捷键（Backspace/Delete、Ctrl+A、Ctrl+C），防止按键穿透", async () => {
    mockFetchSequence(filledMatrix);
    const user = userEvent.setup();

    await renderReady(<AdminConsole {...buildProps()} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    fireEvent.mouseDown(cell, { ctrlKey: true });
    fireEvent.mouseUp(document, { ctrlKey: true });
    expect(cell).toHaveAttribute("data-selected", "true");

    // 打开归属变更弹窗
    await user.click(screen.getByTitle("点击变更「Bench-1」这一行的归属"));
    expect(await screen.findByText("变更选定数值的指标归属：Bench-1（已选 1 个模型）")).toBeInTheDocument();

    // 焦点停留在弹窗内的非输入框元素（例如取消按钮）
    const cancelBtn = screen.getByRole("button", { name: "取消" });
    cancelBtn.focus();
    expect(cancelBtn).toHaveFocus();

    // 按下 Backspace / Delete
    fireEvent.keyDown(document, { key: "Backspace" });
    fireEvent.keyDown(document, { key: "Delete" });

    // 单元格不应被清空，不应变成待删除状态
    expect(cell).toHaveAttribute("data-dirty", "false");
    expect(cell).toHaveAttribute("data-pending-delete", "false");
    expect(screen.queryByText("待清空 1 格")).toBeNull();

    // 按下 Ctrl+A 不应触发全选
    fireEvent.keyDown(document, { key: "a", ctrlKey: true });

    // 触发复制事件，不应写入矩阵数据
    const setData = vi.fn();
    const clipboardData = { setData, getData: vi.fn() };
    fireEvent.copy(document, { clipboardData });
    expect(setData).not.toHaveBeenCalled();
  });

  test("行归属弹窗中确认删除该行后，矩阵选区 selection 立即被清理", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetchSequence(
      filledMatrix,
      { deleted: 1, prunedSourceMeta: 0 },
      filledMatrix
    );
    const user = userEvent.setup();

    const props = buildProps();
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] },
      { id: 12, benchmarkName: "Bench-2", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    await renderReady(<AdminConsole {...props} />);
    await openRecordsTabAndFilter(user);

    const cell = await screen.findByTestId("record-cell-1-11");
    fireEvent.mouseDown(cell, { ctrlKey: true });
    fireEvent.mouseUp(document, { ctrlKey: true });
    expect(cell).toHaveAttribute("data-selected", "true");

    await user.click(screen.getByTitle("点击变更「Bench-1」这一行的归属"));
    expect(await screen.findByText("变更选定数值的指标归属：Bench-1（已选 1 个模型）")).toBeInTheDocument();
    const deleteBtn = screen.getByRole("button", { name: "删除所选 1 格" });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(cell).toHaveAttribute("data-selected", "false");
    });
    confirmSpy.mockRestore();
  });
});

