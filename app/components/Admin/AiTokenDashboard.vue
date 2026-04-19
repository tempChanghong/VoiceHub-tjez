<template>
  <div class="max-w-[1400px] mx-auto space-y-8 pb-20 px-2">
    <!-- 头部 -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
      <div>
        <h2 class="text-2xl font-black text-zinc-100 tracking-tight">Token 监控</h2>
        <p class="text-xs text-zinc-500 mt-1">AI 调用成本与审计日志实时监控</p>
      </div>
      <div class="flex items-center gap-3">
        <button
          class="flex items-center gap-2 px-5 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all active:scale-95"
          :disabled="loading"
          @click="loadData"
        >
          <RotateCcw :size="14" :class="loading ? 'animate-spin' : ''" />
          刷新
        </button>
      </div>
    </div>

    <!-- 用量仪表盘 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- 今日用量 -->
      <div class="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-black text-zinc-100 uppercase tracking-widest flex items-center gap-2">
            <Sun :size="16" class="text-yellow-500" /> 今日用量
          </h3>
          <span class="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
            {{ formatNumber(summary.todayTokens) }} / {{ formatNumber(summary.dailyLimit) }}
          </span>
        </div>
        <div class="space-y-2">
          <div class="h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-700"
              :class="getProgressColor(todayPercent)"
              :style="{ width: `${Math.min(todayPercent, 100)}%` }"
            />
          </div>
          <div class="flex justify-between text-[10px] text-zinc-600">
            <span>已用 {{ todayPercent.toFixed(1) }}%</span>
            <span :class="todayPercent >= 90 ? 'text-red-400 font-bold' : ''">
              {{ todayPercent >= 90 ? '⚠ 接近上限' : `剩余 ${formatNumber(summary.dailyLimit - summary.todayTokens)}` }}
            </span>
          </div>
        </div>
      </div>

      <!-- 本月用量 -->
      <div class="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-black text-zinc-100 uppercase tracking-widest flex items-center gap-2">
            <Calendar :size="16" class="text-blue-500" /> 本月用量
          </h3>
          <span class="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
            {{ formatNumber(summary.monthTokens) }} / {{ formatNumber(summary.monthlyLimit) }}
          </span>
        </div>
        <div class="space-y-2">
          <div class="h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-700"
              :class="getProgressColor(monthPercent)"
              :style="{ width: `${Math.min(monthPercent, 100)}%` }"
            />
          </div>
          <div class="flex justify-between text-[10px] text-zinc-600">
            <span>已用 {{ monthPercent.toFixed(1) }}%</span>
            <span :class="monthPercent >= 90 ? 'text-red-400 font-bold' : ''">
              {{ monthPercent >= 90 ? '⚠ 接近上限' : `剩余 ${formatNumber(summary.monthlyLimit - summary.monthTokens)}` }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-1">
        <p class="text-[10px] font-black text-zinc-600 uppercase tracking-widest">总调用次数</p>
        <p class="text-2xl font-black text-zinc-100">{{ formatNumber(summary.totalCalls) }}</p>
      </div>
      <div class="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-1">
        <p class="text-[10px] font-black text-zinc-600 uppercase tracking-widest">总 Token 消耗</p>
        <p class="text-2xl font-black text-blue-400">{{ formatNumber(summary.totalTokens) }}</p>
      </div>
      <div class="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-1">
        <p class="text-[10px] font-black text-zinc-600 uppercase tracking-widest">输入 / 输出</p>
        <p class="text-lg font-black text-zinc-300">
          <span class="text-emerald-400">{{ formatNumber(summary.totalInputTokens) }}</span>
          <span class="text-zinc-700 mx-1">/</span>
          <span class="text-purple-400">{{ formatNumber(summary.totalOutputTokens) }}</span>
        </p>
      </div>
      <div class="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-1">
        <p class="text-[10px] font-black text-zinc-600 uppercase tracking-widest">估算成本</p>
        <p class="text-2xl font-black text-yellow-400">${{ summary.estimatedCostUSD?.toFixed(4) || '0.0000' }}</p>
        <p class="text-[9px] text-zinc-700">@$0.45/1M tokens</p>
      </div>
    </div>

    <!-- 日期过滤 + 审计日志 -->
    <div class="bg-zinc-900/10 border border-zinc-800/40 rounded-xl overflow-hidden shadow-2xl">
      <!-- 过滤栏 -->
      <div class="px-6 py-4 border-b border-zinc-800/60 bg-zinc-900/40 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <h3 class="text-sm font-black text-zinc-100 flex items-center gap-2">
          <FileText :size="16" class="text-zinc-500" /> 审计日志
        </h3>
        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2">
            <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest whitespace-nowrap">开始日期</label>
            <input
              v-model="filter.startDate"
              type="date"
              class="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-blue-500/30"
              @change="page = 1; loadData()"
            >
          </div>
          <div class="flex items-center gap-2">
            <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest whitespace-nowrap">结束日期</label>
            <input
              v-model="filter.endDate"
              type="date"
              class="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-blue-500/30"
              @change="page = 1; loadData()"
            >
          </div>
          <button
            class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[11px] font-bold rounded-lg transition-all"
            @click="clearFilter"
          >
            清除
          </button>
        </div>
      </div>

      <!-- 表头 -->
      <div class="hidden lg:grid grid-cols-12 gap-4 px-8 py-4 border-b border-zinc-800/40 bg-zinc-900/20">
        <div class="col-span-2 text-[10px] font-black text-zinc-600 uppercase tracking-widest">时间</div>
        <div class="col-span-2 text-[10px] font-black text-zinc-600 uppercase tracking-widest">动作</div>
        <div class="col-span-3 text-[10px] font-black text-zinc-600 uppercase tracking-widest">歌曲</div>
        <div class="col-span-2 text-[10px] font-black text-zinc-600 uppercase tracking-widest">模型</div>
        <div class="col-span-1 text-[10px] font-black text-zinc-600 uppercase tracking-widest text-right">Token</div>
        <div class="col-span-1 text-[10px] font-black text-zinc-600 uppercase tracking-widest text-right">延迟</div>
        <div class="col-span-1 text-[10px] font-black text-zinc-600 uppercase tracking-widest text-center">状态</div>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="py-16 flex items-center justify-center">
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          <span class="text-xs font-bold text-zinc-400 tracking-widest uppercase">加载中...</span>
        </div>
      </div>

      <!-- 空状态 -->
      <div
        v-else-if="logs.length === 0"
        class="py-16 flex flex-col items-center justify-center text-zinc-500"
      >
        <FileText :size="40" class="text-zinc-800 mb-3" />
        <p class="text-sm font-bold">暂无审计日志</p>
      </div>

      <!-- 日志列表 -->
      <div v-else class="divide-y divide-zinc-800/30">
        <div
          v-for="log in logs"
          :key="log.id"
          class="grid grid-cols-1 lg:grid-cols-12 gap-3 px-6 lg:px-8 py-4 hover:bg-zinc-800/10 transition-all items-center"
        >
          <!-- 时间 -->
          <div class="col-span-12 lg:col-span-2">
            <p class="text-xs font-bold text-zinc-300">{{ formatDate(log.createdAt) }}</p>
            <p class="text-[10px] text-zinc-600">{{ formatTime(log.createdAt) }}</p>
          </div>

          <!-- 动作 -->
          <div class="col-span-12 lg:col-span-2">
            <span :class="['px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest border', getActionStyle(log.action)]">
              {{ formatAction(log.action) }}
            </span>
          </div>

          <!-- 歌曲 -->
          <div class="col-span-12 lg:col-span-3">
            <p class="text-xs font-bold text-zinc-200 truncate">{{ log.songTitle || '—' }}</p>
            <p class="text-[10px] text-zinc-600 truncate">{{ log.songArtist || '' }}</p>
          </div>

          <!-- 模型 -->
          <div class="col-span-12 lg:col-span-2">
            <p class="text-[10px] font-mono text-zinc-500 truncate">{{ log.modelName || '—' }}</p>
          </div>

          <!-- Token -->
          <div class="col-span-12 lg:col-span-1 text-right">
            <p class="text-xs font-bold text-zinc-300">{{ formatNumber(log.totalTokens || 0) }}</p>
            <p class="text-[9px] text-zinc-700">{{ log.inputTokens }}+{{ log.outputTokens }}</p>
          </div>

          <!-- 延迟 -->
          <div class="col-span-12 lg:col-span-1 text-right">
            <p class="text-xs font-bold" :class="log.latencyMs > 5000 ? 'text-yellow-400' : 'text-zinc-400'">
              {{ log.latencyMs ? `${log.latencyMs}ms` : '—' }}
            </p>
          </div>

          <!-- 状态 -->
          <div class="col-span-12 lg:col-span-1 flex justify-center">
            <span
              :class="[
                'w-2 h-2 rounded-full',
                log.success ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
              ]"
              :title="log.success ? '成功' : (log.errorMessage || '失败')"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="flex items-center justify-center gap-2">
      <button
        class="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-xs font-bold rounded-lg transition-all disabled:opacity-40"
        :disabled="page <= 1"
        @click="page--; loadData()"
      >
        上一页
      </button>
      <span class="text-xs text-zinc-500">{{ page }} / {{ Math.ceil(total / pageSize) }}</span>
      <button
        class="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-xs font-bold rounded-lg transition-all disabled:opacity-40"
        :disabled="page >= Math.ceil(total / pageSize)"
        @click="page++; loadData()"
      >
        下一页
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RotateCcw, Sun, Calendar, FileText } from 'lucide-vue-next'

