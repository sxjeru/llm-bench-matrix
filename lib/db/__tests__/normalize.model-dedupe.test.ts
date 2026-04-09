import { describe, expect, test } from "vitest";

import {
  buildModelCanonicalKey,
  normalizeModelNameForDedupe,
  type ModelDedupeRule
} from "@/lib/db/normalize";

describe("model dedupe normalization", () => {
  test("Unicode 连字符与 ASCII 连字符生成同一 canonicalKey", () => {
    const ascii = buildModelCanonicalKey("GPT-5.2");
    const unicode = buildModelCanonicalKey("GPT‑5.2");

    expect(unicode).toBe(ascii);
    expect(unicode).toBe("gpt5.2");
  });

  test("关闭 removeHyphen 时仍会先把 Unicode 连字符折叠为 ASCII 连字符", () => {
    const rule: ModelDedupeRule = {
      lowercase: true,
      removeHyphen: false,
      removeSpace: true,
      removeDot: false
    };

    expect(normalizeModelNameForDedupe("GPT‑5.2", rule)).toBe("gpt-5.2");
    expect(normalizeModelNameForDedupe("GPT-5.2", rule)).toBe("gpt-5.2");
  });
});
