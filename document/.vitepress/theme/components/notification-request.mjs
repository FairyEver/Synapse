const API_KEY_PATTERN = /^syn_sk_[A-Za-z0-9_-]{43}$/u
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,120}$/u

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function normalizeInput(input) {
  return {
    baseUrl: input.baseUrl.trim().replace(/\/+$/u, ''),
    shape: input.shape,
    key: input.key.trim(),
    title: input.title.trim(),
    body: input.body.trim(),
    group: input.group.trim(),
    url: input.url.trim(),
    level: input.level,
    idempotencyKey: input.idempotencyKey.trim()
  }
}

function validateInput(input) {
  const issues = {}
  if (!API_KEY_PATTERN.test(input.key)) issues.key = 'API 密钥格式无效。'
  if (input.title.length < 1 || input.title.length > 64) issues.title = '标题须为 1–64 字符。'
  if (input.body.length < 1 || input.body.length > 512) issues.body = '正文须为 1–512 字符。'
  if (input.group && input.group.length > 64) issues.group = '分组最多 64 字符。'
  if (input.url) {
    try {
      if (input.url.length > 2048 || !input.url.startsWith('https://') || new URL(input.url).protocol !== 'https:') {
        issues.url = '链接须为不超过 2048 字符的 HTTPS 地址。'
      }
    } catch {
      issues.url = '链接须为不超过 2048 字符的 HTTPS 地址。'
    }
  }
  if (input.idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    issues.idempotencyKey = '去重键须为 8–120 位字母、数字、下划线或连字符。'
  }
  if (input.shape === 'path' && ['.', '..'].some((value) => input.title === value || input.body === value)) {
    if (input.title === '.' || input.title === '..') issues.title = '路径式标题不能仅为 . 或 ..；请选择 POST。'
    if (input.body === '.' || input.body === '..') issues.body = '路径式正文不能仅为 . 或 ..；请选择 POST。'
  }
  if (!['json', 'form', 'path'].includes(input.shape)) issues.shape = '请求形状无效。'
  if (!['active', 'passive', 'timeSensitive'].includes(input.level)) issues.level = '提醒级别无效。'
  return issues
}

function messageFields(input) {
  return {
    title: input.title,
    body: input.body,
    ...(input.group ? { group: input.group } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.level !== 'active' ? { level: input.level } : {})
  }
}

function requestUrl(input) {
  const root = `${input.baseUrl}/api/open/v1/notifications`
  if (input.shape === 'json') return root
  const keyed = `${root}/${encodeURIComponent(input.key)}`
  if (input.shape === 'form') return keyed
  const url = new URL(`${keyed}/${encodeURIComponent(input.title)}/${encodeURIComponent(input.body)}`)
  if (input.group) url.searchParams.set('group', input.group)
  if (input.url) url.searchParams.set('url', input.url)
  if (input.level !== 'active') url.searchParams.set('level', input.level)
  return url.toString()
}

function curlCommand(input, url, fields) {
  const lines = [`curl --request ${input.shape === 'path' ? 'GET' : 'POST'} ${shellQuote(url)}`]
  if (input.shape === 'json') lines.push(`--header ${shellQuote('Content-Type: application/json')}`)
  if (input.shape === 'form') lines.push(`--header ${shellQuote('Content-Type: application/x-www-form-urlencoded')}`)
  if (input.idempotencyKey) lines.push(`--header ${shellQuote(`Idempotency-Key: ${input.idempotencyKey}`)}`)
  if (input.shape === 'json') lines.push(`--data ${shellQuote(JSON.stringify({ key: input.key, ...fields }))}`)
  if (input.shape === 'form') {
    for (const [name, value] of Object.entries(fields)) {
      lines.push(`--data-urlencode ${shellQuote(`${name}=${value}`)}`)
    }
  }
  return lines.join(' \\\n  ')
}

function fetchCode(input, url, fields) {
  const options = []
  if (input.shape !== 'path') options.push("  method: 'POST',")
  if (input.shape !== 'path' || input.idempotencyKey) {
    options.push('  headers: {')
    if (input.shape === 'json') options.push("    'Content-Type': 'application/json',")
    if (input.shape === 'form') options.push("    'Content-Type': 'application/x-www-form-urlencoded',")
    if (input.idempotencyKey) options.push(`    'Idempotency-Key': ${JSON.stringify(input.idempotencyKey)},`)
    options.push('  },')
  }
  if (input.shape === 'json') {
    options.push(`  body: JSON.stringify(${JSON.stringify({ key: input.key, ...fields })}),`)
  }
  if (input.shape === 'form') {
    options.push(`  body: new URLSearchParams(${JSON.stringify(fields)}),`)
  }
  const fetchCall = options.length
    ? `fetch(${JSON.stringify(url)}, {\n${options.join('\n')}\n})`
    : `fetch(${JSON.stringify(url)})`
  return [
    `const response = await ${fetchCall}`,
    'if (!response.ok) throw new Error(`HTTP ${response.status}`)',
    "process.stdout.write(`${JSON.stringify(await response.json())}\\n`)"
  ].join('\n')
}

export function buildNotificationRequest(rawInput) {
  const input = normalizeInput(rawInput)
  const issues = validateInput(input)
  const errors = Object.values(issues)
  const previewInput = {
    ...input,
    key: input.key || 'syn_sk_...',
    title: input.title || '通知标题',
    body: input.body || '通知正文'
  }
  const url = requestUrl(previewInput)
  const fields = messageFields(previewInput)
  return {
    issues,
    errors,
    curl: curlCommand(previewInput, url, fields),
    fetch: fetchCode(previewInput, url, fields),
    url: input.shape === 'path' ? url : ''
  }
}
