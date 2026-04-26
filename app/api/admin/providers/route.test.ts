import { beforeEach, describe, expect, test, vi } from "vitest";
import { PATCH, POST } from "@/app/api/admin/providers/route";
import { requireAdmin } from "@/lib/admin-auth";
import { ensureProvider, updateProviderConfig } from "@/lib/admin-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-service", () => ({
  ensureProvider: vi.fn(),
  updateProviderConfig: vi.fn()
}));

describe("POST /api/admin/providers", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(ensureProvider).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
  });

  test("应该成功创建新 provider", async () => {
    const mockProvider = {
      id: 1,
      name: "OpenAI",
      config: {}
    };

    vi.mocked(ensureProvider).mockResolvedValue(mockProvider);

    const response = await POST(
      new Request("https://example.com/api/admin/providers", {
        method: "POST",
        body: JSON.stringify({ name: "OpenAI" }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.provider).toBeDefined();
    expect(data.provider.id).toBe(1);
    expect(data.provider.name).toBe("OpenAI");
  });

  test("应该拒绝无效的 name（空字符串）", async () => {
    const response = await POST(
      new Request("https://example.com/api/admin/providers", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("应该拒绝不包含 name 的请求", async () => {
    const response = await POST(
      new Request("https://example.com/api/admin/providers", {
        method: "POST",
        body: JSON.stringify({ other: "value" }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("应该拒绝无鉴权请求", async () => {
    const deniedResponse = new Response("Unauthorized", { status: 401 });
    vi.mocked(requireAdmin).mockResolvedValue(deniedResponse);

    const response = await POST(
      new Request("https://example.com/api/admin/providers", {
        method: "POST",
        body: JSON.stringify({ name: "OpenAI" }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(401);
  });

  test("应该处理无效的 JSON", async () => {
    const response = await POST(
      new Request("https://example.com/api/admin/providers", {
        method: "POST",
        body: "invalid json",
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });
});

describe("PATCH /api/admin/providers", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(updateProviderConfig).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
  });

  test("应该成功更新 provider displayName", async () => {
    const mockProvider = {
      id: 1,
      name: "OpenAI",
      slug: "openai",
      config: { displayName: "GPT Provider" },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.mocked(updateProviderConfig).mockResolvedValue(mockProvider);

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: { displayName: "GPT Provider" }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.provider).toBeDefined();
    expect(data.provider.id).toBe(1);
    expect(data.provider.name).toBe("OpenAI");
    expect(data.provider.config.displayName).toBe("GPT Provider");
  });

  test("应该成功更新 provider 前缀规则", async () => {
    const mockProvider = {
      id: 1,
      name: "OpenAI",
      slug: "openai",
      config: {
        prefixRules: [
          { prefix: "gpt-4", enabled: true },
          { prefix: "gpt-3", enabled: false }
        ]
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.mocked(updateProviderConfig).mockResolvedValue(mockProvider);

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {
            prefixRules: [
              { prefix: "gpt-4", enabled: true },
              { prefix: "gpt-3", enabled: false }
            ]
          }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.provider).toBeDefined();
    expect(data.provider.id).toBe(1);
    expect(data.provider.config.prefixRules).toHaveLength(2);
    expect(data.provider.config.prefixRules[0].prefix).toBe("gpt-4");
  });

  test("应该验证十六进制颜色格式", async () => {
    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {
            branding: {
              color: "#GGGGGG"
            }
          }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("应该接受有效的十六进制颜色", async () => {
    const mockProvider = {
      id: 1,
      name: "OpenAI",
      slug: "openai",
      config: {
        branding: { color: "#00d084" }
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.mocked(updateProviderConfig).mockResolvedValue(mockProvider);

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {
            branding: { color: "#00D084" }
          }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.provider).toBeDefined();
    expect(data.provider.config.branding.color).toBe("#00d084");
  });

  test("应该处理 updateProviderConfig 抛出的错误 - 前缀冲突", async () => {
    vi.mocked(updateProviderConfig).mockRejectedValue(
      new Error("prefix 已被其他 provider 使用: gpt")
    );

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 2,
          config: {
            prefixRules: [{ prefix: "gpt", enabled: true }]
          }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("prefix 已被其他 provider 使用");
  });

  test("应该处理 updateProviderConfig 抛出的错误 - 重复前缀", async () => {
    vi.mocked(updateProviderConfig).mockRejectedValue(
      new Error("当前 provider 存在重复 prefix: gpt")
    );

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {
            prefixRules: [
              { prefix: "gpt", enabled: true },
              { prefix: "GPT", enabled: true }
            ]
          }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("当前 provider 存在重复 prefix");
  });

  test("应该拒绝空 displayName", async () => {
    // 空白 displayName 被 Zod 的 trim().min(1) 验证拒绝
    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: { displayName: "   " }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("应该拒绝无鉴权请求", async () => {
    const deniedResponse = new Response("Unauthorized", { status: 401 });
    vi.mocked(requireAdmin).mockResolvedValue(deniedResponse);

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {}
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(401);
  });

  test("应该拒绝无效的 providerId（非正整数）", async () => {
    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: -1,
          config: {}
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("应该拒绝无效的 providerId（非整数）", async () => {
    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1.5,
          config: {}
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("应该拒绝不包含 providerId 的请求", async () => {
    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          config: {}
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("应该处理无效的 JSON", async () => {
    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: "invalid json",
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("应该接受空 config 对象", async () => {
    const mockProvider = {
      id: 1,
      name: "OpenAI",
      slug: "openai",
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.mocked(updateProviderConfig).mockResolvedValue(mockProvider);

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {}
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.provider).toBeDefined();
    expect(data.provider.id).toBe(1);
  });

  test("应该接受可选的 config 字段（displayName 为 undefined）", async () => {
    const mockProvider = {
      id: 1,
      name: "OpenAI",
      slug: "openai",
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.mocked(updateProviderConfig).mockResolvedValue(mockProvider);

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {
            prefixRules: []
          }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.provider).toBeDefined();
    expect(data.provider.id).toBe(1);
  });

  test("应该验证前缀规则中的前缀最小长度", async () => {
    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {
            prefixRules: [
              { prefix: "", enabled: true }
            ]
          }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("应该接受可选的前缀规则 note 字段", async () => {
    const mockProvider = {
      id: 1,
      name: "OpenAI",
      slug: "openai",
      config: {
        prefixRules: [
          { prefix: "gpt-4", enabled: true, note: "Latest model" }
        ]
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.mocked(updateProviderConfig).mockResolvedValue(mockProvider);

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {
            prefixRules: [
              { prefix: "gpt-4", enabled: true, note: "Latest model" }
            ]
          }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.provider).toBeDefined();
    expect(data.provider.config.prefixRules[0].note).toBe("Latest model");
  });

  test("应该接受可选的前缀规则 priority 字段", async () => {
    const mockProvider = {
      id: 1,
      name: "OpenAI",
      slug: "openai",
      config: {
        prefixRules: [
          { prefix: "gpt-4", enabled: true, priority: 1 }
        ]
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.mocked(updateProviderConfig).mockResolvedValue(mockProvider);

    const response = await PATCH(
      new Request("https://example.com/api/admin/providers", {
        method: "PATCH",
        body: JSON.stringify({
          providerId: 1,
          config: {
            prefixRules: [
              { prefix: "gpt-4", enabled: true, priority: 1 }
            ]
          }
        }),
        headers: { "Content-Type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.provider).toBeDefined();
    expect(data.provider.config.prefixRules[0].priority).toBe(1);
  });
});
