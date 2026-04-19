/**
 * GET /api/admin/ai/pre-rejected
 *
 * 查询 AI 预驳回歌曲列表（aiStatus = 'PRE_REJECTED'）。
 *
 * 返回字段包含：
 *   - 歌曲基本信息（title、artist、musicPlatform）
 *   - AI 给出的驳回原因（aiComplianceResult 解析后）
 *   - 预驳回时间（aiPreRejectedAt）
 *   - 自动转正式驳回的截止时间（autoRejectAt = aiPreRejectedAt + preRejectGraceDays 天）
 *   - 提交者信息（name、grade、class）
 *
 * 支持分页：?page=1&pageSize=20
 */

import { db } from '~/drizzle/db'
import { songs, users } from '~/drizzle/schema'
import { count, desc, eq } from 'drizzle-orm'
import { getAiSettings } from '~~/server/services/aiService'

export default defineEventHandler(async (event) => {
  // 鉴权
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '未授权访问' })
  }
  if (!['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '需要管理员权限' })
  }

  // 分页参数
  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const offset = (page - 1) * pageSize

  // 读取宽限天数配置（用于计算 autoRejectAt）
  const settings = await getAiSettings()
  const graceDays = settings?.preRejectGraceDays ?? 3

  try {
    // 并行查询总数与分页数据
    const [countResult, rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(songs)
        .where(eq(songs.aiStatus, 'PRE_REJECTED')),

      db
        .select({
          id: songs.id,
          title: songs.title,
          artist: songs.artist,
          musicPlatform: songs.musicPlatform,
          musicId: songs.musicId,
          cover: songs.cover,
          recommendation: songs.recommendation,
          aiStatus: songs.aiStatus,
          aiComplianceResult: songs.aiComplianceResult,
          aiPreRejectedAt: songs.aiPreRejectedAt,
          createdAt: songs.createdAt,
          requesterId: songs.requesterId,
          requesterName: users.name,
          requesterGrade: users.grade,
          requesterClass: users.class,
        })
        .from(songs)
        .leftJoin(users, eq(songs.requesterId, users.id))
        .where(eq(songs.aiStatus, 'PRE_REJECTED'))
        .orderBy(desc(songs.aiPreRejectedAt))
        .limit(pageSize)
        .offset(offset),
    ])

    const total = countResult[0]?.total ?? 0

    // 格式化返回数据：解析 aiComplianceResult JSON，计算 autoRejectAt
    const items = rows.map((row) => {
      let complianceResult: {
        passed?: boolean
        reason?: string
        categories?: string[]
        confidence?: number
        risk_level?: string
      } | null = null

      if (row.aiComplianceResult) {
        try {
          complianceResult = JSON.parse(row.aiComplianceResult)
        } catch {
          // JSON 解析失败时保持 null，前端降级展示
        }
      }

      // 计算自动转正式驳回的截止时间
      const autoRejectAt = row.aiPreRejectedAt
        ? new Date(new Date(row.aiPreRejectedAt).getTime() + graceDays * 24 * 60 * 60 * 1000)
        : null

      return {
        id: row.id,
        title: row.title,
        artist: row.artist,
        musicPlatform: row.musicPlatform,
        musicId: row.musicId,
        cover: row.cover,
        recommendation: row.recommendation,
        aiStatus: row.aiStatus,
        aiComplianceResult: complianceResult,
        aiPreRejectedAt: row.aiPreRejectedAt,
        autoRejectAt,
        createdAt: row.createdAt,
        requester: {
          id: row.requesterId,
          name: row.requesterName,
          grade: row.requesterGrade,
          class: row.requesterClass,
        },
      }
    })

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      graceDays,
    }
  } catch (e: any) {
    console.error('[pre-rejected] 查询失败:', e.message)
    throw createError({ statusCode: 500, message: '查询预驳回列表失败: ' + e.message })
  }
})
