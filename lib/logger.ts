export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<{
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  slow?: boolean;
  errorName?: string;
  errorCode?: string;
  routerKind?: string;
  routeType?: string;
  snapshotSource?: string;
  fallbackUsed?: boolean;
  fallbackSource?: string;
  attempt?: number;
  cacheStatus?: string;
  payloadBytes?: number;
  recordCount?: number;
  warningCount?: number;
  changedCount?: number;
  changedModelCount?: number;
  providerCount?: number;
  sourceModelCount?: number;
  matchedCount?: number;
  unmatchedCount?: number;
  skippedManualCount?: number;
  skippedCount?: number;
  dryRun?: boolean;
}>;

type RequestLogContext = Readonly<{
  requestId: string;
  method: string;
  path: string;
}>;

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function configuredLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (configured === "debug" || configured === "info" || configured === "warn" || configured === "error") {
    return configured;
  }

  return process.env.NODE_ENV === "development" ? "debug" : "info";
}

function getString(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/[\r\n\t]/g, " ").trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function serializeFields(fields: LogFields): Record<string, string | number | boolean> {
  const serialized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;

    if (["statusCode", "durationMs", "payloadBytes", "recordCount", "warningCount", "changedCount", "changedModelCount", "providerCount", "sourceModelCount", "matchedCount", "unmatchedCount", "skippedManualCount", "skippedCount", "attempt"].includes(key)) {
      if (typeof value === "number" && Number.isFinite(value)) serialized[key] = Math.round(value * 100) / 100;
      continue;
    }

    if (["fallbackUsed", "dryRun"].includes(key)) {
      if (typeof value === "boolean") serialized[key] = value;
      continue;
    }

    if (["slow"].includes(key)) {
      if (typeof value === "boolean") serialized[key] = value;
      continue;
    }

    const stringValue = getString(value, key === "path" ? 300 : 160);
    if (stringValue && ["requestId", "method", "path", "errorName", "errorCode", "routerKind", "routeType", "snapshotSource", "fallbackSource", "cacheStatus"].includes(key)) {
      serialized[key] = stringValue;
    }
  }

  return serialized;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVEL_SEVERITY[level] < LEVEL_SEVERITY[configuredLevel()]) return;

  const safeEvent = /^[a-zA-Z0-9_.:-]{1,120}$/.test(event) ? event : "application.event";
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: safeEvent,
    ...serializeFields(fields)
  });

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else if (level === "debug") console.debug(entry);
  else console.info(entry);
}

export function getErrorFields(error: unknown): Pick<LogFields, "errorName" | "errorCode"> {
  if (!(error instanceof Error)) return { errorName: "NonErrorThrown" };

  const errorName = getString(error.name, 80);
  const code = (error as Error & { code?: unknown }).code;
  const errorCode = typeof code === "string" && /^[A-Z0-9_-]{1,32}$/i.test(code) ? code : undefined;

  return {
    ...(errorName ? { errorName } : {}),
    ...(errorCode ? { errorCode } : {})
  };
}

/**
 * Emit a stable, structured event without collecting request bodies, credentials,
 * headers, query strings, IP addresses, or database error messages.
 */
export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  log("error", event, {
    ...fields,
    ...getErrorFields(error)
  });
}

export function createRequestLogContext(request: Request): RequestLogContext {
  const vercelRequestId = request.headers.get("x-vercel-id");
  const safeRequestId = vercelRequestId && /^[a-zA-Z0-9:._-]{1,128}$/.test(vercelRequestId)
    ? vercelRequestId
    : crypto.randomUUID();

  let path = "/";
  try {
    path = new URL(request.url).pathname.slice(0, 300) || "/";
  } catch {
    // The path has no query string or credentials; use the safe root fallback.
  }

  return {
    requestId: safeRequestId,
    method: getString(request.method.toUpperCase(), 16) ?? "UNKNOWN",
    path
  };
}
