import { normalizeAiModelRequest } from './capabilities/ai-model-compat.js'
import { resolveModuleType } from './context/module-type.js'
import {
  DEFAULT_HTTP_INSTANCE_ID,
  HttpInstanceResolutionError,
  resolveHttpInstance,
} from './context/http-instance.js'
import type { PortalRequestConfig } from './http/client.js'
import type { PortalRequest } from './session/types.js'

/**
 * 「按页面上下文发请求」的唯一实现。
 *
 * 抽出来是因为它有两个调用方：单用户门面（`src/index.ts`）与服务端多用户门面
 * （`src/server.ts`）。两处各写一遍迟早会分叉——而分叉的后果是 module-type
 * 悄悄丢掉，那会让后端把数据范围放宽到该用户全部模块的并集（设计 F19）。
 *
 * 算不出 module-type 时的行为见设计 D34：默认不发这个头，与浏览器一致。
 *
 * ## 页面还能决定另一件事：走哪个 http 实例
 *
 * Portal 前端有 18 个 axios 实例，它们**不是同一个东西**：baseURL、补不补 `/admin-api`
 * 前缀、每页条数叫 `pageSize` 还是 `limit`、发哪些头，各不相同（逐条见
 * `src/context/http-instance.ts` 与 `src/context/README.md`）。所以 `call()` 除了
 * module-type，还解析「这个页面/这次请求用哪个实例」。
 *
 * ## 与 D34 的刻意分歧：算不出实例时**不发请求**
 *
 * module-type 算不出就不发头是**忠实**（浏览器同样不发）；实例算不出则完全不是一回事
 * ——**走错实例 = 打到错的 URL**，而且往往不报错。所以这里走**失败关闭**，抛
 * `HttpInstanceResolutionError`，不做「猜一个默认值继续发」。
 *
 * 三种「算不出」的处理：
 *
 * - 页面**没有**任何 http 声明 → 用全局默认 `platform.js`。这是推导出来的结论
 *   （`app/portal/main.js:42-48` 把它注入成 `common/libs/renren/list.js` 的全局默认），
 *   不是猜测，所以照常发。
 * - 页面**声明了**但推导认不出来（`http: 某个 composable 返回的变量`）→ 抛。
 * - 解析到的实例**没有可用的 base URL** → 抛。base URL 属不属于 SDK 支持的场景
 *   牵扯「同 host 不同前缀的实例要不要支持」这个未决的范围决策，SDK 不替它决定，
 *   只要求调用方显式给（`options.baseUrls`）。
 */

export type PageCallOptions = {
  /**
   * 每个 http 实例的 base URL，键是实例 id（`src/context/http-instance.ts`）。
   *
   * **不配就是配不出来**——`call()` 不会拿默认实例的 baseUrl 去凑另一个实例。
   * 配了哪些实例，哪些页面就可用。
   */
  baseUrls?: Readonly<Record<string, string>>
  /**
   * 实例解析不到时的行为。
   *
   * `'throw'`（默认）与 `'assume-default'` 的取舍就是上面说的那条：默认宁可拒绝发请求。
   * `'assume-default'` 是给「先按旧行为跑通、之后再逐页接线」的过渡口子用的，
   * 开了它，偏离默认实例的页面会**静默打到错的 URL**。
   */
  onUnresolvedInstance?: 'throw' | 'assume-default'
}

export function createPageCall (
  request: PortalRequest,
  moduleTypeFallback?: 'omit' | number,
  options?: PageCallOptions,
): <T>(pagePath: string, config: PortalRequestConfig) => Promise<T> {
  const onUnresolved = options?.onUnresolvedInstance ?? 'throw'
  const baseUrls = options?.baseUrls

  return function call<T> (pagePath: string, config: PortalRequestConfig): Promise<T> {
    config = normalizeAiModelRequest(config)
    const resolved = resolveModuleType(pagePath)
    const moduleType = config.moduleType ?? resolved.moduleType ?? undefined

    const next: PortalRequestConfig =
      moduleType === undefined ? { ...config } : { ...config, moduleType }

    if (moduleType === undefined && typeof moduleTypeFallback === 'number') {
      next.moduleType = moduleTypeFallback
    }

    // ---- http 实例 ----
    const resolution = resolveHttpInstance({
      pagePath,
      declared: config.httpInstance ?? null,
    })

    if (resolution.kind === 'unresolved') {
      if (onUnresolved === 'throw') {
        throw new HttpInstanceResolutionError({
          pagePath: resolution.pagePath ?? pagePath,
          reason: resolution.reason,
          detail:
            `${resolution.detail}\n` +
            `页面：${resolution.pagePath ?? pagePath}\n` +
            '这一条与 module-type 的 D34 刻意不同：算不出实例时宁可拒绝发请求，' +
            '因为走错实例是打到错的 URL，不是少一个头。' +
            '若确实要用旧行为，给 createPageCall 传 { onUnresolvedInstance: "assume-default" }。',
        })
      }
      return request<T>(next)
    }

    const { instance, matchedBy } = resolution

    // 走默认实例：一个字段都不动。默认实例的规则由 createPortalHttp 的默认画像给，
    // 与 SDK 改造前逐字段一致（`test/baseline.test.ts` 拿真实浏览器抓的请求钉着这条）
    if (instance.id === DEFAULT_HTTP_INSTANCE_ID) {
      return request<T>(next)
    }

    const baseURL = config.baseURL ?? baseUrls?.[instance.id]
    if (!baseURL) {
      if (onUnresolved === 'throw') {
        throw new HttpInstanceResolutionError({
          pagePath,
          reason: 'missing-base-url',
          detail:
            `页面 ${pagePath} 的请求走 http 实例 ${instance.id}` +
            `（${instance.source}，baseURL 取自 ${instance.baseUrl.kind === 'env' ? instance.baseUrl.env : '源码里拼的绝对 url'}，` +
            `由 ${matchedBy} 解析得到），但没有可用的 base URL。\n` +
            `在 createPageCall 的 options.baseUrls['${instance.id}'] 里配上它，` +
            '或在这条请求上显式给 config.baseURL。' +
            '不配就发等于打到错的 URL——所以这里拒绝。',
        })
      }
      return request<T>(next)
    }

    return request<T>({ ...next, baseURL, httpInstance: instance.id })
  }
}
