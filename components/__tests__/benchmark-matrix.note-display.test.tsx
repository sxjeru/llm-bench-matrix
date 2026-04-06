import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

describe("BenchmarkMatrix 星号值显示", () => {
  test("单元格只显示净值，备注通过问号展示", async () => {
    render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "GPT-5-mini High",
            benchmarkName: "Terminal Bench 2.0",
            benchmarkType: "Coding Agent",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "65.5* data from the technical report",
            valueNum: 65.5,
            valueNote: "data from the technical report",
            source: "text:demo"
          }
        ]}
      />
    );

    expect(screen.getByText("65.5*")).toBeInTheDocument();
    expect(screen.queryByText(/data from the technical report/i)).not.toBeInTheDocument();

    const valueCell = screen.getByText("65.5*").closest("td");
    expect(valueCell).not.toBeNull();
    expect(valueCell).toHaveStyle({ paddingRight: "22px" });

    const questionMark = screen.getByText("?");
    fireEvent.mouseEnter(questionMark);

    expect(await screen.findByText("注释：data from the technical report")).toBeInTheDocument();
  });
});
