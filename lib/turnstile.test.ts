import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "./turnstile";

describe("verifyTurnstileToken", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("当未配置 TURNSTILE_SECRET_KEY 时自动 bypass", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const result = await verifyTurnstileToken({ token: undefined });
    expect(result).toEqual({ success: true, bypassed: true });
  });

  it("当已配置 SecretKey 但未提供 token 时拒绝", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
    const result = await verifyTurnstileToken({ token: "" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("请完成人机验证");
  });

  it("当 Cloudflare 返回 success: true 时验证成功", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstileToken({
      token: "valid-token",
      remoteIp: "1.2.3.4"
    });

    expect(result).toEqual({ success: true, bypassed: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const bodyString = (callArgs[1]?.body as URLSearchParams).toString();
    expect(bodyString).toContain("secret=test-secret-key");
    expect(bodyString).toContain("response=valid-token");
    expect(bodyString).toContain("remoteip=1.2.3.4");
  });

  it("当 Cloudflare 返回 success: false 时验证失败", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, "error-codes": ["invalid-input-response"] })
      })
    );

    const result = await verifyTurnstileToken({ token: "bad-token" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("人机验证未通过");
  });

  it("当 Cloudflare 返回 HTTP 500 异常时优雅处理", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      })
    );

    const result = await verifyTurnstileToken({ token: "some-token" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("人机验证服务通信异常");
  });

  it("当请求超时时返回超时友好提示", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";

    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(timeoutError)
    );

    const result = await verifyTurnstileToken({ token: "some-token" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("超时");
  });

  it("当 token 长度超过 2048 字符时直接前置拒绝，不发起网络请求", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const oversizedToken = "a".repeat(2049);
    const result = await verifyTurnstileToken({ token: oversizedToken });

    expect(result.success).toBe(false);
    expect(result.error).toContain("长度超出限制");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

