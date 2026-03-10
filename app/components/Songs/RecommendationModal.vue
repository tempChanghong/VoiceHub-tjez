<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="show"
        class="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        @click.self="close"
      >
        <div
          class="bg-zinc-900 border border-zinc-800 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl flex flex-col"
        >
          <!-- 头部 -->
          <div class="p-6 pb-4 flex items-center justify-between border-b border-zinc-800/50">
            <div>
              <h3 class="text-xl font-black text-zinc-100 tracking-tight flex items-center gap-3">
                <div class="w-10 h-10 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-500">
                  <Icon name="message-square" :size="20" />
                </div>
                填写点歌推荐语
              </h3>
              <p class="text-xs text-zinc-500 mt-1 ml-13">分享您推荐这首歌的原因或对收听者的寄语</p>
            </div>
            <button
              class="p-3 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 rounded-2xl transition-all"
              @click="close"
            >
              <Icon name="x" :size="20" />
            </button>
          </div>

          <!-- 主体 -->
          <div class="p-6 space-y-4">
            <textarea
              v-model="recommendationText"
              class="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-200 focus:outline-none focus:border-blue-500/50 transition-colors resize-none placeholder-zinc-700"
              placeholder="请输入推荐语（如果不填写将只播放歌曲）"
            />
            
            <div class="flex justify-between items-center px-1">
              <span 
                class="text-xs font-medium"
                :class="[
                  requireRecommendation ? 'text-rose-500' : 'text-zinc-400',
                  (recommendationText.length > 0 && recommendationText.length < recommendationMinLength) || recommendationText.length > recommendationMaxLength ? 'text-amber-500' : ''
                ]"
              >
                字数要求：{{ recommendationMinLength }}-{{ recommendationMaxLength }}字<span v-if="requireRecommendation">（必填）</span>
              </span>
              <span class="text-xs text-zinc-500">
                {{ recommendationText.length }} / {{ recommendationMaxLength }}
              </span>
            </div>
          </div>

          <!-- 底部栏 -->
          <div class="p-6 pt-4 border-t border-zinc-800/50 bg-zinc-900/50 flex items-center justify-end gap-3">
            <button
              v-if="!requireRecommendation"
              class="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-black rounded-xl transition-all uppercase tracking-widest"
              @click="handleSkip"
            >
              跳过并点歌
            </button>
            <button
              class="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl transition-all uppercase tracking-widest shadow-lg shadow-blue-900/20 active:scale-95"
              @click="handleConfirm"
            >
              确认点歌
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'
import Icon from '~/components/UI/Icon.vue'
import { useToast } from '~/composables/useToast'
import { useSiteConfig } from '~/composables/useSiteConfig'

const props = defineProps({
  show: Boolean,
  requireRecommendation: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'confirm', 'skip'])
const { showToast } = useToast()
const { recommendationMinLength, recommendationMaxLength } = useSiteConfig()

const recommendationText = ref('')

watch(() => props.show, (newVal) => {
  if (newVal) {
    recommendationText.value = ''
  }
})

const close = () => {
  emit('close')
}

const handleSkip = () => {
  emit('skip')
}

const handleConfirm = () => {
  if (props.requireRecommendation || recommendationText.value.trim().length > 0) {
    const len = recommendationText.value.trim().length
    const minLen = recommendationMinLength.value
    const maxLen = recommendationMaxLength.value
    
    if (len < minLen || len > maxLen) {
      if (window.$showNotification) {
        window.$showNotification(`推荐语字数需在${minLen}-${maxLen}字之间`, 'error')
      } else {
        showToast(`推荐语字数需在${minLen}-${maxLen}字之间`, 'error')
      }
      return
    }
  }
  
  emit('confirm', recommendationText.value.trim())
}
</script>
