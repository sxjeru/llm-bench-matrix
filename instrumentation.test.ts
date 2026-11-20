import { afterEach, describe, expect, test, vi } from "vitest";

import { onRequestError } from "@/instrumentation";

describe("Next.js request instrumentation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("logs uncaught server-side exceptions without request cookies, query parameters, or error contents", async () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await onRequestError(
      new Error("secret password, private request body, and SQL query"),
      { path: "/api/admin/records?token=private", method: "POST", headers: { "x-vercel-id": "sfo1::trace-id", cookie: "secret-session" } },
      { routerKind: "App Router", routePath: "/api/admin/records", routeType: "route", revalidateReason: undefined }
    );

    expect(errorLog).toHaveBeenCalledOnce();
    const entry = JSON.parse(errorLog.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      level: "error",
      event: "server.request.unhandled_error",
      requestId: "sfo1::trace-id",
      method: "POST",
      path: "/api/admin/records",
      routeType: "route",
      errorName: "Error"
    });
    expect(JSON.stringify(entry)).not.toMatch(/private|password|token|query|cookie|secret-session/i);
    expect(onRequestError).toBeTypeOf("function");
  });
});
