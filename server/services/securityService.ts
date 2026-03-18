import { createSystemNotification } from './notificationService'
import { sendMeowNotificationToUser } from './meowNotificationService'
import { db } from '~/drizzle/db'
import { users, loginLogs, ipBlacklists, systemSettings } from '~/drizzle/schema'
import { eq, sql, gte, and, or, isNull, countDistinct } from 'drizzle-orm'
import { invalidateIpCache } from '~~/server/utils/ipCache'

// ─────────────────────────────────────────────
// 账户锁定信息接口
// ─────────────────────────────────────────────
interface AccountLockInfo {
  failedAttempts: number
  lockedUntil: Date | null
  lastAttemptTime: Date
}

// IP黑名单信息接口（内存层，保持向后compat）
interface IPBlockInfo {
  blockedUntil: Date
  reason: string
  blockedTime: Date
}

// ─────────────────────────────────────────────
// 内存存储（保留原有内存逻辑）
// ─────────────────────────────────────────────
const accountLocks = new Map<string, AccountLockInfo>()
const ipBlacklist = new Map<string, IPBlockInfo>()
const accountIpSwitchMonitor = new Map<
  string,
  { ipMap: Map<string, number>; windowStart: number }
>()
const userBlockUntil = new Map<number, Date>()
const songVoteWindow = new Map<number, number[]>()
const songProtectUntil = new Map<number, Date>()
const songVoteIpBuckets = new Map<number, Map<string, number>>()
const userVoteStats = new Map<
  number,
  { emaPerMin: number; lastUpdate: number; windowTimestamps: number[] }
>()

// 通知限流存储
const notificationRateLimit = new Map<string, Date>()
const NOTIFICATION_RATE_LIMIT_MINUTES = 5

// ─────────────────────────────────────────────
// 配置常量
// ─────────────────────────────────────────────
const SECURITY_CONFIG = {
  MAX_FAILED_ATTEMPTS: 5,
  LOCK_DURATION_MINUTES: 10,
  IP_BLOCK_DURATION_MINUTES: 10 // 内存层封禁时长（旧逻辑）
}

const RISK_CONTROL = {
  IP_SWITCH_WINDOW_MS: 5 * 60 * 1000,
  IP_SWITCH_THRESHOLD: 3,
  IP_SWITCH_BLOCK_MINUTES: 10,
  USER_BLOCK_MINUTES: 10,
  SONG_VOTE_PROTECT_WINDOW_MS: 60 * 60 * 1000,
  SONG_VOTE_PROTECT_THRESHOLD: 10,
  SONG_VOTE_PROTECT_DURATION_MS: 10 * 60 * 1000,
  USER_BASELINE_MIN_PER_MIN: 0.5,
  USER_BASELINE_MULTIPLIER: 3,
  EMA_ALPHA: 0.2,
  SONG_IP_DOMINANCE_PERCENT: 0.6,
  SONG_IP_MIN_SAMPLE: 8
}

// ─────────────────────────────────────────────
// 清理过期的锁定记录
// ─────────────────────────────────────────────
function cleanupExpiredLocks() {
  const now = new Date()

  for (const [username, lockInfo] of accountLocks.entries()) {
    if (lockInfo.lockedUntil && lockInfo.lockedUntil <= now) {
      accountLocks.delete(username)
    }
  }

  for (const [ip, blockInfo] of ipBlacklist.entries()) {
    if (blockInfo.blockedUntil <= now) {
      ipBlacklist.delete(ip)
      console.log(`IP ${ip} 已从内存黑名单中移除`)
    }
  }

  for (const [username, monitor] of accountIpSwitchMonitor.entries()) {
    const cutoff = Date.now() - RISK_CONTROL.IP_SWITCH_WINDOW_MS
    for (const [ip, ts] of monitor.ipMap.entries()) {
      if (ts < cutoff) monitor.ipMap.delete(ip)
    }
    if (monitor.ipMap.size === 0) {
      accountIpSwitchMonitor.delete(username)
    }
  }

  for (const [songId, timestamps] of songVoteWindow.entries()) {
    const cutoff = Date.now() - RISK_CONTROL.SONG_VOTE_PROTECT_WINDOW_MS
    const filtered = timestamps.filter((t) => t >= cutoff)
    if (filtered.length) {
      songVoteWindow.set(songId, filtered)
    } else {
      songVoteWindow.delete(songId)
    }
  }

  for (const [userId, stats] of userVoteStats.entries()) {
    const cutoff = Date.now() - 10 * 60 * 1000
    stats.windowTimestamps = stats.windowTimestamps.filter((t) => t >= cutoff)
    if (stats.windowTimestamps.length === 0 && Date.now() - stats.lastUpdate > 60 * 60 * 1000) {
      userVoteStats.delete(userId)
    }
  }
}

