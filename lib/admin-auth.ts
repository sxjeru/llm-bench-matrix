import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD_SETTING_KEY, DEFAULT_ADMIN_PASSWORD_FALLBACK } from "@/lib/admin-constants";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

const LOGIN_GUARD_KEY = "admin_login_guard";
const LOGIN_FAIL_LIMIT = 5;
const BASE_LOCK_SECONDS = 5 * 60;
const MAX_LOCK_SECONDS = 60 * 60;
const LOGIN_GUARD_MAX_CLIENTS = 200;

type PasswordSource = "db" | "env";

type PasswordInfo = {
  hash: string;
  source: PasswordSource;
  defaultPasswordInUse: boolean;
};

type LoginGuardEntry = {
  fails: number;
  lockedUntil: number | null;
  lockCount: number;
  ipBlockedUntil: number | null;
  updatedAt: number;
};

type LoginGuardMap = Record<string, LoginGuardEntry>;

function getFallbackPassword(): string {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD_FALLBACK;
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, pair) => {
    const [rawKey, ...rawValue] = pair.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("="));
    return acc;
  }, {});
}

function getHashFromSetting(valueJson: unknown): string | null {
  if (!valueJson) return null;

  if (typeof valueJson === "string") {
    const trimmed = valueJson.trim();
    return trimmed || null;
  }

  if (typeof valueJson === "object" && valueJson !== null) {
    const maybeHash = (valueJson as Record<string, unknown>).hash;
    if (typeof maybeHash === "string" && maybeHash.trim()) {
      return maybeHash.trim();
    }
  }

  return null;
}

function parseLoginGuard(valueJson: unknown): LoginGuardMap {
  if (!valueJson || typeof valueJson !== "object") return {};

  const guard: LoginGuardMap = {};
  for (const [key, value] of Object.entries(valueJson as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;

    const row = value as Record<string, unknown>;
    const fails = Number(row.fails ?? 0);
    const lockedUntilRaw = row.lockedUntil;
    const lockCount = Number(row.lockCount ?? 0);
    const ipBlockedUntilRaw = row.ipBlockedUntil;
    const updatedAt = Number(row.updatedAt ?? Date.now());

    guard[key] = {
      fails: Number.isFinite(fails) ? Math.max(0, Math.floor(fails)) : 0,
      lockedUntil:
        typeof lockedUntilRaw === "number" && Number.isFinite(lockedUntilRaw)
          ? lockedUntilRaw
          : null,
      lockCount: Number.isFinite(lockCount) ? Math.max(0, Math.floor(lockCount)) : 0,
      ipBlockedUntil:
        typeof ipBlockedUntilRaw === "number" && Number.isFinite(ipBlockedUntilRaw)
          ? ipBlockedUntilRaw
          : null,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
    };
  }

  return guard;
}

function pruneLoginGuard(guard: LoginGuardMap): LoginGuardMap {
  const entries = Object.entries(guard);
  if (entries.length <= LOGIN_GUARD_MAX_CLIENTS) return guard;

  const sorted = entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(sorted.slice(0, LOGIN_GUARD_MAX_CLIENTS));
}

async function readSettingJson(key: string): Promise<unknown> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.valueJson ?? null;
}

async function upsertSettingJson(key: string, valueJson: unknown, note: string, updatedBy = "system") {
  await db
    .insert(settings)
    .values({
      key,
      valueJson,
      updatedAt: new Date(),
      updatedBy,
      note
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        valueJson,
        updatedAt: new Date(),
        updatedBy,
        note
      }
    });
}

async function getStoredPasswordHash(): Promise<string | null> {
  const valueJson = await readSettingJson(ADMIN_PASSWORD_SETTING_KEY);
  return getHashFromSetting(valueJson);
}

async function getLoginGuardMap(): Promise<LoginGuardMap> {
  const valueJson = await readSettingJson(LOGIN_GUARD_KEY);
  return parseLoginGuard(valueJson);
}

async function saveLoginGuardMap(guard: LoginGuardMap) {
  const pruned = pruneLoginGuard(guard);
  await upsertSettingJson(LOGIN_GUARD_KEY, pruned, "Admin login guard state", "admin-system");
}

export async function hashValue(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getPasswordInfo(): Promise<PasswordInfo> {
  const storedHash = await getStoredPasswordHash();
  if (storedHash) {
    return {
      hash: storedHash,
      source: "db",
      defaultPasswordInUse: false
    };
  }

  const fallbackPassword = getFallbackPassword();
  const fallbackHash = await hashValue(fallbackPassword);

  return {
    hash: fallbackHash,
    source: "env",
    defaultPasswordInUse: fallbackPassword === DEFAULT_ADMIN_PASSWORD_FALLBACK
  };
}

export function getLoginClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const realIp = request.headers.get("x-real-ip") || "";

  const forwardedIp = forwarded.split(",")[0]?.trim();
  const raw = forwardedIp || realIp || "global";

  return raw.slice(0, 128);
}

