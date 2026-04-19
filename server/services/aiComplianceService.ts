/**
 * AI 合规审查服务 — Phase 2 核心逻辑
 *
 * 职责：
 *   1. 构建合规审查 System Prompt（含管理员自定义准则）
 *   2. 调用 aiService.callLLM 获取 LLM 判定结果
 *   3. 使用 Drizzle 乐观锁（UPDATE ... WHERE aiStatus='PENDING' RETURNING）
 *      原子性地更新歌曲状态，天然防止并发冲突（§8.1）
 *   4. 导出 checkTokenBudget 供 Cron 端点在调用前做预算检查（§8.5）
 *
 * 设计参考：ai_review_system_design.md §5.1、§8.1、§8.5
 */

import { db } from '~/drizzle/db'
import { songs, aiAuditLogs } from '~/drizzle/schema'
import type { AiSettings, Song } from '~/drizzle/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import {
  callLLM,
  parseAiResponse,
  sanitizeUserInput,
  writeAuditLog,
  AiResponseParseError,
  AiTimeoutError,
} from '~~/server/services/aiService'

// ===================== 类型定义 =====================

/**
 * LLM 合规审查的输出结构（对应 §5.1 的 JSON Schema）
 */
export interface ComplianceVerdict {
  passed: boolean
  confidence: number
  reason: string
  categories: string[]
  risk_level: 'none' | 'low' | 'medium' | 'high' | 'critical'
}

/**
 * runComplianceCheck 的返回值
 */
