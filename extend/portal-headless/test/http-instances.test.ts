import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  __setHttpInstancePageRulesForTest,
  applyPageSizeAlias,
  applyUrlRewrite,
  DEFAULT_HTTP_INSTANCE_ID,
  getHttpInstance,
  HTTP_INSTANCE_PAGE_RULES,
  HTTP_INSTANCES,
  resolveHttpInstance,
} from '../src/context/http-instance.js'
import { normalizeMenuEntryPath } from '../src/context/module-type.js'

/**
 * 这一组钉的是「页面 → 用哪个 http 实例」的推导。
 *
 * 表本身是快照，不是源码；所以有两层：
 * - 不需要 Portal 仓库的结构性断言（唯一性、默认实例存在、纯函数行为）
 * - `PORTAL_REPO` 存在时，用源码**重新推导一遍**与表逐条比对（对不上就红）
 *
 * 第二层没有仓库时会跳过——所以第二层的推导逻辑本身也在下面用内联固件测了，
 * 否则「跳过」就成了「没测」。
 */

// ---------------------------------------------------------------------------
// 第一层：结构性断言
// ---------------------------------------------------------------------------

describe('实例画像：结构', () => {
  it('id 唯一', () => {
    const ids = HTTP_INSTANCES.map((profile) => profile.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('默认实例在表里，且就是 platform.js', () => {
    const profile = getHttpInstance(DEFAULT_HTTP_INSTANCE_ID)
    expect(profile?.source).toContain('app/portal/utils/http/platform.js')
  })

  it('每个实例的 source 都是 file:line 形式，能复核', () => {
    for (const profile of HTTP_INSTANCES) {
      expect(profile.source, profile.id).toMatch(/^app\/portal\/[\w/.-]+\.js:\d+/)
    }
  })

  it('只有 platform.js 有补前缀规则', () => {
    const withPrefix = HTTP_INSTANCES.filter((p) => p.urlRewrite.kind === 'prepend-absolute')
    expect(withPrefix.map((p) => p.id)).toEqual(['platform'])
  })

  it('只有 sale.js 改分页参数名，改成 limit', () => {
    const withAlias = HTTP_INSTANCES.filter((p) => p.pageSizeParamAlias !== null)
    expect(withAlias.map((p) => p.id)).toEqual(['sale'])
    expect(withAlias[0]?.pageSizeParamAlias).toBe('limit')
  })

  it('只有 platform.js 在拦截器里把 GET params 用 qs 拼进 url', () => {
    const qsInInterceptor = HTTP_INSTANCES.filter((p) => p.querySerialization === 'qs-in-interceptor')
    expect(qsInInterceptor.map((p) => p.id)).toEqual(['platform'])
  })

  it('两个实例共用同一个 baseURL env 时，env 名要一致（product / product-no-token 都是 VITE_FM_API）', () => {
    const fm = HTTP_INSTANCES.filter(
      (p) => p.baseUrl.kind === 'env' && p.baseUrl.env === 'VITE_FM_API',
    ).map((p) => p.id)
    expect(fm.sort()).toEqual(['product', 'product-no-token'])
  })

  it('页面规则表里没有两条归一化后落到同一页、实例却不同（否则归一化会悄悄改变结论）', () => {
    const byNormalized = new Map<string, string | null>()
    for (const rule of HTTP_INSTANCE_PAGE_RULES) {
      const key = normalizeMenuEntryPath(rule.pagePath)
      if (byNormalized.has(key)) {
        expect(byNormalized.get(key), `归一化冲突：${key}`).toBe(rule.instance)
      }
      byNormalized.set(key, rule.instance)
    }
  })

  it('页面规则表里指向的实例 id 都在画像表里', () => {
    for (const rule of HTTP_INSTANCE_PAGE_RULES) {
      if (rule.instance === null) continue
      expect(getHttpInstance(rule.instance), `${rule.pagePath} → ${rule.instance}`).not.toBeNull()
    }
  })

  it('规则表里的 null 条目必须带 reason（否则失败信息指不出为什么追不动）', () => {
    for (const rule of HTTP_INSTANCE_PAGE_RULES) {
      if (rule.instance !== null) continue
      expect(rule.reason, `${rule.pagePath} 是 null 条目却没有 reason`).toBeTruthy()
    }
  })

  it('null 条目今天是 0 条——这是库存陈述，机制是否接上由内联固件证明', () => {
    // 这条断言曾经是**空真**的：推导器把 `instance === null` 和 `=== 'platform'`
    // 并进了同一条 continue，所以它永远产不出 null，表里自然也永远是 0 条
    // ——「今天没有」和「机制从没接上」看起来一模一样。
    // 现在推导器会把追不动的声明记成 null，这条才成为一句真正的库存陈述；
    // 机制本身能不能被触发，由文件末尾「推导追不动的声明」那一组内联固件钉住。
    expect(HTTP_INSTANCE_PAGE_RULES.filter((r) => r.instance === null)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 第二层：纯函数与解析
// ---------------------------------------------------------------------------

describe('applyUrlRewrite —— 复刻 platform.js:18-20', () => {
  const platform = getHttpInstance('platform')

  function rewrite (url: string): string {
    return applyUrlRewrite(platform!.urlRewrite, url)
  }

  it('前导斜杠 + 不在透传清单里 → 补 /admin-api', () => {
    expect(rewrite('/hr/meeting-room/page')).toBe('/admin-api/hr/meeting-room/page')
  })

  it('已带 /admin-api 不重复补', () => {
    expect(rewrite('/admin-api/hr/meeting-room/page')).toBe('/admin-api/hr/meeting-room/page')
  })

  it('/adminmanage-api 与 /mall-manage-api 透传（这是它们唯一的可达方式）', () => {
    expect(rewrite('/adminmanage-api/system/tenant/get')).toBe('/adminmanage-api/system/tenant/get')
    expect(rewrite('/mall-manage-api/sys/coupon/page')).toBe('/mall-manage-api/sys/coupon/page')
  })

  it('没有前导斜杠的相对路径原样发出——不补前缀（漏写斜杠是一类真实存在的页面 bug）', () => {
    expect(rewrite('admin/aftersales/page')).toBe('admin/aftersales/page')
  })

  it('sale 实例不改写任何 url', () => {
    const sale = getHttpInstance('sale')
    expect(applyUrlRewrite(sale!.urlRewrite, '/admin/aftersales/page')).toBe('/admin/aftersales/page')
  })

  it('后缀规则挂了 flag 时，flag 不为 true 就不加', () => {
    const zhdjAdmin = getHttpInstance('zhdj-admin')
    expect(applyUrlRewrite(zhdjAdmin!.urlRewrite, '/v1/x')).toBe('/v1/x')
    expect(applyUrlRewrite(zhdjAdmin!.urlRewrite, '/v1/x', { isLay: true })).toBe('/v1/x.lay')
  })
})

describe('applyPageSizeAlias —— 复刻 sale.js:38-41 / 48-51', () => {
  it('null（不改名的实例）原样返回', () => {
    expect(applyPageSizeAlias(null, { pageSize: 20, pageNo: 1 })).toEqual({ pageSize: 20, pageNo: 1 })
  })

  it('改名成 limit 并删掉 pageSize', () => {
    const next = applyPageSizeAlias('limit', { pageSize: 20, pageNo: 1 })
    expect(next).toEqual({ limit: 20, pageNo: 1 })
    expect(next).not.toHaveProperty('pageSize')
  })

  it('pageSize 是 undefined 时不动——与源码的 !isUndefined 判断一致', () => {
    const next = applyPageSizeAlias('limit', { pageSize: undefined, pageNo: 1 })
    expect(next).not.toHaveProperty('limit')
    expect(next).toHaveProperty('pageSize')
  })

  it('不改输入对象', () => {
    const input = { pageSize: 20 }
    applyPageSizeAlias('limit', input)
    expect(input).toEqual({ pageSize: 20 })
  })
})

describe('resolveHttpInstance —— 页面 → 实例', () => {
  afterEach(() => {
    __setHttpInstancePageRulesForTest(null)
  })

  it('页面没有任何声明 → 全局默认 platform（这是推导结论，不是猜）', () => {
    const result = resolveHttpInstance({ pagePath: '/dashboard/meeting-room/list' })
    expect(result).toMatchObject({
      kind: 'resolved',
      matchedBy: 'global-default',
      instance: { id: 'platform' },
    })
  })

  it('页面规则命中 → 该实例', () => {
    const result = resolveHttpInstance({ pagePath: '/dashboard/sale/goods/classification/list' })
    expect(result).toMatchObject({
      kind: 'resolved',
      matchedBy: 'page-rule',
      instance: { id: 'sale' },
    })
  })

  it('详情页按列表页同一条口径归一化后再查表', () => {
    const result = resolveHttpInstance({ pagePath: '/dashboard/sale/shop/rule/detail/9' })
    expect(result).toMatchObject({ kind: 'resolved', instance: { id: 'sale' } })
  })

  it('请求级显式声明优先于页面规则', () => {
    const result = resolveHttpInstance({
      pagePath: '/dashboard/sale/goods/classification/list',
      declared: 'platform',
    })
    expect(result).toMatchObject({ matchedBy: 'declared', instance: { id: 'platform' } })
  })

  it('未知实例 id → unresolved，不静默退回默认', () => {
    const result = resolveHttpInstance({ pagePath: '/x', declared: 'sale-mall' })
    expect(result).toMatchObject({ kind: 'unresolved', reason: 'unknown-instance-id' })
  })

  it('已从 Portal 删除的 hr 实例拒绝解析，会议室页面仍使用 platform', () => {
    expect(getHttpInstance('hr')).toBeNull()
    expect(resolveHttpInstance({ pagePath: '/dashboard/meeting-room/list', declared: 'hr' }))
      .toMatchObject({ kind: 'unresolved', reason: 'unknown-instance-id' })
    expect(resolveHttpInstance({ pagePath: '/dashboard/meeting-room/list' }))
      .toMatchObject({ kind: 'resolved', matchedBy: 'global-default', instance: { id: 'platform' } })
  })

  it('页面声明了但推导认不出来 → unresolved（注入固件验这条路径真的会触发）', () => {
    __setHttpInstancePageRulesForTest([
      {
        pagePath: '/dashboard/x/list',
        instance: null,
        source: 'app/portal/views/dashboard/x/list.vue:10',
        reason: 'http 来自某个 composable 的返回值',
      },
    ])
    const result = resolveHttpInstance({ pagePath: '/dashboard/x/list' })
    expect(result).toMatchObject({
      kind: 'unresolved',
      reason: 'page-declares-unresolvable-instance',
    })
    if (result.kind === 'unresolved') {
      expect(result.detail).toContain('x/list.vue:10')
    }
  })
})

// ---------------------------------------------------------------------------
// 第三层：拿 Portal 源码重新推导一遍
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORTAL_REPO = '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const PORTAL_REPO = resolve(process.env.PORTAL_REPO || DEFAULT_PORTAL_REPO)
const HTTP_DIR = join(PORTAL_REPO, 'app/portal/utils/http')

// --- 零依赖的推导器（与 tools/generate 的取向一致：纯 Node，不引 parser） ---

/** 花括号/圆括号配对，跳过字符串字面量 */
function matchPair (src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      depth--
      if (depth === 0) return i
    } else if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++
        i++
      }
    }
  }
  return -1
}

/** 顶层逗号切分 */
function splitTopLevel (src: string, start: number): string[] | null {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '{' || c === '[') depth++
    if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) {
        parts.push(current)
        return parts
      }
      depth--
    }
    if (c === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += c
  }
  return null
}

function walkFiles (dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walkFiles(path, out)
    else if (/\.(vue|js)$/.test(name)) out.push(path)
  }
  return out
}

