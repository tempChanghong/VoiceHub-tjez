/**
 * AI 价值评分服务 — Phase 3 核心逻辑
 *
 * 职责：
 *   1. 构建价值评分 System Prompt（含管理员自定义准则）
 *   2. 调用 aiService.callLLM 获取 LLM 打分结果
 *   3. 使用 Drizzle 乐观锁（UPDATE ... WHERE aiStatus IN ('APPROVED', 'RESTORED') RETURNING）
 *      原子性地更新歌曲状态为 SCORED，防止并发冲突
 *
 * 设计参考：ai_review_system_design.md §5.2、§8.1
 */

import { db } from '~/drizzle/db'
import { songs } from '~/drizzle/schema'
import type { AiSettings, Song } from '~/drizzle/schema'
import { and, eq, inArray } from 'drizzle-orm'
import {
  callLLM,
  parseAiResponse,
  sanitizeUserInput,
  writeAuditLog,
  AiResponseParseError,
} from '~~/server/services/aiService'

// ===================== 类型定义 =====================

/**
 * LLM 价值评分的输出结构（对应 §5.2 的 JSON Schema）
 */
export interface ScoringVerdict {
  totalScore: number
  dimensions: Array<{
    name: string
    score: number
    maxScore: number
    reason: string
  }>
  summary: string
  highlightTags: string[]
}

/**
 * runValueScoring 的返回值
 */
