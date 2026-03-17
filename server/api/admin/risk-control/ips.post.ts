import { manualBanIP, isIPBlocked } from '~/server/services/securityService'

export default defineEventHandler(async (event) => {
  // 检查认证和权限
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '需要管理员权限'
    })
  }

  const body = await readBody(event)
  const { ip, reason, durationMinutes } = body

  if (!ip) {
    throw createError({
      statusCode: 400,
      message: 'IP不能为空'
    })
  }
  
  // 简单的IP格式正则
  const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^[a-fA-F0-9:]+$/
  if (!ipRegex.test(ip)) {
     throw createError({
      statusCode: 400,
      message: 'IP格式不正确'
    })
  }

  if (isIPBlocked(ip)) {
    throw createError({
      statusCode: 409,
      message: '该IP已被封禁，请先解封或等待自动解封'
    })
  }

  try {
    const min = durationMinutes ? parseInt(durationMinutes) : 10
    manualBanIP(ip, reason || '管理员手动风控封禁', min)

    return {
      success: true,
      message: 'IP封禁成功'
    }
  } catch (error: any) {
    console.error('手动封禁IP失败:', error)
    throw createError({
      statusCode: 500,
      message: '封禁失败'
    })
  }
})
