# LLM Bench Matrix

![Lint](https://github.com/sxjeru/llm-bench-matrix/actions/workflows/lint.yml/badge.svg)
![Test](https://github.com/sxjeru/llm-bench-matrix/actions/workflows/test.yml/badge.svg)

基于 **Next.js App Router、Drizzle ORM 与 PostgreSQL** 构建的大模型评测矩阵。<br>
项目面向多来源 benchmark 数据的展示、整理与维护，提供前台可视化矩阵热力图，及后台数据管理能力。

#### 点击预览：[https://llm.sxjeru.top/](https://llm.sxjeru.top/)

## 核心能力

- **多来源矩阵展示**：按 Source 查看或聚合多来源数据，支持模型筛选、列排序、列宽调整与热力图配色。
- **模型对比分析**：支持 Baseline / Compare 对比模式，直观展示模型间 benchmark 差异。
- **图像导出**：支持将当前矩阵导出为 PNG、WEBP、AVIF，或复制到剪贴板。
- **数据导入维护**：支持 CSV 与 XLSM/XLSX 预览导入，提供异常提示、数据清洗与提交能力。
- **实体管理**：支持 Provider、Model、Benchmark 的增改、合并、重命名与重复检测。
- **后台保护**：后台管理使用密码登录，并支持首登强制修改默认密码。

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `ADMIN_PASSWORD` | 后台登录密码 | 必填 |
| `DATABASE_URL` | Postgres 连接串 | 无 |
| `DATABASE_DRIVER` | 驱动选择（如 `pg` / `neon`） | 自动检测 |
| `DATABASE_CA` | 数据库服务端 CA（可选） | 无 |
| `DATABASE_POOL_MAX` | 连接池最大连接数 | `5` |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | 空闲连接超时（ms） | `10000` |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | 获取连接超时（ms） | `5000` |
| `DATABASE_POOL_MAX_USES` | 单连接最大复用次数 | `7500` |
| `NEXT_PUBLIC_UMAMI_SCRIPT_URL` | Umami 自托管脚本地址 | 无 |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | Umami 网站 ID | 无 |

> 生产环境必须提供 `ADMIN_PASSWORD`。

---

## Local DEV

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```
