<template>
  <div class="max-w-[1200px] mx-auto space-y-6 pb-24 px-2">
    <!-- 顶部标题栏 -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        <h2 class="text-2xl font-black text-zinc-100 tracking-tight">IP 安全管理</h2>
        <p class="text-xs text-zinc-500 mt-1 font-medium">
          查看与管理被风控引擎封禁的 IP 地址，支持手动封禁和解除封禁
        </p>
      </div>
      <div class="flex gap-3">
        <button
          class="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-xs font-bold rounded-xl transition-all"
          @click="loadData"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': loading }" />
          刷新
        </button>
        <button
          class="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-black rounded-xl shadow-lg shadow-red-950/30 transition-all active:scale-95"
          @click="showBanModal = true"
        >
          <ShieldOff :size="14" />
          手动封禁 IP
        </button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div class="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-5 space-y-1">
        <p class="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">封禁总数</p>
        <p class="text-2xl font-black text-zinc-100">{{ pagination.total }}</p>
      </div>
      <div class="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-5 space-y-1">
        <p class="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">有效封禁</p>
        <p class="text-2xl font-black text-red-400">{{ activeCount }}</p>
      </div>
      <div class="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-5 space-y-1">
        <p class="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">已过期</p>
        <p class="text-2xl font-black text-zinc-500">{{ expiredCount }}</p>
      </div>
    </div>

    <!-- 主表格 -->
    <section class="bg-zinc-900/40 border border-zinc-800 rounded-2xl overflow-hidden">
      <!-- 加载状态 -->
      <div v-if="loading" class="flex flex-col items-center justify-center py-20 gap-3">
        <div class="w-8 h-8 border-4 border-zinc-800 border-t-red-500 rounded-full animate-spin" />
        <p class="text-zinc-500 text-sm">加载中...</p>
      </div>

      <!-- 空状态 -->
      <div v-else-if="!rows.length" class="flex flex-col items-center justify-center py-20 gap-3">
        <ShieldCheck class="text-zinc-700" :size="40" />
        <p class="text-zinc-500 text-sm">暂无封禁记录</p>
      </div>

      <!-- 表格 -->
      <div v-else class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-zinc-800 bg-zinc-950/50">
              <th class="text-left px-5 py-3 text-[10px] font-black text-zinc-600 uppercase tracking-widest">
                IP 地址
              </th>
              <th class="text-left px-5 py-3 text-[10px] font-black text-zinc-600 uppercase tracking-widest">
                封禁原因
              </th>
              <th class="text-left px-5 py-3 text-[10px] font-black text-zinc-600 uppercase tracking-widest">
                封禁时间
              </th>
              <th class="text-left px-5 py-3 text-[10px] font-black text-zinc-600 uppercase tracking-widest">
                到期时间
              </th>
              <th class="text-left px-5 py-3 text-[10px] font-black text-zinc-600 uppercase tracking-widest">
                状态
              </th>
              <th class="text-right px-5 py-3 text-[10px] font-black text-zinc-600 uppercase tracking-widest">
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800/50">
            <tr
              v-for="row in rows"
              :key="row.id"
              class="hover:bg-zinc-800/20 transition-colors"
            >
              <td class="px-5 py-4 font-mono font-bold text-zinc-200">
                {{ row.ip }}
              </td>
              <td class="px-5 py-4 text-zinc-400 max-w-[240px]">
                <span class="truncate block" :title="row.reason">{{ row.reason }}</span>
              </td>
              <td class="px-5 py-4 text-zinc-500">
                {{ formatDate(row.bannedAt) }}
              </td>
              <td class="px-5 py-4">
                <span v-if="!row.expiresAt" class="text-red-400 font-bold">永久</span>
                <span
                  v-else
                  :class="isExpired(row.expiresAt) ? 'text-zinc-600' : 'text-amber-400'"
                >
                  {{ formatDate(row.expiresAt) }}
                </span>
              </td>
              <td class="px-5 py-4">
                <span
                  v-if="!row.expiresAt || !isExpired(row.expiresAt)"
                  class="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full text-[10px] font-black"
                >
                  <span class="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  封禁中
                </span>
                <span
                  v-else
                  class="inline-flex items-center px-2 py-0.5 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-full text-[10px] font-medium"
                >
                  已过期
                </span>
              </td>
              <td class="px-5 py-4 text-right">
                <button
                  :disabled="unbanning === row.ip"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-green-500/10 hover:text-green-400 hover:border-green-500/20 border border-zinc-700 text-zinc-400 text-[10px] font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="unban(row.ip)"
                >
                  <ShieldCheck v-if="unbanning !== row.ip" :size="12" />
                  <div
                    v-else
                    class="w-3 h-3 border-2 border-zinc-600 border-t-green-400 rounded-full animate-spin"
                  />
                  解除封禁
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页 -->
      <div
        v-if="pagination.totalPages > 1"
        class="border-t border-zinc-800 px-5 py-3 flex items-center justify-between"
      >
        <p class="text-[10px] text-zinc-600">
          共 {{ pagination.total }} 条，第 {{ pagination.page }} / {{ pagination.totalPages }} 页
        </p>
        <div class="flex gap-2">
          <button
            :disabled="pagination.page <= 1"
            class="px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-xs rounded-lg transition-all disabled:opacity-30"
            @click="changePage(pagination.page - 1)"
          >
            上一页
          </button>
          <button
            :disabled="pagination.page >= pagination.totalPages"
            class="px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-xs rounded-lg transition-all disabled:opacity-30"
            @click="changePage(pagination.page + 1)"
          >
            下一页
          </button>
        </div>
      </div>
    </section>

    <!-- 手动封禁弹窗 -->
    <Transition name="fade">
      <div
        v-if="showBanModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
        @click.self="showBanModal = false"
      >
        <div class="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
          <!-- 弹窗头部 -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
            <div class="flex items-center gap-2">
              <ShieldOff class="text-red-500" :size="18" />
              <h3 class="text-sm font-black text-zinc-100">手动封禁 IP</h3>
            </div>
            <button
              class="text-zinc-600 hover:text-zinc-400 transition-colors"
              @click="showBanModal = false"
            >
              <X :size="18" />
            </button>
          </div>

          <!-- 弹窗内容 -->
          <div class="p-6 space-y-4">
            <div>
              <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest block mb-2">
                目标 IP 地址
              </label>
              <input
                v-model="banForm.ip"
                type="text"
                placeholder="例如：192.168.1.100"
                class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-red-500/30 transition-all placeholder:text-zinc-700 font-mono"
              >
            </div>

            <div>
              <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest block mb-2">
                封禁原因
              </label>
              <input
                v-model="banForm.reason"
                type="text"
                placeholder="管理员手动封禁"
                class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-red-500/30 transition-all placeholder:text-zinc-700"
              >
            </div>

            <div>
              <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest block mb-2">
                封禁时长
              </label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="opt in durationOptions"
                  :key="String(opt.value)"
                  :class="[
                    'py-2.5 px-3 rounded-xl text-xs font-bold border transition-all',
                    banForm.durationHours === opt.value
                      ? 'bg-red-600/20 border-red-500/40 text-red-400'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                  ]"
                  @click="banForm.durationHours = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- 弹窗底部 -->
          <div class="px-6 py-4 border-t border-zinc-800 flex gap-3 justify-end">
            <button
              class="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-bold rounded-xl transition-all"
              @click="showBanModal = false"
            >
              取消
            </button>
            <button
              :disabled="banning || !banForm.ip.trim()"
              class="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-black rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              @click="submitBan"
            >
              <div
                v-if="banning"
                class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
              />
              <ShieldOff v-else :size="14" />
              确认封禁
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ShieldOff, ShieldCheck, RefreshCw, X } from 'lucide-vue-next'
import { useToast } from '~/composables/useToast'

