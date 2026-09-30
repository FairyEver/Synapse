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
  const errors = []
  if (!API_KEY_PATTERN.test(input.key)) errors.push('API 密钥格式无效。')
  if (input.title.length < 1 || input.title.length > 64) errors.push('标题须为 1–64 字符。')
  if (input.body.length < 1 || input.body.length > 512) errors.push('正文须为 1–512 字符。')
  if (input.group && input.group.length > 64) errors.push('分组最多 64 字符。')
  if (input.url) {
    try {
      if (input.url.length > 2048 || !input.url.startsWith('https://') || new URL(input.url).protocol !== 'https:') {
        errors.push('链接须为不超过 2048 字符的 HTTPS 地址。')
      }
    } catch {
      errors.push('链接须为不超过 2048 字符的 HTTPS 地址。')
    }
  }
  if (input.idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    errors.push('去重键须为 8–120 位字母、数字、下划线或连字符。')
  }
  if (input.shape === 'path' && ['.', '..'].some((value) => input.title === value || input.body === value)) {
    errors.push('路径式标题和正文不能仅为 . 或 ..；请选择 POST。')
  }
  if (!['json', 'form', 'path'].includes(input.shape)) errors.push('请求形状无效。')
  if (!['active', 'passive', 'timeSensitive'].includes(input.level)) errors.push('提醒级别无效。')
  return errors
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
  const errors = validateInput(input)
  if (errors.length) return { errors, curl: '', fetch: '', url: '' }
  const url = requestUrl(input)
  const fields = messageFields(input)
  return {
    errors,
    curl: curlCommand(input, url, fields),
    fetch: fetchCode(input, url, fields),
    url: input.shape === 'path' ? url : ''
  }
}
