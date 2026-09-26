import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import {
  assertNoOnlySubmit,
  assertNoStatusParam,
  assertTemplateContent,
  buildTemplatePayload,
  buildTemplateUpdatePayload,
  CONTRACT_TEMPLATE_MODULE_TYPE,
  CONTRACT_TEMPLATE_PAGE_PATH,
  contractTemplateCapabilities,
  createContractTemplateCapability,
  EMPTY_TEMPLATE_CONTENT,
  SYSTEM_OPTIONS,
  type ContractTemplateDraft,
} from '../src/capabilities/contract-template.js'
import { createPortalHeadless } from '../src/index.js'

/**
 * 合同模板（`/dashboard/contract/template/list`）的回归测试。
 *
 * 分工与前面几条线一致：这份管«载荷构造、参数契约、与浏览器基准的逐字段一致性»；
 * 真实环境的读写验证在 `smoke/contract-template-crud.mjs`（它会真的建记录并清理）。
 *
 * 基准：`baseline/contract-template.browser.json`。
 * ⚠️ 其中第 2 / 3 / 6 条（按名称查、按类型查、PUT）**没抓到 headers** —— 基准里那个字段
 * 是 `null`，下面的表头断言**只对抓到 headers 的那几条生效**，不拿推断当实测。
 */

type BaselineRequest = {
  name: string
  能力: string
  method: string
  url: string
  headers: Record<string, string> | null
  body: string | null
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/contract-template.browser.json'), 'utf8'),
) as { requests: BaselineRequest[] }

const LIST = baseline.requests[0]!
const LIST_BY_NAME = baseline.requests[1]!
const LIST_BY_TYPE = baseline.requests[2]!
const GET = baseline.requests[3]!
const CREATE = baseline.requests[4]!
const UPDATE = baseline.requests[5]!
const REMOVE = baseline.requests[6]!

/** 取 path + query，并把一次性时间戳参数归一化 */
function normalizeUrl (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

/** 拆成有序的 [key, value] 列表：键顺序的差异也要能被发现（D20 逐字段一致） */
function queryPairs (rawUrl: string): Array<[string, string]> {
  const query = rawUrl.split('?')[1] ?? ''
  if (!query) return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    return [key, key === '_t' ? '<ts>' : value] as [string, string]
  })
}

/** axios 在到达 adapter 前已按 transformRequest 把 body 序列化成字符串 */
function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  if (typeof raw === 'string') return raw
  return JSON.stringify(raw)
}

function makeSdk (data: unknown = { list: [], total: 0 }) {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  const capability = createContractTemplateCapability((config) =>
    sdk.call(CONTRACT_TEMPLATE_PAGE_PATH, config),
  )
  return { sdk, calls, capability }
}

/**
 * 与写基准同一份填写值。**写死**而不是从基准里读：基准是「浏览器发出去的」，
 * 拿它反推载荷就等于用答案验答案。
 */
const DRAFT: ContractTemplateDraft = {
  typeId: 13,
  name: 'SDK-TEST-合同模板基准',
  useSystem: 0,
  content: EMPTY_TEMPLATE_CONTENT,
}

