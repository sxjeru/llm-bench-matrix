function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function toProviderSlug(name: string): string {
  return normalizeToken(name);
}

export function buildModelCanonicalKey(providerSlug: string, modelName: string): string {
  return `${normalizeToken(providerSlug)}:${normalizeToken(modelName)}`;
}

export function buildBenchmarkCanonicalKey(benchmarkName: string, benchmarkType: string): string {
  return `${normalizeToken(benchmarkName)}:${normalizeToken(benchmarkType)}`;
}
