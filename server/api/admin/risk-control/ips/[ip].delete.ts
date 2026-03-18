/**
 * DELETE /api/admin/risk-control/ips/[ip]
 * 解除指定 IP 的封禁
 */
import { db } from '~/drizzle/db'
import { ipBlacklists } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { invalidateIpCache } from '~~/server/utils/ipCache'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: '未授权访问' })
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '权限不足' })
  }

  const ip = getRouterParam(event, 'ip')
  if (!ip || ip.trim() === '') {
    throw createError({ statusCode: 400, message: 'IP 参数不能为空' })
  }

  const decodedIp = decodeURIComponent(ip)

  try {
    const deleted = await db
      .delete(ipBlacklists)
      .where(eq(ipBlacklists.ip, decodedIp))
      .returning()

    if (deleted.length === 0) {
      throw createError({ statusCode: 404, message: '未找到该 IP 的封禁记录' })
    }

    // 清除内存缓存
    invalidateIpCache(decodedIp)

    console.log(`[RiskControl] 管理员 ${user.name || user.id} 解封 IP: ${decodedIp}`)
    return { success: true, message: `IP ${decodedIp} 已解除封禁` }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    console.error('[RiskControl] 解封 IP 失败:', err)
    throw createError({ statusCode: 500, message: '解封操作失败' })
  }
})
