<template>
  <div class="max-w-[1400px] mx-auto space-y-8 pb-20 px-2 animate-in fade-in slide-in-from-bottom-4 duration-700">
    <!-- 页面标题 -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
      <div>
        <h2 class="text-2xl font-black text-zinc-100 tracking-tight flex items-center gap-3">
          智能风控管理
        </h2>
        <p class="text-xs text-zinc-500 mt-1 font-medium">
          实时监控和管理处于系统封禁状态的风险IP，保护系统安全
        </p>
      </div>
    </div>

    <!-- 添加封禁IP表单 -->
    <section class="bg-zinc-900/40 border border-zinc-800 rounded-xl p-8 shadow-xl">
      <h3 class="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-6 px-1">
        手动封禁IP
      </h3>
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-6 items-end">
        <div class="xl:col-span-3 space-y-2">
          <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">
            IP地址
          </label>
          <input
            v-model="newItem.ip"
            type="text"
            placeholder="如: 192.168.1.1"
            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-5 py-3 text-sm text-zinc-200 focus:outline-none focus:border-red-500/30 placeholder:text-zinc-700 transition-all"
          >
        </div>

        <div class="xl:col-span-4 space-y-2">
          <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">
            封禁原因
          </label>
          <input
            v-model="newItem.reason"
            type="text"
            placeholder="简述封禁该IP的原因"
            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-5 py-3 text-sm text-zinc-200 focus:outline-none focus:border-red-500/30 placeholder:text-zinc-700 transition-all"
          >
        </div>

        <div class="xl:col-span-3 space-y-2">
          <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">
            封禁时长 (分钟)
          </label>
          <input
            v-model.number="newItem.durationMinutes"
            type="number"
            min="1"
            placeholder="10"
            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-5 py-3 text-sm text-zinc-200 focus:outline-none focus:border-red-500/30 placeholder:text-zinc-700 transition-all"
          >
        </div>

        <div class="xl:col-span-2">
          <button
            :disabled="!newItem.ip || loading"
            class="w-full flex items-center justify-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-black rounded-lg shadow-lg shadow-red-900/20 transition-all active:scale-95"
            @click="banIP"
          >
            <ShieldAlert v-if="!loading" :size="16" />
            <div
              v-else
              class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
            />
            {{ loading ? '处理中...' : '封禁此IP' }}
          </button>
        </div>
      </div>
    </section>

    <!-- 封禁IP列表 -->
    <div class="space-y-4">
      <div class="flex items-center justify-between px-2">
        <h4 class="text-[10px] font-black text-zinc-600 uppercase tracking-widest">
          当前封禁IP列表 ({{ ips.length }} 项)
        </h4>
        <button
          class="p-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-100 transition-all active:scale-95 flex gap-2 items-center text-xs font-bold"
          @click="loadIPs"
        >
          <RotateCw :size="14" :class="{ 'animate-spin': loading }" /> 刷新列表
        </button>
      </div>

      <div class="grid grid-cols-1 gap-3">
        <TransitionGroup
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="transform scale-95 opacity-0"
          enter-to-class="transform scale-100 opacity-100"
          leave-active-class="transition duration-200 ease-in absolute w-full"
          leave-from-class="transform scale-100 opacity-100"
          leave-to-class="transform scale-95 opacity-0"
        >
          <div
            v-for="item in ips"
            :key="item.ip"
            class="group flex flex-col lg:flex-row lg:items-center gap-6 p-6 bg-zinc-900/30 border border-red-500/20 rounded-xl transition-all hover:border-red-500/40"
          >
            <div class="flex-1 flex items-start gap-5">
              <div
                class="shrink-0 w-12 h-12 rounded-lg flex items-center justify-center border bg-red-600/10 text-red-500 border-red-500/20 shadow-lg shadow-red-900/5 transition-all"
              >
                <GlobeLock :size="22" />
              </div>

              <div class="space-y-1.5 min-w-0">
                <div class="flex items-center gap-3">
                  <h5 class="text-base font-black text-zinc-100 truncate tracking-tight font-mono">
                    {{ item.ip }}
                  </h5>
                </div>

                <div class="flex flex-wrap items-center gap-4">
                  <div class="flex items-center gap-2 text-zinc-500 font-bold text-[11px]">
                    <MessageSquare :size="12" class="text-zinc-700" />
                    原因: {{ item.reason || '无' }}
                  </div>
                  <div
                    class="flex items-center gap-2 text-red-400 font-bold text-[10px] uppercase tracking-tighter"
                  >
                    <Clock :size="11" class="text-red-800" />
                    解封时间: {{ formatDate(item.blockedUntil) }}
                  </div>
                </div>
              </div>
            </div>

            <div
              class="flex items-center justify-end gap-3 pt-4 lg:pt-0 border-t lg:border-t-0 border-zinc-800/50"
            >
              <button
                :disabled="loading"
                class="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all bg-zinc-800 text-zinc-400 hover:text-green-500 hover:bg-green-500/10 hover:border-green-500/20 shadow-lg"
                @click="unbanItem(item)"
              >
                <Unlock :size="14" />
                解除封禁
              </button>
            </div>
          </div>
        </TransitionGroup>

        <!-- 加载状态 -->
        <div
          v-if="loading && ips.length === 0"
          class="py-20 flex flex-col items-center justify-center space-y-4"
        >
          <div
            class="w-12 h-12 border-4 border-zinc-800 border-t-red-500 rounded-full animate-spin"
          />
          <p class="text-zinc-500 text-xs font-bold uppercase tracking-widest">加载中...</p>
        </div>

        <!-- 空状态 -->
        <div
          v-else-if="ips.length === 0"
          class="py-20 flex flex-col items-center justify-center text-center space-y-4 bg-zinc-900/10 border border-zinc-800/40 border-dashed rounded-xl"
        >
          <div
            class="w-16 h-16 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-800 shadow-xl"
          >
            <ShieldCheck :size="32" />
          </div>
          <div class="space-y-1 px-4">
            <h6 class="text-sm font-bold text-zinc-600">目前没有被封禁的IP</h6>
            <p class="text-[10px] text-zinc-700 font-bold uppercase tracking-widest">
              系统处于安全状态
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import {
  ShieldAlert,
  ShieldCheck,
  MessageSquare,
  Clock,
  RotateCw,
  GlobeLock,
  Unlock
} from 'lucide-vue-next'
import { useToast } from '~/composables/useToast'

