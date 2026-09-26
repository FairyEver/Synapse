/**
 * 会话层与 `src/http/client.ts` 的接线点。
 *
 * **这里显式暴露了现结构的一个约束，不是绕过去：**
 * `createPortalHttp(config)` 的凭据是**创建时绑定**的——请求拦截器闭包读的是
 * 传进 `config` 的那份 `credential`（`src/http/client.ts:54-72` 的 `buildHeaders({credential: config.credential, ...})`）。
 * 因此：
 *
 * - 一个 axios 实例 = 一个用户的一个租户；**无法**通过给 `http.request()` 传参数换人。
 * - 「一个进程服务多个用户」只能落成「一个会话一份请求函数」，
 *   也就是这里返回的工厂：每个 `PortalSession` 用自己那份凭据造一个实例。
 * - 代价是每个会话一个 axios 实例（保留着 baseURL / timeout / 拦截器）。
 *   这是可接受的——实例本身很轻，重的是它加载到的那份基础数据；
 *   而且这样请求头天然不会串用户。
 *
 * 如果将来要收敛成「一个实例 + 每次请求带凭据」，改动点是 `src/http/client.ts`：
 * 让拦截器从 `requestConfig.credential ?? config.credential` 取凭据，
 * 并把 `PortalRequestConfig` 加上可选的 `credential` 字段。
 * **那是主会话要决定的事，这里不动它。**
 */

import type { PortalHeadlessConfig } from '../config.js'
import { createPortalHttp, type PortalRequestConfig } from '../http/client.js'
import type { PortalRequest, PortalRequestFactory } from './types.js'

/** 与 `PortalHeadlessConfig` 相同，只是凭据由会话在 acquire 时提供 */
export type PortalRequestFactoryConfig = Omit<PortalHeadlessConfig, 'credential'>

export function createPortalRequestFactory (
  config: PortalRequestFactoryConfig,
): PortalRequestFactory {
  return ({ credential, language }) => {
    // 语言必须逐会话传：会话键里有 Accept-Language（H5），
    // 在这里被工厂级的默认值盖掉的话，会话键是 en-US 而请求头还是 zh-CN。
    const http = createPortalHttp({ ...config, credential, language })

    return <T = unknown>(requestConfig: PortalRequestConfig): Promise<T> =>
      http.request(requestConfig as never) as unknown as Promise<T>
  }
}
