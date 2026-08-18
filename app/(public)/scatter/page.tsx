import type { Metadata } from "next";

export const revalidate = false;

export const metadata: Metadata = {
  title: "模型二维分析 · LLM Bench Matrix",
  description:
    "在二维平面上比较大模型：任选两个指标作为横纵轴，叠加帕累托前沿，快速找出同等价位或同等参数量下不被压制的模型。"
};

export default function ScatterPage() {
  return (
    <section className="sr-only">
      <h1>模型二维分析</h1>
      <p>
        任选两个评测指标作为横纵轴绘制散点图，支持帕累托前沿、对数刻度与厂商配色，
        用于比较大模型在性能与成本之间的权衡。
      </p>
    </section>
  );
}
