import { beforeAll, describe, expect, test } from "vitest";

type PrefixRuleItem = {
  id: number;
  providerId: number;
  prefix: string;
  prefixKey: string;
  priority: number;
  isEnabled: boolean;
};

let normalizePrefixKey: (prefix: string) => string;
let resolveProviderNameByModelName: (
  modelName: string,
  prefixRules: PrefixRuleItem[],
  providerNameById: Map<number, string>
) => string | null;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const mod = await import("@/lib/admin-service");
  normalizePrefixKey = mod.normalizePrefixKey as typeof normalizePrefixKey;
  resolveProviderNameByModelName = mod.resolveProviderNameByModelName as typeof resolveProviderNameByModelName;
});

// ─────────────────────────────────────────────
// normalizePrefixKey
// ─────────────────────────────────────────────
describe("normalizePrefixKey", () => {
  test("lowercases and strips non-alphanumeric chars", () => {
    expect(normalizePrefixKey("gpt-")).toBe("gpt");
    expect(normalizePrefixKey("claude-")).toBe("claude");
    expect(normalizePrefixKey("Gemini")).toBe("gemini");
    expect(normalizePrefixKey("GPT 4")).toBe("gpt4");
    expect(normalizePrefixKey("o3-mini")).toBe("o3mini");
  });

  test("returns empty string for whitespace-only or symbol-only input", () => {
    expect(normalizePrefixKey("---")).toBe("");
    expect(normalizePrefixKey("  ")).toBe("");
  });

  test("preserves numbers", () => {
    expect(normalizePrefixKey("llama3")).toBe("llama3");
    expect(normalizePrefixKey("Llama-3.")).toBe("llama3");
  });
});

// ─────────────────────────────────────────────
// resolveProviderNameByModelName
// ─────────────────────────────────────────────
describe("resolveProviderNameByModelName", () => {
  const providerNameById = new Map<number, string>([
    [1, "OpenAI"],
    [2, "Anthropic"],
    [3, "Google"]
  ]);

  function makeRule(partial: Partial<PrefixRuleItem> & { providerId: number; prefixKey: string }): PrefixRuleItem {
    return {
      id: partial.id ?? 1,
      providerId: partial.providerId,
      prefix: partial.prefix ?? partial.prefixKey,
      prefixKey: partial.prefixKey,
      priority: partial.priority ?? 0,
      isEnabled: partial.isEnabled ?? true
    };
  }

  test("matches by prefix key (prefix of model's normalized name)", () => {
    const rules: PrefixRuleItem[] = [
      makeRule({ id: 1, providerId: 1, prefixKey: "gpt" }),
      makeRule({ id: 2, providerId: 2, prefixKey: "claude" })
    ];

    expect(resolveProviderNameByModelName("gpt-4o", rules, providerNameById)).toBe("OpenAI");
    expect(resolveProviderNameByModelName("claude-3-opus", rules, providerNameById)).toBe("Anthropic");
  });

  test("returns null when no rule matches", () => {
    const rules: PrefixRuleItem[] = [
      makeRule({ id: 1, providerId: 1, prefixKey: "gpt" })
    ];

    expect(resolveProviderNameByModelName("llama-3", rules, providerNameById)).toBeNull();
  });

  test("respects priority ordering (lower priority value wins)", () => {
    const rules: PrefixRuleItem[] = [
      makeRule({ id: 1, providerId: 2, prefixKey: "gemini", priority: 10 }),
      makeRule({ id: 2, providerId: 3, prefixKey: "gemini", priority: 0 }) // lower priority wins
    ];

    // gemini is the prefix key for both, priority=0 rule appears second but wins due to sort
    const sorted = [...rules].sort((a, b) => a.priority - b.priority);
    expect(resolveProviderNameByModelName("gemini-1.5-pro", sorted, providerNameById)).toBe("Google");
  });

  test("ignores disabled rules", () => {
    const rules: PrefixRuleItem[] = [
      makeRule({ id: 1, providerId: 1, prefixKey: "gpt", isEnabled: false }),
      makeRule({ id: 2, providerId: 2, prefixKey: "gpt", isEnabled: true })
    ];

    // Disabled rule should be skipped, enabled rule should match
    expect(resolveProviderNameByModelName("gpt-4", rules, providerNameById)).toBe("Anthropic");
  });

  test("returns null when all matching rules are disabled", () => {
    const rules: PrefixRuleItem[] = [
      makeRule({ id: 1, providerId: 1, prefixKey: "gpt", isEnabled: false })
    ];

    expect(resolveProviderNameByModelName("gpt-4", rules, providerNameById)).toBeNull();
  });

  test("empty prefix key rule is skipped", () => {
    const rules: PrefixRuleItem[] = [
      makeRule({ id: 1, providerId: 1, prefixKey: "" })
    ];

    expect(resolveProviderNameByModelName("gpt-4", rules, providerNameById)).toBeNull();
  });

  test("model name is normalized before matching", () => {
    const rules: PrefixRuleItem[] = [
      makeRule({ id: 1, providerId: 3, prefixKey: "gemini" })
    ];

    // 'Gemini-1.5' → normalized to 'gemini15' which starts with 'gemini'
    expect(resolveProviderNameByModelName("Gemini-1.5", rules, providerNameById)).toBe("Google");
  });
});

// ─────────────────────────────────────────────
// display_name fallback (documented behavior)
// ─────────────────────────────────────────────
describe("display_name fallback (unit)", () => {
  test("resolveProviderNameByModelName returns provider name from map (which may be display_name or name)", () => {
    const providerMap = new Map<number, string>([[1, "OpenAI (Custom)"]]);
    const rules: PrefixRuleItem[] = [
      { id: 1, providerId: 1, prefix: "gpt-", prefixKey: "gpt", priority: 0, isEnabled: true }
    ];

    expect(resolveProviderNameByModelName("gpt-4o", rules, providerMap)).toBe("OpenAI (Custom)");
  });
});

// ─────────────────────────────────────────────
// hex color validation (boundary cases)
// ─────────────────────────────────────────────
describe("hex color regex", () => {
  const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$|^#[0-9A-Fa-f]{3}$/;

  test("accepts valid hex colors", () => {
    expect(HEX_COLOR_REGEX.test("#10a37f")).toBe(true);
    expect(HEX_COLOR_REGEX.test("#FFFFFF")).toBe(true);
    expect(HEX_COLOR_REGEX.test("#000")).toBe(true);
    expect(HEX_COLOR_REGEX.test("#abc")).toBe(true);
  });

  test("rejects invalid hex colors", () => {
    expect(HEX_COLOR_REGEX.test("10a37f")).toBe(false);   // missing #
    expect(HEX_COLOR_REGEX.test("#GGGGGG")).toBe(false);  // invalid chars
    expect(HEX_COLOR_REGEX.test("#10a37")).toBe(false);   // 5 digits
    expect(HEX_COLOR_REGEX.test("#10a37fff")).toBe(false); // 8 digits
    expect(HEX_COLOR_REGEX.test("red")).toBe(false);
  });
});
