import type { ProviderConfig, ProviderConfigPrefixRule } from "@/lib/db/schema";

function normalizeProviderConfigPrefix(prefix: string): string {
  return prefix.trim().toLowerCase();
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance(red: number, green: number, blue: number): number {
  return 0.2126 * srgbToLinear(red) + 0.7152 * srgbToLinear(green) + 0.0722 * srgbToLinear(blue);
}

function getContrastRatio(
  first: readonly [number, number, number],
  second: readonly [number, number, number]
): number {
  const firstLuminance = getRelativeLuminance(first[0], first[1], first[2]);
  const secondLuminance = getRelativeLuminance(second[0], second[1], second[2]);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = value.trim().slice(1);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return [0, 0, lightness];
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return [hue / 6, saturation, lightness];
}

function hueToRgb(p: number, q: number, tInput: number): number {
  let t = tInput;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  if (saturation === 0) {
    const value = lightness * 255;
    return [value, value, value];
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    hueToRgb(p, q, hue + 1 / 3) * 255,
    hueToRgb(p, q, hue) * 255,
    hueToRgb(p, q, hue - 1 / 3) * 255
  ];
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

export function resolveProviderBrandColorForDarkTheme(
  providerName: string | null | undefined,
  configuredColor?: string | null
): string {
  const sourceColor = resolveProviderBrandColor(providerName, configuredColor);
  const rgb = hexToRgb(sourceColor);
  const darkSurface: [number, number, number] = [20, 27, 45];
  const targetContrastRatio = 5;

  if (getContrastRatio(rgb, darkSurface) >= targetContrastRatio) {
    return sourceColor;
  }

  const [hue, saturation, lightness] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const targetSaturation = saturation === 0
    ? 0
    : Math.min(0.88, Math.max(saturation + 0.1, saturation * 1.18));
  const startingLightness = Math.max(lightness, 0.60);

  for (let step = 0; step <= 14; step += 1) {
    const nextLightness = clamp01(startingLightness + step * 0.025);
    const nextRgb = hslToRgb(hue, targetSaturation, nextLightness);
    if (getContrastRatio(nextRgb, darkSurface) >= targetContrastRatio) {
      return rgbToHex(nextRgb[0], nextRgb[1], nextRgb[2]);
    }
  }

  const fallbackRgb = hslToRgb(hue, targetSaturation, 0.82);
  return rgbToHex(fallbackRgb[0], fallbackRgb[1], fallbackRgb[2]);
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

  const pricingRaw = input.pricing && typeof input.pricing === "object" && !Array.isArray(input.pricing)
    ? input.pricing
    : null;
  const modelsDevProviderId = typeof pricingRaw?.modelsDevProviderId === "string"
    ? pricingRaw.modelsDevProviderId.trim()
    : "";
  const modelsDevProviderAliases = Array.isArray(pricingRaw?.modelsDevProviderAliases)
    ? Array.from(new Set(
        pricingRaw.modelsDevProviderAliases
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      ))
    : [];
  const pricing = pricingRaw
    ? {
        ...(modelsDevProviderId ? { modelsDevProviderId } : {}),
        ...(modelsDevProviderAliases.length > 0 ? { modelsDevProviderAliases } : {}),
        ...(pricingRaw.disabled === true ? { disabled: true } : {})
      }
    : undefined;

  return {
    ...(displayName ? { displayName } : {}),
    ...(typeof input.displayTargetProviderId === "number" && Number.isInteger(input.displayTargetProviderId) && input.displayTargetProviderId > 0
      ? { displayTargetProviderId: input.displayTargetProviderId }
      : {}),
    ...(prefixRules.length > 0 ? { prefixRules } : { prefixRules: [] }),
    ...(color ? { branding: { color } } : {}),
    ...(pricing && Object.keys(pricing).length > 0 ? { pricing } : {})
  };
}

export { normalizeProviderConfigPrefix, isValidHexColor };