export async function checkLoginAllowed(clientKey: string): Promise<{
  allowed: boolean;
  ipBlocked: boolean;
  retryAfterSeconds?: number;
}> {
  const guard = await getLoginGuardMap();
  const entry = guard[clientKey];

  if (!entry) {
    return { allowed: true, ipBlocked: false };
  }

  const now = Date.now();
  if (entry.ipBlockedUntil && now < entry.ipBlockedUntil) {
    return {
      allowed: false,
      ipBlocked: true,
      retryAfterSeconds: Math.ceil((entry.ipBlockedUntil - now) / 1000)
    };
  }

  if (entry.ipBlockedUntil && now >= entry.ipBlockedUntil) {
    delete guard[clientKey];
    await saveLoginGuardMap(guard);
    return { allowed: true, ipBlocked: false };
  }

  if (entry.lockedUntil && now < entry.lockedUntil) {
    return {
      allowed: false,
      ipBlocked: false,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000)
    };
  }

  if (entry.lockedUntil && now >= entry.lockedUntil) {
    entry.lockedUntil = null;
    entry.fails = 0;
    entry.updatedAt = now;
    guard[clientKey] = entry;
    await saveLoginGuardMap(guard);
  }

  return { allowed: true, ipBlocked: false };
}

export async function registerLoginFailure(clientKey: string): Promise<{
  locked: boolean;
  ipBlocked: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}> {
  const guard = await getLoginGuardMap();
  const now = Date.now();

  const entry = guard[clientKey] ?? {
    fails: 0,
    lockedUntil: null,
    lockCount: 0,
    ipBlockedUntil: null,
    updatedAt: now
  };

  entry.fails += 1;
  entry.updatedAt = now;

  if (entry.fails >= LOGIN_FAIL_LIMIT) {
    entry.lockCount += 1;
    const lockSeconds = Math.min(BASE_LOCK_SECONDS * 2 ** (entry.lockCount - 1), MAX_LOCK_SECONDS);
    entry.lockedUntil = now + lockSeconds * 1000;
    entry.fails = 0;

    if (entry.lockCount >= 2) {
      entry.ipBlockedUntil = now + lockSeconds * 1000;
      entry.lockedUntil = entry.ipBlockedUntil;
    }
  }

  guard[clientKey] = entry;
  await saveLoginGuardMap(guard);

  const locked = Boolean(entry.lockedUntil && now < entry.lockedUntil);
  const ipBlocked = Boolean(entry.ipBlockedUntil && now < entry.ipBlockedUntil);
  const remainingAttempts = entry.fails === 0 ? 0 : Math.max(0, LOGIN_FAIL_LIMIT - entry.fails);

  return {
    locked,
    ipBlocked,
    remainingAttempts,
    retryAfterSeconds: locked && entry.lockedUntil ? Math.ceil((entry.lockedUntil - now) / 1000) : undefined
  };
}

export async function resetLoginFailures(clientKey: string) {
  const guard = await getLoginGuardMap();
  if (!guard[clientKey]) return;

  delete guard[clientKey];
  await saveLoginGuardMap(guard);
}

export async function needsPasswordRotation(): Promise<boolean> {
  const info = await getPasswordInfo();
  return info.source === "env" && info.defaultPasswordInUse;
}

export async function verifyLoginPassword(password: string): Promise<{
  ok: boolean;
  sessionToken?: string;
  mustChangePassword: boolean;
  source: PasswordSource;
  defaultPasswordInUse: boolean;
}> {
  const info = await getPasswordInfo();

  if (info.source === "db") {
    const inputHash = await hashValue(password);
    const ok = inputHash === info.hash;
    return {
      ok,
      sessionToken: ok ? info.hash : undefined,
      mustChangePassword: false,
      source: "db",
      defaultPasswordInUse: false
    };
  }

  const fallbackPassword = getFallbackPassword();
  const ok = password === fallbackPassword;

  return {
    ok,
    sessionToken: ok ? info.hash : undefined,
    mustChangePassword: ok && info.defaultPasswordInUse,
    source: "env",
    defaultPasswordInUse: info.defaultPasswordInUse
  };
}

export async function persistAdminPassword(newPassword: string, updatedBy = "admin") {
  const newHash = await hashValue(newPassword);

  await upsertSettingJson(
    ADMIN_PASSWORD_SETTING_KEY,
    {
      hash: newHash,
      updatedAt: new Date().toISOString()
    },
    "Admin password hash",
    updatedBy
  );

  return newHash;
}

export async function isAdminAuthorized(request: Request): Promise<boolean> {
  const info = await getPasswordInfo();

  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) {
      const tokenHash = await hashValue(token);
      if (tokenHash === info.hash) {
        return true;
      }
    }
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return cookies[ADMIN_COOKIE_NAME] === info.hash;
}

export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  const authorized = await isAdminAuthorized(request);
  if (authorized) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
