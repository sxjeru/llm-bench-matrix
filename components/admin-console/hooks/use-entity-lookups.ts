import { useMemo } from "react";
import type { BenchmarkOption, ModelOption, ProviderOption } from "../types";
import { getBenchmarkExactLookupKey } from "../utils/benchmark";
import { buildModelCompareKey } from "../utils/model";
import { normalizeModalityName } from "../utils/modality";
import { getProviderOptionLabel } from "../utils/provider";

export function useEntityLookups({
  providers,
  models,
  benchmarks,
  sourceOptions
}: {
  providers: ProviderOption[];
  models: ModelOption[];
  benchmarks: BenchmarkOption[];
  sourceOptions: string[];
}) {
  const benchmarkById = useMemo(() => {
    return new Map(benchmarks.map((item) => [item.id, item]));
  }, [benchmarks]);

  const providerById = useMemo(() => {
    return new Map(providers.map((item) => [item.id, item]));
  }, [providers]);

  const existingBenchmarkExactMap = useMemo(() => {
    const map = new Map<string, BenchmarkOption>();
    benchmarks.forEach((item) => {
      map.set(getBenchmarkExactLookupKey(item.benchmarkName, item.benchmarkType), item);
    });
    return map;
  }, [benchmarks]);

  const existingBenchmarkByNameMap = useMemo(() => {
    const map = new Map<string, BenchmarkOption[]>();
    benchmarks.forEach((item) => {
      const key = item.benchmarkName.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(item);
    });
    return map;
  }, [benchmarks]);

  const existingBenchmarkModalitiesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    benchmarks.forEach((item) => {
      map.set(
        getBenchmarkExactLookupKey(item.benchmarkName, item.benchmarkType),
        (item.modalities?.length ? item.modalities : ["Text"]).map((modality) => normalizeModalityName(modality))
      );
    });
    return map;
  }, [benchmarks]);

  const deleteSourceOptions = useMemo(
    () => Array.from(new Set(sourceOptions.map((item) => item.trim()).filter(Boolean))),
    [sourceOptions]
  );

  const modelById = useMemo(() => {
    return new Map(models.map((item) => [item.id, item]));
  }, [models]);

  const existingModelExactMap = useMemo(() => {
    const map = new Map<string, ModelOption>();
    models.forEach((item) => {
      map.set(item.modelName.trim().toLowerCase(), item);
    });
    return map;
  }, [models]);

  const existingModelByCanonicalKey = useMemo(() => {
    const map = new Map<string, ModelOption>();
    models.forEach((item) => {
      if (!map.has(item.canonicalKey)) {
        map.set(item.canonicalKey, item);
      }
    });
    return map;
  }, [models]);

  const existingModelByNameMap = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    models.forEach((item) => {
      const key = item.modelName.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(item);
    });
    return map;
  }, [models]);

  const existingModelByCompareKey = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    models.forEach((item) => {
      const compareKey = buildModelCompareKey(item.modelName);
      if (!compareKey) return;

      if (!map.has(compareKey)) {
        map.set(compareKey, []);
      }
      map.get(compareKey)?.push(item);
    });
    return map;
  }, [models]);

  const modelEntityOptions = useMemo(
    () =>
      models.map((item) => ({
        id: item.id,
        label: item.modelName
      })),
    [models]
  );

  const providerEntityOptions = useMemo(
    () =>
      providers.map((item) => ({
        id: item.id,
        label: getProviderOptionLabel(item)
      })),
    [providers]
  );

  const benchmarkEntityOptions = useMemo(
    () =>
      benchmarks.map((item) => ({
        id: item.id,
        label: `${item.benchmarkName} [${item.benchmarkType}]`
      })),
    [benchmarks]
  );

  return {
    benchmarkById,
    providerById,
    existingBenchmarkExactMap,
    existingBenchmarkByNameMap,
    existingBenchmarkModalitiesMap,
    deleteSourceOptions,
    modelById,
    existingModelExactMap,
    existingModelByCanonicalKey,
    existingModelByNameMap,
    existingModelByCompareKey,
    modelEntityOptions,
    providerEntityOptions,
    benchmarkEntityOptions
  };
}