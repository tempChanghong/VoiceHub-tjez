<template>
  <div class="max-w-[1400px] mx-auto space-y-10 pb-20 px-2">
    <!-- 头部 -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
      <div>
        <h2 class="text-2xl font-black text-zinc-100 tracking-tight">AI 审核配置</h2>
        <p class="text-xs text-zinc-500 mt-1">配置 LLM 提供商、审核准则及评分权重</p>
      </div>
      <button
        class="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all active:scale-95 disabled:opacity-50"
        :disabled="saving"
        @click="saveConfig"
      >
        <Save :size="14" />
        {{ saving ? '保存中...' : '保存配置' }}
      </button>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-12 gap-8">
      <!-- 左栏：LLM 连接配置 -->
      <div class="xl:col-span-5 space-y-6">
        <!-- LLM 连接 -->
        <section class="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-6 space-y-5">
          <h3 class="text-sm font-black text-zinc-100 uppercase tracking-widest flex items-center gap-2">
            <Cpu :size="16" class="text-blue-500" /> LLM 连接
          </h3>

          <!-- Provider -->
          <div class="space-y-1.5">
            <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">提供商</label>
            <div class="grid grid-cols-4 gap-2">
              <button
                v-for="p in providers"
                :key="p.value"
                :class="[
                  'py-2 rounded-xl text-[11px] font-bold border transition-all',
                  form.provider === p.value
                    ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                ]"
                @click="form.provider = p.value"
              >
                {{ p.label }}
              </button>
            </div>
          </div>

          <!-- API Key -->
          <div class="space-y-1.5">
            <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">API Key</label>
            <div class="relative">
              <input
                v-model="form.apiKey"
                :type="showApiKey ? 'text' : 'password'"
                placeholder="sk-..."
                class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/30 pr-10"
              >
              <button
                class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                @click="showApiKey = !showApiKey"
              >
                <Eye v-if="!showApiKey" :size="14" />
                <EyeOff v-else :size="14" />
              </button>
            </div>
          </div>

          <!-- API Base URL -->
          <div class="space-y-1.5">
            <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">API Base URL</label>
            <input
              v-model="form.apiBaseUrl"
              type="text"
              placeholder="https://openrouter.ai/api/v1（留空使用默认）"
              class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/30"
            >
          </div>

          <!-- 模型名称 -->
          <div class="space-y-1.5">
            <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">模型名称</label>
            <input
              v-model="form.modelName"
              type="text"
              placeholder="openai/gpt-4o-mini"
              class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/30"
            >
          </div>

          <!-- 测试连通性 -->
          <div class="pt-2">
            <button
              class="w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50"
              :disabled="testing"
              @click="testConnection"
            >
              <Zap :size="14" :class="testing ? 'animate-pulse text-yellow-400' : 'text-zinc-500'" />
              {{ testing ? '测试中...' : '测试连通性' }}
            </button>

            <!-- 测试结果 -->
            <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0 -translate-y-1" enter-to-class="opacity-100 translate-y-0">
              <div
                v-if="testResult"
                :class="[
                  'mt-3 p-3 rounded-xl text-xs font-bold flex items-start gap-2 border',
                  testResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-red-500/10 border-red-500/20 text-red-400'
                ]"
              >
                <CheckCircle v-if="testResult.success" :size="14" class="shrink-0 mt-0.5" />
                <XCircle v-else :size="14" class="shrink-0 mt-0.5" />
                <div>
                  <p>{{ testResult.message }}</p>
                  <p v-if="testResult.latencyMs" class="text-[10px] opacity-70 mt-0.5">
                    延迟 {{ testResult.latencyMs }}ms · 模型 {{ testResult.modelName || '—' }}
                  </p>
                </div>
              </div>
            </Transition>
          </div>
        </section>

        <!-- 功能开关 -->
        <section class="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-6 space-y-4">
          <h3 class="text-sm font-black text-zinc-100 uppercase tracking-widest flex items-center gap-2">
            <ToggleRight :size="16" class="text-purple-500" /> 功能开关
          </h3>
          <div class="space-y-3">
            <div
              v-for="toggle in toggles"
              :key="toggle.key"
              class="flex items-center justify-between p-3 bg-zinc-950/50 rounded-xl border border-zinc-800/50"
            >
              <div>
                <p class="text-xs font-bold text-zinc-200">{{ toggle.label }}</p>
                <p class="text-[10px] text-zinc-600 mt-0.5">{{ toggle.desc }}</p>
              </div>
              <button
                class="relative w-10 h-5 rounded-full transition-colors shrink-0"
                :class="form[toggle.key] ? 'bg-blue-600' : 'bg-zinc-800'"
                @click="form[toggle.key] = !form[toggle.key]"
              >
                <div
                  class="absolute top-1 w-3 h-3 bg-white rounded-full transition-all"
                  :class="form[toggle.key] ? 'left-6' : 'left-1'"
                />
              </button>
            </div>
          </div>
        </section>

        <!-- 成本控制 -->
        <section class="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-6 space-y-4">
          <h3 class="text-sm font-black text-zinc-100 uppercase tracking-widest flex items-center gap-2">
            <Coins :size="16" class="text-yellow-500" /> 成本控制
          </h3>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">日 Token 上限</label>
              <input
                v-model.number="form.dailyTokenLimit"
                type="number"
                class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/30"
              >
            </div>
            <div class="space-y-1.5">
              <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">月 Token 上限</label>
              <input
                v-model.number="form.monthlyTokenLimit"
                type="number"
                class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/30"
              >
            </div>
            <div class="space-y-1.5">
              <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">预驳回宽限天数</label>
              <input
                v-model.number="form.preRejectGraceDays"
                type="number"
                min="1"
                max="30"
                class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/30"
              >
            </div>
            <div class="space-y-1.5">
              <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">单批处理歌曲数</label>
              <input
                v-model.number="form.batchSize"
                type="number"
                min="1"
                max="50"
                class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/30"
              >
            </div>
          </div>

          <!-- 排序权重 -->
          <div class="space-y-3 pt-2">
            <div class="flex items-center justify-between">
              <label class="text-[10px] font-black text-zinc-600 uppercase tracking-widest">AI 分数权重</label>
              <span class="text-xs font-bold text-blue-400">{{ form.scoreSortWeight }}%</span>
            </div>
            <input
              v-model.number="form.scoreSortWeight"
              type="range"
              min="0"
              max="100"
              class="w-full accent-blue-500"
              @input="form.voteSortWeight = 100 - form.scoreSortWeight"
            >
            <div class="flex justify-between text-[10px] text-zinc-600">
              <span>投票热度 {{ form.voteSortWeight }}%</span>
              <span>AI 评分 {{ form.scoreSortWeight }}%</span>
            </div>
          </div>
        </section>
      </div>

      <!-- 右栏：审核准则 -->
      <div class="xl:col-span-7 space-y-6">
        <section class="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-6 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-black text-zinc-100 uppercase tracking-widest flex items-center gap-2">
              <ShieldCheck :size="16" class="text-emerald-500" /> 合规审查准则
            </h3>
            <span class="text-[10px] text-zinc-600">{{ (form.complianceCriteria || '').length }}/5000</span>
          </div>
          <p class="text-[10px] text-zinc-600 leading-relaxed">
            在此填写额外的合规审查规则，将追加到默认审核维度之后。例如：特定劣迹艺人名单、校园特殊禁播规定等。
          </p>
          <textarea
            v-model="form.complianceCriteria"
            rows="10"
            maxlength="5000"
            placeholder="例如：&#10;- 禁止播放以下艺人的作品：XXX、YYY&#10;- 禁止播放含有赌博相关内容的歌曲&#10;- 高考期间（6月1日-6月10日）禁止播放节奏过快的歌曲"
            class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/30 resize-none leading-relaxed font-mono"
          />
        </section>

        <section class="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-6 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-black text-zinc-100 uppercase tracking-widest flex items-center gap-2">
              <Star :size="16" class="text-yellow-500" /> 价值评分准则
            </h3>
            <span class="text-[10px] text-zinc-600">{{ (form.scoringCriteria || '').length }}/5000</span>
          </div>
          <p class="text-[10px] text-zinc-600 leading-relaxed">
            在此填写额外的评分偏好，将追加到默认评分维度之后。例如：偏好特定风格、特定时段加分规则等。
          </p>
          <textarea
            v-model="form.scoringCriteria"
            rows="10"
            maxlength="5000"
            placeholder="例如：&#10;- 国风/古风歌曲额外加 5 分&#10;- 运动会期间，节奏感强的歌曲额外加 3 分&#10;- 近 3 个月内已播放过的歌曲适当降分"
            class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/30 resize-none leading-relaxed font-mono"
          />
        </section>
      </div>
    </div>

    <!-- 全局 Toast -->
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
import { ref, onMounted } from 'vue'
import {
  Save, Cpu, Zap, Eye, EyeOff, CheckCircle, XCircle,
  ToggleRight, Coins, ShieldCheck, Star
} from 'lucide-vue-next'

