import type { ProviderConfigDraft, ProviderOption } from "../types";

export function getProviderOptionLabel(provider: ProviderOption) {
  const displayName = provider.config?.displayName?.trim();
  if (displayName && displayName.toLowerCase() !== provider.name.toLowerCase()) {
    return `${displayName} (${provider.name})`;
  }

  return provider.name;
}

export function createProviderPrefixRuleDraft(rule?: {
  prefix?: string;
  enabled?: boolean;
  priority?: number;
  note?: string;
}): ProviderConfigDraft["prefixRules"][number] {
  return {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `prefix-rule-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    prefix: rule?.prefix ?? "",
    enabled: rule?.enabled !== false,
    ...(typeof rule?.priority === "number" && Number.isFinite(rule.priority)
      ? { priority: Math.trunc(rule.priority) }
      : {}),
    ...(typeof rule?.note === "string" && rule.note.trim().length > 0
      ? { note: rule.note.trim() }
      : {})
  };
}

export function toProviderConfigDraft(provider: ProviderOption): ProviderConfigDraft {
  return {
    displayName: provider.config?.displayName ?? "",
    displayTargetProviderId: provider.config?.displayTargetProviderId ?? null,
    prefixRules: (provider.config?.prefixRules ?? []).map((rule) => createProviderPrefixRuleDraft(rule)),
    brandingColor: provider.config?.branding?.color ?? "",
    modelsDevProviderId: provider.config?.pricing?.modelsDevProviderId ?? "",
    modelsDevProviderAliases: (provider.config?.pricing?.modelsDevProviderAliases ?? []).join(", "),
    pricingDisabled: provider.config?.pricing?.disabled === true
  };
}

export function isProviderOption(value: unknown): value is ProviderOption {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { id?: unknown }).id === "number"
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { slug?: unknown }).slug === "string"
  );
}

export function inferProviderNameFromModelName(modelName: string): string {
  const trimmed = modelName.trim();
  if (!trimmed) return "Unknown";

  const alphaPrefix = trimmed.match(/^[A-Za-z]+/);
  if (alphaPrefix?.[0]) {
    return alphaPrefix[0];
  }

  const tokenized = trimmed.split(/[\s\-_:]/).map((item) => item.trim()).filter(Boolean);
  if (tokenized.length > 0) {
    return tokenized[0];
  }

  return "Unknown";
}

export function resolveProviderFromConfig(
  modelName: string,
  providers: ProviderOption[]
): { providerName: string; providerDisplayName: string } | null {
  const normalizedModelName = modelName.trim().toLowerCase();
  if (!normalizedModelName) return null;

  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  let matched: { providerName: string; providerDisplayName: string; prefixLength: number } | null = null;

  for (const provider of providers) {
    for (const rule of provider.config?.prefixRules ?? []) {
      const normalizedPrefix = rule.prefix.trim().toLowerCase();
      if (!rule.enabled || !normalizedPrefix) continue;
      if (!normalizedModelName.startsWith(normalizedPrefix)) continue;

      if (!matched || normalizedPrefix.length > matched.prefixLength) {
        const displayTargetProvider = typeof provider.config?.displayTargetProviderId === "number"
          ? providerById.get(provider.config.displayTargetProviderId) ?? null
          : null;

        matched = {
          providerName: displayTargetProvider?.name || provider.name,
          providerDisplayName: displayTargetProvider?.config?.displayName?.trim()
            || provider.config?.displayName?.trim()
            || displayTargetProvider?.name
            || provider.name,
          prefixLength: normalizedPrefix.length
        };
      }
    }
  }

  return matched
    ? {
        providerName: matched.providerName,
        providerDisplayName: matched.providerDisplayName
      }
    : null;
}

export function getProviderDisplayNameById(providerId: number, providerById: Map<number, ProviderOption>): string | null {
  const provider = providerById.get(providerId);
  if (!provider) return null;

  const displayTargetProvider = typeof provider.config?.displayTargetProviderId === "number"
    ? providerById.get(provider.config.displayTargetProviderId) ?? null
    : null;

  return displayTargetProvider?.config?.displayName?.trim()
    || provider.config?.displayName?.trim()
    || displayTargetProvider?.name
    || provider.name;
}
