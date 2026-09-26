/* eslint-disable */
/**
 * 抽样基准的**页内探针**——`tools/baseline/install-hook.js` 的配套件，必须**在它之后**注入。
 *
 * 用法（两个脚本拼在一起注入，顺序不能反）：
 *   bsk evaluate --session <id> "$(cat tools/baseline/install-hook.js tools/sample/probe-hook.js)"
 *
 * install-hook.js 回答「浏览器发了什么请求」，本文件补上它回答不了的那一半：
 * **「那个请求的响应里有几条候选」**。
 *
 * 为什么非要响应体不可：生成器给参数标的 `kind` 只看**初值的类型**，
 * 「这页的部门下拉有 922 个候选」这件事在源码里根本不存在（候选是运行时拉的），
 * 只能从响应里量。而候选规模直接决定这个参数能不能直接开放给 AI
 * （约定 11：长选项参数必须先要关键字，否则等于让 AI 全量拉 4500 人）。
 *
 * 只记长度与键名，**不记响应内容**：避免把业务数据带出浏览器。
 */

;(() => {
  if (window.__phRes) return 'already'
  window.__phRes = []

  /** 从响应体里量「候选有几条」。只看 data 本身或它的常见数组字段。 */
  const shapeOf = (text) => {
    if (!text) return { len: 0 }
    const out = { len: text.length }
    if (text.length > 2_000_000) return out
    let json
    try { json = JSON.parse(text) } catch { return out }
    if (!json || typeof json !== 'object') return out
    if (typeof json.total === 'number') out.total = json.total
    const data = json.data
    if (Array.isArray(data)) { out.arrayLen = data.length; out.arrayPath = 'data'; return out }
    if (data && typeof data === 'object') {
      for (const key of ['list', 'records', 'rows', 'items', 'content']) {
        if (Array.isArray(data[key])) { out.arrayLen = data[key].length; out.arrayPath = 'data.' + key; break }
      }
      if (typeof data.total === 'number') out.total = data.total
    }
    return out
  }

  const record = (url, status, text) => {
    try {
      const shape = shapeOf(text)
      window.__phRes.push({ url: String(url), status, ...shape })
    } catch { /* 记录失败不能影响页面 */ }
  }

  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const self = this
    try {
      self.addEventListener('load', () => {
        let text = null
        try {
          // responseType 为 ''/'text' 时才有 responseText
          text = self.responseType === '' || self.responseType === 'text' ? self.responseText : null
        } catch { /* 读不到就算了 */ }
        record(self.responseURL || url, self.status, text)
      })
    } catch { /* addEventListener 失败不阻断 open */ }
    return originalOpen.call(this, method, url, ...rest)
  }

  const originalFetch = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url)
    const promise = originalFetch.apply(this, arguments)
    try {
      promise
        .then((response) => {
          // clone 之后再读，避免消费掉页面自己要用的 body
          return response.clone().text().then((text) => record(response.url || url, response.status, text))
        })
        .catch(() => { /* 网络失败页面自己会处理 */ })
    } catch { /* 包装失败不能影响请求 */ }
    return promise
  }

  return 'installed'
})()
