import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import {
  buildCreateTimeRange,
  createPortalHeadless,
  createRequestId,
  resolveModuleType,
  ASSIGNMENT_MODULE_TYPE,
  ASSIGNMENT_PAGE_PATH,
  CapabilityInvokeError,
  type AssignmentDraft,
} from '../src/index.js'

/**
 * 作业管理（`/dashboard/assignment/assignment/list`）—— 第一条**换域 + 普通 CRUD** 的线。
 *
 * 三份基准（都是 bsk 抓的真实浏览器请求，token 在页面内脱敏）：
 * - `baseline/assignment-list.browser.json`        列表查询（筛选条件全空）
 * - `baseline/assignment-list-daterange.browser.json` 列表查询（带创建时间区间）
 * - `baseline/assignment-write.browser.json`       写链路四条（create / get / set-status / remove）
 *
 * 分工与会议室那条线一致：这份管«载荷构造、业务规则、与浏览器基准的逐字段一致性»。
 */

type BaselineRequest = {
  能力: string
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

type ReadBaseline = {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

type WriteBaseline = { 请求: BaselineRequest[] }

const here = dirname(fileURLToPath(import.meta.url))
const read = (name: string): unknown =>
  JSON.parse(readFileSync(join(here, `../baseline/${name}`), 'utf8'))

const listBaseline = read('assignment-list.browser.json') as ReadBaseline
const rangeBaseline = read('assignment-list-daterange.browser.json') as ReadBaseline
const writeBaseline = read('assignment-write.browser.json') as WriteBaseline

const requestOf = (capability: string): BaselineRequest => {
  const found = writeBaseline.请求.find((item) => item.能力 === capability)
  if (!found) throw new Error(`基准里没有 ${capability}`)
  return found
}

/** 去掉主机与一次性时间戳，只留 path + query */
function normalizeUrl (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

/** 拆成有序的 [key, value] 列表，键顺序不同也算不一致 */
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

function capture (data: unknown = { list: [], total: 0 }) {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  return { sdk, calls }
}

/** axios 在到达 adapter 前已按 transformRequest 把 body 序列化成字符串 */
function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return JSON.stringify(raw)
  return JSON.stringify(raw)
}

/**
 * 与写基准同一份表单填写值。**写死**而不是从基准里读：基准是「浏览器发出去的」，
 * 这里是「SDK 发出去的」，两边各自独立取值才叫对照。
 */
const draft: AssignmentDraft = {
  title: 'SDK-TEST-作业管理-写基准',
  demand: 'SDK-TEST 浏览器写基准，可删除',
  type: 4,
  endTime: '2026-09-30 21:19:10',
}

// ---------------------------------------------------------------------------
// 读链路：与浏览器基准逐字段一致
// ---------------------------------------------------------------------------

describe('作业列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('筛选条件全空时，path / query 与基准完全相同（含键顺序与那些空值参数）', async () => {
    const { sdk, calls } = capture()

    await sdk.assignment.list()

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(listBaseline.url))
    expect(queryPairs(actual)).toEqual(queryPairs(listBaseline.url))
    // 浏览器三个筛选条件一个都没填，仍然把 order/orderField/title/status/type/
    // createTimeStart/createTimeEnd 以空串发出去——少发就不逐字段一致了
    expect(queryPairs(actual).map(([key]) => key)).toEqual([
      'order', 'orderField', 'title', 'status', 'type',
      'createTimeStart', 'createTimeEnd', 'pageNo', 'pageSize', '_t',
    ])
  })

  it('方法一致；GET 没有 body', async () => {
    const { sdk, calls } = capture()
    await sdk.assignment.list()
    expect(String(calls[0]?.method).toUpperCase()).toBe(listBaseline.method.toUpperCase())
    expect(listBaseline.body).toBeNull()
    expect(calls[0]?.data).toBeUndefined()
  })

  it('module-type = 12 与浏览器一致（该页面在规则表里算得出值，与会议室那条线相反）', async () => {
    const { sdk, calls } = capture()
    await sdk.assignment.list()

    const actual = calls[0]?.headers as unknown as Record<string, string>
    expect(actual['module-type']).toBe(String(ASSIGNMENT_MODULE_TYPE))
    expect(actual['module-type']).toBe(listBaseline.headers['module-type'])
    expect(actual['tenant-id']).toBe(listBaseline.headers['tenant-id'])
    expect(actual['Accept-Language']).toBe(listBaseline.headers['Accept-Language'])
  })

  it('浏览器发的头一个不少、值一致；SDK 多出来的只有 Content-Type（既有差异，不是本页引入的）', async () => {
    const { sdk, calls } = capture()
    await sdk.assignment.list()

    const actual = calls[0]?.headers as unknown as Record<string, string>
    const expected = listBaseline.headers

    // 浏览器发的每一个头 SDK 都要发，值一致（token 在基准里已脱敏，只比存在性）
    for (const [name, value] of Object.entries(expected)) {
      expect(actual, `少了请求头 ${name}`).toHaveProperty(name)
      if (name === 'token') continue
      expect(actual[name], `请求头 ${name} 的值不一致`).toBe(value)
    }

    // 反向：**一个都不多**。这里锁的只是 adapter 收到的 header bag。
    //
    // 曾经 bag 里会多一个值为 `undefined` 的 `Content-Type` 槽位。那**不是"多发了一个头"**
    // （真发到本机 HTTP 服务器看 rawHeaders，GET 线路上从来没有 Content-Type，与浏览器一致），
    // 但它有真实副作用：`src/http/client.ts` 把 axios 已合并的 bag 展开在最后，
    // 那个空槽会**盖掉实例画像 `extraHeaders` 声明的同名头**。
    // `client.ts` 现已在展开前滤掉空槽，所以这里不再有多余槽位——
    // 线路层的证据见 `test/http-wire-headers.test.ts`。
    const extra = Object.keys(actual).filter((name) => !(name in expected))
    expect(extra).toEqual([])
  })

  it('带创建时间区间时与「另一份」基准逐字段一致（区间那一段是这次换域的新东西）', async () => {
    const { sdk, calls } = capture()
    const range = buildCreateTimeRange('2026-09-01', '2026-09-05')

    await sdk.assignment.list({ ...range })

    const actual = String(calls[0]?.url)
    expect(queryPairs(actual)).toEqual(queryPairs(rangeBaseline.url))
    expect(normalizeUrl(actual)).toBe(normalizeUrl(rangeBaseline.url))
  })
})

