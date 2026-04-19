import {bigint, boolean, integer, pgEnum, pgTable, serial, text, timestamp, uuid, varchar, unique} from 'drizzle-orm/pg-core';
import {relations} from 'drizzle-orm';

// 枚举定义
export const blacklistTypeEnum = pgEnum('BlacklistType', ['SONG', 'KEYWORD']);
export const userStatusEnum = pgEnum('user_status', ['active', 'withdrawn', 'graduate']);
export const collaboratorStatusEnum = pgEnum('collaborator_status', ['PENDING', 'ACCEPTED', 'REJECTED']);
export const replayRequestStatusEnum = pgEnum('replay_request_status', ['PENDING', 'FULFILLED', 'REJECTED']);
export const aiSongStatusEnum = pgEnum('ai_song_status', [
  'PENDING',        // 等待 AI 审核
  'APPROVED',       // AI 合规通过
  'PRE_REJECTED',   // AI 预驳回（等待人工复核）
  'REJECTED',       // 正式驳回（超时自动或人工确认）
  'RESTORED',       // 管理员从预驳回恢复
  'SCORED',         // 已完成价值评分
]);

// 用户表
export const users = pgTable('User', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  username: text('username').notNull(),
  name: text('name'),
  grade: text('grade'),
  class: text('class'),
  role: text('role').default('USER').notNull(),
  password: text('password').notNull(),
  email: text('email'),
  emailVerified: boolean('emailVerified').default(false),
  lastLogin: timestamp('lastLogin'),
  lastLoginIp: text('lastLoginIp'),
  passwordChangedAt: timestamp('passwordChangedAt'),
  forcePasswordChange: boolean('forcePasswordChange').default(true).notNull(),
  meowNickname: text('meowNickname'),
  meowBoundAt: timestamp('meowBoundAt'),
  status: userStatusEnum('status').default('active').notNull(),
  statusChangedAt: timestamp('statusChangedAt').defaultNow(),
  statusChangedBy: integer('statusChangedBy'),
});

// 播出时段表
export const playTimes = pgTable('PlayTime', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  name: text('name').notNull(),
  startTime: text('startTime'),
  endTime: text('endTime'),
  enabled: boolean('enabled').default(true).notNull(),
  description: text('description'),
});

// 歌曲表
export const songs = pgTable('Song', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  requesterId: integer('requesterId').notNull(),
  played: boolean('played').default(false).notNull(),
  playedAt: timestamp('playedAt').defaultNow(),
  semester: text('semester'),
  preferredPlayTimeId: integer('preferredPlayTimeId'),
  cover: text('cover'),
  playUrl: text('playUrl'),
  musicPlatform: text('musicPlatform'),
  musicId: text('musicId'),
  submissionNote: text('submissionNote'),
  submissionNotePublic: boolean('submissionNotePublic').default(false).notNull(),
  hitRequestId: integer(),
  recommendation: text('recommendation'),
  // --- AI 审核与评分字段（Phase 1 增量） ---
  // AI 审核状态（默认 PENDING，表示等待 AI 处理）
  aiStatus: text('ai_status').default('PENDING'),
  // AI 合规审查结果 JSON: { passed, reason, categories, confidence, risk_level }
  aiComplianceResult: text('ai_compliance_result'),
  aiComplianceAt: timestamp('ai_compliance_at'),
  // AI 价值评分（0-100）
  aiScore: integer('ai_score'),
  // AI 评分明细 JSON: { dimensions: [...], summary, highlightTags }
  aiScoreBreakdown: text('ai_score_breakdown'),
  aiScoreAt: timestamp('ai_score_at'),
  // 人工干预标记
  aiManualCorrected: boolean('ai_manual_corrected').default(false),
  aiManualScore: integer('ai_manual_score'),
  aiManualCorrectedBy: integer('ai_manual_corrected_by'),
  aiManualCorrectedAt: timestamp('ai_manual_corrected_at'),
  // 预驳回时间戳：+ preRejectGraceDays 后 Cron 自动转正式 REJECTED
  aiPreRejectedAt: timestamp('ai_pre_rejected_at'),
});

