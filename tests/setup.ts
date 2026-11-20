import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

vi.mock("@/lib/cache-versions", () => ({
  bumpCacheVersions: vi.fn().mockResolvedValue(undefined),
  invalidateCacheVersions: vi.fn(),
  getCacheVersions: vi.fn().mockResolvedValue({ dashboard: "1", pricing: "1", admin_entities: "1", settings: "1" }),
  getCacheVersion: vi.fn().mockResolvedValue("1")
}));

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