type DerivedRule = {
  pagePath: string
  instance: string | null
  source: string
  /**
   * `instance === null` 时**必须**给出：追不动的诊断要能一路传到
   * `HttpInstanceResolutionError` 的 message 里，否则调用方只知道「拒绝」，
   * 不知道是哪个表达式、该怎么改。里面直接带 `http` 的原文，写表的人照抄即可。
   */
  reason?: string
}

/**
 * 从源码推导「一页的列表请求走哪个实例」。
 *
 * 覆盖的声明形式（每一种都对应一个真实踩过的坑）：
 * 1. 全局默认（`app/portal/main.js:42-48` 注入 platform.js）
 * 2. 简写属性 `useListPageModule({ http, ... })`
 * 3. 显式键 `http: httpCrm`，绑定可能带 `as` 别名
 * 4. import 路径**没写 `.js` 后缀**（`utils/http/sale`）
 * 5. 局部常量转发
 * 6. `useListPageModule` 本身从 `presets/<x>/list.js` import —— 调用点看不到 http
 */
function derivePageRules (repo: string): DerivedRule[] {
  const files = new Map<string, string>()
  for (const file of walkFiles(join(repo, 'app/portal'))) {
    const rel = relative(repo, file)
    if (!rel.startsWith('app/portal/views/')) continue
    files.set(rel, readFileSync(file, 'utf8'))
  }
  return derivePageRulesFrom(files)
}

