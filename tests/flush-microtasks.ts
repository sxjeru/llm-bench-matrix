import { act, render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/** Drain native `queueMicrotask` so `enqueueStateUpdate` can finish in tests. */
export async function flushQueuedStateUpdates() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Drain React `startTransition` updates scheduled after snapshot decode. */
export async function flushDeferredDerived() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
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
