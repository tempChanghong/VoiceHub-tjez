/**
 * POST /api/cron/ai-expire
 *
 * 外部 Cron 触发端点 — 预驳回超时自动转正式驳回。
 * 由 cron-job.org 或 GitHub Actions 每日 00:00 调用一次（§7.1）。
 *
 * 逻辑：
 *   扫描所有满足以下条件的歌曲：
 *     - aiStatus = 'PRE_REJECTED'
 *     - aiPreRejectedAt + preRejectGraceDays 天 ≤ 当前时间
 *   对每首超时歌曲执行物理删除（与 confirm_reject 流程一致）：
 *     删除投票 → 删除排期 → 减少投稿时段计数 → 删除歌曲 → 写入审计日志
 *
 * 设计参考：ai_review_system_design.md §3.2、§7.1
 *
 * 注意：此端点无 Token 消耗，不受 Token 预算限制。
 * 由于只做数据库操作，Vercel 10s 超时通常足够（批量删除速度远快于 LLM 调用）。
 */

import { db } from '~/drizzle/db'
import { songs, schedules, votes, requestTimes, aiAuditLogs } from '~/drizzle/schema'
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm'
import { getAiSettings } from '~~/server/services/aiService'
import { cacheService } from '~~/server/services/cacheService'
import { createSongRejectedNotification } from '~~/server/services/notificationService'

export default defineEventHandler(async (event) => {
  // ===== CRON_SECRET 鉴权 =====
  const authHeader = getHeader(event, 'authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const startedAt = Date.now()

  // 读取宽限天数配置
  const settings = await getAiSettings()
  const graceDays = settings?.preRejectGraceDays ?? 3

  // 计算超时截止时间：aiPreRejectedAt ≤ 当前时间 - graceDays 天
  const expireThreshold = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000)

  // 查询所有已超时的预驳回歌曲
  const expiredSongs = await db
    .select()
    .from(songs)
    .where(
      and(
        eq(songs.aiStatus, 'PRE_REJECTED'),
        isNotNull(songs.aiPreRejectedAt),
        lte(songs.aiPreRejectedAt, expireThreshold)
      )
    )

  if (expiredSongs.length === 0) {
    return {
      expired: 0,
      message: 'No expired pre-rejected songs found',
      graceDays,
      threshold: expireThreshold.toISOString(),
      elapsedMs: Date.now() - startedAt,
    }
  }

  const results: Array<{
    songId: number
    title: string
    success: boolean
    error?: string
  }> = []

  // 逐首处理（串行，确保每首都有完整的事务保障）
  for (const song of expiredSongs) {
    try {
      await db.transaction(async (tx) => {
        // 删除投票
        await tx.delete(votes).where(eq(votes.songId, song.id))

        // 删除排期
        await tx.delete(schedules).where(eq(schedules.songId, song.id))

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

        // 写入审计日志
        await tx.insert(aiAuditLogs).values({
          songId: song.id,
          action: 'AUTO_REJECT',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          latencyMs: 0,
          requestPayload: JSON.stringify({
            reason: `预驳回超过 ${graceDays} 天宽限期，自动转正式驳回`,
            aiPreRejectedAt: song.aiPreRejectedAt,
            expireThreshold: expireThreshold.toISOString(),
          }).slice(0, 2000),
        })

        // 物理删除歌曲
        await tx.delete(songs).where(eq(songs.id, song.id))
      })

      // 事务提交后异步发送通知
      if (song.requesterId) {
        createSongRejectedNotification(
          song.requesterId,
          { title: song.title, artist: song.artist },
          `您提交的歌曲《${song.title}》经 AI 审核预驳回后超过 ${graceDays} 天未被管理员恢复，已自动正式驳回。`,
          ''
        ).catch((e: any) => {
          console.error(`[ai-expire cron] 发送通知失败 (songId=${song.id}):`, e.message)
        })
      }

      results.push({ songId: song.id, title: song.title, success: true })
    } catch (e: any) {
      console.error(`[ai-expire cron] 处理歌曲 ${song.id} 失败:`, e.message)
      results.push({ songId: song.id, title: song.title, success: false, error: e.message })
    }
  }

  // 清除歌曲列表缓存
  const successCount = results.filter((r) => r.success).length
  if (successCount > 0) {
    await cacheService.invalidateCache([
      'voicehub:songs:list:all',
      'voicehub:song_count:all',
      'voicehub:schedules:list:all:all',
      'voicehub:schedule_date:all',
    ]).catch(() => {
      /* 缓存清除失败不影响主流程 */
    })
  }

  return {
    expired: successCount,
    failed: results.filter((r) => !r.success).length,
    results,
    graceDays,
    threshold: expireThreshold.toISOString(),
    elapsedMs: Date.now() - startedAt,
  }
})
