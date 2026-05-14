const fields = {
  prompt: document.querySelector('#prompt'),
  activePromptName: document.querySelector('#activePromptName'),
  workingDirectory: document.querySelector('#workingDirectory'),
  concurrency: document.querySelector('#concurrency'),
  intervalMinutes: document.querySelector('#intervalMinutes'),
  timeoutMinutes: document.querySelector('#timeoutMinutes'),
  maxLogs: document.querySelector('#maxLogs'),
  codexCommand: document.querySelector('#codexCommand'),
  codexModel: document.querySelector('#codexModel'),
  codexSandbox: document.querySelector('#codexSandbox'),
  codexApprovalPolicy: document.querySelector('#codexApprovalPolicy'),
}

const elements = {
  save: document.querySelector('#save'),
  start: document.querySelector('#start'),
  stopAfterCurrent: document.querySelector('#stop-after-current'),
  copyGuide: document.querySelector('#copy-guide'),
  newPrompt: document.querySelector('#new-prompt'),
  renamePrompt: document.querySelector('#rename-prompt'),
  deletePrompt: document.querySelector('#delete-prompt'),
  unsavedDialog: document.querySelector('#unsaved-dialog'),
  configTab: document.querySelector('#config-tab'),
  runTab: document.querySelector('#run-tab'),
  configView: document.querySelector('#config-view'),
  runView: document.querySelector('#run-view'),
  saveState: document.querySelector('#save-state'),
  schedulerStatus: document.querySelector('#scheduler-status'),
  batchId: document.querySelector('#batch-id'),
  batchStarted: document.querySelector('#batch-started'),
  summaryPath: document.querySelector('#summary-path'),
  workers: document.querySelector('#workers'),
  error: document.querySelector('#error'),
}

const state = {
  activePromptName: '',
  savedPrompt: '',
  pendingPromptName: '',
  copyGuideResetTimer: 0,
}

function setActiveView(view) {
  const isRun = view === 'run'
  elements.configTab.classList.toggle('active', !isRun)
  elements.runTab.classList.toggle('active', isRun)
  elements.configView.classList.toggle('active', !isRun)
  elements.runView.classList.toggle('active', isRun)
}

function numberValue(input) {
  return Number.parseInt(input.value, 10)
}

function readForm() {
  return {
    prompt: fields.prompt.value,
    activePromptName: fields.activePromptName.value,
    workingDirectory: fields.workingDirectory.value,
    concurrency: numberValue(fields.concurrency),
    intervalMinutes: numberValue(fields.intervalMinutes),
    timeoutMinutes: numberValue(fields.timeoutMinutes),
    maxLogs: numberValue(fields.maxLogs),
    codex: {
      command: fields.codexCommand.value,
      model: fields.codexModel.value,
      sandbox: fields.codexSandbox.value,
      approvalPolicy: fields.codexApprovalPolicy.value,
      json: true,
    },
  }
}

function renderPromptOptions(prompts, activePromptName) {
  fields.activePromptName.replaceChildren(...(prompts || []).map(name => {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    option.selected = name === activePromptName
    return option
  }))
}

function writeForm(config) {
  state.activePromptName = config.activePromptName || 'default'
  state.savedPrompt = config.prompt || ''
  renderPromptOptions(config.prompts || [state.activePromptName], state.activePromptName)
  fields.prompt.value = config.prompt || ''
  fields.workingDirectory.value = config.workingDirectory || ''
  fields.concurrency.value = config.concurrency || 1
  fields.intervalMinutes.value = config.intervalMinutes || 30
  fields.timeoutMinutes.value = config.timeoutMinutes || 30
  fields.maxLogs.value = config.maxLogs || 50
  fields.codexCommand.value = config.codex?.command || 'codex'
  fields.codexModel.value = config.codex?.model || 'gpt-5.5'
  fields.codexSandbox.value = config.codex?.sandbox || 'danger-full-access'
  fields.codexApprovalPolicy.value = config.codex?.approvalPolicy || 'never'
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
}

function setMessage(message, isError = false) {
  elements.saveState.textContent = isError ? '' : message
  elements.error.textContent = isError ? message : ''
}

function markGuideCopied() {
  window.clearTimeout(state.copyGuideResetTimer)
  elements.copyGuide.textContent = '已复制'
  state.copyGuideResetTimer = window.setTimeout(() => {
    elements.copyGuide.textContent = '复制指南'
  }, 1800)
}

async function saveConfig() {
  const config = await requestJson('/api/config', {
    method: 'PUT',
    body: JSON.stringify(readForm()),
  })
  writeForm(config)
  setMessage('已保存')
}

async function copyGuide() {
  const body = await requestJson('/api/guide')
  await navigator.clipboard.writeText(body.content || '')
  markGuideCopied()
  setMessage('已复制指南')
}

function hasPromptChanges() {
  return fields.prompt.value !== state.savedPrompt
}

function promptUrl(name) {
  return `/api/prompts/${encodeURIComponent(name)}`
}

async function loadPrompt(name) {
  const body = await requestJson(promptUrl(name))
  fields.prompt.value = body.prompt || ''
  state.savedPrompt = fields.prompt.value
  state.activePromptName = name
  fields.activePromptName.value = name
}

async function switchPrompt(name) {
  if (!name || name === state.activePromptName) {
    fields.activePromptName.value = state.activePromptName
    return
  }
  if (!hasPromptChanges()) {
    await loadPrompt(name)
    return
  }
  state.pendingPromptName = name
  elements.unsavedDialog.showModal()
}

