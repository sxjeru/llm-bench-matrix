import { describe, expect, it } from "vitest";
import { sanitizeAdminRedirectTarget } from "../admin-redirect";

describe("sanitizeAdminRedirectTarget", () => {
  it("defaults to /admin", () => {
    expect(sanitizeAdminRedirectTarget(null)).toBe("/admin");
    expect(sanitizeAdminRedirectTarget("")).toBe("/admin");
    expect(sanitizeAdminRedirectTarget("  ")).toBe("/admin");
  });

  it("allows same-origin admin destinations", () => {
    expect(sanitizeAdminRedirectTarget("/admin?tab=import", "https://example.com")).toBe(
      "/admin?tab=import"
    );
    expect(sanitizeAdminRedirectTarget("/admin#section", "https://example.com")).toBe(
      "/admin#section"
    );
  });

  it("rejects open redirects and non-admin paths", () => {
    expect(sanitizeAdminRedirectTarget("//evil.com", "https://example.com")).toBe("/admin");
    expect(sanitizeAdminRedirectTarget("https://evil.com", "https://example.com")).toBe("/admin");
    expect(sanitizeAdminRedirectTarget("/scatter", "https://example.com")).toBe("/admin");
  });

  it("never redirects back to the login page", () => {
    expect(sanitizeAdminRedirectTarget("/admin/login", "https://example.com")).toBe("/admin");
    expect(sanitizeAdminRedirectTarget("/admin/login?from=/admin", "https://example.com")).toBe(
      "/admin"
    );
  });
});
