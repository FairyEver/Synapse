/**
 * Phase 0 — 共享 runtime 工具.
 *
 * 这里只放跨多个 runtime 子模块都用得上的 pure helper.
 * 不应依赖任何业务代码，不应依赖 Electron。
 */

/**
 * 把多个 string 字段拼成稳定的 key（用于 Map / Set 的复合键）.
 * 空字符串保留为占位符，保证字段顺序固定.
 *
 * 用例：
 *   buildKey(["agent", "message.delta", "p1", "s1"]) → "agent|message.delta|p1|s1"
 */
export function buildKey(parts: ReadonlyArray<string | number | undefined>): string {
  return parts.map((p) => (p === undefined ? "" : String(p))).join("|")
}

/**
 * setTimeout 包装：返回 cancel 函数 + 自动 unref（如果支持）.
 *
 * 解决：runtime 各处需要后台 timer，但又不能阻塞 process exit
 * （vitest 跑完测试，定时器还存活会让进程挂起）.
 */
export function makeUnrefTimeout(
  ms: number,
  callback: () => void,
): () => void {
  const timer = setTimeout(callback, ms)
  if (typeof timer.unref === "function") timer.unref()
  return () => clearTimeout(timer)
}

/**
 * setInterval 包装：同上，返回 cancel 函数 + unref.
 */
export function makeUnrefInterval(
  ms: number,
  callback: () => void,
): () => void {
  const timer = setInterval(callback, ms)
  if (typeof timer.unref === "function") timer.unref()
  return () => clearInterval(timer)
}

/**
 * 创建只能调用一次的 disposer 包装。
 * 重复调用第二次起静默无副作用。
 *
 * 用于：register() / subscribe() 返回的 unsubscribe 函数，
 * 防止 caller 不小心调两次导致 entries 重复 splice / set.delete。
 */
export function makeIdempotentDisposer(fn: () => void): () => void {
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    fn()
  }
}