describe('合同模板列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选条件时的 URL：path 与 query 与基准完全相同（含键顺序）', async () => {
    const { capability, calls } = makeSdk()

    await capability.list()

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(LIST.url))
    expect(queryPairs(actual)).toEqual(queryPairs(LIST.url))
  })

  it('表单初值为 null 的 name / typeId 不发（qs 的 skipNulls）——浏览器在没填时也不发', async () => {
    const { capability, calls } = makeSdk()

    await capability.list()

    const url = String(calls[0]?.url)
    expect(url).not.toContain('name=')
    expect(url).not.toContain('typeId=')
  })

  it('order / orderField 两个空串一定要发 —— 少了就不与浏览器逐字段一致', async () => {
    const { capability, calls } = makeSdk()

    await capability.list()

    expect(queryPairs(String(calls[0]?.url))).toContainEqual(['order', ''])
    expect(queryPairs(String(calls[0]?.url))).toContainEqual(['orderField', ''])
  })

  it('按名称查询时的 URL 与基准一致（name 落在 orderField 之后、pageNo 之前）', async () => {
    const { capability, calls } = makeSdk()

    await capability.list({ name: 'SDK-TEST-合同模板' })

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(LIST_BY_NAME.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(LIST_BY_NAME.url))
  })

  it('按类型查询时的 URL 与基准一致（typeId 落在 name 与 pageNo 之间）', async () => {
    const { capability, calls } = makeSdk()

    await capability.list({ typeId: 13 })

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(LIST_BY_TYPE.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(LIST_BY_TYPE.url))
  })

  it('参数顺序由契约决定，不随调用方实参的书写顺序改变', async () => {
    const { capability, calls } = makeSdk()

    // 故意倒着写实参
    await capability.list({ pageSize: 20, typeId: 13, name: 'x', pageNo: 1 })

    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'name',
      'typeId',
      'pageNo',
      'pageSize',
      '_t',
    ])
  })

  it('方法、请求头与基准一致（module-type 由页面推导出 15 风险防控，浏览器在列表页发的也是 15）', async () => {
    const { capability, calls } = makeSdk()

    await capability.list()

    expect(String(calls[0]?.method).toUpperCase()).toBe(LIST.method)

    // axios 的 header bag 里会多带一个值为 undefined 的 `Content-Type` 槽位
    // （own key 里有，但不会真的发出去）。要比对的是**真正发出去的那一组**，所以走 toJSON()。
    const bag = calls[0]?.headers as unknown as {
      toJSON: () => Record<string, string>
      [key: string]: unknown
    }
    const sent: Record<string, string> = { ...bag.toJSON(), token: '<redacted>' }
    expect(LIST.headers).not.toBeNull()
    expect(sent).toEqual(LIST.headers)
    expect(sent['module-type']).toBe('15')
    for (const key of Object.keys(bag)) {
      if (key in sent) continue
      expect(bag[key], `多余的头 ${key} 有值，会真的发出去`).toBeUndefined()
    }
  })

  it('页面在规则表里算得出 module-type = 15 风险防控', () => {
    const { sdk } = makeSdk()
    const resolved = sdk.resolveModuleType(CONTRACT_TEMPLATE_PAGE_PATH)
    expect(resolved.moduleType).toBe(CONTRACT_TEMPLATE_MODULE_TYPE)
    expect(resolved.moduleType).toBe(15)
    expect(resolved.label).toBe('风险防控')
  })

  it('GET 请求没有 body', async () => {
    const { capability, calls } = makeSdk()
    await capability.list()
    expect(calls[0]?.data).toBeUndefined()
  })
})

describe('合同模板详情 —— GET /hr/contract-template/get', () => {
  it('URL 与基准一致，id 走查询参数、没有 body', async () => {
    const { capability, calls } = makeSdk({ id: 77, name: 'x' })

    await capability.get(77)

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(GET.url))
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
    expect(calls[0]?.data).toBeUndefined()
  })

  it('id 原样透传：number 与字符串都发得出去（query 上本来就都是字符串）', async () => {
    const { capability, calls } = makeSdk({ id: 77 })
    await capability.get(77)
    expect(queryPairs(String(calls[0]?.url))).toContainEqual(['id', '77'])

    const { capability: second, calls: secondCalls } = makeSdk({ id: 77 })
    await second.get('77')
    expect(queryPairs(String(secondCalls[0]?.url))).toContainEqual(['id', '77'])
  })

  it('「不把 id 归一成字符串」这件事**只在写请求体上可观测** —— GET/DELETE 的 query 上归一与不归一等价', () => {
    // 这一条是上一版反证留下的教训：把 `get` 里的 `params: { id }` 改成
    // `params: { id: String(id) }`（班次管理那条线的写法），46 条用例**全绿**。
    // 原因不是测试没写，而是那个变异**语义等价** —— query 参数序列化后都是字符串。
    // 真正可观测的差异在 **body** 里：`buildTemplateUpdatePayload` 把 id 原样塞进 JSON，
    // number 77 会序列化成 `"id":77`，String 化之后变成 `"id":"77"` —— 那才叫与浏览器不一致。
    // 下面那条用例锁的就是它。
    expect(JSON.stringify(buildTemplateUpdatePayload({ ...DRAFT, id: 77 }))).toContain('"id":77,')
    expect(JSON.stringify(buildTemplateUpdatePayload({ ...DRAFT, id: '77' }))).toContain('"id":"77",')
  })

  it('空 id 当场拒绝，一个请求都不发', async () => {
    const { capability, calls } = makeSdk()

    await expect(capability.get('  ')).rejects.toThrow(/id 不能为空/)
    expect(calls).toHaveLength(0)
  })
})