const { showToast } = useToast()

interface IpBlacklistRow {
  id: number
  ip: string
  reason: string
  bannedAt: string
  expiresAt: string | null
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const loading = ref(true)
const rows = ref<IpBlacklistRow[]>([])
const pagination = ref<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
const unbanning = ref<string | null>(null)
const showBanModal = ref(false)
const banning = ref(false)

const banForm = ref<{ ip: string; reason: string; durationHours: number | null }>({
  ip: '',
  reason: '',
  durationHours: 24
})

const durationOptions: Array<{ label: string; value: number | null }> = [
  { label: '1 小时', value: 1 },
  { label: '24 小时', value: 24 },
  { label: '7 天（168 小时）', value: 168 },
  { label: '永久', value: null }
]

const now = ref(new Date())

const isExpired = (expiresAt: string | null): boolean => {
  if (!expiresAt) return false
  return new Date(expiresAt) <= now.value
}

const activeCount = computed(() =>
  rows.value.filter((r) => !isExpired(r.expiresAt)).length
)
const expiredCount = computed(() =>
  rows.value.filter((r) => r.expiresAt && isExpired(r.expiresAt)).length
)

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const loadData = async (page = 1) => {
  loading.value = true
  now.value = new Date()
  try {
    const res = await $fetch<{ data: IpBlacklistRow[]; pagination: Pagination }>(
      `/api/admin/risk-control/ips?page=${page}&pageSize=20`,
      { credentials: 'include' }
    )
    rows.value = res.data
    pagination.value = res.pagination
  } catch (err) {
    console.error('加载 IP 黑名单失败:', err)
    showToast('加载失败', 'error')
  } finally {
    loading.value = false
  }
}

const changePage = (page: number) => {
  if (page < 1 || page > pagination.value.totalPages) return
  loadData(page)
}

const unban = async (ip: string) => {
  unbanning.value = ip
  try {
    await $fetch(`/api/admin/risk-control/ips/${encodeURIComponent(ip)}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    showToast(`IP ${ip} 已解除封禁`, 'success')
    await loadData(pagination.value.page)
  } catch (err) {
    console.error('解封失败:', err)
    showToast('解封操作失败', 'error')
  } finally {
    unbanning.value = null
  }
}

const submitBan = async () => {
  if (!banForm.value.ip.trim()) return
  banning.value = true
  try {
    await $fetch('/api/admin/risk-control/ips', {
      method: 'POST',
      credentials: 'include',
      body: {
        ip: banForm.value.ip.trim(),
        reason: banForm.value.reason.trim() || undefined,
        durationHours: banForm.value.durationHours
      }
    })
    showToast(`IP ${banForm.value.ip.trim()} 已封禁`, 'success')
    showBanModal.value = false
    banForm.value = { ip: '', reason: '', durationHours: 24 }
    await loadData(1)
  } catch (err) {
    console.error('手动封禁失败:', err)
    showToast('封禁操作失败', 'error')
  } finally {
    banning.value = false
  }
}

onMounted(() => loadData())
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
