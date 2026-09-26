/* eslint-disable */
/**
 * 页面内请求捕获钩子。用于抓「浏览器真实发出的请求」作为逐字段基准（设计 D20）。
 *
 * 用法：
 *   bsk session start --no-focus
 *   bsk navigate "<测试环境页面 URL>" --session <id>
 *   bsk evaluate --session <id> "$(cat tools/baseline/install-hook.js)"
 *   # 在页面上触发一次真实请求（例如点击「查询」）
 *   bsk evaluate --session <id> 'JSON.stringify(window.__phCap)'
 *
 * 关键点：**脱敏在页面内完成**。token 类请求头的值在这里就被替换成 <redacted>，
 * 不会离开浏览器。所以把 evaluate 的结果写进 baseline/ 是安全的。
 *
 * ⚠️ **URL 里也可能有 token —— 这是 2026-09-21 补上的一个洞。**
 * `smart-layer-admin` / `smart-layer-app` 那两个实例**不靠请求头传 token，而是塞进 GET 参数**
 * （SDK 侧的 `profile.tokenInParams` 复刻的就是这件事）。所以抓「讲师管理」那类页面时，
 * `window.__phCap` 里会躺着一条 `…?page=1&limit=20&token=eyJhbGciOi…` 的**完整 JWT** ——
 * 只脱敏请求头是拦不住它的。实测：那一轮抓到 25 处。
 * 现在下面 `redactUrl()` 会把 URL 上的 token 值一并换成 `<redacted>`。
 *
 * 抓取范围只覆盖 XHR 与 fetch 两类，够用且不侵入页面逻辑。
 */
;(() => {
  if (window.__phCap) return 'already'
  window.__phCap = []

  const SECRET_HEADERS = /^(authorization|token|access_token|x-erp-internal-system-token|cookie)$/i
  const redact = (name, value) => (SECRET_HEADERS.test(name) ? '<redacted>' : value)

  /**
   * URL 上的敏感查询参数也要脱敏。
   *
   * 覆盖面刻意开得比 header 宽一点：凡参数名里带 token / ticket / sign / secret 的都换掉。
   * 理由是**漏一个就是一条真凭据落盘**，而多换几个无害（这些名字不会出现在正常业务参数上）。
   */
  const SECRET_QUERY = /([?&](?:[^=&#]*(?:token|ticket|signature|sign|secret|access_key)[^=&#]*)=)[^&#]*/gi
  const redactUrl = (url) => String(url).replace(SECRET_QUERY, '$1<redacted>')

  const originalOpen = XMLHttpRequest.prototype.open
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ph = { via: 'xhr', method, url: redactUrl(url), headers: {}, body: null }
    return originalOpen.call(this, method, url, ...rest)
  }
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__ph) this.__ph.headers[name] = redact(name, value)
    return originalSetHeader.call(this, name, value)
  }
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__ph) {
      this.__ph.body = typeof body === 'string' ? body : null
      window.__phCap.push(this.__ph)
    }
    return originalSend.call(this, body)
  }

  const originalFetch = window.fetch
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input.url
      const method = (init && init.method) || (typeof input !== 'string' && input.method) || 'GET'
      const headers = {}
      const raw = (init && init.headers) || (typeof input !== 'string' && input.headers)
      if (raw) {
        if (typeof raw.forEach === 'function') raw.forEach((value, name) => { headers[name] = redact(name, value) })
        else for (const name in raw) headers[name] = redact(name, raw[name])
      }
      window.__phCap.push({
        via: 'fetch',
        method,
        url: redactUrl(url),
        headers,
        body: init && typeof init.body === 'string' ? init.body : null,
      })
    } catch (error) {
      // 捕获失败不能影响页面本身的请求
    }
    return originalFetch.apply(this, arguments)
  }

  return 'installed'
})()
