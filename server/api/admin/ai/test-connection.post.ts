/**
 * POST /api/admin/ai/test-connection
 *
 * LLM 连通性校验端点。
 *
 * 流程：
 *   1. 从请求体读取临时配置（允许在保存前先测试）；
 *      若请求体中 apiKey 为掩码，则回退到数据库中已保存的 apiKey。
 *   2. 发送极简 Prompt（"Reply with OK"，max_tokens=5）验证连通性。
 *   3. 成功后将 connectionVerified=true 写入 ai_settings 表。
 *   4. 返回连通状态、延迟、实际使用的模型名。
 */

import { z } from 'zod'
import { db } from '~/drizzle/db'
import { aiSettings } from '~/drizzle/schema'
import type { AiSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import {
  callLLM,
  getAiSettings,
  AiTimeoutError,
} from '~~/server/services/aiService'

const API_KEY_MASK = 'sk-***'

// 请求体：允许传入临时配置覆盖数据库值（保存前预测试场景）
const testSchema = z.object({
  apiKey: z.string().optional(),
  apiBaseUrl: z.string().optional(),
  modelName: z.string().optional(),
  provider: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  // 鉴权
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '未授权访问' })
  }
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '只有管理员才能测试 AI 连接' })
  }

  const body = await readBody(event)
  const parsed = testSchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: '请求参数无效' })
  }

  const input = parsed.data

  // 加载数据库中已保存的配置作为基础
  const savedSettings = await getAiSettings()

  // 若请求体中 apiKey 为掩码或未传入，则使用数据库中的原始值
  const effectiveApiKey =
    input.apiKey && input.apiKey !== API_KEY_MASK
      ? input.apiKey
      : savedSettings?.apiKey ?? null

  if (!effectiveApiKey) {
    return {
      success: false,
      message: '未配置 API Key，请先在 AI 配置页面填写',
      latencyMs: 0,
    }
  }

  // 构建用于本次测试的临时配置对象（不写入数据库）
  const testSettings: AiSettings = {
    ...(savedSettings ?? buildDefaultSettings()),
    apiKey: effectiveApiKey,
    apiBaseUrl: input.apiBaseUrl ?? savedSettings?.apiBaseUrl ?? null,
    modelName: input.modelName ?? savedSettings?.modelName ?? 'openai/gpt-4o-mini',
    provider: (input.provider ?? savedSettings?.provider ?? 'openai') as AiSettings['provider'],
  }

  const startedAt = Date.now()

  try {
    // 发送极简 Prompt，仅验证连通性，控制 Token 消耗到最低
    const result = await callLLM(
      'You are a connectivity test assistant. Reply with exactly: OK',
      'Reply with OK',
      {
        songId: 0,
        action: 'CONNECTION_TEST',
        promptVersion: 'v1',
        operatorId: user.id,
        maxTokens: 5,
        temperature: 0,
        timeoutMs: 8000,
        settings: testSettings,
      }
    )

    const latencyMs = Date.now() - startedAt

    // 连通成功：将验证状态写入数据库（仅当 id=1 记录存在时）
    if (savedSettings) {
      await db
        .update(aiSettings)
        .set({
          connectionVerified: true,
          connectionVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiSettings.id, 1))
    }

    return {
      success: true,
      message: '连接成功',
      latencyMs,
      modelName: result.modelName,
      response: result.rawText.slice(0, 50),
    }
  } catch (e: any) {
    const latencyMs = Date.now() - startedAt
    const isTimeout = e instanceof AiTimeoutError

    // 连通失败：重置验证状态
    if (savedSettings) {
      await db
        .update(aiSettings)
        .set({
          connectionVerified: false,
          connectionVerifiedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(aiSettings.id, 1))
        .catch(() => {
          /* 忽略写入失败，不影响响应 */
        })
    }

    return {
      success: false,
      message: isTimeout
        ? `连接超时（${latencyMs}ms），请检查网络或 API Base URL`
        : `连接失败: ${e?.message ?? String(e)}`,
      latencyMs,
    }
  }
})

/**
 * 当 ai_settings 表尚无记录时，构建一个内存中的默认配置对象，
 * 仅用于本次连通性测试，不写入数据库。
 */
function buildDefaultSettings(): AiSettings {
  const now = new Date()
  return {
    id: 0,
    provider: 'openai',
    apiKey: null,
    apiBaseUrl: null,
    modelName: 'openai/gpt-4o-mini',
    connectionVerified: false,
    connectionVerifiedAt: null,
    complianceCriteria: null,
    scoringCriteria: null,
    enableAiCompliance: false,
    enableAiScoring: false,
    dailyTokenLimit: 100000,
    monthlyTokenLimit: 2000000,
    preRejectGraceDays: 3,
    scoreSortWeight: 70,
    voteSortWeight: 30,
    batchSize: 10,
    scanIntervalMinutes: 30,
    createdAt: now,
    updatedAt: now,
  }
}
