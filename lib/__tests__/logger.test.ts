import { afterEach, describe, expect, test, vi } from "vitest";

import {
  associateErrorWithRequestId,
  createRequestLogContext,
  getErrorFields,
  getErrorRequestId,
  LOG_FIELD_SCHEMA,
  log,
  type LogFields
} from "@/lib/logger";
import { withApiLogging } from "@/lib/api-logging";

describe("server logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("emits one structured JSON entry and omits fields outside the safe allowlist", () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const untrustedFields = { event: "must-not-override", body: "sensitive data", query: "sensitive query" };

    log("info", "api.test.completed", {
      statusCode: 200,
      requestId: "req_test",
      ...(untrustedFields as unknown as Record<string, never>)
    });

    expect(info).toHaveBeenCalledOnce();
    const entry = JSON.parse(info.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ level: "info", event: "api.test.completed", statusCode: 200, requestId: "req_test" });
    expect(entry).not.toHaveProperty("body");
    expect(entry).not.toHaveProperty("query");
    expect(entry.event).toBe("api.test.completed");
  });

  test("serializes every field declared in the shared type/runtime schema", () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fields = Object.fromEntries([
      ...LOG_FIELD_SCHEMA.strings.map((key) => [key, "sample"]),
      ...LOG_FIELD_SCHEMA.numbers.map((key) => [key, 1]),
      ...LOG_FIELD_SCHEMA.booleans.map((key) => [key, true])
    ]) as unknown as LogFields;

    log("info", "logger.schema.test", fields);

    const entry = JSON.parse(info.mock.calls[0][0] as string);
    for (const key of Object.values(LOG_FIELD_SCHEMA).flat()) {
      expect(entry).toHaveProperty(key);
    }
  });

  test("chooses a safe request ID and strips query parameters from request paths", () => {
    const context = createRequestLogContext(new Request("https://example.test/api/public/records?apiKey=private", {
      headers: {
        "x-vercel-id": "sfo1::request-id"
      }
    }));

    expect(context).toMatchObject({ requestId: "sfo1::request-id", method: "GET", path: "/api/public/records" });
  });

  test("replaces Unicode line separators inside field values", () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    log("info", "logger.unicode.test", { requestId: "first\u2028second\u2029third" });

    const serialized = info.mock.calls[0][0] as string;
    expect(serialized).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(serialized).requestId).toBe("first second third");
  });

  test("records the executed route status, duration, and no response body", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await withApiLogging(
      new Request("https://example.test/api/public/dashboard"),
      "api.public.dashboard",
      () => Response.json({ secret: "never logged" }, { status: 200 })
    );

    expect(response.status).toBe(200);
    const entry = JSON.parse(info.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ level: "info", event: "api.public.dashboard", statusCode: 200, method: "GET", path: "/api/public/dashboard" });
    expect(entry.durationMs).toEqual(expect.any(Number));
    expect(entry).not.toHaveProperty("secret");
  });

  test("records a safe error class without leaking database messages", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const error = new Error("postgres://admin:password@example.test/app?api_key=private");
    Object.assign(error, { code: "ECONNREFUSED" });

    expect(getErrorFields(error)).toEqual({ errorName: "Error", errorCode: "ECONNREFUSED" });
  });

  test("keeps request correlation for frozen errors without changing the error", () => {
    const error = Object.freeze(new Error("frozen failure"));

    associateErrorWithRequestId(error, "self-hosted-request-id");

    expect(getErrorRequestId(error)).toBe("self-hosted-request-id");
    expect(Object.getOwnPropertySymbols(error)).toHaveLength(0);
  });
});
