import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import { PortalApiError } from '../src/http/errors.js'
import {
  applyUrlRewrite,
  getHttpInstance,
  HttpInstanceResolutionError,
  type HttpInstanceResolutionError as HttpInstanceResolutionErrorType,
} from '../src/context/http-instance.js'
import {
  BATCH_ENDPOINTS,
  type BatchEndpoint,
} from '../src/capabilities/generated/batch-capabilities.js'

/**
 * 「同 host 不同前缀」的网关 —— **透传清单不是到达它们的通路**。
 *
 * 起因：`docs/base-capabilities.md` 的 P0-0 断言 `platform` 实例的透传白名单
 * 「漏了 `/admin-shop-api` 与 `/admin-crm-api`」，「不修的话 A 层 5 条能力会被补成
 * `/admin-api/admin-shop-api/...`，静默打到错 URL」。**这个结论不成立**，判据如下：
 *
 * 1. 前端原文（`app/portal/utils/http/platform.js:18-20`）的否定项**就是三个**。
 *    往表里加第 4、第 5 个 = 不复刻，是发明。
 * 2. 透传清单不是"同 host 的网关白名单"，它的构成有**一条能对上的判据**：
 *    **页面自己会把这段前缀写进路径**的那些前缀。`/adminmanage-api`（157 处）、
 *    `/mall-manage-api`（153 处）是页面里真的会写的 `getDataListURL`，所以要透传；
 *    而 `/admin-shop-api` / `/admin-crm-api` / `/mall-api` 在前端**作为路径字面量出现 0 次**
 *    （2026-09-20 全仓 grep）—— 它们是**另外三个 axios 实例各自的 baseURL**
 *    （`VITE_SHOP_ADMIN_API` / `VITE_CRM_API` / `VITE_MALL_APP_API`），路径里不带前缀。
 *    「platform 客户端收到这种路径」这个输入在前端根本不存在，没有浏览器行为可复刻。
 * 3. 所以 SDK 的答案是「换实例 + 配它自己的 baseURL」，而不是「加透传项」。
 *    那条路已经在跑：浏览器基准里那条 shop URL 由 `sale` 实例的 baseURL 拼出，逐字节一致
 *    （见 `test/batch-capabilities.test.ts` 的 `reproduceUrl` 一组）。
 * 4. 万一真出现「带网关前缀的路径走了 platform 实例」，失败形态是**静默的**：
 *    真实后端回的是 **HTTP 200 + `ret: "FAIL"` / `code: 404`**（第 5 组 LIVE 实测），
 *    只看状态码发现不了。第 2 组因此加了一条全仓守卫。
 */

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORTAL_REPO = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const PLATFORM_JS = join(PORTAL_REPO, 'app/portal/utils/http/platform.js')
const hasRepo = existsSync(PLATFORM_JS)

/** platform.js 真正透传的三个前缀（第四项不存在，别加） */
const PASSTHROUGH_IN_FRONTEND = ['/admin-api', '/adminmanage-api', '/mall-manage-api']

/**
 * 测试环境里与 `platform` **同 host、不同前缀**的四个实例
 * （`build/env/.env.build.test`：`biz-api-test.wodecorp.cn` + 各自前缀）。
 *
 * `pathInFrontend` 是**前端有没有把这段前缀当路径写**（本轮 grep 的实测结果），
 * 它决定了这段前缀该不该进 platform 的透传表 —— 不是"同 host 就都该进来"。
 * `/mall-manage-api` 有 153 处 `getDataListURL: '/mall-manage-api/...'`，所以它在表里；
 * 另外三个 0 处，所以它们不在。
 */
const SAME_HOST_GATEWAYS = [
  { prefix: '/mall-manage-api', instance: 'platform-mall-admin', env: 'VITE_MALL_ADMIN_API', pathInFrontend: true },
  { prefix: '/admin-shop-api', instance: 'sale', env: 'VITE_SHOP_ADMIN_API', pathInFrontend: false },
  { prefix: '/admin-crm-api', instance: 'crm', env: 'VITE_CRM_API', pathInFrontend: false },
  { prefix: '/mall-api', instance: 'mall-app', env: 'VITE_MALL_APP_API', pathInFrontend: false },
] as const

