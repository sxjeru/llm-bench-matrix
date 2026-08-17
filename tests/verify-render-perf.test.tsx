import { it, vi } from "vitest";
import { readFileSync, appendFileSync } from "node:fs";
import { render, act } from "@testing-library/react";
import { createElement, Profiler } from "react";
import { BenchmarkMatrix } from "@/components/benchmark-matrix";

const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => mockSearchParams
}));

const snap = JSON.parse(readFileSync("/tmp/snapshot.json", "utf8"));
const LABEL = process.env.PERF_LABEL ?? "unknown";

it("hover 单元格引发的 commit 开销", async () => {
  const commits: number[] = [];
  let recording = false;

  await act(async () => {
    render(
      createElement(
        Profiler,
        {
          id: "matrix",
          onRender: (_id: string, _phase: string, actualDuration: number) => {
            if (recording) commits.push(actualDuration);
          }
        },
        createElement(BenchmarkMatrix, {
          sourceOptions: snap.sourceOptions,
          rows: snap.rows,
          modelPrices: snap.modelPrices,
          modelParams: snap.modelParams,
          exportFootnoteText: snap.exportFootnoteText,
          exportFootnoteAlign: snap.exportFootnoteAlign
        })
      )
    );
  });

  const tdCount = document.querySelectorAll("tbody td").length;

  // 找一个带 onMouseEnter 的数值单元格：直接派发 React 合成事件依赖的原生事件
  const cells = Array.from(document.querySelectorAll("tbody tr td")) as HTMLElement[];

  recording = true;
  const durations: number[] = [];
  for (const target of cells.slice(30, 40)) {
    commits.length = 0;
    await act(async () => {
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    durations.push(commits.reduce((a, b) => a + b, 0));
  }
  recording = false;

  const sum = durations.reduce((a, b) => a + b, 0);
  appendFileSync(
    "/tmp/verify-perf.txt",
    `[${LABEL}] tbody <td>=${tdCount} | 10 次 hover 的 commit 总耗时=${sum.toFixed(1)} ms | 单次均值=${(sum / durations.length).toFixed(2)} ms\n`
  );
}, 600000);
