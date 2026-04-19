<template>
  <div class="max-w-[1400px] mx-auto space-y-8 pb-20 px-2">
    <!-- 头部 -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
      <div>
        <h2 class="text-2xl font-black text-zinc-100 tracking-tight">预驳回管理</h2>
        <p class="text-xs text-zinc-500 mt-1">AI 标记为疑似违规的歌曲，宽限期内可人工复核</p>
      </div>
      <button
        class="flex items-center gap-2 px-5 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all active:scale-95"
        :disabled="loading"
        @click="loadList"
      >
        <RotateCcw :size="14" :class="loading ? 'animate-spin' : ''" />
        刷新
      </button>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-1"
      >
        <p class="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{{ stat.label }}</p>
        <p :class="['text-2xl font-black', stat.color]">{{ stat.value }}</p>
      </div>
    </div>

    <!-- 列表 -->
    <div class="bg-zinc-900/10 border border-zinc-800/40 rounded-xl overflow-hidden shadow-2xl relative">
      <!-- 加载遮罩 -->
      <div
        v-if="loading"
        class="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm z-10 flex items-center justify-center"
      >
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          <span class="text-xs font-bold text-zinc-400 tracking-widest uppercase">加载中...</span>
        </div>
      </div>

      <!-- 表头 -->
      <div class="hidden lg:grid grid-cols-12 gap-4 px-8 py-5 border-b border-zinc-800/60 bg-zinc-900/40">
        <div class="col-span-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">歌曲信息</div>
        <div class="col-span-2 text-[10px] font-black text-zinc-600 uppercase tracking-widest">申请人</div>
        <div class="col-span-3 text-[10px] font-black text-zinc-600 uppercase tracking-widest">驳回原因</div>
        <div class="col-span-1 text-[10px] font-black text-zinc-600 uppercase tracking-widest text-center">剩余时间</div>
        <div class="col-span-2 text-[10px] font-black text-zinc-600 uppercase tracking-widest text-right pr-2">操作</div>
      </div>

      <!-- 空状态 -->
      <div
        v-if="list.length === 0 && !loading"
        class="py-20 flex flex-col items-center justify-center text-zinc-500"
      >
        <ShieldCheck :size="48" class="text-zinc-800 mb-4" />
        <p class="text-sm font-bold">暂无待复核歌曲</p>
        <p class="text-xs text-zinc-600 mt-1">所有歌曲均已通过合规审查</p>
      </div>

      <!-- 列表内容 -->
      <div v-else class="divide-y divide-zinc-800/40">
        <div
          v-for="item in list"
          :key="item.id"
          class="grid grid-cols-1 lg:grid-cols-12 gap-4 px-6 lg:px-8 py-5 hover:bg-zinc-800/20 transition-all items-start"
        >
          <!-- 歌曲信息 -->
          <div class="col-span-12 lg:col-span-4 flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-zinc-800/60 border border-zinc-700/30 flex items-center justify-center shrink-0 overflow-hidden">
              <img v-if="item.cover" :src="item.cover" class="w-full h-full object-cover" referrerpolicy="no-referrer">
              <Music v-else :size="16" class="text-zinc-600" />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-bold text-zinc-100 truncate">{{ item.title }}</p>
              <p class="text-xs text-zinc-500 truncate">{{ item.artist }}</p>
            </div>
          </div>

          <!-- 申请人 -->
          <div class="col-span-12 lg:col-span-2 flex items-center">
            <div>
              <p class="text-xs font-bold text-zinc-300">{{ item.requesterName || '—' }}</p>
              <p class="text-[10px] text-zinc-600">{{ item.requesterEmail || '' }}</p>
            </div>
          </div>

          <!-- 驳回原因 -->
          <div class="col-span-12 lg:col-span-3">
            <div
              v-if="item.complianceResult"
              class="space-y-1"
            >
              <p class="text-[10px] font-black text-red-400 uppercase tracking-widest">{{ item.complianceResult.verdict }}</p>
              <p class="text-xs text-zinc-400 leading-relaxed line-clamp-2">{{ item.complianceResult.reason }}</p>
              <div v-if="item.complianceResult.violatedRules?.length" class="flex flex-wrap gap-1 mt-1">
                <span
                  v-for="rule in item.complianceResult.violatedRules"
                  :key="rule"
                  class="px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] font-bold rounded-md"
                >
                  {{ rule }}
                </span>
              </div>
            </div>
            <p v-else class="text-xs text-zinc-600">—</p>
          </div>

          <!-- 剩余时间 -->
          <div class="col-span-12 lg:col-span-1 flex items-center justify-center">
            <div class="text-center">
              <p
                :class="[
                  'text-xs font-black',
                  getCountdownColor(item.autoRejectAt)
                ]"
              >
                {{ formatCountdown(item.autoRejectAt) }}
              </p>
              <p class="text-[9px] text-zinc-700 mt-0.5">自动驳回</p>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="col-span-12 lg:col-span-2 flex items-center justify-end gap-2">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[11px] font-black rounded-lg border border-emerald-500/20 transition-all active:scale-95 disabled:opacity-50"
              :disabled="actionLoading === item.id"
              @click="handleRestore(item)"
            >
              <CheckCircle :size="12" />
              批准
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[11px] font-black rounded-lg border border-red-500/20 transition-all active:scale-95 disabled:opacity-50"
              :disabled="actionLoading === item.id"
              @click="openConfirmReject(item)"
            >
              <XCircle :size="12" />
              驳回
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="flex items-center justify-center gap-2">
      <button
        class="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-xs font-bold rounded-lg transition-all disabled:opacity-40"
        :disabled="page <= 1"
        @click="page--; loadList()"
      >
        上一页
      </button>
      <span class="text-xs text-zinc-500">{{ page }} / {{ Math.ceil(total / pageSize) }}</span>
      <button
        class="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-xs font-bold rounded-lg transition-all disabled:opacity-40"
        :disabled="page >= Math.ceil(total / pageSize)"
        @click="page++; loadList()"
      >
        下一页
      </button>
    </div>

    <!-- 确认驳回弹窗 -->
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100">
      <div
        v-if="confirmTarget"
        class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        @click.self="confirmTarget = null"
      >
        <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertTriangle :size="18" class="text-red-400" />
            </div>
            <div>
              <h3 class="text-sm font-black text-zinc-100">确认驳回</h3>
              <p class="text-xs text-zinc-500">此操作不可撤销，歌曲将被永久删除</p>
            </div>
          </div>
          <div class="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/50">
            <p class="text-xs font-bold text-zinc-200">{{ confirmTarget?.title }}</p>
            <p class="text-[10px] text-zinc-500 mt-0.5">{{ confirmTarget?.artist }}</p>
          </div>
          <div class="space-y-1.5">
            <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">驳回备注（可选）</label>
            <input
              v-model="rejectReason"
              type="text"
              placeholder="填写给申请人的说明..."
              class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-red-500/30"
            >
          </div>
          <div class="flex gap-3 pt-2">
            <button
              class="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all"
              @click="confirmTarget = null"
            >
              取消
            </button>
            <button
              class="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50"
              :disabled="actionLoading === confirmTarget?.id"
              @click="handleConfirmReject"
            >
              {{ actionLoading === confirmTarget?.id ? '处理中...' : '确认驳回' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0 translate-y-4" enter-to-class="opacity-100 translate-y-0" leave-active-class="transition duration-200 ease-in" leave-from-class="opacity-100 translate-y-0" leave-to-class="opacity-0 translate-y-4">
      <div
        v-if="toast"
        :class="[
          'fixed bottom-8 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-xs font-bold shadow-2xl flex items-center gap-2 z-50 border',
          toast.type === 'success'
            ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
            : 'bg-red-950 border-red-800 text-red-300'
        ]"
      >
        <CheckCircle v-if="toast.type === 'success'" :size="14" />
        <XCircle v-else :size="14" />
        {{ toast.message }}
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  RotateCcw, Music, ShieldCheck, CheckCircle, XCircle,
  AlertTriangle
} from 'lucide-vue-next'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const actionLoading = ref(null)
const confirmTarget = ref(null)
const rejectReason = ref('')
const toast = ref(null)

