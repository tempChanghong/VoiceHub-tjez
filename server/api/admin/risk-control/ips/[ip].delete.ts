import { unbanIP } from '~/server/services/securityService'

export default defineEventHandler(async (event) => {
  // 检查认证和权限
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '需要管理员权限'
    })
  }

  const ip = getRouterParam(event, 'ip')
  if (!ip) {
    throw createError({ statusCode: 400, message: '缺少IP参数' })
  }

  try {
    const success = unbanIP(ip)
    if (!success) {
       throw createError({
         statusCode: 404,
         message: '未找到该封禁的IP记录'
       })
    }
    
    return {
      success: true,
      message: 'IP解封成功'
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('解除IP封禁失败:', error)
    throw createError({
      statusCode: 500,
      message: '解封失败'
    })
  }
})
