import { useMemo } from "react";
import { BENCHMARK_SUSPECT_KEYWORDS } from "../constants";
import type {
  BenchmarkOption,
  BenchmarkWarningItem,
  BenchmarkWarningLevel,
  MatrixPreviewRow,
  ModelDedupeRule,
  ModelOption,
  ModelWarningItem,
  ProviderOption,
  StructuredCsvImportRow,
  TextImportPreviewRow
} from "../types";
import {
  buildBenchmarkCompareKey,
  getBenchmarkExactLookupKey,
  getTextImportBenchmarkKey,
  isLowerBetterPreviewBenchmark,
  removeParenthesesContent,
  resolveHardcodedBenchmarkAliasTarget
} from "../utils/benchmark";
import {
  composePairRawValue,
  composeStarRawValue,
  parsePairRawValue,
  parseSingleRawValue,
  parseStarSingleRawValue
} from "../utils/import-values";
import { buildModelCompareKey, normalizeModelNameByDedupeRule } from "../utils/model";
import { normalizeModalityList, normalizeModalityName } from "../utils/modality";
import { getProviderDisplayNameById } from "../utils/provider";

type UseImportPreviewStateOptions = {
  benchmarks: BenchmarkOption[];
  textImportDraftRows: TextImportPreviewRow[];
  textImportPreviewRows: TextImportPreviewRow[];
  textImportPreviewVisibleCount: number;
  csvSource: string;
  ignoredBenchmarkKeys: Record<string, boolean>;
  parenthesesModes: Record<string, "keep" | "remove" | "custom">;
  parenthesesCustomNames: Record<string, string>;
  modelParenthesesModes: Record<string, "keep" | "remove" | "custom">;
  modelParenthesesCustomNames: Record<string, string>;
  modelMergeTargets: Record<string, string>;
  benchmarkMergeTargets: Record<string, string>;
  modelById: Map<number, ModelOption>;
  providerById: Map<number, ProviderOption>;
  benchmarkById: Map<number, BenchmarkOption>;
  modelDedupeRule: ModelDedupeRule;
  existingModelExactMap: Map<string, ModelOption>;
  existingModelByCanonicalKey: Map<string, ModelOption>;
  existingModelByNameMap: Map<string, ModelOption[]>;
  existingModelByCompareKey: Map<string, ModelOption[]>;
  existingBenchmarkExactMap: Map<string, BenchmarkOption>;
  existingBenchmarkByNameMap: Map<string, BenchmarkOption[]>;
  existingBenchmarkModalitiesMap: Map<string, string[]>;
};

function hasEloBenchmarkSuffix(benchmarkName: string): boolean {
  return /\s*[（(]\s*elo\s*[)）]\s*$/i.test(benchmarkName.trim());
}

function getEloBenchmarkName(benchmarkName: string): string {
  const cleanName = benchmarkName.trim();
  return hasEloBenchmarkSuffix(cleanName) ? cleanName : `${cleanName} (Elo)`;
}