// ─────────────────────────────────────────────
// 账户锁定相关（原有逻辑保留）
// ─────────────────────────────────────────────
export function isAccountLocked(username: string): boolean {
  cleanupExpiredLocks()
  const lockInfo = accountLocks.get(username)
  if (!lockInfo || !lockInfo.lockedUntil) return false
  return lockInfo.lockedUntil > new Date()
}

export function getAccountLockRemainingTime(username: string): number {
  const lockInfo = accountLocks.get(username)
  if (!lockInfo || !lockInfo.lockedUntil) return 0
  const now = new Date()
  if (lockInfo.lockedUntil <= now) return 0
  return Math.ceil((lockInfo.lockedUntil.getTime() - now.getTime()) / (1000 * 60))
}

// ─────────────────────────────────────────────
// 内存层 IP 黑名单（原有逻辑，保持向后compat）
// ─────────────────────────────────────────────
export function isIPBlocked(ip: string): boolean {
  cleanupExpiredLocks()
  const blockInfo = ipBlacklist.get(ip)
  if (!blockInfo) return false
  return blockInfo.blockedUntil > new Date()
}

export function getIPBlockRemainingTime(ip: string): number {
  const blockInfo = ipBlacklist.get(ip)
  if (!blockInfo) return 0
  const now = new Date()
  if (blockInfo.blockedUntil <= now) return 0
  return Math.ceil((blockInfo.blockedUntil.getTime() - now.getTime()) / (1000 * 60))
}

function blockIP(ip: string, reason: string): void {
  const now = new Date()
  const blockedUntil = new Date(
    now.getTime() + SECURITY_CONFIG.IP_BLOCK_DURATION_MINUTES * 60 * 1000
  )
  ipBlacklist.set(ip, { blockedUntil, reason, blockedTime: now })
  console.log(
    `IP ${ip} 已被加入内存黑名单 ${SECURITY_CONFIG.IP_BLOCK_DURATION_MINUTES} 分钟，原因：${reason}`
  )
}

// ─────────────────────────────────────────────
// 用户封禁
// ─────────────────────────────────────────────
export function blockUser(userId: number, minutes: number = RISK_CONTROL.USER_BLOCK_MINUTES): void {
  const until = new Date(Date.now() + minutes * 60 * 1000)
  userBlockUntil.set(userId, until)
}

export function isUserBlocked(userId: number): boolean {
  const until = userBlockUntil.get(userId)
  if (!until) return false
  return until > new Date()
}

export function getUserBlockRemainingTime(userId: number): number {
  const until = userBlockUntil.get(userId)
  if (!until) return 0
  const now = Date.now()
  if (until.getTime() <= now) return 0
  return Math.ceil((until.getTime() - now) / (1000 * 60))
}

// ─────────────────────────────────────────────
// 登录记录
// ─────────────────────────────────────────────
export function recordLoginFailure(username: string, ip: string): void {
  const now = new Date()

  let lockInfo = accountLocks.get(username)
  if (!lockInfo) {
    lockInfo = { failedAttempts: 0, lockedUntil: null, lastAttemptTime: now }
    accountLocks.set(username, lockInfo)
  }

  lockInfo.failedAttempts++
  lockInfo.lastAttemptTime = now

  if (lockInfo.failedAttempts >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS) {
    lockInfo.lockedUntil = new Date(
      now.getTime() + SECURITY_CONFIG.LOCK_DURATION_MINUTES * 60 * 1000
    )
    console.log(
      `账户 ${username} 因连续 ${SECURITY_CONFIG.MAX_FAILED_ATTEMPTS} 次登录失败被锁定 ${SECURITY_CONFIG.LOCK_DURATION_MINUTES} 分钟`
    )
  }
}

export function recordLoginSuccess(username: string, _ip: string): void {
  accountLocks.delete(username)
}

