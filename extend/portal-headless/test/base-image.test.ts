import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp } from '../src/http/client.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { resolveHttpInstance } from '../src/context/http-instance.js'
import {
  BASE_IMAGE_MODULE_TYPE,
  BASE_IMAGE_PAGE_PATH,
  BASE_IMAGE_PERMISSION,
  BASE_IMAGE_STATUS_OPTIONS,
  baseImageCapabilities,
  buildCreateTimeRange,
  buildListParams,
  createBaseImageCapability,
} from '../src/capabilities/base-image.js'

/**
 * 图库管理（`/dashboard/base/image/list`）—— 第二条普通 CRUD 的线。
 *
 * 基准：`baseline/base-image.browser.json`（bsk 抓的真实浏览器请求，token 在页面内脱敏）。
 *
 * ## 为什么这里不写 `sdk.baseImage.xxx`
 *
 * 因为「把 base-image 接进 `src/index.ts` 的门面」是**派单方**的动作，不在本次任务
 * 的文件范围内。这份测试直接按 `src/index.ts` 里那三行同样的方式自己接线
 * （`createPortalHttp` → `createPageCall` → `createBaseImageCapability`），
 * 于是它跑的是**真实的请求层**（`/admin-api` 前缀、`_t`、qs 序列化、module-type 头
 * 全都真发），但不依赖门面有没有接线。
 *
 * ## 真机验证在哪
 *
 * 文件末尾的 `LIVE 真实环境` 一组，只有在 `PORTAL_TOKEN` / `PORTAL_BASE_URL` /
 * `PORTAL_TENANT_ID` 三个环境变量都在时才跑（`smoke/with-portal-token.sh` 会注入）。
 * 平时 `pnpm test` 里它是 skipped，不会碰网络。真实环境的结论逐条写在
 * `docs/pages/图库管理.md` 的「真实验证记录」。
 */

type ReadBaseline = {
  method: string
  url: string
  body: string | null
}

type WriteBaseline = {
  写请求: Array<{
    能力: string
    method: string
    url: string
    body: string
  }>
}

const here = dirname(fileURLToPath(import.meta.url))
const read = (name: string): unknown =>
  JSON.parse(readFileSync(join(here, `../baseline/${name}`), 'utf8'))

const baseline = read('base-image.browser.json') as {
  读请求: ReadBaseline[]
  写请求: WriteBaseline['写请求']
}
const writeOf = (capability: string): WriteBaseline['写请求'][number] => {
  const found = baseline.写请求.find((item) => item.能力 === capability)
  if (!found) throw new Error(`基准里没有 ${capability}`)
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
 * 造一个「真实请求层 + 桩响应」的图库能力。
 *
 * 与 `test/assignment.test.ts` 的 `capture()` 同一个思路，只有接线方式不同
 * （那边走门面，这边按 `src/index.ts:167` 的三行手动接线，理由见文件头）。
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
  const cap = createBaseImageCapability((requestConfig) =>
    call(BASE_IMAGE_PAGE_PATH, requestConfig as never),
  )
  return { cap, calls }
}

/**
 * 与写基准同一份填写值。**写死**而不是从基准里读：基准是「浏览器发出去的」，
 * 这里是「SDK 发出去的」，两边各自独立取值才叫对照。
 */
const TEST_URL = 'https://files-test.wodecorp.cn/Public/public/2026/09/wejkhpeuunnshrwj.png'
const draft = { name: 'SDK-TEST-图库-写基准', url: TEST_URL }

// ---------------------------------------------------------------------------
// 页面上下文
// ---------------------------------------------------------------------------

