/**
 * 公开数据端点的缓存策略。
 *
 * 这些端点（首屏快照 473 KB、4 个统计数字、单元格历史）原本是
 * `s-maxage=0, must-revalidate`：每个访客的每次访问都要打到 Serverless 函数，
 * 实测冷启动 1.4–2.4 s 会完整落在首屏上，热态也要 60–80 ms 才出首字节。
 *
 * 改成边缘短 TTL + stale-while-revalidate 后：
 *   - 单个边缘节点最多每 30 s 回源一次，其余请求全部命中缓存（~20 ms）；
 *   - 条目过期时边缘先返回旧副本、再在后台刷新，源站再慢（含冷启动）
 *     也不会传导到首屏，用户永远不等源站；
 *   - 浏览器端 15 s 内完全不发请求，连续刷新/切页零往返。
 *
 * 代价是后台导入后最多约 45 s（浏览器 15 s + 边缘 30 s）内仍可能读到旧快照。
 * 后台写入是人工、低频操作，这个窗口可以接受；若要更紧，只改下面三个数字。
 * 正确性兜底仍是 ETag：过期后浏览器/边缘的再验证请求命中 304 即复用旧副本。
 */
export const PUBLIC_CACHE_CONTROL_BROWSER = "public, max-age=15, stale-while-revalidate=45";
export const PUBLIC_CACHE_CONTROL_CDN = "public, s-maxage=30, stale-while-revalidate=86400";
// Vercel 边缘只认自己的头；通用 CDN（EdgeOne 等）走 CDN-Cache-Control。
export const PUBLIC_CACHE_CONTROL_VERCEL = PUBLIC_CACHE_CONTROL_CDN;
export const PUBLIC_NO_STORE_CACHE_CONTROL = "private, no-store, no-cache, must-revalidate, max-age=0";

/**
 * 明文逃生舱（`/api/public/dashboard/plain`）的缓存策略。
 *
 * 3.6 MB 明文没必要在边缘滞留一天，而且必须显式 `no-transform`：
 * 一旦被代理或平台再 gzip 一次，调用方拿到的就不是可直接解析的 JSON，
 * 这个端点也就失去意义了。
 */
export const PUBLIC_PLAIN_CACHE_CONTROL = `${PUBLIC_NO_STORE_CACHE_CONTROL}, no-transform`;