export function recordAccountIpLogin(username: string, ip: string): boolean {
  const now = Date.now()
  let monitor = accountIpSwitchMonitor.get(username)
  if (!monitor) {
    monitor = { ipMap: new Map<string, number>(), windowStart: now }
    accountIpSwitchMonitor.set(username, monitor)
  }
  const cutoff = now - RISK_CONTROL.IP_SWITCH_WINDOW_MS
  for (const [k, ts] of monitor.ipMap.entries()) {
    if (ts < cutoff) monitor.ipMap.delete(k)
  }
  monitor.ipMap.set(ip, now)
  const exceeded = monitor.ipMap.size > RISK_CONTROL.IP_SWITCH_THRESHOLD
  if (exceeded) {
    blockIP(ip, '账号短期内多IP登录超限')
    triggerAccountIpSwitchAlert(username, Array.from(monitor.ipMap.keys()))
  }
  return exceeded
}

// ─────────────────────────────────────────────
// ★ 新增：数据库持久化风控逻辑
// ─────────────────────────────────────────────

/**
 * 记录登录尝试到数据库（fire-and-forget，不阻塞登录流程）
 */
export function recordLoginAttempt(ip: string, username: string): void {
  db.insert(loginLogs)
    .values({ ip, username })
    .catch((err) => console.error('[RiskControl] 写入 loginLogs 失败:', err))
}

/**
 * 动态读取系统风控配置
 */
async function getRiskConfig(): Promise<{
  riskWindowMinutes: number
  riskMaxAttempts: number
  riskBanHours: number
}> {
  try {
    const result = await db
      .select({
        riskWindowMinutes: systemSettings.riskWindowMinutes,
        riskMaxAttempts: systemSettings.riskMaxAttempts,
        riskBanHours: systemSettings.riskBanHours
      })
      .from(systemSettings)
      .limit(1)

    if (result[0]) return result[0]
  } catch (err) {
    console.error('[RiskControl] 读取风控配置失败，使用默认值:', err)
  }
  return { riskWindowMinutes: 10, riskMaxAttempts: 4, riskBanHours: 168 }
}

/**
 * 检查 IP 风险并自动封禁
 * - 查询 loginLogs 中该 IP 在时间窗口内尝试过的不同 username 数量
 * - 若 >= riskMaxAttempts：写入 ip_blacklists、通知管理员、清除缓存
 */
export async function checkIpRisk(ip: string): Promise<{ blocked: boolean }> {
  try {
    const { riskWindowMinutes, riskMaxAttempts, riskBanHours } = await getRiskConfig()

    // 已被数据库封禁则直接返回（避免重复处理）
    const now = new Date()
    const alreadyBanned = await db
      .select({ ip: ipBlacklists.ip })
      .from(ipBlacklists)
      .where(
        and(
          eq(ipBlacklists.ip, ip),
          or(isNull(ipBlacklists.expiresAt), gte(ipBlacklists.expiresAt, now))
        )
      )
      .limit(1)

    if (alreadyBanned.length > 0) return { blocked: true }

    // 统计时间窗口内的不同账号数
    const windowStart = new Date(now.getTime() - riskWindowMinutes * 60 * 1000)

    const [countResult] = await db
      .select({ distinctCount: countDistinct(loginLogs.username) })
      .from(loginLogs)
      .where(and(eq(loginLogs.ip, ip), gte(loginLogs.createdAt, windowStart)))

    const distinctCount = countResult?.distinctCount ?? 0

    if (distinctCount >= riskMaxAttempts) {
      // 查出涉及的账号列表（用于通知）
      const involvedRows = await db
        .selectDistinct({ username: loginLogs.username })
        .from(loginLogs)
        .where(and(eq(loginLogs.ip, ip), gte(loginLogs.createdAt, windowStart)))

      const involvedUsernames = involvedRows.map((r) => r.username)

      const expiresAt = new Date(now.getTime() + riskBanHours * 60 * 60 * 1000)

      // 写入数据库黑名单（upsert：已存在则更新过期时间）
      await db
        .insert(ipBlacklists)
        .values({
          ip,
          reason: `频繁尝试登录多个账号（${riskWindowMinutes}分钟内尝试${distinctCount}个账号）`,
          bannedAt: now,
          expiresAt
        })
        .onConflictDoUpdate({
          target: ipBlacklists.ip,
          set: {
            reason: sql`EXCLUDED.reason`,
            bannedAt: sql`EXCLUDED.banned_at`,
            expiresAt: sql`EXCLUDED.expires_at`
          }
        })

      // 同步写入内存层，使 isIPBlocked() 立即生效
      const blockedUntil = new Date(
        now.getTime() + SECURITY_CONFIG.IP_BLOCK_DURATION_MINUTES * 60 * 1000
      )
      ipBlacklist.set(ip, {
        blockedUntil,
        reason: `频繁尝试登录多个账号`,
        blockedTime: now
      })

      // 清除中间件内存缓存，使新封禁立即对所有请求生效
      invalidateIpCache(ip)

      // 向超级管理员发送通知
      triggerRiskControlAlert(ip, distinctCount, involvedUsernames, riskWindowMinutes).catch(
        (err) => console.error('[RiskControl] 发送通知失败:', err)
      )

      console.log(
        `[RiskControl] IP ${ip} 已被封禁 ${riskBanHours}h，原因：${riskWindowMinutes}分钟内尝试 ${distinctCount} 个账号`
      )

      return { blocked: true }
    }

    return { blocked: false }
  } catch (err) {
    console.error('[RiskControl] checkIpRisk 出错:', err)
    return { blocked: false } // 出错时放行，避免影响正常业务
  }
}