describe('status 不是这一页的参数：页面根本没有控件绑定它', () => {
  it('参数契约里没有 status —— 调用方看不见它，也就改不了它', () => {
    const definition = contractTemplateCapabilities.find((item) => item.id === 'contract-template-list')
    expect(definition?.params.map((param) => param.name)).toEqual(['name', 'typeId', 'pageNo', 'pageSize'])
  })

  it('硬传 status 会被拒，且一个请求都不发', async () => {
    const { capability, calls } = makeSdk()

    await expect(capability.list({ status: 1 } as never)).rejects.toThrow(/status/)
    expect(calls).toHaveLength(0)
  })

  it('assertNoStatusParam 只认 status 这一个键，不影响其它参数', () => {
    expect(() => assertNoStatusParam({ name: 'x' })).not.toThrow()
    expect(() => assertNoStatusParam({})).not.toThrow()
    expect(() => assertNoStatusParam(undefined)).not.toThrow()
    expect(() => assertNoStatusParam({ status: undefined })).toThrow(/status/)
    // 名字里含 status 的别的键不受影响
    expect(() => assertNoStatusParam({ statusText: 'x' })).not.toThrow()
  })
})

describe('合同模板新建 —— POST /hr/contract-template/create', () => {
  it('body 与浏览器基准**逐字节**相同（含键顺序与 startUserSelectAssignees:{}）', async () => {
    const { capability, calls } = makeSdk(1)

    await capability.create(DRAFT)

    expect(String(calls[0]?.method).toUpperCase()).toBe(CREATE.method)
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(CREATE.url))
    expect(rawBodyOf(calls[0])).toBe(CREATE.body)
  })

  it('onlySubmit 钉死成 1（「仅保存」），而不是页面的「保存并提交」的 0', async () => {
    const { capability, calls } = makeSdk(1)

    await capability.create(DRAFT)

    expect(JSON.parse(rawBodyOf(calls[0])).onlySubmit).toBe(1)
  })

  it('content 是 JSON 字符串而不是对象（后端字段是 String）', async () => {
    const { capability, calls } = makeSdk(1)

    await capability.create(DRAFT)

    const body = JSON.parse(rawBodyOf(calls[0]))
    expect(typeof body.content).toBe('string')
    expect(JSON.parse(body.content)).toEqual({ version: '1.0.0', blocks: [] })
  })

  it('页面那条默认内容 EMPTY_TEMPLATE_CONTENT 就是基准里发出去的那个串', () => {
    expect(EMPTY_TEMPLATE_CONTENT).toBe('{"version":"1.0.0","blocks":[]}')
    // 基准里的 body 里嵌着它（转义后）
    expect(CREATE.body).toContain('\\"version\\":\\"1.0.0\\",\\"blocks\\":[]')
  })
})

describe('onlySubmit 只能是 1（写链路只走页面的「仅保存」）', () => {
  it('传 onlySubmit: 0 会被拒，且一个请求都不发', async () => {
    const { capability, calls } = makeSdk(1)

    await expect(
      capability.create({ ...DRAFT, onlySubmit: 0 } as never),
    ).rejects.toThrow(/onlySubmit/)
    expect(calls).toHaveLength(0)
  })

  it('update 上同样拒（两条写链路都只走「仅保存」）', async () => {
    const { capability, calls } = makeSdk(1)

    await expect(
      capability.update({ ...DRAFT, id: 77, onlySubmit: 0 } as never),
    ).rejects.toThrow(/onlySubmit/)
    expect(calls).toHaveLength(0)
  })

  it('传 onlySubmit: 1 是**放行**的 —— 守卫会走两遍，不能写成"存在即拒"', async () => {
    const { capability, calls } = makeSdk(1)

    // 这一条锁的是一个真实踩过的坑：门面的 createIdempotent 是
    // `send: (_params, { payload }) => create(payload)`，送回来的正是
    // buildTemplatePayload() 的产物，它本来就带 onlySubmit: 1。
    // 早先写成"存在即拒"时冒烟第一步就被自己的载荷绊倒。
    await capability.create({ ...DRAFT, onlySubmit: 1 } as never)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(rawBodyOf(calls[0])).onlySubmit).toBe(1)
  })

  it('assertNoOnlySubmit 对 undefined / 正常载荷 / 自己的产物都不误报', () => {
    expect(() => assertNoOnlySubmit(undefined)).not.toThrow()
    expect(() => assertNoOnlySubmit(DRAFT)).not.toThrow()
    expect(() => assertNoOnlySubmit(buildTemplatePayload(DRAFT))).not.toThrow()
    expect(() => assertNoOnlySubmit({ onlySubmit: 0 })).toThrow(/onlySubmit/)
    expect(() => assertNoOnlySubmit({ onlySubmit: null })).toThrow(/onlySubmit/)
  })

  it('startUserSelectAssignees 传什么都进不了 body —— 那个 `{}` 是常量，不是从载荷读的', async () => {
    const { capability, calls } = makeSdk(1)

    await capability.create({ ...DRAFT, startUserSelectAssignees: { u1: ['7'] } } as never)

    const body = JSON.parse(rawBodyOf(calls[0]))
    expect(body.startUserSelectAssignees).toEqual({})
  })
})

