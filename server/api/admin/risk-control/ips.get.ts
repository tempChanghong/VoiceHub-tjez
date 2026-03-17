import { getBannedIPs } from '~/server/services/securityService'

export default defineEventHandler(async (event) => {
  // 检查认证和权限
  const user = event.context.user
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '需要管理员权限'
    })
  }

  try {
    const list = getBannedIPs()
    
    // 按 blockedTime 降序排序
    list.sort((a, b) => b.blockedTime.getTime() - a.blockedTime.getTime())

    return {
      success: true,
      data: list
    }
  } catch (error) {
    console.error('获取封禁IP列表失败:', error)
    throw createError({
      statusCode: 500,
      message: '获取风控IP列表失败'
    })
  }
})
