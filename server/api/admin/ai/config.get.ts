/**
 * GET /api/admin/ai/config
 *
 * 读取 AI 配置端点。
 * 从 ai_settings 表中读取 id=1 的单例记录，返回给前端用于回显。
 *
 * 安全说明：
 *   - API Key 不会以明文返回。若 apiKey 非空，则返回固定掩码 "sk-***"；
 *     若为空或 null，则返回 null。
 */

import { db } from '~/drizzle/db'
import { aiSettings } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'

// API Key 掩码标识（与 POST 端点保持一致）
const API_KEY_MASK = 'sk-***'

export default defineEventHandler(async (event) => {
  // 鉴权：仅管理员可读取
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '未授权访问' })
  }
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({ statusCode: 403, message: '只有管理员才能查看 AI 配置' })
  }

  // 查询单例记录
  const rows = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, 1))
    .limit(1)

  if (rows.length === 0) {
    // 尚未初始化过配置，返回 null 让前端使用默认值
    return { success: true, settings: null }
  }

  const record = rows[0]!

  // 对 apiKey 做掩码处理，绝不回传明文
  return {
    success: true,
    settings: {
      ...record,
      apiKey: record.apiKey ? API_KEY_MASK : null,
    },
  }
})
