import { executeRedisCommand, isRedisReady } from '../utils/redis'

// 缓存键前缀
const CACHE_PREFIXES = {
  SONGS: 'songs',
  SCHEDULES: 'schedules',
  SONG_COUNT: 'song_count',
  USER_VOTES: 'user_votes',
  SCHEDULE_BY_DATE: 'schedule_date',
  EMPTY_RESULT: 'empty' // 空结果缓存，防止缓存穿透
} as const

// 缓存TTL配置（秒）
const CACHE_TTL = {
  SCHEDULES: 600, // 10分钟
  SONG_COUNT: 180, // 3分钟
  USER_VOTES: 120, // 2分钟
  EMPTY_RESULT: 60, // 1分钟（空结果缓存时间较短）
  SYSTEM_SETTINGS: 3600, // 60分钟
  RANDOM_OFFSET: 60, // 随机偏移量，防止缓存雪崩
  LOCK_TIMEOUT: 30, // 分布式锁超时时间
  REFRESH_AHEAD: 60 // 提前刷新时间（秒）
} as const

// 缓存刷新锁，防止缓存击穿（由于改为纯Redis NX机制，单实例内存锁被移除）

// 缓存服务类
class CacheService {
  // 单例实例
  private static instance: CacheService | null = null

  // 获取单例实例
  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService()
    }
    return CacheService.instance
  }

  // 获取歌曲数量缓存
  async getSongCount(semester?: string): Promise<number | null> {
    const key = this.generateKey(CACHE_PREFIXES.SONG_COUNT, semester || 'all')
    return await this.getCache<number>(key)
  }

  // 设置歌曲数量缓存
  async setSongCount(count: number, semester?: string): Promise<void> {
    const key = this.generateKey(CACHE_PREFIXES.SONG_COUNT, semester || 'all')
    await this.setCache(key, count, CACHE_TTL.SONG_COUNT)
  }

  // 获取用户投票状态缓存
  async getUserVotes(userId: number, semester?: string): Promise<number[] | null> {
    const key = this.generateKey(CACHE_PREFIXES.USER_VOTES, userId, semester || 'all')
    return await this.getCache<number[]>(key)
  }

  // 设置用户投票状态缓存
  async setUserVotes(userId: number, songIds: number[], semester?: string): Promise<void> {
    const key = this.generateKey(CACHE_PREFIXES.USER_VOTES, userId, semester || 'all')
    await this.setCache(key, songIds, CACHE_TTL.USER_VOTES)
  }

  // 清除歌曲相关缓存
  async clearSongsCache(semester?: string): Promise<void> {
    const patterns = [
      this.generateKey(CACHE_PREFIXES.SONG_COUNT, '*'),
      this.generateKey(CACHE_PREFIXES.USER_VOTES, '*'),
      'songs:count:*', // 新的歌曲数量缓存
      'songs:list:*' // 新的歌曲列表缓存
    ]

    for (const pattern of patterns) {
      await this.deleteCachePattern(pattern)
    }

    console.log(`[Cache] 歌曲相关缓存已清除${semester ? ` (学期: ${semester})` : ''}`)
  }

  // 获取歌曲列表缓存
  async getSongsList(semester?: string): Promise<any[] | null> {
    const key = this.generateKey(CACHE_PREFIXES.SONGS, 'list', semester || 'all')
    const cached = await this.getCache<any[]>(key)
    if (cached) {
      if (Array.isArray(cached) && cached.length === 1 && cached[0]?.__empty) {
        return []
      }
      return cached
    }
    return null
  }

  // 设置歌曲列表缓存
  async setSongsList(songs: any[], semester?: string): Promise<void> {
    const key = this.generateKey(CACHE_PREFIXES.SONGS, 'list', semester || 'all')
    const cacheData = songs.length === 0 ? [{ __empty: true }] : songs
    const ttl = songs.length === 0 ? CACHE_TTL.EMPTY_RESULT : CACHE_TTL.SONG_COUNT
    await this.setCache(key, cacheData, ttl)
  }


  // 获取排期列表缓存
  async getSchedulesList(startDate?: Date, endDate?: Date): Promise<any[] | null> {
    const key = this.generateKey(
      CACHE_PREFIXES.SCHEDULES,
      'list',
      startDate?.toISOString().split('T')[0] || 'all',
      endDate?.toISOString().split('T')[0] || 'all'
    )

    const cached = await this.getCache<any[]>(key)
    if (cached) {
      console.log(`[Cache] 排期列表缓存命中: ${key}`)
      // 检查是否是空结果缓存
      if (Array.isArray(cached) && cached.length === 1 && cached[0]?.__empty) {
        return []
      }
      return cached
    }

    return null
  }

  // 设置排期列表缓存
  async setSchedulesList(schedules: any[], startDate?: Date, endDate?: Date): Promise<void> {
    const key = this.generateKey(
      CACHE_PREFIXES.SCHEDULES,
      'list',
      startDate?.toISOString().split('T')[0] || 'all',
      endDate?.toISOString().split('T')[0] || 'all'
    )

    // 如果是空结果，设置特殊标记防止缓存穿透
    const cacheData = schedules.length === 0 ? [{ __empty: true }] : schedules
    const ttl = schedules.length === 0 ? CACHE_TTL.EMPTY_RESULT : CACHE_TTL.SCHEDULES

    await this.setCache(key, cacheData, ttl)
    if (isRedisReady()) {
      console.log(`[Cache] 排期列表已缓存: ${key}, 数量: ${schedules.length}`)
    }
  }

  // 获取特定日期的排期缓存
  async getSchedulesByDate(date: Date): Promise<any[] | null> {
    const dateStr = date.toISOString().split('T')[0]
    const key = this.generateKey(CACHE_PREFIXES.SCHEDULE_BY_DATE, dateStr)

    const cached = await this.getCache<any[]>(key)
    if (cached) {
      console.log(`[Cache] 日期排期缓存命中: ${key}`)
      if (Array.isArray(cached) && cached.length === 1 && cached[0]?.__empty) {
        return []
      }
      return cached
    }

    return null
  }

  // 设置特定日期的排期缓存
  async setSchedulesByDate(schedules: any[], date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0]
    const key = this.generateKey(CACHE_PREFIXES.SCHEDULE_BY_DATE, dateStr)

    const cacheData = schedules.length === 0 ? [{ __empty: true }] : schedules
    const ttl = schedules.length === 0 ? CACHE_TTL.EMPTY_RESULT : CACHE_TTL.SCHEDULES

    await this.setCache(key, cacheData, ttl)
    if (isRedisReady()) {
      console.log(`[Cache] 日期排期已缓存: ${key}, 数量: ${schedules.length}`)
    }
  }

  // 清除排期相关缓存
  async clearSchedulesCache(date?: Date): Promise<void> {
    if (date) {
      // 清除特定日期的缓存
      const dateStr = date.toISOString().split('T')[0]
      const key = this.generateKey(CACHE_PREFIXES.SCHEDULE_BY_DATE, dateStr)
      await this.deleteCache(key)
      console.log(`[Cache] 日期排期缓存已清除: ${dateStr}`)
    } else {
      // 清除所有排期缓存
      const patterns = [
        this.generateKey(CACHE_PREFIXES.SCHEDULES, '*'),
        this.generateKey(CACHE_PREFIXES.SCHEDULE_BY_DATE, '*')
      ]

      for (const pattern of patterns) {
        await this.deleteCachePattern(pattern)
      }

      // 清除 Redis 中的 public_schedules 相关缓存
      await this.clearPublicSchedulesCache()

      console.log('[Cache] 所有排期缓存已清除')
    }
  }

  // 获取系统设置缓存
  async getSystemSettings(): Promise<any | null> {
    const key = this.generateKey('system', 'settings')
    return await this.getCache<any>(key)
  }

  // 设置系统设置缓存
  async setSystemSettings(settings: any): Promise<void> {
    const key = this.generateKey('system', 'settings')
    await this.setCache(key, settings, CACHE_TTL.SYSTEM_SETTINGS)
    if (isRedisReady()) {
      console.log(`[Cache] 系统设置已缓存: ${key}`)
    }
  }

  // 清除系统设置缓存
  async clearSystemSettingsCache(): Promise<void> {
    const pattern = this.generateKey('system', '*')
    await this.deleteCachePattern(pattern)
    console.log('[Cache] 系统设置缓存已清除')
  }

  // 获取播放时间列表缓存
  async getPlayTimes(): Promise<any[] | null> {
    const key = this.generateKey('playtimes', 'list')

    const cached = await this.getCache<any[]>(key)
    if (cached) {
      console.log(`[Cache] 播放时间列表缓存命中: ${key}`)
      // 检查是否是空结果缓存
      if (Array.isArray(cached) && cached.length === 1 && cached[0]?.__empty) {
        return []
      }
      return cached
    }

    return null
  }

  // 设置播放时间列表缓存
  async setPlayTimes(playTimes: any[]): Promise<void> {
    const key = this.generateKey('playtimes', 'list')

    // 如果是空结果，设置特殊标记防止缓存穿透
    const cacheData = playTimes.length === 0 ? [{ __empty: true }] : playTimes
    const ttl = playTimes.length === 0 ? CACHE_TTL.EMPTY_RESULT : CACHE_TTL.SYSTEM_SETTINGS

    await this.setCache(key, cacheData, ttl)
    if (isRedisReady()) {
      console.log(`[Cache] 播放时间列表已缓存: ${key}, 数量: ${playTimes.length}`)
    }
  }

  // 清除播放时间相关缓存
  async clearPlayTimesCache(): Promise<void> {
    const pattern = this.generateKey('playtimes', '*')
    await this.deleteCachePattern(pattern)
    console.log('[Cache] 播放时间缓存已清除')
  }

  // 获取管理员统计数据
  async getAdminStats(semester?: string): Promise<any> {
    if (!isRedisReady()) return null

    const key = semester ? `admin_stats:${semester}` : 'admin_stats:all'
    return await executeRedisCommand(async () => {
      const client = (await import('../utils/redis')).getRedisClient()
      if (!client) return null

      const data = await client.get(key)
      return data ? JSON.parse(data) : null
    })
  }

  // 设置管理员统计数据缓存
  async setAdminStats(data: any, semester?: string): Promise<void> {
    if (!isRedisReady()) return

    const key = semester ? `admin_stats:${semester}` : 'admin_stats:all'
    await executeRedisCommand(async () => {
      const client = (await import('../utils/redis')).getRedisClient()
      if (!client) return

      // 统计数据缓存5分钟
      await client.setEx(key, 300, JSON.stringify(data))
    })
  }

  // 获取实时统计数据
  async getRealtimeStats(): Promise<any> {
    if (!isRedisReady()) return null

    return await executeRedisCommand(async () => {
      const client = (await import('../utils/redis')).getRedisClient()
      if (!client) return null

      const data = await client.get('realtime_stats')
      return data ? JSON.parse(data) : null
    })
  }

  // 设置实时统计数据缓存
  async setRealtimeStats(data: any): Promise<void> {
    if (!isRedisReady()) return

    await executeRedisCommand(async () => {
      const client = (await import('../utils/redis')).getRedisClient()
      if (!client) return

      // 实时统计数据缓存2分钟
      await client.setEx('realtime_stats', 120, JSON.stringify(data))
    })
  }

  // ==================== 排期相关缓存 ====================

  // 获取活跃用户统计
  async getActiveUsersStats(semester?: string, limit?: number): Promise<any> {
    if (!isRedisReady()) return null

    const key = `active_users:${semester || 'all'}:${limit || 10}`
    return await executeRedisCommand(async () => {
      const client = (await import('../utils/redis')).getRedisClient()
      if (!client) return null

      const data = await client.get(key)
      return data ? JSON.parse(data) : null
    })
  }

  // 设置活跃用户统计缓存
  async setActiveUsersStats(data: any, semester?: string, limit?: number): Promise<void> {
    if (!isRedisReady()) return

    const key = `active_users:${semester || 'all'}:${limit || 10}`
    await executeRedisCommand(async () => {
      const client = (await import('../utils/redis')).getRedisClient()
      if (!client) return

      // 活跃用户统计缓存10分钟
      await client.setEx(key, 600, JSON.stringify(data))
    })
  }

  // 清除所有统计缓存
  async clearStatsCache(): Promise<void> {
    if (!isRedisReady()) return

    await executeRedisCommand(async () => {
      const client = (await import('../utils/redis')).getRedisClient()
      if (!client) return

      const keys = await client.keys('admin_stats:*')
      const realtimeKeys = await client.keys('realtime_stats')
      const activeUserKeys = await client.keys('active_users:*')

      const allKeys = [...keys, ...realtimeKeys, ...activeUserKeys]
      if (allKeys.length > 0) {
        try {
          await client.del(allKeys)
          console.log(`[Cache] 已清除 ${allKeys.length} 个统计缓存键`)
        } catch (delError) {
          console.error(`[Cache] 删除统计缓存键失败:`, delError)
        }
      }
    })
  }

  // 获取缓存统计信息
  async getCacheStats(): Promise<any> {
    if (!isRedisReady()) {
      return {
        enabled: false,
        message: 'Redis未启用或不可用'
      }
    }

    return (
      (await executeRedisCommand(async () => {
        const client = (await import('../utils/redis')).getRedisClient()
        if (!client) return { enabled: false }

        const info = await client.info('memory')
        const keyCount = await client.dbSize()

        return {
          enabled: true,
          keyCount,
          memoryInfo: info,
          redisStats: (await import('../utils/redis')).getRedisStats()
        }
      })) || { enabled: false }
    )
  }

  // 清除所有缓存
  async clearAllCache(): Promise<void> {
    await this.clearSongsCache()
    await this.clearSchedulesCache()
    await this.clearSystemSettingsCache()
    console.log('[Cache] 所有缓存已清除')
  }
  // ==================== 系统设置相关缓存 ====================

  // 生成缓存键
  private generateKey(prefix: string, ...parts: (string | number | undefined | null)[]): string {
    return `voicehub:${prefix}:${parts.filter(p => p !== undefined && p !== null).join(':')}`
  }

  // ==================== 播放时间相关缓存 ====================

  // 获取带随机偏移的TTL，防止缓存雪崩
  private getRandomTTL(baseTTL: number): number {
    const offset = Math.floor(Math.random() * CACHE_TTL.RANDOM_OFFSET)
    return baseTTL + offset
  }

  // 序列化数据（确保UTF-8编码）
  private serialize(data: any): string {
    try {
      return Buffer.from(JSON.stringify(data)).toString('base64')
    } catch (error) {
      console.error('[Cache] 序列化失败:', error)
      throw new Error(`序列化失败: ${error}`)
    }
  }

  // 反序列化数据（确保UTF-8编码）
  private deserialize<T>(data: string | null): T | null {
    if (!data) return null

    try {
      return JSON.parse(Buffer.from(data, 'base64').toString('utf-8')) as T
    } catch (error) {
      console.warn('[Cache] 反序列化失败（可能因为遗留明文数据格式），将自动容错并退化:', error)
      return null
    }
  }

  // ==================== 统计数据缓存 ====================

  // 设置缓存
  private async setCache(key: string, data: any, ttl: number): Promise<boolean> {
    if (!isRedisReady()) return false

    return (
      (await executeRedisCommand(async () => {
        const client = (await import('../utils/redis')).getRedisClient()
        if (!client) return false

        try {
          // 验证TTL参数
          if (!ttl || typeof ttl !== 'number' || ttl <= 0) {
            console.error(`[Cache] 无效的TTL值: ${ttl}, 使用默认值`)
            ttl = CACHE_TTL.SCHEDULES // 使用默认TTL
          }

          // 序列化数据（内部已包含UTF-8验证）
          const serializedData = this.serialize(data)

          // 验证序列化后的数据长度，防止过大的数据
          if (serializedData.length > 10 * 1024 * 1024) {
            // 10MB限制
            console.warn(`[Cache] 缓存数据过大 (${serializedData.length} bytes): ${key}`)
            return false
          }

          // 计算最终TTL
          const finalTTL = this.getRandomTTL(ttl)

          // 写入Redis
          await client.setEx(key, finalTTL, serializedData)

          return true
        } catch (error) {
          console.error(`[Cache] 设置缓存失败 ${key}:`, error)
          return false
        }
      })) || false
    )
  }

  // 获取缓存（带编码验证）
  public async getCache<T>(key: string): Promise<T | null> {
    if (!isRedisReady()) return null

    return (
      (await executeRedisCommand(async () => {
        const client = (await import('../utils/redis')).getRedisClient()
        if (!client) return null

        try {
          const data = await client.get(key)

          if (!data) {
            return null
          }

          // 反序列化数据
          const result = this.deserialize<T>(data)

          // 如果反序列化返回null且数据不为空（说明可能存在遗留或失效格式数据）
          if (result === null && data.length > 0) {
            // 删除有问题的缓存
            await executeRedisCommand(
              async () => {
                const redisClient = (await import('../utils/redis')).getRedisClient()
                if (!redisClient) return
                await redisClient.del(key)
              },
              async () => {}
            )
          }

          return result
        } catch (error) {
          console.error(`[Cache] 获取缓存失败 ${key}:`, error)
          return null
        }
      })) || null
    )
  }

  // 删除缓存
  public async deleteCache(key: string): Promise<boolean> {
    if (!isRedisReady()) return false

    return (
      (await executeRedisCommand(
        async () => {
          const client = (await import('../utils/redis')).getRedisClient()
          if (!client) return false

          await client.del(key)
          return true
        },
        async () => false
      )) || false
    )
  }

  // ==================== 缓存统计 ====================

  // 批量删除缓存（按模式）
  public async deleteCachePattern(pattern: string): Promise<boolean> {
    if (!isRedisReady()) return false

    return (
      (await executeRedisCommand(
        async () => {
          const client = (await import('../utils/redis')).getRedisClient()
          if (!client) return false

          const keys = await client.keys(pattern)
          if (keys.length > 0) {
            await client.del(...keys)
          }
          return true
        },
        async () => false
      )) || false
    )
  }

  // 获取分布式锁
  private async acquireLock(
    lockKey: string,
    timeout: number = CACHE_TTL.LOCK_TIMEOUT
  ): Promise<boolean> {
    if (!isRedisReady()) return false

    return (
      (await executeRedisCommand(async () => {
        const client = (await import('../utils/redis')).getRedisClient()
        if (!client) return false

        const result = await client.set(lockKey, '1', {
          EX: timeout,
          NX: true
        })
        return result === 'OK'
      })) || false
    )
  }

  // ==================== 定期刷新机制 ====================

  // 释放分布式锁
  private async releaseLock(lockKey: string): Promise<void> {
    if (!isRedisReady()) return

    await executeRedisCommand(
      async () => {
        const client = (await import('../utils/redis')).getRedisClient()
        if (!client) return

        await client.del(lockKey)
      },
      async () => {}
    )
  }

  // 防缓存击穿的数据获取
  private async getWithLock<T>(
    cacheKey: string,
    lockKey: string,
    dataLoader: () => Promise<T>,
    ttl: number
  ): Promise<T | null> {
    // 先尝试从缓存获取
    const cached = await this.getCache<T>(cacheKey)
    if (cached !== null) {
      return cached
    }

    // 尝试获取分布式锁
    const lockAcquired = await this.acquireLock(lockKey)
    if (!lockAcquired) {
      // 未获取到锁，等待一段时间后重试获取缓存
      await new Promise((resolve) => setTimeout(resolve, 100))
      return await this.getCache<T>(cacheKey)
    }

    // 获取到锁，开始数据加载
    try {
      const data = await dataLoader()
      if (data !== null) {
        await this.setCache(cacheKey, data, ttl)
      }
      return data
    } finally {
      await this.releaseLock(lockKey)
    }
  }

  // 清除 Redis 中的 public_schedules 相关缓存
  private async clearPublicSchedulesCache(): Promise<void> {
    if (!isRedisReady()) {
      console.log('[Cache] Redis未就绪，跳过public_schedules缓存清理')
      return
    }

    await executeRedisCommand(async () => {
      const client = (await import('../utils/redis')).getRedisClient()
      if (!client) return

      try {
        // 清除所有 public_schedules 相关的缓存键
        const keys = await client.keys('public_schedules:*')
        if (keys.length > 0) {
          await client.del(keys)
          console.log(`[Cache] 已清除 ${keys.length} 个 public_schedules 缓存键`)
        } else {
          console.log('[Cache] 未找到 public_schedules 缓存键')
        }
      } catch (error) {
        console.error('[Cache] 清除 public_schedules 缓存失败:', error)
      }
    })
  }

  // 精确失效缓存
  public async invalidateCache(keys: string[]): Promise<void> {
    if (!isRedisReady() || keys.length === 0) return
    await executeRedisCommand(async () => {
      const client = (await import('../utils/redis')).getRedisClient()
      if (client) {
        await client.del(keys)
      }
    })
  }
}

// 创建全局缓存服务实例
const cacheService = new CacheService()

export { cacheService, CacheService }
export default cacheService