describe('合同模板修改 —— PUT /hr/contract-template/update', () => {
  it('body 与浏览器基准**逐字节**相同（id 在首位）', async () => {
    const { capability, calls } = makeSdk(true)

    await capability.update({ ...DRAFT, id: 77, name: 'SDK-TEST-模板乙版' })

    expect(String(calls[0]?.method).toUpperCase()).toBe(UPDATE.method)
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(UPDATE.url))
    expect(rawBodyOf(calls[0])).toBe(UPDATE.body)
  })

  it('id 排第一个键 —— 页面的 buildSubmitPayload 把 bridge 里的 id 展开在最前', () => {
    const payload = buildTemplateUpdatePayload({ ...DRAFT, id: 77 })
    expect(Object.keys(payload)[0]).toBe('id')
  })

  it('PUT 有 body，且与 create 的差异**只有**多出来的 id', () => {
    const create = buildTemplatePayload(DRAFT)
    const update = buildTemplateUpdatePayload({ ...DRAFT, id: 77 })
    const { id: _id, ...rest } = update
    expect(rest).toEqual(create)
  })
})

describe('合同模板删除 —— DELETE /hr/contract-template/delete', () => {
  it('URL 与基准一致：id 走查询参数、**没有请求体**', async () => {
    const { capability, calls } = makeSdk(true)

    await capability.remove(77)

    expect(String(calls[0]?.method).toUpperCase()).toBe(REMOVE.method)
    // path 与基准一致（`?` 之前那一段）
    expect(normalizeUrl(String(calls[0]?.url)).split('?')[0]).toBe(normalizeUrl(REMOVE.url).split('?')[0])
    // ⚠️ DELETE 的 params **不在 `config.url` 里**：`src/http/client.ts:169-180` 那条
    // 「qs 拼进 URL」只对 GET 生效，其余方法交给 axios 自己的序列化器，后者是在
    // adapter 之后才拼的。所以这里查 `config.params`，而不是查 URL 的 query
    //（GET 那几条走的是另一条路，URL 里本来就有）。
    expect(calls[0]?.params).toEqual({ id: 77 })
    expect(calls[0]?.data).toBeUndefined()
  })

  it('DELETE 不追加 `_t` 防缓存参数（那是 GET 专有）—— 与基准一致', async () => {
    const { capability, calls } = makeSdk(true)

    await capability.remove(77)

    expect(queryPairs(REMOVE.url)).toEqual([['id', '77']])
    expect(String(calls[0]?.url)).not.toContain('_t=')
    expect(Object.keys((calls[0]?.params as object) ?? {})).toEqual(['id'])
  })

  it('空 id 当场拒绝，一个请求都不发', async () => {
    const { capability, calls } = makeSdk()

    await expect(capability.remove('')).rejects.toThrow(/id 不能为空/)
    expect(calls).toHaveLength(0)
  })
})

