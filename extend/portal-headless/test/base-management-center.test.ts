import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp } from '../src/http/client.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { resolveHttpInstance } from '../src/context/http-instance.js'
import {
  BASE_MANAGEMENT_CENTER_MODULE_TYPE,
  BASE_MANAGEMENT_CENTER_PAGE_PATH,
  BASE_MANAGEMENT_CENTER_PERMISSION,
  MANAGEMENT_CENTER_NAME_MAX_LENGTH,
  MANAGEMENT_CENTER_STATUS_OPTIONS,
  baseManagementCenterCapabilities,
  buildCreatePayload,
  buildListParams,
  createBaseManagementCenterCapability,
} from '../src/capabilities/base-management-center.js'

/**
 * 组织结构（`/dashboard/base/management-center/list`）—— 普通 CRUD 的第三个样本。
 *
 * 基准：`baseline/base-management-center.browser.json`（bsk 抓的真实浏览器请求，
 * token 在页面内脱敏）。
 *
 * ## 为什么这里不写 `sdk.baseManagementCenter.xxx`
 *
 * 因为「把 base-management-center 接进 `src/index.ts` 的门面」是**派单方**的动作，
 * 不在本次任务的文件范围内。这份测试按 `src/index.ts` 里那三行同样的方式自己接线
 * （`createPortalHttp` → `createPageCall` → `createBaseManagementCenterCapability`），
 * 于是它跑的是**真实的请求层**（`/admin-api` 前缀、`_t`、qs 序列化、module-type 头
 * 全都真发），但不依赖门面有没有接线。
 *
 * ## 真机验证在哪
 *
 * 写链路（create → 独立证实 → update → setStatus → remove → 清理核对）的完整记录在
 * `smoke/base-management-center-crud.mjs`，逐条结论抄在 `docs/pages/组织结构.md`
 * 的「真实验证记录」一节。
 *
 * 本文件末尾那个 `LIVE` 组**只跑读链路**，不重复冒烟脚本的写循环。理由：
 * 这一页的列表是**跨创建人**的（后端 SQL 没有 creator 条件），
 * 「跑 `pnpm test` 顺手建一条再删掉」在共享测试环境里没有额外信息量，
 * 却多一次把数据留在那里的机会。写链路要跑就显式跑冒烟脚本。
 */