async function createPrompt() {
  const name = window.prompt('提示词名称')
  if (!name) return
  const config = await requestJson('/api/prompts', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  writeForm({ ...config, activePromptName: name, prompt: '' })
  await loadPrompt(name)
  setMessage('已新建')
}

async function renameActivePrompt() {
  const name = window.prompt('提示词名称', state.activePromptName)
  if (!name || name === state.activePromptName) return
  const currentPrompt = fields.prompt.value
  const renamed = await requestJson(`${promptUrl(state.activePromptName)}/rename`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
  writeForm({ ...renamed, activePromptName: name, prompt: currentPrompt })
  const saved = await requestJson('/api/config', {
    method: 'PUT',
    body: JSON.stringify(readForm()),
  })
  writeForm(saved)
  setMessage('已重命名')
}

async function deleteActivePrompt() {
  if (!window.confirm(`删除提示词「${state.activePromptName}」？`)) return
  const config = await requestJson(promptUrl(state.activePromptName), { method: 'DELETE' })
  writeForm(config)
  setMessage('已删除')
}

async function startRun() {
  const snapshot = await requestJson('/api/start', {
    method: 'POST',
    body: JSON.stringify(readForm()),
  })
  renderSnapshot(snapshot)
  setMessage('已开始')
  setActiveView('run')
}

async function stopAfterCurrent() {
  const snapshot = await requestJson('/api/stop-after-current', { method: 'POST' })
  renderSnapshot(snapshot)
  setMessage('本批结束后停止')
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function activeBatch(snapshot) {
  return snapshot.currentBatch || snapshot.lastBatch
}

const statusText = {
  idle: '空闲',
  running: '运行中',
  waiting: '等待',
  stopping: '停止中',
  stopped: '已停止',
  error: '错误',
  pending: '等待',
  success: '成功',
  timeout: '超时',
}

function displayStatus(value) {
  return statusText[value] || value || '-'
}

function renderWorker(worker) {
  const article = document.createElement('article')
  article.className = `worker status-${worker.status}`

  const head = document.createElement('div')
  head.className = 'worker-head'

  const title = document.createElement('div')
  title.className = 'worker-title'
  title.textContent = `worker-${worker.id}`

  const badge = document.createElement('span')
  badge.className = `badge status-${worker.status}`
  badge.textContent = displayStatus(worker.status)

  head.append(title, badge)

  const meta = document.createElement('div')
  meta.className = 'worker-line worker-meta'
  meta.textContent = `${(worker.durationMs / 1000).toFixed(1)}s · exit ${worker.exitCode ?? '-'}`

  const message = document.createElement('div')
  message.className = 'worker-line worker-message'
  message.textContent = worker.lastMessage || '-'

  if (worker.status === 'error' || worker.status === 'timeout') {
    message.classList.add('worker-error')
  }

  article.append(head, message, meta)
  return article
}

function renderSnapshot(snapshot) {
  elements.schedulerStatus.className = `badge status-${snapshot.status}`
  elements.schedulerStatus.textContent = displayStatus(snapshot.status)
  const batch = activeBatch(snapshot)
  elements.batchId.textContent = batch?.id || '-'
  elements.batchStarted.textContent = formatDate(batch?.startedAt)
  elements.summaryPath.textContent = batch?.summaryPath || '-'
  const failedWorker = (batch?.workers || []).find(worker => worker.status === 'error' || worker.status === 'timeout')
  elements.error.textContent = snapshot.error || failedWorker?.lastMessage || ''
  elements.workers.replaceChildren(...(batch?.workers || []).map(renderWorker))
  elements.stopAfterCurrent.disabled = snapshot.status !== 'running' && snapshot.status !== 'waiting'
}

async function init() {
  try {
    writeForm(await requestJson('/api/config'))
    renderSnapshot(await requestJson('/api/status'))
    const events = new EventSource('/events')
    events.onmessage = event => renderSnapshot(JSON.parse(event.data))
    events.onerror = () => {
      elements.schedulerStatus.textContent = 'disconnected'
    }
  } catch (err) {
    setMessage(err instanceof Error ? err.message : String(err), true)
  }
}

elements.unsavedDialog.addEventListener('close', () => {
  const action = elements.unsavedDialog.returnValue
  const nextName = state.pendingPromptName
  state.pendingPromptName = ''
  if (!nextName || action === 'cancel') {
    fields.activePromptName.value = state.activePromptName
    return
  }
  const run = async () => {
    if (action === 'save') await saveConfig()
    await loadPrompt(nextName)
  }
  void run().catch(err => {
    fields.activePromptName.value = state.activePromptName
    setMessage(err instanceof Error ? err.message : String(err), true)
  })
})

fields.prompt.addEventListener('input', () => {
  setMessage(hasPromptChanges() ? '未保存' : '')
})

fields.activePromptName.addEventListener('change', () => {
  void switchPrompt(fields.activePromptName.value).catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.newPrompt.addEventListener('click', () => {
  void createPrompt().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.copyGuide.addEventListener('click', () => {
  void copyGuide().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.renamePrompt.addEventListener('click', () => {
  void renameActivePrompt().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.deletePrompt.addEventListener('click', () => {
  void deleteActivePrompt().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.save.addEventListener('click', () => {
  void saveConfig().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.start.addEventListener('click', () => {
  void startRun().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.stopAfterCurrent.addEventListener('click', () => {
  void stopAfterCurrent().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.configTab.addEventListener('click', () => setActiveView('config'))
elements.runTab.addEventListener('click', () => setActiveView('run'))

void init()
