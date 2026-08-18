export const PUBLIC_CACHE_CONTROL_BROWSER = "public, max-age=0, must-revalidate";
// CDN / Vercel 边缘缓存无法被 invalidateAllCaches / revalidatePath 主动 purge。
// s-maxage>0 会让后台导入后的公开快照继续命中旧包；新鲜度交给源站 ETag 304。
export const PUBLIC_CACHE_CONTROL_CDN = "public, s-maxage=0, must-revalidate";
export const PUBLIC_CACHE_CONTROL_VERCEL = "public, s-maxage=0, must-revalidate";
export const PUBLIC_NO_STORE_CACHE_CONTROL = "private, no-store, no-cache, must-revalidate, max-age=0";