let countdownTimer = null

const stats = computed(() => [
  { label: '待复核', value: total.value, color: 'text-red-400' },
  { label: '今日新增', value: list.value.filter(i => isToday(i.aiPreRejectedAt)).length, color: 'text-yellow-400' },
  { label: '即将到期', value: list.value.filter(i => isExpiringSoon(i.autoRejectAt)).length, color: 'text-orange-400' },
  { label: '已过期', value: list.value.filter(i => isExpired(i.autoRejectAt)).length, color: 'text-zinc-500' },
])

/**
 * 加载预驳回列表
 */
async function loadList() {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/ai/pre-rejected', {
      query: { page: page.value, pageSize },
    })
    list.value = res.list || []
    total.value = res.total || 0
  } catch {
    showToast('加载失败', 'error')
  } finally {
    loading.value = false
  }
}

/**
 * 手动批准（Restore）
 */
async function handleRestore(item) {
  actionLoading.value = item.id
  try {
    await $fetch('/api/admin/ai/override', {
      method: 'POST',
      body: { songId: item.id, action: 'restore' },
    })
    showToast(`《${item.title}》已批准通过`)
    await loadList()
  } catch (e) {
    showToast(e?.data?.message || '操作失败', 'error')
  } finally {
    actionLoading.value = null
  }
}