describe('图库管理 —— 页面上下文', () => {
  it('module-type 按页面路径推出来是 12（学习管理），与浏览器抓到的一致', () => {
    const resolved = resolveModuleType(BASE_IMAGE_PAGE_PATH)
    expect(resolved.moduleType).toBe(BASE_IMAGE_MODULE_TYPE)
    expect(resolved.moduleType).toBe(12)
    expect(resolved.label).toBe('学习管理')
  })

  it('这一页的列表请求走 platform 实例（页面就算不 import 它，全局默认也是它）', () => {
    const resolution = resolveHttpInstance({ pagePath: BASE_IMAGE_PAGE_PATH })
    expect(resolution.kind).toBe('resolved')
    if (resolution.kind !== 'resolved') return
    expect(resolution.instance.id).toBe('platform')
    // 走默认实例才不会触发「实例算不出就拒绝发请求」那条失败关闭（conventions 第 26 条）
    expect(resolution.instance.id).toBe('platform')
  })

  it('页面路径 / 权限码对得上清单里的那一页（不是自己跟自己一致）', () => {
    // 这一条是**外部锚点**，必须有：其余用例全都是拿 BASE_IMAGE_PAGE_PATH 当输入
    // （推导 module-type、推导 http 实例、当页面上下文传进 call），常数改错一个字，
    // 它们会跟着一起错、却全都还是绿的 —— 反证里就是这么被抓出来的。
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
    const pages = catalog.items
    expect(catalog.total).toBeGreaterThan(0)
    const entry = pages.find((page) => page.menuPath === BASE_IMAGE_PAGE_PATH)
    expect(entry, `清单里找不到 ${BASE_IMAGE_PAGE_PATH}`).toBeDefined()
    expect(entry?.title).toBe('图库管理')
    expect(entry?.permission).toBe(BASE_IMAGE_PERMISSION)
    expect(entry?.moduleType).toBe(BASE_IMAGE_MODULE_TYPE)
    expect(entry?.routeFile).toBe('app/portal/views/dashboard/education/base/image/list.vue')
    expect(entry?.write).toBe(true)
  })

  it('七个能力的 pagePath / permission 与清单一致，写标志也对', () => {
    expect(baseImageCapabilities.map((item) => item.id)).toEqual([
      'base-image-list',
      'base-image-get',
      'base-image-create',
      'base-image-create-release',
      'base-image-update',
      'base-image-set-status',
      'base-image-remove',
    ])
    for (const capability of baseImageCapabilities) {
      expect(capability.pagePath).toBe(BASE_IMAGE_PAGE_PATH)
      expect(capability.permission).toBe(BASE_IMAGE_PERMISSION)
    }
    const writes = baseImageCapabilities.filter((item) => item.write).map((item) => item.id)
    expect(writes).toEqual([
      'base-image-create',
      'base-image-create-release',
      'base-image-update',
      'base-image-set-status',
      'base-image-remove',
    ])
  })

  it('status 参数声明成 enum 0/1，而不是照抄页面上那个坏掉的字典', () => {
    const list = baseImageCapabilities.find((item) => item.id === 'base-image-list')
    const status = list?.params.find((item) => item.name === 'status')
    expect(status?.kind).toBe('enum')
    expect(status?.options).toEqual([
      { label: '未发布', value: 0 },
      { label: '已发布', value: 1 },
    ])
    expect(BASE_IMAGE_STATUS_OPTIONS).toHaveLength(2)
    // 描述里必须写明页面那个下拉是坏的，否则 AI 会以为它跟页面上看到的一样
    expect(status?.description).toContain('坏的')
  })

  it('update 的 status 是必填（后端不传会拆箱 NPE），描述里写明了', () => {
    const update = baseImageCapabilities.find((item) => item.id === 'base-image-update')
    const status = update?.params.find((item) => item.name === 'status')
    expect(status?.required).toBe(true)
    expect(status?.description).toContain('NPE')
  })
})

// ---------------------------------------------------------------------------
// 读链路：与浏览器基准逐字段一致
// ---------------------------------------------------------------------------