// ---------------------------------------------------------------------------
// 1. 判据：透传清单 ⇔ 前端真的把这段前缀当路径写过
// ---------------------------------------------------------------------------

describe('透传清单的判据是「页面真的会把它当路径写」，不是「同 host 的网关都该进来」', () => {
  it('platform 实例的透传项恰好是前端那三个；另外三个网关前缀**不在**里面', () => {
    const rewrite = getHttpInstance('platform')?.urlRewrite
    expect(rewrite).toMatchObject({
      kind: 'prepend-absolute',
      add: '/admin-api',
      passthrough: PASSTHROUGH_IN_FRONTEND,
    })

    const passthrough = (rewrite as { passthrough: readonly string[] }).passthrough
    // 这条是**反假设**断言：把 /admin-shop-api 或 /admin-crm-api 塞进表里，它会立刻红。
    // 红了不代表"更全"，代表 SDK 不再复刻 platform.js —— 那行 if 里没有它们。
    for (const gateway of SAME_HOST_GATEWAYS) {
      if (gateway.pathInFrontend) continue
      expect(passthrough, `${gateway.prefix} 不该进 platform 的透传表`).not.toContain(gateway.prefix)
    }
  })

  it('与 platform 同 host 的实例是 4 个（含 platform 共 5 个），各自有自己的 baseURL env', () => {
    // 「4 个网关同 host」是调查报里给的数；这里把它变成可复核的清单。
    expect(SAME_HOST_GATEWAYS).toHaveLength(4)
    for (const gateway of SAME_HOST_GATEWAYS) {
      const profile = getHttpInstance(gateway.instance)
      expect(profile, gateway.instance).not.toBeNull()
      expect(profile?.baseUrl, gateway.instance).toEqual({ kind: 'env', env: gateway.env })
      // 它们没有一个是靠 platform 补前缀到达的：自己的 urlRewrite 是 none
      expect(profile?.urlRewrite, gateway.instance).toEqual({ kind: 'none' })
    }
  })
})

describe.skipIf(!hasRepo)('对照 Portal 源码重新抓一次（前端仓库存在时才跑）', () => {
  it('platform.js 的否定项集合与表里的透传清单相同——多一个少一个都会红', () => {
    const src = readFileSync(PLATFORM_JS, 'utf8')
    // 不复用 test/http-instances.test.ts 那个"恰好三条"的正则：它写死了 3 个捕获组，
    // 前端真加了第 4 个前缀时它只会匹配失败（null），而这里要的是"集合不等"这个**具体的红**。
    const line = src.split('\n').find((l) => l.includes("!config.url.startsWith('/admin-api')"))
    expect(line, 'platform.js 里那条补前缀的 if 找不到了').toBeTruthy()
    const negated = [...(line ?? '').matchAll(/!config\.url\.startsWith\('([^']+)'\)/g)].map((m) => m[1])
    expect(negated).toEqual(PASSTHROUGH_IN_FRONTEND)
  })

  it('透传清单 ⇔ 前端路径字面量：进了表的这段前缀被写过，没进表的 0 次', () => {
    const files = [
      ...collect(join(PORTAL_REPO, 'app/portal'), ['.js', '.vue', '.ts']),
      ...collect(join(PORTAL_REPO, 'common'), ['.js', '.vue', '.ts']),
    ]
    expect(files.length).toBeGreaterThan(500) // 别让"扫了 0 个文件"伪装成"0 处命中"

    // 反证（写在用例里，不靠"手工改坏一次"）：这个计数器对合成输入的行为先钉死，
    // 否则"扫了 500 个文件得到 0"和"计数器坏了"是同一个样子。
    expect(countPathLiterals(`const u = '/admin-shop-api/x'`, '/admin-shop-api')).toBe(1)
    expect(countPathLiterals('const u = "https://h/admin-shop-api/x"', '/admin-shop-api')).toBe(0)

    const counts = new Map<string, number>(
      [...PASSTHROUGH_IN_FRONTEND, ...SAME_HOST_GATEWAYS.map((g) => g.prefix)].map((p) => [p, 0]),
    )
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const prefix of counts.keys()) {
        counts.set(prefix, (counts.get(prefix) ?? 0) + countPathLiterals(src, prefix))
      }
    }
    // 左边：进了透传表的，前端确实这么写过（否则透传项就是凭空加的）
    for (const prefix of PASSTHROUGH_IN_FRONTEND) {
      expect(counts.get(prefix), `${prefix} 在透传表里，但前端一处都没写过`).toBeGreaterThan(0)
    }
    // 右边：同 host 的四个网关前缀，与前端的路径用法**一一对应**。
    // 没进表的三个前端一次都没写过 —— 它们不是路径，是实例自己的 baseURL。
    // **前端哪天开始这么写了，这条就红**，那时才该动透传表（这才是"该修"的判据）。
    for (const gateway of SAME_HOST_GATEWAYS) {
      const usages = counts.get(gateway.prefix) ?? 0
      if (gateway.pathInFrontend) {
        expect(usages, `${gateway.prefix} 前端当路径写过，透传表里却在`).toBeGreaterThan(0)
      } else {
        expect(usages, `${gateway.prefix} 在前端被当路径写了，透传表要重新看`).toBe(0)
      }
    }
  })

  it('前端确实有"路径里带网关前缀"的用法（证明上面那条不是空转）', () => {
    const src = readFileSync(join(PORTAL_REPO, 'app/portal/utils/system.js'), 'utf8')
    expect(src).toContain("'/adminmanage-api/adminmanage/platform-config/list'")
  })
})

