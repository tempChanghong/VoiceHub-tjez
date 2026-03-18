/**
 * GET /api/admin/risk-control/ips
 * 获取 IP 黑名单列表（支持分页）
 */
import { db } from '~/drizzle/db'
import { ipBlacklists } from '~/drizzle/schema'
import { desc, count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: '未授权访问' })
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '权限不足' })
  }

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const offset = (page - 1) * pageSize

  try {
    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(ipBlacklists)
        .orderBy(desc(ipBlacklists.bannedAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() }).from(ipBlacklists)
    ])

    const total = countResult[0]?.total ?? 0

    return {
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    }
  } catch (err) {
    console.error('[RiskControl] 获取 IP 黑名单失败:', err)
    throw createError({ statusCode: 500, message: '获取 IP 黑名单失败' })
  }
})