describe('图库列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('筛选条件全空时，path / query 与基准完全相同（含键顺序与那些空值参数）', async () => {
    const { cap, calls } = capture()
    await cap.list()

    const actual = String(calls[0]?.url)
    const expected = String(baseline.读请求[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(expected))
    expect(queryPairs(actual)).toEqual(queryPairs(expected))
    expect(queryPairs(actual).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'imgName',
      'status',
      'name',
      'createTimeStart',
      'createTimeEnd',
      'pageNo',
      'pageSize',
      '_t',
    ])
    expect(calls[0]?.method?.toLowerCase()).toBe('get')
    // 一次筛选都没填，这些参数照样以空串发出去（conventions 第 4 条）
    expect(queryPairs(actual).slice(0, 7).every(([, value]) => value === '')).toBe(true)
  })

  it('只传 pageSize 时参数顺序不变（pageSize 不能被挤到 pageNo 前面）', () => {
    // 这是 `{...DEFAULTS, ...query}` 那种写法会踩的坑：展开会把新键插在中间，
    // 序列化出来的 URL 参数顺序就与浏览器不同了
    expect(Object.keys(buildListParams({ pageSize: 50 }))).toEqual([
      'order',
      'orderField',
      'imgName',
      'status',
      'name',
      'createTimeStart',
      'createTimeEnd',
      'pageNo',
      'pageSize',
    ])
    const params = buildListParams({ pageSize: 50, imgName: 'SDK-TEST' })
    expect(params.pageSize).toBe(50)
    expect(params.imgName).toBe('SDK-TEST')
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
    expect(String(calls[0]?.url)).toContain('/admin-api/sys/imagemanage/page')
  })

  it('浏览器抓到的带条件那一条（imgName=SDK-TEST）也能复刻出来', async () => {
    const { cap, calls } = capture()
    await cap.list({ imgName: 'SDK-TEST' })
    const expected = baseline.读请求.find((item) => item.url.includes('imgName=SDK-TEST'))
    expect(expected).toBeDefined()
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(String(expected?.url)))
  })

  it('创建时间区间那一条：结束日 +1 天（开区间），与基准逐字段一致', async () => {
    const { cap, calls } = capture()
    await cap.list(buildCreateTimeRange('2026-09-20', '2026-09-20'))
    // 注意要挑**带值**的那一条：空条件那条也有 `createTimeStart=`（值是空串），
    // 用 includes('createTimeStart=') 会挑中它（第一版就是这么错的）
    const expected = baseline.读请求.find((item) => item.url.includes('createTimeStart=2026'))
    expect(expected).toBeDefined()
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(String(expected?.url)))
    expect(buildCreateTimeRange('2026-09-20', '2026-09-20')).toEqual({
      createTimeStart: '2026-09-20 00:00:00',
      createTimeEnd: '2026-09-21 00:00:00',
    })
  })
})

// ---------------------------------------------------------------------------
// 详情
// ---------------------------------------------------------------------------