// ─────────────────────────────────────────────
// 风控拦截通知（向管理员发送）
// ─────────────────────────────────────────────
async function triggerRiskControlAlert(
  ip: string,
  count: number,
  attemptedAccounts: string[],
  windowMinutes: number
): Promise<void> {
  try {
    const now = new Date()
    const alertTitle = '安全警报：检测到异常登录行为（IP 风控）'
    const alertContent = `检测时间：${now.toLocaleString('zh-CN')}
异常IP：${ip}
时间窗口：${windowMinutes}分钟内
尝试登录账户数：${count}
涉及账户：${attemptedAccounts.join(', ')}

建议立即检查该IP的登录活动并采取必要的安全措施。`

    console.log(`[RiskControl] 安全警报：IP ${ip} 在 ${windowMinutes} 分钟内尝试登录 ${count} 个不同账户`)

    const superAdmins = await db
      .select({ id: users.id, name: users.name, meowNickname: users.meowNickname })
      .from(users)
      .where(eq(users.role, 'SUPER_ADMIN'))

    for (const admin of superAdmins) {
      try {
        await createSystemNotification(admin.id, alertTitle, alertContent)
        if (admin.meowNickname) {
          await sendMeowNotificationToUser(admin.id, alertTitle, alertContent)
        }
      } catch (e) {
        console.error(`向管理员 ${admin.name} 发送风控通知失败:`, e)
      }
    }
  } catch (error) {
    console.error('[RiskControl] triggerRiskControlAlert 出错:', error)
  }
}

// triggerSecurityAlert removed: replaced by checkIpRisk DB-backed logic

async function triggerAccountIpSwitchAlert(username: string, ips: string[]): Promise<void> {
  try {
    const now = new Date()
    const alertTitle = '安全警报：账号短期内多IP登录'
    const alertContent = `检测时间：${now.toLocaleString('zh-CN')}
账号：${username}
时间窗口：${Math.floor(RISK_CONTROL.IP_SWITCH_WINDOW_MS / 60000)}分钟内
涉及IP数：${ips.length}

建议立即检查该账号的登录活动并采取必要的安全措施。`

    const superAdmins = await db
      .select({ id: users.id, name: users.name, meowNickname: users.meowNickname })
      .from(users)
      .where(eq(users.role, 'SUPER_ADMIN'))

    for (const admin of superAdmins) {
      try {
        await createSystemNotification(admin.id, alertTitle, alertContent)
        if (admin.meowNickname) {
          await sendMeowNotificationToUser(admin.id, alertTitle, alertContent)
        }
      } catch (e) {
        console.error(`[RiskControl] 向管理员 ${admin.name} 发送账号IP切换警报失败:`, e)
      }
    }
  } catch (error) {
    console.error('触发账号IP切换警报时发生错误:', error)
  }
}

