export default defineNuxtPlugin((nuxtApp) => {
  // 仅客户端生效
  if (!import.meta.client) return

  // 拦截全局 $fetch 响应错误
  const originalFetch = globalThis.$fetch
  
  if (originalFetch) {
    globalThis.$fetch = originalFetch.create({
      async onResponseError({ response }) {
        if (response.status === 403) {
          const data = response._data
          
          const isBanned = 
            response.statusText === 'IP_BANNED' ||
            data?.error === 'IP_BANNED' ||
            data?.statusMessage === 'IP_BANNED' ||
            data?.message?.includes('封禁') ||
            data?.message?.includes('IP_BANNED') ||
            (typeof data === 'string' && data.includes('IP_BANNED'));

          if (isBanned) {
            nuxtApp.runWithContext(() => {
              useState('ipBanned').value = true
              if (data?.reason) useState('ipBanReason').value = data.reason
              if (data?.expiresAt) useState('ipBanExpiresAt').value = data.expiresAt
            })
          }
        }
      }
    })
  }
})