describe('图库详情 —— id 在路径段上', () => {
  it('GET /sys/imagemanage/{id}，id 是数字', async () => {
    const { cap, calls } = capture({ id: 11, name: 'x' })
    await cap.get(11)
    expect(normalizeUrl(String(calls[0]?.url))).toBe('/admin-api/sys/imagemanage/11?_t=<ts>')
    expect(calls[0]?.method?.toLowerCase()).toBe('get')
  })

  it('id 传字符串也归一成数字（与基准里的一致）', async () => {
    const { cap, calls } = capture({})
    await cap.get('11')
    expect(normalizeUrl(String(calls[0]?.url))).toBe('/admin-api/sys/imagemanage/11?_t=<ts>')
  })

  it('id 不合法时当场报错，不发出请求', async () => {
    const { cap, calls } = capture({})
    await expect(cap.get('abc')).rejects.toThrow(/正整数/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 写链路
// ---------------------------------------------------------------------------

describe('新建图片 —— body 是一个数组（与基准逐字段一致）', () => {
  it('POST /sys/imagemanage，body 是 [{name,url}]，键顺序也一样', async () => {
    const { cap, calls } = capture()
    await cap.create(draft)
    const expected = writeOf('base-image-create')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(calls[0]?.method?.toLowerCase()).toBe('post')
    // body 不能整串比：基准里装的是浏览器当时那份 name / url（都是它自己的取值），
    // 和这里的 draft 本来就不同。要比的是**形状**：数组、条数、每项的键与键顺序。
    const actual = JSON.parse(String(calls[0]?.data)) as Array<Record<string, unknown>>
    const baselineBody = JSON.parse(expected.body) as Array<Record<string, unknown>>
    expect(actual).toHaveLength(baselineBody.length)
    expect(Object.keys(actual[0] ?? {})).toEqual(Object.keys(baselineBody[0] ?? {}))
    expect(Object.keys(actual[0] ?? {})).toEqual(['name', 'url'])
    expect(actual).toEqual([{ name: draft.name, url: draft.url }])
  })

  it('一次传多条时 body 就是多条（页面的 fileList 是数组）', async () => {
    const { cap, calls } = capture()
    await cap.create([draft, { name: 'SDK-TEST-第二张', url: TEST_URL }])
    expect(JSON.parse(String(calls[0]?.data))).toHaveLength(2)
  })

  it('保存并发布走 /saveAndRelease，body 形状与保存完全相同', async () => {
    const { cap, calls } = capture()
    await cap.createRelease(draft)
    const expected = writeOf('base-image-create-release')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(normalizeUrl(String(calls[0]?.url))).toContain('/saveAndRelease')
    // 与 create 那条**只有 URL 不同**：两条基准的 body 形状与键顺序必须一模一样
    const actual = JSON.parse(String(calls[0]?.data)) as Array<Record<string, unknown>>
    const createBody = JSON.parse(writeOf('base-image-create').body) as Array<Record<string, unknown>>
    const releaseBody = JSON.parse(expected.body) as Array<Record<string, unknown>>
    expect(Object.keys(actual[0] ?? {})).toEqual(Object.keys(releaseBody[0] ?? {}))
    expect(Object.keys(releaseBody[0] ?? {})).toEqual(Object.keys(createBody[0] ?? {}))
    expect(actual).toEqual([{ name: draft.name, url: draft.url }])
  })

  it('name / url 为空当场报错，不发出请求', async () => {
    const { cap, calls } = capture()
    await expect(cap.create({ name: '', url: TEST_URL })).rejects.toThrow(/名称必填/)
    await expect(cap.create({ name: 'x', url: '' })).rejects.toThrow(/地址必填/)
    expect(calls).toHaveLength(0)
  })
})

describe('修改图片 —— 部分更新，但 status 必须带', () => {
  it('PUT /sys/imagemanage，body 键顺序 id / name / url / status，全是数字与字符串原样', async () => {
    const { cap, calls } = capture()
    await cap.update({ id: 11, name: 'SDK-TEST-改后', url: TEST_URL, status: 1 })
    expect(normalizeUrl(String(calls[0]?.url))).toBe('/admin-api/sys/imagemanage')
    expect(calls[0]?.method?.toLowerCase()).toBe('put')
    expect(String(calls[0]?.data)).toBe(
      JSON.stringify({ id: 11, name: 'SDK-TEST-改后', url: TEST_URL, status: 1 }),
    )
  })

  it('不传 status 当场报错（后端那一行会拆箱 NPE，不能把 500 丢给调用方）', async () => {
    const { cap, calls } = capture()
    await expect(
      cap.update({ id: 11, name: 'x' } as unknown as { id: number; status: 1 }),
    ).rejects.toThrow(/发布状态只能是/)
    expect(calls).toHaveLength(0)
  })

  it('只改名字时 body 里只有 id / name / status（url 不传就不发，靠后端部分更新）', async () => {
    const { cap, calls } = capture()
    await cap.update({ id: 11, name: 'SDK-TEST-只改名', status: 0 })
    expect(JSON.parse(String(calls[0]?.data))).toEqual({ id: 11, name: 'SDK-TEST-只改名', status: 0 })
  })

  it('status 传 2 之类的非法值时当场报错', async () => {
    const { cap, calls } = capture()
    await expect(
      cap.update({ id: 11, status: 2 as unknown as 1 }),
    ).rejects.toThrow(/发布状态只能是/)
    expect(calls).toHaveLength(0)
  })
})

describe('改状态 / 删除 —— 载荷形状与基准一致', () => {
  it('setStatus 发 {id, status} 两个键、顺序与基准一致，且是绝对值', async () => {
    const { cap, calls } = capture()
    await cap.setStatus(9, 1)
    const expected = writeOf('base-image-set-status')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(String(calls[0]?.data)).toBe('{"id":9,"status":1}')
    expect(JSON.parse(expected.body)).toHaveProperty('id', 9)
  })

  it('setStatus 传 0 也真的发 0（不是 false / 空）', async () => {
    const { cap, calls } = capture()
    await cap.setStatus(9, 0)
    expect(String(calls[0]?.data)).toBe('{"id":9,"status":0}')
  })

  it('remove 的 body 是数字 id 数组（不是路径参数、不是字符串）', async () => {
    const { cap, calls } = capture()
    await cap.remove(11)
    const expected = writeOf('base-image-remove')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(expected.url))
    expect(calls[0]?.method?.toLowerCase()).toBe('delete')
    expect(String(calls[0]?.data)).toBe('[11]')
    expect(JSON.parse(expected.body)).toEqual([11])
  })

  it('remove 传字符串 id 也归一成数字（后端是 Long[]，基准里就是数字）', async () => {
    const { cap, calls } = capture()
    await cap.remove(['11', 12])
    expect(String(calls[0]?.data)).toBe('[11,12]')
  })
})

// ---------------------------------------------------------------------------
// LIVE 真机（默认跳过）
// ---------------------------------------------------------------------------

const LIVE =
  Boolean(process.env.PORTAL_BASE_URL) &&
  Boolean(process.env.PORTAL_TOKEN) &&
  Boolean(process.env.PORTAL_TENANT_ID)

describe.runIf(LIVE)('LIVE 真实环境 —— 图库管理的读写链路', () => {
  const baseUrl = process.env.PORTAL_BASE_URL as string
  const token = process.env.PORTAL_TOKEN as string
  const tenantId = process.env.PORTAL_TENANT_ID as string
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
  const NAME = `SDK-TEST-图库-冒烟-${stamp}`
  // 改后的名字**故意不包含原名**：imgName 是前缀匹配，`原名-改后` 会被前缀命中，
  // 「旧名字查不到」这类断言会被自己骗过去（作业管理那条线踩过一模一样的坑）
  const NAME2 = `SDK-TEST-图库-改后-${stamp}`
  const NAME3 = `SDK-TEST-图库-发布-${stamp}`
  const URL = 'https://files-test.wodecorp.cn/Public/public/2026/09/wejkhpeuunnshrwj.png'
  const KEEP = process.env.PORTAL_SMOKE_KEEP === '1'

  // 客户端**懒建**：describe 的回调在收集阶段就会跑，`describe.runIf(false)` 也一样，
  // 放在这里直接建会在没有环境变量时因为 baseUrl 是 undefined 而炸在收集期。
  let client: ReturnType<typeof createBaseImageCapability> | null = null
  const cap = () => {
    if (!client) {
      const http = createPortalHttp({ baseUrl, credential: { token, tenantId } })
      const call = createPageCall(
        <T>(requestConfig: unknown) => http.request(requestConfig as never) as unknown as Promise<T>,
      )
      client = createBaseImageCapability((requestConfig) =>
        call(BASE_IMAGE_PAGE_PATH, requestConfig as never),
      )
    }
    return client
  }

  // 裸请求用（有些"后端真实行为"用能力方法表达不出来：比如故意发一个类型不合法的
  // status，或者故意不传 status 去撞那一行拆箱 NPE）。同一个请求层，只是不经过能力。
  let rawClient: AxiosInstance | null = null
  const raw = () => {
    if (!rawClient) rawClient = createPortalHttp({ baseUrl, credential: { token, tenantId } })
    return rawClient
  }

  const created: number[] = []
  const rows = async (imgName: string) => {
    const page = await cap().list({ imgName })
    return page.list ?? []
  }

  it('起手：这个名字现在不该存在', async () => {
    expect(await rows(NAME)).toHaveLength(0)
  })

  it('新建 → 列表里真的出现了 → 详情字段逐项对得上', async () => {
    const before = await cap().list()
    // eslint-disable-next-line no-console
    console.log(`[LIVE] 列表总数（无筛选）= ${before.total}`)

    await cap().create({ name: NAME, url: URL })
    const found = await rows(NAME)
    expect(found).toHaveLength(1)
    const id = Number(found[0]?.id)
    created.push(id)

    const detail = await cap().get(id)
    expect(Number(detail?.id)).toBe(id)
    expect(detail?.name).toBe(NAME)
    expect(detail?.url).toBe(URL)
    expect(Number(detail?.status)).toBe(0)
    expect(Number(detail?.project)).toBe(1)
  })

  it('imgName 是前缀匹配：名字中段查不到，名字开头查得到', async () => {
    const id = created[0] as number
    expect(id).toBeDefined()
    expect(await rows(NAME)).toHaveLength(1)
    // 取名字中间一段（去掉前 4 个字符）——前缀匹配下必须查不到
    expect(await rows(NAME.slice(4))).toHaveLength(0)
  })

  it('setStatus(1) 生效 → get 读回 1；再 setStatus(0) → 读回 0', async () => {
    const id = created[0] as number
    await cap().setStatus(id, 1)
    expect(Number((await cap().get(id))?.status)).toBe(1)
    await cap().setStatus(id, 0)
    expect(Number((await cap().get(id))?.status)).toBe(0)
  })

  it('update 只改名字，url 不会被清空（后端是部分更新）', async () => {
    const id = created[0] as number
    await cap().update({ id, name: NAME2, status: 0 })
    const after = await cap().get(id)
    expect(after?.name).toBe(NAME2)
    expect(after?.url).toBe(URL)
    expect(await rows(NAME)).toHaveLength(0)
    expect(await rows(NAME2)).toHaveLength(1)
  })

  it('update 原样重发一次：终态不变，也没有多出第二条（这就是它不需要防重的实测依据）', async () => {
    const id = created[0] as number
    await cap().update({ id, name: NAME2, status: 0 })
    await cap().update({ id, name: NAME2, status: 0 })
    expect(await rows(NAME2)).toHaveLength(1)
    expect((await cap().get(id))?.name).toBe(NAME2)
  })

  it('后端实测：坏 status（页面上那个下拉发出来的值）会让请求失败，不是"查出 0 条"', async () => {
    // 页面的下拉装的是**订单状态**字典（dictType=status，dictName=「订单状态」，
    // 值是 WAIT_SELLER_CHECK / TRADE_FINISHED …，实测自 /sys/dict/type/all），
    // 而列表接口的 status 是 Integer。两个东西一撞，后端返回的是**失败包络**
    // （HTTP 200 + ret=FAIL），不是空结果 —— 这一点纠正了草稿基线的说法。
    // 页面看着像"查不到数据"，是因为它对失败的处理是把列表清空（list.js 的 catch → listReset）。
    const error = await cap()
      .list({ status: 'TRADE_FINISHED' as unknown as number })
      .then(() => null)
      .catch((e: unknown) => e as Error)
    expect(error).not.toBeNull()
    expect(String(error?.message)).toContain("Failed to convert property value of type 'java.lang.String' to required type 'java.lang.Integer'")
  })

  it('后端实测：PUT 不传 status 直接 500（拆箱 NPE），且记录一个字都没改', async () => {
    const id = created[0] as number
    const before = await cap().get(id)
    const error = await raw()
      .request({ url: '/sys/imagemanage', method: 'put', data: { id, name: 'SDK-TEST-不该写进去' } })
      .then(() => null)
      .catch((e: unknown) => e as Error)
    expect(error).not.toBeNull()
    expect(String(error?.message)).toContain('intValue()')
    // NPE 发生在 setPublishTime 之前，所以更新根本没落库
    const after = await cap().get(id)
    expect(after?.name).toBe(before?.name)
  })

  it('保存并发布：status 直接是 1', async () => {
    await cap().createRelease({ name: NAME3, url: URL })
    const found = await rows(NAME3)
    expect(found).toHaveLength(1)
    const id = Number(found[0]?.id)
    created.push(id)
    expect(Number((await cap().get(id))?.status)).toBe(1)
  })

  it('物理删除：删完列表查不到，get 返回 null', async () => {
    if (KEEP) return
    for (const id of [...created]) {
      await cap().remove(id)
      expect(await cap().get(id)).toBeNull()
    }
    expect(await rows(NAME)).toHaveLength(0)
    expect(await rows(NAME2)).toHaveLength(0)
    expect(await rows(NAME3)).toHaveLength(0)
    created.length = 0
  })

  /**
   * 兜底清理：不管前面在哪一步炸的，都不在测试环境里留 `SDK-TEST-` 前缀的记录。
   * 这条**必须**在最后，而且清理结果要再查一次列表来证实（不是"我调了删除接口"就算数）。
   */
  afterAll(async () => {
    if (KEEP) return
    for (const id of [...created]) {
      await cap().remove(id).catch(() => null)
    }
    created.length = 0
    if (!LIVE) return
    const leftover = await cap().list({ imgName: 'SDK-TEST', pageSize: 50 }).catch(() => null)
    // eslint-disable-next-line no-console
    console.log(`[LIVE] 收尾：SDK-TEST 前缀还剩 ${leftover?.total ?? '查询失败'} 条`)
    expect(leftover?.total ?? 0).toBe(0)
  })
})