// ---------------------------------------------------------------------------
// 2. 全仓守卫：SDK 发出的每一条路径，前缀必须与它声明的实例自洽
// ---------------------------------------------------------------------------

/**
 * 数一处源码里"把这段前缀当路径写"的次数。
 * 只看**字符串字面量以该前缀开头**的用法（那才是会被当 `config.url` 传出去的）；
 * `https://host/admin-shop-api/...` 这类完整 URL 不算 —— 它们走 `window.location` / `newPage()`。
 */
function countPathLiterals (src: string, prefix: string): number {
  return src.match(new RegExp(`['"\`]${prefix.replace(/\//g, '\\/')}`, 'g'))?.length ?? 0
}

/** 「带网关前缀的路径必须声明那个网关的实例」这条蕴含的违规清单（今天应为空集） */
function gatewayPrefixedOffenders (endpoints: readonly BatchEndpoint[]): string[] {
  return endpoints.flatMap((e) => {
    const owner = SAME_HOST_GATEWAYS.find((g) => !g.pathInFrontend && e.url.startsWith(g.prefix))
    if (!owner) return []
    return e.httpInstance === owner.instance && e.baseUrlEnv === owner.env
      ? []
      : [`${e.pagePath} url=${e.url} instance=${e.httpInstance} env=${e.baseUrlEnv}`]
  })
}