// 投票表
export const votes = pgTable('Vote', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  songId: integer('songId').notNull(),
  userId: integer('userId').notNull(),
});

// 排期表
export const schedules = pgTable('Schedule', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  songId: integer('songId').notNull(),
  playDate: timestamp('playDate').notNull(),
  played: boolean('played').default(false).notNull(),
  sequence: integer('sequence').default(1).notNull(),
  playTimeId: integer('playTimeId'),
  // 草稿支持字段
  isDraft: boolean('isDraft').default(false).notNull(),
  publishedAt: timestamp('publishedAt'),
});

// 通知表
export const notifications = pgTable('Notification', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  type: text('type').notNull(),
  message: text('message').notNull(),
  read: boolean('read').default(false).notNull(),
  userId: integer('userId').notNull(),
  songId: integer('songId'),
});

// 通知设置表
export const notificationSettings = pgTable('NotificationSettings', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  userId: integer('userId').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  songRequestEnabled: boolean('songRequestEnabled').default(true).notNull(),
  songVotedEnabled: boolean('songVotedEnabled').default(true).notNull(),
  songPlayedEnabled: boolean('songPlayedEnabled').default(true).notNull(),
  refreshInterval: integer('refreshInterval').default(60).notNull(),
  songVotedThreshold: integer('songVotedThreshold').default(1).notNull(),
});

// 学期表
export const semesters = pgTable('Semester', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  name: text('name').notNull(),
  isActive: boolean('isActive').default(false).notNull(),
});

// 系统设置表
export const systemSettings = pgTable('SystemSettings', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  enablePlayTimeSelection: boolean('enablePlayTimeSelection').default(false).notNull(),
  siteTitle: text('siteTitle'),
  siteLogoUrl: text('siteLogoUrl'),
  schoolLogoHomeUrl: text('schoolLogoHomeUrl'),
  schoolLogoPrintUrl: text('schoolLogoPrintUrl'),
  siteDescription: text('siteDescription'),
  submissionGuidelines: text('submissionGuidelines'),
  icpNumber: text('icpNumber'),
  gonganNumber: text('gonganNumber'),
  showBeianIcon: boolean('showBeianIcon').default(false).notNull(),
  enableSubmissionLimit: boolean('enableSubmissionLimit').default(false).notNull(),
  dailySubmissionLimit: integer('dailySubmissionLimit'),
  weeklySubmissionLimit: integer('weeklySubmissionLimit'),
  monthlySubmissionLimit: integer('monthlySubmissionLimit'),
  showBlacklistKeywords: boolean('showBlacklistKeywords').default(false).notNull(),
  hideStudentInfo: boolean('hideStudentInfo').default(true).notNull(),
  // SMTP 邮件配置
  smtpEnabled: boolean('smtpEnabled').default(false).notNull(),
  smtpHost: text('smtpHost'),
  smtpPort: integer('smtpPort').default(587),
  smtpSecure: boolean('smtpSecure').default(false),
  smtpUsername: text('smtpUsername'),
  smtpPassword: text('smtpPassword'),
  smtpFromEmail: text('smtpFromEmail'),
  smtpFromName: text('smtpFromName').default('校园广播站'),
  enableRequestTimeLimitation: boolean('enableRequestTimeLimitation').default(false).notNull(),
  forceBlockAllRequests: boolean().default(false).notNull(),
  enableReplayRequests: boolean('enableReplayRequests').default(false).notNull(),
  enableRecommendation: boolean('enableRecommendation').default(false).notNull(),
  requireRecommendation: boolean('requireRecommendation').default(false).notNull(),
  recommendationMinLength: integer('recommendationMinLength').default(50).notNull(),
  recommendationMaxLength: integer('recommendationMaxLength').default(100).notNull(),
  enableCollaborativeSubmission: boolean('enableCollaborativeSubmission').default(true).notNull(),
  enableSubmissionRemarks: boolean('enableSubmissionRemarks').default(false).notNull(),
  // OAuth 配置
  allowOAuthRegistration: boolean('allowOAuthRegistration').default(false).notNull(),
  oauthRedirectUri: text('oauthRedirectUri'),
  oauthStateSecret: text('oauthStateSecret'),
  oauthProviders: text('oauthProviders').default('[]'),
  // GitHub OAuth
  githubOAuthEnabled: boolean('githubOAuthEnabled').default(false).notNull(),
  githubClientId: text('githubClientId'),
  githubClientSecret: text('githubClientSecret'),
  // Casdoor OAuth
  casdoorOAuthEnabled: boolean('casdoorOAuthEnabled').default(false).notNull(),
  casdoorServerUrl: text('casdoorServerUrl'),
  casdoorClientId: text('casdoorClientId'),
  casdoorClientSecret: text('casdoorClientSecret'),
  casdoorOrganizationName: text('casdoorOrganizationName'),
  // Google OAuth
  googleOAuthEnabled: boolean('googleOAuthEnabled').default(false).notNull(),
  googleClientId: text('googleClientId'),
  googleClientSecret: text('googleClientSecret'),
  // Custom OAuth2
  customOAuthEnabled: boolean('customOAuthEnabled').default(false).notNull(),
  customOAuthDisplayName: text('customOAuthDisplayName'),
  customOAuthAuthorizeUrl: text('customOAuthAuthorizeUrl'),
  customOAuthTokenUrl: text('customOAuthTokenUrl'),
  customOAuthUserInfoUrl: text('customOAuthUserInfoUrl'),
  customOAuthScope: text('customOAuthScope'),
  customOAuthClientId: text('customOAuthClientId'),
  customOAuthClientSecret: text('customOAuthClientSecret'),
  customOAuthUserIdField: text('customOAuthUserIdField'),
  customOAuthUsernameField: text('customOAuthUsernameField'),
  customOAuthNameField: text('customOAuthNameField'),
  customOAuthEmailField: text('customOAuthEmailField'),
  customOAuthAvatarField: text('customOAuthAvatarField'),
  // 风控设置
  riskWindowMinutes: integer('riskWindowMinutes').notNull().default(10),
  riskMaxAttempts: integer('riskMaxAttempts').notNull().default(4),
  riskBanHours: integer('riskBanHours').notNull().default(168),
});

