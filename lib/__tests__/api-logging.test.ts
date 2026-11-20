import { afterEach, describe, expect, test, vi } from "vitest";

import { withApiLogging } from "@/lib/api-logging";

describe("withApiLogging", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("reports failing API responses at error severity", async () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await withApiLogging(
      new Request("https://example.test/api/admin/cache/refresh?token=private"),
      "api.admin.cache.refresh",
      () => Response.json({ error: "not included in logs" }, { status: 500 })
    );

    expect(response.status).toBe(500);
    expect(errorLog).toHaveBeenCalledOnce();
    const entry = JSON.parse(errorLog.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ level: "error", statusCode: 500, path: "/api/admin/cache/refresh" });
    expect(entry).not.toHaveProperty("error");
  });

  test("marks slow API requests with the configured threshold", async () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    vi.stubEnv("LOG_SLOW_REQUEST_MS", "0.000001");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await withApiLogging(
      new Request("https://example.test/api/admin/settings"),
      "api.admin.settings",
      () => Response.json({ ok: true })
    );

    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      level: "warn",
      event: "api.admin.settings",
      statusCode: 200,
      slow: true
    });
  });

  test("rethrows handler errors for the global Next.js error hook to report once", async () => {
    const failure = new Error("private password or request body");

    await expect(withApiLogging(
      new Request("https://example.test/api/public/records"),
      "api.public.records",
      () => { throw failure; }
    )).rejects.toBe(failure);
  });
});