// ─────────────────────────────────────────────
// 歌曲投票风控
// ─────────────────────────────────────────────
function ipBucketOf(ip: string): string {
  const parts = ip.split('.')
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}`
  return ip
}

export function isSongProtected(songId: number): boolean {
  const until = songProtectUntil.get(songId)
  if (!until) return false
  return until > new Date()
}

export function getSongProtectRemainingSeconds(songId: number): number {
  const until = songProtectUntil.get(songId)
  if (!until) return 0
  const now = Date.now()
  if (until.getTime() <= now) return 0
  return Math.ceil((until.getTime() - now) / 1000)
}

export function recordSongVote(songId: number, ip: string, _userId: number): boolean {
  const now = Date.now()
  const arr = songVoteWindow.get(songId) || []
  const cutoff = now - RISK_CONTROL.SONG_VOTE_PROTECT_WINDOW_MS
  const filtered = arr.filter((t) => t >= cutoff)
  filtered.push(now)
  songVoteWindow.set(songId, filtered)
  const buckets = songVoteIpBuckets.get(songId) || new Map<string, number>()
  const b = ipBucketOf(ip)
  buckets.set(b, (buckets.get(b) || 0) + 1)
  songVoteIpBuckets.set(songId, buckets)
  if (filtered.length > RISK_CONTROL.SONG_VOTE_PROTECT_THRESHOLD) {
    songProtectUntil.set(songId, new Date(now + RISK_CONTROL.SONG_VOTE_PROTECT_DURATION_MS))
    triggerSongVoteBurstAlert(songId, filtered.length, buckets)
    return true
  }
  return false
}

export function recordUserVoteActivity(userId: number, songTitle?: string): { anomaly: boolean } {
  const now = Date.now()
  let stats = userVoteStats.get(userId)
  if (!stats) {
    stats = { emaPerMin: 0, lastUpdate: now, windowTimestamps: [] }
    userVoteStats.set(userId, stats)
  }

  const cutoff = now - 10 * 60 * 1000
  stats.windowTimestamps = stats.windowTimestamps.filter((t) => t >= cutoff)
  stats.windowTimestamps.push(now)

  let currentRate = 0
  if (stats.windowTimestamps.length > 1) {
    const windowDurationMin = Math.max(1e-6, (now - Math.min(...stats.windowTimestamps)) / 60000)
    currentRate = stats.windowTimestamps.length / windowDurationMin
  }

  const smoothedEmaAlpha = 0.1
  stats.emaPerMin = smoothedEmaAlpha * currentRate + (1 - smoothedEmaAlpha) * stats.emaPerMin
  stats.lastUpdate = now

  const baseThreshold = 5
  const dynamicMultiplier = Math.max(2, 5 - Math.min(3, stats.emaPerMin / 100))
  const threshold = Math.max(baseThreshold, stats.emaPerMin * dynamicMultiplier)

  const anomaly = currentRate > threshold * 1.5
  if (anomaly) triggerVoteAnomalyAlert(userId, stats.emaPerMin, currentRate, songTitle)
  return { anomaly }
}

async function triggerSongVoteBurstAlert(
  songId: number,
  count: number,
  buckets: Map<string, number>
): Promise<void> {
  try {
    const now = new Date()
    const top = Array.from(buckets.entries()).sort((a, b) => b[1] - a[1])[0]
    const alertTitle = '风险告警：歌曲投票短时激增'
    const alertContent = `检测时间：${now.toLocaleString('zh-CN')}
歌曲ID：${songId}
窗口内票数：${count}
主导IP段：${top ? `${top[0]}.* (${top[1]})` : '无'}

