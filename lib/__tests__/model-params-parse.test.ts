import { describe, expect, test } from "vitest";
import { hasParamsSuggestionValue, parseModelParamsFromName } from "@/lib/model-params-parse";

describe("parseModelParamsFromName", () => {
  test("解析 MoE 命名里的激活/总参数量", () => {
    expect(parseModelParamsFromName("Qwen3-235B-A22B")).toEqual({
      totalParamsB: 235,
      activatedParamsB: 22,
      isEstimated: false,
      note: null
    });
  });

  test("激活标记以空格分隔时同样可解析", () => {
    expect(parseModelParamsFromName("Mistral Small 4 119B A7B")).toEqual({
      totalParamsB: 119,
      activatedParamsB: 7,
      isEstimated: false,
      note: null
    });

    expect(parseModelParamsFromName("Nemotron 3 Super 120B A12B (Non-Reasoning)")).toEqual({
      totalParamsB: 120,
      activatedParamsB: 12,
      isEstimated: false,
      note: null
    });
  });

  test("稠密模型只解析出总参数量", () => {
    expect(parseModelParamsFromName("GPT-OSS-120B")).toEqual({
      totalParamsB: 120,
      activatedParamsB: null,
      isEstimated: false,
      note: null
    });

    expect(parseModelParamsFromName("Gemma 3 27B (no think)")).toEqual({
      totalParamsB: 27,
      activatedParamsB: null,
      isEstimated: false,
      note: null
    });
  });

  test("E 前缀标记为估算值", () => {
    expect(parseModelParamsFromName("Gemma 4 E4B")).toEqual({
      totalParamsB: 4,
      activatedParamsB: null,
      isEstimated: true,
      note: null
    });
  });

  test("版本号不会被误认成参数量", () => {
    expect(parseModelParamsFromName("Ministral-3-14B-Reasoning-2512")?.totalParamsB).toBe(14);
    expect(parseModelParamsFromName("Olmo-3-7B-Think")?.totalParamsB).toBe(7);
    expect(parseModelParamsFromName("Mistral Medium 3.5 128B")?.totalParamsB).toBe(128);
  });

  test("小数规模可解析", () => {
    expect(parseModelParamsFromName("Qwen2.5-1.5B-Instruct")).toEqual({
      totalParamsB: 1.5,
      activatedParamsB: null,
      isEstimated: false,
      note: null
    });
  });

  test("多个规模标记时取最大值作为总参数量", () => {
    expect(parseModelParamsFromName("Nemotron-3-Nano-30B-A3B")).toEqual({
      totalParamsB: 30,
      activatedParamsB: 3,
      isEstimated: false,
      note: null
    });
  });

  test("NxM 专家布局只给备注，不猜测数值", () => {
    const parsed = parseModelParamsFromName("Mixtral-8x22B");
    expect(parsed?.totalParamsB).toBeNull();
    expect(parsed?.activatedParamsB).toBeNull();
    expect(parsed?.note).toContain("8x22B");
  });

  test("激活值大于总参数量时丢弃激活值", () => {
    expect(parseModelParamsFromName("Weird-7B-A30B")).toEqual({
      totalParamsB: 7,
      activatedParamsB: null,
      isEstimated: false,
      note: null
    });
  });

  test("闭源模型名无规模标记时返回 null", () => {
    expect(parseModelParamsFromName("Claude Opus 4.5")).toBeNull();
    expect(parseModelParamsFromName("DeepSeek-V3.2")).toBeNull();
    expect(parseModelParamsFromName("Command A+")).toBeNull();
    expect(parseModelParamsFromName("   ")).toBeNull();
  });

  test("重复调用结果稳定（全局正则不会串状态）", () => {
    const first = parseModelParamsFromName("GPT-OSS-120B");
    const second = parseModelParamsFromName("GPT-OSS-120B");
    expect(second).toEqual(first);
  });
});

describe("hasParamsSuggestionValue", () => {
  test("只有 note 的建议不算可采纳", () => {
    expect(hasParamsSuggestionValue(parseModelParamsFromName("Mixtral-8x22B"))).toBe(false);
    expect(hasParamsSuggestionValue(parseModelParamsFromName("Claude Opus 4.5"))).toBe(false);
    expect(hasParamsSuggestionValue(parseModelParamsFromName("GPT-OSS-120B"))).toBe(true);
  });
});
