import { act, render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/** Drain native `queueMicrotask` so `enqueueStateUpdate` can finish in tests. */
export async function flushQueuedStateUpdates() {
  await act(async () => {
    await Promise.resolve();
  });
}

export async function renderReady(
  ui: ReactElement,
  options?: RenderOptions
): Promise<RenderResult> {
  const view = render(ui, options);
  await flushQueuedStateUpdates();
  return view;
}
