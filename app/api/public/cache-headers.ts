export const PUBLIC_CACHE_CONTROL_BROWSER = "public, max-age=0, must-revalidate";
// 启用 Vercel / CDN 边缘 SWR（Stale-While-Revalidate）缓存：
// s-maxage=60 让边缘节点缓存 60 秒毫秒级直出；过期后允许使用旧数据立即响应用户，并在后台静默回源刷新。
export const PUBLIC_CACHE_CONTROL_CDN = "public, s-maxage=60, stale-while-revalidate=86400";
export const PUBLIC_CACHE_CONTROL_VERCEL = "public, s-maxage=60, stale-while-revalidate=86400";
export const PUBLIC_NO_STORE_CACHE_CONTROL = "private, no-store, no-cache, must-revalidate, max-age=0";
