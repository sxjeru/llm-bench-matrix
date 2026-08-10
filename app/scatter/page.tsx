import { ModelScatter } from "@/components/model-scatter";
import { toMatrixInputRow } from "@/components/benchmark-matrix/map-row";
import { getDashboardRows, getModelParamsRows, getSourceOptions } from "@/lib/db/queries";
import { getModelPricingRows } from "@/lib/model-pricing";
import type { Metadata } from "next";
import { Suspense } from "react";

export const revalidate = false;

export const metadata: Metadata = {
  title: "模型二维分析 · LLM Bench Matrix",
  description:
    "在二维平面上比较大模型：任选两个指标作为横纵轴，叠加帕累托前沿，快速找出同等价位或同等参数量下不被压制的模型。"
};

export default async function ScatterPage() {
  const [rows, sourceOptions, modelPrices, modelParams] = await Promise.all([
    getDashboardRows(null, null),
    getSourceOptions(),
    getModelPricingRows(),
    getModelParamsRows()
  ]);

  const mappedRows = rows.map(toMatrixInputRow);

  return (
    <>
      <section className="sr-only">
        <h1>模型二维分析</h1>
        <p>
          任选两个评测指标作为横纵轴绘制散点图，支持帕累托前沿、对数刻度与厂商配色，
          用于比较大模型在性能与成本之间的权衡。
        </p>
      </section>

      <Suspense fallback={null}>
        <ModelScatter
          rows={mappedRows}
          sourceOptions={sourceOptions}
          modelPrices={modelPrices}
          modelParams={modelParams}
        />
      </Suspense>
    </>
  );
}
