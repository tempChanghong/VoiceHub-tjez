<template>
  <div
    v-if="show"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    @click.self="handleClose"
  >
    <div class="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
      <!-- 头部 -->
      <div class="flex items-center justify-between p-5 border-b border-zinc-800 shrink-0 bg-zinc-950/50">
        <div>
          <h3 class="text-lg font-black text-zinc-100 uppercase tracking-widest flex items-center gap-2">
            <ArrowDownTrayIcon class="w-5 h-5 text-blue-400" />
            导出今日音频
          </h3>
          <p class="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mt-1">
            {{ date }} · 将 {{ schedules.length }} 首排期歌曲保存到本地
          </p>
        </div>
        <button
          class="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-xl transition-all"
          @click="handleClose"
        >
          <XIcon class="w-5 h-5" />
        </button>
      </div>

      <!-- 列表 -->
      <div class="flex-1 overflow-y-auto p-2 custom-scrollbar">
        <div class="space-y-1">
          <div
            v-for="(schedule, index) in localSchedules"
            :key="schedule.id"
            class="flex items-center gap-3 p-3 rounded-xl border transition-colors"
            :class="[
              schedule.status === 'success' ? 'bg-emerald-500/10 border-emerald-500/20' :
              schedule.status === 'failed' ? 'bg-red-500/10 border-red-500/20' :
              schedule.status === 'downloading' || schedule.status === 'fetching' ? 'bg-blue-500/10 border-blue-500/20' :
              'bg-zinc-950/50 border-zinc-800/50 hover:bg-zinc-900/80'
            ]"
          >
            <!-- 序号 -->
            <div class="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center flex-shrink-0">
              <span class="text-xs font-black text-zinc-500">{{ index + 1 }}</span>
            </div>

            <!-- 歌曲信息 -->
            <div class="flex-1 min-w-0 flex flex-col justify-center">
              <div class="text-sm font-bold text-zinc-200 truncate">{{ schedule.song.title }}</div>
              <div class="text-xs text-zinc-500 truncate">{{ schedule.song.artist }}</div>
            </div>

            <!-- 状态 -->
            <div class="flex items-center gap-2 flex-shrink-0 min-w-[80px] justify-end">
              <span v-if="schedule.status === 'waiting'" class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">等待中</span>
              <span v-else-if="schedule.status === 'fetching'" class="flex items-center gap-1.5 text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                <Loader2Icon class="w-3 h-3 animate-spin" /> 获取直链
              </span>
              <span v-else-if="schedule.status === 'downloading'" class="flex items-center gap-1.5 text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                <Loader2Icon class="w-3 h-3 animate-spin" /> 下载中
              </span>
              <span v-else-if="schedule.status === 'success'" class="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                <CheckCircle2Icon class="w-3.5 h-3.5" /> 成功
              </span>
              <span v-else-if="schedule.status === 'failed'" class="flex items-center gap-1.5 text-[10px] font-bold text-red-500 uppercase tracking-wider" :title="schedule.errorMsg">
                <XCircleIcon class="w-3.5 h-3.5" /> 失败
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="p-5 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur shrink-0 flex items-center justify-between">
        <div class="text-xs font-bold text-zinc-400">
          成功: <span class="text-emerald-500">{{ successCount }}</span> / 失败: <span class="text-red-500">{{ failedCount }}</span> / 总计: {{ schedules.length }}
        </div>
        
        <div class="flex gap-3">
          <button
            :disabled="isProcessing"
            class="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-colors uppercase tracking-wider"
            @click="handleClose"
          >
            关闭
          </button>
          <button
            :disabled="isProcessing || allCompleted"
            class="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
            @click="startBatchDownload"
          >
            <Loader2Icon v-if="isProcessing" class="w-4 h-4 animate-spin" />
            <ArrowDownTrayIcon v-else class="w-4 h-4" />
            {{ isProcessing ? '下载中...' : (allCompleted ? '已完成' : '一键全部下载') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  X as XIcon,
  Download as ArrowDownTrayIcon,
  Loader2 as Loader2Icon,
  CheckCircle2 as CheckCircle2Icon,
  XCircle as XCircleIcon
} from 'lucide-vue-next'
import { getMusicUrl } from '~/utils/musicUrl'

interface ScheduleData {
  id: number
  song: {
    id: number
    title: string
    artist: string
    playUrl?: string | null
    musicPlatform?: string | null
    musicId?: string | null
  }
}

const props = defineProps<{
  show: boolean
  date: string
  schedules: ScheduleData[]
}>()

const emit = defineEmits(['close'])

// Local state mapping
interface LocalSchedule extends ScheduleData {
  status: 'waiting' | 'fetching' | 'downloading' | 'success' | 'failed'
  errorMsg?: string
}

const localSchedules = ref<LocalSchedule[]>([])
const isProcessing = ref(false)

watch(() => props.show, (newVal) => {
  if (newVal) {
    localSchedules.value = props.schedules.map(s => ({
      ...JSON.parse(JSON.stringify(s)),
      status: 'waiting'
    }))
  }
})

const successCount = computed(() => localSchedules.value.filter(s => s.status === 'success').length)
const failedCount = computed(() => localSchedules.value.filter(s => s.status === 'failed').length)
const allCompleted = computed(() => localSchedules.value.length > 0 && 
  (successCount.value + failedCount.value === localSchedules.value.length) && !isProcessing.value)

const sanitizeFilename = (name: string) => {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim()
}

interface SongInfo {
  id: number
  title: string
  artist: string
  playUrl?: string | null
  musicPlatform?: string | null
  musicId?: string | null
}

const getExtension = (song: SongInfo) => {
  if (song.musicPlatform === 'bilibili' || (song.playUrl && (song.playUrl.includes('bilibili.com') || song.playUrl.includes('bilivideo.com')))) {
    return '.m4a'
  }
  if (song.musicPlatform === 'tencent' || (song.playUrl && song.playUrl.includes('qq.com'))) {
    return '.m4a'
  }
  return '.mp3'
}

const getPlayUrl = async (song: SongInfo): Promise<string> => {
  // 传 undefined 作为第三个参数（原playUrl），强制获取最新的播放直链，防过期
  const url = await getMusicUrl(song.musicPlatform || '', song.musicId || '', undefined, { quality: 5 })
  if (url) return url
  throw new Error('未能获取最新的播放直链')
}

const startBatchDownload = async () => {
  if (isProcessing.value) return
  isProcessing.value = true
  
  try {
    let index = 1
    for (const schedule of localSchedules.value) {
      if (schedule.status === 'success') {
        index++
        continue
      }
      
      try {
        schedule.status = 'fetching'
        const playUrl = await getPlayUrl(schedule.song)
        
        schedule.status = 'downloading'
        const ext = getExtension(schedule.song)
        const numPrefix = index < 10 ? `0${index}` : `${index}`
        const rawFilename = `${numPrefix}-${schedule.song.title}-${schedule.song.artist}${ext}`
        const filename = sanitizeFilename(rawFilename)
        
        const proxyUrl = `/api/admin/schedule/proxy-download?url=${encodeURIComponent(playUrl)}&filename=${encodeURIComponent(filename)}`
        
        const response = await fetch(proxyUrl)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        
        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
        
        schedule.status = 'success'
      } catch (e: unknown) {
        schedule.status = 'failed'
        const errorMsg = e instanceof Error ? e.message : '下载失败'
        schedule.errorMsg = errorMsg
        console.error(`Failed to download ${schedule.song.title}:`, e)
      }
      
      index++
      // 稍微延迟一下，防止过载
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    if (typeof window !== 'undefined' && (window as any).$showNotification) {
      (window as any).$showNotification('批量下载任务处理完毕', 'success')
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : '未知错误'
    if (typeof window !== 'undefined' && (window as any).$showNotification) {
      (window as any).$showNotification('批量下载过程中发生错误: ' + errorMsg, 'error')
    }
  } finally {
    isProcessing.value = false
  }
}

const handleClose = () => {
  if (isProcessing.value) {
    if (typeof window !== 'undefined' && (window as any).$showNotification) {
      (window as any).$showNotification('正在下载中，请勿关闭弹窗', 'warning')
    }
    return
  }
  emit('close')
}
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #27272a;
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #3f3f46;
}
</style>
