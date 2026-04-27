import { beforeAll, describe, expect, test } from "vitest";
import type { ProviderConfig } from "@/lib/db/schema";
import { providers } from "@/lib/db/schema";

let normalizeProviderConfigForTest: (raw: unknown) => ProviderConfig;
let validateProviderConfigForTest: (
  providerId: number,
  config: ProviderConfig,
  allProviders: Array<typeof providers.$inferSelect>
) => void;
let mergeProviderConfigForTest: (current: ProviderConfig, incoming: unknown) => ProviderConfig;
let resolveProviderBrandColorForTest: (providerName: string | null | undefined, configuredColor?: string | null) => string;

// Helper to create mock provider objects
function mockProvider(
  id: number,
  name: string,
  config: ProviderConfig = {}
): typeof providers.$inferSelect {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    config,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  const adminServiceModule = await import("@/lib/admin-service");
  const providerConfigModule = await import("@/lib/provider-config");
  normalizeProviderConfigForTest = adminServiceModule.__normalizeProviderConfigForTest;
  validateProviderConfigForTest = adminServiceModule.__validateProviderConfigForTest;
  mergeProviderConfigForTest = adminServiceModule.__mergeProviderConfigForTest;
  resolveProviderBrandColorForTest = providerConfigModule.resolveProviderBrandColor;
});

