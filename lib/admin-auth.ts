import { eq, sql } from "drizzle-orm";
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

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH_ALGORITHM = "SHA-256";
const PBKDF2_KEY_LENGTH_BITS = 256;
const PBKDF2_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;

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

type DbTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
  throw new Error(
    [
      "[auth] Missing ADMIN_PASSWORD in production.",
      "Set ADMIN_PASSWORD in Vercel > Project > Settings > Environment Variables, or via `vercel env add ADMIN_PASSWORD production`.",
      "Do not deploy the admin console with the default fallback password."
    ].join("\n")
  );
}

// ---------------------------------------------------------------------------
// Byte / Hex helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const pairs = hex.match(/.{1,2}/g) ?? [];
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// Password hashing – PBKDF2 with random salt
// ---------------------------------------------------------------------------

/**
 * Hash a password using PBKDF2 with a random salt.
 * Output format: `pbkdf2:<iterations>:<salt_hex>:<hash_hex>`
 */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH_ALGORITHM
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH_BITS
  );

  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(new Uint8Array(derivedBits));

  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a stored hash.
 * Supports both:
 *   - New PBKDF2 format: `pbkdf2:<iterations>:<salt_hex>:<hash_hex>`
 *   - Legacy SHA-256 format: plain 64-char hex string
 */
async function verifyPasswordHash(password: string, storedHash: string): Promise<{
  match: boolean;
  isLegacyFormat: boolean;
}> {
  if (storedHash.startsWith("pbkdf2:")) {
    const parts = storedHash.split(":");
    if (parts.length !== 4) {
      return { match: false, isLegacyFormat: false };
    }

    const iterations = Number.parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expectedHashHex = parts[3];

    if (!Number.isFinite(iterations) || iterations < 1 || !saltHex || !expectedHashHex) {
      return { match: false, isLegacyFormat: false };
    }

    const salt = hexToBytes(saltHex);
    const saltBuffer = new ArrayBuffer(salt.byteLength);
    new Uint8Array(saltBuffer).set(salt);
    const encoder = new TextEncoder();

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: saltBuffer,
        iterations,
        hash: PBKDF2_HASH_ALGORITHM
      },
      keyMaterial,
      PBKDF2_KEY_LENGTH_BITS
    );

    const computedHashHex = bytesToHex(new Uint8Array(derivedBits));
    return {
      match: timingSafeStringEqual(computedHashHex, expectedHashHex),
      isLegacyFormat: false
    };
  }

  // Legacy SHA-256 format: compute SHA-256 and compare
  const legacyHash = await hashSessionToken(password);
  return {
    match: timingSafeStringEqual(legacyHash, storedHash),
    isLegacyFormat: true
  };
}

// ---------------------------------------------------------------------------
// Session token hashing – SHA-256 (suitable for random high-entropy tokens)
// ---------------------------------------------------------------------------

