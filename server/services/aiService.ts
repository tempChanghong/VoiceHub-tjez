/**
 * AI Service — VoiceHub 校园广播站 AI 审核与评分核心服务
 *
 * 本模块提供以下能力：
 *   1. 读取 `ai_settings` 配置（单例，id=1）
 *   2. 用户输入安全清洗（防止 Prompt 注入，详见设计文档 §5.3）
 *   3. 统一 LLM 调用接口（OpenRouter 兼容 OpenAI Chat Completions 协议）
 *      - AbortController + 8.5s 超时（适配 Vercel Free 的 10s 函数超时，§8.6）
 *      - 鲁棒 JSON 解析（处理 ```json 代码块 / 首尾大括号兜底，§8.4）
 *   4. 自动 Token 审计（写入 ai_audit_logs 表）
 *
 * 设计参考：ai_review_system_design.md（2026-04-19 版）
 */

import { db } from '~/drizzle/db'
import { aiSettings, aiAuditLogs } from '~/drizzle/schema'
import type { AiSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'

// ===================== 常量与类型定义 =====================

/**
 * Vercel Free Tier 的函数超时硬上限为 10 秒。
 * 预留 1.5 秒用于数据库写入 / 响应序列化 / 边缘网络开销，
 * 因此 LLM 调用本身最多给 8.5 秒。
 */
export const LLM_TIMEOUT_MS = 8500

/**
 * OpenRouter 默认 API 基址（兼容 OpenAI Chat Completions 协议）
 * 参考：https://openrouter.ai/docs
 */
const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api/v1'

/**
 * 单次用户输入字符串最大允许长度（超出将截断）
 * - 歌名 ≤ 100
 * - 推荐语 ≤ 500
 * 这里取 500 作为通用上限。
 */
const MAX_INPUT_LENGTH = 500

/**
 * LLM 调用的返回结构（统一抽象，与具体 Provider 无关）
 */
export interface LLMCallResult {
  /** 原始文本响应（已去除代码块包装） */
  rawText: string
  /** 实际调用的模型名 */
  modelName: string
  /** 本次调用的输入 Token 数 */
  inputTokens: number
  /** 本次调用的输出 Token 数 */
  outputTokens: number
  /** 总 Token 数 */
  totalTokens: number
  /** 端到端延迟（毫秒） */
  latencyMs: number
  /** 是否因超时被中断 */
  timedOut: boolean
}

/**
 * 鲁棒 JSON 解析失败时抛出的错误
 */
export class AiResponseParseError extends Error {
  public readonly rawPreview: string
  constructor(raw: string) {
    super(`Failed to parse AI response: ${raw.slice(0, 200)}...`)
    this.name = 'AiResponseParseError'
    this.rawPreview = raw.slice(0, 500)
  }
}

/**
 * LLM 调用超时错误（Vercel 10s 兜底）
 */
export class AiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI call timed out after ${timeoutMs}ms`)
    this.name = 'AiTimeoutError'
  }
}

// ===================== 1. 配置读取 =====================

/**
 * 从 `ai_settings` 表读取配置（固定读取 id=1 的单例记录）。
 *
 * @returns 配置对象；若记录不存在返回 null（首次使用场景）。
 */
export async function getAiSettings(): Promise<AiSettings | null> {
  const rows = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, 1))
    .limit(1)
  return rows[0] ?? null
}

/**
 * 加载并校验 AI 配置。若配置缺失或 API Key 为空则抛出错误。
 * 适合在 Cron / API 端点调用前做前置检查。
 */
export async function requireAiSettings(): Promise<AiSettings> {
  const settings = await getAiSettings()
  if (!settings) {
    throw new Error('AI settings not initialized. Please configure via admin panel.')
  }
  if (!settings.apiKey) {
    throw new Error('AI API key is missing. Please set it in admin panel.')
  }
  return settings
}

// ===================== 2. 安全清洗（§5.3） =====================

/**
 * 对用户提交的文本内容（歌名 / 歌手 / 推荐语）进行安全清洗，
 * 防止其被作为 Prompt Injection 注入到 LLM 的 System/User Prompt 中。
 *
 * 清洗步骤：
 *   1. 截断长度（避免超长输入撑爆 Token 预算）
 *   2. 移除三反引号代码块标记（防止跳出 JSON 围栏）
 *   3. 过滤常见注入模板：`system:` / `ignore previous instructions` 等
 *   4. 剥离 HTML 标签
 *   5. 使用 JSON 安全转义（返回字符串不含外层引号）
 */
export function sanitizeUserInput(input: string | null | undefined): string {
  if (!input) return ''

  // 1. 截断长度
  const truncated = String(input).slice(0, MAX_INPUT_LENGTH)

  // 2-4. 移除注入模式
  const cleaned = truncated
    .replace(/```/g, '')
    .replace(/system\s*:/gi, '')
    .replace(/ignore\s*(previous|above|all)\s*(instructions?|prompts?)/gi, '[FILTERED]')
    .replace(/<\/?[^>]+(>|$)/g, '')

  // 5. JSON 安全转义：利用 JSON.stringify 得到完全转义的字符串
  // 再剥离外层的双引号，保留内部的转义字符（如 \n、\"、\\）
  return JSON.stringify(cleaned).slice(1, -1)
}