已启动临时保护，暂停投票10分钟。`

    const superAdmins = await db
      .select({ id: users.id, name: users.name, meowNickname: users.meowNickname })
      .from(users)
      .where(eq(users.role, 'SUPER_ADMIN'))

    for (const admin of superAdmins) {
      try {
        await createSystemNotification(admin.id, alertTitle, alertContent)
        if (admin.meowNickname) {
          await sendMeowNotificationToUser(admin.id, alertTitle, alertContent)
        }
      } catch (e) {
        console.error(`[RiskControl] 发送歌曲投票激增警报失败:`, e)
      }
    }
  } catch (error) {
    console.error('触发歌曲投票激增警报时发生错误:', error)
  }
}

// 通知限流
function canSendNotification(key: string): boolean {
  const now = new Date()
  const lastSent = notificationRateLimit.get(key)
  if (lastSent && now.getTime() - lastSent.getTime() < NOTIFICATION_RATE_LIMIT_MINUTES * 60 * 1000) {
    return false
  }
  notificationRateLimit.set(key, now)
  return true
}

interface AnomalyEvent {
  userId: number
  ema: number
  rate: number
  songTitle?: string
  time: Date
}

const pendingAnomalies: AnomalyEvent[] = []
let anomalyAggregationTimer: ReturnType<typeof setTimeout> | null = null
const ANOMALY_AGGREGATION_WINDOW_MS = 60 * 1000

async function flushAnomalyAggregation() {
  if (pendingAnomalies.length === 0) {
    anomalyAggregationTimer = null
    return
  }

  try {
    const count = pendingAnomalies.length
    const songStats = new Map<string, number>()
    pendingAnomalies.forEach((e) => {
      const title = e.songTitle || '未知歌曲'
      songStats.set(title, (songStats.get(title) || 0) + 1)
    })

    const topSongs = Array.from(songStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([title, c]) => `- ${title} (${c}人)`)
      .join('\n')

    const alertTitle = '风险告警：检测到多名用户异常投票（汇总）'
    const alertContent = `在过去 1 分钟内，除已通知的用户外，还检测到 ${count} 名用户存在异常投票行为。

涉及主要歌曲：
${topSongs}

请关注后台日志或进行相关处理。`

    const superAdmins = await db
      .select({ id: users.id, name: users.name, meowNickname: users.meowNickname })
      .from(users)
      .where(eq(users.role, 'SUPER_ADMIN'))

    for (const admin of superAdmins) {
      try {
        await createSystemNotification(admin.id, alertTitle, alertContent)
        if (admin.meowNickname) {
          await sendMeowNotificationToUser(admin.id, alertTitle, alertContent)
        }
      } catch (e) {
        console.error(`[RiskControl] 发送投票汇总通知失败:`, e)
      }
    }
  } catch (error) {
    console.error('发送异常投票汇总通知失败:', error)
  } finally {
    pendingAnomalies.length = 0
    anomalyAggregationTimer = null
  }
}

async function triggerVoteAnomalyAlert(
  userId: number,
  ema: number,
  rate: number,
  songTitle?: string
): Promise<void> {
  try {
    const notificationKey = `vote_anomaly_${userId}`
    if (!canSendNotification(notificationKey)) return

    if (anomalyAggregationTimer) {
      pendingAnomalies.push({ userId, ema, rate, songTitle, time: new Date() })
      return
    }

    const now = new Date()
    const alertTitle = '风险告警：检测到异常投票速率'
    const alertContent = `检测时间：${now.toLocaleString('zh-CN')}
用户ID：${userId}
EMA基线：${ema.toFixed(2)} 次/分钟
当前速率：${rate.toFixed(2)} 次/分钟
${songTitle ? `涉及歌曲：${songTitle}\n` : ''}
提示：该用户的投票行为异常，已触发限流机制。`

    const superAdmins = await db
      .select({ id: users.id, name: users.name, meowNickname: users.meowNickname })
      .from(users)
      .where(eq(users.role, 'SUPER_ADMIN'))

    for (const admin of superAdmins) {
      try {
        await createSystemNotification(admin.id, alertTitle, alertContent)
        if (admin.meowNickname) {
          await sendMeowNotificationToUser(admin.id, alertTitle, alertContent)
        }
      } catch (e) {
        console.error(`[RiskControl] 发送投票异常警报失败:`, e)
      }
    }

    anomalyAggregationTimer = setTimeout(flushAnomalyAggregation, ANOMALY_AGGREGATION_WINDOW_MS)
  } catch (error) {
    console.error('触发投票异常警报时发生错误:', error)
  }
}

// ─────────────────────────────────────────────
// 安全统计
// ─────────────────────────────────────────────
export function getSecurityStats() {
  cleanupExpiredLocks()
  return {
    lockedAccounts: accountLocks.size,
    blockedIPs: ipBlacklist.size,
    config: SECURITY_CONFIG
  }
}

// 定期清理（每5分钟）
setInterval(cleanupExpiredLocks, 5 * 60 * 1000)