const providers = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: '通义千问' },
  { value: 'custom', label: '自定义' },
]

const toggles = [
  { key: 'enableAiCompliance', label: 'AI 合规审查', desc: '自动扫描 PENDING 歌曲，判定是否合规' },
  { key: 'enableAiScoring', label: 'AI 价值评分', desc: '对合规通过的歌曲进行 0-100 分评分' },
]

const form = ref({
  provider: 'openai',
  apiKey: '',
  apiBaseUrl: '',
  modelName: 'openai/gpt-4o-mini',
  complianceCriteria: '',
  scoringCriteria: '',
  enableAiCompliance: false,
  enableAiScoring: false,
  dailyTokenLimit: 100000,
  monthlyTokenLimit: 2000000,
  preRejectGraceDays: 3,
  scoreSortWeight: 70,
  voteSortWeight: 30,
  batchSize: 10,
  scanIntervalMinutes: 30,
})

const showApiKey = ref(false)
const saving = ref(false)
const testing = ref(false)
const testResult = ref(null)
const toast = ref(null)

/**
 * 显示短暂的 Toast 提示
 */
function showToast(message, type = 'success') {
  toast.value = { message, type }
  setTimeout(() => { toast.value = null }, 3000)
}

/**
 * 加载当前配置
 */
async function loadConfig() {
  try {
    const data = await $fetch('/api/admin/ai/config', { method: 'GET' }).catch(() => null)
    if (data?.settings) {
      const s = data.settings
      form.value = {
        provider: s.provider || 'openai',
        apiKey: s.apiKey || '',
        apiBaseUrl: s.apiBaseUrl || '',
        modelName: s.modelName || 'openai/gpt-4o-mini',
        complianceCriteria: s.complianceCriteria || '',
        scoringCriteria: s.scoringCriteria || '',
        enableAiCompliance: s.enableAiCompliance ?? false,
        enableAiScoring: s.enableAiScoring ?? false,
        dailyTokenLimit: s.dailyTokenLimit ?? 100000,
        monthlyTokenLimit: s.monthlyTokenLimit ?? 2000000,
        preRejectGraceDays: s.preRejectGraceDays ?? 3,
        scoreSortWeight: s.scoreSortWeight ?? 70,
        voteSortWeight: s.voteSortWeight ?? 30,
        batchSize: s.batchSize ?? 10,
        scanIntervalMinutes: s.scanIntervalMinutes ?? 30,
      }
    }
  } catch {
    // 首次使用时配置不存在，保持默认值
  }
}

/**
 * 保存配置
 */
async function saveConfig() {
  saving.value = true
  try {
    await $fetch('/api/admin/ai/config', {
      method: 'POST',
      body: form.value,
    })
    showToast('配置已保存')
  } catch (e) {
    showToast(e?.data?.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/**
 * 测试 LLM 连通性
 */
async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const res = await $fetch('/api/admin/ai/test-connection', {
      method: 'POST',
      body: {
        apiKey: form.value.apiKey,
        apiBaseUrl: form.value.apiBaseUrl,
        modelName: form.value.modelName,
        provider: form.value.provider,
      },
    })
    testResult.value = res
  } catch (e) {
    testResult.value = {
      success: false,
      message: e?.data?.message || '请求失败，请检查网络',
      latencyMs: null,
    }
  } finally {
    testing.value = false
  }
}

onMounted(loadConfig)
</script>
