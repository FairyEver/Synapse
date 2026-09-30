<script setup lang="ts">
import { useData } from 'vitepress'
import { VPButton } from 'vitepress/theme'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { buildNotificationRequest } from './notification-request.mjs'

const { theme } = useData()
const shape = ref<'json' | 'form' | 'path'>('json')
const outputFormat = ref<'curl' | 'fetch' | 'url'>('curl')
const apiKey = ref('')
const showKey = ref(false)
const title = ref('')
const body = ref('')
const group = ref('')
const url = ref('')
const level = ref<'active' | 'passive' | 'timeSensitive'>('active')
const idempotencyKey = ref('')
const copyStatus = ref('')

const request = computed(() => buildNotificationRequest({
  baseUrl: (theme.value as { appPublicUrl: string }).appPublicUrl,
  shape: shape.value,
  key: apiKey.value,
  title: title.value,
  body: body.value,
  group: group.value,
  url: url.value,
  level: level.value,
  idempotencyKey: idempotencyKey.value
}))
const preview = computed(() => request.value[outputFormat.value])
const hasErrors = computed(() => request.value.errors.length > 0)
const optionalError = computed(() => Boolean(request.value.issues.group || request.value.issues.url || request.value.issues.idempotencyKey))
const codeLanguage = computed(() => outputFormat.value === 'fetch' ? 'javascript' : outputFormat.value === 'url' ? 'text' : 'bash')

watch(shape, () => {
  if (shape.value !== 'path' && outputFormat.value === 'url') outputFormat.value = 'curl'
})
watch(request, () => { copyStatus.value = '' })
onBeforeUnmount(() => { apiKey.value = '' })

async function copyRequest() {
  if (hasErrors.value) return
  try {
    await navigator.clipboard.writeText(preview.value)
    copyStatus.value = '已复制请求'
  } catch {
    copyStatus.value = '复制失败，请重试'
  }
}
</script>