// 歌曲黑名单表
export const songBlacklists = pgTable('SongBlacklist', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  type: blacklistTypeEnum('type').notNull(),
  value: text('value').notNull(),
  reason: text('reason'),
  isActive: boolean('isActive').default(true).notNull(),
  createdBy: integer('createdBy'),
});

// API Keys表
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 10 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdByUserId: integer('created_by_user_id').notNull(),
  usageCount: integer('usage_count').default(0).notNull(),

});

// API Key权限表
export const apiKeyPermissions = pgTable('api_key_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiKeyId: uuid('api_key_id').notNull(),
  permission: varchar('permission', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// API访问日志表
export const apiLogs = pgTable('api_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiKeyId: uuid('api_key_id'),
  endpoint: varchar('endpoint', { length: 500 }).notNull(),
  method: varchar('method', { length: 10 }).notNull(),
  ipAddress: text('ip_address').notNull(),
  userAgent: text('user_agent'),
  statusCode: integer('status_code').notNull(),
  responseTimeMs: integer('response_time_ms').notNull(),
  requestBody: text('request_body'),
  responseBody: text('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  errorMessage: text('error_message'),
});

// 用户状态变更日志表
export const userStatusLogs = pgTable('user_status_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  oldStatus: userStatusEnum('old_status'),
  newStatus: userStatusEnum('new_status').notNull(),
  reason: text('reason'),
  operatorId: integer('operator_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const requestTimes = pgTable("RequestTime", {
  id: serial().primaryKey().notNull(),
  createdAt: timestamp({ precision: 6, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp({ precision: 6, mode: 'string' }).defaultNow().notNull(),
  name: text().notNull(),
  startTime: timestamp({ mode: 'string' }).notNull(),
  endTime: timestamp({ mode: 'string' }).notNull(),
  enabled: boolean().default(true).notNull(),
  description: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  expected: bigint({ mode: "number" }).default(0).notNull(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  accepted: bigint({ mode: "number" }).default(0).notNull(),
  past: boolean().default(false).notNull(),
});

// 联合投稿人表
export const songCollaborators = pgTable('song_collaborators', {
    id: uuid('id').primaryKey().defaultRandom(),
    songId: integer('song_id').notNull(),
    userId: integer('user_id').notNull(),
    status: collaboratorStatusEnum('status').default('PENDING').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
});

// 联合投稿审计日志表
export const collaborationLogs = pgTable('collaboration_logs', {
    id: uuid('id').primaryKey().defaultRandom(),
    collaboratorId: uuid('collaborator_id').notNull(),
    action: varchar('action', {length: 50}).notNull(), // INVITE, ACCEPT, REJECT, REMOVE
    operatorId: integer('operator_id').notNull(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
});

// 歌曲重播申请表
export const songReplayRequests = pgTable('song_replay_requests', {
  id: serial('id').primaryKey(),
  songId: integer('song_id').notNull(),
  userId: integer('user_id').notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
  status: replayRequestStatusEnum('status').default('PENDING').notNull(),
}, (t) => ({
  unq: unique().on(t.songId, t.userId),
}));

// 第三方身份关联表
export const userIdentities = pgTable('UserIdentity', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerUserId: text('providerUserId').notNull(),
  providerUsername: text('providerUsername'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, (t) => ({
  unq: unique().on(t.provider, t.providerUserId),
}));

// 关系定义
export const usersRelations = relations(users, ({ many, one }) => ({
  songs: many(songs),
  votes: many(votes),
  notifications: many(notifications),
  identities: many(userIdentities),
  notificationSettings: one(notificationSettings, {
    fields: [users.id],
    references: [notificationSettings.userId],
  }),
  apiKeys: many(apiKeys),
  statusLogs: many(userStatusLogs),
    collaborations: many(songCollaborators),
  replayRequests: many(songReplayRequests),
  statusChangedByUser: one(users, {
    fields: [users.statusChangedBy],
    references: [users.id],
  }),
}));

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
  user: one(users, {
    fields: [userIdentities.userId],
    references: [users.id],
  }),
}));

export const songsRelations = relations(songs, ({ one, many }) => ({
  requester: one(users, {
    fields: [songs.requesterId],
    references: [users.id],
  }),
  preferredPlayTime: one(playTimes, {
    fields: [songs.preferredPlayTimeId],
    references: [playTimes.id],
  }),
  votes: many(votes),
  schedules: many(schedules),
  notifications: many(notifications),
    collaborators: many(songCollaborators),
    replayRequests: many(songReplayRequests),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  song: one(songs, {
    fields: [votes.songId],
    references: [songs.id],
  }),
  user: one(users, {
    fields: [votes.userId],
    references: [users.id],
  }),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
  song: one(songs, {
    fields: [schedules.songId],
    references: [songs.id],
  }),
  playTime: one(playTimes, {
    fields: [schedules.playTimeId],
    references: [playTimes.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  song: one(songs, {
    fields: [notifications.songId],
    references: [songs.id],
  }),
}));

export const notificationSettingsRelations = relations(notificationSettings, ({ one }) => ({
  user: one(users, {
    fields: [notificationSettings.userId],
    references: [users.id],
  }),
}));

export const playTimesRelations = relations(playTimes, ({ many }) => ({
  songs: many(songs),
  schedules: many(schedules),
}));

// API框架关系定义
export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [apiKeys.createdByUserId],
    references: [users.id],
  }),
  permissions: many(apiKeyPermissions),
  logs: many(apiLogs),
}));

export const apiKeyPermissionsRelations = relations(apiKeyPermissions, ({ one }) => ({
  apiKey: one(apiKeys, {
    fields: [apiKeyPermissions.apiKeyId],
    references: [apiKeys.id],
  }),
}));

export const apiLogsRelations = relations(apiLogs, ({ one }) => ({
  apiKey: one(apiKeys, {
    fields: [apiLogs.apiKeyId],
    references: [apiKeys.id],
  }),
}));

export const userStatusLogsRelations = relations(userStatusLogs, ({ one }) => ({
  user: one(users, {
    fields: [userStatusLogs.userId],
    references: [users.id],
  }),
  operator: one(users, {
    fields: [userStatusLogs.operatorId],
    references: [users.id],
  }),
}));

export const songCollaboratorsRelations = relations(songCollaborators, ({one, many}) => ({
    song: one(songs, {
        fields: [songCollaborators.songId],
        references: [songs.id],
    }),
    user: one(users, {
        fields: [songCollaborators.userId],
        references: [users.id],
    }),
    logs: many(collaborationLogs),
}));

export const collaborationLogsRelations = relations(collaborationLogs, ({one}) => ({
    collaborator: one(songCollaborators, {
        fields: [collaborationLogs.collaboratorId],
        references: [songCollaborators.id],
    }),
    operator: one(users, {
        fields: [collaborationLogs.operatorId],
        references: [users.id],
    }),
}));

export const songReplayRequestsRelations = relations(songReplayRequests, ({one}) => ({
    song: one(songs, {
        fields: [songReplayRequests.songId],
        references: [songs.id],
    }),
    user: one(users, {
        fields: [songReplayRequests.userId],
        references: [users.id],
    }),
}));

// 邮件模板表（仅存储自定义覆盖，内置模板在代码中定义）
export const emailTemplates = pgTable('EmailTemplate', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  key: varchar('key', { length: 100 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  subject: varchar('subject', { length: 300 }).notNull(),
  html: text('html').notNull(),
  updatedByUserId: integer('updatedByUserId'),
});

// 登录尝试日志表（用于风控分析）
export const loginLogs = pgTable('login_logs', {
  id: serial('id').primaryKey(),
  ip: varchar('ip', { length: 45 }).notNull(),
  username: varchar('username', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// IP 黑名单表（持久化封禁记录）
export const ipBlacklists = pgTable('ip_blacklists', {
  id: serial('id').primaryKey(),
  ip: varchar('ip', { length: 45 }).notNull().unique(),
  reason: varchar('reason', { length: 500 }).notNull(),
  bannedAt: timestamp('banned_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'), // null = 永久封禁
});

// --- AI 审核与评分系统（Phase 1 增量） ---

// AI 审计日志表：记录每一次 LLM 调用的 Token 消耗、延迟、请求/响应摘要
export const aiAuditLogs = pgTable('ai_audit_logs', {
  id: serial('id').primaryKey(),
  songId: integer('song_id').notNull(),
  action: varchar('action', { length: 50 }).notNull(),
  // 动作类型: COMPLIANCE_SCAN | COMPLIANCE_PASS | COMPLIANCE_PRE_REJECT
  //         | VALUE_SCORE | MANUAL_OVERRIDE | AUTO_REJECT | MANUAL_RESTORE
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  totalTokens: integer('total_tokens').default(0),
  modelName: varchar('model_name', { length: 100 }),
  promptVersion: varchar('prompt_version', { length: 50 }),
  requestPayload: text('request_payload'),   // 请求摘要（截断存储，不超过 2KB）
  responsePayload: text('response_payload'), // 响应摘要
  latencyMs: integer('latency_ms'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  operatorId: integer('operator_id'),        // 若为人工触发，记录管理员 ID
});

// AI 配置表：全局单例（始终使用 id=1 的记录）
export const aiSettings = pgTable('ai_settings', {
  id: serial('id').primaryKey(),
  // LLM 连接配置
  provider: varchar('provider', { length: 50 }).default('openai'),
  apiKey: text('api_key'),                    // 加密存储（由应用层处理加解密）
  apiBaseUrl: text('api_base_url'),
  modelName: varchar('model_name', { length: 100 }).default('gpt-4o-mini'),
  connectionVerified: boolean('connection_verified').default(false),
  connectionVerifiedAt: timestamp('connection_verified_at'),
  // 审核与评分准则（管理员自定义追加）
  complianceCriteria: text('compliance_criteria'),
  scoringCriteria: text('scoring_criteria'),
  // 功能开关
  enableAiCompliance: boolean('enable_ai_compliance').default(false),
  enableAiScoring: boolean('enable_ai_scoring').default(false),
  // 成本控制
  dailyTokenLimit: integer('daily_token_limit').default(100000),
  monthlyTokenLimit: integer('monthly_token_limit').default(2000000),
  // 预驳回自动转正式驳回的宽限天数
  preRejectGraceDays: integer('pre_reject_grace_days').default(3),
  // 排期排序权重（AI 分 vs 投票热度）
  scoreSortWeight: integer('score_sort_weight').default(70),
  voteSortWeight: integer('vote_sort_weight').default(30),
  // 批量扫描配置（适配 Vercel 10s 超时）
  batchSize: integer('batch_size').default(10),
  scanIntervalMinutes: integer('scan_interval_minutes').default(30),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// AI 审计日志 ↔ 歌曲 / 操作员关系
export const aiAuditLogsRelations = relations(aiAuditLogs, ({ one }) => ({
  song: one(songs, {
    fields: [aiAuditLogs.songId],
    references: [songs.id],
  }),
  operator: one(users, {
    fields: [aiAuditLogs.operatorId],
    references: [users.id],
  }),
}));

// 导出所有表的类型
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Song = typeof songs.$inferSelect;
export type NewSong = typeof songs.$inferInsert;
export type Vote = typeof votes.$inferSelect;
export type NewVote = typeof votes.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type NewNotificationSettings = typeof notificationSettings.$inferInsert;
export type PlayTime = typeof playTimes.$inferSelect;
export type NewPlayTime = typeof playTimes.$inferInsert;
export type Semester = typeof semesters.$inferSelect;
export type NewSemester = typeof semesters.$inferInsert;
export type SystemSettings = typeof systemSettings.$inferSelect;
export type NewSystemSettings = typeof systemSettings.$inferInsert;
export type SongBlacklist = typeof songBlacklists.$inferSelect;
export type NewSongBlacklist = typeof songBlacklists.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type ApiKeyPermission = typeof apiKeyPermissions.$inferSelect;
export type NewApiKeyPermission = typeof apiKeyPermissions.$inferInsert;
export type ApiLog = typeof apiLogs.$inferSelect;
export type NewApiLog = typeof apiLogs.$inferInsert;
export type UserStatusLog = typeof userStatusLogs.$inferSelect;
export type NewUserStatusLog = typeof userStatusLogs.$inferInsert;
export type SongCollaborator = typeof songCollaborators.$inferSelect;
export type NewSongCollaborator = typeof songCollaborators.$inferInsert;
export type CollaborationLog = typeof collaborationLogs.$inferSelect;
export type NewCollaborationLog = typeof collaborationLogs.$inferInsert;
export type SongReplayRequest = typeof songReplayRequests.$inferSelect;
export type NewSongReplayRequest = typeof songReplayRequests.$inferInsert;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
export type RequestTime = typeof requestTimes.$inferSelect;
export type NewRequestTime = typeof requestTimes.$inferInsert;
export type UserIdentity = typeof userIdentities.$inferSelect;
export type NewUserIdentity = typeof userIdentities.$inferInsert;
export type AiAuditLog = typeof aiAuditLogs.$inferSelect;
export type NewAiAuditLog = typeof aiAuditLogs.$inferInsert;
export type AiSettings = typeof aiSettings.$inferSelect;
export type NewAiSettings = typeof aiSettings.$inferInsert;
export type LoginLog = typeof loginLogs.$inferSelect;
export type NewLoginLog = typeof loginLogs.$inferInsert;
export type IpBlacklist = typeof ipBlacklists.$inferSelect;
export type NewIpBlacklist = typeof ipBlacklists.$inferInsert;
