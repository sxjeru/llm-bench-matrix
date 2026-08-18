import { describe, expect, it } from "vitest";
import { HOME_PATH, SCATTER_PATH, isHomePath, isScatterPath } from "../public-routes";

describe("public routes", () => {
  it("treats only the exact home path as home", () => {
    expect(HOME_PATH).toBe("/");
    expect(isHomePath("/")).toBe(true);
    expect(isHomePath("/scatter")).toBe(false);
    expect(isHomePath("/admin")).toBe(false);
    expect(isHomePath("/scatterplot")).toBe(false);
  });

  it("matches scatter exact and nested paths, not lookalikes", () => {
    expect(SCATTER_PATH).toBe("/scatter");
    expect(isScatterPath("/scatter")).toBe(true);
    expect(isScatterPath("/scatter/")).toBe(true);
    expect(isScatterPath("/scatter/share")).toBe(true);
    expect(isScatterPath("/")).toBe(false);
    expect(isScatterPath("/scatterplot")).toBe(false);
    expect(isScatterPath("/admin")).toBe(false);
  });
});
