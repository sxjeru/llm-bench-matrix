import { afterEach, describe, expect, test, vi } from "vitest";

import { logApiEvent, withApiLogging } from "@/lib/api-logging";

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

  test("reuses one request ID for business events and the API summary outside Vercel", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const request = new Request("https://example.test/api/admin/model-prices/sync", { method: "POST" });

    await withApiLogging(request, "api.admin.model-prices.sync", () => {
      logApiEvent(request, "info", "admin.model_prices.sync.completed", { changedCount: 2 });
      return Response.json({ ok: true });
    });

    const entries = info.mock.calls.map(([entry]) => JSON.parse(entry as string));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ event: "admin.model_prices.sync.completed", changedCount: 2 });
    expect(entries[1]).toMatchObject({ event: "api.admin.model-prices.sync", statusCode: 200 });
    expect(entries[0].requestId).toEqual(expect.any(String));
    expect(entries[1].requestId).toBe(entries[0].requestId);
  });

  test("logs a 500 request summary with duration before rethrowing handler errors", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("private password or request body");
    Object.assign(failure, { code: "ECONNRESET" });
    const request = new Request("https://example.test/api/public/records");
    let businessEventRequestId: string | undefined;

    await expect(withApiLogging(
      request,
      "api.public.records",
      () => {
        logApiEvent(request, "info", "api.public.records.before_failure");
        businessEventRequestId = JSON.parse(info.mock.calls[0][0] as string).requestId;
        throw failure;
      }
    )).rejects.toBe(failure);

    expect(errorLog).toHaveBeenCalledOnce();
    const entry = JSON.parse(errorLog.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      event: "api.public.records.exception",
      level: "error",
      requestId: businessEventRequestId,
      statusCode: 500,
      errorName: "Error",
      errorCode: "ECONNRESET"
    });
    expect(entry.durationMs).toEqual(expect.any(Number));
    expect(JSON.stringify(entry)).not.toContain("private");
  });
});
