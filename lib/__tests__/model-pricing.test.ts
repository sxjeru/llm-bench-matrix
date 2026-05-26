import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: {}
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

describe("model pricing module", () => {
  test("exports public pricing helpers", async () => {
    const module = await import("@/lib/model-pricing");

    expect(typeof module.getModelPricingRows).toBe("function");
    expect(typeof module.syncModelsDevPricing).toBe("function");
    expect(typeof module.updateModelPricing).toBe("function");
  });
});