export interface ComplianceCheckResult {
  songId: number
  /** 最终写入数据库的状态 */
  newStatus: 'APPROVED' | 'PRE_REJECTED'
  verdict: ComplianceVerdict
  /** false 表示乐观锁竞争失败（歌曲已被其他请求处理），调用方应跳过 */
  committed: boolean
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

// ===================== Prompt 模板（§5.1） =====================

/**
 * 合规审查 System Prompt 模板。
 * 占位符 {{ADMIN_COMPLIANCE_CRITERIA}} 在运行时替换为管理员自定义准则。
 */
const COMPLIANCE_SYSTEM_PROMPT_TEMPLATE = `# 角色定义
你是一个专业的校园广播站歌曲合规审核系统。你的唯一任务是判断一首歌曲是否适合在中国大陆高中校园广播中播放。

# 审核维度（按严重程度排序）
1. **法律合规**（一票否决）：
   - 涉及国家法律法规明确禁止传播的内容
   - 涉及政治敏感话题
   - 涉及劣迹/违法艺人的作品

2. **内容健康**（一票否决）：
   - 歌词包含明显低俗、暴力、毒品、自杀自残等不适合未成年人的内容
   - 歌曲内容宣扬消极、违法或反社会价值观

3. **校园适宜性**（参考评估）：
   - 歌曲风格是否过于吵闹或不适合广播环境（如纯 DJ/电音）
   - 是否有不适合校园场景的恋爱/成人主题

# 管理员自定义审核准则
{{ADMIN_COMPLIANCE_CRITERIA}}

# 输入格式
你将收到如下 JSON 格式的歌曲信息：
{"title":"歌曲名称","artist":"歌手/艺人","musicPlatform":"netease | bilibili | other","recommendation":"用户的推荐语（可能为空）"}

# 输出格式（严格 JSON，不要添加任何多余文字）
{"passed":true,"confidence":0.95,"reason":"判断理由（不超过200字）","categories":[],"risk_level":"none"}

# 重要规则
- 当你不确定某首歌是否违规时，倾向于放行（passed=true），并将 confidence 设为较低值。
- 仅根据歌曲名称和歌手信息进行判断，不要臆测歌词内容。
- 绝对不要在 JSON 输出之前或之后附加任何解释性文字。`

/** 合规审查 Prompt 版本号（用于审计日志 A/B 对比） */
const COMPLIANCE_PROMPT_VERSION = 'compliance-v1'

// ===================== 核心函数 =====================

/**
 * 对单首歌曲执行 AI 合规审查。
 *
 * 并发安全策略（§8.1）：
 *   使用 Drizzle 的 `.update().where(eq(songs.aiStatus, 'PENDING')).returning()` 乐观锁。
 *   若 RETURNING 返回空数组，说明该歌曲已被其他并发请求处理，本次调用直接返回
 *   `committed: false`，调用方（Cron 端点）应跳过该歌曲，不重复处理。
 *
 * @param song     待审核的歌曲记录（必须处于 aiStatus='PENDING' 状态）
 * @param settings 已加载的 AI 配置（避免重复查询）
 * @param operatorId 若为人工触发，传入管理员 ID
 */
export async function runComplianceCheck(
  song: Song,
  settings: AiSettings,
  operatorId?: number
): Promise<ComplianceCheckResult> {
  const startedAt = Date.now()

  // 构建 System Prompt（注入管理员自定义准则）
  const systemPrompt = COMPLIANCE_SYSTEM_PROMPT_TEMPLATE.replace(
    '{{ADMIN_COMPLIANCE_CRITERIA}}',
    settings.complianceCriteria?.trim() || '（无额外准则，按默认规则执行）'
  )

  // 构建 User Prompt（对用户输入做安全清洗，防止 Prompt 注入）
  const userPayload = JSON.stringify({
    title: sanitizeUserInput(song.title),
    artist: sanitizeUserInput(song.artist),
    musicPlatform: song.musicPlatform ?? 'other',
    recommendation: sanitizeUserInput(song.recommendation),
  })

  // 调用 LLM（callLLM 内部已处理超时、审计日志写入）
  const llmResult = await callLLM(systemPrompt, userPayload, {
    songId: song.id,
    action: 'COMPLIANCE_SCAN',
    promptVersion: COMPLIANCE_PROMPT_VERSION,
    operatorId,
    maxTokens: 300,
    temperature: 0.1,
    jsonMode: true,
    settings,
  })

  // 鲁棒解析 LLM 响应
  let verdict: ComplianceVerdict
  try {
    verdict = parseAiResponse<ComplianceVerdict>(llmResult.rawText)
    // 基础字段校验：确保 passed 字段存在
    if (typeof verdict.passed !== 'boolean') {
      throw new Error('verdict.passed is not boolean')
    }
  } catch (e) {
    // 解析失败：记录错误审计日志，歌曲保持 PENDING 状态（§8.3 关键不变量）
    const parseError = e instanceof AiResponseParseError ? e : new AiResponseParseError(llmResult.rawText)
    await writeAuditLog({
      songId: song.id,
      action: 'COMPLIANCE_PARSE_ERROR',
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      totalTokens: llmResult.totalTokens,
      modelName: llmResult.modelName,
      promptVersion: COMPLIANCE_PROMPT_VERSION,
      requestPayload: userPayload.slice(0, 2000),
      responsePayload: llmResult.rawText.slice(0, 2000),
      latencyMs: Date.now() - startedAt,
      error: parseError.message,
      operatorId: operatorId ?? null,
    })
    throw parseError
  }

  // 根据 LLM 判定结果决定目标状态
  const newStatus: 'APPROVED' | 'PRE_REJECTED' = verdict.passed ? 'APPROVED' : 'PRE_REJECTED'

  // 构建写入数据库的合规结果 JSON
  const complianceResultJson = JSON.stringify({
    passed: verdict.passed,
    confidence: verdict.confidence ?? null,
    reason: verdict.reason ?? '',
    categories: verdict.categories ?? [],
    risk_level: verdict.risk_level ?? 'none',
  })

  // ===== 乐观锁更新（§8.1 并发冲突解决方案）=====
  // 条件：WHERE id = ? AND aiStatus = 'PENDING'
  // 若另一个并发请求已将该歌曲更新为非 PENDING 状态，
  // 则此 UPDATE 影响 0 行，RETURNING 返回空数组，committed = false。
  const updated = await db
    .update(songs)
    .set({
      aiStatus: newStatus,
      aiComplianceResult: complianceResultJson,
      aiComplianceAt: new Date(),
      // 预驳回时记录时间戳，供 Cron 超时自动驳回使用
      ...(newStatus === 'PRE_REJECTED' ? { aiPreRejectedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(songs.id, song.id),
        eq(songs.aiStatus, 'PENDING')
      )
    )
    .returning({ id: songs.id })

  const committed = updated.length > 0

  if (committed) {
    // 写入合规通过/预驳回的专项审计日志
    await writeAuditLog({
      songId: song.id,
      action: newStatus === 'APPROVED' ? 'COMPLIANCE_PASS' : 'COMPLIANCE_PRE_REJECT',
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      totalTokens: llmResult.totalTokens,
      modelName: llmResult.modelName,
      promptVersion: COMPLIANCE_PROMPT_VERSION,
      requestPayload: userPayload.slice(0, 2000),
      responsePayload: complianceResultJson.slice(0, 2000),
      latencyMs: Date.now() - startedAt,
      operatorId: operatorId ?? null,
    })
  } else {
    // 乐观锁竞争失败：记录跳过日志，便于排障
    console.warn(
      `[aiComplianceService] Song ${song.id} skipped: aiStatus was no longer PENDING (concurrent update detected)`
    )
  }

  return {
    songId: song.id,
    newStatus,
    verdict,
    committed,
    inputTokens: llmResult.inputTokens,
    outputTokens: llmResult.outputTokens,
    latencyMs: Date.now() - startedAt,
  }
}

// ===================== Token 预算检查（§8.5） =====================

export interface TokenBudgetResult {
  allowed: boolean
  reason?: string
  dailyUsed: number
  monthlyUsed: number
  dailyLimit: number
  monthlyLimit: number
}

/**
 * 检查今日和本月的 Token 消耗是否已超出 ai_settings 中配置的上限。
 * 供 Cron 端点在批量处理前调用，避免超额消耗 LLM 费用（§8.5）。
 *
 * @param settings 已加载的 AI 配置
 */
export async function checkTokenBudget(settings: AiSettings): Promise<TokenBudgetResult> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  // 查询今日已消耗 Token
  const dailyRows = await db
    .select({ total: sql<number>`COALESCE(SUM(${aiAuditLogs.totalTokens}), 0)` })
    .from(aiAuditLogs)
    .where(gte(aiAuditLogs.createdAt, todayStart))

  const dailyUsed = Number(dailyRows[0]?.total ?? 0)

  if (dailyUsed >= settings.dailyTokenLimit!) {
    return {
      allowed: false,
      reason: `日 Token 配额已耗尽 (${dailyUsed}/${settings.dailyTokenLimit})`,
      dailyUsed,
      monthlyUsed: 0,
      dailyLimit: settings.dailyTokenLimit!,
      monthlyLimit: settings.monthlyTokenLimit!,
    }
  }

  // 查询本月已消耗 Token
  const monthlyRows = await db
    .select({ total: sql<number>`COALESCE(SUM(${aiAuditLogs.totalTokens}), 0)` })
    .from(aiAuditLogs)
    .where(gte(aiAuditLogs.createdAt, monthStart))

  const monthlyUsed = Number(monthlyRows[0]?.total ?? 0)

  if (monthlyUsed >= settings.monthlyTokenLimit!) {
    return {
      allowed: false,
      reason: `月 Token 配额已耗尽 (${monthlyUsed}/${settings.monthlyTokenLimit})`,
      dailyUsed,
      monthlyUsed,
      dailyLimit: settings.dailyTokenLimit!,
      monthlyLimit: settings.monthlyTokenLimit!,
    }
  }

  return {
    allowed: true,
    dailyUsed,
    monthlyUsed,
    dailyLimit: settings.dailyTokenLimit!,
    monthlyLimit: settings.monthlyTokenLimit!,
  }
}
