import { fireEvent, screen } from "@testing-library/react";
import { renderReady } from "@/tests/flush-microtasks";
import { describe, expect, test, vi } from "vitest";
import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: mockReplace
  }),
  useSearchParams: () => new URLSearchParams()
}));

const rows: MatrixInputRow[] = [
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "TextBench",
    benchmarkType: "Text",
    benchmarkCanonicalKey: "textbench:text",
    modalities: ["Text"],
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "80",
    valueNum: 80,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "VisionBench",
    benchmarkType: "Vision",
    benchmarkCanonicalKey: "visionbench:vision",
    modalities: ["Vision"],
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "75",
    valueNum: 75,
    valueNote: null,
    source: "text:S1"
  }
];

describe("BenchmarkMatrix modality filtering", () => {
  test("toggling modality checkboxes updates rendered rows dynamically", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={[...rows]}
      />
    );

    // Both Benchmarks should be present initially
    expect(screen.getByText("TextBench")).toBeInTheDocument();
    expect(screen.getByText("VisionBench")).toBeInTheDocument();

    // Find the Modality filter dropdown and click summary to open
    const summary = screen.getByText("Modality");
    fireEvent.click(summary);

    // Uncheck "Vision" using getByRole for the checkbox
    const visionCheckbox = screen.getByRole("checkbox", { name: "Vision" });
    expect(visionCheckbox).toBeChecked();
    fireEvent.click(visionCheckbox);

    // Now, VisionBench should NOT be in the DOM
    expect(screen.getByText("TextBench")).toBeInTheDocument();
    expect(screen.queryByText("VisionBench")).toBeNull();

    // Check "Vision" again
    fireEvent.click(visionCheckbox);
    expect(screen.getByText("TextBench")).toBeInTheDocument();
    expect(screen.getByText("VisionBench")).toBeInTheDocument();
  });

  test("clicking outside the modality dropdown closes it", async () => {
    const { container } = await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={[...rows]}
      />
    );

    const detailsElement = container.querySelector("details[data-modality-filter='true']") as HTMLDetailsElement;
    expect(detailsElement).toBeTruthy();
    expect(detailsElement.open).toBe(false);

    // Click to open it
    const summary = screen.getByText("Modality");
    fireEvent.click(summary);
    // Directly setting open attribute or using fireEvent.click. Note: in jsdom clicking summary toggles details.open.
    detailsElement.setAttribute("open", "true");
    expect(detailsElement.open).toBe(true);

    // Click outside: we dispatch pointerdown on document.body
    fireEvent.pointerDown(document.body);

    // It should close (open attribute removed)
    expect(detailsElement.open).toBe(false);
  });
});
