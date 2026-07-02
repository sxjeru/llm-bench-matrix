import { useXAxisScale, useYAxisScale } from "recharts";
import type { BoxPlotStats } from "@/lib/boxplot-stats";

interface AxisScale {
  (value: string | number, options?: { position?: "start" | "middle" | "end" }): number | undefined;
}

interface YAxisScale {
  (value: number): number;
}

interface CustomBoxPlotLayerProps {
  data: BoxPlotStats[];
}

/**
 * 自定义箱线图渲染层
 * 放置在 Recharts 图表容器内部，使用 v3 钩子获取比例尺
 */
export function CustomBoxPlotLayer(props: CustomBoxPlotLayerProps) {
  const { data } = props;
  const xScale = useXAxisScale() as AxisScale | undefined;
  const yScale = useYAxisScale() as YAxisScale | undefined;

  if (!data || !xScale || !yScale) {
    return null;
  }

  const fill = "#5da7ff";

  return (
    <g>
      {data.map((item) => {
        const { benchmark, min, q1, median, q3, max, outliers } = item;

        // 计算 X 坐标
        const startX = xScale(benchmark, { position: "start" }) ?? 0;
        const endX = xScale(benchmark, { position: "end" }) ?? 0;
        const centerX = xScale(benchmark, { position: "middle" }) ?? (startX + endX) / 2;
        const bandwidth = endX - startX || 40;

        // 计算 Y 坐标
        const minY = yScale(min);
        const q1Y = yScale(q1);
        const medianY = yScale(median);
        const q3Y = yScale(q3);
        const maxY = yScale(max);

        const boxWidth = Math.min(bandwidth * 0.6, 40);
        const whiskerWidth = Math.min(bandwidth * 0.3, 20);

        return (
          <g key={benchmark}>
            {/* 上须（max 到 Q3） */}
            <line
              x1={centerX}
              y1={maxY}
              x2={centerX}
              y2={q3Y}
              stroke={fill}
              strokeWidth={1.5}
              strokeDasharray="2,2"
            />
            <line
              x1={centerX - whiskerWidth / 2}
              y1={maxY}
              x2={centerX + whiskerWidth / 2}
              y2={maxY}
              stroke={fill}
              strokeWidth={1.5}
            />

            {/* 箱体（Q1 到 Q3） */}
            <rect
              x={centerX - boxWidth / 2}
              y={q3Y}
              width={boxWidth}
              height={Math.abs(q1Y - q3Y)}
              fill={fill}
              fillOpacity={0.6}
              stroke={fill}
              strokeWidth={1.5}
              rx={3}
            />

            {/* 中位数线 */}
            <line
              x1={centerX - boxWidth / 2}
              y1={medianY}
              x2={centerX + boxWidth / 2}
              y2={medianY}
              stroke="#fff"
              strokeWidth={2.5}
            />

            {/* 下须（Q1 到 min） */}
            <line
              x1={centerX}
              y1={q1Y}
              x2={centerX}
              y2={minY}
              stroke={fill}
              strokeWidth={1.5}
              strokeDasharray="2,2"
            />
            <line
              x1={centerX - whiskerWidth / 2}
              y1={minY}
              x2={centerX + whiskerWidth / 2}
              y2={minY}
              stroke={fill}
              strokeWidth={1.5}
            />

            {/* 异常值（outliers） */}
            {outliers.map((outlier, idx) => {
              const outlierY = yScale(outlier);
              return (
                <circle
                  key={`outlier-${idx}`}
                  cx={centerX}
                  cy={outlierY}
                  r={2.5}
                  fill="none"
                  stroke={fill}
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