// ===================== 3. 超时与解析工具（§8.4、§8.6） =====================

/**
 * 通用超时包装器：在 `timeoutMs` 后通过 AbortController 主动中断。
 *
 * 调用方应将传入的 `signal` 透传给 fetch，以便真正取消网络请求。
 */
export async function processWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fn(controller.signal)
  } catch (e: any) {
    // fetch 内部的 AbortError 名为 'AbortError'；Node 18+ 也可能是 DOMException
    if (e?.name === 'AbortError' || controller.signal.aborted) {
      throw new AiTimeoutError(timeoutMs)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 鲁棒解析 LLM 的文本响应为 JSON 对象（§8.4）
 *
 * 尝试顺序：
 *   1. 直接 JSON.parse
 *   2. 提取 ```json ... ``` 代码块
 *   3. 提取首个 `{` 到最后一个 `}` 之间的内容
 *
 * 全部失败则抛出 AiResponseParseError。
 */
export function parseAiResponse<T = unknown>(raw: string): T {
  if (!raw || typeof raw !== 'string') {
    throw new AiResponseParseError(String(raw))
  }

  // 1. 直接解析
  try {
    return JSON.parse(raw) as T
  } catch {
    // 继续兜底
  }

  // 2. 提取 ```json ... ``` 代码块（也兼容 ``` ... ```）
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T
    } catch {
      // 继续兜底
    }
  }

  // 3. 首尾大括号兜底
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as T
    } catch {
      // 最终失败，落入下方抛错
    }
  }

  throw new AiResponseParseError(raw)
}

// ===================== 4. 统一 LLM 调用接口 =====================

/**
 * callLLM 的调用选项
 */
export interface CallLLMOptions {
  /** 关联的歌曲 ID（用于审计日志） */
  songId: number
  /** 动作类型（用于审计日志 action 列） */
  action: string
  /** Prompt 版本号（便于 A/B 对比） */
  promptVersion?: string
  /** 若为人工触发，记录管理员用户 ID */
  operatorId?: number
  /** 覆盖超时时间（默认 LLM_TIMEOUT_MS） */
  timeoutMs?: number
  /** 温度（默认 0.2，追求稳定输出） */
  temperature?: number
  /** 最大输出 Token（默认 800，防止超长响应撑爆超时） */
  maxTokens?: number
  /** 是否要求 JSON 响应（若 Provider 支持 response_format） */
  jsonMode?: boolean
  /** 预加载的配置（避免重复查询） */
  settings?: AiSettings
}

