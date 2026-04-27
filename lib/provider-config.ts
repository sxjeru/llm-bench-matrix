import type { ProviderConfig, ProviderConfigPrefixRule } from "@/lib/db/schema";

function normalizeProviderConfigPrefix(prefix: string): string {
  return prefix.trim().toLowerCase();
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
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

export { normalizeProviderConfigPrefix };
