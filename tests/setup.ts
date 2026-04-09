import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

if (typeof Element !== "undefined") {
  const elementPrototype = Element.prototype as unknown as Record<string, unknown>;
  const hasScrollIntoView = typeof Reflect.get(elementPrototype, "scrollIntoView") === "function";

  if (!hasScrollIntoView) {
    Object.defineProperty(elementPrototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: () => {}
    });
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