describe("normalizeProviderConfig", () => {
  test("应该保留有效的 displayName", () => {
    const config = normalizeProviderConfigForTest({
      displayName: "  OpenAI  "
    });
    expect(config.displayName).toBe("OpenAI");
  });

  test("应该删除空 displayName", () => {
    const config = normalizeProviderConfigForTest({
      displayName: "   "
    });
    expect(config.displayName).toBeUndefined();
  });

  test("应该处理非对象输入", () => {
    expect(normalizeProviderConfigForTest(null)).toEqual({});
    expect(normalizeProviderConfigForTest(undefined)).toEqual({});
    expect(normalizeProviderConfigForTest("string")).toEqual({});
    expect(normalizeProviderConfigForTest([])).toEqual({});
  });

  test("应该正确规范化前缀规则", () => {
    const config = normalizeProviderConfigForTest({
      prefixRules: [
        {
          prefix: "  gpt-  ",
          enabled: true,
          note: "  OpenAI models  "
        }
      ]
    });

    expect(config.prefixRules).toHaveLength(1);
    expect(config.prefixRules?.[0].prefix).toBe("gpt-");
    expect(config.prefixRules?.[0].enabled).toBe(true);
    expect(config.prefixRules?.[0].note).toBe("OpenAI models");
  });

  test("应该过滤掉空前缀", () => {
    const config = normalizeProviderConfigForTest({
      prefixRules: [
        { prefix: "gpt-", enabled: true },
        { prefix: "   ", enabled: true },
        { prefix: "", enabled: true }
      ]
    });

    expect(config.prefixRules).toHaveLength(1);
    expect(config.prefixRules?.[0].prefix).toBe("gpt-");
  });

  test("应该默认 enabled 为 true", () => {
    const config = normalizeProviderConfigForTest({
      prefixRules: [
        { prefix: "gpt-", enabled: false },
        { prefix: "claude-", enabled: true },
        { prefix: "gemini-" } as { prefix: string }
      ]
    });

    expect(config.prefixRules?.[0].enabled).toBe(false);
    expect(config.prefixRules?.[1].enabled).toBe(true);
    expect(config.prefixRules?.[2].enabled).toBe(true);
  });

  test("应该验证和规范化十六进制颜色", () => {
    const validConfigs = [
      { branding: { color: "#FF0000" } },
      { branding: { color: "#ff0000" } },
      { branding: { color: "  #00FF00  " } }
    ];

    validConfigs.forEach((input) => {
      const config = normalizeProviderConfigForTest(input);
      expect(config.branding?.color).toBeDefined();
      expect(config.branding?.color).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  test("应该过滤掉无效的十六进制颜色", () => {
    const invalidConfigs = [
      { branding: { color: "#GGGGGG" } },
      { branding: { color: "#FF00" } },
      { branding: { color: "FF0000" } },
      { branding: { color: "#FF000000" } }
    ];

    invalidConfigs.forEach((input) => {
      const config = normalizeProviderConfigForTest(input);
      expect(config.branding?.color).toBeUndefined();
    });
  });

  test("应该保留有效的 priority 作为整数", () => {
    const config = normalizeProviderConfigForTest({
      prefixRules: [
        { prefix: "gpt-", enabled: true, priority: 10.7 },
        { prefix: "claude-", enabled: true, priority: Infinity }
      ]
    });

    expect(config.prefixRules?.[0].priority).toBe(10);
    expect(config.prefixRules?.[1].priority).toBeUndefined();
  });

  test("应该忽略无效的 note", () => {
    const config = normalizeProviderConfigForTest({
      prefixRules: [
        { prefix: "gpt-", enabled: true, note: "   " },
        { prefix: "claude-", enabled: true, note: "Anthropic" }
      ]
    });

    expect(config.prefixRules?.[0].note).toBeUndefined();
    expect(config.prefixRules?.[1].note).toBe("Anthropic");
  });
});

describe("validateProviderConfig", () => {
  test("应该拒绝空 displayName", () => {
    const config: ProviderConfig = { displayName: "   " };
    const allProviders = [mockProvider(1, "OpenAI")];

    expect(() => {
      validateProviderConfigForTest(1, config, allProviders);
    }).toThrow("displayName 不能为空字符串");
  });

  test("应该拒绝空前缀", () => {
    const config: ProviderConfig = {
      prefixRules: [{ prefix: "   ", enabled: true }]
    };
    const allProviders = [mockProvider(1, "OpenAI")];

    expect(() => {
      validateProviderConfigForTest(1, config, allProviders);
    }).toThrow("prefix 不能为空");
  });

  test("应该拒绝重复的前缀规则（同一 provider）", () => {
    const config: ProviderConfig = {
      prefixRules: [
        { prefix: "GPT-", enabled: true },
        { prefix: "gpt-", enabled: true }
      ]
    };
    const allProviders = [mockProvider(1, "OpenAI")];

    expect(() => {
      validateProviderConfigForTest(1, config, allProviders);
    }).toThrow("当前 provider 存在重复 prefix");
  });

  test("应该拒绝无效的十六进制颜色", () => {
    const config: ProviderConfig = {
      branding: { color: "#GGGGGG" }
    };
    const allProviders = [mockProvider(1, "OpenAI")];

    expect(() => {
      validateProviderConfigForTest(1, config, allProviders);
    }).toThrow("branding.color 必须是合法的 #RRGGBB");
  });

  test("应该检测前缀冲突（跨 provider）- 已启用的规则", () => {
    const config: ProviderConfig = {
      prefixRules: [{ prefix: "gpt-", enabled: true }]
    };

    const allProviders = [
      mockProvider(1, "OpenAI", {
        prefixRules: [{ prefix: "GPT-", enabled: true }]
      }),
      mockProvider(2, "Anthropic")
    ];

    expect(() => {
      validateProviderConfigForTest(2, config, allProviders);
    }).toThrow("prefix 已被其他 provider 使用");
  });

  test("应该允许不同 provider 使用相同前缀（当一个禁用时）", () => {
    const config: ProviderConfig = {
      prefixRules: [{ prefix: "gpt-", enabled: true }]
    };

    const allProviders = [
      mockProvider(1, "OpenAI", {
        prefixRules: [{ prefix: "gpt-", enabled: false }]
      }),
      mockProvider(2, "Anthropic")
    ];

    expect(() => {
      validateProviderConfigForTest(2, config, allProviders);
    }).not.toThrow();
  });

  test("应该允许更新 provider 时使用其自己的前缀", () => {
    const config: ProviderConfig = {
      prefixRules: [{ prefix: "gpt-", enabled: true }]
    };

    const allProviders = [
      mockProvider(1, "OpenAI", {
        prefixRules: [{ prefix: "gpt-", enabled: true }]
      })
    ];

    expect(() => {
      validateProviderConfigForTest(1, config, allProviders);
    }).not.toThrow();
  });

  test("应该接受有效的配置", () => {
    const config: ProviderConfig = {
      displayName: "OpenAI Official",
      prefixRules: [
        { prefix: "gpt-", enabled: true, priority: 1 },
        { prefix: "text-", enabled: false, note: "Legacy" }
      ],
      branding: { color: "#00D084" }
    };

    const allProviders = [
      mockProvider(1, "OpenAI"),
      mockProvider(2, "Anthropic", {
        prefixRules: [{ prefix: "claude-", enabled: true }]
      })
    ];

    expect(() => {
      validateProviderConfigForTest(1, config, allProviders);
    }).not.toThrow();
  });
});

describe("prefix rule edge cases", () => {
  test("应该处理大小写不敏感的前缀冲突检测", () => {
    const config: ProviderConfig = {
      prefixRules: [{ prefix: "GPT-4-", enabled: true }]
    };

    const allProviders = [
      mockProvider(1, "OpenAI", {
        prefixRules: [{ prefix: "gpt-4-", enabled: true }]
      }),
      mockProvider(2, "Other")
    ];

    expect(() => {
      validateProviderConfigForTest(2, config, allProviders);
    }).toThrow("prefix 已被其他 provider 使用");
  });

  test("应该处理带有空格的前缀冲突检测", () => {
    const config: ProviderConfig = {
      prefixRules: [{ prefix: "  gpt-  ", enabled: true }]
    };

    const allProviders = [
      mockProvider(1, "OpenAI", {
        prefixRules: [{ prefix: "gpt-", enabled: true }]
      }),
      mockProvider(2, "Other")
    ];

    expect(() => {
      validateProviderConfigForTest(2, config, allProviders);
    }).toThrow("prefix 已被其他 provider 使用");
  });

  test("应该允许多个 provider 的禁用规则", () => {
    const config: ProviderConfig = {
      prefixRules: [{ prefix: "gpt-", enabled: false }]
    };

    const allProviders = [
      mockProvider(1, "OpenAI1", {
        prefixRules: [{ prefix: "gpt-", enabled: false }]
      }),
      mockProvider(2, "OpenAI2", {
        prefixRules: [{ prefix: "gpt-", enabled: false }]
      })
    ];

    expect(() => {
      validateProviderConfigForTest(3, config, allProviders);
    }).not.toThrow();
  });
});

describe("color validation edge cases", () => {
  test("应该接受大写的十六进制颜色", () => {
    const config = normalizeProviderConfigForTest({
      branding: { color: "#FF00FF" }
    });
    expect(config.branding?.color).toBe("#ff00ff");
  });

  test("应该拒绝三位十六进制颜色", () => {
    const config = normalizeProviderConfigForTest({
      branding: { color: "#F0F" }
    });
    expect(config.branding?.color).toBeUndefined();
  });

  test("应该拒绝没有井号的十六进制颜色", () => {
    const config = normalizeProviderConfigForTest({
      branding: { color: "FF0000" }
    });
    expect(config.branding?.color).toBeUndefined();
  });

  test("应该拒绝超过六位的十六进制颜色", () => {
    const config = normalizeProviderConfigForTest({
      branding: { color: "#FF00000" }
    });
    expect(config.branding?.color).toBeUndefined();
  });

  test("品牌色未配置时应按 provider 名回退到稳定颜色", () => {
    expect(resolveProviderBrandColorForTest("OpenAI")).toBe("#34d399");
    expect(resolveProviderBrandColorForTest("Google")).toBe("#4285f4");
    expect(resolveProviderBrandColorForTest("Some New Provider")).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("品牌色已配置时应优先使用配置色", () => {
    expect(resolveProviderBrandColorForTest("OpenAI", "#ABCDEF")).toBe("#abcdef");
  });
});

describe("provider config patch merge", () => {
  test("应该在只更新 branding 时保留已有 displayName 和 prefixRules", () => {
    const merged = mergeProviderConfigForTest(
      {
        displayName: "OpenAI",
        prefixRules: [{ prefix: "gpt-", enabled: true }],
        branding: { color: "#00d084" }
      },
      {
        branding: { color: "#ff0000" }
      }
    );

    expect(merged.displayName).toBe("OpenAI");
    expect(merged.prefixRules).toEqual([{ prefix: "gpt-", enabled: true }]);
    expect(merged.branding?.color).toBe("#ff0000");
  });

  test("应该在只更新 displayName 时保留已有 branding", () => {
    const merged = mergeProviderConfigForTest(
      {
        displayName: "OpenAI",
        branding: { color: "#00d084" }
      },
      {
        displayName: "OpenAI Official"
      }
    );

    expect(merged.displayName).toBe("OpenAI Official");
    expect(merged.branding?.color).toBe("#00d084");
  });

  test("应该在显式传入 prefixRules 时替换原有 prefixRules", () => {
    const merged = mergeProviderConfigForTest(
      {
        prefixRules: [{ prefix: "gpt-", enabled: true }]
      },
      {
        prefixRules: [{ prefix: "o1-", enabled: true }]
      }
    );

    expect(merged.prefixRules).toEqual([{ prefix: "o1-", enabled: true }]);
  });

  test("应该在 displayName=null 时清空 displayName 覆盖值", () => {
    const merged = mergeProviderConfigForTest(
      {
        displayName: "OpenAI",
        prefixRules: [{ prefix: "gpt-", enabled: true }],
        branding: { color: "#00d084" }
      },
      {
        displayName: null
      }
    );

    expect(merged.displayName).toBeUndefined();
    expect(merged.prefixRules).toEqual([{ prefix: "gpt-", enabled: true }]);
    expect(merged.branding?.color).toBe("#00d084");
  });

  test("应该在 branding.color=null 时清空品牌色覆盖值", () => {
    const merged = mergeProviderConfigForTest(
      {
        displayName: "OpenAI",
        prefixRules: [{ prefix: "gpt-", enabled: true }],
        branding: { color: "#00d084" }
      },
      {
        branding: { color: null }
      }
    );

    expect(merged.displayName).toBe("OpenAI");
    expect(merged.prefixRules).toEqual([{ prefix: "gpt-", enabled: true }]);
    expect(merged.branding).toBeUndefined();
  });
});
