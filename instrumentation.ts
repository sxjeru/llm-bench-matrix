import type { Instrumentation } from "next";
import { getErrorFields, getErrorRequestId, log } from "@/lib/logger";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  let path = "/";
  try {
    path = new URL(request.path, "http://localhost").pathname.slice(0, 300) || "/";
  } catch {
    // Do not emit a potentially sensitive or malformed raw request path.
  }

  const vercelRequestId = getInstrumentationRequestId(request.headers);
  const requestId = getErrorRequestId(error) ?? vercelRequestId ?? crypto.randomUUID();
  log("error", "server.request.unhandled_error", {
    requestId,
    method: request.method,
    path,
    routerKind: context.routerKind,
    routeType: context.routeType,
    ...getErrorFields(error)
  });
};

function getInstrumentationRequestId(headers: NodeJS.Dict<string | string[]>): string | undefined {
  const value = headers["x-vercel-id"];
  const requestId = Array.isArray(value) ? value[0] : value;

  return requestId && /^[a-zA-Z0-9:._-]{1,128}$/.test(requestId) ? requestId : undefined;
}

