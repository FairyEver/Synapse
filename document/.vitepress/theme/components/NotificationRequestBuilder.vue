<script setup lang="ts">
import { VPButton } from 'vitepress/theme'
import { useData } from 'vitepress'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { buildNotificationRequest } from './notification-request.mjs'

const { theme } = useData()

const shape = ref<'json' | 'form' | 'path'>('json')
const outputFormat = ref<'curl' | 'fetch' | 'url'>('curl')
const apiKey = ref('')
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

const empty = computed(() => !apiKey.value && !title.value && !body.value)
const preview = computed(() => request.value[outputFormat.value])

watch(shape, () => {
  if (shape.value !== 'path' && outputFormat.value === 'url') outputFormat.value = 'curl'
})
watch(preview, () => { copyStatus.value = '' })
onBeforeUnmount(() => { apiKey.value = '' })

async function copyRequest() {
  try {
    await navigator.clipboard.writeText(preview.value)
    copyStatus.value = '已复制请求'
  } catch {
    copyStatus.value = '复制失败，请重试'
  }
}
</script>

<template>
  <form @submit.prevent>
    <table>
      <tbody>
        <tr>
          <th scope="row"><label for="notification-shape">请求形状</label></th>
          <td>
            <select id="notification-shape" v-model="shape">
              <option value="json">JSON POST</option>
              <option value="form">表单 POST</option>
              <option value="path">路径 GET</option>
            </select>
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="notification-key">API 密钥</label></th>
          <td><input id="notification-key" v-model="apiKey" type="password" autocomplete="off" spellcheck="false" size="28" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="notification-title">标题</label></th>
          <td><input id="notification-title" v-model="title" type="text" maxlength="64" size="28" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="notification-body">正文</label></th>
          <td><textarea id="notification-body" v-model="body" maxlength="512" cols="28" rows="3" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="notification-group">分组</label></th>
          <td><input id="notification-group" v-model="group" type="text" maxlength="64" size="28" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="notification-url">打开链接</label></th>
          <td><input id="notification-url" v-model="url" type="url" maxlength="2048" size="28" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="notification-level">提醒级别</label></th>
          <td>
            <select id="notification-level" v-model="level">
              <option value="active">active</option>
              <option value="passive">passive</option>
              <option value="timeSensitive">timeSensitive</option>
            </select>
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="notification-idempotency-key">去重键</label></th>
          <td><input id="notification-idempotency-key" v-model="idempotencyKey" type="text" maxlength="120" size="28" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="notification-output-format">输出格式</label></th>
          <td>
            <select id="notification-output-format" v-model="outputFormat">
              <option value="curl">cURL</option>
              <option value="fetch">Node.js fetch</option>
              <option v-if="shape === 'path'" value="url">纯链接</option>
            </select>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="empty">填写 API 密钥、标题和正文后生成请求。</p>
    <ul v-else-if="request.errors.length">
      <li v-for="error in request.errors" :key="error">{{ error }}</li>
    </ul>
    <template v-else>
      <p>生成结果包含完整密钥，请勿公开分享。<template v-if="shape === 'path'">访问路径链接会直接发送消息。</template></p>
      <p v-if="shape === 'path' && outputFormat === 'url' && idempotencyKey">纯链接无法携带去重键；切换到 cURL 或 Node.js fetch 可携带请求头。</p>
      <div :class="`language-${outputFormat === 'fetch' ? 'javascript' : outputFormat === 'url' ? 'text' : 'bash'} vp-adaptive-theme`">
        <pre class="vp-code" tabindex="0"><code>{{ preview }}</code></pre>
      </div>
      <VPButton tag="button" type="button" theme="alt" text="复制请求" @click="copyRequest" />
      <span role="status" aria-live="polite">{{ copyStatus }}</span>
    </template>
  </form>
</template>