const instRe = /utils\/http\/([\w-]+?)(?:\.js)?$/
const presetRe = /libs\/renren\/presets\/([\w-]+)\//

/**
 * iframe 嵌入的独立子应用。
 *
 * `app/portal/menus/product/breeders.js:9` 这类菜单项是
 * `iframeLinkGeneratorNormal(base_url + '/chicken-farm-saas/my-plan')`
 * （`app/portal/utils/menu.js:24-26`），permission 是 `/dashboard/frame/...`；
 * 被嵌进去的那套页面源码虽然也在 `app/portal/views/dashboard/product/` 下，
 * 但**它的文件路径不是 Portal 的页面路径**——Portal 侧能寻址的只有 `/dashboard/frame/...`。
 * 两边的映射需要单独推导，今天没有；所以这些声明不进表，由能力定义显式指定实例。
 */
const IFRAME_EMBEDDED_PREFIXES = ['app/portal/views/dashboard/product/']

/**
 * 判定「这个文件路径算不算一个可寻址的 Portal 页面路径」。
 *
 * 弹窗/子组件（`/components/`、`/actions/`）、composable、带路由参数（`[id]`）的路径
 * 都不是 SDK 能按 pagePath 寻址的单位。它们**确实**声明了别的实例——那正说明
 * 同一次页面操作里可能有多个实例，所以实例必须能逐请求指定，不能只当页面属性。
 * 这些声明连同 iframe 子应用一起记在 `src/context/README.md`，不进表。
 */