describe('content 的本地校验只做后端无条件强制的那一层', () => {
  it('非空、合法 JSON、根是对象、version 非空字符串、blocks 是数组 —— 全过', () => {
    expect(() => assertTemplateContent(EMPTY_TEMPLATE_CONTENT)).not.toThrow()
    expect(() => assertTemplateContent('{"version":"1.1.0","blocks":[]}')).not.toThrow()
  })

  it('空串 / 纯空白被拒（后端：「模板内容不能为空」）', () => {
    expect(() => assertTemplateContent('')).toThrow(/content/)
    expect(() => assertTemplateContent('   ')).toThrow(/content/)
    expect(() => assertTemplateContent(undefined)).toThrow(/content/)
  })

  it('不是 JSON 被拒（后端：「JSON 格式不正确」）', () => {
    expect(() => assertTemplateContent('not json')).toThrow(/JSON/)
  })

  it('根不是对象被拒（后端：「根节点必须是对象」）', () => {
    expect(() => assertTemplateContent('[1,2]')).toThrow(/根节点/)
    expect(() => assertTemplateContent('"x"')).toThrow(/根节点/)
    expect(() => assertTemplateContent('null')).toThrow(/根节点/)
  })

  it('缺 version / blocks 被拒', () => {
    expect(() => assertTemplateContent('{"blocks":[]}')).toThrow(/version/)
    expect(() => assertTemplateContent('{"version":"","blocks":[]}')).toThrow(/version/)
    expect(() => assertTemplateContent('{"version":"1.0.0"}')).toThrow(/blocks/)
    expect(() => assertTemplateContent('{"version":"1.0.0","blocks":{}}')).toThrow(/blocks/)
  })

  it('**更深的业务规则不复刻**：封面/自动目录/签署信息那套跨字段约束交给后端', () => {
    // 一个「封面不在首位」的配置在本地是**放行**的 —— 后端 ContractContentValidator 会拒，
    // 但那是它的规则、它会随版本漂移，SDK 复刻一份只会两边各自跑偏。
    const tricky = JSON.stringify({
      version: '1.1.0',
      blocks: [{ id: 'h', name: 'Common/Heading', data: { level: 9, content: 'x' } }],
    })
    expect(() => assertTemplateContent(tricky)).not.toThrow()
  })

  it('写链路上同样挡得住：content 坏了就不发请求', async () => {
    const { capability, calls } = makeSdk(1)

    await expect(capability.create({ ...DRAFT, content: 'nope' })).rejects.toThrow(/JSON/)
    expect(calls).toHaveLength(0)
  })
})

describe('新建 / 修改的表单必填（页面规则 required，后端不校验）', () => {
  it('name 为空被拒', async () => {
    const { capability, calls } = makeSdk(1)
    await expect(capability.create({ ...DRAFT, name: '  ' })).rejects.toThrow(/名称必填/)
    expect(calls).toHaveLength(0)
  })

  it('typeId 为空被拒', async () => {
    const { capability, calls } = makeSdk(1)
    await expect(capability.create({ ...DRAFT, typeId: '' })).rejects.toThrow(/typeId 必填/)
    expect(calls).toHaveLength(0)
  })

  it('useSystem 为 null 被拒', async () => {
    const { capability, calls } = makeSdk(1)
    await expect(capability.create({ ...DRAFT, useSystem: null as never })).rejects.toThrow(/useSystem 必填/)
    expect(calls).toHaveLength(0)
  })

  it('useSystem = 0（公共）是**合法值**，不是「没填」', async () => {
    const { capability, calls } = makeSdk(1)
    await capability.create({ ...DRAFT, useSystem: 0 })
    expect(JSON.parse(rawBodyOf(calls[0])).useSystem).toBe(0)
  })
})

describe('能力定义（给目录 / 别名 / invoke 用）', () => {
  it('五个能力，id 与 write 标记都对', () => {
    expect(contractTemplateCapabilities.map((item) => [item.id, item.write])).toEqual([
      ['contract-template-list', false],
      ['contract-template-get', false],
      ['contract-template-create', true],
      ['contract-template-update', true],
      ['contract-template-remove', true],
    ])
  })

  it('全部绑定同一个页面路径与权限码', () => {
    for (const item of contractTemplateCapabilities) {
      expect(item.pagePath).toBe(CONTRACT_TEMPLATE_PAGE_PATH)
      expect(item.permission).toBe('/dashboard/contract/template')
    }
  })

  it('没有把「保存并提交」暴露成参数，也没有 status', () => {
    const names = contractTemplateCapabilities.flatMap((item) => item.params.map((p) => p.name))
    expect(names).not.toContain('onlySubmit')
    expect(names).not.toContain('status')
    expect(names).not.toContain('startUserSelectAssignees')
  })

  it('useSystem 的候选就是页面那个下拉（SYSTEM_OPTIONS_ALL）', () => {
    const param = contractTemplateCapabilities
      .find((item) => item.id === 'contract-template-create')
      ?.params.find((p) => p.name === 'useSystem')
    expect(param?.kind).toBe('enum')
    expect(param?.options).toEqual(SYSTEM_OPTIONS.map((item) => ({ label: item.label, value: item.value })))
    expect(SYSTEM_OPTIONS.find((item) => item.value === 0)?.label).toBe('公共')
  })

  it('typeId 声明成 tree（页面上是树选择器），但**不给 lookup**：候选来自通用字典接口，不属于本页', () => {
    const param = contractTemplateCapabilities
      .find((item) => item.id === 'contract-template-create')
      ?.params.find((p) => p.name === 'typeId')
    expect(param?.kind).toBe('tree')
    expect(param?.lookup).toBeUndefined()
  })
})