type ReadRequest = {
  能力: string
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

type WriteRequest = {
  能力: string
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/base-management-center.browser.json'), 'utf8'),
) as { 读请求: ReadRequest[]; 写请求: WriteRequest[] }

const readOf = (capability: string, urlPart: string): ReadRequest => {
  const found = baseline.读请求.find(
    (item) => item.能力 === capability && item.url.includes(urlPart),
  )
  if (!found) throw new Error(`基准里没有 ${capability} / ${urlPart}`)
  return found
}

const writeOf = (capability: string, bodyPart: string): WriteRequest => {
  const found = baseline.写请求.find(
    (item) => item.能力 === capability && item.body.includes(bodyPart),
  )
  if (!found) throw new Error(`基准里没有 ${capability} / ${bodyPart}`)
  return found
}

/** 去掉主机与一次性时间戳，只留 path + query */
function normalizeUrl (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

/** 拆成有序的 [key, value] 列表：键顺序不同也算不一致（D20） */
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

/**
 * 造一个「真实请求层 + 桩响应」的组织结构能力。
 * 与 `test/base-image.test.ts` 的 `capture()` 同一个思路。
 */
function capture (data: unknown = { list: [], total: 0 }) {
  const calls: InternalAxiosRequestConfig[] = []
  const http = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(requestConfig: unknown) => http.request(requestConfig as never) as unknown as Promise<T>,
  )
  const cap = createBaseManagementCenterCapability((requestConfig) =>
    call(BASE_MANAGEMENT_CENTER_PAGE_PATH, requestConfig as never),
  )
  return { cap, calls }
}

/** 与写基准同一份填写值。**写死**而不是从基准里读：两边各自独立取值才叫对照。 */
const draft = { name: 'SDK-TEST-A', commander: '2023040108' }

// ---------------------------------------------------------------------------
// 页面上下文
// ---------------------------------------------------------------------------

describe('组织结构 —— 页面上下文', () => {
  it('module-type 按页面路径推出来是 12（学习管理），与浏览器抓到的一致', () => {
    const resolved = resolveModuleType(BASE_MANAGEMENT_CENTER_PAGE_PATH)
    expect(resolved.moduleType).toBe(BASE_MANAGEMENT_CENTER_MODULE_TYPE)
    expect(resolved.moduleType).toBe(12)
    expect(resolved.label).toBe('学习管理')
  })

  it('这一页的列表请求走 platform 实例（页面 import 了它，全局默认也是它）', () => {
    const resolution = resolveHttpInstance({ pagePath: BASE_MANAGEMENT_CENTER_PAGE_PATH })
    expect(resolution.kind).toBe('resolved')
    if (resolution.kind !== 'resolved') return
    expect(resolution.instance.id).toBe('platform')
  })

  it('页面路径 / 权限码对得上清单里的那一页（不是自己跟自己一致）', () => {
    // 这一条是**外部锚点**，必须有：其余用例全都是拿 BASE_MANAGEMENT_CENTER_PAGE_PATH
    // 当输入（推导 module-type、推导 http 实例、当页面上下文传进 call），常数改错一个字，
    // 它们会跟着一起错、却全都还是绿的 —— 图库管理那条线的反证里就是这么被抓出来的。
    // 清单 `generated/page-catalog.json` 是从 Portal 前端源码扫出来的，是独立的那个"真值"。
    type CatalogPage = {
      menuPath: string
      title: string
      permission: string
      routeFile: string
      moduleType: number
      write: boolean
    }
    const catalog = JSON.parse(
      readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
    ) as { total: number; items: CatalogPage[] }
    expect(catalog.total).toBeGreaterThan(0)
    const entry = catalog.items.find((page) => page.menuPath === BASE_MANAGEMENT_CENTER_PAGE_PATH)
    expect(entry, `清单里找不到 ${BASE_MANAGEMENT_CENTER_PAGE_PATH}`).toBeDefined()
    expect(entry?.title).toBe('组织结构')
    expect(entry?.permission).toBe(BASE_MANAGEMENT_CENTER_PERMISSION)
    expect(entry?.moduleType).toBe(BASE_MANAGEMENT_CENTER_MODULE_TYPE)
    expect(entry?.routeFile).toBe(
      'app/portal/views/dashboard/education/base/management-center/list.vue',
    )
    expect(entry?.write).toBe(true)
  })

  it('七个能力的 pagePath / permission 与清单一致，写标志也对', () => {
    expect(baseManagementCenterCapabilities.map((item) => item.id)).toEqual([
      'base-management-center-list',
      'base-management-center-get',
      'base-management-center-check-status',
      'base-management-center-create',
      'base-management-center-update',
      'base-management-center-set-status',
      'base-management-center-remove',
    ])
    for (const capability of baseManagementCenterCapabilities) {
      expect(capability.pagePath).toBe(BASE_MANAGEMENT_CENTER_PAGE_PATH)
      expect(capability.permission).toBe(BASE_MANAGEMENT_CENTER_PERMISSION)
    }
    const writes = baseManagementCenterCapabilities
      .filter((item) => item.write)
      .map((item) => item.id)
    expect(writes).toEqual([
      'base-management-center-create',
      'base-management-center-update',
      'base-management-center-set-status',
      'base-management-center-remove',
    ])
  })

  it('updateStatus 那条声明成只读（它一个字段都不写，是禁用前的预检）', () => {
    const check = baseManagementCenterCapabilities.find(
      (item) => item.id === 'base-management-center-check-status',
    )
    expect(check?.write).toBe(false)
    // 描述里必须写明它是只读预检，否则 AI 会把它当成"提交"的一步来调
    expect(check?.title).toContain('预检')
    expect(check?.title).toContain('只读')
  })

  it('status 参数声明成 enum 0/1，而不是照抄页面上那个坏掉的字典', () => {
    const list = baseManagementCenterCapabilities.find(
      (item) => item.id === 'base-management-center-list',
    )
    const status = list?.params.find((item) => item.name === 'status')
    expect(status?.kind).toBe('enum')
    expect(status?.options).toEqual([
      { label: '禁用', value: 0 },
      { label: '启用', value: 1 },
    ])
    expect(MANAGEMENT_CENTER_STATUS_OPTIONS).toHaveLength(2)
    // 描述里必须写明页面那个下拉是坏的，否则 AI 会以为它跟页面上看到的一样
    expect(status?.description).toContain('坏的')
    expect(status?.description).toContain('TRADE_FINISHED')
  })

  it('update 只开放 name：commander（会授 SUPER_ADMIN）与 status 都不在契约里', () => {
    const update = baseManagementCenterCapabilities.find(
      (item) => item.id === 'base-management-center-update',
    )
    expect(update?.params.map((item) => item.name)).toEqual(['id', 'name'])
    // 描述里必须写明为什么这两个字段不做
    const name = update?.params.find((item) => item.name === 'name')
    expect(name?.description).toContain('SUPER_ADMIN')
    expect(name?.description).toContain('set-status')
  })

  it('create 的 commander 是必填（后端对 null 直接 .toString()，会让所有人列表页 500）', () => {
    const create = baseManagementCenterCapabilities.find(
      (item) => item.id === 'base-management-center-create',
    )
    const commander = create?.params.find((item) => item.name === 'commander')
    expect(commander?.required).toBe(true)
    expect(commander?.description).toContain('500')
    const name = create?.params.find((item) => item.name === 'name')
    expect(name?.required).toBe(true)
    expect(name?.description).toContain(String(MANAGEMENT_CENTER_NAME_MAX_LENGTH))
  })
})

// ---------------------------------------------------------------------------
// 读链路：与浏览器基准逐字段一致
// ---------------------------------------------------------------------------

describe('组织结构列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('筛选条件全空时，path / query 与基准完全相同（含键顺序与那些空值参数）', async () => {
    const { cap, calls } = capture()
    await cap.list()

    const actual = String(calls[0]?.url)
    const expected = readOf('base-management-center-list', 'name=&status=').url
    expect(normalizeUrl(actual)).toBe(normalizeUrl(expected))
    expect(queryPairs(actual)).toEqual(queryPairs(expected))
    expect(queryPairs(actual).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'name',
      'status',
      'pageNo',
      'pageSize',
      '_t',
    ])
    expect(calls[0]?.method?.toLowerCase()).toBe('get')
    // 一次筛选都没填，这两个参数照样以空串发出去（conventions 第 4 条）
    expect(queryPairs(actual).slice(0, 4).every(([, value]) => value === '')).toBe(true)
  })

  it('带 name 的那一条基准也能复刻出来（模糊匹配，不是前缀）', async () => {
    const { cap, calls } = capture()
    await cap.list({ name: 'SDK-TEST-A' })
    const expected = readOf('base-management-center-list', 'name=SDK-TEST-A')
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(expected.url))
  })

  it('只传 pageSize 时参数顺序不变（pageSize 不能被挤到 pageNo 前面）', () => {
    // 这是 `{...DEFAULTS, ...query}` 那种写法会踩的坑：展开会把新键插在中间，
    // 序列化出来的 URL 参数顺序就与浏览器不同了
    expect(Object.keys(buildListParams({ pageSize: 50 }))).toEqual([
      'order',
      'orderField',
      'name',
      'status',
      'pageNo',
      'pageSize',
    ])
    const params = buildListParams({ pageSize: 50, name: 'SDK-TEST' })
    expect(params.pageSize).toBe(50)
    expect(params.name).toBe('SDK-TEST')
    // 没点名的那些仍然是空串，不是被省略掉
    expect(params.status).toBe('')
    expect(params.orderField).toBe('')
  })

  it('请求头上带着本页的 module-type: 12（走的是真实的请求层）', async () => {
    const { cap, calls } = capture()
    await cap.list()
    const headers = calls[0]?.headers as unknown as Record<string, string>
    expect(headers['module-type']).toBe('12')
    expect(headers['tenant-id']).toBe('1')
    expect(String(calls[0]?.url)).toContain('/admin-api/study/base/studymanagementcenter/page')
  })

  it('status 传 0 / 1 都发得出去；传别的值当场 reject 且不发请求', async () => {
    const { cap, calls } = capture()
    await cap.list({ status: 1 })
    expect(queryPairs(String(calls[0]?.url))).toContainEqual(['status', '1'])
    await cap.list({ status: 0 })
    expect(queryPairs(String(calls[1]?.url))).toContainEqual(['status', '0'])
    // 页面那个坏下拉发出去的就是这个值（实测），SDK 必须在这里拦住
    await expect(
      cap.list({ status: 'TRADE_FINISHED' as unknown as 1 }),
    ).rejects.toThrow(/启用状态只能是/)
    expect(calls).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 详情 / 预检
// ---------------------------------------------------------------------------

describe('组织结构详情 —— id 在路径段上，且必须是字符串形态的原值', () => {
  it('GET /study/base/studymanagementcenter/{id}，与基准逐字段一致', async () => {
    const { cap, calls } = capture({ id: '36', name: 'x' })
    await cap.get(36)
    const expected = readOf('base-management-center-get', '/studymanagementcenter/36')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(calls[0]?.method?.toLowerCase()).toBe('get')
  })

  it('id 传字符串也拼成同一个 URL（后端把 Long 序列化成字符串）', async () => {
    const { cap, calls } = capture({})
    await cap.get('36')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(
      '/admin-api/study/base/studymanagementcenter/36?_t=<ts>',
    )
  })

  it('id 为空时当场报错，不发出请求', async () => {
    const { cap, calls } = capture({})
    await expect(cap.get('  ')).rejects.toThrow(/id 不能为空/)
    expect(calls).toHaveLength(0)
  })
})

describe('禁用前预检 —— 它叫 updateStatus，但它不写任何东西', () => {
  it('PUT /updateStatus，body 是 {id, status}，与基准逐字段一致（禁用方向）', async () => {
    const { cap, calls } = capture('')
    await cap.checkStatus(36, 0)
    // 基准里它排在**读请求**那一组（因为这个接口确实一个字段都不写）；写请求那组没有它
    const expected = readOf('base-management-center-check-status', '/updateStatus')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(calls[0]?.method?.toLowerCase()).toBe('put')
    expect(String(calls[0]?.data)).toBe(expected.body)
    expect(
      baseline.写请求.some((item) => item.url.includes('/updateStatus')),
    ).toBe(false)
    expect(String(calls[0]?.data)).toBe('{"id":"36","status":0}')
  })

  it('启用方向（status=1）与基准里那一条同形', async () => {
    const { cap, calls } = capture('')
    await cap.checkStatus(36, 1)
    expect(String(calls[0]?.data)).toBe('{"id":"36","status":1}')
  })

  it('返回值就是后端的提示语字符串（有下属班级且要禁用时）', async () => {
    const message = '禁用一级组织结构，其下属的班级也会被禁用，是否确认禁用'
    const { cap } = capture(message)
    await expect(cap.checkStatus(36, 0)).resolves.toBe(message)
  })

  it('status 只收 0/1，传别的值当场报错', async () => {
    const { cap, calls } = capture('')
    await expect(cap.checkStatus(36, 2 as unknown as 1)).rejects.toThrow(/启用状态只能是/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 写链路
// ---------------------------------------------------------------------------

describe('新建组织结构 —— body 两个键，与基准逐字段一致', () => {
  it('POST /study/base/studymanagementcenter，body 是 {name, commander}，键顺序也一样', async () => {
    const { cap, calls } = capture()
    await cap.create(draft)
    const expected = writeOf('base-management-center-create', '"name"')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(calls[0]?.method?.toLowerCase()).toBe('post')
    // 形状对齐基准（基准里装的是浏览器当时那份取值，和这里本来就不该相同）
    expect(Object.keys(JSON.parse(expected.body))).toEqual(['name', 'commander'])
    expect(String(calls[0]?.data)).toBe('{"name":"SDK-TEST-A","commander":"2023040108"}')
  })

  it('commander 传数字也归一成字符串（后端字段是 Long，页面发的是 username 字符串）', () => {
    expect(buildCreatePayload({ name: 'SDK-TEST-A', commander: 2023040108 })).toEqual({
      name: 'SDK-TEST-A',
      commander: '2023040108',
    })
  })

  it('name 为空 / 全空格当场报错，不发出请求', async () => {
    const { cap, calls } = capture()
    await expect(cap.create({ name: '', commander: '1' })).rejects.toThrow(/名称必填/)
    await expect(cap.create({ name: '   ', commander: '1' })).rejects.toThrow(/名称必填/)
    expect(calls).toHaveLength(0)
  })

  it('name 超过 10 字当场报错（页面规则，实测点保存就是这条红字）', async () => {
    const { cap, calls } = capture()
    await expect(
      cap.create({ name: 'SDK-TEST-BMC-A', commander: '1' }),
    ).rejects.toThrow(new RegExp(`不超过 ${MANAGEMENT_CENTER_NAME_MAX_LENGTH} 字`))
    expect(calls).toHaveLength(0)
  })

  it('**commander 缺了要当场拦住**——这条不是为了好看，是为了不让共享环境的列表页 500', async () => {
    const { cap, calls } = capture()
    for (const bad of ['', '   ', null, undefined]) {
      await expect(
        cap.create({ name: 'SDK-TEST-A', commander: bad as unknown as string }),
      ).rejects.toThrow(/负责人（commander）必填/)
    }
    expect(calls).toHaveLength(0)
  })
})

describe('修改组织结构 —— 只发 {id, name}，其余靠后端部分更新', () => {
  it('PUT /study/base/studymanagementcenter，body 是 {id, name} 且 id 是字符串', async () => {
    const { cap, calls } = capture()
    await cap.update({ id: 36, name: 'SDK-TEST-B' })
    const expected = writeOf('base-management-center-update', '"name"')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(calls[0]?.method?.toLowerCase()).toBe('put')
    expect(String(calls[0]?.data)).toBe('{"id":"36","name":"SDK-TEST-B"}')
    // 与浏览器那份 body 的差别是**子集**，不是另起一套键名
    const browserKeys = Object.keys(JSON.parse(expected.body))
    expect(browserKeys).toContain('name')
    expect(browserKeys).toContain('id')
    expect(browserKeys).toContain('commander')
    for (const key of Object.keys(JSON.parse(String(calls[0]?.data)))) {
      expect(browserKeys).toContain(key)
    }
  })

  it('改不出来别的字段：commander / status / creator 传了也不会进 body', async () => {
    const { cap, calls } = capture()
    await cap.update({
      id: '36',
      name: 'SDK-TEST-C',
      commander: '999',
      status: 0,
      creator: '1',
    } as unknown as { id: string; name: string })
    expect(JSON.parse(String(calls[0]?.data))).toEqual({ id: '36', name: 'SDK-TEST-C' })
  })

  it('name 超过 10 字当场报错，不发出请求', async () => {
    const { cap, calls } = capture()
    await expect(cap.update({ id: 36, name: 'SDK-TEST-BMC-A' })).rejects.toThrow(/不超过 10 字/)
    expect(calls).toHaveLength(0)
  })
})

describe('改状态 / 删除 —— 载荷形状与基准一致', () => {
  it('setStatus 发 {id, status} 两个键、顺序与基准一致，id 是字符串', async () => {
    const { cap, calls } = capture()
    await cap.setStatus(36, 1)
    const expected = writeOf('base-management-center-set-status', '"status":1')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(String(calls[0]?.data)).toBe(expected.body)
    expect(String(calls[0]?.data)).toBe('{"id":"36","status":1}')
  })

  it('setStatus 传 0 也真的发 0（不是 false / 空），与禁用方向基准一致', async () => {
    const { cap, calls } = capture()
    await cap.setStatus(36, 0)
    const expected = writeOf('base-management-center-set-status', '"status":0')
    expect(String(calls[0]?.data)).toBe(expected.body)
    expect(String(calls[0]?.data)).toBe('{"id":"36","status":0}')
  })

  it('remove 的 body 是**字符串** id 数组（不是数字、不是路径参数）', async () => {
    const { cap, calls } = capture()
    await cap.remove(36)
    const expected = writeOf('base-management-center-remove', '[')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(calls[0]?.method?.toLowerCase()).toBe('delete')
    expect(String(calls[0]?.data)).toBe('["36"]')
    // 基准里就是字符串数组——与图库管理那条线（数字数组）正相反
    expect(JSON.parse(expected.body)).toEqual(['36'])
  })

  it('remove 传数字也归一成字符串；传数组按原样过滤', async () => {
    const { cap, calls } = capture()
    await cap.remove(['36', 37])
    expect(String(calls[0]?.data)).toBe('["36","37"]')
  })

  it('remove 空数组当场报错，不发出请求', async () => {
    const { cap, calls } = capture()
    await expect(cap.remove([])).rejects.toThrow(/至少一个 id/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// LIVE 真机（默认跳过）—— 只跑读链路
// ---------------------------------------------------------------------------

const LIVE =
  Boolean(process.env.PORTAL_BASE_URL) &&
  Boolean(process.env.PORTAL_TOKEN) &&
  Boolean(process.env.PORTAL_TENANT_ID)

describe.runIf(LIVE)('LIVE 真实环境 —— 组织结构的读链路', () => {
  const baseUrl = process.env.PORTAL_BASE_URL as string
  const token = process.env.PORTAL_TOKEN as string
  const tenantId = process.env.PORTAL_TENANT_ID as string

  // 客户端**懒建**：describe 的回调在收集阶段就会跑，`describe.runIf(false)` 也一样，
  // 放在这里直接建会在没有环境变量时因为 baseUrl 是 undefined 而炸在收集期。
  let client: ReturnType<typeof createBaseManagementCenterCapability> | null = null
  const cap = () => {
    if (!client) {
      const http = createPortalHttp({ baseUrl, credential: { token, tenantId } })
      const call = createPageCall(
        <T>(requestConfig: unknown) => http.request(requestConfig as never) as unknown as Promise<T>,
      )
      client = createBaseManagementCenterCapability((requestConfig) =>
        call(BASE_MANAGEMENT_CENTER_PAGE_PATH, requestConfig as never),
      )
    }
    return client
  }

  it('列表真的返回数据（记下条数，不是"没报错"）', async () => {
    const page = await cap().list({ pageNo: 1, pageSize: 5 })
    expect(Array.isArray(page.list)).toBe(true)
    expect(page.total).toBeGreaterThan(0)
    expect(page.list.length).toBeGreaterThan(0)
    // id 是**字符串**（后端把 Long 序列化成字符串）——两条基准都实测过
    const first = page.list[0] as Record<string, unknown>
    expect(first).toHaveProperty('id')
    expect(typeof first.id).toBe('string')
    // 列表接口会补这个姓名，get 不会——这是两个接口的实测差别之一
    expect(typeof first.commanderName).toBe('string')
  })

  it('详情按 id 取得到同一条', async () => {
    const page = await cap().list({ pageNo: 1, pageSize: 1 })
    const row = page.list[0] as { id: string }
    const detail = await cap().get(row.id)
    expect(detail).not.toBeNull()
    expect(String(detail?.id)).toBe(String(row.id))
  })

  /**
   * ⚠️ 这里**故意没有** `checkStatus` 的用例，尽管它是本页最有意思的一条。
   *
   * 它是 `PUT`。虽然源码与冒烟都证明它一个字段都不写（`updateInfo` 之外只有一次 select；
   * 冒烟里在自己的记录上验过 status 与 updateTime 一个字没变），但这一组 LIVE 用例挑的是
   * **列表里的第一条——那是别人建的组织**。往一个不属于自己的组织节点上发 `PUT`，
   * 即使它可证明是无副作用的，也不该由一条"顺手跑 `pnpm test`"的用例来做。
   *
   * 这条性质的完整实测记录在 `smoke/base-management-center-crud.mjs` 第 7 步
   * （跑在自己的 idA 上），逐条抄在 `docs/pages/组织结构.md` 的「真实验证记录」里。
   */
  it('checkStatus 不在 LIVE 组里（它是 PUT，见上面的注释），但它的形状有离线用例钉着', () => {
    const check = baseManagementCenterCapabilities.find(
      (item) => item.id === 'base-management-center-check-status',
    )
    expect(check?.write).toBe(false)
    expect(check?.params.map((item) => item.name)).toEqual(['id', 'status'])
  })
})
