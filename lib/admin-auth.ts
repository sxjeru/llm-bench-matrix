import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_PASSWORD_SETTING_KEY,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  DEFAULT_ADMIN_PASSWORD_FALLBACK
} from "@/lib/admin-constants";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

const LOGIN_GUARD_KEY = "admin_login_guard";
const ADMIN_SESSIONS_KEY = "admin_sessions";
const LOGIN_FAIL_LIMIT = 5;
const BASE_LOCK_SECONDS = 5 * 60;
const MAX_LOCK_SECONDS = 60 * 60;
const LOGIN_GUARD_MAX_CLIENTS = 200;
const ADMIN_SESSION_MAX_COUNT = 500;

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

type AdminSessionEntry = {
  expiresAt: number;
  createdAt: number;
};

type AdminSessionMap = Record<string, AdminSessionEntry>;

if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
  throw new Error(
    [
      "[auth] Missing ADMIN_PASSWORD in production.",
      "Set ADMIN_PASSWORD in Vercel > Project > Settings > Environment Variables, or via `vercel env add ADMIN_PASSWORD production`.",
      "Do not deploy the admin console with the default fallback password."
    ].join("\n")
  );
}

function getFallbackPassword(): string {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD_FALLBACK;
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, pair) => {
    const [rawKey, ...rawValue] = pair.trim().split("=");
    if (!rawKey) return acc;
    const joined = rawValue.join("=");
    try {
      acc[rawKey] = decodeURIComponent(joined);
    } catch {
      acc[rawKey] = joined;
    }
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

function parseAdminSessionMap(valueJson: unknown): AdminSessionMap {
  if (!valueJson || typeof valueJson !== "object") return {};

  const sessions: AdminSessionMap = {};
  for (const [key, value] of Object.entries(valueJson as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;

    const row = value as Record<string, unknown>;
    const expiresAt = Number(row.expiresAt ?? 0);
    const createdAt = Number(row.createdAt ?? Date.now());

    if (!Number.isFinite(expiresAt) || expiresAt <= 0) continue;

    sessions[key] = {
      expiresAt,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
    };
  }

  return sessions;
}

function pruneLoginGuard(guard: LoginGuardMap): LoginGuardMap {
  const entries = Object.entries(guard);
  if (entries.length <= LOGIN_GUARD_MAX_CLIENTS) return guard;

  const sorted = entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(sorted.slice(0, LOGIN_GUARD_MAX_CLIENTS));
}

function pruneAdminSessions(sessions: AdminSessionMap, now = Date.now()): AdminSessionMap {
  const activeEntries = Object.entries(sessions).filter(([, entry]) => entry.expiresAt > now);
  if (activeEntries.length <= ADMIN_SESSION_MAX_COUNT) {
    return Object.fromEntries(activeEntries);
  }

  const sorted = activeEntries.sort((a, b) => b[1].createdAt - a[1].createdAt);
  return Object.fromEntries(sorted.slice(0, ADMIN_SESSION_MAX_COUNT));
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

async function getAdminSessionMap(): Promise<AdminSessionMap> {
  const valueJson = await readSettingJson(ADMIN_SESSIONS_KEY);
  return parseAdminSessionMap(valueJson);
}

async function saveLoginGuardMap(guard: LoginGuardMap) {
  const pruned = pruneLoginGuard(guard);
  await upsertSettingJson(LOGIN_GUARD_KEY, pruned, "Admin login guard state", "admin-system");
}

async function saveAdminSessionMap(sessionMap: AdminSessionMap) {
  const pruned = pruneAdminSessions(sessionMap);
  await upsertSettingJson(ADMIN_SESSIONS_KEY, pruned, "Admin session tokens", "admin-system");
}

export async function hashValue(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function createRandomSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function isAdminSessionTokenValid(sessionToken: string): Promise<boolean> {
  if (!sessionToken) return false;

  const sessionHash = await hashValue(sessionToken);
  const now = Date.now();
  const before = await getAdminSessionMap();
  const pruned = pruneAdminSessions(before, now);
  const exists = pruned[sessionHash];

  if (Object.keys(before).length !== Object.keys(pruned).length) {
    await saveAdminSessionMap(pruned);
  }

  return Boolean(exists && exists.expiresAt > now);
}

export async function createAdminSessionToken(): Promise<string> {
  const sessionToken = createRandomSessionToken();
  const sessionHash = await hashValue(sessionToken);
  const now = Date.now();

  const sessions = await getAdminSessionMap();
  sessions[sessionHash] = {
    createdAt: now,
    expiresAt: now + ADMIN_SESSION_MAX_AGE_SECONDS * 1000
  };

  await saveAdminSessionMap(sessions);
  return sessionToken;
}

export async function invalidateAdminSessionToken(sessionToken: string | null | undefined) {
  if (!sessionToken) return;

  const sessionHash = await hashValue(sessionToken);
  const sessions = await getAdminSessionMap();

  if (!sessions[sessionHash]) return;

  delete sessions[sessionHash];
  await saveAdminSessionMap(sessions);
}

export async function invalidateAllAdminSessions() {
  await saveAdminSessionMap({});
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
      mustChangePassword: false,
      source: "db",
      defaultPasswordInUse: false
    };
  }

  const fallbackPassword = getFallbackPassword();
  const ok = password === fallbackPassword;

  return {
    ok,
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
  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) {
      if (await isAdminSessionTokenValid(token)) {
        return true;
      }
    }
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const sessionToken = cookies[ADMIN_COOKIE_NAME];
  if (!sessionToken) return false;

  return isAdminSessionTokenValid(sessionToken);
}

export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  const authorized = await isAdminAuthorized(request);
  if (authorized) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