describe('创建时间区间：结束日是开区间（页面 convertFetchForm 的 +1 天）', () => {
  it('选 2026-09-01 ~ 2026-09-05 生成的是 09-01 00:00:00 ~ 09-06 00:00:00', () => {
    expect(buildCreateTimeRange('2026-09-01', '2026-09-05')).toEqual({
      createTimeStart: '2026-09-01 00:00:00',
      createTimeEnd: '2026-09-06 00:00:00',
    })
  })

  it('同一天：结束是次日 00:00:00（覆盖当天一整天，而不是空区间）', () => {
    expect(buildCreateTimeRange('2026-09-05', '2026-09-05')).toEqual({
      createTimeStart: '2026-09-05 00:00:00',
      createTimeEnd: '2026-09-06 00:00:00',
    })
  })

  it('跨月、跨年由 Date 自己进位', () => {
    expect(buildCreateTimeRange('2026-09-30', '2026-09-30').createTimeEnd).toBe('2026-10-01 00:00:00')
    expect(buildCreateTimeRange('2026-12-31', '2026-12-31').createTimeEnd).toBe('2027-01-01 00:00:00')
  })

  it('带时间的输入被截到当天 00:00:00（页面用的是 startOf("date")）', () => {
    expect(buildCreateTimeRange('2026-09-01 18:30:00', '2026-09-05 07:00:00')).toEqual({
      createTimeStart: '2026-09-01 00:00:00',
      createTimeEnd: '2026-09-06 00:00:00',
    })
  })

  it('结束日早于开始日会被拒绝（不是静默生成一个空区间）', () => {
    expect(() => buildCreateTimeRange('2026-09-05', '2026-09-01')).toThrow(/不早于/)
  })
})