const { showToast: showNotification } = useToast()

const ips = ref([])
const loading = ref(false)

const newItem = reactive({
  ip: '',
  reason: '',
  durationMinutes: 10
})

// 加载封禁IP列表
const loadIPs = async () => {
  loading.value = true

  try {
    const response = await $fetch(`/api/admin/risk-control/ips`, {
      ...useAuth().getAuthConfig()
    })

    ips.value = response.data
  } catch (err) {
    console.error('获取风控IP失败:', err)
    showNotification('获取风控IP失败: ' + (err.data?.message || err.message), 'error')
  } finally {
    loading.value = false
  }
}

// 手动添加IP封禁
const banIP = async () => {
  if (!newItem.ip.trim()) return

  loading.value = true

  try {
    await $fetch('/api/admin/risk-control/ips', {
      method: 'POST',
      body: {
        ip: newItem.ip.trim(),
        reason: newItem.reason.trim() || null,
        durationMinutes: newItem.durationMinutes
      },
      ...useAuth().getAuthConfig()
    })

    showNotification('IP封禁成功', 'success')
    
    newItem.ip = ''
    newItem.reason = ''
    newItem.durationMinutes = 10
    
    await loadIPs()
  } catch (err) {
    console.error('IP封禁失败:', err)
    showNotification('封禁失败: ' + (err.data?.message || err.message), 'error')
  } finally {
    loading.value = false
  }
}

// 解除封禁
const unbanItem = async (item) => {
  loading.value = true

  try {
    const encodedIp = encodeURIComponent(item.ip) // IP format might get messed in url
    await $fetch(`/api/admin/risk-control/ips/${encodedIp}`, {
      method: 'DELETE',
      ...useAuth().getAuthConfig()
    })

    showNotification('IP解封成功', 'success')
    await loadIPs()
  } catch (err) {
    console.error('解封失败:', err)
    showNotification('解封失败: ' + (err.data?.message || err.message), 'error')
  } finally {
    loading.value = false
  }
}

const formatDate = (dateString) => {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

onMounted(() => {
  loadIPs()
})
</script>

<style scoped>
.animate-in {
  animation-duration: 0.5s;
  animation-fill-mode: both;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
