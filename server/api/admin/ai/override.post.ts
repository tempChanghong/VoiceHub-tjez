/**
 * POST /api/admin/ai/override
 *
 * 管理员对 AI 预驳回歌曲的人工干预端点。
 * 支持三种 action：
 *
 *   restore        — 从预驳回恢复：aiStatus → APPROVED，记录审计日志
 *   confirm_reject — 确认正式驳回：复用现有物理删除流程（删除投票/排期/歌曲），记录审计日志
 *   update_score   — 手动修改 AI 评分：设置 aiManualCorrected=true，记录审计日志
 *
 * 请求体：
 *   { songId: number, action: 'restore'|'confirm_reject'|'update_score', newScore?: number, reason?: string }
 *
 * 设计参考：ai_review_system_design.md §4.6、§3.2
 */

import { z } from 'zod'
import { db } from '~/drizzle/db'
import { songs, schedules, votes, requestTimes } from '~/drizzle/schema'
import { and, eq, sql } from 'drizzle-orm'
import { writeAuditLog } from '~~/server/services/aiService'
import { cacheService } from '~~/server/services/cacheService'
import { createSongRejectedNotification } from '~~/server/services/notificationService'

const overrideSchema = z.object({
  songId: z.number().int().positive(),
  action: z.enum(['restore', 'confirm_reject', 'update_score']),
  newScore: z.number().int().min(0).max(100).optional(),
  reason: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
  // 鉴权
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '未授权访问' })
  }
  if (!['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '需要管理员权限' })
  }

  // 解析并校验请求体
  const body = await readBody(event)
  const parsed = overrideSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: '请求参数无效: ' + (parsed.error?.issues?.map((e: { message: string }) => e.message).join(', ') ?? '未知错误'),
    })
  }

  const { songId, action, newScore, reason } = parsed.data

  // 额外校验：update_score 必须提供 newScore
  if (action === 'update_score' && newScore === undefined) {
    throw createError({ statusCode: 400, message: 'update_score 操作必须提供 newScore 字段' })
  }

  // 查询歌曲是否存在
  const songRows = await db.select().from(songs).where(eq(songs.id, songId)).limit(1)
  const song = songRows[0]
  if (!song) {
    throw createError({ statusCode: 404, message: '歌曲不存在' })
  }

  // ===== Action: restore — 从预驳回恢复为合规通过 =====
  if (action === 'restore') {
    if (song.aiStatus !== 'PRE_REJECTED') {
      throw createError({
        statusCode: 400,
        message: `只能恢复 PRE_REJECTED 状态的歌曲，当前状态为 ${song.aiStatus}`,
      })
    }

    await db
      .update(songs)
      .set({
        aiStatus: 'APPROVED',
        aiManualCorrected: true,
        aiManualCorrectedBy: user.id,
        aiManualCorrectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(songs.id, songId))

    await writeAuditLog({
      songId,
      action: 'MANUAL_RESTORE',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      requestPayload: JSON.stringify({ reason: reason ?? '管理员手动恢复' }).slice(0, 2000),
      operatorId: user.id,
    })

    await cacheService.invalidateCache(['voicehub:songs:list:all', 'voicehub:song_count:all'])

    return {
      success: true,
      message: `歌曲《${song.title}》已从预驳回恢复为合规通过`,
      newStatus: 'APPROVED',
    }
  }

  // ===== Action: confirm_reject — 确认正式驳回（物理删除，复用现有流程）=====
  if (action === 'confirm_reject') {
    if (!['PRE_REJECTED', 'PENDING', 'APPROVED', 'SCORED'].includes(song.aiStatus ?? '')) {
      throw createError({
        statusCode: 400,
        message: `歌曲当前状态 ${song.aiStatus} 不支持驳回操作`,
      })
    }

    const rejectReason = reason?.trim() || 'AI 合规审查未通过，管理员确认驳回'

    // 使用事务确保原子性（与现有 reject.post.ts 保持一致）
    await db.transaction(async (tx) => {
      // 删除投票
      await tx.delete(votes).where(eq(votes.songId, songId))

      // 删除排期
      await tx.delete(schedules).where(eq(schedules.songId, songId))

      // 若有投稿时段，减少已接纳数量
      if (song.hitRequestId) {
        await tx
          .update(requestTimes)
          .set({ accepted: sql`GREATEST(0, accepted - 1)` })
          .where(eq(requestTimes.id, song.hitRequestId))
          .catch(() => {
            /* 忽略，不阻塞主流程 */
          })
      }

      // 写入审计日志（在事务内，确保与删除操作原子提交）
      // 注意：writeAuditLog 内部有 try/catch，不会抛出
      await tx.insert(
        // 直接使用 db.insert 的 schema 引用
        (await import('~/drizzle/schema')).aiAuditLogs
      ).values({
        songId,
        action: 'MANUAL_OVERRIDE',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        requestPayload: JSON.stringify({ action: 'confirm_reject', reason: rejectReason }).slice(0, 2000),
        operatorId: user.id,
      })

      // 物理删除歌曲（与现有 reject.post.ts 一致）
      await tx.delete(songs).where(eq(songs.id, songId))
    })

    // 事务提交后异步发送通知（不阻塞响应）
    if (song.requesterId) {
      createSongRejectedNotification(
        song.requesterId,
        { title: song.title, artist: song.artist },
        rejectReason,
        ''
      ).catch((e: any) => {
        console.error('[override] 发送驳回通知失败:', e.message)
      })
    }

    await cacheService.invalidateCache([
      'voicehub:songs:list:all',
      'voicehub:song_count:all',
      'voicehub:schedules:list:all:all',
      'voicehub:schedule_date:all',
    ])

    return {
      success: true,
      message: `歌曲《${song.title}》已正式驳回并删除`,
      newStatus: 'REJECTED',
    }
  }

  // ===== Action: update_score — 手动修改 AI 评分 =====
  if (action === 'update_score') {
    await db
      .update(songs)
      .set({
        aiManualScore: newScore!,
        aiManualCorrected: true,
        aiManualCorrectedBy: user.id,
        aiManualCorrectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(songs.id, songId))

    await writeAuditLog({
      songId,
      action: 'MANUAL_OVERRIDE',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      requestPayload: JSON.stringify({
        action: 'update_score',
        oldScore: song.aiScore,
        newScore,
        reason: reason ?? '管理员手动修改评分',
      }).slice(0, 2000),
      operatorId: user.id,
    })

    return {
      success: true,
      message: `歌曲《${song.title}》评分已更新为 ${newScore} 分`,
      oldScore: song.aiScore,
      newScore,
    }
  }
})
