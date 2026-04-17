# LLM Bench Matrix

![Lint](https://github.com/sxjeru/llm-bench-matrix/actions/workflows/lint.yml/badge.svg)
![Test](https://github.com/sxjeru/llm-bench-matrix/actions/workflows/test.yml/badge.svg)

基于 **Next.js App Router + Drizzle + Postgres** 的大模型评测矩阵可视化项目：
- 面向前台：多来源多模型 benchmark 榜单展示、筛选、比较、导出图片
- 面向后台：CSV / XLSM(XLSX) 导入预览、实体维护与合并、数据库管理

---

## 功能概览

### 前台矩阵
- 多来源 Source 页签与聚合视图
- 模型列筛选、拖拽排序、列宽调整
- 比较模式（Baseline / Compare 差值徽标）
- 热力图配色预设与透明度调节
- 表格导出（PNG / WEBP / AVIF）与剪贴板复制

### 后台管理
- 密码登录与首登强制改密（默认密码保护）
- 文本 CSV 导入：预览、警告提示、清洗后导入
- XLSM/XLSX 导入：工作表预览、警告处理、提交导入
- Provider / Model / Benchmark 的增改合并与去重辅助
- 设置管理（含模型去重规则等）

---

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DATABASE_URL` | Postgres 连接串 | 无 |
| `DATABASE_DRIVER` | 驱动选择（如 `pg` / `neon`） | 自动检测 |
| `DATABASE_CA` | 数据库服务端 CA（可选） | 空 |
| `DATABASE_POOL_MAX` | 连接池最大连接数 | `5` |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | 空闲连接超时（ms） | `10000` |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | 获取连接超时（ms） | `5000` |
| `DATABASE_POOL_MAX_USES` | 单连接最大复用次数 | `7500` |
| `ADMIN_PASSWORD` | 后台登录密码 | 务必修改 |

> 生产环境必须提供 `ADMIN_PASSWORD`。

---

## Local DEV

```bash
pnpm install
cp .env.example .env
pnpm db:push
pnpm dev
```

---

## API

- `GET /api/public/records?limit=300`
  - 返回前台表格数据
  - 支持 `limit`（1 ~ 1000）
  - 带速率限制与缓存头
