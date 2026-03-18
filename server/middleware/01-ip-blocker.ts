/**
 * 全局 IP 封禁拦截中间件
 * 拦截所有 /api/ 请求，先查内存缓存（TTL 1分钟），再查数据库
 * 命中黑名单则直接返回 403，不进入后续handler
 */
import { defineEventHandler, getRequestURL, setResponseStatus } from 'h3'
import { db } from '~/drizzle/db'
import { ipBlacklists } from '~/drizzle/schema'
import { and, eq, isNull, or, gte } from 'drizzle-orm'
import { getClientIP } from '~~/server/utils/ip-utils'
import { getCachedIpStatus, setCachedIpStatus } from '~~/server/utils/ipCache'

export default defineEventHandler(async (event) => {
  // 只拦截 /api/ 路径
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return

  const ip = getClientIP(event)
  // unknown 或本地 IP 不拦截
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') return

  // 1. 查内存缓存
  const cachedStatus = getCachedIpStatus(ip)
  if (cachedStatus !== null) {
    if (cachedStatus.banned) {
      setResponseStatus(event, 403)
      return {
        error: 'IP_BANNED',
        message: '🚨 检测到您的设备恶意尝试登录他人账户，已触发系统安全机制，您的 IP 已被封禁。',
        reason: cachedStatus.reason,
        expiresAt: cachedStatus.expiresAt
      }
    }
    return // 缓存命中且未封禁，直接放行
  }

  // 2. 缓存未命中，查询数据库
  try {
    const now = new Date()
    const record = await db
      .select({ 
        ip: ipBlacklists.ip,
        reason: ipBlacklists.reason,
        expiresAt: ipBlacklists.expiresAt
       })
      .from(ipBlacklists)
      .where(
        and(
          eq(ipBlacklists.ip, ip),
          or(isNull(ipBlacklists.expiresAt), gte(ipBlacklists.expiresAt, now))
        )
      )
      .limit(1)

    const banned = record.length > 0
    const banData = banned ? record[0] : null
    
    setCachedIpStatus(ip, { 
      banned, 
      reason: banData?.reason, 
      expiresAt: banData?.expiresAt 
    })

    if (banned) {
      setResponseStatus(event, 403)
      return {
        error: 'IP_BANNED',
        message: '🚨 检测到您的设备恶意尝试登录他人账户，已触发系统安全机制，您的 IP 已被封禁。',
        reason: banData?.reason,
        expiresAt: banData?.expiresAt
      }
    }
  } catch (err) {
    // 数据库查询失败时放行，避免影响正常服务
    console.error('[IpBlocker] 查询 IP 黑名单失败，放行请求:', err)
  }
})