export async function hashSessionToken(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @deprecated Use `hashSessionToken` for session tokens, or `hashPassword` / `verifyPasswordHash` for passwords.
 */
export const hashValue = hashSessionToken;

// ---------------------------------------------------------------------------
// Cookie / request helpers
// ---------------------------------------------------------------------------

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

function createRandomSessionToken(): string {
  const bytes = new Uint8Array(SESSION_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// ---------------------------------------------------------------------------
// Settings JSON helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Atomic setting update – transaction + advisory lock to prevent races
// ---------------------------------------------------------------------------

/**
 * Atomically read-modify-write a settings row using a PostgreSQL advisory lock.
 * Prevents concurrent reads from producing stale writes (classic TOCTOU race).
 */
async function atomicUpdateSetting<T>(
  key: string,
  updater: (currentJson: unknown) => { nextJson: unknown; shouldWrite: boolean; result: T },
  meta: { note: string; updatedBy?: string }
): Promise<T> {
  return db.transaction(async (tx: DbTransactionClient) => {
    // Acquire a transaction-scoped advisory lock keyed on the settings key.
    // This serialises concurrent read-modify-write cycles for the same key.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);

    const readResult = await tx
      .select({ valueJson: settings.valueJson })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);

    const currentJson = readResult[0]?.valueJson ?? null;
    const { nextJson, shouldWrite, result } = updater(currentJson);

    if (shouldWrite) {
      await tx
        .insert(settings)
        .values({
          key,
          valueJson: nextJson,
          updatedAt: new Date(),
          updatedBy: meta.updatedBy ?? "system",
          note: meta.note
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            valueJson: nextJson,
            updatedAt: new Date(),
            updatedBy: meta.updatedBy ?? "system",
            note: meta.note
          }
        });
    }

    return result;
  });
}

// ---------------------------------------------------------------------------
// Login guard parsing / pruning
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Session map parsing / pruning
// ---------------------------------------------------------------------------

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

function pruneAdminSessions(sessions: AdminSessionMap, now = Date.now()): AdminSessionMap {
  const activeEntries = Object.entries(sessions).filter(([, entry]) => entry.expiresAt > now);
  if (activeEntries.length <= ADMIN_SESSION_MAX_COUNT) {
    return Object.fromEntries(activeEntries);
  }

  const sorted = activeEntries.sort((a, b) => b[1].createdAt - a[1].createdAt);
  return Object.fromEntries(sorted.slice(0, ADMIN_SESSION_MAX_COUNT));
}

// ---------------------------------------------------------------------------
// Password info
// ---------------------------------------------------------------------------

async function getStoredPasswordHash(): Promise<string | null> {
  const valueJson = await readSettingJson(ADMIN_PASSWORD_SETTING_KEY);
  return getHashFromSetting(valueJson);
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
  const fallbackHash = await hashSessionToken(fallbackPassword);

  return {
    hash: fallbackHash,
    source: "env",
    defaultPasswordInUse: fallbackPassword === DEFAULT_ADMIN_PASSWORD_FALLBACK
  };
}

// ---------------------------------------------------------------------------
// Session operations – atomic via advisory lock
// ---------------------------------------------------------------------------

async function isAdminSessionTokenValid(sessionToken: string): Promise<boolean> {
  if (!sessionToken) return false;

  const sessionHash = await hashSessionToken(sessionToken);
  const now = Date.now();

  // Read-only: no race concern for validation itself.
  // Pruning of expired sessions is deferred to create/invalidate operations.
  const raw = await readSettingJson(ADMIN_SESSIONS_KEY);
  const sessions = parseAdminSessionMap(raw);
  const entry = sessions[sessionHash];

  return Boolean(entry && entry.expiresAt > now);
}

export async function createAdminSessionToken(): Promise<string> {
  const sessionToken = createRandomSessionToken();
  const sessionHash = await hashSessionToken(sessionToken);
  const now = Date.now();

  await atomicUpdateSetting(
    ADMIN_SESSIONS_KEY,
    (currentJson) => {
      const sessions = parseAdminSessionMap(currentJson);
      sessions[sessionHash] = {
        createdAt: now,
        expiresAt: now + ADMIN_SESSION_MAX_AGE_SECONDS * 1000
      };
      const pruned = pruneAdminSessions(sessions, now);
      return { nextJson: pruned, shouldWrite: true, result: undefined };
    },
    { note: "Admin session tokens", updatedBy: "admin-system" }
  );

  return sessionToken;
}

export async function invalidateAdminSessionToken(sessionToken: string | null | undefined) {
  if (!sessionToken) return;

  const sessionHash = await hashSessionToken(sessionToken);

  await atomicUpdateSetting(
    ADMIN_SESSIONS_KEY,
    (currentJson) => {
      const sessions = parseAdminSessionMap(currentJson);
      if (!sessions[sessionHash]) {
        return { nextJson: sessions, shouldWrite: false, result: undefined };
      }
      delete sessions[sessionHash];
      const pruned = pruneAdminSessions(sessions);
      return { nextJson: pruned, shouldWrite: true, result: undefined };
    },
    { note: "Admin session tokens", updatedBy: "admin-system" }
  );
}

export async function invalidateAllAdminSessions() {
  await atomicUpdateSetting(
    ADMIN_SESSIONS_KEY,
    () => ({ nextJson: {}, shouldWrite: true, result: undefined }),
    { note: "Admin session tokens", updatedBy: "admin-system" }
  );
}

// ---------------------------------------------------------------------------
// Login guard operations – atomic via advisory lock
// ---------------------------------------------------------------------------

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
  type GuardResult = { allowed: boolean; ipBlocked: boolean; retryAfterSeconds?: number };

  return atomicUpdateSetting<GuardResult>(
    LOGIN_GUARD_KEY,
    (currentJson) => {
      const guard = parseLoginGuard(currentJson);
      const entry = guard[clientKey];
      const now = Date.now();

      if (!entry) {
        return { nextJson: guard, shouldWrite: false, result: { allowed: true, ipBlocked: false } };
      }

      if (entry.ipBlockedUntil && now < entry.ipBlockedUntil) {
        return {
          nextJson: guard,
          shouldWrite: false,
          result: {
            allowed: false,
            ipBlocked: true,
            retryAfterSeconds: Math.ceil((entry.ipBlockedUntil - now) / 1000)
          }
        };
      }

      if (entry.ipBlockedUntil && now >= entry.ipBlockedUntil) {
        delete guard[clientKey];
        return {
          nextJson: pruneLoginGuard(guard),
          shouldWrite: true,
          result: { allowed: true, ipBlocked: false }
        };
      }

      if (entry.lockedUntil && now < entry.lockedUntil) {
        return {
          nextJson: guard,
          shouldWrite: false,
          result: {
            allowed: false,
            ipBlocked: false,
            retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000)
          }
        };
      }

      if (entry.lockedUntil && now >= entry.lockedUntil) {
        entry.lockedUntil = null;
        entry.fails = 0;
        entry.updatedAt = now;
        guard[clientKey] = entry;
        return {
          nextJson: pruneLoginGuard(guard),
          shouldWrite: true,
          result: { allowed: true, ipBlocked: false }
        };
      }

      return { nextJson: guard, shouldWrite: false, result: { allowed: true, ipBlocked: false } };
    },
    { note: "Admin login guard state", updatedBy: "admin-system" }
  );
}

