<script setup lang="ts">
import type { PageData } from 'vitepress'
import { useData } from 'vitepress'
import { VPButton } from 'vitepress/theme'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

interface MarkdownPageData extends PageData {
  copyMarkdown?: string
}

type CopyStatus = 'idle' | 'success' | 'error'

withDefaults(
  defineProps<{
    placement?: 'doc' | 'home' | 'page'
  }>(),
  {
    placement: 'doc'
  }
)

const { page } = useData()
const status = ref<CopyStatus>('idle')
let resetTimer: ReturnType<typeof setTimeout> | undefined

const copyMarkdownText = computed(
  () => (page.value as MarkdownPageData).copyMarkdown ?? ''
)

const buttonText = computed(() => {
  if (status.value === 'success') return '已复制 Markdown'
  if (status.value === 'error') return '复制失败，请重试'
  return '复制 Markdown'
})

function resetStatus() {
  status.value = 'idle'
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = undefined
}

function scheduleReset() {
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(resetStatus, 2000)
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(copyMarkdownText.value)
    status.value = 'success'
  } catch {
    status.value = 'error'
  }

  scheduleReset()
}

watch(() => page.value.relativePath, resetStatus)
onBeforeUnmount(resetStatus)
</script>

<template>
  <div
    v-if="copyMarkdownText"
    class="copy-markdown-action"
    :class="`copy-markdown-action--${placement}`"
  >
    <VPButton
      tag="button"
      type="button"
      theme="alt"
      :text="buttonText"
      aria-live="polite"
      @click="copyMarkdown"
    />
  </div>
</template>

<style scoped>
.copy-markdown-action {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.copy-markdown-action--home {
  justify-content: center;
  margin-bottom: 24px;
}

.copy-markdown-action--page {
  margin: 24px auto;
  padding: 0 24px;
  max-width: 1152px;
}

@media (min-width: 960px) {
  .copy-markdown-action--home {
    justify-content: flex-start;
  }
}
</style>
