import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

const duplicateBenchmarkRows = [
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "80",
    valueNum: 80,
    valueNote: null,
    source: "text:demo"
  },
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge123",
    benchmarkCanonicalKey: "mmlu-pro:knowledge123",
    benchTime: "2026-04-06T01:00:00.000Z",
    valueRaw: "82",
    valueNum: 82,
    valueNote: null,
    source: "text:demo"
  }
] as const;

describe("BenchmarkMatrix 重名 benchmark 合并", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("显示重名列默认关闭时，按 canonicalKey 冒号前缀合并重名 benchmark", () => {
    render(<BenchmarkMatrix rows={[...duplicateBenchmarkRows]} />);

    expect(screen.getAllByText("MMLU-Pro")).toHaveLength(1);
    expect(screen.getByText("Knowledge / Knowledge123")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.queryByText("80")).not.toBeInTheDocument();
  });

  test("开启显示重名列后，重名 benchmark 恢复为多行展示", () => {
    render(<BenchmarkMatrix rows={[...duplicateBenchmarkRows]} />);

    fireEvent.click(screen.getByRole("button", { name: /显示重名行|显示重名列/ }));

    expect(screen.getAllByText("MMLU-Pro")).toHaveLength(2);
    expect(screen.queryByText("Knowledge / Knowledge123")).not.toBeInTheDocument();
    expect(screen.getByText("Knowledge")).toBeInTheDocument();
    expect(screen.getByText("Knowledge123")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  test("括号语义不同的 benchmark 不应被误合并", () => {
    render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "MMMU Pro (no tools)",
            benchmarkType: "Coding",
            benchmarkCanonicalKey: "mmmupro(notools):coding",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "76.9",
            valueNum: 76.9,
            valueNote: null,
            source: "text:demo"
          },
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "MMMU Pro (with tools)",
            benchmarkType: "Coding",
            benchmarkCanonicalKey: "mmmupro(withtools):coding",
            benchTime: "2026-04-06T01:00:00.000Z",
            valueRaw: "81.2",
            valueNum: 81.2,
            valueNote: null,
            source: "text:demo"
          }
        ]}
      />
    );

    expect(screen.getByText("MMMU Pro (no tools)")).toBeInTheDocument();
    expect(screen.getByText("MMMU Pro (with tools)")).toBeInTheDocument();
    expect(screen.getByText("76.9")).toBeInTheDocument();
    expect(screen.getByText("81.2")).toBeInTheDocument();
  });
});
