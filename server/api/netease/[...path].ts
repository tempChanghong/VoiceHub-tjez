import { sendProxy } from 'h3'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const path = event.context.params?.path || ''
  const baseUrl = 'https://ncmapi.zcy.life'
  const targetUrl = `${baseUrl}/${path}`

  try {
    // 处理特定的 login/status 请求 (因为 NeteaseLoginModal.vue 中发了 POST 带有 body)
    if (path === 'login/status' && event.node.req.method === 'POST') {
      const body = await readBody(event)
      const cookie = body?.cookie || query.cookie || ''
      const timestamp = Date.now()

      // 转发为 GET 请求并附带 cookie 参数，因为 Netease API 的 /login/status 也是可以通过 query 传 cookie 的
      const statusUrl = `${baseUrl}/login/status?cookie=${encodeURIComponent(cookie)}&timestamp=${timestamp}`
      
      const response = await fetch(statusUrl)
      if (!response.ok) {
         throw new Error(`HTTP error! status: ${response.status} from ${statusUrl}`)
      }
      const data = await response.json()
      return data
    }

    // 对于普通的 GET 请求，我们可以尝试使用 fetch 透传并处理特定 json 返回，以防止直接 sendProxy 返回错误内容导致 JSON.parse 异常。
    // 特别地，如果直接是 sendProxy 有可能会原样透传 CORS 或者不正确的 HTML。我们使用 fetch 控制返回内容。
    const urlWithQuery = new URL(targetUrl)
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
         urlWithQuery.searchParams.append(key, String(value))
      }
    }

    const response = await fetch(urlWithQuery.toString(), {
      method: event.node.req.method,
      headers: {
        // 部分请求头可能不需要原样传递以免触发各种限制。
        'User-Agent': event.node.req.headers['user-agent'] || 'Mozilla/5.0'
      }
    })

    if (!response.ok) {
       console.error(`[Netease API Proxy] Error ${response.status} connecting to ${urlWithQuery.toString()}`)
       try {
         const errorText = await response.text()
         console.error(`[Netease API Proxy] Error detail:`, errorText)
       } catch (e) {}
       
       throw createError({
         statusCode: response.status,
         message: `Netease API responded with ${response.status}`
       })
    }

    // 检查响应类型，如果是 JSON 才返回 JSON 以避免 SyntaxError
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
       const text = await response.text()
       try {
           return JSON.parse(text)
       } catch(e) {
           console.error(`[Netease API Proxy] JSON parse error for ${urlWithQuery.toString()}:`, text.substring(0, 200))
           throw createError({
               statusCode: 502,
               message: 'Error parsing JSON from Netease API'
           })
       }
    } else {
       // 如果不是 JSON，尝试获取文本并返回包装好的错误对象
       const text = await response.text()
       console.error(`[Netease API Proxy] Expected JSON, got ${contentType}. URL: ${urlWithQuery.toString()}\nContent: ${text.substring(0, 200)}`)
       throw createError({
           statusCode: 502,
           statusMessage: 'Bad Gateway',
           message: 'Invalid response from Netease API'
       })
    }

  } catch (error) {
    console.error('[Netease API Proxy Error]', error)
    if (error.statusCode) {
        throw error
    }
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error.message || 'Error occurred while connecting to Netease API'
    })
  }
})