function isPageShapedPath (rel: string): boolean {
  if (IFRAME_EMBEDDED_PREFIXES.some((prefix) => rel.startsWith(prefix))) return false
  const rest = rel.replace(/^app\/portal\/views\//, '')
  if (/(^|\/)(components|actions|composables)\//.test(rest)) return false
  if (rest.includes('[')) return false
  return true
}

function derivePageRulesFrom (files: Map<string, string>): DerivedRule[] {

  function importsOf (src: string): Map<string, string> {
    const map = new Map<string, string>()
    for (const m of src.matchAll(/import\s*([\s\S]*?)\s*from\s*'([^']+)'/g)) {
      const clause = m[1] ?? ''
      const spec = m[2] ?? ''
      const named = clause.match(/\{([\s\S]*)\}/)
      if (!named) continue
      for (const raw of (named[1] ?? '').split(',')) {
        const alias = raw.trim().match(/^(\w+)\s+as\s+(\w+)$/)
        const local = alias ? alias[2] : raw.trim()
        if (local) map.set(local, spec)
      }
    }
    return map
  }

  function resolveExpr (src: string, expr: string, depth = 0): string | null {
    if (depth > 6) return null
    const name = expr.trim()
    const spec = importsOf(src).get(name)
    if (spec) {
      const inst = spec.match(instRe)
      if (inst && spec.includes('utils/http/')) return inst[1] ?? null
      const preset = spec.match(presetRe)
      if (preset) return preset[1] ?? null
      return null
    }
    const local = src.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*([^\\n;]+)`))
    if (!local) return null
    const rhs = (local[1] ?? '').trim()
    const direct = rhs.replace(/['"]/g, '').match(instRe)
    if (direct) return direct[1] ?? null
    if (/^[A-Za-z_$][\w$]*$/.test(rhs)) return resolveExpr(src, rhs, depth + 1)
    return null
  }

  const rules: DerivedRule[] = []
  for (const [rel, src] of files) {
    if (!src.includes('useListPageModule')) continue
    if (!isPageShapedPath(rel)) continue
    const pagePath = `/${rel.replace(/^app\/portal\/views\//, '').replace(/\.(vue|js)$/, '')}`

    for (const call of src.matchAll(/\b(useListPageModule|_useListPageModule)\s*\(/g)) {
      const open = (call.index ?? 0) + call[0].length - 1
      const close = matchPair(src, open)
      if (close === -1) continue
      const body = src.slice(open + 1, close).trim()
      if (!body.startsWith('{')) continue
      const parts = splitTopLevel(body, 1)
      if (!parts) continue
      const line = src.slice(0, call.index).split('\n').length

      // 声明形式 6：useListPageModule 本身从 preset import
      const selfSpec = importsOf(src).get(call[1] ?? '')
      const preset = selfSpec?.match(presetRe)
      if (selfSpec && preset && /\/list\.js$/.test(selfSpec)) {
        rules.push({ pagePath, instance: preset[1] ?? null, source: `${rel}:${line}` })
        continue
      }

      const props = new Map<string, string>()
      for (const raw of parts) {
        const part = raw.replace(/^\s*\/\/.*$/gm, '').trim()
        if (!part || part.startsWith('...')) continue
        const kv = part.match(/^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/)
        if (kv) {
          props.set(kv[1] ?? '', (kv[2] ?? '').trim())
          continue
        }
        const shorthand = part.match(/^([A-Za-z_$][\w$]*)$/)
        if (shorthand) props.set(shorthand[1] ?? '', shorthand[1] ?? '')
      }

      const http = props.get('http')
      // 声明形式 1：没有 http 属性 = 没覆盖全局默认（app/portal/main.js:42-48）
      if (http === undefined) continue

      const instance = resolveExpr(src, http)
      // 显式传默认实例：线上字节与不传一样，不必进表
      if (instance === 'platform') continue

      // `instance === null` 是**另一回事**，不能和上面并进同一条 continue：
      // 它表示「页面声明了实例，但推导追不动」。静默丢掉会让这个页面落回
      // global-default → platform，而那正是 `resolveHttpInstance` 的失败关闭
      // （`src/context/http-instance.ts` 的 `rule.instance === null` 分支）要防的事。
      // 所以必须进表、记成 null，并把 `http` 的原文作为 reason 一起交出去，
      // 让「拒绝发请求」这条路在运行时能说清是哪个表达式。
      rules.push({
        pagePath,
        instance,
        source: `${rel}:${line}`,
        ...(instance === null
          ? { reason: `http 的值是 \`${http}\`，静态追不到它的来源（不是 utils/http/*.js 也不是 presets/*）` }
          : {}),
      })
    }
  }
  return rules
}

/** 从源码推导实例画像里几个能被直接读出来的字段 */
function deriveProfileFacts (repo: string): Map<string, Record<string, unknown>> {
  const facts = new Map<string, Record<string, unknown>>()
  for (const name of readdirSync(join(repo, 'app/portal/utils/http'))) {
    if (!name.endsWith('.js')) continue
    const id = name.replace(/\.js$/, '')
    const src = readFileSync(join(repo, 'app/portal/utils/http', name), 'utf8')
    if (!src.includes('axios.create')) continue
    const env = src.match(/baseURL:\s*import\.meta\.env\.(\w+)/)
    const passthrough = src.match(/!config\.url\.startsWith\('([^']+)'\)\s*&&\s*!config\.url\.startsWith\('([^']+)'\)\s*&&\s*!config\.url\.startsWith\('([^']+)'\)/)
    const pageSizeRewrite = /config\.params\.pageSize/.test(src)
    // 只看两块区域：`axios.create({...})` 的实参（zhdj-app-lay.js:19-21 在这里设
    // Content-Type）与请求拦截器体。否则会把 `Modal.warning({ title: ..., okText: ... })`
    // 这种无关对象字面量也算成请求头（zhdj-app.js:76-80 真的这么踩过）
    function region (from: number): string {
      const open = src.indexOf('(', from)
      if (open === -1) return ''
      const close = matchPair(src, open)
      return close === -1 ? '' : src.slice(open, close)
    }
    const body = [
      region(src.indexOf('axios.create')),
      region(src.indexOf('interceptors.request.use')),
    ].join('\n')

    // 三种写法都要认：
    // `devicetype: 'PC'`（product.js:21，未加引号的键，写在拦截器的对象字面量里）
    // `'Content-Type': '...'`（zhdj-app-lay.js:20，加了引号的键，写在 axios.create 里）
    // `config.headers['Content-Type'] = '...'`（platform-mall-mes.js:16，无条件赋值式）
    //
    // **同一个头出现多次时取第一次**：`zhdj-app-lay.js:39` 会在某个条件下把
    // Content-Type 覆写成 JSON，那是条件性的，SDK 的条件开关机制只对 url 后缀有，
    // 没有对头开放。取默认值、把条件覆盖记成「已知未建模差异」（见 src/context/README.md）。
    const extraHeaders: Record<string, string> = {}
    const put = (key: string, value: string): void => {
      if (extraHeaders[key] === undefined) extraHeaders[key] = value
    }
    for (const m of body.matchAll(/^\s*['"]?(devicetype|[A-Z][\w-]*)['"]?:\s*'([^']+)',?$/gm)) {
      put(m[1] ?? '', m[2] ?? '')
    }
    for (const m of body.matchAll(/config\.headers\[['"]([^'"]+)['"]\]\s*=\s*'([^']+)'/g)) {
      put(m[1] ?? '', m[2] ?? '')
    }
    facts.set(id, {
      env: env?.[1] ?? null,
      passthrough: passthrough ? [passthrough[1], passthrough[2], passthrough[3]] : null,
      pageSizeRewrite,
      extraHeaders,
    })
  }
  return facts
}

const hasRepo = existsSync(HTTP_DIR)

describe.skipIf(!hasRepo)('对照 Portal 源码重新推导（PORTAL_REPO 存在时才有这一层）', () => {
  it('画像表覆盖源码里每一个 axios 实例（zhdj-cms 一个文件出两个实例）', () => {
    const facts = deriveProfileFacts(PORTAL_REPO)
    // in-flight-get.js is a shared request coalescing helper, not an axios instance.
    const sourceIds = new Set([...facts.keys()].filter(id => id !== 'in-flight-get').map((id) => (id === 'zhdj-cms' ? 'zhdj-cms' : id)))
    // 源码文件集合（去掉 zhdj-cms 只出现一次，但导出两个绑定）
    const expectedFiles = [...sourceIds].sort()
    const tableFiles = [...new Set(
      HTTP_INSTANCES.map((p) => p.source.match(/app\/portal\/utils\/http\/([\w-]+)\.js/)?.[1] ?? ''),
    )].sort()
    expect(tableFiles).toEqual(expectedFiles)

    // 且 zhdj-cms 的两个导出各占一条
    expect(HTTP_INSTANCES.filter((p) => p.source.includes('zhdj-cms.js')).map((p) => p.id).sort())
      .toEqual(['zhdj-cms', 'zhdj-cms-lay'])
  })

  it('baseURL env 与源码逐个一致', () => {
    const facts = deriveProfileFacts(PORTAL_REPO)
    for (const profile of HTTP_INSTANCES) {
      const file = profile.source.match(/app\/portal\/utils\/http\/([\w-]+)\.js/)?.[1]
      if (!file) continue
      const fact = facts.get(file)
      if (!fact) continue
      const expectedEnv = fact.env as string | null
      if (profile.baseUrl.kind === 'env') {
        expect(profile.baseUrl.env, profile.id).toBe(expectedEnv)
      } else {
        expect(expectedEnv, `${profile.id} 表里写 baseUrl.kind=none，源码却用了 env`).toBeNull()
      }
    }
  })

  it('补前缀规则的透传清单与源码一致', () => {
    const facts = deriveProfileFacts(PORTAL_REPO)
    const platformFact = facts.get('platform')
    expect(platformFact?.passthrough).toEqual(['/admin-api', '/adminmanage-api', '/mall-manage-api'])
    const platform = getHttpInstance('platform')
    expect(platform?.urlRewrite).toMatchObject({
      kind: 'prepend-absolute',
      passthrough: platformFact?.passthrough,
    })
  })

  it('「哪些实例改分页参数名」与源码一致', () => {
    const facts = deriveProfileFacts(PORTAL_REPO)
    const rewriteIds = [...facts.entries()].filter(([, f]) => f.pageSizeRewrite === true).map(([id]) => id)
    expect(rewriteIds).toEqual(['sale'])
    expect(HTTP_INSTANCES.filter((p) => p.pageSizeParamAlias !== null).map((p) => p.id)).toEqual(['sale'])
  })

  it('固定追加头与源码一致（product.js 的 devicetype: PC）', () => {
    const facts = deriveProfileFacts(PORTAL_REPO)
    for (const profile of HTTP_INSTANCES) {
      const file = profile.source.match(/app\/portal\/utils\/http\/([\w-]+)\.js/)?.[1]
      if (!file) continue
      const fact = facts.get(file)
      if (!fact) continue
      expect(profile.extraHeaders, profile.id).toEqual(fact.extraHeaders)
    }
  })

  it('页面规则表与源码推导逐条一致（数量、页面、实例）', () => {
    // 只比「页面 → 实例 → 出处文件」这三项。行号与 `reason` 是给人看的散文，
    // 比进来只会让每次改注释都变红。`reason` 的**存在性**另有断言钉住
    // （结构那组「null 条目必须带 reason」）。
    const shape = (rule: { pagePath: string; instance: string | null; source: string }) => ({
      pagePath: rule.pagePath,
      instance: rule.instance,
      source: rule.source.split(':')[0] ?? '',
    })
    const derived = derivePageRules(PORTAL_REPO)
    const actual = [...HTTP_INSTANCE_PAGE_RULES].map(shape).sort((a, b) => a.pagePath.localeCompare(b.pagePath))
    const expected = derived.map(shape).sort((a, b) => a.pagePath.localeCompare(b.pagePath))

    expect(actual.length).toBe(expected.length)
    expect(actual).toEqual(expected)
  })

  it('现网源码里「声明了但推导追不动」的页面：0 条（库存陈述，不是机制陈述）', () => {
    // 这条断言**单独看区分不了**「机制好用、今天没样本」和「机制根本没接上」——
    // 它曾经就是后者：推导器把 `instance === null` 和 `=== 'platform'` 并进同一条
    // continue，产不出 null，所以它永远绿。现在机制由文件末尾那组内联固件证明
    // （合成仓库 → 产出 instance: null → 解析成 unresolved → 错误信息指回源码），
    // 这条只负责把「今天的样本数」写下来：Portal 一旦多出这种页面，它和上面那条
    // 相等性断言会一起红，失败信息直接点名是哪一页。
    const derived = derivePageRules(PORTAL_REPO)
    expect(derived.filter((rule) => rule.instance === null)).toEqual([])
  })
})

/**
 * 推导器本身的自证 —— 没有 Portal 仓库时上面那一层会跳过，所以这里拿内联固件
 * 把**同一套 `derivePageRulesFrom`** 跑一遍。否则「跳过」就等于「没测」。
 */
describe('推导器（内联固件，不依赖 Portal 仓库）', () => {
  function page (file: string, body: string): [string, string] {
    return [`app/portal/views/${file}`, body.split('\n').map((line) => line.trim()).join('\n')]
  }

  const fixture = new Map<string, string>([
    // 声明形式 2：简写属性
    page('dashboard/sale/a/list.vue', `
      import { http } from 'app/portal/utils/http/sale.js'
      const rr = useListPageModule({ getDataListURL: '/x/page', http, getDataListIsPage: true })`),
    // 声明形式 3：显式键 + `as` 别名
    page('dashboard/sale/b/list.vue', `
      import { http as httpCrm } from 'app/portal/utils/http/crm.js'
      const rr = useListPageModule({ getDataListURL: '/x/page', http: httpCrm })`),
    // 声明形式 4：import 路径没写 .js
    page('dashboard/sale/c/list.vue', `
      import { http } from 'app/portal/utils/http/sale'
      const rr = useListPageModule({ getDataListURL: '/x/page', http })`),
    // 声明形式 6：useListPageModule 本身从 preset import，调用点看不到任何 http
    page('dashboard/education/d/index.vue', `
      import { useListPageModule } from 'common/libs/renren/presets/product/list.js'
      const rr = useListPageModule({ getDataListURL: '/x/page' })`),
    // 声明形式 5：先起个别名再转发
    page('dashboard/sale/e/list.vue', `
      import { http as saleHttp } from 'app/portal/utils/http/sale.js'
      const rr = useListPageModule({ getDataListURL: '/x/page', http: saleHttp })`),
    // 反例 1：没有 http 声明 → 全局默认，不该进表
    page('dashboard/hr/f/list.vue', `
      import { useListPageModule } from 'common/libs/renren/list.js'
      const rr = useListPageModule({ getDataListURL: '/x/page', pageSize: 'pageSize' })`),
    // 反例 2：显式传默认实例，线上字节与不传一样，不该进表
    page('dashboard/sale/g/list.vue', `
      import { http } from 'app/portal/utils/http/platform.js'
      const rr = useListPageModule({ getDataListURL: '/x/page', http })`),
    // 反例 3：弹窗组件声明了别的实例，但按 pagePath 寻址不到，不该进表
    page('dashboard/sale/h/components/select.vue', `
      import { http } from 'app/portal/utils/http/sale.js'
      const rr = useListPageModule({ getDataListURL: '/x/page', http })`),
  ])

  const derived = derivePageRulesFrom(fixture)

  it('简写属性、显式键 + as 别名、无扩展名 import、局部别名、preset 包装都认得出来', () => {
    expect(derived).toEqual([
      { pagePath: '/dashboard/sale/a/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/a/list.vue:3' },
      { pagePath: '/dashboard/sale/b/list', instance: 'crm', source: 'app/portal/views/dashboard/sale/b/list.vue:3' },
      { pagePath: '/dashboard/sale/c/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/c/list.vue:3' },
      { pagePath: '/dashboard/education/d/index', instance: 'product', source: 'app/portal/views/dashboard/education/d/index.vue:3' },
      { pagePath: '/dashboard/sale/e/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/e/list.vue:3' },
    ])
  })

  it('没有声明 / 显式传默认实例 / 弹窗组件 都不进表', () => {
    const pages = derived.map((rule) => rule.pagePath)
    expect(pages).not.toContain('/dashboard/hr/f/list')
    expect(pages).not.toContain('/dashboard/sale/g/list')
    expect(pages).not.toContain('/dashboard/sale/h/components/select')
  })
})

/**
 * 「推导追不动的声明」—— 这一组是**反证先行**做出来的。
 *
 * 修之前，推导器把 `instance === null`（追不动）和 `=== 'platform'`（显式传默认实例）
 * 并进了同一条 `continue`。后者有理由（线上字节相同，不必进表），前者没有：
 * 于是这类页面**根本不进表**，`resolveHttpInstance` 落回 `global-default` → `platform`，
 * 请求**静默**打到默认实例的 base 上——正是 `src/context/http-instance.ts` 文件头
 * 用失败关闭要防的那件事，而失败关闭那条分支因此永远收不到输入。
 *
 * 下面第一条断言在修之前是红的（推导结果为空数组），修完才绿。
 * 后两条一起说明「为什么必须进表」：写进表 → 运行时拒绝发请求；不写进表 → 静默走默认。
 */
describe('推导追不动的声明 → 进表成 null → 运行时拒绝猜', () => {
  function page (file: string, body: string): [string, string] {
    return [`app/portal/views/${file}`, body.split('\n').map((line) => line.trim()).join('\n')]
  }

  const fixture = new Map<string, string>([
    // 从 composable 解构出来：既没有叫 http 的 import，也没有 `const http = <可追的表达式>`
    page('dashboard/sale/x/list.vue', `
      import { useSaleList } from 'app/portal/views/dashboard/sale/x/composables/useSaleList.js'
      const { http } = useSaleList()
      const rr = useListPageModule({ getDataListURL: '/x/page', http })`),
    // 从 props / 外层作用域传进来
    page('dashboard/sale/y/list.vue', `
      import { useListPageModule } from 'common/libs/renren/list.js'
      const rr = useListPageModule({ getDataListURL: '/x/page', http: props.httpClient })`),
    // 对照组：同一个 fixture 里放一个能追动的，证明「产出 null」不是因为推导器整体失灵
    page('dashboard/sale/z/list.vue', `
      import { http } from 'app/portal/utils/http/sale.js'
      const rr = useListPageModule({ getDataListURL: '/x/page', http })`),
  ])

  const derived = derivePageRulesFrom(fixture)

  afterEach(() => {
    __setHttpInstancePageRulesForTest(null)
  })

  it('追不动的声明产出 instance: null，而不是被静默丢掉；能追到的照常', () => {
    const untrackable = derived.filter((rule) => rule.instance === null)
    // 逐条钉死：少了任何一条就说明这个页面的请求会静默打到默认实例的 base 上
    expect(untrackable).toEqual([
      {
        pagePath: '/dashboard/sale/x/list',
        instance: null,
        source: 'app/portal/views/dashboard/sale/x/list.vue:4',
        reason: 'http 的值是 `http`，静态追不到它的来源（不是 utils/http/*.js 也不是 presets/*）',
      },
      {
        pagePath: '/dashboard/sale/y/list',
        instance: null,
        source: 'app/portal/views/dashboard/sale/y/list.vue:3',
        reason: 'http 的值是 `props.httpClient`，静态追不到它的来源（不是 utils/http/*.js 也不是 presets/*）',
      },
    ])
    // 同一个 fixture 里能追到的那条不许被误判成 null
    expect(derived.filter((rule) => rule.instance !== null)).toEqual([
      { pagePath: '/dashboard/sale/z/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/z/list.vue:3' },
    ])
  })

  it('推导结果原样进表后，resolveHttpInstance 拒绝猜，且错误里能一路指回源码与本因', () => {
    // 直接拿推导产出去喂规则表 —— 中间没有人工补写，验的是端到端：
    // `http` 的原文 → 推导器的 reason → 表 → 运行时错误信息。
    __setHttpInstancePageRulesForTest(derived)

    const result = resolveHttpInstance({ pagePath: '/dashboard/sale/x/list' })
    expect(result).toMatchObject({
      kind: 'unresolved',
      reason: 'page-declares-unresolvable-instance',
    })
    if (result.kind === 'unresolved') {
      expect(result.detail).toContain('dashboard/sale/x/list.vue:4')
      expect(result.detail).toContain('静态追不到它的来源')
      expect(result.detail).toContain('显式指定 httpInstance')
    }
  })

  it('props 那条也一样拒绝，且认得出是 props.httpClient 而不是 http', () => {
    __setHttpInstancePageRulesForTest(derived)
    const result = resolveHttpInstance({ pagePath: '/dashboard/sale/y/list' })
    expect(result).toMatchObject({ kind: 'unresolved' })
    if (result.kind === 'unresolved') {
      expect(result.detail).toContain('`props.httpClient`')
    }
  })

  it('能追动的那一条照旧正常解析（证明上一条不是因为推导器整体失灵）', () => {
    __setHttpInstancePageRulesForTest(
      derived.map((rule) => ({ pagePath: rule.pagePath, instance: rule.instance, source: rule.source })),
    )
    expect(resolveHttpInstance({ pagePath: '/dashboard/sale/z/list' })).toMatchObject({
      kind: 'resolved',
      matchedBy: 'page-rule',
      instance: { id: 'sale' },
    })
  })

  it('对照：这条规则不进表时，同一页会静默落回全局默认 —— 也就是修之前的行为', () => {
    // 这条不是在给错行为背书，是把「推导器为什么不许静默 continue」钉成可执行的事实：
    // 规则缺席 = 运行时无从拒绝 = 请求打到 platform 的 base 上。
    __setHttpInstancePageRulesForTest([])

    expect(resolveHttpInstance({ pagePath: '/dashboard/sale/x/list' })).toMatchObject({
      kind: 'resolved',
      matchedBy: 'global-default',
      instance: { id: 'platform' },
    })
  })
})
