import { defineEventHandler, createError, getRequestURL } from 'h3'
import { isIPBlocked, getIPBlockRemainingTime } from '../services/securityService'
import { getClientIP } from '../utils/ip-utils'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const pathname = url.pathname

  // 忽略直接的资源请求等，主要拦截 API 或页面访问
  // 也可以全量拦截
  
  const clientIp = getClientIP(event)

  if (isIPBlocked(clientIp)) {
    const remainingTime = getIPBlockRemainingTime(clientIp)
    
    // 返回 403 页面提示，如果客户端是 API 则会返回 JSON
    throw createError({
      statusCode: 403,
      message: `您的IP地址已被风控系统封禁，请在 ${remainingTime} 分钟后重试`,
      fatal: true
    })
  }
})