export interface ScoringCheckResult {
  songId: number
  newStatus: 'SCORED'
  verdict: ScoringVerdict
  /** false 表示乐观锁竞争失败（歌曲已被其他请求处理），调用方应跳过 */
  committed: boolean
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

// ===================== Prompt 模板（§5.2） =====================

/**
 * 价值评分 System Prompt 模板。
 * 占位符 {{ADMIN_SCORING_CRITERIA}} 在运行时替换为管理员自定义准则。
 */
const SCORING_SYSTEM_PROMPT_TEMPLATE = `# 角色定义
你是一个校园广播站歌曲价值评估系统。你的任务是从多个维度对歌曲进行评分，帮助管理员对歌曲播放顺序做出合理排序。

# 评分维度（总分 100 分）

## 基础维度（共 60 分）
1. **校园适配度** (0-20分)
   - 歌曲风格是否适合校园广播？
   - 是否能营造积极向上的校园氛围？
   - 上课间操/午间/放学等不同时段的适配性

2. **歌曲知名度与传唱度** (0-20分)
   - 该歌曲是否广为人知？
   - 是否容易引起学生共鸣？
   - 是否为经典/热门曲目？

3. **内容积极性** (0-20分)
   - 歌曲传达的情感和价值观是否积极？
   - 是否适合未成年人群体？
   - 是否具有正面的教育/启发意义？

## 加权维度（共 40 分）
4. **语种权重** (0-15分)
   - 中文歌曲：12-15分
   - 英文歌曲：8-12分
   - 日韩/小语种歌曲：5-10分
   - 纯音乐：10-13分

5. **时效性与话题性** (0-15分)
   - 是否为当下热门/流行曲目？
   - 是否与校园活动、节日、季节契合？
   - 是否具有话题讨论价值？

6. **多样性贡献** (0-10分)
   - 该歌曲是否为播放列表带来风格多样性？
   - 是否避免了与其他已排期歌曲的高度重复？

# 管理员自定义评分准则
{{ADMIN_SCORING_CRITERIA}}

# 输入格式
{"title":"歌曲名称","artist":"歌手/艺人","musicPlatform":"平台来源","recommendation":"用户推荐语","voteCount":12,"requestedAt":"2026-04-19T10:00:00Z"}

# 输出格式（严格 JSON，不要添加任何多余文字）
{"totalScore":75,"dimensions":[{"name":"校园适配度","score":16,"maxScore":20,"reason":"理由"}],"summary":"综合评价（不超过100字）","highlightTags":["适合午间播放","经典华语"]}

# 重要规则
- 评分必须均匀分布，避免所有歌曲都集中在 70-80 分区间。
- 根据歌曲名称和歌手的公开信息进行客观评估。
- 如果你对某首歌曲完全不了解，给出 50 分的中性评分，并在 summary 中说明。
- 绝对不要在 JSON 输出之前或之后附加任何解释性文字。`

/** 价值评分 Prompt 版本号（用于审计日志 A/B 对比） */
const SCORING_PROMPT_VERSION = 'scoring-v1'

// ===================== 核心函数 =====================

/**
 * 对单首歌曲执行 AI 价值评分。
 *
 * 并发安全策略（§8.1）：
 *   使用 Drizzle 的 `.update().where(inArray(songs.aiStatus, ['APPROVED', 'RESTORED'])).returning()` 乐观锁。
 *   若 RETURNING 返回空数组，说明该歌曲已被其他并发请求处理，本次调用直接返回
 *   `committed: false`，调用方（Cron 端点）应跳过该歌曲，不重复处理。
 *
 * @param song     待评分的歌曲记录（必须处于 aiStatus='APPROVED' 或 'RESTORED' 状态）
 * @param settings 已加载的 AI 配置（避免重复查询）
 * @param operatorId 若为人工触发，传入管理员 ID
 */
export async function runValueScoring(
  song: Song,
  settings: AiSettings,
  operatorId?: number
): Promise<ScoringCheckResult> {
  const startedAt = Date.now()

  // 构建 System Prompt（注入管理员自定义准则）
  const systemPrompt = SCORING_SYSTEM_PROMPT_TEMPLATE.replace(
    '{{ADMIN_SCORING_CRITERIA}}',
    settings.scoringCriteria?.trim() || '（无额外准则，按默认规则执行）'
  )

  // 构建 User Prompt（对用户输入做安全清洗，防止 Prompt 注入）
  // 评分时需要参考投票数和提交时间
  const userPayload = JSON.stringify({
    title: sanitizeUserInput(song.title),
    artist: sanitizeUserInput(song.artist),
    musicPlatform: song.musicPlatform ?? 'other',
    recommendation: sanitizeUserInput(song.recommendation),
    // 注意：这里假设调用方传入的 song 对象包含了 voteCount（可能需要通过关联查询获取）
    // 如果没有，默认为 0
    voteCount: (song as any).voteCount ?? 0,
    requestedAt: song.createdAt.toISOString(),
  })

  // 调用 LLM（callLLM 内部已处理超时、审计日志写入）
  // 评分任务输出较长（包含多个维度的 reason），maxTokens 设为 500
  const llmResult = await callLLM(systemPrompt, userPayload, {
    songId: song.id,
    action: 'VALUE_SCORE',
    promptVersion: SCORING_PROMPT_VERSION,
    operatorId,
    maxTokens: 500,
    temperature: 0.3, // 评分任务可以稍微增加一点温度，让评价更自然
    jsonMode: true,
    settings,
  })

  // 鲁棒解析 LLM 响应
  let verdict: ScoringVerdict
  try {
    verdict = parseAiResponse<ScoringVerdict>(llmResult.rawText)
    // 基础字段校验：确保 totalScore 存在且为数字
    if (typeof verdict.totalScore !== 'number') {
      throw new Error('verdict.totalScore is not a number')
    }
    // 确保分数在 0-100 之间
    verdict.totalScore = Math.max(0, Math.min(100, Math.round(verdict.totalScore)))
  } catch (e) {
    // 解析失败：记录错误审计日志，歌曲保持原状态（§8.3 关键不变量）
    const parseError = e instanceof AiResponseParseError ? e : new AiResponseParseError(llmResult.rawText)
    await writeAuditLog({
      songId: song.id,
      action: 'SCORING_PARSE_ERROR',
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      totalTokens: llmResult.totalTokens,
      modelName: llmResult.modelName,
      promptVersion: SCORING_PROMPT_VERSION,
      requestPayload: userPayload.slice(0, 2000),
      responsePayload: llmResult.rawText.slice(0, 2000),
      latencyMs: Date.now() - startedAt,
      error: parseError.message,
      operatorId: operatorId ?? null,
    })
    throw parseError
  }

  // 构建写入数据库的评分明细 JSON
  const scoreBreakdownJson = JSON.stringify({
    dimensions: verdict.dimensions ?? [],
    summary: verdict.summary ?? '',
    highlightTags: verdict.highlightTags ?? [],
  })

  // ===== 乐观锁更新（§8.1 并发冲突解决方案）=====
  // 条件：WHERE id = ? AND aiStatus IN ('APPROVED', 'RESTORED')
  // 若另一个并发请求已将该歌曲更新为 SCORED，
  // 则此 UPDATE 影响 0 行，RETURNING 返回空数组，committed = false。
  // 注意：如果 aiManualCorrected 为 true，说明管理员已经手动改过分数，不应被 Cron 覆盖
  const updated = await db
    .update(songs)
    .set({
      aiStatus: 'SCORED',
      aiScore: verdict.totalScore,
      aiScoreBreakdown: scoreBreakdownJson,
      aiScoreAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(songs.id, song.id),
        inArray(songs.aiStatus, ['APPROVED', 'RESTORED']),
        eq(songs.aiManualCorrected, false) // 防止覆盖人工修改的分数
      )
    )
    .returning({ id: songs.id })

  const committed = updated.length > 0

  if (committed) {
    // 写入评分成功的专项审计日志
    await writeAuditLog({
      songId: song.id,
      action: 'VALUE_SCORE',
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      totalTokens: llmResult.totalTokens,
      modelName: llmResult.modelName,
      promptVersion: SCORING_PROMPT_VERSION,
      requestPayload: userPayload.slice(0, 2000),
      responsePayload: scoreBreakdownJson.slice(0, 2000),
      latencyMs: Date.now() - startedAt,
      operatorId: operatorId ?? null,
    })
  } else {
    // 乐观锁竞争失败：记录跳过日志，便于排障
    console.warn(
      `[aiScoringService] Song ${song.id} skipped: aiStatus was no longer APPROVED/RESTORED or was manually corrected`
    )
  }

  return {
    songId: song.id,
    newStatus: 'SCORED',
    verdict,
    committed,
    inputTokens: llmResult.inputTokens,
    outputTokens: llmResult.outputTokens,
    latencyMs: Date.now() - startedAt,
  }
}
