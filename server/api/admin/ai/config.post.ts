/**
 * POST /api/admin/ai/config
 *
 * AI 配置 CRUD 端点。
 * 始终操作 ai_settings 表中 id=1 的单例记录：
 *   - 若记录不存在则 INSERT（首次初始化）
 *   - 若记录已存在则 UPDATE（增量更新，仅更新请求体中出现的字段）
 *
 * 安全说明：
 *   - API Key 以明文存储于数据库（Neon 传输层已加密）。
 *     前端读取时，若 apiKey 非空则返回固定掩码 "sk-***"，不回传原始值。
 *   - 若请求体中 apiKey 为掩码字符串，则跳过更新，保留数据库中的原始值。
 */

import { z } from 'zod'
import { db } from '~/drizzle/db'
import { aiSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'

// API Key 掩码标识（前端展示用，不写入数据库）
const API_KEY_MASK = 'sk-***'

// 请求体校验 Schema（所有字段均为可选，支持增量更新）
const configSchema = z.object({
  provider: z.enum(['openai', 'deepseek', 'qwen', 'custom']).optional(),
  apiKey: z.string().min(1).optional(),
  apiBaseUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
  modelName: z.string().max(100).optional(),
  complianceCriteria: z.string().max(5000).optional(),
  scoringCriteria: z.string().max(5000).optional(),
  enableAiCompliance: z.boolean().optional(),
  enableAiScoring: z.boolean().optional(),
  dailyTokenLimit: z.number().int().min(1000).optional(),
  monthlyTokenLimit: z.number().int().min(10000).optional(),
  preRejectGraceDays: z.number().int().min(1).max(30).optional(),
  scoreSortWeight: z.number().int().min(0).max(100).optional(),
  voteSortWeight: z.number().int().min(0).max(100).optional(),
  batchSize: z.number().int().min(1).max(50).optional(),
  scanIntervalMinutes: z.number().int().min(5).max(1440).optional(),
})

export default defineEventHandler(async (event) => {
  // 鉴权：仅管理员可操作
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '未授权访问' })
  }
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '只有管理员才能修改 AI 配置' })
  }

  // 解析并校验请求体
  const body = await readBody(event)
  const parsed = configSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: '请求参数无效: ' + (parsed.error?.issues?.map((e: { message: string }) => e.message).join(', ') ?? '未知错误'),
    })
  }

  const input = parsed.data

  // 构建增量更新对象（仅包含请求体中明确传入的字段）
  const updateData: Record<string, unknown> = {}

  if (input.provider !== undefined) updateData.provider = input.provider
  if (input.apiBaseUrl !== undefined) updateData.apiBaseUrl = input.apiBaseUrl || null
  if (input.modelName !== undefined) updateData.modelName = input.modelName
  if (input.complianceCriteria !== undefined) updateData.complianceCriteria = input.complianceCriteria
  if (input.scoringCriteria !== undefined) updateData.scoringCriteria = input.scoringCriteria
  if (input.enableAiCompliance !== undefined) updateData.enableAiCompliance = input.enableAiCompliance
  if (input.enableAiScoring !== undefined) updateData.enableAiScoring = input.enableAiScoring
  if (input.dailyTokenLimit !== undefined) updateData.dailyTokenLimit = input.dailyTokenLimit
  if (input.monthlyTokenLimit !== undefined) updateData.monthlyTokenLimit = input.monthlyTokenLimit
  if (input.preRejectGraceDays !== undefined) updateData.preRejectGraceDays = input.preRejectGraceDays
  if (input.scoreSortWeight !== undefined) updateData.scoreSortWeight = input.scoreSortWeight
  if (input.voteSortWeight !== undefined) updateData.voteSortWeight = input.voteSortWeight
  if (input.batchSize !== undefined) updateData.batchSize = input.batchSize
  if (input.scanIntervalMinutes !== undefined) updateData.scanIntervalMinutes = input.scanIntervalMinutes

  // API Key：若传入的是掩码则跳过，保留数据库原始值
  if (input.apiKey !== undefined && input.apiKey !== API_KEY_MASK) {
    updateData.apiKey = input.apiKey
    // 更换 API Key 时重置连通性验证状态
    updateData.connectionVerified = false
    updateData.connectionVerifiedAt = null
  }

  updateData.updatedAt = new Date()

  // 查询是否已存在单例记录
  const existing = await db
    .select({ id: aiSettings.id })
    .from(aiSettings)
    .where(eq(aiSettings.id, 1))
    .limit(1)

  let result
  if (existing.length === 0) {
    // 首次初始化：INSERT 单例记录
    const inserted = await db
      .insert(aiSettings)
      .values({
        id: 1,
        ...updateData,
      } as any)
      .returning()
    result = inserted[0]
  } else {
    // 增量更新
    const updated = await db
      .update(aiSettings)
      .set(updateData as any)
      .where(eq(aiSettings.id, 1))
      .returning()
    result = updated[0]
  }

  // 返回时对 apiKey 做掩码处理，不回传原始值
  return {
    success: true,
    settings: maskApiKey(result),
  }
})

/**
 * 将配置对象中的 apiKey 替换为掩码，避免敏感信息泄露到前端。
 */
function maskApiKey(settings: Record<string, unknown> | undefined) {
  if (!settings) return settings
  return {
    ...settings,
    apiKey: settings.apiKey ? API_KEY_MASK : null,
  }
}
