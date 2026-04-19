/**
 * POST /api/cron/ai-scoring
 *
 * 外部 Cron 触发端点 — AI 价值评分批量扫描。
 * 由 cron-job.org 或 GitHub Actions 每 60 分钟调用一次（§7.1）。
 *
 * 执行流程：
 *   1. CRON_SECRET 鉴权（Bearer Token）
 *   2. 检查 AI 评分功能是否启用
 *   3. warmupNeon()：发送轻量查询唤醒 Neon 冷启动（§7.4）
 *   4. checkTokenBudget()：检查 Token 配额（§8.5）
 *   5. 查询最多 2 首 APPROVED/RESTORED 歌曲（适配 Vercel 10s 超时，§7.3）
 *   6. 串行处理每首歌曲（避免并发 LLM 调用超时叠加）
 *
 * Vercel 10s 超时预算分配：
 *   - Neon 冷启动预热：0~3s
 *   - 每首歌 LLM 调用：≤8.5s（aiService 内部控制）
 *   - 串行处理 2 首时，第 2 首在第 1 首完成后才开始
 *   - 因此实际每次 Cron 只处理 1~2 首，由剩余时间动态决定（§7.4）
 */

import { db } from '~/drizzle/db'
import { songs, votes } from '~/drizzle/schema'
import { asc, count, eq, inArray, sql } from 'drizzle-orm'
import { requireAiSettings } from '~~/server/services/aiService'
import { checkTokenBudget } from '~~/server/services/aiComplianceService'
import { runValueScoring } from '~~/server/services/aiScoringService'

export default defineEventHandler(async (event) => {
  // ===== 1. CRON_SECRET 鉴权 =====
  const authHeader = getHeader(event, 'authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const cronStartedAt = Date.now()

  // ===== 2. 加载并校验 AI 配置 =====
  let settings
  try {
    settings = await requireAiSettings()
  } catch (e: any) {
    return { skipped: true, reason: e.message }
  }

  if (!settings.enableAiScoring) {
    return { skipped: true, reason: 'AI scoring is disabled in settings' }
  }

  // ===== 3. Neon 冷启动预热（§7.4）=====
  const warmupMs = await warmupNeon()
  // 冷启动超过 4s 时，剩余时间不足以安全处理 2 首歌，降级为 1 首
  const maxSongs = warmupMs > 4000 ? 1 : 2

  // ===== 4. Token 预算检查（§8.5）=====
  const budget = await checkTokenBudget(settings)
  if (!budget.allowed) {
    return {
      skipped: true,
      reason: budget.reason,
      budget: {
        dailyUsed: budget.dailyUsed,
        dailyLimit: budget.dailyLimit,
        monthlyUsed: budget.monthlyUsed,
        monthlyLimit: budget.monthlyLimit,
      },
    }
  }

  // ===== 5. 查询待评分歌曲（APPROVED/RESTORED，按提交时间升序，优先处理最早的）=====
  // 评分需要参考投票数，所以这里使用子查询或关联查询获取 voteCount
  const pendingSongs = await db
    .select({
      song: songs,
      voteCount: sql<number>`(SELECT count(*) FROM ${votes} WHERE ${votes.songId} = ${songs.id})`.mapWith(Number),
    })
    .from(songs)
    .where(
      inArray(songs.aiStatus, ['APPROVED', 'RESTORED'])
    )
    .orderBy(asc(songs.createdAt))
    .limit(maxSongs)

  if (pendingSongs.length === 0) {
    return {
      processed: 0,
      message: 'No pending songs to score',
      warmupMs,
      elapsedMs: Date.now() - cronStartedAt,
    }
  }

  // ===== 6. 串行处理（§7.3：控制总耗时，避免并发超时叠加）=====
  const results: Array<{
    songId: number
    status: string
    committed: boolean
    latencyMs: number
    error?: string
  }> = []

  for (const { song, voteCount } of pendingSongs) {
    // 检查剩余时间：若距离 9s 已不足 1s 缓冲，停止处理
    const elapsed = Date.now() - cronStartedAt
    if (elapsed > 9000) {
      console.warn(`[ai-scoring cron] Time budget exhausted after ${elapsed}ms, stopping early`)
      break
    }

    try {
      // 将 voteCount 附加到 song 对象上，供 runValueScoring 使用
      const songWithVotes = { ...song, voteCount } as any
      const result = await runValueScoring(songWithVotes, settings)
      results.push({
        songId: song.id,
        status: result.committed ? result.newStatus : 'SKIPPED_CONCURRENT',
        committed: result.committed,
        latencyMs: result.latencyMs,
      })
    } catch (e: any) {
      console.error(`[ai-scoring cron] Song ${song.id} failed:`, e.message)
      results.push({
        songId: song.id,
        status: 'ERROR',
        committed: false,
        latencyMs: Date.now() - cronStartedAt,
        error: e.message,
      })
    }
  }

  return {
    processed: results.length,
    results,
    warmupMs,
    elapsedMs: Date.now() - cronStartedAt,
    budget: {
      dailyUsed: budget.dailyUsed,
      dailyLimit: budget.dailyLimit,
    },
  }
})

/**
 * 发送轻量查询唤醒 Neon 冷启动（§7.4）。
 * 返回查询延迟（毫秒），供调用方判断是否降级处理量。
 */
async function warmupNeon(): Promise<number> {
  const start = Date.now()
  try {
    await db.execute(sql`SELECT 1`)
  } catch {
    // 预热失败不阻塞主流程，返回一个保守的高延迟值触发降级
    return 5000
  }
  const latency = Date.now() - start
  if (latency > 1000) {
    console.log(`[ai-scoring cron] Neon cold start detected: ${latency}ms`)
  }
  return latency
}