/**
 * 打开确认驳回弹窗
 */
function openConfirmReject(item) {
  confirmTarget.value = item
  rejectReason.value = ''
}

/**
 * 确认驳回
 */
async function handleConfirmReject() {
  if (!confirmTarget.value) return
  actionLoading.value = confirmTarget.value.id
  try {
    await $fetch('/api/admin/ai/override', {
      method: 'POST',
      body: {
        songId: confirmTarget.value.id,
        action: 'confirm_reject',
        reason: rejectReason.value || undefined,
      },
    })
    showToast(`《${confirmTarget.value.title}》已驳回`)
    confirmTarget.value = null
    await loadList()
  } catch (e) {
    showToast(e?.data?.message || '操作失败', 'error')
  } finally {
    actionLoading.value = null
  }
}

/**
 * 格式化倒计时
 */
function formatCountdown(autoRejectAt) {
  if (!autoRejectAt) return '—'
  const diff = new Date(autoRejectAt).getTime() - Date.now()
  if (diff <= 0) return '已过期'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (days > 0) return `${days}天${hours}时`
  if (hours > 0) return `${hours}时${mins}分`
  return `${mins}分钟`
}

/**
 * 根据剩余时间返回颜色类
 */
function getCountdownColor(autoRejectAt) {
  if (!autoRejectAt) return 'text-zinc-600'
  const diff = new Date(autoRejectAt).getTime() - Date.now()
  if (diff <= 0) return 'text-zinc-600'
  if (diff < 3600000) return 'text-red-400'
  if (diff < 86400000) return 'text-orange-400'
  return 'text-zinc-400'
}

function isToday(dateStr) {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function isExpiringSoon(autoRejectAt) {
  if (!autoRejectAt) return false
  const diff = new Date(autoRejectAt).getTime() - Date.now()
  return diff > 0 && diff < 86400000
}

function isExpired(autoRejectAt) {
  if (!autoRejectAt) return false
  return new Date(autoRejectAt).getTime() <= Date.now()
}

function showToast(message, type = 'success') {
  toast.value = { message, type }
  setTimeout(() => { toast.value = null }, 3000)
}

onMounted(() => {
  loadList()
  countdownTimer = setInterval(() => {
    list.value = [...list.value]
  }, 60000)
})

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>