export function useImportPreviewState({
  benchmarks,
  textImportDraftRows,
  textImportPreviewRows,
  textImportPreviewVisibleCount,
  csvSource,
  ignoredBenchmarkKeys,
  parenthesesModes,
  parenthesesCustomNames,
  modelParenthesesModes,
  modelParenthesesCustomNames,
  modelMergeTargets,
  benchmarkMergeTargets,
  modelById,
  providerById,
  benchmarkById,
  modelDedupeRule,
  existingModelExactMap,
  existingModelByCanonicalKey,
  existingModelByNameMap,
  existingModelByCompareKey,
  existingBenchmarkExactMap,
  existingBenchmarkByNameMap,
  existingBenchmarkModalitiesMap
}: UseImportPreviewStateOptions) {
  const modelWarnings = useMemo(() => {
    const importedModels = Array.from(new Set(textImportDraftRows.map((item) => item.modelName.trim()).filter(Boolean)));
    const warnings: ModelWarningItem[] = [];

    importedModels.forEach((modelName) => {
      const exactExisting = existingModelExactMap.get(modelName.toLowerCase());
      if (exactExisting) {
        return;
      }

      const reasons: string[] = [];
      let level: BenchmarkWarningLevel = "info";
      let suggestedTargetId: number | null = null;

      const hasParentheses = /[（(][^()（）]+[)）]/.test(modelName);

      const compareKey = buildModelCompareKey(modelName);
      const candidates = compareKey ? (existingModelByCompareKey.get(compareKey) ?? []) : [];

      if (candidates.length > 0) {
        const candidateLabels = candidates
          .slice(0, 3)
          .map((item) => item.modelName)
          .join("、");

        reasons.push(`与库内 model 相似：${candidateLabels}`);
        level = "warn";
        suggestedTargetId = candidates[0]?.id ?? null;
      }

      if (reasons.length === 0) return;

      warnings.push({
        key: modelName,
        modelName,
        level,
        reasons,
        suggestedTargetId,
        candidateTargetIds: Array.from(new Set(candidates.map((item) => item.id))),
        hasParentheses
      });
    });

    return warnings;
  }, [textImportDraftRows, existingModelByCompareKey, existingModelExactMap]);

  const modelsWithParentheses = useMemo(() => {
    return Array.from(
      new Set(textImportDraftRows.map((item) => item.modelName).filter((name) => /[（(][^()（）]+[)）]/.test(name)))
    ).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [textImportDraftRows]);

  const modelWarningSet = useMemo(
    () => new Set([...modelWarnings.map((item) => item.modelName), ...modelsWithParentheses]),
    [modelWarnings, modelsWithParentheses]
  );

  const modelWarningMap = useMemo(
    () => new Map(modelWarnings.map((item) => [item.key, item])),
    [modelWarnings]
  );

  const benchmarkMergeCandidateMap = useMemo(() => {
    const existingByCompareKey = new Map<string, BenchmarkOption[]>();

    benchmarks.forEach((item) => {
      const compareKey = buildBenchmarkCompareKey(item.benchmarkName);
      if (!compareKey) return;

      if (!existingByCompareKey.has(compareKey)) {
        existingByCompareKey.set(compareKey, []);
      }

      existingByCompareKey.get(compareKey)?.push(item);
    });

    const importedBenchmarks = new Map<string, { benchmarkName: string; benchmarkType: string }>();
    const importedBenchmarkHasEloValue = new Map<string, boolean>();

    textImportDraftRows.forEach((item) => {
      const key = getTextImportBenchmarkKey(item.benchmarkName, item.benchmarkType);
      if (!importedBenchmarks.has(key)) {
        importedBenchmarks.set(key, {
          benchmarkName: item.benchmarkName,
          benchmarkType: item.benchmarkType
        });
      }

      if ((item.valueNum !== null && item.valueNum > 100) || (item.valueNum2 !== null && item.valueNum2 > 100)) {
        importedBenchmarkHasEloValue.set(key, true);
      }
    });

    const map = new Map<string, number[]>();
    const addCandidate = (key: string, targetId: number | null | undefined) => {
      if (!targetId) return;
      const current = map.get(key) ?? [];
      if (!current.includes(targetId)) {
        map.set(key, [...current, targetId]);
      }
    };

    importedBenchmarks.forEach(({ benchmarkName, benchmarkType }, key) => {
      const exactExisting = existingBenchmarkExactMap.get(getBenchmarkExactLookupKey(benchmarkName, benchmarkType));
      addCandidate(key, exactExisting?.id);

      const sameNameExisting = existingBenchmarkByNameMap.get(benchmarkName.trim().toLowerCase()) ?? [];
      sameNameExisting.forEach((item) => addCandidate(key, item.id));

      const aliasTargetName = resolveHardcodedBenchmarkAliasTarget(benchmarkName);
      if (aliasTargetName) {
        const aliasTarget = benchmarks.find((item) => item.benchmarkName.toLowerCase() === aliasTargetName.toLowerCase());
        addCandidate(key, aliasTarget?.id);
      }

      const hasEloSuffix = hasEloBenchmarkSuffix(benchmarkName);
      const hasEloValue = importedBenchmarkHasEloValue.get(key) === true;
      if (hasEloValue && !hasEloSuffix) {
        const eloBenchmarkName = getEloBenchmarkName(benchmarkName);
        const exactEloExisting = existingBenchmarkExactMap.get(getBenchmarkExactLookupKey(eloBenchmarkName, benchmarkType));
        addCandidate(key, exactEloExisting?.id);

        const sameNameEloExisting = existingBenchmarkByNameMap.get(eloBenchmarkName.trim().toLowerCase()) ?? [];
        sameNameEloExisting.forEach((item) => addCandidate(key, item.id));

        const eloCompareKey = buildBenchmarkCompareKey(eloBenchmarkName);
        const eloCompareCandidates = eloCompareKey ? (existingByCompareKey.get(eloCompareKey) ?? []) : [];
        eloCompareCandidates
          .filter((item) => hasEloBenchmarkSuffix(item.benchmarkName))
          .forEach((item) => addCandidate(key, item.id));
      }

      const compareKey = buildBenchmarkCompareKey(benchmarkName);
      const candidates = compareKey ? (existingByCompareKey.get(compareKey) ?? []) : [];
      candidates.forEach((item) => addCandidate(key, item.id));
    });

    return map;
  }, [benchmarks, textImportDraftRows, existingBenchmarkExactMap, existingBenchmarkByNameMap]);

  const benchmarkWarnings = useMemo(() => {
    const existingByCompareKey = new Map<string, BenchmarkOption[]>();

    benchmarks.forEach((item) => {
      const compareKey = buildBenchmarkCompareKey(item.benchmarkName);
      if (!compareKey) return;

      if (!existingByCompareKey.has(compareKey)) {
        existingByCompareKey.set(compareKey, []);
      }

      existingByCompareKey.get(compareKey)?.push(item);
    });

    const importedBenchmarks = new Map<string, { benchmarkName: string; benchmarkType: string }>();
    const importedBenchmarkHasEloValue = new Map<string, boolean>();
    textImportDraftRows.forEach((item) => {
      const key = getTextImportBenchmarkKey(item.benchmarkName, item.benchmarkType);
      if (!importedBenchmarks.has(key)) {
        importedBenchmarks.set(key, {
          benchmarkName: item.benchmarkName,
          benchmarkType: item.benchmarkType
        });
      }

      if ((item.valueNum !== null && item.valueNum > 100) || (item.valueNum2 !== null && item.valueNum2 > 100)) {
        importedBenchmarkHasEloValue.set(key, true);
      }
    });

    const warnings: BenchmarkWarningItem[] = [];

    importedBenchmarks.forEach(({ benchmarkName, benchmarkType }, key) => {
      const reasons: string[] = [];
      let level: BenchmarkWarningLevel = "info";
      let suggestedTargetId: number | null = null;

      const hasParentheses = /[（(][^()（）]+[)）]/.test(benchmarkName);

      const hasEloSuffix = hasEloBenchmarkSuffix(benchmarkName);
      const hasEloValue = importedBenchmarkHasEloValue.get(key) === true;
      if (hasEloValue && !hasEloSuffix) {
        const eloBenchmarkName = getEloBenchmarkName(benchmarkName);
        const exactEloExisting = existingBenchmarkExactMap.get(getBenchmarkExactLookupKey(eloBenchmarkName, benchmarkType));
        const sameNameEloExisting = existingBenchmarkByNameMap.get(eloBenchmarkName.trim().toLowerCase()) ?? [];

        const suggestedEloTarget = exactEloExisting ?? sameNameEloExisting[0] ?? null;
        if (suggestedEloTarget) {
          reasons.push(`检测到 >100 Elo 数值，建议合并到 ${suggestedEloTarget.benchmarkName} [${suggestedEloTarget.benchmarkType}]`);
          suggestedTargetId = suggestedEloTarget.id;
          level = "warn";
        } else {
          reasons.push(`检测到 >100 Elo 数值，但库内不存在 ${eloBenchmarkName}`);
          level = "warn";
        }
      }

      const exactExisting = existingBenchmarkExactMap.get(getBenchmarkExactLookupKey(benchmarkName, benchmarkType));
      const sameNameExisting = existingBenchmarkByNameMap.get(benchmarkName.trim().toLowerCase()) ?? [];
      const compareKey = buildBenchmarkCompareKey(benchmarkName);
      const candidates = compareKey ? (existingByCompareKey.get(compareKey) ?? []) : [];
      if (exactExisting || sameNameExisting.length > 0) {
        if (reasons.length === 0) return;

        warnings.push({
          key,
          benchmarkName,
          benchmarkType,
          level,
          reasons,
          suggestedTargetId,
          candidateTargetIds: benchmarkMergeCandidateMap.get(key) ?? [],
          hasParentheses
        });
        return;
      }

      const matchedKeyword = BENCHMARK_SUSPECT_KEYWORDS.find((keyword) =>
        benchmarkName.toLowerCase().includes(keyword)
      );
      if (matchedKeyword) {
        reasons.push(`命中高亮词：${matchedKeyword}`);
      }

      const aliasTargetName = resolveHardcodedBenchmarkAliasTarget(benchmarkName);
      if (aliasTargetName) {
        const aliasTarget = benchmarks.find((item) => item.benchmarkName.toLowerCase() === aliasTargetName.toLowerCase());
        if (aliasTarget) {
          reasons.push(`命中硬编码别名，建议合并到 ${aliasTarget.benchmarkName} [${aliasTarget.benchmarkType}]`);
          suggestedTargetId = aliasTarget.id;
          level = "danger";
        } else {
          reasons.push(`命中硬编码别名：${aliasTargetName}`);
          level = "warn";
        }
      }

      if (candidates.length > 0) {
        const candidateLabels = candidates
          .slice(0, 3)
          .map((item) => `${item.benchmarkName} [${item.benchmarkType}]`)
          .join("、");

        reasons.push(`与库内 benchmark 相似：${candidateLabels}`);

        if (level !== "danger") {
          level = "warn";
        }

        if (!suggestedTargetId) {
          suggestedTargetId = candidates[0]?.id ?? null;
        }
      }

      if (reasons.length === 0) return;

      warnings.push({
        key,
        benchmarkName,
        benchmarkType,
        level,
        reasons,
        suggestedTargetId,
        candidateTargetIds: benchmarkMergeCandidateMap.get(key) ?? [],
        hasParentheses
      });
    });

    return warnings;
  }, [benchmarks, textImportDraftRows, existingBenchmarkExactMap, existingBenchmarkByNameMap, benchmarkMergeCandidateMap]);

  const benchmarkWarningMap = useMemo(
    () => new Map(benchmarkWarnings.map((item) => [item.key, item])),
    [benchmarkWarnings]
  );

  const benchmarksWithParentheses = useMemo(() => {
    const found = new Map<string, { key: string; benchmarkName: string; benchmarkType: string }>();

    textImportDraftRows.forEach((row) => {
      if (!/[（(][^()（）]+[)）]/.test(row.benchmarkName)) return;

      const hasExactExisting = existingBenchmarkExactMap.has(
        getBenchmarkExactLookupKey(row.benchmarkName, row.benchmarkType)
      );
      if (hasExactExisting) return;

      const key = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
      if (!found.has(key)) {
        found.set(key, {
          key,
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType
        });
      }
    });

    return Array.from(found.values()).sort((a, b) => a.benchmarkName.localeCompare(b.benchmarkName, "zh-Hans-CN"));
  }, [textImportDraftRows, existingBenchmarkExactMap]);

  const benchmarkParenthesesSet = useMemo(
    () => new Set(benchmarksWithParentheses.map((item) => item.key)),
    [benchmarksWithParentheses]
  );

  const matrixPreview = useMemo(() => {
    const modelNames: string[] = [];
    const seenModelNames = new Set<string>();
    textImportDraftRows.forEach((row) => {
      const modelName = row.modelName;
      if (!modelName || seenModelNames.has(modelName)) return;
      seenModelNames.add(modelName);
      modelNames.push(modelName);
    });
    const rowMap = new Map<string, MatrixPreviewRow>();

    textImportDraftRows.forEach((row, rowIndex) => {
      const key = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
      if (!rowMap.has(key)) {
        const modalities = row.modalities?.length
          ? normalizeModalityList(row.modalities)
          : (
            existingBenchmarkModalitiesMap.get(getBenchmarkExactLookupKey(row.benchmarkName, row.benchmarkType))
            ?? [normalizeModalityName(row.benchmarkType)]
          );
        const inferredHigherIsBetter = typeof row.higherIsBetter === "boolean"
          ? row.higherIsBetter
          : !isLowerBetterPreviewBenchmark(row.benchmarkName, row.benchmarkType);

        rowMap.set(key, {
          key,
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType,
          higherIsBetter: inferredHigherIsBetter,
          modalities,
          cellRowIndexByModel: {}
        });
      }

      const entry = rowMap.get(key);
      if (!entry) return;

      if (typeof row.higherIsBetter === "boolean") {
        entry.higherIsBetter = row.higherIsBetter;
      }

      if (entry.cellRowIndexByModel[row.modelName] === undefined) {
        entry.cellRowIndexByModel[row.modelName] = rowIndex;
      }
    });

    const rows = Array.from(rowMap.values());

    return {
      modelNames,
      rows
    };
  }, [textImportDraftRows, existingBenchmarkModalitiesMap]);

  const matrixPreviewHeaderCounts = useMemo(() => {
    const rowCount = matrixPreview.rows.length;
    const benchmarkUniqueCount = new Set(matrixPreview.rows.map((row) => row.benchmarkName)).size;
    const typeUniqueCount = new Set(matrixPreview.rows.map((row) => row.benchmarkType)).size;

    return {
      benchmarkCount: rowCount,
      benchmarkUniqueCount,
      typeUniqueCount
    };
  }, [matrixPreview.rows]);

  const benchmarkPreviewValueOverlapPayload = useMemo(() => {
    const warningCandidates = benchmarkWarnings.map((warning) => [
      warning.key,
      Array.from(new Set([
        ...warning.candidateTargetIds,
        ...(warning.suggestedTargetId ? [warning.suggestedTargetId] : [])
      ]))
    ] as const);
    const candidateEntries = Array.from(benchmarkMergeCandidateMap.entries());
    const candidateMap = new Map<string, number[]>();

    [...candidateEntries, ...warningCandidates].forEach(([key, candidateIds]) => {
      candidateMap.set(key, Array.from(new Set([...(candidateMap.get(key) ?? []), ...candidateIds])));
    });

    const items = Array.from(candidateMap.entries())
      .map(([previewBenchmarkKey, candidateBenchmarkIds]) => {
        if (candidateBenchmarkIds.length === 0) return null;

        const matrixRow = matrixPreview.rows.find((row) => row.key === previewBenchmarkKey);
        if (!matrixRow) return null;

        const cells = Object.values(matrixRow.cellRowIndexByModel)
          .map((rowIndex) => textImportDraftRows[rowIndex])
          .filter((row): row is TextImportPreviewRow => Boolean(row) && row.rawValue.trim().length > 0)
          .map((row) => ({
            modelName: row.modelName,
            rawValue: row.rawValue
          }));

        if (cells.length === 0) return null;

        return {
          previewBenchmarkKey,
          candidateBenchmarkIds,
          cells
        };
      })
      .filter((item): item is {
        previewBenchmarkKey: string;
        candidateBenchmarkIds: number[];
        cells: Array<{ modelName: string; rawValue: string }>;
      } => item !== null);

    return {
      key: items.length > 0 ? JSON.stringify(items) : "",
      items
    };
  }, [benchmarkWarnings, benchmarkMergeCandidateMap, matrixPreview.rows, textImportDraftRows]);

  const benchmarkPreviewValueOverlapTriggerKey = useMemo(() => {
    if (textImportDraftRows.length === 0) {
      return "";
    }

    return textImportDraftRows
      .map((row, rowIndex) => `${rowIndex}:${row.rawValue}`)
      .join("\u001f");
  }, [textImportDraftRows]);

  const pairValueRows = useMemo(() => {
    return textImportDraftRows
      .map((row, rowIndex) => {
        const parsedPair = parsePairRawValue(row.rawValue);
        if (!parsedPair) return null;

        return {
          rowIndex,
          benchmarkKey: getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType),
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType,
          modelName: row.modelName,
          first: parsedPair.first,
          second: parsedPair.second,
          note: row.valueNote ?? parsedPair.note
        };
      })
      .filter(
        (
          item
        ): item is {
          rowIndex: number;
          benchmarkKey: string;
          benchmarkName: string;
          benchmarkType: string;
          modelName: string;
          first: string;
          second: string;
          note: string | null;
        } => item !== null
      );
  }, [textImportDraftRows]);

  const pairRowsMissingNoteCount = useMemo(
    () => pairValueRows.filter((item) => !(item.note && item.note.trim().length > 0)).length,
    [pairValueRows]
  );

  const starValueRows = useMemo(() => {
    return textImportDraftRows
      .map((row, rowIndex) => {
        const parsedStar = parseStarSingleRawValue(row.rawValue);
        if (!parsedStar) return null;

        const supplement = (row.valueNote ?? parsedStar.note ?? "").trim();

        return {
          rowIndex,
          benchmarkName: row.benchmarkName,
          modelName: row.modelName,
          value: parsedStar.value,
          supplement
        };
      })
      .filter(
        (
          item
        ): item is {
          rowIndex: number;
          benchmarkName: string;
          modelName: string;
          value: string;
          supplement: string;
        } => item !== null
      );
  }, [textImportDraftRows]);

  const starRowsMissingSupplementCount = useMemo(
    () => starValueRows.filter((item) => item.supplement.length === 0).length,
    [starValueRows]
  );

  const finalizedTextImportRows = useMemo(() => {
    const latestSourceInput = csvSource.trim();

    return textImportDraftRows
      .map<StructuredCsvImportRow | null>((row) => {
        const benchmarkKey = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
        const originalModelKey = row.modelName;
        if (ignoredBenchmarkKeys[benchmarkKey]) {
          return null;
        }

        const rawValueInput = row.rawValue.trim();
        if (!rawValueInput) {
          return null;
        }

        const pairValue = parsePairRawValue(rawValueInput);
        const starSingleValue = pairValue ? null : parseStarSingleRawValue(rawValueInput);

        let rawValue = rawValueInput;
        let valueNote: string | null = row.valueNote?.trim() || null;

        if (pairValue) {
          const normalizedNote = row.valueNote?.trim() || pairValue.note || null;
          rawValue = composePairRawValue(pairValue.first, pairValue.second, normalizedNote);
          valueNote = normalizedNote;
        } else if (starSingleValue) {
          const starNote = row.valueNote?.trim() || starSingleValue.note || null;
          rawValue = composeStarRawValue(starSingleValue.value, starNote);
          valueNote = starNote;
        } else {
          const singleValue = parseSingleRawValue(rawValueInput);
          if (singleValue) {
            const singleTail = singleValue.tail.trim();
            if (singleTail.length > 0 && !singleTail.startsWith("*")) {
              rawValue = singleValue.value;
              valueNote = row.valueNote?.trim() || singleTail || null;
            }
          }
        }

        let benchmarkName = row.benchmarkName;
        let benchmarkType = row.benchmarkType;
        let modelName = row.modelName;
        let providerName = row.providerName.trim() || "Unknown";
        let providerDisplayName = row.providerDisplayName?.trim() || providerName;

        const modelParenthesesMode = modelParenthesesModes[originalModelKey] ?? "keep";
        if (modelParenthesesMode === "remove") {
          const noParentheses = removeParenthesesContent(modelName);
          if (noParentheses) {
            modelName = noParentheses;
          }
        } else if (modelParenthesesMode === "custom") {
          const customName = (modelParenthesesCustomNames[originalModelKey] ?? "").trim();
          if (customName) {
            modelName = customName;
          }
        }

        const modelMergeTargetId = Number(modelMergeTargets[originalModelKey]);
        if (Number.isFinite(modelMergeTargetId) && modelMergeTargetId > 0) {
          const target = modelById.get(modelMergeTargetId);
          if (target) {
            modelName = target.modelName;
          }
        }

        modelName = modelName.trim();

        const exactModel = existingModelExactMap.get(modelName.toLowerCase());
        if (exactModel) {
          modelName = exactModel.modelName;
          providerName = providerById.get(exactModel.providerId)?.name || providerName;
          providerDisplayName = getProviderDisplayNameById(exactModel.providerId, providerById) || providerName;
        } else {
          const canonicalKey = normalizeModelNameByDedupeRule(modelName, modelDedupeRule);
          const canonicalMatchedModel = existingModelByCanonicalKey.get(canonicalKey);

          if (canonicalMatchedModel) {
            modelName = canonicalMatchedModel.modelName;
            providerName = providerById.get(canonicalMatchedModel.providerId)?.name || providerName;
            providerDisplayName = getProviderDisplayNameById(canonicalMatchedModel.providerId, providerById) || providerName;
          } else {
            const sameNameModels = existingModelByNameMap.get(modelName.toLowerCase()) ?? [];
            if (sameNameModels.length > 0) {
              modelName = sameNameModels[0].modelName;
              providerName = providerById.get(sameNameModels[0].providerId)?.name || providerName;
              providerDisplayName = getProviderDisplayNameById(sameNameModels[0].providerId, providerById) || providerName;
            }
          }
        }

        if (!modelName) {
          return null;
        }

        const parenthesesMode = parenthesesModes[benchmarkKey] ?? "keep";
        if (parenthesesMode === "remove") {
          const noParentheses = removeParenthesesContent(benchmarkName);
          if (noParentheses) {
            benchmarkName = noParentheses;
          }
        } else if (parenthesesMode === "custom") {
          const customName = (parenthesesCustomNames[benchmarkKey] ?? "").trim();
          if (customName) {
            benchmarkName = customName;
          }
        }

        benchmarkName = benchmarkName.trim();
        benchmarkType = benchmarkType.trim() || "general";

        if (!benchmarkName) {
          return null;
        }

        const exactExisting = existingBenchmarkExactMap.get(getBenchmarkExactLookupKey(benchmarkName, benchmarkType));
        if (exactExisting) {
          benchmarkName = exactExisting.benchmarkName;
          benchmarkType = exactExisting.benchmarkType;
        }

        const mergeTargetId = Number(benchmarkMergeTargets[benchmarkKey]);
        if (Number.isFinite(mergeTargetId) && mergeTargetId > 0) {
          const target = benchmarkById.get(mergeTargetId);
          if (target) {
            benchmarkName = target.benchmarkName;
          }
        }

        const normalizedModalities = normalizeModalityList(
          row.modalities?.length ? row.modalities : [benchmarkType]
        );
        const inferredHigherIsBetter = typeof row.higherIsBetter === "boolean"
          ? row.higherIsBetter
          : !isLowerBetterPreviewBenchmark(benchmarkName, benchmarkType);

        return {
          providerName,
          providerDisplayName,
          modelName,
          benchmarkName,
          benchmarkType,
          benchmarkTypeProvided: row.benchmarkTypeProvided ?? true,
          higherIsBetter: inferredHigherIsBetter,
          modalities: normalizedModalities,
          rawValue,
          valueNote,
          source: latestSourceInput.length > 0 ? latestSourceInput : (row.source?.trim() || null)
        };
      })
      .filter((item): item is StructuredCsvImportRow => item !== null);
  }, [
    csvSource,
    textImportDraftRows,
    ignoredBenchmarkKeys,
    parenthesesModes,
    parenthesesCustomNames,
    modelParenthesesModes,
    modelParenthesesCustomNames,
    modelMergeTargets,
    benchmarkMergeTargets,
    modelById,
    providerById,
    benchmarkById,
    modelDedupeRule,
    existingModelExactMap,
    existingModelByCanonicalKey,
    existingModelByNameMap,
    existingBenchmarkExactMap
  ]);

  const ignoredTextImportCount = useMemo(() => {
    if (textImportDraftRows.length === 0) return 0;
    return Math.max(0, textImportDraftRows.length - finalizedTextImportRows.length);
  }, [textImportDraftRows.length, finalizedTextImportRows.length]);

  const textImportPreviewTableRows = useMemo<TextImportPreviewRow[]>(() => {
    if (textImportDraftRows.length === 0) {
      return textImportPreviewRows;
    }

    return finalizedTextImportRows.map((row, index) => ({
      rowNumber: index + 1,
      providerName: row.providerDisplayName || row.providerName,
      modelName: row.modelName,
      benchmarkName: row.benchmarkName,
      benchmarkType: row.benchmarkType,
      benchmarkTypeProvided: row.benchmarkTypeProvided,
      higherIsBetter: row.higherIsBetter,
      modalities: row.modalities,
      rawValue: row.rawValue,
      valueNum: null,
      valueNum2: null,
      valueNote: row.valueNote,
      source: row.source,
      valid: row.rawValue.trim().length > 0
    }));
  }, [textImportDraftRows.length, textImportPreviewRows, finalizedTextImportRows]);

  const visibleResolvedTextImportPreviewRows = useMemo(
    () => textImportPreviewTableRows.slice(0, textImportPreviewVisibleCount),
    [textImportPreviewTableRows, textImportPreviewVisibleCount]
  );

  return {
    modelWarnings,
    modelsWithParentheses,
    modelWarningSet,
    modelWarningMap,
    benchmarkWarnings,
    benchmarkWarningMap,
    benchmarkMergeCandidateMap,
    benchmarksWithParentheses,
    benchmarkParenthesesSet,
    matrixPreview,
    matrixPreviewHeaderCounts,
    benchmarkPreviewValueOverlapPayload,
    benchmarkPreviewValueOverlapTriggerKey,
    pairValueRows,
    pairRowsMissingNoteCount,
    starValueRows,
    starRowsMissingSupplementCount,
    finalizedTextImportRows,
    ignoredTextImportCount,
    textImportPreviewTableRows,
    visibleResolvedTextImportPreviewRows
  };
}