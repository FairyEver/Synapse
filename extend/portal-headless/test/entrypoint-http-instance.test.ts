/**
 * `describe()` 的入口是否带上了「这页走哪个 http 实例」。
 *
 * 这一层是**接线**，不是解析本身——解析的推导与画像在 `test/http-instances.test.ts`。
 * 这里只回答一个问题：`resolveHttpInstance` 真的接到 `entryPoints` 上了吗？
 *
 * 为什么值得单独钉：`module-type` 算不出时是「不发这个头」（忠实，D34），
 * 而实例算不出时是「打到错的 URL」——**静默且难查**。接线断了不会有任何症状，
 * 只会在某个非默认实例的页面上打出一条 404，或者一个字段不同的 200。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createCatalog } from '../src/index.js'
import {
  __setHttpInstancePageRulesForTest,
  type HttpInstancePageRule,
} from '../src/context/http-instance.js'
import type { CapabilityDefinition } from '../src/capabilities/types.js'

const PROBE_PAGE = '/dashboard/meeting-room/list'

function probe (overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'probe-capability',
    title: '探针能力',
    pagePath: PROBE_PAGE,
    write: false,
    params: [{ name: 'pageNo', kind: 'number', required: false }],
    ...overrides,
  }
}

function entry (capability: CapabilityDefinition) {
  const result = createCatalog({ capabilities: [capability] }).describe('probe-capability')
  if (!result.ok) throw new Error(`探针能力没有被注册：${result.reason}`)
  const [first] = result.howToCall.entryPoints
  if (first === undefined) throw new Error('入口为空')
  return first
}

function rule (instance: string | null): HttpInstancePageRule {
  return { pagePath: PROBE_PAGE, instance, source: 'test/entrypoint-http-instance.test.ts' }
}

afterEach(() => {
  __setHttpInstancePageRulesForTest(null)
})

describe('entryPoints[].httpInstance —— 入口必须说清它走哪个实例', () => {
  it('页面没有声明时走全局默认，并给出调用方要配的 env 键', () => {
    const { httpInstance } = entry(probe())
    expect(httpInstance).toEqual({
      kind: 'resolved',
      id: 'platform',
      matchedBy: 'global-default',
      // 这就是调用方要写进 `httpBaseUrls` 的键，写错了就没有 baseURL 可用
      baseUrlEnv: 'VITE_ZHDJ_PLATFORM_API',
    })
  })

  it('页面规则命中时 matchedBy 是 page-rule，且带上那个实例自己的 env 键', () => {
    __setHttpInstancePageRulesForTest([rule('sale')])
    const { httpInstance } = entry(probe())
    expect(httpInstance).toEqual({
      kind: 'resolved',
      id: 'sale',
      matchedBy: 'page-rule',
      baseUrlEnv: 'VITE_SHOP_ADMIN_API',
    })
  })

  it('能力定义里钉死的实例优先于页面规则表', () => {
    // iframe 内嵌的独立子应用只能靠这条路径——它的源码路径不在页面清单里，规则表推不出来
    __setHttpInstancePageRulesForTest([rule('sale')])
    const { httpInstance } = entry(probe({ httpInstance: 'crm' }))
    expect(httpInstance.kind).toBe('resolved')
    expect(httpInstance).toMatchObject({ id: 'crm', matchedBy: 'declared' })
  })

  it('推导不出来时如实标 unresolved，不假装成 resolved', () => {
    __setHttpInstancePageRulesForTest([rule(null)])
    const { httpInstance } = entry(probe())
    expect(httpInstance.kind).toBe('unresolved')
    if (httpInstance.kind !== 'unresolved') return
    // 调用方要能从这条说明里知道「下一步该做什么」，不能只说"不知道"
    expect(httpInstance.detail).toContain('必须由调用方显式指定')
    expect(httpInstance.reason).toBe('page-declares-unresolvable-instance')
  })

  it('同一能力在多个页面各有定义时，按**这一页**那份的定义解析', () => {
    const catalog = createCatalog({
      capabilities: [
        probe({ pagePath: '/dashboard/a/list' }),
        probe({ pagePath: '/dashboard/b/list', httpInstance: 'crm' }),
      ],
    })
    const result = catalog.describe('probe-capability')
    if (!result.ok) throw new Error(result.reason)
    const byPage = new Map(
      result.howToCall.entryPoints.map((point) => [point.pagePath, point.httpInstance]),
    )
    expect(byPage.get('/dashboard/a/list')).toMatchObject({
      kind: 'resolved',
      id: 'platform',
    })
    expect(byPage.get('/dashboard/b/list')).toMatchObject({ kind: 'resolved', id: 'crm' })
  })
})

/**
 * 一条**跨模块格式契约**。
 *
 * `tools/eval/consumer-view.mjs` 的 `listRegisteredCapabilityIds()` 靠
 * 「`：` 与末尾 `）` 之间的那段」从 describe 的失败回执里取已注册能力清单——
 * 这是它拿到"能力白名单"的唯一途径（用来判模型有没有编造能力）。
 *
 * 那个解析是字符串切分，**改动这里的措辞会让它静默返回垃圾 ID**，而不是报错。
 * 所以把格式钉在这儿：谁要改措辞，先让这条红。
 */
describe('describe 失败回执的格式（tools/eval/consumer-view.mjs 依赖）', () => {
  it('已注册能力清单仍然在「：」与末尾「）」之间，且按「、」分隔', () => {
    const result = createCatalog({
      capabilities: [probe({ id: 'alpha-cap' }), probe({ id: 'beta-cap' })],
    }).describe('__probe_不存在的能力__')

    expect(result.ok).toBe(false)
    if (result.ok) return

    // 与 consumer-view 的解析逐字一致
    const reason = result.reason
    const inner = reason.slice(reason.indexOf('：') + 1, reason.lastIndexOf('）'))
    const parsed = inner
      .split('、')
      .map((item) => item.trim())
      .filter(Boolean)

    expect(parsed).toEqual(['alpha-cap', 'beta-cap'])
  })
})