/**
 * 统一 LLM 调用入口。
 *
 * 流程：
 *   1. 加载 AI 配置
 *   2. 构建 OpenAI 协议兼容的 Chat Completions 请求
 *   3. 通过 AbortController 控制 8.5s 超时
 *   4. 解析响应，提取 Token 使用量
 *   5. 将调用元数据写入 ai_audit_logs 审计表（失败不影响主流程）
 *
 * @param systemPrompt 系统提示词（角色定义 + 输出规范）
 * @param userPrompt   用户提示词（待审核/评分的歌曲信息 JSON）
 * @param options      审计元数据与调用参数
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options: CallLLMOptions
): Promise<LLMCallResult> {
  const startedAt = Date.now()
  const settings = options.settings ?? (await requireAiSettings())

  const baseUrl = (settings.apiBaseUrl || OPENROUTER_DEFAULT_BASE).replace(/\/+$/, '')
  const endpoint = `${baseUrl}/chat/completions`
  const modelName = settings.modelName || 'openai/gpt-4o-mini'
  const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS

  // 审计日志的占位容器（失败路径也要记录）
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let rawText = ''
  let timedOut = false
  let errorMessage: string | null = null

  try {
    const result = await processWithTimeout(async (signal) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
          // OpenRouter 推荐头：用于出现在排行榜与统计
          'HTTP-Referer': 'https://music.newfires.top',
          'X-Title': 'VoiceHub AI Review',
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 800,
          // 部分模型支持强制 JSON 响应，对不支持的模型会被忽略
          ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(
          `LLM HTTP ${response.status} ${response.statusText}: ${errText.slice(0, 300)}`
        )
      }

      return (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
        }
        model?: string
      }
    }, timeoutMs)

    rawText = result.choices?.[0]?.message?.content ?? ''
    inputTokens = result.usage?.prompt_tokens ?? 0
    outputTokens = result.usage?.completion_tokens ?? 0
    totalTokens = result.usage?.total_tokens ?? inputTokens + outputTokens

    const latencyMs = Date.now() - startedAt

    // 写入审计日志（不阻塞主流程 —— 失败则仅打印）
    await writeAuditLog({
      songId: options.songId,
      action: options.action,
      inputTokens,
      outputTokens,
      totalTokens,
      modelName: result.model || modelName,
      promptVersion: options.promptVersion,
      requestPayload: truncate(userPrompt, 2000),
      responsePayload: truncate(rawText, 2000),
      latencyMs,
      operatorId: options.operatorId,
    })

    return {
      rawText,
      modelName: result.model || modelName,
      inputTokens,
      outputTokens,
      totalTokens,
      latencyMs,
      timedOut: false,
    }
  } catch (e: any) {
    timedOut = e instanceof AiTimeoutError
    errorMessage = e?.message || String(e)

    // 失败场景也记录审计日志，便于排障
    await writeAuditLog({
      songId: options.songId,
      action: options.action,
      inputTokens,
      outputTokens,
      totalTokens,
      modelName,
      promptVersion: options.promptVersion,
      requestPayload: truncate(userPrompt, 2000),
      responsePayload: truncate(rawText, 2000),
      latencyMs: Date.now() - startedAt,
      error: timedOut ? `TIMEOUT: ${errorMessage}` : errorMessage,
      operatorId: options.operatorId,
    }).catch(() => {
      /* swallow */
    })

    throw e
  }
}

// ===================== 5. 审计日志写入 =====================

interface AuditLogInput {
  songId: number
  action: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  modelName?: string | null
  promptVersion?: string | null
  requestPayload?: string | null
  responsePayload?: string | null
  latencyMs: number
  error?: string | null
  operatorId?: number | null
}

/**
 * 写入 `ai_audit_logs` 表。
 * 设计约束：单条 payload ≤ 2KB（适配 Neon Free 的 0.5GB 存储上限）。
 *
 * 本函数对调用方透明 —— 任何数据库异常都会被吞掉（只打印 console.error），
 * 确保审计失败不会影响主业务流程（AI 审核/评分）。
 */
export async function writeAuditLog(entry: AuditLogInput): Promise<void> {
  try {
    await db.insert(aiAuditLogs).values({
      songId: entry.songId,
      action: entry.action,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.totalTokens,
      modelName: entry.modelName ?? null,
      promptVersion: entry.promptVersion ?? null,
      requestPayload: entry.requestPayload ?? null,
      responsePayload: entry.responsePayload ?? null,
      latencyMs: entry.latencyMs,
      error: entry.error ?? null,
      operatorId: entry.operatorId ?? null,
    })
  } catch (e: any) {
    console.error('[aiService] Failed to write audit log:', e?.message || e)
  }
}

// ===================== 工具函数 =====================

/**
 * 按字节长度截断字符串（保守按字符数近似，避免 Neon 存储爆破）
 */
function truncate(input: string | null | undefined, maxLen: number): string | null {
  if (!input) return null
  if (input.length <= maxLen) return input
  return input.slice(0, maxLen) + '...[truncated]'
}
