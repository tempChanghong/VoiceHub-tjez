<template>
  <!-- 全屏 IP 封禁警告弹窗，无关闭按钮，强制阻断 -->
  <Teleport to="body">
    <div
      v-if="ipBanned"
      class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
    >
      <div
        class="relative w-full max-w-lg mx-4 overflow-hidden rounded-2xl border border-red-500/40 bg-zinc-950 shadow-2xl shadow-red-950/60"
      >
        <!-- 顶部红色渐变条 -->
        <div class="h-1.5 w-full bg-gradient-to-r from-red-700 via-red-500 to-red-700 animate-pulse" />

        <div class="p-8 flex flex-col items-center text-center gap-6">
          <!-- 图标区 -->
          <div class="relative">
            <div
              class="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center animate-pulse"
            >
              <ShieldAlert class="text-red-500" :size="40" />
            </div>
            <!-- 外圈光晕 -->
            <div
              class="absolute inset-0 rounded-full border border-red-500/20 scale-125 animate-ping"
            />
          </div>

          <!-- 标题 -->
          <div class="space-y-2">
            <div class="flex items-center justify-center gap-2">
              <span class="text-red-500/80 text-xs font-black uppercase tracking-[0.3em]">
                系统级风控拦截
              </span>
            </div>
            <h1 class="text-2xl font-black text-zinc-50 leading-snug">
              您的设备已被封禁
            </h1>
          </div>

          <!-- 内容正文 -->
          <div
            class="w-full bg-red-950/30 border border-red-500/20 rounded-xl p-5 text-left space-y-3"
          >
            <p class="text-sm text-zinc-300 leading-relaxed">
              🚨 检测到您的设备恶意尝试登录他人账户，已触发系统安全机制，您的 IP 已被临时封禁。
            </p>
            <p class="text-sm text-zinc-300 leading-relaxed">
              请立即停止违规行为，并联系广播站站长申请解封。
            </p>
          </div>

          <!-- 警告提示 -->
          <div class="flex items-center gap-2 px-4 py-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl w-full">
            <AlertTriangle class="text-amber-500 shrink-0" :size="14" />
            <p class="text-[11px] text-zinc-500 text-left">
              此拦截由自动风控系统触发，封禁期内所有功能均不可用。
            </p>
          </div>
        </div>

        <!-- 底部状态栏 -->
        <div class="border-t border-zinc-800/50 px-6 py-3 bg-zinc-950/50 flex items-center gap-2">
          <div class="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span class="text-[10px] text-zinc-600 font-medium uppercase tracking-widest">
            安全系统 · 已拦截
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ShieldAlert, AlertTriangle } from 'lucide-vue-next'

// 读取全局封禁状态
const ipBanned = useState<boolean>('ipBanned', () => false)
</script>
