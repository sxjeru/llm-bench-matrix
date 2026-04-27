import type { ProviderConfig, ProviderConfigPrefixRule } from "@/lib/db/schema";

function normalizeProviderConfigPrefix(prefix: string): string {
  return prefix.trim().toLowerCase();
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function getProviderFallbackBrandColor(providerName: string): string {
  const normalized = providerName.trim().toLowerCase();

  if (normalized.includes("openai") || normalized.includes("gpt")) return "#34d399";
  if (normalized.includes("anthropic") || normalized.includes("claude")) return "#e09a0e";
  if (normalized.includes("google") || normalized.includes("gemini") || normalized.includes("gemma")) return "#4285f4";
  if (normalized.includes("meta") || normalized.includes("llama")) return "#3b82f6";
  if (normalized.includes("qwen") || normalized.includes("alibaba")) return "#a16dfa";
  if (normalized.includes("deepseek")) return "#14b8a6";
  if (normalized.includes("xai") || normalized.includes("grok")) return "#cecece";
  if (normalized.includes("minimax")) return "#ff604a";

  const fallbackPalette = [
    "#f180b9",
    "#ffa98f",
    "#6cc9de"
  ];
  const hash = normalized.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return fallbackPalette[hash % fallbackPalette.length];
}

export function resolveProviderBrandColor(providerName: string | null | undefined, configuredColor?: string | null): string {
  if (configuredColor && isValidHexColor(configuredColor)) {
    return configuredColor.trim().toLowerCase();
  }

  return getProviderFallbackBrandColor(providerName ?? "");
}

export function normalizeProviderConfig(raw: unknown): ProviderConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const input = raw as ProviderConfig;
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const prefixRules = Array.isArray(input.prefixRules)
    ? input.prefixRules
        .filter((item): item is ProviderConfigPrefixRule => Boolean(item && typeof item === "object"))
        .map((item) => {
          const normalizedPrefix = typeof item.prefix === "string" ? item.prefix.trim() : "";
          return {
            prefix: normalizedPrefix,
            enabled: item.enabled !== false,
            ...(typeof item.priority === "number" && Number.isFinite(item.priority)
              ? { priority: Math.trunc(item.priority) }
              : {}),
            ...(typeof item.note === "string" && item.note.trim().length > 0
              ? { note: item.note.trim() }
              : {})
          };
        })
        .filter((item) => item.prefix.length > 0)
    : [];

  const color =
    typeof input.branding?.color === "string" && isValidHexColor(input.branding.color)
      ? input.branding.color.trim().toLowerCase()
      : undefined;

  return {
    ...(displayName ? { displayName } : {}),
    ...(prefixRules.length > 0 ? { prefixRules } : { prefixRules: [] }),
    ...(color ? { branding: { color } } : {})
  };
}

export { normalizeProviderConfigPrefix, isValidHexColor };
