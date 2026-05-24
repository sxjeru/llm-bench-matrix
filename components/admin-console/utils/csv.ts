import type { StructuredCsvImportRow } from "../types";

export function escapeCsvCell(input: string): string {
  if (/[",\n\r]/.test(input)) {
    return `"${input.replace(/"/g, '""')}"`;
  }

  return input;
}

export function buildStructuredCsvText(rows: StructuredCsvImportRow[]): string {
  const header = [
    "provider",
    "model",
    "benchmark",
    "benchmark_type",
    "benchmark_type_provided",
    "higher_is_better",
    "value_raw",
    "value_note",
    "modalities",
    "source"
  ];
  const lines = [header.join(",")];

  rows.forEach((row) => {
    const line = [
      row.providerName,
      row.modelName,
      row.benchmarkName,
      row.benchmarkType,
      row.benchmarkTypeProvided ? "1" : "0",
      row.higherIsBetter ? "1" : "0",
      row.rawValue,
      row.valueNote ?? "",
      row.modalities.join(","),
      row.source ?? ""
    ]
      .map((item) => escapeCsvCell(item))
      .join(",");

    lines.push(line);
  });

  return lines.join("\n");
}