describe('守卫：没有任何请求把「网关前缀」当路径塞给 platform 实例', () => {
  it('生成物里每条契约的 url 前缀都与它的 httpInstance 自洽', () => {
    const endpoints = Object.values(BATCH_ENDPOINTS)
    expect(endpoints.length).toBeGreaterThan(10)

    // 非空转的锚：生成物里**确实有**带透传前缀的路径（4 条 `/mall-manage-api/...`），
    // 所以下面的扫描不是"表里没数据"扫了个寂寞。
    const throughPassthrough = endpoints.filter((e) =>
      PASSTHROUGH_IN_FRONTEND.some((p) => e.url.startsWith(p)),
    )
    expect(throughPassthrough.length).toBeGreaterThan(0)
    // 且这些走的**就是** platform 实例 —— 这正是那三个前缀存在的理由：
    // 页面自己把前缀写进路径，靠透传把它们送到同一个 host 上的另一段前缀。
    for (const e of throughPassthrough) {
      expect(e.httpInstance, `${e.pagePath} ${e.url}`).toBe('platform')
    }

    // 另一条蕴含：**若**一条契约以未列入透传的网关前缀开头，**则**它必须声明那个网关的实例、
    // 且 baseURL env 对得上（否则就是"带网关前缀的路径走了 platform" = 静默打到错 URL）。
    // 今天生成物里没有这种契约（offenders 空集），这条守卫是给以后的新契约准备的。
    expect(gatewayPrefixedOffenders(endpoints)).toEqual([])

    // 反证（写在用例里）：同一条判据遇到"带网关前缀却声明 platform"的合成契约必须抓出来。
    // 没有这一段，上面那个空集就无法区分"真干净"和"判据写错了"。
    const synthetic = {
      ...endpoints[0]!,
      pagePath: '/合成/反证',
      url: '/admin-shop-api/admin/shop/getInfo',
      httpInstance: 'platform',
      baseUrlEnv: 'VITE_ZHDJ_PLATFORM_API',
    }
    expect(gatewayPrefixedOffenders([...endpoints, synthetic])).toEqual([
      '/合成/反证 url=/admin-shop-api/admin/shop/getInfo instance=platform env=VITE_ZHDJ_PLATFORM_API',
    ])
  })

  it('手写能力与基础数据的 url 里，没有一条以那三个网关前缀开头（源码字面量扫）', () => {
    const files = [
      ...collect(join(PKG_ROOT, 'src/capabilities'), ['.ts']),
      ...collect(join(PKG_ROOT, 'src/session'), ['.ts']),
    ].filter((f) => !f.includes('/generated/'))

    const literals: string[] = []
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/url: *'([^']+)'/g)) {
        const url = m[1] ?? ''
        literals.push(url)
        if (SAME_HOST_GATEWAYS.some((g) => url.startsWith(g.prefix))) {
          offenders.push(`${file.replace(PKG_ROOT + '/', '')} ${url}`)
        }
      }
    }
    expect(literals.length).toBeGreaterThan(20) // 非空转：确实扫到了 url 字面量
    expect(offenders).toEqual([])

    // 反证（写在用例里）：同一个抽取器遇到带网关前缀的 url 必须认出来。
    const synthetic = `const cap = { url: '/admin-shop-api/admin/shop/getInfo' }`
    const caught = [...synthetic.matchAll(/url: *'([^']+)'/g)]
      .map((m) => m[1] ?? '')
      .filter((url) => SAME_HOST_GATEWAYS.some((g) => !g.pathInFrontend && url.startsWith(g.prefix)))
    expect(caught).toEqual(['/admin-shop-api/admin/shop/getInfo'])
  })
})

// ---------------------------------------------------------------------------
// 3. 复刻的语义本身：补 /admin-api 对"没列进去的前缀"照样发生
// ---------------------------------------------------------------------------

describe('platform 的补前缀语义（复刻 platform.js:18-20，逐条）', () => {
  const platformRewrite = getHttpInstance('platform')?.urlRewrite

  it('没列进去的前缀也会被补 —— 包括那两个网关前缀', () => {
    // 这条**不是**在给一个 bug 背书：它锁的是"前端就是这么写的"。
    // 所以结论是"这种输入不许产生"（第 1、2 组的判据与守卫），
    // 而不是"把这两个前缀偷偷加进透传表"。
    expect(applyUrlRewrite(platformRewrite!, '/admin-shop-api/admin/shop/getInfo')).toBe(
      '/admin-api/admin-shop-api/admin/shop/getInfo',
    )
    expect(applyUrlRewrite(platformRewrite!, '/admin-crm-api/vue/getUserInfo')).toBe(
      '/admin-api/admin-crm-api/vue/getUserInfo',
    )
  })

  it('三个边界条件：前导斜杠 / 透传命中 / 相对路径原样发出', () => {
    expect(applyUrlRewrite(platformRewrite!, '/sys/user/info')).toBe('/admin-api/sys/user/info')
    expect(applyUrlRewrite(platformRewrite!, '/admin-api/sys/user/info')).toBe('/admin-api/sys/user/info')
    expect(applyUrlRewrite(platformRewrite!, '/adminmanage-api/x')).toBe('/adminmanage-api/x')
    expect(applyUrlRewrite(platformRewrite!, '/mall-manage-api/x')).toBe('/mall-manage-api/x')
    // 漏写前导斜杠：原样发出，被 axios 当相对路径拼到 baseURL 后面
    expect(applyUrlRewrite(platformRewrite!, 'admin/shop/getInfo')).toBe('admin/shop/getInfo')
  })

  it('sale / crm / mall-app 实例一个字节都不改（差异二的另一半）', () => {
    for (const id of ['sale', 'crm', 'mall-app']) {
      const rewrite = getHttpInstance(id)?.urlRewrite
      expect(applyUrlRewrite(rewrite!, '/admin/shop/getInfo'), id).toBe('/admin/shop/getInfo')
      expect(applyUrlRewrite(rewrite!, '/admin-crm-api/vue/getUserInfo'), id).toBe(
        '/admin-crm-api/vue/getUserInfo',
      )
    }
  })
})