<template>
  <form class="request-builder" aria-label="请求构建器" @submit.prevent>
    <div class="control-group">
      <span id="notification-shape-label" class="control-label">请求形状</span>
      <div class="segmented" role="group" aria-labelledby="notification-shape-label">
        <button type="button" :aria-pressed="shape === 'json'" @click="shape = 'json'">JSON POST</button>
        <button type="button" :aria-pressed="shape === 'form'" @click="shape = 'form'">表单 POST</button>
        <button type="button" :aria-pressed="shape === 'path'" @click="shape = 'path'">路径 GET</button>
      </div>
    </div>

    <div class="fields">
      <div class="field">
        <label for="notification-key">API 密钥</label>
        <div class="input-row">
          <input id="notification-key" v-model="apiKey" :type="showKey ? 'text' : 'password'" :aria-invalid="Boolean(apiKey && request.issues.key)" :aria-describedby="apiKey && request.issues.key ? 'notification-key-error' : undefined" autocomplete="off" spellcheck="false" placeholder="syn_sk_..." />
          <button type="button" class="plain-button" :aria-label="showKey ? '隐藏 API 密钥' : '显示 API 密钥'" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
        </div>
        <small v-if="apiKey && request.issues.key" id="notification-key-error" class="field-error">{{ request.issues.key }}</small>
      </div>
      <div class="field">
        <label for="notification-title">标题</label>
        <input id="notification-title" v-model="title" type="text" maxlength="64" :aria-invalid="Boolean(title && request.issues.title)" :aria-describedby="title && request.issues.title ? 'notification-title-error' : undefined" placeholder="通知标题" />
        <small v-if="title && request.issues.title" id="notification-title-error" class="field-error">{{ request.issues.title }}</small>
      </div>
      <div class="field">
        <label for="notification-body">正文</label>
        <textarea id="notification-body" v-model="body" maxlength="512" rows="3" :aria-invalid="Boolean(body && request.issues.body)" :aria-describedby="body && request.issues.body ? 'notification-body-error' : undefined" placeholder="通知正文" />
        <small v-if="body && request.issues.body" id="notification-body-error" class="field-error">{{ request.issues.body }}</small>
      </div>
    </div>

    <details class="optional-fields">
      <summary>可选字段 <span v-if="optionalError" class="field-error">有待修正</span></summary>
      <div class="fields">
        <div class="field">
          <label for="notification-group">分组</label>
          <input id="notification-group" v-model="group" type="text" maxlength="64" :aria-invalid="Boolean(request.issues.group)" :aria-describedby="request.issues.group ? 'notification-group-error' : undefined" />
          <small v-if="request.issues.group" id="notification-group-error" class="field-error">{{ request.issues.group }}</small>
        </div>
        <div class="field">
          <label for="notification-url">打开链接</label>
          <input id="notification-url" v-model="url" type="url" maxlength="2048" :aria-invalid="Boolean(request.issues.url)" :aria-describedby="request.issues.url ? 'notification-url-error' : undefined" placeholder="https://" />
          <small v-if="request.issues.url" id="notification-url-error" class="field-error">{{ request.issues.url }}</small>
        </div>
        <div class="control-group">
          <span id="notification-level-label" class="control-label">提醒级别</span>
          <div class="segmented" role="group" aria-labelledby="notification-level-label">
            <button type="button" :aria-pressed="level === 'active'" @click="level = 'active'">active</button>
            <button type="button" :aria-pressed="level === 'passive'" @click="level = 'passive'">passive</button>
            <button type="button" :aria-pressed="level === 'timeSensitive'" @click="level = 'timeSensitive'">timeSensitive</button>
          </div>
        </div>
        <div class="field">
          <label for="notification-idempotency-key">去重键</label>
          <input id="notification-idempotency-key" v-model="idempotencyKey" type="text" maxlength="120" :aria-invalid="Boolean(request.issues.idempotencyKey)" :aria-describedby="request.issues.idempotencyKey ? 'notification-idempotency-error' : undefined" />
          <small v-if="request.issues.idempotencyKey" id="notification-idempotency-error" class="field-error">{{ request.issues.idempotencyKey }}</small>
        </div>
      </div>
    </details>

    <div class="output-area">
      <div class="output-header">
        <div class="control-group">
          <span id="notification-output-label" class="control-label">输出格式</span>
          <div class="segmented" role="group" aria-labelledby="notification-output-label">
            <button type="button" :aria-pressed="outputFormat === 'curl'" @click="outputFormat = 'curl'">cURL</button>
            <button type="button" :aria-pressed="outputFormat === 'fetch'" @click="outputFormat = 'fetch'">Node.js fetch</button>
            <button v-if="shape === 'path'" type="button" :aria-pressed="outputFormat === 'url'" @click="outputFormat = 'url'">纯链接</button>
          </div>
        </div>
        <VPButton tag="button" type="button" theme="brand" :disabled="hasErrors" :text="copyStatus === '已复制请求' ? '已复制' : '复制请求'" @click="copyRequest" />
      </div>
      <p class="builder-note">
        <template v-if="hasErrors">修正字段后可复制。</template>
        <template v-else>生成结果包含完整密钥，请勿公开分享。</template>
        <template v-if="shape === 'path'">访问路径链接会直接发送消息。</template>
      </p>
      <p v-if="shape === 'path' && outputFormat === 'url' && idempotencyKey" class="builder-note">纯链接无法携带去重键；cURL 和 Node.js fetch 可携带请求头。</p>
      <div :class="`code-output language-${codeLanguage} vp-adaptive-theme`">
        <pre class="vp-code" tabindex="0"><code>{{ preview }}</code></pre>
      </div>
      <span role="status" aria-live="polite">{{ copyStatus === '复制失败，请重试' ? copyStatus : '' }}</span>
    </div>
  </form>
</template>

<style scoped>
.request-builder {
  padding: 20px;
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg);
}

.control-group,
.field {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.control-label,
.field label {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.segmented {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: fit-content;
  padding: 4px;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}

.segmented button {
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  font: inherit;
  font-size: 14px;
  line-height: 1.4;
  cursor: pointer;
}

.segmented button[aria-pressed='true'] {
  border-color: var(--vp-c-border);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.fields {
  display: grid;
  gap: 16px;
  margin-top: 20px;
}

.field input,
.field textarea {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 14px;
}

.field textarea { resize: vertical; }

.field input[aria-invalid='true'],
.field textarea[aria-invalid='true'] {
  border-color: var(--vp-c-danger-1);
}

.input-row {
  display: flex;
  gap: 8px;
}

.input-row input { flex: 1; }

.plain-button {
  padding: 0 12px;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  color: var(--vp-c-text-1);
  font-size: 14px;
  cursor: pointer;
}

.field-error {
  color: var(--vp-c-danger-1);
  font-size: 13px;
}

.optional-fields { margin-top: 20px; }

.output-area {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--vp-c-divider);
}

.optional-fields summary {
  width: fit-content;
  color: var(--vp-c-text-1);
  font-weight: 600;
  cursor: pointer;
}

.output-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: end;
  gap: 16px;
}

.output-header :deep(.VPButton:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.request-builder .builder-note {
  margin: 12px 0 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.request-builder .code-output {
  margin: 12px 0 0;
  border-radius: 8px;
}

.request-builder button:focus-visible,
.request-builder input:focus-visible,
.request-builder textarea:focus-visible,
.request-builder summary:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .request-builder { padding: 16px; }
  .segmented { width: 100%; }
  .segmented button { flex: 1; }
}
</style>