describe('module-type 推导', () => {
  it('resolveModuleType 对本页给出 12（学习管理）', () => {
    const resolution = resolveModuleType(ASSIGNMENT_PAGE_PATH)
    expect(resolution.moduleType).toBe(ASSIGNMENT_MODULE_TYPE)
    expect(resolution.label).toBe('学习管理')
    expect(resolution.matchedBy).toBe('rule')
  })

  it('详情/编辑/新建这类路径归并回列表页后同样算得出（与浏览器一致）', () => {
    expect(resolveModuleType('/dashboard/assignment/assignment/create/new').moduleType).toBe(12)
    expect(resolveModuleType('/dashboard/assignment/assignment/edit/1072').moduleType).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// 写链路：载荷与业务规则
// ---------------------------------------------------------------------------

describe('新建作业的载荷 —— 与浏览器基准逐字节一致', () => {
  it('写死的表单填写值与基准里记的值一致（两边不会各自漂移）', () => {
    const baselineDraft = JSON.parse(requestOf('assignment-create').body ?? '{}') as Record<string, unknown>
    expect(draft).toEqual({
      title: baselineDraft.title,
      demand: baselineDraft.demand,
      type: baselineDraft.type,
      endTime: baselineDraft.endTime,
    })
  })

  it('URL / 方法 / body 与基准逐字段一致，且键顺序相同', async () => {
    const { sdk, calls } = capture(1073)
    const baseline = requestOf('assignment-create')

    await sdk.assignment.create(draft)

    expect(String(calls[0]?.method).toUpperCase()).toBe(baseline.method)
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(baseline.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual([])

    const actual = rawBodyOf(calls[0])
    expect(JSON.parse(actual)).toEqual(JSON.parse(baseline.body ?? '{}'))
    // 键顺序也要一致：D20 的「逐字段」包含这个
    expect(actual).toBe(baseline.body)
  })

  it('请求头与基准同一个集合', async () => {
    const { sdk, calls } = capture(1073)
    const baseline = requestOf('assignment-create')

    await sdk.assignment.create(draft)

    const actual = calls[0]?.headers as unknown as Record<string, string>
    expect(actual['tenant-id']).toBe(baseline.headers['tenant-id'])
    expect(actual['module-type']).toBe(baseline.headers['module-type'])
    expect(actual['Accept-Language']).toBe(baseline.headers['Accept-Language'])
    expect(String(actual['Content-Type'] ?? actual['content-type'])).toContain('application/json')
    expect(Object.keys(actual).sort()).toEqual(Object.keys(baseline.headers).sort())
  })

  it('创建态不发 id（基准里也没有这个键）', async () => {
    const { sdk, calls } = capture(1073)
    await sdk.assignment.create(draft)
    const body = JSON.parse(rawBodyOf(calls[0])) as Record<string, unknown>
    expect(body).not.toHaveProperty('id')
    expect(Object.keys(body)[0]).toBe('title')
  })
})

describe('新建/修改的本地校验（只强制页面无条件要求的那四条）', () => {
  const base = draft

  it('作业名称必填且 ≤30 字', async () => {
    const { sdk, calls } = capture()
    await expect(sdk.assignment.create({ ...base, title: '' })).rejects.toThrow(/作业名称/)
    await expect(sdk.assignment.create({ ...base, title: 'x'.repeat(31) })).rejects.toThrow(/作业名称/)
    expect(calls).toHaveLength(0)
  })

  it('作业要求必填且 ≤200 字', async () => {
    const { sdk, calls } = capture()
    await expect(sdk.assignment.create({ ...base, demand: '' })).rejects.toThrow(/作业要求/)
    await expect(sdk.assignment.create({ ...base, demand: 'x'.repeat(201) })).rejects.toThrow(/作业要求/)
    expect(calls).toHaveLength(0)
  })

  it('作业类型与截止时间必填', async () => {
    const { sdk, calls } = capture()
    await expect(
      sdk.assignment.create({ ...base, type: '' as unknown as number }),
    ).rejects.toThrow(/作业类型/)
    await expect(sdk.assignment.create({ ...base, endTime: '' })).rejects.toThrow(/截止时间/)
    expect(calls).toHaveLength(0)
  })

  it('日期格式必须是 YYYY-MM-DD HH:mm:ss（写错了当场报，不要发到后端才炸）', async () => {
    const { sdk, calls } = capture()
    await expect(
      sdk.assignment.create({ ...base, endTime: '2026/09/30 21:19' }),
    ).rejects.toThrow(/YYYY-MM-DD HH:mm:ss/)
    expect(calls).toHaveLength(0)
  })

  it('条件必填**不强制**：页面要求 isUploadAnswer=1 时必须给答案类型，SDK 不代拦（那是前端表单规则）', async () => {
    const { sdk, calls } = capture(1074)
    await sdk.assignment.create({ ...base, isUploadAnswer: 1 })
    expect(calls).toHaveLength(1)
  })
})

describe('修改作业：整单替换 + 字符串 id', () => {
  it('载荷 = 创建载荷 + id（id 追加在最后，与页面把 record 铺回表单后的形状一致）', async () => {
    const { sdk, calls } = capture()
    await sdk.assignment.update({ ...draft, id: 1072 })

    const body = JSON.parse(rawBodyOf(calls[0])) as Record<string, unknown>
    expect(body.id).toBe('1072')
    expect(Object.keys(body)[Object.keys(body).length - 1]).toBe('id')
    expect(String(calls[0]?.method).toUpperCase()).toBe('PUT')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(
      normalizeUrl(requestOf('assignment-set-status').url),
    )
  })

  it('数字 id 会被归一成字符串（后端把 Long 序列化成字符串，浏览器回传的也是字符串）', async () => {
    const { sdk, calls } = capture()
    await sdk.assignment.update({ ...draft, id: 1072 })
    expect(rawBodyOf(calls[0])).toContain('"id":"1072"')
    expect(rawBodyOf(calls[0])).not.toContain('"id":1072')
  })
})

describe('改状态与删除 —— 与浏览器基准逐字节一致', () => {
  it('改状态：body 恰好是 {"id":"1071","status":0}，与基准一字不差', async () => {
    const { sdk, calls } = capture()
    const baseline = requestOf('assignment-set-status')

    await sdk.assignment.setStatus(1071, 0)

    expect(String(calls[0]?.method).toUpperCase()).toBe(baseline.method)
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(baseline.url))
    expect(rawBodyOf(calls[0])).toBe(baseline.body)
  })

  it('改状态收的是**目标值**：连发两次 0，载荷完全一样（是幂等的，不是 toggle）', async () => {
    const { sdk, calls } = capture()
    await sdk.assignment.setStatus(1071, 0)
    await sdk.assignment.setStatus(1071, 0)
    expect(rawBodyOf(calls[0])).toBe(rawBodyOf(calls[1]))
  })

  it('非法状态值被拒绝（1 / 0 之外的一律不发）', async () => {
    const { sdk, calls } = capture()
    await expect(sdk.assignment.setStatus(1071, 2 as unknown as 0)).rejects.toThrow(/作业状态/)
    expect(calls).toHaveLength(0)
  })

  it('删除：id 数组在 body 里，与基准一字不差', async () => {
    const { sdk, calls } = capture()
    const baseline = requestOf('assignment-remove')

    await sdk.assignment.remove(1071)

    expect(String(calls[0]?.method).toUpperCase()).toBe(baseline.method)
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(baseline.url))
    expect(rawBodyOf(calls[0])).toBe(baseline.body)
    // 不是 `${deleteURL}/${id}` —— 那是 renren 通用删除的写法，这个页面覆盖掉了
    expect(String(calls[0]?.url)).not.toContain('/studyassignment/1071')
  })

  it('删除也接受数组（多个 id 一起删）', async () => {
    const { sdk, calls } = capture()
    await sdk.assignment.remove(['1', 2])
    expect(rawBodyOf(calls[0])).toBe('["1","2"]')
  })
})

describe('详情：id 在路径段上', () => {
  it('URL 与基准一致（去掉 _t 后逐字符相同）', async () => {
    const { sdk, calls } = capture({ id: '1072' })
    await sdk.assignment.get(1072)

    expect(normalizeUrl(String(calls[0]?.url))).toBe(
      normalizeUrl(requestOf('assignment-get').url),
    )
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
  })
})

// ---------------------------------------------------------------------------
// invoke 接线（G1）：能力 ID 是唯一的调用句柄
// ---------------------------------------------------------------------------

describe('invoke 接线', () => {
  it('读能力经 invoke 发出的请求与手写路径逐字段一致', async () => {
    const { sdk, calls } = capture()
    await sdk.capabilities.invoke('assignment-list')
    await sdk.assignment.list()
    // `_t` 是客户端自己加的防缓存时间戳，两次调用必然差几毫秒，去掉再比
    expect(normalizeUrl(String(calls[1]?.url))).toBe(normalizeUrl(String(calls[0]?.url)))
    expect(calls[1]?.headers).toEqual(calls[0]?.headers)
  })

  it('create 经 invoke 必须带 requestId（缺了当场报错，且不发请求）', async () => {
    const { sdk, calls } = capture()
    await expect(sdk.capabilities.invoke('assignment-create', { ...draft })).rejects.toBeInstanceOf(
      CapabilityInvokeError,
    )
    expect(calls).toHaveLength(0)
  })

  it('create 同一个 requestId 重试：回放结果，不再发第二次请求', async () => {
    const { sdk, calls } = capture(1075)
    const requestId = createRequestId()

    await sdk.capabilities.invoke('assignment-create', { ...draft, requestId })
    await sdk.capabilities.invoke('assignment-create', { ...draft, requestId })

    expect(calls).toHaveLength(1)
  })

  it('create 换了 requestId 就是新意图，会真的再发一次', async () => {
    const { sdk, calls } = capture(1076)
    await sdk.capabilities.invoke('assignment-create', { ...draft, requestId: createRequestId() })
    await sdk.capabilities.invoke('assignment-create', { ...draft, requestId: createRequestId() })
    expect(calls).toHaveLength(2)
  })

  it('set-status 经 invoke：id 缺失时报错而不是发一个空 id', async () => {
    const { sdk, calls } = capture()
    await expect(
      sdk.capabilities.invoke('assignment-set-status', { status: 0 }),
    ).rejects.toBeInstanceOf(CapabilityInvokeError)
    expect(calls).toHaveLength(0)
  })

  it('set-status 经 invoke 正常可用', async () => {
    const { sdk, calls } = capture()
    await sdk.capabilities.invoke('assignment-set-status', { id: 1071, status: 0 })
    expect(rawBodyOf(calls[0])).toBe('{"id":"1071","status":0}')
  })

  it('**不**给 update / set-status / remove 加防重：同一个 id 连发两次是两次请求（这不是缺陷）', async () => {
    const { sdk, calls } = capture()

    await sdk.capabilities.invoke('assignment-update', { ...draft, id: 1071 })
    await sdk.capabilities.invoke('assignment-update', { ...draft, id: 1071 })
    await sdk.capabilities.invoke('assignment-set-status', { id: 1071, status: 0 })
    await sdk.capabilities.invoke('assignment-set-status', { id: 1071, status: 0 })
    await sdk.capabilities.invoke('assignment-remove', { id: 1071 })
    await sdk.capabilities.invoke('assignment-remove', { id: 1071 })

    expect(calls).toHaveLength(6)
  })
})

describe('能力定义与绑定表', () => {
  it('六个能力的 pagePath 都指向本页（完成状态是推导的，不是手工记的）', () => {
    const { sdk } = capture()
    const mine = sdk.capabilities.filter((capability) => capability.id.startsWith('assignment-'))
    expect(mine.map((capability) => capability.id).sort()).toEqual([
      'assignment-create',
      'assignment-get',
      'assignment-list',
      'assignment-remove',
      'assignment-set-status',
      'assignment-update',
    ])
    for (const capability of mine) {
      expect(capability.pagePath).toBe(ASSIGNMENT_PAGE_PATH)
    }
    // 写能力的标记：create/update/set-status/remove 是写，list/get 是读
    expect(mine.filter((capability) => capability.write).map((capability) => capability.id).sort()).toEqual([
      'assignment-create',
      'assignment-remove',
      'assignment-set-status',
      'assignment-update',
    ])
  })

  it('status 参数**不**声明成 enum——它在页面上的候选值是错的（交易状态字典）', () => {
    const { sdk } = capture()
    const list = sdk.capabilities.find((capability) => capability.id === 'assignment-list')
    const status = list?.params.find((param) => param.name === 'status')
    expect(status?.kind).toBe('text')
    expect(status?.options).toBeUndefined()
    // 描述里必须说清它是坏的，否则 AI 会当成作业状态用
    expect(status?.description).toContain('交易状态')
  })

  it('type 参数声明成 enum，候选就是实测的 6 个作业类型', () => {
    const { sdk } = capture()
    const create = sdk.capabilities.find((capability) => capability.id === 'assignment-create')
    const type = create?.params.find((param) => param.name === 'type')
    expect(type?.kind).toBe('enum')
    expect(type?.options).toEqual([
      { label: '文件', value: 1 },
      { label: '图片+文字', value: 2 },
      { label: '图片', value: 3 },
      { label: '文字', value: 4 },
      { label: '视频', value: 5 },
      { label: '视频+文字', value: 6 },
    ])
  })
})