// ---------------------------------------------------------------------------
// 4. SDK 真正走的那条路：换实例 + 配 baseURL（离线适配器）
// ---------------------------------------------------------------------------

type Captured = InternalAxiosRequestConfig & PortalRequestConfig

const PLATFORM_BASE = 'https://biz-api-test.wodecorp.cn'
const SHOP_BASE = 'https://biz-api-test.wodecorp.cn/admin-shop-api'
const CRM_BASE = 'https://biz-api-test.wodecorp.cn/admin-crm-api'

function captureCall (options?: Parameters<typeof createPageCall>[2]) {
  const calls: Captured[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: PLATFORM_BASE,
    credential: { token: 'tk-test', tenantId: 7 },
  })
  http.defaults.adapter = async (config) => {
    calls.push(config as Captured)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(requestConfig: PortalRequestConfig) =>
      http.request(requestConfig as never) as unknown as Promise<T>,
    undefined,
    options,
  )
  return { call, calls }
}

describe('shop / crm 网关在 SDK 里的通路 = 各自的实例 baseURL', () => {
  it('sale 页面：baseURL 换成 shop base，路径不补 /admin-api（与浏览器基准逐字节一致）', async () => {
    const { call, calls } = captureCall({ baseUrls: { sale: SHOP_BASE } })
    await call('/dashboard/sale/customer-service/after-sale/list', {
      url: '/admin/aftersales/page',
      method: 'get',
      params: { pageNo: 1, pageSize: 20 },
    })
    const config = calls[0]
    expect(config?.baseURL).toBe(SHOP_BASE)
    // sale.js 没有补前缀拦截器：路径原样（params 也不像 platform 那样拼进 url，
    // 它交给 axios 的默认序列化器，所以这里看的是 config.params）
    expect(String(config?.url)).toBe('/admin/aftersales/page')
    expect(String(config?.url)).not.toContain('/admin-api')
    // 画像里的另一处差异：`pageSize` 改名成 `limit`
    expect(config?.params).toMatchObject({ pageNo: 1, limit: 20 })
    expect(config?.params).not.toHaveProperty('pageSize')
    // 浏览器基准里那条就是 `https://biz-api-test.wodecorp.cn/admin-shop-api/admin/aftersales/page?...`
    expect(`${config?.baseURL}${String(config?.url).split('?')[0]}`).toBe(
      `${SHOP_BASE}/admin/aftersales/page`,
    )
  })

  it('crm 页面：baseURL 换成 crm base（这条以前没有测试钉过）', async () => {
    const { call, calls } = captureCall({ baseUrls: { crm: CRM_BASE } })
    await call('/dashboard/platform/market/market/todo/list', {
      url: '/vue/getUserInfo',
      method: 'get',
    })
    const config = calls[0]
    expect(config?.baseURL).toBe(CRM_BASE)
    expect(`${config?.baseURL}${String(config?.url).split('?')[0]}`).toBe(`${CRM_BASE}/vue/getUserInfo`)
  })

  it('没配 baseURL 时**拒绝发请求**——这就是「不会静默打到错 URL」的那道闸', () => {
    const { call, calls } = captureCall()
    let error: HttpInstanceResolutionErrorType | null = null
    try {
      void call('/dashboard/platform/market/market/todo/list', { url: '/vue/getUserInfo', method: 'get' })
    } catch (caught) {
      error = caught as HttpInstanceResolutionErrorType
    }
    expect(error).toBeInstanceOf(HttpInstanceResolutionError)
    expect(error?.reason).toBe('missing-base-url')
    expect(error?.message).toContain('crm')
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 5. LIVE 真实环境（默认跳过；用 ./smoke/with-portal-token.sh 跑）
// ---------------------------------------------------------------------------

const LIVE =
  Boolean(process.env.PORTAL_BASE_URL) &&
  Boolean(process.env.PORTAL_TOKEN) &&
  Boolean(process.env.PORTAL_TENANT_ID)

describe.runIf(LIVE)('LIVE 真实环境 —— 网关前缀的两条路（只读）', () => {
  const baseUrl = process.env.PORTAL_BASE_URL as string
  const token = process.env.PORTAL_TOKEN as string
  const tenantId = process.env.PORTAL_TENANT_ID as string

  function liveCall (options?: Parameters<typeof createPageCall>[2]) {
    const calls: Captured[] = []
    const http = createPortalHttp({ baseUrl, credential: { token, tenantId } })
    http.interceptors.request.use((config) => {
      calls.push(config as Captured)
      return config
    })
    const call = createPageCall(
      <T>(requestConfig: PortalRequestConfig) => http.request(requestConfig as never) as unknown as Promise<T>,
      undefined,
      options,
    )
    return { call, calls }
  }

  it('走 sale 实例：SDK 真的打到 admin-shop-api 并且拿到数据', async () => {
    const { call, calls } = liveCall({ baseUrls: { sale: SHOP_BASE } })
    const data = await call<{ shopName?: string }>('/dashboard/sale/customer-service/after-sale/list', {
      url: '/admin/shop/getInfo',
      method: 'get',
    })
    const sent = `${calls[0]?.baseURL}${String(calls[0]?.url).split('?')[0]}`
    // eslint-disable-next-line no-console
    console.log(`[LIVE] sale 实例实际发出：${sent}`)
    expect(sent).toBe(`${SHOP_BASE}/admin/shop/getInfo`)
    expect(data?.shopName).toBeTruthy()
  })

  it('走 crm 实例：SDK 真的打到 admin-crm-api 并且拿到数据', async () => {
    const { call, calls } = liveCall({ baseUrls: { crm: CRM_BASE } })
    const data = await call<{ id?: string }>('/dashboard/platform/market/market/todo/list', {
      url: '/vue/getUserInfo',
      method: 'get',
    })
    const sent = `${calls[0]?.baseURL}${String(calls[0]?.url).split('?')[0]}`
    // eslint-disable-next-line no-console
    console.log(`[LIVE] crm 实例实际发出：${sent}`)
    expect(sent).toBe(`${CRM_BASE}/vue/getUserInfo`)
    expect(data?.id).toBeTruthy()
  })

  it('把网关前缀当路径塞给 platform 实例：真实后端回的是 HTTP 200 + ret=FAIL（静默形态）', async () => {
    const { call, calls } = liveCall()
    let apiError: PortalApiError | null = null
    try {
      // 用一个**没有页面规则**的页面：实例落到全局默认 platform，
      // 路径里带着另一个网关的前缀 —— 这就是那条调查担心的输入。
      await call('/dashboard/meeting-room/list', {
        url: '/admin-shop-api/admin/shop/getInfo',
        method: 'get',
      })
    } catch (error) {
      apiError = error as PortalApiError
    }
    const sent = `${calls[0]?.baseURL}${String(calls[0]?.url).split('?')[0]}`
    // eslint-disable-next-line no-console
    console.log(`[LIVE] 补错前缀后实际发出：${sent}`)
    expect(sent).toBe(`${baseUrl}/admin-api/admin-shop-api/admin/shop/getInfo`)
    // 关键点：**HTTP 状态码是 200**，错只错在包络里。只看状态码的监控发现不了这条。
    expect(apiError).toBeInstanceOf(PortalApiError)
    expect(apiError?.ret).toBe('FAIL')
    expect(apiError?.code).toBe(404)
  })
})

// ---------------------------------------------------------------------------

/** 递归收集指定后缀的文件（零依赖，与仓库里的生成器脚本一致） */
function collect (dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...collect(full, extensions))
      continue
    }
    if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full)
  }
  return out
}
