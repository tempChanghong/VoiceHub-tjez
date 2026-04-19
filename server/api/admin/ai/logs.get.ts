/**
 * GET /api/admin/ai/logs
 *
 * 查询 AI 审计日志与 Token 消耗统计。
 *
 * 返回字段包含：
 *   - logs: 审计日志列表（支持分页，包含关联的歌曲信息和操作员信息）
 *   - summary: 聚合统计信息（今日/本月 Token 消耗，估算成本等）
 *
 * 支持分页：?page=1&pageSize=50
 * 支持日期过滤：?startDate=2026-04-01&endDate=2026-04-19
 *
 * 设计参考：ai_review_system_design.md §4.7
 */

import { db } from '~/drizzle/db'
import { aiAuditLogs, songs, users } from '~/drizzle/schema'
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { getAiSettings } from '~~/server/services/aiService'

// 估算成本：以 gpt-4o-mini 为例，约 $0.45 / 1M tokens
const COST_PER_MILLION_TOKENS = 0.45

export default defineEventHandler(async (event) => {
  // 鉴权
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '未授权访问' })
  }
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '需要管理员权限' })
  }

  // 解析查询参数
  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50))
  const offset = (page - 1) * pageSize

  const startDateStr = query.startDate as string | undefined
  const endDateStr = query.endDate as string | undefined

  // 构建过滤条件
  const whereConditions = []
  if (startDateStr) {
    const start = new Date(`${startDateStr}T00:00:00.000Z`)
    if (!isNaN(start.getTime())) {
      whereConditions.push(gte(aiAuditLogs.createdAt, start))
    }
  }
  if (endDateStr) {
    const end = new Date(`${endDateStr}T23:59:59.999Z`)
    if (!isNaN(end.getTime())) {
      whereConditions.push(lte(aiAuditLogs.createdAt, end))
    }
  }

  const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined

  try {
    // 1. 并行查询日志总数与分页数据
    const [countResult, rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(aiAuditLogs)
        .where(whereClause),

      db
        .select({
          id: aiAuditLogs.id,
          action: aiAuditLogs.action,
          inputTokens: aiAuditLogs.inputTokens,
          outputTokens: aiAuditLogs.outputTokens,
          totalTokens: aiAuditLogs.totalTokens,
          modelName: aiAuditLogs.modelName,
          promptVersion: aiAuditLogs.promptVersion,
          requestPayload: aiAuditLogs.requestPayload,
          responsePayload: aiAuditLogs.responsePayload,
          latencyMs: aiAuditLogs.latencyMs,
          error: aiAuditLogs.error,
          createdAt: aiAuditLogs.createdAt,
          songId: aiAuditLogs.songId,
          songTitle: songs.title,
          songArtist: songs.artist,
          operatorId: aiAuditLogs.operatorId,
          operatorName: users.name,
        })
        .from(aiAuditLogs)
        .leftJoin(songs, eq(aiAuditLogs.songId, songs.id))
        .leftJoin(users, eq(aiAuditLogs.operatorId, users.id))
        .where(whereClause)
        .orderBy(desc(aiAuditLogs.createdAt))
        .limit(pageSize)
        .offset(offset),
    ])

    const total = countResult[0]?.total ?? 0

    // 2. 聚合统计信息（基于当前过滤条件）
    const statsResult = await db
      .select({
        totalCalls: count(),
        totalInputTokens: sql<number>`COALESCE(SUM(${aiAuditLogs.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`COALESCE(SUM(${aiAuditLogs.outputTokens}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${aiAuditLogs.totalTokens}), 0)`,
      })
      .from(aiAuditLogs)
      .where(whereClause)

    const stats = statsResult[0] || {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    }

    // 3. 查询今日和本月 Token 消耗（不受过滤条件影响，用于展示配额使用情况）
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [todayResult, monthResult] = await Promise.all([
      db
        .select({ total: sql<number>`COALESCE(SUM(${aiAuditLogs.totalTokens}), 0)` })
        .from(aiAuditLogs)
        .where(gte(aiAuditLogs.createdAt, todayStart)),
      db
        .select({ total: sql<number>`COALESCE(SUM(${aiAuditLogs.totalTokens}), 0)` })
        .from(aiAuditLogs)
        .where(gte(aiAuditLogs.createdAt, monthStart)),
    ])

    const todayTokens = Number(todayResult[0]?.total ?? 0)
    const monthTokens = Number(monthResult[0]?.total ?? 0)

    // 4. 读取配置中的配额上限
    const settings = await getAiSettings()
    const dailyLimit = settings?.dailyTokenLimit ?? 100000
    const monthlyLimit = settings?.monthlyTokenLimit ?? 2000000

    // 格式化返回数据
    const logs = rows.map((row) => ({
      id: row.id,
      action: row.action,
      tokens: {
        input: row.inputTokens,
        output: row.outputTokens,
        total: row.totalTokens,
      },
      modelName: row.modelName,
      promptVersion: row.promptVersion,
      payloads: {
        request: row.requestPayload,
        response: row.responsePayload,
      },
      latencyMs: row.latencyMs,
      error: row.error,
      createdAt: row.createdAt,
      song: {
        id: row.songId,
        title: row.songTitle,
        artist: row.songArtist,
      },
      operator: row.operatorId
        ? {
            id: row.operatorId,
            name: row.operatorName,
          }
        : null,
    }))

    const totalTokensNum = Number(stats.totalTokens)

    return {
      logs,
      summary: {
        totalCalls: Number(stats.totalCalls),
        totalInputTokens: Number(stats.totalInputTokens),
        totalOutputTokens: Number(stats.totalOutputTokens),
        totalTokens: totalTokensNum,
        estimatedCostUSD: Number(((totalTokensNum / 1000000) * COST_PER_MILLION_TOKENS).toFixed(4)),
        todayTokens,
        monthTokens,
        dailyLimit,
        monthlyLimit,
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    }
  } catch (e: any) {
    console.error('[ai-logs] 查询失败:', e.message)
    throw createError({ statusCode: 500, message: '查询审计日志失败: ' + e.message })
  }
})
