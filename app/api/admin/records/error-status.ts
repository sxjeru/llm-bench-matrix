const CLIENT_ERROR_PATTERNS = [
  "not found",
  "不能为空",
  "不能指向同一",
  "无需",
  "没有可",
  "没有需要保存",
  "单次最多保存",
  "草稿缺少",
  "必须限定",
  "请缩小筛选范围",
  "未设置任何筛选条件",
  "sourceMode",
  "targetScale",
  "无效",
  "不属于指定",
  "相同"
];

/**
 * 数据管理相关接口的错误分类：实体不存在 → 404，参数/前置条件类 → 400，其余 → 500。
 * 单独抽出来是因为 Next.js 的 route 文件只允许导出 HTTP 方法。
 */
export function resolveRecordsErrorStatus(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes("not found")) return 404;
  return CLIENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern)) ? 400 : 500;
}
