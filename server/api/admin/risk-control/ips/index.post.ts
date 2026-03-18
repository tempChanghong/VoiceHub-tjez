/**
 * POST /api/admin/risk-control/ips
 * 管理员手动封禁 IP
 * Body: { ip, reason?, durationHours: number | null }
 *   durationHours = null -> 永久封禁
 */
import { db } from '~/drizzle/db'
import { ipBlacklists } from '~/drizzle/schema'
import { sql } from 'drizzle-orm'
import { invalidateIpCache } from '~~/server/utils/ipCache'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: '未授权访问' })
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '权限不足' })
  }

  const body = await readBody(event)
  const { ip, reason, durationHours } = body as {
    ip: unknown
    reason: unknown
    durationHours: unknown
  }

  // 校验 IP
  if (!ip || typeof ip !== 'string' || ip.trim() === '') {
    throw createError({ statusCode: 400, message: 'IP 地址不能为空' })
  }
  const cleanIp = ip.trim()
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
  if (!ipv4Regex.test(cleanIp) && !/^[0-9a-fA-F:]+$/.test(cleanIp)) {
    throw createError({ statusCode: 400, message: 'IP 地址格式无效' })
  }

  // 校验封禁时长（null = 永久）
  if (durationHours !== null && durationHours !== undefined) {
    if (typeof durationHours !== 'number' || !Number.isInteger(durationHours) || durationHours < 1) {
      throw createError({ statusCode: 400, message: 'durationHours 必须是正整数或 null（永久）' })
    }
  }

  const finalReason =
    typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : `管理员手动封禁（操作人：${user.name || user.id}）`

  const now = new Date()
  const expiresAt =
    durationHours === null || durationHours === undefined
      ? null
      : new Date(now.getTime() + Number(durationHours) * 60 * 60 * 1000)

  try {
    const [record] = await db
      .insert(ipBlacklists)
      .values({ ip: cleanIp, reason: finalReason, bannedAt: now, expiresAt })
      .onConflictDoUpdate({
        target: ipBlacklists.ip,
        set: {
          reason: sql`EXCLUDED.reason`,
          bannedAt: sql`EXCLUDED.banned_at`,
          expiresAt: sql`EXCLUDED.expires_at`
        }
      })
      .returning()

    // 清除内存缓存，使封禁立即生效
    invalidateIpCache(cleanIp)

    console.log(`[RiskControl] 管理员 ${user.name || user.id} 手动封禁 IP: ${cleanIp}`)
    return { success: true, data: record }
  } catch (err) {
    console.error('[RiskControl] 手动封禁 IP 失败:', err)
    throw createError({ statusCode: 500, message: '封禁操作失败' })
  }
})
