import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

describe("BenchmarkMatrix modality column filter", () => {
  test("模态表头勾选后可筛选矩阵行", async () => {
    const user = userEvent.setup();

    render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model Text",
            benchmarkName: "Bench-Text",
            benchmarkType: "General",
            modalities: ["Text"],
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "70.1",
            valueNum: 70.1,
            valueNote: null,
            source: "text:sample"
          },
          {
            providerName: "OpenAI",
            modelName: "Model Vision",
            benchmarkName: "Bench-Vision",
            benchmarkType: "General",
            modalities: ["Vision"],
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "71.2",
            valueNum: 71.2,
            valueNote: null,
            source: "text:sample"
          }
        ]}
      />
    );

    expect(screen.getByText("Bench-Text")).toBeInTheDocument();
    expect(screen.getByText("Bench-Vision")).toBeInTheDocument();

    await user.click(screen.getByText("模态"));

    const visionCheckbox = screen.getByRole("checkbox", { name: "Vision" });
    await user.click(visionCheckbox);

    await waitFor(() => {
      expect(screen.getByText("Bench-Text")).toBeInTheDocument();
      expect(screen.queryByText("Bench-Vision")).not.toBeInTheDocument();
    });
  });
});