const logs = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 30
const loading = ref(false)

const summary = ref({
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  estimatedCostUSD: 0,
  todayTokens: 0,
  monthTokens: 0,
  dailyLimit: 100000,
  monthlyLimit: 2000000,
})

const filter = ref({
  startDate: '',
  endDate: '',
})

const todayPercent = computed(() =>
  summary.value.dailyLimit > 0
    ? (summary.value.todayTokens / summary.value.dailyLimit) * 100
    : 0
)

const monthPercent = computed(() =>
  summary.value.monthlyLimit > 0
    ? (summary.value.monthTokens / summary.value.monthlyLimit) * 100
    : 0
)

/**
 * 加载审计日志和统计数据
 */
async function loadData() {
  loading.value = true
  try {
    const query = {
      page: page.value,
      pageSize,
      ...(filter.value.startDate ? { startDate: filter.value.startDate } : {}),
      ...(filter.value.endDate ? { endDate: filter.value.endDate } : {}),
    }
    const res = await $fetch('/api/admin/ai/logs', { query })
    logs.value = res.list || []
    total.value = res.total || 0
    if (res.summary) {
      summary.value = res.summary
    }
  } catch {
    // 静默失败，保持上次数据
  } finally {
    loading.value = false
  }
}

function clearFilter() {
  filter.value = { startDate: '', endDate: '' }
  page.value = 1
  loadData()
}

