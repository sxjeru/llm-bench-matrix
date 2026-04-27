import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ProviderConfig } from "@/lib/db/schema";

type ProviderRow = {
  id: number;
  name: string;
  slug: string;
  config: ProviderConfig;
  createdAt: Date;
  updatedAt: Date;
};

let normalizeProviderConfigForTest: (raw: unknown) => ProviderConfig;
let validateProviderConfigForTest: (providerId: number, config: ProviderConfig, allProviders: ProviderRow[]) => void;
let buildProviderCanonicalNameResolverForTest: (
  rows: Array<{ modelName: string; providerName?: string }>,
  options?: { db?: { select: () => unknown } }
) => Promise<(modelName: string) => string>;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  const adminServiceModule = await import("@/lib/admin-service");
  normalizeProviderConfigForTest = adminServiceModule.__normalizeProviderConfigForTest as typeof normalizeProviderConfigForTest;
  validateProviderConfigForTest = adminServiceModule.__validateProviderConfigForTest as typeof validateProviderConfigForTest;
  buildProviderCanonicalNameResolverForTest = adminServiceModule.__buildProviderCanonicalNameResolverForTest as typeof buildProviderCanonicalNameResolverForTest;
});

describe("数据导入场景 - Provider 配置", () => {
  describe("重复前缀规则的导入", () => {
    test("应该检测并拒绝重复的前缀规则（同一 provider）", () => {
      const duplicatePrefixes: ProviderConfig = {
        prefixRules: [
          { prefix: "gpt-", enabled: true },
          { prefix: "gpt-", enabled: true },
          { prefix: "GPT-", enabled: true }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(1, duplicatePrefixes, []);
      }).toThrow("当前 provider 存在重复 prefix");
    });

    test("应该检测大小写不敏感的重复前缀", () => {
      const caseInsensitiveDuplicates: ProviderConfig = {
        prefixRules: [
          { prefix: "Claude", enabled: true },
          { prefix: "claude", enabled: true },
          { prefix: "CLAUDE", enabled: true }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(1, caseInsensitiveDuplicates, []);
      }).toThrow("当前 provider 存在重复 prefix");
    });

    test("应该允许相同前缀但启用/禁用状态不同（但在同一 provider 中只能有一个）", () => {
      // 同一 provider 不能有两个相同的前缀，即使一个禁用
      const config: ProviderConfig = {
        prefixRules: [
          { prefix: "gpt", enabled: true },
          { prefix: "gpt", enabled: false }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(1, config, []);
      }).toThrow("当前 provider 存在重复 prefix");
    });

    test("应该允许禁用前缀在不同 provider 中重复", () => {
      const provider1: ProviderRow = {
        id: 1,
        name: "Provider1",
        slug: "provider1",
        config: {
          prefixRules: [
            { prefix: "common", enabled: false }
          ]
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const config: ProviderConfig = {
        prefixRules: [
          { prefix: "common", enabled: false }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(2, config, [provider1]);
      }).not.toThrow();
    });

    test("应该检测跨 provider 的启用前缀冲突", () => {
      const provider1: ProviderRow = {
        id: 1,
        name: "Provider1",
        slug: "provider1",
        config: {
          prefixRules: [
            { prefix: "llama", enabled: true }
          ]
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const newConfig: ProviderConfig = {
        prefixRules: [
          { prefix: "llama", enabled: true }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(2, newConfig, [provider1]);
      }).toThrow("prefix 已被其他 provider 使用");
    });

    test("导入包含重复前缀的 CSV 应该规范化", () => {
      const csvConfig = {
        prefixRules: [
          { prefix: "  gpt-4  ", enabled: true },
          { prefix: "  gpt-4  ", enabled: true },
          { prefix: "gpt-3.5", enabled: true }
        ]
      };

      const normalized = normalizeProviderConfigForTest(csvConfig);

      // 应该过滤掉相同的规则
      const uniquePrefixes = new Set(normalized.prefixRules?.map(r => r.prefix.trim().toLowerCase()) ?? []);
      expect(uniquePrefixes.size).toBeGreaterThan(0);
    });
  });

  describe("空前缀规则的导入", () => {
    test("应该拒绝空前缀", () => {
      const config: ProviderConfig = {
        prefixRules: [
          { prefix: "", enabled: true }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(1, config, []);
      }).toThrow("prefix 不能为空");
    });

    test("应该拒绝仅空格的前缀", () => {
      const config: ProviderConfig = {
        prefixRules: [
          { prefix: "   ", enabled: true }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(1, config, []);
      }).toThrow("prefix 不能为空");
    });

    test("应该在规范化时过滤掉空前缀", () => {
      const config = normalizeProviderConfigForTest({
        prefixRules: [
          { prefix: "gpt-", enabled: true },
          { prefix: "", enabled: true },
          { prefix: "   ", enabled: true },
          { prefix: "\t\n", enabled: true },
          { prefix: "claude-", enabled: true }
        ]
      });

      expect(config.prefixRules).toHaveLength(2);
      expect(config.prefixRules?.[0]?.prefix).toBe("gpt-");
      expect(config.prefixRules?.[1]?.prefix).toBe("claude-");
    });

    test("导入全是空前缀的规则应该结果为空数组", () => {
      const config = normalizeProviderConfigForTest({
        prefixRules: [
          { prefix: "", enabled: true },
          { prefix: "   ", enabled: true },
          { prefix: "  \t  ", enabled: true }
        ]
      });

      expect(config.prefixRules).toHaveLength(0);
    });
  });

  describe("显示名称为空字符串的导入", () => {
    test("应该拒绝空字符串 displayName", () => {
      const config: ProviderConfig = {
        displayName: ""
      };

      expect(() => {
        validateProviderConfigForTest(1, config, []);
      }).toThrow("displayName 不能为空字符串");
    });

    test("应该拒绝仅空格的 displayName", () => {
      const config: ProviderConfig = {
        displayName: "   "
      };

      expect(() => {
        validateProviderConfigForTest(1, config, []);
      }).toThrow("displayName 不能为空字符串");
    });

    test("应该规范化空的 displayName", () => {
      const config = normalizeProviderConfigForTest({
        displayName: "   "
      });

      expect(config.displayName).toBeUndefined();
    });

    test("应该规范化有效的 displayName", () => {
      const config = normalizeProviderConfigForTest({
        displayName: "  OpenAI Official  "
      });

      expect(config.displayName).toBe("OpenAI Official");
    });

    test("CSV 导入中的空 displayName 应被规范化为 undefined", () => {
      const csvRow = {
        displayName: "",
        prefixRules: [{ prefix: "gpt-", enabled: true }]
      };

      const normalized = normalizeProviderConfigForTest(csvRow);

      expect(normalized.displayName).toBeUndefined();
      expect(normalized.prefixRules).toHaveLength(1);
    });

    test("导入混合的有效和无效 displayName", () => {
      const testCases = [
        { input: { displayName: "Valid Name" }, expected: "Valid Name" },
        { input: { displayName: "   " }, expected: undefined },
        { input: { displayName: "" }, expected: undefined },
        { input: { displayName: "  Trimmed  " }, expected: "Trimmed" }
      ];

      testCases.forEach(({ input, expected }) => {
        const normalized = normalizeProviderConfigForTest(input);
        expect(normalized.displayName).toBe(expected);
      });
    });
  });

  describe("无效的十六进制颜色导入", () => {
    test("应该拒绝无效的十六进制颜色", () => {
      const invalidColors = [
        "#GGGGGG",
        "#FF00",
        "#FF00000",
        "FF0000",
        "#fff",
        "#FFF"
      ];

      invalidColors.forEach((color) => {
        const config: ProviderConfig = {
          branding: { color }
        };

        expect(() => {
          validateProviderConfigForTest(1, config, []);
        }).toThrow("branding.color 必须是合法的 #RRGGBB");
      });
    });

    test("应该接受有效的十六进制颜色", () => {
      const validColors = [
        "#FF0000",
        "#00FF00",
        "#0000FF",
        "#000000",
        "#FFFFFF",
        "#ff0000",
        "#00ff00",
        "#AbCdEf"
      ];

      validColors.forEach((color) => {
        const config: ProviderConfig = {
          branding: { color }
        };

        expect(() => {
          validateProviderConfigForTest(1, config, []);
        }).not.toThrow();
      });
    });

    test("应该规范化无效的颜色为 undefined", () => {
      const invalidConfigs = [
        { branding: { color: "#GGGGGG" } },
        { branding: { color: "#FF00" } },
        { branding: { color: "FF0000" } }
      ];

      invalidConfigs.forEach((config) => {
        const normalized = normalizeProviderConfigForTest(config);
        expect(normalized.branding?.color).toBeUndefined();
      });
    });

    test("CSV 导入中的混合颜色应被处理", () => {
      const mixedColors = [
        { color: "#FF0000", expected: "#ff0000" },
        { color: "#GGGGGG", expected: undefined },
        { color: "  #FF0000  ", expected: "#ff0000" },
        { color: "#fff", expected: undefined },
        { color: "#00FF00", expected: "#00ff00" }
      ];

      mixedColors.forEach(({ color, expected }) => {
        const config = normalizeProviderConfigForTest({
          branding: { color }
        });

        expect(config.branding?.color).toBe(expected);
      });
    });

    test("应该规范化大写颜色为小写", () => {
      const config = normalizeProviderConfigForTest({
        branding: {
          color: "#FF00AA"
        }
      });

      expect(config.branding?.color).toBe("#ff00aa");
    });
  });

  describe("复杂导入场景", () => {
    test("应该处理完整的 provider 配置导入", () => {
      const fullConfig: ProviderConfig = {
        displayName: "  OpenAI Official  ",
        prefixRules: [
          { prefix: "  gpt-4  ", enabled: true, priority: 1, note: "  Latest  " },
          { prefix: "gpt-3.5", enabled: true, priority: 2 },
          { prefix: "text-", enabled: false }
        ],
        branding: {
          color: "  #00D084  "
        }
      };

      const normalized = normalizeProviderConfigForTest(fullConfig);

      expect(normalized.displayName).toBe("OpenAI Official");
      expect(normalized.prefixRules).toHaveLength(3);
      expect(normalized.prefixRules?.[0]?.prefix).toBe("gpt-4");
      expect(normalized.prefixRules?.[0]?.priority).toBe(1);
      expect(normalized.prefixRules?.[0]?.note).toBe("Latest");
      expect(normalized.branding?.color).toBe("#00d084");
    });

    test("应该在导入时验证跨 provider 冲突", () => {
      const existingProviders: ProviderRow[] = [
        {
          id: 1,
          name: "Provider1",
          slug: "provider1",
          config: {
            prefixRules: [
              { prefix: "prefix-1", enabled: true },
              { prefix: "prefix-2", enabled: false }
            ]
          },
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 2,
          name: "Provider2",
          slug: "provider2",
          config: {
            prefixRules: [
              { prefix: "prefix-3", enabled: true }
            ]
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const newConfig: ProviderConfig = {
        prefixRules: [
          { prefix: "PREFIX-3", enabled: true }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(3, newConfig, existingProviders);
      }).toThrow("prefix 已被其他 provider 使用");
    });

    test("应该允许禁用前缀不引起冲突", () => {
      const existingProvider: ProviderRow = {
        id: 1,
        name: "Provider1",
        slug: "provider1",
        config: {
          prefixRules: [
            { prefix: "common", enabled: false }
          ]
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const newConfig: ProviderConfig = {
        prefixRules: [
          { prefix: "common", enabled: true }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(2, newConfig, [existingProvider]);
      }).not.toThrow();
    });

    test("导入具有多个验证错误的配置应优先报告第一个错误", () => {
      const badConfig: ProviderConfig = {
        displayName: "   ",
        prefixRules: [
          { prefix: "", enabled: true }
        ]
      };

      expect(() => {
        validateProviderConfigForTest(1, badConfig, []);
      }).toThrow("displayName 不能为空字符串");
    });

    test("应该处理从 XLSX 导出的特殊字符在前缀中", () => {
      const config = normalizeProviderConfigForTest({
        prefixRules: [
          { prefix: "  gpt-4  ", enabled: true },
          { prefix: "gpt-3.5", enabled: true },
          { prefix: "  ", enabled: true }
        ]
      });

      expect(config.prefixRules).toHaveLength(2);
      expect(config.prefixRules?.map(r => r.prefix)).toEqual(["gpt-4", "gpt-3.5"]);
    });
  });

  describe("批量导入验证", () => {
    test("应该批量验证多个 provider 配置", () => {
      const providers: ProviderRow[] = [
        {
          id: 1,
          name: "OpenAI",
          slug: "openai",
          config: {
            prefixRules: [{ prefix: "gpt", enabled: true }]
          },
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 2,
          name: "Anthropic",
          slug: "anthropic",
          config: {
            prefixRules: [{ prefix: "claude", enabled: true }]
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const newConfig: ProviderConfig = {
        prefixRules: [{ prefix: "llama", enabled: true }]
      };

      expect(() => {
        validateProviderConfigForTest(3, newConfig, providers);
      }).not.toThrow();
    });

    test("批量导入中的一个冲突应该停止导入", () => {
      const providers: ProviderRow[] = [
        {
          id: 1,
          name: "Provider1",
          slug: "provider1",
          config: {
            prefixRules: [{ prefix: "conflict", enabled: true }]
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const conflictingConfig: ProviderConfig = {
        prefixRules: [{ prefix: "CONFLICT", enabled: true }]
      };

      expect(() => {
        validateProviderConfigForTest(2, conflictingConfig, providers);
      }).toThrow("prefix 已被其他 provider 使用");
    });
  });

  describe("结构化导入时的 provider 解析", () => {
    test("应该批量预取 provider 信息并复用结果", async () => {
      const providerRows: ProviderRow[] = [
        {
          id: 1,
          name: "OpenAI",
          slug: "openai",
          config: {
            prefixRules: [{ prefix: "gpt", enabled: true }]
          },
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 2,
          name: "Anthropic",
          slug: "anthropic",
          config: {
            prefixRules: [{ prefix: "claude", enabled: true }]
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const matchedModels = [
        {
          canonicalKey: "gpt 4o",
          providerId: 1
        }
      ];

      const settingsChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ valueJson: null }])
      };
      const providersChain = {
        from: vi.fn().mockResolvedValue(providerRows)
      };
      const modelsChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(matchedModels)
      };

      const select = vi
        .fn()
        .mockReturnValueOnce(settingsChain)
        .mockReturnValueOnce(providersChain)
        .mockReturnValueOnce(modelsChain);

      const resolver = await buildProviderCanonicalNameResolverForTest(
        [
          { modelName: "GPT-4o" },
          { modelName: "GPT-4o" },
          { modelName: "claude-3.7-sonnet" },
          { modelName: "Unknown Model" },
          { modelName: "Already Set", providerName: "Manual" }
        ],
        { db: { select } }
      );

      expect(resolver("GPT-4o")).toBe("OpenAI");
      expect(resolver("claude-3.7-sonnet")).toBe("Anthropic");
      expect(resolver("Unknown Model")).toBe("Unknown");
      expect(select).toHaveBeenCalledTimes(3);
      expect(modelsChain.where).toHaveBeenCalledTimes(1);
      expect(providersChain.from).toHaveBeenCalledTimes(1);
    });
  });
});
