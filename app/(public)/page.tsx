import { HomeMetrics } from "@/components/home-metrics";

export const revalidate = false;

export default function HomePage() {
  return (
    <>
      <section className="sr-only">
        <h1>LLM Bench Matrix</h1>
        <p>
          LLM 多源评测汇总矩阵，支持热力图可视化、模型对比与图片导出。
          聚合多个主流大模型评测基准数据，便捷直观比较各模型客观表现。
        </p>
      </section>

      <HomeMetrics />
    </>
  );
}
