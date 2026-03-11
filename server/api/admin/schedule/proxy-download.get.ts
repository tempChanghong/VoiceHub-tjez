import { defineEventHandler, getQuery, setResponseHeader, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const url = query.url as string
  const filename = query.filename as string

  if (!url) {
    throw createError({
      statusCode: 400,
      message: 'Missing url parameter'
    })
  }

  const isBilibili = url.includes('bilibili.com') || url.includes('bilivideo.com')
  const isQQMusic = url.includes('qq.com') || url.includes('qqmusic')
  const isNetease = url.includes('163.com') || url.includes('netease')
  
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
  
  if (isBilibili) {
    headers['Referer'] = 'https://www.bilibili.com'
  } else if (isQQMusic) {
    headers['Referer'] = 'https://y.qq.com/'
  } else if (isNetease) {
    headers['Referer'] = 'https://music.163.com/'
  }

  try {
    const response = await globalThis.fetch(url, {
      headers
    })

    if (!response.ok) {
      throw createError({
        statusCode: response.status,
        message: `Upstream responded with ${response.status}`
      })
    }

    if (filename) {
      setResponseHeader(event, 'Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    } else {
      setResponseHeader(event, 'Content-Disposition', 'attachment')
    }
    setResponseHeader(event, 'Content-Type', 'application/octet-stream')

    // 直接流式返回 ReadableStream
    return response.body
  } catch (error: unknown) {
    console.error('Proxy download error:', error)
    
    // 如果已经是 H3 Error，直接抛出
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }

    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to download audio file'
    })
  }
})
