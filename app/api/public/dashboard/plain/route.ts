import { handleDashboardRequest } from "../handler";

/**
 * 明文逃生舱。
 *
 * 用独立路径而不是 `?plain=1`：路径必然进入各层缓存键，查询串则常被 CDN
 * 作为「忽略参数」优化掉，一旦与主端点共用条目，就会把 br 发给脚本、
 * 或把 3.6 MB 明文塞进公共缓存。
 */
export function GET(request: Request) {
  return handleDashboardRequest(request, { plain: true });
}
