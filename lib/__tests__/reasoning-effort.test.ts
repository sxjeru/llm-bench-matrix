import { describe, expect, test } from "vitest";
import {
  parseModelReasoningEffort,
  pickHighestReasoningEffort
} from "@/lib/external-providers/reasoning-effort";

describe("parseModelReasoningEffort", () => {
  test("识别 AA 的裸括号写法", () => {
    expect(parseModelReasoningEffort("Claude Opus 5 (max)")).toEqual({
      base: "Claude Opus 5",
      effort: "max"
    });
    expect(parseModelReasoningEffort("Claude Opus 5 (xhigh)")).toEqual({
      base: "Claude Opus 5",
      effort: "xhigh"
    });
    expect(parseModelReasoningEffort("Sarvam 30B (high)")).toEqual({
      base: "Sarvam 30B",
      effort: "high"
    });
  });

  test("识别 AA 的复合括号写法，取其中最高档", () => {
    expect(parseModelReasoningEffort("Claude Opus 5 (Adaptive Reasoning, Max Effort)")).toEqual({
      base: "Claude Opus 5",
      effort: "max"
    });
    expect(parseModelReasoningEffort("DeepSeek V4 Flash 0731 (Reasoning, Max Effort)")).toEqual({
      base: "DeepSeek V4 Flash 0731",
      effort: "max"
    });
    expect(parseModelReasoningEffort("Claude Opus 5 (Adaptive Reasoning, High Effort)")).toEqual({
      base: "Claude Opus 5",
      effort: "high"
    });
  });

  test("识别关闭推理", () => {
    expect(parseModelReasoningEffort("Gemma 4 E4B (Non-reasoning)")).toEqual({
      base: "Gemma 4 E4B",
      effort: "nonthinking"
    });
    expect(parseModelReasoningEffort("Gemini 2.5 Flash-Lite (Non-reasoning)").effort).toBe("nonthinking");
  });

  test("识别本地库常见的裸尾缀写法", () => {
    expect(parseModelReasoningEffort("GPT 5.4 Xhigh")).toEqual({ base: "GPT 5.4", effort: "xhigh" });
    expect(parseModelReasoningEffort("Gemini 3.1 Pro High")).toEqual({
      base: "Gemini 3.1 Pro",
      effort: "high"
    });
    expect(parseModelReasoningEffort("K2.6 Thinking")).toEqual({ base: "K2.6", effort: "thinking" });
    expect(parseModelReasoningEffort("Grok 4.2 Reasoning")).toEqual({ base: "Grok 4.2", effort: "thinking" });
    expect(parseModelReasoningEffort("kimi-k2-6-thinking")).toEqual({
      base: "kimi-k2-6",
      effort: "thinking"
    });
  });

  test("未标注强度时返回 null，且不动模型名", () => {
    expect(parseModelReasoningEffort("GPT 5.4")).toEqual({ base: "GPT 5.4", effort: null });
    expect(parseModelReasoningEffort("Qwen3.6-Plus")).toEqual({ base: "Qwen3.6-Plus", effort: null });
  });

  test("不含强度信息的括号要原样保留，避免误删版本信息", () => {
    expect(parseModelReasoningEffort("Gemini 1.5 Pro (May)")).toEqual({
      base: "Gemini 1.5 Pro (May)",
      effort: null
    });
    expect(parseModelReasoningEffort("Grok 4.20 0309 (Preview)").base).toBe("Grok 4.20 0309 (Preview)");
  });

  test("叠写的强度标记会一路剥干净并取最高档", () => {
    expect(parseModelReasoningEffort("Claude Opus 5 (Adaptive Reasoning) (max)")).toEqual({
      base: "Claude Opus 5",
      effort: "max"
    });
  });
});

describe("pickHighestReasoningEffort", () => {
  test("按 max > xhigh > high > thinking > medium > low > minimal > nonthinking 排序", () => {
    expect(pickHighestReasoningEffort(["low", "max", "high"])).toBe("max");
    expect(pickHighestReasoningEffort(["high", "xhigh"])).toBe("xhigh");
    expect(pickHighestReasoningEffort(["medium", "thinking"])).toBe("thinking");
    expect(pickHighestReasoningEffort(["nonthinking", "minimal"])).toBe("minimal");
  });

  test("忽略 null，全空返回 null", () => {
    expect(pickHighestReasoningEffort([null, "low", null])).toBe("low");
    expect(pickHighestReasoningEffort([null, null])).toBeNull();
  });
});