export async function registerLoginFailure(clientKey: string): Promise<{
  locked: boolean;
  ipBlocked: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}> {
  return atomicUpdateSetting(
    LOGIN_GUARD_KEY,
    (currentJson) => {
      const guard = parseLoginGuard(currentJson);
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
      const pruned = pruneLoginGuard(guard);

      const locked = Boolean(entry.lockedUntil && now < entry.lockedUntil);
      const ipBlocked = Boolean(entry.ipBlockedUntil && now < entry.ipBlockedUntil);
      const remainingAttempts = entry.fails === 0 ? 0 : Math.max(0, LOGIN_FAIL_LIMIT - entry.fails);

      return {
        nextJson: pruned,
        shouldWrite: true,
        result: {
          locked,
          ipBlocked,
          remainingAttempts,
          retryAfterSeconds: locked && entry.lockedUntil ? Math.ceil((entry.lockedUntil - now) / 1000) : undefined
        }
      };
    },
    { note: "Admin login guard state", updatedBy: "admin-system" }
  );
}

export async function resetLoginFailures(clientKey: string) {
  await atomicUpdateSetting(
    LOGIN_GUARD_KEY,
    (currentJson) => {
      const guard = parseLoginGuard(currentJson);
      if (!guard[clientKey]) {
        return { nextJson: guard, shouldWrite: false, result: undefined };
      }
      delete guard[clientKey];
      return { nextJson: pruneLoginGuard(guard), shouldWrite: true, result: undefined };
    },
    { note: "Admin login guard state", updatedBy: "admin-system" }
  );
}

// ---------------------------------------------------------------------------
// Password verification & persistence
// ---------------------------------------------------------------------------

export async function needsPasswordRotation(): Promise<boolean> {
  const info = await getPasswordInfo();
  return info.source === "env" && info.defaultPasswordInUse;
}

export async function verifyLoginPassword(password: string): Promise<{
  ok: boolean;
  mustChangePassword: boolean;
  source: PasswordSource;
  defaultPasswordInUse: boolean;
  needsHashUpgrade: boolean;
}> {
  const info = await getPasswordInfo();

  if (info.source === "db") {
    const { match, isLegacyFormat } = await verifyPasswordHash(password, info.hash);
    return {
      ok: match,
      mustChangePassword: false,
      source: "db",
      defaultPasswordInUse: false,
      needsHashUpgrade: match && isLegacyFormat
    };
  }

  const fallbackPassword = getFallbackPassword();
  const ok = password === fallbackPassword;

  return {
    ok,
    mustChangePassword: ok && info.defaultPasswordInUse,
    source: "env",
    defaultPasswordInUse: info.defaultPasswordInUse,
    needsHashUpgrade: false
  };
}

export async function persistAdminPassword(newPassword: string, updatedBy = "admin") {
  const newHash = await hashPassword(newPassword);

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

// ---------------------------------------------------------------------------
// Auth check
// ---------------------------------------------------------------------------

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

  return NextResponse.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0"
      }
    }
  );
}
