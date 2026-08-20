import { fireEvent, screen } from "@testing-library/react";
import { renderReady } from "@/tests/flush-microtasks";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";

const mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: mockReplace
  }),
  useSearchParams: () => mockSearchParams
}));

const rows = [
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "70",
    valueNum: 70,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model B",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "71",
    valueNum: 71,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model C",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "72",
    valueNum: 72,
    valueNote: null,
    source: "text:S2"
  }
] as const;

async function renderMatrix() {
  return renderReady(
    <BenchmarkMatrix
      sourceOptions={["text:S1", "text:S2"]}
      rows={[...rows]}
    />
  );
}

describe("BenchmarkMatrix 模型筛选按页签记忆", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockReplace.mockClear();

    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("不同页签默认按本页签模型勾选，并独立记忆各自模型筛选", async () => {
    await renderMatrix();

    fireEvent.click(screen.getByRole("button", { name: "展开模型筛选" }));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 3/3");

    fireEvent.click(screen.getByLabelText("Model C"));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 2/3");

    fireEvent.click(screen.getByRole("tab", { name: "S1" }));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 2/3");

    fireEvent.click(screen.getByLabelText("Model B"));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 1/3");

    fireEvent.click(screen.getByRole("tab", { name: "S2" }));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 1/3");

    fireEvent.click(screen.getByRole("tab", { name: "S1" }));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 1/3");

    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 2/3");
  });

  test("刷新后可从浏览器恢复页签对应的模型筛选", async () => {
    const first = await renderMatrix();

    fireEvent.click(screen.getByRole("button", { name: "展开模型筛选" }));
    fireEvent.click(screen.getByRole("tab", { name: "S1" }));
    fireEvent.click(screen.getByLabelText("Model A"));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 1/3");

    first.unmount();

    await renderMatrix();

    fireEvent.click(screen.getByRole("button", { name: "展开模型筛选" }));
    fireEvent.click(screen.getByRole("tab", { name: "S1" }));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 1/3");
  });

  test("shift 点击表头可取消该模型筛选", async () => {
    await renderMatrix();

    fireEvent.click(screen.getByRole("button", { name: "展开模型筛选" }));
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 3/3");

    const modelACheckbox = screen.getByLabelText("Model A");
    const modelAHeader = screen.getAllByRole("columnheader").find((header) => header.textContent?.includes("Model A"));

    expect(modelAHeader).toBeTruthy();

    fireEvent.click(modelAHeader!, { shiftKey: true });
    expect(screen.getByText(/已选模型/)).toHaveTextContent("已选模型 2/3");
    expect(modelACheckbox).not.toBeChecked();
  });
});
