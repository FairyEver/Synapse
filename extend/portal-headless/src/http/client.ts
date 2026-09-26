import axios, {
  type AxiosHeaderValue,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosRequestHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import qs from 'qs'

import {
  DEFAULT_TIMEOUT_MS,
  normalizeBaseUrl,
  type PortalHeadlessConfig,
} from '../config.js'
import { buildHeaders } from './headers.js'
import { PortalApiError, PortalCredentialError } from './errors.js'
import {
  applyPageSizeAlias,
  applyUrlRewrite,
  DEFAULT_HTTP_INSTANCE_ID,
  getHttpInstance,
  type HttpInstanceProfile,
  type HttpResponseEnvelope,
} from '../context/http-instance.js'

/**
 * 没指定 `httpInstance` 时用的实例 = SDK 原先唯一支持的那一个，也是 Portal 的全局默认
 * （`app/portal/main.js:42-48`）。默认路径的逐字段行为**必须保持不变**——
 * `test/baseline.test.ts` 拿真实浏览器抓的请求钉着它。
 */
function profileFor (id: string | undefined): HttpInstanceProfile {
  const profile = getHttpInstance(id ?? DEFAULT_HTTP_INSTANCE_ID)
  /* istanbul ignore next —— id 由 src/context 的解析器产出；这里挡住表被改坏 */
  if (!profile) {
    throw new Error(`未知的 http 实例：${id}（实例表见 src/context/http-instance.ts）`)
  }
  return profile
}

const JSON_RESPONSE_TYPES = new Set(['json', undefined, ''])

export type PortalRequestConfig = AxiosRequestConfig & {
  /** GET 查询数组的 qs 编码方式；对应 Portal axios config.paramsArrayFormat。 */
  paramsArrayFormat?: 'indices' | 'brackets' | 'repeat' | 'comma'
  /** 覆盖自动推导出的 module-type */
  moduleType?: number
  /** 触发这次调用的能力 ID，只用于错误归因 */
  capabilityId?: string
  /** 为 true 时跳过启停用包装，直接返回响应体（与前端 sourceResponse 同名） */
  sourceResponse?: boolean
  /**
   * 这次请求走哪个 http 实例（`src/context/http-instance.ts` 的 id）。
   *
   * 缺省时由 `src/call.ts` 按页面推导后填进来。直接在裸 axios 实例上调 `request()`
   * 而不填，等价于走全局默认实例——与 SDK 改造前一致。
   */
  httpInstance?: string
  /**
   * 请求级开关，对应前端写在 axios config 上的 `isLay` 之类（供 url 后缀规则用）
   */
  httpFlags?: Readonly<Record<string, boolean>>
  /**
   * 将凭据 token 以指定键名追加到查询参数。仅用于 Portal 页面中少数
   * 未走 admin-api 拦截器、但仍要求 c=token 的兼容接口；token 不会进入
   * 能力参数或日志。
   */
  tokenParamName?: string
  /** Portal 的原始 fetch 请求没有自动追加 `_t` 时使用。 */
  skipGetCacheParam?: boolean
  /**
   * 原样返回整个响应体，**不拆包络**。对应前端各实例响应拦截器里的 `isOriginal`
   * （`smart-layer-admin.js:60-62` 等）。
   *
   * 页面调 `smart-layer-*` 时基本都带它（源码里逐处写着 `isOriginal: true`）。
   */
  isOriginal?: boolean
}

export type PortalResponseEnvelope<T = unknown> = {
  ret?: string
  code?: number
  msg?: string
  data?: T
  /**
   * `smart-layer-*` 与 `zhdj-sms` 的第二选择。
   * 它们的拦截器最后一句是 `return data ? data : pages` —— **不是**
   * "没有 data 就返回 undefined"。少了这一条，分页接口会整个变空。
   */
  pages?: unknown
}

/** 凭据失效的 code（各实例的判据里都点了这几个，见 `applyEnvelope` 的注释） */
function isCredentialCode (code: number | undefined): boolean {
  return [401, 10001, 1002015001].includes(Number(code))
}

/**
 * 按实例自己的响应规则拆包络。**逐字复刻各实例的响应拦截器原文**，
 * 出处与判据表见 `src/context/http-instance.ts` 的 `HttpResponseEnvelope`。
 *
 * 三条最容易写错的地方，各自的注释里都标了：
 * 1. `smart-layer` **完全不看 `ret`**；
 * 2. `zhdj-sms` 的 `ret` 分支在 `code === 200` 时**不抛**、继续往下走
 *    （注意：**"两段谁先谁后"不重要** —— 反证时试过对调，穷举 7 种 `ret`/`code` 组合
 *    行为完全一致，那是个等价变异。真正改变行为的是"`code === 200` 时不抛"这一条）；
 * 3. `smart-layer` / `zhdj-sms` 返回的是 `data ? data : pages`。
 */
export function applyEnvelope (
  envelope: HttpResponseEnvelope,
  response: AxiosResponse,
  cfg: { isOriginal?: boolean; capabilityId?: string },
): unknown {
  const body = (response.data ?? {}) as PortalResponseEnvelope
  const { ret, code, msg, data, pages } = body
  const fail = (): never => {
    if (isCredentialCode(code)) throw new PortalCredentialError(Number(code))
    throw new PortalApiError({
      msg,
      ret,
      code,
      bizData: data,
      responseData: response.data,
      capabilityId: cfg.capabilityId,
    })
  }

  switch (envelope) {
    case 'portal-standard':
      if (ret !== 'SUCCESS') fail()
      return data

    case 'smart-layer':
      // `smart-layer-admin.js:60-62` / `smart-layer-app.js` 同形
      if (cfg.isOriginal) return response.data
      if (code === undefined) return response.data // 智慧蛋鸡部分接口不返回 code
      if (code !== 200) fail()
      return data ? data : pages

    case 'zhdj-sms':
      // `zhdj-sms.js:47-70`：源码是「先 ret 后 code」两段。
      // ⚠️ 真正改变行为的是**内层这一条**：`code === 200` 但 `ret !== 'SUCCESS'` 时**不抛**，
      // 原样继续往下走（与 portal-standard 正相反）。两段谁写在前面是等价的 ——
      // 反证时对调过，穷举 7 种组合行为一致。这里保持源码的形状只是为了对账方便。
      if (ret !== 'SUCCESS') {
        if (code !== 200) fail()
      }
      if (cfg.isOriginal) return response.data
      if (code === undefined) return response.data
      if (code !== 200) fail()
      return data ? data : pages

    case 'mall-app':
      // `mall-app.js:15-24`：判据是 `Number(code) !== 0`
      if (Number(code) !== 0) fail()
      return data
  }
}

type PortalInternalConfig = InternalAxiosRequestConfig &
  PortalRequestConfig & { metadata?: { startTime: Date } }

/** 复刻 app/portal/utils/http/platform.js 的请求/响应行为 */
export function createPortalHttp (config: PortalHeadlessConfig): AxiosInstance {
  const instance = axios.create({
    baseURL: normalizeBaseUrl(config.baseUrl),
    timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    allowAbsoluteUrls: false,
  })

  instance.interceptors.request.use((requestConfig) => {
    const cfg = requestConfig as PortalInternalConfig
    cfg.metadata = { startTime: new Date() }

    // 实例画像：决定 baseURL（由调用方给）、补前缀、分页参数名、请求头、序列化方式
    const profile = profileFor(cfg.httpInstance)
    // profile.withCredentials 刻意**不转发**给 axios：浏览器侧它是 XHR 级的 cookie 语义，
    // 无头下 Node 没有 cookie jar，设了也是空转。写进画像只是为了复核差异时能一眼看到。

    // 已经向 Portal 前端确认：所有接口都以 /admin-api 开头，迁移接口需要补前缀。
    // 只有 platform.js 有这个拦截器；sale.js 等实例原样发出（源码见 http-instance.ts）
    cfg.url = applyUrlRewrite(profile.urlRewrite, String(cfg.url ?? ''), cfg.httpFlags)

    // 只并入**有值**的槽位。axios 合并后的 bag 里带着它自己的 `'Content-Type': undefined`
    // （axios/lib/defaults/index.js:169），整体展开的话这个空槽会**盖掉**画像
    // `extraHeaders` 里声明的同名头——实测 zhdj-cms / zhdj-cms-lay / zhdj-app-lay /
    // platform-mall-mes 四个实例声明的 Content-Type 因此从来没发出去过
    // （证据见 test/http-wire-headers.test.ts）。
    // 滤掉空槽不影响「调用方显式传的头优先」这个本意——有值的仍然优先。
    const existing = Object.fromEntries(
      Object.entries((cfg.headers ?? {}) as unknown as Record<string, AxiosHeaderValue>).filter(
        ([name, value]) =>
          value !== undefined &&
          value !== null &&
          !new Set(['token', 'tenant-id']).has(name.toLowerCase()),
      ),
    ) as unknown as Record<string, AxiosHeaderValue>
    cfg.headers = {
      ...buildHeaders({
        credential: config.credential,
        moduleType: cfg.moduleType,
        language: config.language,
        headerMode: profile.headerMode,
        extraHeaders: profile.extraHeaders,
      }),
      ...existing,
    } as unknown as AxiosRequestHeaders

    // GET 防缓存参数，与前端一致。
    //
    // ⚠️ **顺序是 `…调用方的 params` → `token` → `_t`**，不是反过来。
    // 各 `tokenInParams` 实例的请求拦截器逐字写着：
    //   config.params = { ...config.params, ...{ token }, ...{ '_t': new Date().getTime() } }
    // （`smart-layer-admin.js:26-31`、`smart-layer-app.js`、`zhdj-*` 同形）
    // 这一族是 **axios 默认序列化**，对象键序就是 URL 上的顺序 —— 写反了
    // 会 `_t` 在前、`token` 在后，与浏览器不逐字一致（2026-09-21 由讲师管理那条基准抓到）。
    if (cfg.method === 'get') {
      if (profile.tokenInParams && config.credential.token) {
        cfg.params = { ...(cfg.params as Record<string, unknown> | undefined), token: config.credential.token }
      }
      if (cfg.tokenParamName && config.credential.token) {
        const params = { ...(cfg.params as Record<string, unknown> | undefined) }
        // The session token is tenant-bound. A caller must not be able to
        // replace it by supplying the same query key (for example `c`).
        delete params[cfg.tokenParamName]
        cfg.params = {
          [cfg.tokenParamName]: config.credential.token,
          ...params,
        }
      }
      if (!cfg.skipGetCacheParam) {
        cfg.params = { ...(cfg.params as Record<string, unknown> | undefined), _t: Date.now() }
      }
    }

    // 分页参数改名：只有 sale.js 干这件事（sale.js:38-41 改 params、48-51 改 data）
    if (profile.pageSizeParamAlias) {
      if (cfg.params && typeof cfg.params === 'object') {
        cfg.params = applyPageSizeAlias(
          profile.pageSizeParamAlias,
          cfg.params as Record<string, unknown>,
        )
      }
      if (cfg.data && typeof cfg.data === 'object') {
        cfg.data = applyPageSizeAlias(
          profile.pageSizeParamAlias,
          cfg.data as Record<string, unknown>,
        )
      }
    }

    // 前端把 GET 的 params 用 qs 序列化后拼进 URL，这里保持一致。
    // 只有 platform.js 的拦截器这么做；其余实例交给 axios 自己的序列化器，
    // 两者对 null / 数组 / 嵌套对象的结果不同，不能混用（见 http-instance.ts）
    if (
      profile.querySerialization === 'qs-in-interceptor' &&
      String(cfg.method).toUpperCase() === 'GET' &&
      cfg.params
    ) {
      const params = cfg.params as Record<string, unknown>
      const [base, inlineQuery] = String(cfg.url ?? '').split('?')
      // ⚠️ 顺序是「先 params、**后** inline query」，与 platform.js:57-62 逐字一致：
      //     config.params = { ...config.params, ...qs.parse(fixParamsString) }
      // 这一条不只是"谁在前面"：spread 在后的那个在**键冲突时赢**，所以写反了会让
      // URL 上拼的参数被 params 覆盖（或反过来），而两种写法在**不冲突时长得一模一样**。
      // 实测依据：课程域四页的 getDataListURL 自带 `?type=N`，浏览器发出的顺序是
      // `…&pageSize=20&_t=<ts>&type=N`（type 在 _t **之后**，见
      // baseline/study-course.browser.json），旧写法会把它排到最前。
      const merged = inlineQuery ? { ...params, ...qs.parse(inlineQuery) } : params
      const mergedStr = qs.stringify(merged, {
        allowDots: true,
        skipNulls: true,
        ...(cfg.paramsArrayFormat ? { arrayFormat: cfg.paramsArrayFormat } : {}),
      })
      cfg.params = {}
      cfg.url = mergedStr ? `${base}?${mergedStr}` : String(base)
    }

    return cfg
  })

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const cfg = response.config as PortalRequestConfig
      const responseType = cfg.responseType as string | undefined

      if (cfg.sourceResponse || !JSON_RESPONSE_TYPES.has(responseType)) {
        return response
      }

      // 按**这个实例自己的**规则拆包络（四条规则与出处见 http-instance.ts 的
      // HttpResponseEnvelope）。原来这里只认 portal-standard、其余一律抛，
      // 已按用户 2026-09-21 的要求改成逐实例复刻。
      const profile = profileFor(cfg.httpInstance)
      return applyEnvelope(profile.responseEnvelope, response, cfg) as never
    },
    (error: unknown) => {
      throw error
    },
  )

  return instance
}
