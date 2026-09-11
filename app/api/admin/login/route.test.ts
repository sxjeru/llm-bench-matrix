import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdminAuth, mockTurnstile } = vi.hoisted(() => ({
  mockAdminAuth: {
    createAdminSessionToken: vi.fn(),
    checkLoginAllowed: vi.fn(),
    getLoginClientKey: vi.fn(() => "127.0.0.1"),
    persistAdminPassword: vi.fn(),
    registerLoginFailure: vi.fn(),
    resetLoginFailures: vi.fn(),
    verifyLoginPassword: vi.fn()
  },
  mockTurnstile: {
    verifyTurnstileToken: vi.fn()
  }
}));

vi.mock("../../../../lib/admin-auth", () => mockAdminAuth);
vi.mock("../../../../lib/turnstile", () => mockTurnstile);

import { POST } from "./route";

describe("POST /api/admin/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("当 Turnstile 校验失败时，应立即以 400 快速失败，且不触发数据库频控与密码计算", async () => {
    mockTurnstile.verifyTurnstileToken.mockResolvedValue({
      success: false,
      error: "请完成人机验证后再提交"
    });

    const req = new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "some-password",
        turnstileToken: ""
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("请完成人机验证后再提交");

    expect(mockTurnstile.verifyTurnstileToken).toHaveBeenCalledTimes(1);
    // 关键防 DoS 断言：必须完全不调用 checkLoginAllowed（数据库事务与锁）和 verifyLoginPassword（PBKDF2）
    expect(mockAdminAuth.checkLoginAllowed).not.toHaveBeenCalled();
    expect(mockAdminAuth.verifyLoginPassword).not.toHaveBeenCalled();
  });

  it("当 Turnstile 通过且密码正确时，成功签发 Session Cookie", async () => {
    mockTurnstile.verifyTurnstileToken.mockResolvedValue({
      success: true,
      bypassed: false
    });
    mockAdminAuth.checkLoginAllowed.mockResolvedValue({
      allowed: true,
      ipBlocked: false
    });
    mockAdminAuth.verifyLoginPassword.mockResolvedValue({
      ok: true,
      mustChangePassword: false,
      source: "db",
      defaultPasswordInUse: false,
      needsHashUpgrade: false
    });
    mockAdminAuth.resetLoginFailures.mockResolvedValue(undefined);
    mockAdminAuth.createAdminSessionToken.mockResolvedValue("mocked-session-token-64chars");

    const req = new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "correct-password",
        turnstileToken: "valid-token"
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("bench_admin_auth=mocked-session-token-64chars");
    expect(mockAdminAuth.checkLoginAllowed).toHaveBeenCalledWith("127.0.0.1");
    expect(mockAdminAuth.verifyLoginPassword).toHaveBeenCalledWith("correct-password");
  });

  it("当密码错误时，应记录失败并返回 401", async () => {
    mockTurnstile.verifyTurnstileToken.mockResolvedValue({
      success: true,
      bypassed: true
    });
    mockAdminAuth.checkLoginAllowed.mockResolvedValue({
      allowed: true,
      ipBlocked: false
    });
    mockAdminAuth.verifyLoginPassword.mockResolvedValue({
      ok: false,
      mustChangePassword: false,
      source: "db",
      defaultPasswordInUse: false,
      needsHashUpgrade: false
    });
    mockAdminAuth.registerLoginFailure.mockResolvedValue({
      locked: false,
      ipBlocked: false,
      remainingAttempts: 4
    });

    const req = new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "wrong-password"
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toContain("剩余尝试 4 次");
    expect(mockAdminAuth.registerLoginFailure).toHaveBeenCalledWith("127.0.0.1");
  });

  it("当 IP 或客户端被锁定时，应返回 429", async () => {
    mockTurnstile.verifyTurnstileToken.mockResolvedValue({
      success: true,
      bypassed: true
    });
    mockAdminAuth.checkLoginAllowed.mockResolvedValue({
      allowed: false,
      ipBlocked: true,
      retryAfterSeconds: 300
    });

    const req = new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "password"
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(429);

    const json = await res.json();
    expect(json.error).toContain("该 IP 已被锁定");
    expect(json.retryAfterSeconds).toBe(300);
  });

  it("当请求体格式非法时，应返回 400", async () => {
    const req = new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}) // missing password
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("当 turnstileToken 长度超过 2048 字符时，应立即以 400 拦截且不发起校验", async () => {
    const req = new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "some-password",
        turnstileToken: "x".repeat(2049)
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    expect(mockTurnstile.verifyTurnstileToken).not.toHaveBeenCalled();
    expect(mockAdminAuth.checkLoginAllowed).not.toHaveBeenCalled();
  });
});