/**
 * 进度条颜色
 */
function getProgressColor(percent) {
  if (percent >= 90) return 'bg-red-500'
  if (percent >= 70) return 'bg-yellow-500'
  return 'bg-blue-500'
}

/**
 * 格式化大数字
 */
function formatNumber(n) {
  if (!n) return '0'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

/**
 * 格式化日期
 */
function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 格式化时间
 */
function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toTimeString().slice(0, 8)
}

/**
 * 动作标签样式
 */
function getActionStyle(action) {
  const map = {
    COMPLIANCE_PASS: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    COMPLIANCE_PRE_REJECT: 'bg-red-500/10 border-red-500/20 text-red-400',
    VALUE_SCORE: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    MANUAL_RESTORE: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    MANUAL_OVERRIDE: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
    AUTO_REJECT: 'bg-zinc-700/30 border-zinc-700 text-zinc-500',
  }
  return map[action] || 'bg-zinc-800 border-zinc-700 text-zinc-500'
}

/**
 * 动作中文名
 */
function formatAction(action) {
  const map = {
    COMPLIANCE_PASS: '合规通过',
    COMPLIANCE_PRE_REJECT: '预驳回',
    VALUE_SCORE: '价值评分',
    MANUAL_RESTORE: '人工批准',
    MANUAL_OVERRIDE: '人工改分',
    AUTO_REJECT: '自动驳回',
    SCORING_PARSE_ERROR: '解析错误',
  }
  return map[action] || action
}

onMounted(loadData)
</script>
