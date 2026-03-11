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
  
  const headers: HeadersInit = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  }
  
  if (isBilibili) {
    headers['Referer'] = 'https://www.bilibili.com'
  }

  try {
    const response = await $fetch<ArrayBuffer>(url, {
      responseType: 'arrayBuffer',
      headers
    })

    if (filename) {
      setResponseHeader(event, 'Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    } else {
      setResponseHeader(event, 'Content-Disposition', 'attachment')
    }
    setResponseHeader(event, 'Content-Type', 'application/octet-stream')

    return response
  } catch (error) {
    console.error('Proxy download error:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to download audio file'
    })
  }
})
