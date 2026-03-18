/**
 * IP 黑名单内存缓存工具
 * 用于在高并发下避免每次请求都查询数据库
 * TTL: 1 分钟自动过期刷新
 */

interface CacheEntry {
  banned: boolean
  cachedAt: number
}

const CACHE_TTL_MS = 60 * 1000 // 1 分钟

// 内存缓存 Map（进程级别，多 Worker 各自独立）
const ipBlockCache = new Map<string, CacheEntry>()

/**
 * 从缓存中读取 IP 封禁状态
 * @returns banned 状态，或 null（缓存未命中/已过期）
 */
export function getCachedIpStatus(ip: string): boolean | null {
  const entry = ipBlockCache.get(ip)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    ipBlockCache.delete(ip)
    return null
  }
  return entry.banned
}

/**
 * 写入缓存
 */
export function setCachedIpStatus(ip: string, banned: boolean): void {
  ipBlockCache.set(ip, { banned, cachedAt: Date.now() })
}

/**
 * 清除指定 IP 的缓存（解封或新封禁后调用）
 * 可被 securityService 跨文件调用
 */
export function invalidateIpCache(ip: string): void {
  ipBlockCache.delete(ip)
  console.log(`[IpCache] IP ${ip} 的缓存已清除`)
}
