import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance } from 'axios'

import {
  CapabilityInvokeError,
  createPortalHeadless,
  createPortalServer,
  createRequestId,
  IdempotencyKeyReuseError,
  IdempotencyRequestIdError,
  PortalApiError,
  PortalCredentialError,
  type OssUploadResult,
} from '../src/index.js'
// 错误类只在能力模块里导出（包根没转出）—— 文档里因此按 `error.name` 判，见 docs/usage.md §10.4
import { OssCredentialError } from '../src/capabilities/base-upload.js'

/**
 * `docs/usage.md` 里的每一个用例都在这里跑一遍。
 *
 * 目的不是覆盖业务逻辑（那由各自的测试负责），而是**让文档不会腐烂**：
 * 文档里写了但 API 已经改掉的调用，会在这里编译失败或断言失败。
 * 改 API 时如果忘了改文档，这条会先红。
 *
 * 全部走桩适配器，不发真实请求。
 */

type Stub = { calls: Array<{ url?: string; method?: string; data?: unknown }> }

function stub (sdk: ReturnType<typeof createPortalHeadless>, data: unknown = { list: [], total: 0 }): Stub {
  const calls: Stub['calls'] = []
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as never)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  return { calls }
}

const config = { baseUrl: 'https://biz-api-test.wodecorp.cn', credential: { token: 't', tenantId: 1 } }

describe('docs/usage.md 用例 1：最小可用', () => {
  it('meetingRoom.list 能调，且带上 renren 默认参数', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk)

    const page = await sdk.meetingRoom.list({ pageNo: 1, pageSize: 20 })

    expect(page).toEqual({ list: [], total: 0 })
    expect(String(s.calls[0]?.url)).toContain('order=')
  })
})

describe('docs/usage.md 用例 2：AI 找路', () => {
  it('recommend → describe → 按契约调用', async () => {
    const sdk = createPortalHeadless(config)

    const rec = sdk.catalog.recommend('帮我订个会议室')
    expect(rec.capabilities.length).toBeGreaterThan(0)
    expect(rec.next.length).toBeGreaterThan(0)

    const cap = rec.capabilities[0]!
    const usage = sdk.catalog.describe(cap.id)
    // DescribeResult 是带判别字段的联合类型：命中才有 llmToolId / consume。
    // 文档里要提醒调用方先判 ok——这里用真正的收窄而不是断言。
    if (!usage.ok) throw new Error(`describe(${cap.id}) 未命中`)
    expect(usage.llmToolId).toBe(`${cap.id}-llm`)
    expect(Array.isArray(usage.consume.keyFields)).toBe(true)

    // 文档里写的下钻四件套
    expect(sdk.catalog.listDomains().domains.length).toBeGreaterThan(0)
    expect(sdk.catalog.listPages('meeting-room').pages.length).toBeGreaterThan(0)
    expect(sdk.catalog.describePage('/dashboard/meeting-room/list').ok).toBe(true)
    expect(sdk.catalog.search('工资').hits.length).toBeGreaterThan(0)
  })

  it('xxx-llm 的写法等价', () => {
    const sdk = createPortalHeadless(config)
    expect(sdk.catalog.describe('meeting-room-usage-llm')).toEqual(
      sdk.catalog.describe('meeting-room-usage'),
    )
  })
})

describe('docs/usage.md 用例 3：写操作三步', () => {
  it('prepare（只读）→ submit → cancelReservation', async () => {
    const sdk = createPortalHeadless(config)

    const s = stub(sdk, [])
    const draft = {
      meetingName: '周会',
      meetingRoomId: 5,
      startTime: '2026-09-22 14:00:00',
      endTime: '2026-09-22 15:00:00',
      attendeeCount: 2,
    }
    const { tasks } = await sdk.meetingApplication.prepare(draft)
    expect(tasks).toEqual([])
    expect(String(s.calls[0]?.url)).toContain('getRequiredStartUserSelectTasks')

    const s2 = stub(sdk, 42)
    const id = await sdk.meetingApplication.submit(draft, {})
    expect(id).toBe(42)
    expect(String(s2.calls[0]?.url)).toContain('/create')

    const s3 = stub(sdk, null)
    await sdk.meetingApplication.cancelReservation(Number(id))
    expect(String(s3.calls[0]?.url)).toContain('cancel-reservation/42')
  })

  it('本地校验会先拦住不合规的载荷（文档里列了那几条规则）', async () => {
    const sdk = createPortalHeadless(config)
    stub(sdk)

    await expect(
      sdk.meetingApplication.submit({ ...validDraft(), startTime: '2026-09-22 14:15:00' }, {}),
    ).rejects.toThrow(/分钟/)
    await expect(
      sdk.meetingApplication.submit({ ...validDraft(), meetingName: '' }, {}),
    ).rejects.toThrow(/会议名称/)
  })
})

function validDraft () {
  return {
    meetingName: '周会',
    meetingRoomId: 5,
    startTime: '2026-09-22 14:00:00',
    endTime: '2026-09-22 15:00:00',
    attendeeCount: 2,
  }
}

describe('docs/usage.md 用例 4：多用户', () => {
  it('forSession 返回带 call 与两个能力集的门面', async () => {
    const server = createPortalServer({ baseUrl: 'https://biz-api-test.wodecorp.cn' })
    const scoped = await server.forSession({
      userId: 'u1',
      credential: { token: 't', tenantId: 1 },
      capabilities: [],
    })

    expect(typeof scoped.call).toBe('function')
    expect(typeof scoped.meetingRoom.list).toBe('function')
    expect(typeof scoped.meetingApplication.roomUsage).toBe('function')
    expect(server.catalog.listDomains().domains.length).toBeGreaterThan(0)
  })
})

describe('docs/usage.md 用例 5：会话', () => {
  it('peek / ensure / has / failureList / invalidate / stats 都在', async () => {
    const server = createPortalServer({ baseUrl: 'https://biz-api-test.wodecorp.cn' })
    const scoped = await server.forSession({
      userId: 'u1',
      credential: { token: 't', tenantId: 1 },
      capabilities: [],
    })

    expect(server.sessions.peek({ userId: 'u1', tenantId: 1 })).toBe(scoped.session)
    expect(typeof scoped.session.ensure).toBe('function')
    expect(typeof scoped.session.has).toBe('function')
    expect(Array.isArray(scoped.session.failureList())).toBe(true)
    expect(typeof scoped.session.invalidate).toBe('function')

    expect(typeof server.sessions.invalidateCapability).toBe('function')
    expect(typeof server.sessions.invalidateUser).toBe('function')
    expect(typeof server.sessions.invalidate).toBe('function')

    const stats = server.sessions.stats()
    for (const key of ['sessions', 'pending', 'created', 'hits', 'misses', 'expired', 'evicted', 'invalidated', 'degraded', 'loads']) {
      expect(stats).toHaveProperty(key)
    }
  })
})

describe('docs/usage.md 用例 6：长选项参数', () => {
  it('有 keyword 能调；无 keyword 或 pageSize=-1 被本地拒绝', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, { list: [], total: 0 })

    await sdk.meetingApplication.searchUsers({ keyword: '李', pageSize: 20 })
    expect(String(s.calls[0]?.url)).toContain('nickname=')

    await expect(sdk.meetingApplication.searchUsers({})).rejects.toThrow(/长选项参数/)
    await expect(
      sdk.meetingApplication.searchUsers({ keyword: '李', pageSize: -1 }),
    ).rejects.toThrow(/全量拉取/)
  })
})

describe('docs/usage.md 用例 7：错误处理', () => {
  it('两类错误都能按 instanceof 区分，且带上 code', async () => {
    const sdk = createPortalHeadless(config)

    ;(sdk.http as AxiosInstance).defaults.adapter = async (cfg) => ({
      data: { ret: 'FAIL', code: 401, msg: '账号未登录', data: null },
      status: 200, statusText: 'OK', headers: {}, config: cfg,
    })
    await expect(sdk.meetingRoom.list()).rejects.toBeInstanceOf(PortalCredentialError)

    ;(sdk.http as AxiosInstance).defaults.adapter = async (cfg) => ({
      data: { ret: 'FAIL', code: 500, msg: '该时间段会议室已被预定', data: null },
      status: 200, statusText: 'OK', headers: {}, config: cfg,
    })
    await expect(sdk.meetingRoom.list()).rejects.toBeInstanceOf(PortalApiError)
  })
})

describe('docs/usage.md 用例 8：直接调接口', () => {
  it('call() 的第一个参数是页面上下文', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, {})

    await sdk.call('/dashboard/analysis/person/list', { url: '/some/read', method: 'get' })

    const headers = s.calls[0] as unknown as { headers: Record<string, string> }
    expect(headers.headers['module-type']).toBe('13')
  })
})

// ---------------------------------------------------------------------------
// 用例 9/10 的夹具
//
// 用例 9 沿用上面的 `stub()`（假 HTTP 适配器）；用例 10 打的是 OSS 而不是 Portal 后端，
// 所以另配一个**假 fetch**：记下每次请求、一律回 200。**一个字节都不出本机。**
// ---------------------------------------------------------------------------

/** 显然是假的凭据。任何真实 AK/SK **都不许**出现在这个文件里。 */
const FAKE_OSS = {
  accessKeyId: 'test-ak-id',
  accessKeySecret: 'test-ak-secret',
  bucket: 'test-bucket',
  endpoint: 'oss-cn-hangzhou.aliyuncs.com',
} as const

/** 固定时刻 2026-09-20 12:34:56 UTC：对象名与签名都从它算，保证可复现 */
const FIXED_DATE = new Date(Date.UTC(2026, 8, 20, 12, 34, 56))

type OssCall = { url: string; method: string; headers: Record<string, string>; body?: string }

/** 假 OSS：GetObjectACL 一律回 `public-read`，其余一律 200 */
function fakeOss () {
  const calls: OssCall[] = []
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[key] = String(value)
    }
    const body = init.body === undefined || init.body === null
      ? undefined
      : Buffer.from(init.body as Uint8Array).toString('utf8')
    calls.push({
      url,
      method: String(init.method ?? 'GET'),
      headers,
      ...(body === undefined ? {} : { body }),
    })
    if (init.method === 'GET') {
      return new Response(
        '<AccessControlPolicy><AccessControlList><Grant>public-read</Grant></AccessControlList></AccessControlPolicy>',
        { status: 200 },
      )
    }
    return new Response('', { status: 200 })
  }
  return { fetchImpl, calls }
}

/** 建一个配了假 OSS 的单用户门面（凭据、时钟、随机名、fetch 全是假的） */
function sdkWithOss () {
  const oss = fakeOss()
  const sdk = createPortalHeadless({
    ...config,
    oss: {
      ...FAKE_OSS,
      runtime: {
        fetch: oss.fetchImpl,
        now: () => FIXED_DATE,
        randomName: () => 'abcdefghijklmnop',
      },
    },
  })
  return { sdk, oss }
}

// ---------------------------------------------------------------------------
// 用例 9：基础数据（部门 / 字典 / 权限清单）
// ---------------------------------------------------------------------------

describe('docs/usage.md 用例 9：基础数据（部门 / 字典 / 权限清单）', () => {
  it('字典：先搜 dictType 名，再按 dictType 取；近 1 MB 的载荷只打一次', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, [
      {
        dictType: 'assignment_type',
        dataList: [
          { id: '1', dictType: 'assignment_type', value: '1', label: '文件' },
          // label 的前导空格是实测如此（assignment_type 的「 图片+文字」），能力原样返回、不 trim
          { id: '2', dictType: 'assignment_type', value: '2', label: ' 图片+文字' },
        ],
      },
    ])

    const found = await sdk.baseData.searchDictTypes({ keyword: 'assignment' })
    expect(found).toEqual({
      list: [{ dictType: 'assignment_type', entryCount: 2 }],
      total: 1,
      matched: 1,
    })
    expect(String(s.calls[0]?.url)).toContain('/admin-api/system/dict-data/grouped-list')

    const { dictType, entries } = await sdk.baseData.getDict('assignment_type')
    expect(dictType).toBe('assignment_type')
    expect(entries.map((entry) => entry.label)).toEqual(['文件', ' 图片+文字'])

    // 传数字 1 也能命中（比对做了 String() 归一）；查不到的码**不抛错**
    expect(await sdk.baseData.translateDict({ dictType: 'assignment_type', value: 1 })).toEqual({
      dictType: 'assignment_type',
      value: 1,
      label: '文件',
      found: true,
    })
    expect(
      (await sdk.baseData.translateDict({ dictType: 'assignment_type', value: '9' })).found,
    ).toBe(false)

    // dictType 写错是**报错**，不是静默返回空数组
    await expect(sdk.baseData.getDict('assigment_type')).rejects.toThrow(/不存在/)

    // 上面四次调用只发了一次请求 —— 片级索引 + 单飞（Portal 自己一次首屏要打 4 遍）
    expect(s.calls.length).toBe(1)

    // 要强制拿最新时按片失效：下一次调用会重新发请求
    sdk.baseData.invalidate('dict')
    await sdk.baseData.getDict('assignment_type')
    expect(s.calls.length).toBe(2)
  })

  it('部门：按关键字搜 / 按 id 取（含从根到它的路径）/ 取直接下级', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, [
      { id: 1, name: '沃德辰龙', parentId: 0 },
      { id: 2, name: '华都峪口', parentId: 1 },
      { id: 3, name: '财务中心', parentId: 2 },
      { id: 4, name: '思玛特财务中心', parentId: 2 },
    ])

    const hit = await sdk.baseData.searchDepartments({ keyword: '财务' })
    expect(hit).toEqual({
      list: [
        { id: 3, name: '财务中心', parentId: 2 },
        { id: 4, name: '思玛特财务中心', parentId: 2 },
      ],
      total: 4,
      matched: 2,
    })
    expect(String(s.calls[0]?.url)).toContain('/admin-api/system/dept/list-all-simple')
    // pagePath 是合成的 /base-data/*：匹配不到模块表 → **不发 module-type 头**（conventions 第 2 条）
    const headers = s.calls[0] as unknown as { headers: Record<string, string> }
    expect(headers.headers['module-type']).toBeUndefined()

    // 无关键字 = 长选项参数，本地直接拒，且不发请求
    await expect(sdk.baseData.searchDepartments({ keyword: '  ' })).rejects.toThrow(/长选项参数/)
    expect(s.calls.length).toBe(1)

    expect(await sdk.baseData.getDepartment(3)).toEqual({
      id: 3,
      name: '财务中心',
      parentId: 2,
      path: [
        { id: 1, name: '沃德辰龙' },
        { id: 2, name: '华都峪口' },
        { id: 3, name: '财务中心' },
      ],
      pathNames: '沃德辰龙/华都峪口/财务中心',
    })

    expect(await sdk.baseData.listDepartments({ parentId: 2 })).toEqual({
      list: [
        { id: 3, name: '财务中心', parentId: 2 },
        { id: 4, name: '思玛特财务中心', parentId: 2 },
      ],
      total: 2,
    })
    // 根的 parentId 是 0（实测 1551 条里没有 null）
    expect((await sdk.baseData.listDepartments({ parentId: 0 })).list).toEqual([
      { id: 1, name: '沃德辰龙', parentId: 0 },
    ])

    await expect(sdk.baseData.getDepartment(777)).rejects.toThrow(/不存在/)
    await expect(sdk.baseData.listDepartments({ parentId: Number.NaN })).rejects.toThrow(/必须是数字/)
  })

  it('权限码：只回答「有没有」，通用入口与手写路径是同一份实现（G1）', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, ['/dashboard/assignment/assignment', 'investment:daily:account:export'])

    expect(await sdk.baseData.hasPermission('investment:daily:account:export')).toBe(true)
    expect(await sdk.baseData.hasPermission('/dashboard/not/here')).toBe(false)
    // 批量：数组或逗号分隔的字符串都收（invoke 那条路上 ParamSpec 里没有数组类型）
    expect(
      await sdk.baseData.checkPermissions('/dashboard/assignment/assignment, x:y'),
    ).toEqual({
      granted: ['/dashboard/assignment/assignment'],
      missing: ['x:y'],
      checked: 2,
    })
    // 前缀查询就是传前缀
    expect((await sdk.baseData.searchPermissions({ keyword: 'investment:' })).list).toEqual([
      'investment:daily:account:export',
    ])
    // 一份 2159 条的清单在同一个实例里只拉一次
    expect(s.calls.length).toBe(1)

    // 两种入口：describe 给的 sdkPath 就是手写路径；invoke 与它调的是同一个方法
    const described = sdk.catalog.describe('base-permission-has')
    if (!described.ok) throw new Error('describe(base-permission-has) 未命中')
    expect(described.invoke?.sdkPath).toBe('baseData.hasPermission')
    expect(
      await sdk.capabilities.invoke<boolean>('base-permission-has', {
        code: 'investment:daily:account:export',
      }),
    ).toBe(true)

    await expect(sdk.baseData.hasPermission('')).rejects.toThrow(/必填/)
    await expect(sdk.baseData.searchPermissions({ keyword: '' })).rejects.toThrow(/必须提供 keyword/)

    // 多用户门面（§4）上是同一份形状：绑的是那份会话的凭据与租户
    const server = createPortalServer({ baseUrl: 'https://biz-api-test.wodecorp.cn' })
    const scoped = await server.forSession({
      userId: 'u1',
      credential: { token: 't', tenantId: 1 },
      capabilities: [],
    })
    expect(typeof scoped.baseData.hasPermission).toBe('function')
    expect(typeof scoped.baseUpload.describeConfig).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 用例 10：上传（OSS 直传）—— 全部走假 fetch，**一个字节都不打真实 OSS**
// ---------------------------------------------------------------------------

describe('docs/usage.md 用例 10：上传（OSS 直传）', () => {
  it('prepare 预演：算得出 url 与签名，一个字节都不发', async () => {
    const { sdk, oss } = sdkWithOss()

    const prepared = await sdk.baseUpload.prepare({
      content: Buffer.from('hello-oss', 'utf8'),
      folder: 'HR/public',
      fileName: 'photo.png',
      fixedName: 'abcdefghijklmnop',
    })

    expect(oss.calls.length).toBe(0) // 关键：不发网络（因此也不消耗配额、不产生垃圾对象）
    expect(prepared.objectKey).toBe('HR/public/2026/09/abcdefghijklmnop.png')
    expect(prepared.publicUrl).toBe(
      'https://oss-cn-hangzhou.aliyuncs.com/HR/public/2026/09/abcdefghijklmnop.png',
    )
    expect(prepared.headers.Authorization).toBe('OSS test-ak-id:GN5qSxtBO9iUnzDxXyXKp0uitDc=')
    // 拿配置做日志/报错时走 describeConfig：secret 全抹、AK 只留前 4 位
    expect(sdk.baseUpload.describeConfig().accessKeySecret).toBe('<redacted>')
  })

  it('upload：PutObject → PutObjectACL → GetObjectACL 三步，acl 是读回来的', async () => {
    const { sdk, oss } = sdkWithOss()

    const result = await sdk.baseUpload.upload({
      content: Buffer.from('hello-oss', 'utf8'),
      folder: 'HR/public',
      fileName: 'photo.png',
      fixedName: 'abcdefghijklmnop',
    })

    expect(
      oss.calls.map((call) => `${call.method} ${call.url.includes('?acl') ? 'acl' : 'object'}`),
    ).toEqual(['PUT object', 'PUT acl', 'GET acl'])
    // 第二步不能省：桶不是默认公共读，省了会"上传成功但 url 打不开"
    expect(oss.calls[1]?.headers['x-oss-object-acl']).toBe('public-read')
    expect(result).toEqual({
      url: 'https://oss-cn-hangzhou.aliyuncs.com/HR/public/2026/09/abcdefghijklmnop.png',
      objectKey: 'HR/public/2026/09/abcdefghijklmnop.png',
      contentType: 'image/png',
      size: 9,
      acl: 'public-read',
    })
    // 桶里的对象路径就是 prepare 说的那个（两步走的是同一条签名/命名路径）
    expect(oss.calls[0]?.body).toBe('hello-oss')
    // 白名单外的 folder 直接拒（31 个取值取自 Portal 的 ossFilePathOptions）
    await expect(
      sdk.baseUpload.upload({ content: Buffer.from('x'), folder: 'MyOwn/bucket' }),
    ).rejects.toThrow(/白名单/)
    // content（Buffer）与 path（本地文件）二选一：两个都给不猜优先级
    await expect(
      sdk.baseUpload.upload({
        content: Buffer.from('x'),
        path: '/tmp/a.pdf',
        folder: 'HR/public',
      } as never),
    ).rejects.toThrow(/只能给一个/)
  })

  it('通用入口与手写路径是同一份实现（AI 侧给的是 path）', async () => {
    const { sdk, oss } = sdkWithOss()

    const result = await sdk.capabilities.invoke<OssUploadResult>('base-upload-file', {
      // 本测试文件自己就是那个"本地文件"：真实存在的路径，读它不出本机
      path: fileURLToPath(import.meta.url),
      folder: 'Public/public',
      fileName: 'probe.png',
    })

    expect(result.objectKey).toBe('Public/public/2026/09/abcdefghijklmnop.png')
    expect(result.contentType).toBe('image/png')
    expect(result.size).toBeGreaterThan(0)
    expect(result.acl).toBe('public-read')
    expect(oss.calls.length).toBe(3)

    // getAcl / putAcl 单独可用（upload 走到第 2 步失败时用它补，不必重传字节）
    const before = oss.calls.length
    expect(await sdk.baseUpload.getAcl(result.objectKey)).toBe('public-read')
    await sdk.baseUpload.putAcl(result.objectKey, 'public-read')
    expect(
      oss.calls.slice(before).map((call) => `${call.method} ${call.url.includes('?acl') ? 'acl' : 'object'}`),
    ).toEqual(['GET acl', 'PUT acl'])
  })

  it('未配凭据：失败关闭，且一个请求都不发', async () => {
    // vitest 的 node 环境里有**真的**全局 fetch。这一条要证明的是"没凭据时一个字节都不出去"，
    // 所以先把全局 fetch 换成一个只计数的替身 —— 万一失败关闭哪天被改坏，
    // 这一条会红，而**不会真打到 OSS**（本仓库的纪律：绝不打真实 OSS）。
    const realFetch = globalThis.fetch
    let networkCalls = 0
    globalThis.fetch = (async () => {
      networkCalls += 1
      return new Response('', { status: 200 })
    }) as typeof fetch

    try {
      const sdk = createPortalHeadless(config) // 完全没配 oss

      const error = await sdk.baseUpload
        .upload({ path: '/definitely/not/here.bin', folder: 'HR/public' })
        .then(() => '<没有抛错>' as const, (e: unknown) => e)

      expect(error).toBeInstanceOf(OssCredentialError)
      // 文档里按 name 判（类只从能力模块导出，包根没转出）
      expect((error as Error).name).toBe('OssCredentialError')
      expect((error as OssCredentialError).fields).toEqual([
        'accessKeyId',
        'accessKeySecret',
        'bucket',
        'endpoint',
      ])
      expect(String(error)).toContain('不读环境变量')
      // 凭据校验排在参数校验与读本地文件**之前** —— 两边都错时报的是凭据，它才是拦路虎
      expect(String(error)).not.toContain('读不到本地文件')

      // 三个会发请求的方法一个都没漏
      await expect(sdk.baseUpload.getAcl('HR/public/2026/09/a.png')).rejects.toThrow(
        OssCredentialError,
      )
      await expect(sdk.baseUpload.putAcl('HR/public/2026/09/a.png', 'public-read')).rejects.toThrow(
        OssCredentialError,
      )
      expect(networkCalls).toBe(0)

      // 排查用：没配凭据时 describeConfig 也能调、也不抛
      const described = sdk.baseUpload.describeConfig()
      expect(described.accessKeySecret).toBeUndefined()
      expect(described.bucket).toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

// ---------------------------------------------------------------------------
// 用例 11~16：流程表单四条线（通用审批 / 请假 / 用车 / 差旅费）
//
// 与 §9/§10 一样全部走假适配器，**一个真实请求都不发、一个真实提交都不做**。
//
// 流程表单的一条链要打好几个接口、每个接口吃**不同**的响应（请假是
// profile → 时长 → 节点 → create 四步），所以这里另配一个**按 URL 分派**的假后端：
// 上面的 `stub()` 只回同一份 data，喂不动这类链。
// ---------------------------------------------------------------------------

/** 每个接口回不同的 data：`routes` 按 URL 片段匹配、先命中先用；都没命中回 `fallback` */
function stubByUrl (
  sdk: ReturnType<typeof createPortalHeadless>,
  routes: Array<[string, unknown]>,
  fallback: unknown = {},
): Stub {
  const calls: Stub['calls'] = []
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as never)
    const url = String(config.url ?? '')
    const hit = routes.find(([fragment]) => url.includes(fragment))
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: hit === undefined ? fallback : hit[1] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  return { calls }
}

/** axios 走到自定义 adapter 之前已按 transformRequest 把对象序列化成字符串 */
function bodyOf (call: Stub['calls'][number] | undefined): Record<string, unknown> {
  const raw = call?.data
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
}

/** 请求 URL 的最后一段（`…/admin-api/sys/user/info` → `info`） */
function tailOf (call: Stub['calls'][number] | undefined): string {
  return String(call?.url ?? '').split('?')[0]!.split('/').pop() ?? ''
}

/**
 * 这次请求带没带 `module-type` 头。
 *
 * 四条流程线的页面（`/simple/<域>/form/<编号>` 与 `/dashboard/flow/...`）在规则表里**一条都匹配不到**，
 * 浏览器在表单页上同样不发 ⇒ SDK 也不发（conventions 第 2 条：算不出就不发，是忠实不是缺陷）。
 */
function moduleTypeOf (call: Stub['calls'][number] | undefined): string | undefined {
  return (call as unknown as { headers?: Record<string, string> } | undefined)?.headers?.[
    'module-type'
  ]
}

/** 通用审批的草稿（**显然是测试数据**：本文件一个真实提交都不做） */
const APPROVAL_DRAFT = {
  applicationItem: 'SDK-TEST-流程表单',
  applicationContent: 'SDK-TEST-流程表单正文',
}

/** 通用审批实测的那 1 个自选节点（`baseline/general-approval.browser.json` 原样） */
const APPROVAL_TASK = {
  id: 'Activity_1o1sabd',
  name: '发起人自选2',
  approvalMode: 'SEQUENTIAL',
  executionMode: 'SEQUENTIAL',
  completionRule: 'ALL_APPROVED',
  minSelectCount: 1,
  maxSelectCount: null,
  selectionOrderRequired: true,
}

const APPROVAL_ASSIGNEES = { Activity_1o1sabd: [197832] }

/** 用车实测的 3 个自选节点：**名字一模一样**，只有 id 不同（见 docs/pages/用车申请.md） */
const VEHICLE_TASKS = [
  { id: 'Activity_0yx86ms', name: '发起人自选', minSelectCount: 1, maxSelectCount: 1, selectionOrderRequired: false },
  { id: 'Activity_0q8l1yc', name: '发起人自选', minSelectCount: 1, maxSelectCount: 1, selectionOrderRequired: false },
  { id: 'Activity_0viq4cx', name: '发起人自选', minSelectCount: 1, maxSelectCount: 1, selectionOrderRequired: false },
]

/** ⚠️ `startUserSelectAssignees` 里放的是 **userId**，不是申请人的 `staffId` */
const VEHICLE_ASSIGNEES = {
  Activity_0yx86ms: [197832],
  Activity_0q8l1yc: [197832],
  Activity_0viq4cx: [197832],
}

/** 用车草稿（与浏览器基准同形：`staffId` 是字符串、`remark` 空值是 `''`） */
const VEHICLE_DRAFT = {
  staffId: '1163',
  staffName: '姚淼鑫',
  reason: 'SDK-TEST-用车事由',
  startTime: '2026-09-22 09:00:00',
  endTime: '2026-09-22 15:00:00',
  destination: 'SDK-TEST-目的地',
}

/** 用车申请人选择器的组织树（实测形状：顶层 1 个，它有 10 个孩子） */
const VEHICLE_ORG_TREE = [
  {
    id: '34',
    name: '沃德辰龙',
    children: [
      { id: '35', name: '华都峪口' },
      { id: '36', name: '北京思玛特' },
      { id: '37', name: '沃德博创' },
      { id: '71', name: '天津沃德' },
      { id: '467', name: '华裕食品公司' },
      { id: '3997', name: '北京沃德' },
      { id: '4026', name: '职能部室' },
      { id: '4094', name: '投资公司' },
      { id: '4099', name: '合伙企业' },
      { id: '4111', name: '峪禽职业学校' },
    ],
  },
]

/** `/sys/user/info`（实测，另加两个不该被投影出去的敏感字段：bcrypt 散列与盐） */
const PROCESS_USER_INFO = {
  id: '18243',
  username: '2021070101',
  realName: '姚淼鑫',
  organizationName: '设计中心1236',
  password2: '$2a$10$X3s2CIV.fqSlm2mQTqxnler4EqFDbsOcOV/0vwmK7RqTAXrLiY0VO',
  salt: '$2a$10$X3s2CIV.fqSlm2mQTqxnle',
}

/** 差旅费草稿：**明细行数组**（本流程与另外三条线最大的形态差别） */
const TRAVEL_DRAFT = {
  orgId: '1558',
  projectExpense: false,
  travelerIds: [14626],
  reasons: 'SDK-TEST-差旅费',
  feePurpose: 'SDK-TEST-费用用途',
  paymentDate: '2026-10-15',
  travelEntryList: [
    {
      startEndDate: ['2026-10-01', '2026-10-03'] as [string, string],
      startRegion: ['110000', '110100', '110101'],
      startAddress: '北京市东城区某路 1 号',
      endRegion: ['110000', '110100', '110101'],
      endAddress: '北京市东城区某路 2 号',
      tripMode: 2,
      trafficAmount: 100.5,
      foodAmount: 20,
      housingAmount: 30,
      otherAmount: 0,
      inputTaxAmount: 5,
    },
  ],
  remark: 'SDK-TEST-其他说明',
  attachments: [],
  payeeInfo: {},
}

/** 审批链预览（`POST /bpm/process-instance/preview`）的实测形状 */
const TRAVEL_PREVIEW = {
  state: 'CONFIRMED',
  nodes: [
    { nodeId: 'Event_1', name: null, type: 'START_EVENT', candidateUsers: [] },
    {
      nodeId: 'Activity_0hpwjd9',
      name: '部门负责人',
      type: 'USER_TASK',
      candidateStrategy: 60,
      candidateUsers: [{ id: 15037, nickname: '胡春然' }],
    },
    {
      nodeId: 'Activity_14di1n7',
      name: '财务副部长',
      type: 'USER_TASK',
      candidateStrategy: 60,
      candidateUsers: [{ id: 17406, nickname: '于树华' }],
    },
    { nodeId: 'Event_2', name: null, type: 'END_EVENT', candidateUsers: [] },
  ],
  copyUsers: [],
}

describe('docs/usage.md 用例 11：流程表单写链路（通用审批为样板）', () => {
  it('prepare（只读）→ submit（invoke 必须带 requestId）→ cancel（要流程实例 id）', async () => {
    const sdk = createPortalHeadless(config)

    // ① prepare：只读。它回答的是「这次提交要人工指定哪些审批人」
    const s = stub(sdk, [APPROVAL_TASK])
    const { payload, tasks } = await sdk.generalApproval.prepare(APPROVAL_DRAFT)
    expect(String(s.calls[0]?.url)).toContain(
      '/hr/general-approval/getTemporaryRequiredStartUserSelectTasks',
    )
    expect(tasks.map((task) => task.id)).toEqual(['Activity_1o1sabd'])
    // 表单页与「我的流程」页都匹配不到 module-type 规则表 → 一个都不发这个头（conventions 第 2 条）
    expect(moduleTypeOf(s.calls[0])).toBeUndefined()
    // 返回的 payload 就是 create 会发的业务字段（这里先看一眼，真提交时是同一份）
    expect(payload).toEqual({ ...APPROVAL_DRAFT, attachments: [], copyUserIds: [] })

    // ② 必填字段没填全：本地就拦（页面的 isGeneralApprovalDataComplete 同款前置），一个请求都不发
    await expect(
      sdk.generalApproval.prepare({ ...APPROVAL_DRAFT, applicationContent: '' }),
    ).rejects.toThrow(/申请内容/)
    expect(s.calls.length).toBe(1)

    // ③ 走通用入口时 requestId 是**必填**：缺了当场抛，同样一个请求都不发
    await expect(sdk.capabilities.invoke('general-approval-submit', APPROVAL_DRAFT)).rejects.toThrow(
      /requestId/,
    )
    expect(s.calls.length).toBe(1)

    // ④ submit：requestId 自己生成、自己保管；节点 id 来自 prepare
    const requestId = createRequestId()
    const s2 = stub(sdk, 42)
    const id = await sdk.capabilities.invoke<number>('general-approval-submit', {
      ...APPROVAL_DRAFT,
      requestId,
      startUserSelectAssignees: APPROVAL_ASSIGNEES,
    })
    expect(id).toBe(42)
    expect(String(s2.calls[0]?.url)).toContain('/hr/general-approval/create')
    // 键顺序也是契约（D20）：startUserSelectAssignees 永远排在最后
    expect(Object.keys(bodyOf(s2.calls[0]))).toEqual([
      'applicationItem',
      'applicationContent',
      'attachments',
      'copyUserIds',
      'startUserSelectAssignees',
    ])

    // ⑤ cancel：submit 返回的是**业务单据 id**，撤销要的是**流程实例 id** —— 先按 businessKey 换
    const s3 = stub(sdk, {
      list: [{ id: 'inst-1', businessKey: '42', processDefinitionKey: 'hr_general_approval' }],
      total: 1,
    })
    await sdk.generalApproval.cancel({ businessKey: Number(id), reason: 'SDK-TEST-撤销' })
    expect(String(s3.calls[0]?.url)).toContain('/bpm/process-instance/my-page')
    expect(String(s3.calls[1]?.url)).toContain('/bpm/process-instance/cancel-by-start-user')
    expect(bodyOf(s3.calls[1])).toEqual({ id: 'inst-1', reason: 'SDK-TEST-撤销' })

    // 已经拿到流程实例 id 时就不用翻列表了（一次请求）
    const s4 = stub(sdk, null)
    await sdk.generalApproval.cancel({ processInstanceId: 'inst-1', reason: 'SDK-TEST-撤销' })
    expect(s4.calls.length).toBe(1)
    // reason 是后端 @NotEmpty：空串本地就拒，不发请求
    await expect(sdk.generalApproval.cancel({ processInstanceId: 'inst-1', reason: ' ' })).rejects.toThrow(
      /reason/,
    )
    expect(s4.calls.length).toBe(1)
  })
})

describe('docs/usage.md 用例 12：写链路防重（D12）', () => {
  it('同 requestId 重发不再发请求；换 requestId 才发；同键换载荷直接抛', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, 7)
    const requestId = createRequestId()
    const params = { ...APPROVAL_DRAFT, requestId, startUserSelectAssignees: APPROVAL_ASSIGNEES }

    expect(await sdk.generalApproval.submitIdempotent(params)).toBe(7)
    expect(s.calls.length).toBe(1)

    // 超时重试：**原样传回同一个 requestId** → 回放上次的结果，一个请求都没再发
    expect(await sdk.generalApproval.submitIdempotent(params)).toBe(7)
    expect(s.calls.length).toBe(1)

    // 换 requestId = 新的写意图 → 真的会再发一次
    // （这就是「每次重试都新生成 requestId」为什么等于没有防重：它不会报错，只会静默失效）
    await sdk.generalApproval.submitIdempotent({ ...params, requestId: createRequestId() })
    expect(s.calls.length).toBe(2)

    // 同一个 requestId 配了**不同的载荷**：不发、不覆盖、不回放，直接抛
    await expect(
      sdk.generalApproval.submitIdempotent({ ...params, applicationItem: 'SDK-TEST-另一次意图' }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError)
    expect(s.calls.length).toBe(2)

    // 根本没给 requestId（类型上它是必填，JS 里能绕过去）：也是本地错误，不发请求
    await expect(
      sdk.generalApproval.submitIdempotent({ ...params, requestId: undefined } as never),
    ).rejects.toBeInstanceOf(IdempotencyRequestIdError)
    expect(s.calls.length).toBe(2)

    // ⚠️ 一条容易读错的边界：参与指纹的是 **payload**，`startUserSelectAssignees` 不在里面
    // （它由 `create` 的最后一步拼上去）。所以「同 requestId 只换了审批人」**不回放、也不报错**，
    // 而是照样回放上次的结果 —— 同一次意图重试就该连人一起原样重试。
    await sdk.generalApproval.submitIdempotent({
      ...params,
      startUserSelectAssignees: { Activity_1o1sabd: [197833] },
    })
    expect(s.calls.length).toBe(2)
  })
})

describe('docs/usage.md 用例 13：流程线的长选项参数', () => {
  it('候选查询不给关键字一律本地拒，一个请求都不发', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, { list: [], total: 0 })

    // 通用审批 / 用车的审批人候选打的是**同一个接口**，都要关键字
    await sdk.generalApproval.searchUsers({ keyword: '李', pageSize: 20 })
    expect(String(s.calls[0]?.url)).toContain('/system/user/simple-page')
    // 差旅费的出差人候选走的是**另一个接口**，判据是同一条
    await sdk.travelExpense.travelers({ keyword: '胡' })
    expect(String(s.calls[1]?.url)).toContain('/sys/user/getUserBasicInfoPage')
    // 不给关键字、但给了部门：允许（页面也有一条按部门收窄的路）
    await sdk.vehicleApplication.approverSearch({ deptId: 100 })
    expect(String(s.calls[2]?.url)).toContain('/system/user/simple-page')

    // 四条会被拒的调用，一个请求都不发（错误路径也是文档的一部分）
    await expect(sdk.generalApproval.searchUsers({})).rejects.toThrow(/长选项参数/)
    await expect(
      sdk.generalApproval.searchUsers({ keyword: '李', pageSize: -1 }),
    ).rejects.toThrow(/全量拉取/)
    await expect(sdk.vehicleApplication.approverSearch({})).rejects.toThrow(/长选项参数/)
    await expect(sdk.travelExpense.travelers({ keyword: '  ' })).rejects.toThrow(/必须先给关键字/)

    expect(s.calls.length).toBe(3)
  })
})

describe('docs/usage.md 用例 14：请假的只读联动（年假余额 / 时长）', () => {
  it('duration / yearRest 是"读"；submit 按页面顺序把它们再打一遍', async () => {
    const sdk = createPortalHeadless(config)
    const s = stubByUrl(sdk, [
      ['/sys/user/info', PROCESS_USER_INFO],
      ['/hr/attendance-user-rel/getRestDuration', 4],
      ['/hr/attendance-user-rel/getYearRest', { rest: 5, unRest: 1.5 }],
      ['/hr/attendance-user-rel/getRequiredStartUserSelectTasks', []],
      ['/hr/attendance-user-rel/create', 66],
      ['/system/dict-data/grouped-list', [
        { dictType: 'absent_type', dataList: [{ label: '探亲假', value: '6' }] },
      ]],
    ])
    const period = { startDate: '2026-09-21', startType: 1, endDate: '2026-09-25', endType: 2 }
    const draft = { type: 6, reason: 'SDK-TEST-探亲假', ...period }

    // 时长是**后端算的**（扣法定节假日）：本地那个 calculateLeaveDays() 不扣，两个不是一回事
    expect(await sdk.leaveApplication.duration(period)).toBe(4)
    // 年假余额：不给 userId 就是当前登录用户（页面上这一格只会查自己）
    expect((await sdk.leaveApplication.yearRest()).unRest).toBe(1.5)
    // 假别字典：页面每次挂载现读，所以**以它为准**，别信写死的那张表
    expect(await sdk.leaveApplication.types()).toEqual([{ label: '探亲假', value: 6 }])

    // 本流程没有自选审批人节点：prepare 的 tasks 实测恒为 []（审批人是 BPMN 里写死的用户 id）
    expect((await sdk.leaveApplication.prepare(draft)).tasks).toEqual([])
    // 表单页的请求一个 module-type 头都不带
    expect(s.calls.every((call) => moduleTypeOf(call) === undefined)).toBe(true)

    // 年休假（type = 13）：余额不够 → 本地就拒，不发 create（页面同样是 message.error 后 return）
    await expect(sdk.leaveApplication.submit({ ...draft, type: 13 }, {})).rejects.toThrow(/年假剩余不足/)

    // 其余类型：submit 一次打 4 个接口，顺序与页面一致
    const before = s.calls.length
    expect(await sdk.leaveApplication.submit(draft, {})).toBe(66)
    expect(s.calls.slice(before).map(tailOf)).toEqual([
      'info', // 发起人信息的四个字段由 profile() 取，**不接受调用方传**
      'getRestDuration', // restDay 现算：它进流程变量，决定 BPMN 走哪条分支
      'getRequiredStartUserSelectTasks', // 本流程实测返回 []，但接口照打
      'create',
    ])
    // 本流程没有自选节点，{} 就是正确答案（仍然要显式传：页面上这个键永远在最后）
    expect(bodyOf(s.calls[s.calls.length - 1]).startUserSelectAssignees).toEqual({})
  })
})

describe('docs/usage.md 用例 15：用车（分页取人 + 3 个自选节点）', () => {
  it('申请人按组织分页查（staffId ≠ userId），三个审批人节点同名只能按 id 认', async () => {
    const sdk = createPortalHeadless(config)
    const s = stubByUrl(sdk, [
      ['/org/organization/getRoleOrganizationTree', VEHICLE_ORG_TREE],
      [
        '/org/staff/getStaffByOrgPage',
        { list: [{ staffId: '1163', name: '姚淼鑫', status: 1 }], total: 1 },
      ],
      ['/hr/vehicle-usage-application/getTemporaryRequiredStartUserSelectTasks', VEHICLE_TASKS],
      ['/hr/vehicle-usage-application/create', 88],
    ])

    // ① 组织范围：页面把顶层节点的 children 摊平（实测这 10 个就是申请人控件的范围）
    const scope = await sdk.vehicleApplication.applicantScope()
    expect(scope.organizationIds).toEqual([
      '35', '36', '37', '71', '467', '3997', '4026', '4094', '4099', '4111',
    ])

    // ② 申请人候选走**分页**接口（页面上那个数组版入口已被后端关掉：超过 1000 人直接 500）
    const page = await sdk.vehicleApplication.applicantPicker({ keyword: '姚', pageSize: 100 })
    expect(page.list?.[0]?.staffId).toBe('1163')
    // pageSize 上限 100（后端 @Max(100)），本地先拦，免得发一个注定 400 的请求
    await expect(sdk.vehicleApplication.applicantPicker({ pageSize: 101 })).rejects.toThrow(/100/)

    // ③ prepare：三个节点**名字一模一样**（都叫「发起人自选」），只有 id 不同
    const { payload, tasks } = await sdk.vehicleApplication.prepare(VEHICLE_DRAFT)
    expect(tasks.map((task) => task.name)).toEqual(['发起人自选', '发起人自选', '发起人自选'])
    expect(tasks.map((task) => task.id)).toEqual(Object.keys(VEHICLE_ASSIGNEES))
    // 载荷里 `staffId` 是**字符串**（浏览器发的就是 `"1163"`），键名也不是 applicantId
    expect(payload.staffId).toBe('1163')
    expect(payload.remark).toBe('')
    expect(s.calls.every((call) => moduleTypeOf(call) === undefined)).toBe(true)

    // ④ submit：每个节点**恰好 1 个 userId**（不是 staffId，两者不是一个 id 空间）
    const s2 = stubByUrl(sdk, [
      ['/getTemporaryRequiredStartUserSelectTasks', VEHICLE_TASKS],
      ['/create', 88],
    ])
    expect(await sdk.vehicleApplication.submit(VEHICLE_DRAFT, VEHICLE_ASSIGNEES)).toBe(88)
    expect(s2.calls.map(tailOf)).toEqual(['getTemporaryRequiredStartUserSelectTasks', 'create'])
    expect(bodyOf(s2.calls[1]).startUserSelectAssignees).toEqual(VEHICLE_ASSIGNEES)

    // ⑤ 一个节点塞两个人：本地拦（本流程 maxSelectCount = 1，通用审批那个节点是 null 就不会拦）
    const s3 = stubByUrl(sdk, [['/getTemporaryRequiredStartUserSelectTasks', VEHICLE_TASKS]])
    await expect(
      sdk.vehicleApplication.submit(VEHICLE_DRAFT, {
        ...VEHICLE_ASSIGNEES,
        Activity_0yx86ms: [197832, 197833],
      }),
    ).rejects.toThrow(/最多选 1 个人/)
    // 这条链只发了一次只读请求，**create 没发出去**
    expect(s3.calls.map(tailOf)).toEqual(['getTemporaryRequiredStartUserSelectTasks'])
  })
})

describe('docs/usage.md 用例 16：差旅费（明细行数组 + 审批链预览）', () => {
  it('明细行按位置展开成省市区、原数组仍留在载荷里，金额由 SDK 算', async () => {
    const sdk = createPortalHeadless(config)
    const s = stubByUrl(sdk, [
      ['/sys/user/info', PROCESS_USER_INFO],
      ['/finance/project/options', []],
      ['/bpm/process-instance/preview', TRAVEL_PREVIEW],
    ])

    const prepared = await sdk.travelExpense.prepare(TRAVEL_DRAFT)
    // 金额总计由 SDK 算（页面上「金额总计」是只读的，不接受调用方传）
    expect(prepared.amount).toBe(155.5)
    // 审批链预览：审批人由 orgId 派生（调用方选不了），所以这里回答的是「会打扰谁」
    expect(prepared.approvers.map((approver) => approver.nickname)).toEqual(['胡春然', '于树华'])
    expect(prepared.previewComplete).toBe(true)
    // 审批链预览：起止事件 + 两个 USER_TASK（差旅费的审批人由 orgId 派生，调用方选不了）
    expect(prepared.approvalChain.map((node) => node.type)).toEqual([
      'START_EVENT', 'USER_TASK', 'USER_TASK', 'END_EVENT',
    ])

    expect(moduleTypeOf(s.calls[0])).toBeUndefined()

    const row = (prepared.payload.travelEntryList as Array<Record<string, unknown>>)[0]!
    expect(row.startProvince).toBe('110000') // 省/市/区按位置展开
    expect(row.startRegion).toEqual(['110000', '110100', '110101']) // 但原数组仍然留着（页面就是这么发的）
    expect(row.travelTotalAmount).toBe(150.5) // **不含**进项税；amount 那一层才含
    expect(row.startDate).toBe('2026-10-01') // 区间控件拆成的两个标量

    // 写链路：一条请求。注意 `fundSource` 在非项目费用时是 undefined ⇒ **序列化后这个键整个消失**
    // （不是 null）——页面 `{...item, fundSource: undefined}` 的产物，照抄
    const s2 = stubByUrl(sdk, [['/finance/bpm-spending-apply-travel/create', 21666]])
    expect(await sdk.travelExpense.submit(TRAVEL_DRAFT)).toBe(21666)
    expect(String(s2.calls[0]?.url)).toContain('/finance/bpm-spending-apply-travel/create')
    const wireRow = (bodyOf(s2.calls[0]).travelEntryList as Array<Record<string, unknown>>)[0]!
    expect('fundSource' in wireRow).toBe(false)
    // 明细行的金额也由 SDK 算，调用方给了也会被覆盖
    expect(wireRow.travelTotalAmount).toBe(150.5)
  })
})

// ---------------------------------------------------------------------------
// 用例 17~19：待办办理（横切能力）
//
// 前面五条流程线做的都是**发起侧**：提交一条单据、把待办推给别人。这条线补的是另一半
// ——**别人提交给我们的单据，SDK 也能办**。它与流程无关，只与 Flowable 的 **task** 有关，
// 入口是 `/bpm/task/**` 与 `/bpm/process-instance/**`，对 82 个流程一视同仁。
//
// 全部走假适配器：**一次真实写请求都不发、一条真人的待办都不动**。
// ---------------------------------------------------------------------------

/**
 * 流程实例 id。三个 id 空间不要混：**业务单据 id**（`submit` 的返回值）、
 * **流程实例 id**（`/bpm/process-instance/my-page` 那一行的 `id`）、
 * **任务 id**（待办列表那一行的 `id`，办理动作要的就是它）。
 */
const TASK_INSTANCE_ID = 'inst-20260921-1'

/** 「我是谁」。页面上来自 pinia 的 `userStore.state.id`；SDK 侧没有接口，只能调用方给（或 `currentUserId()` 推） */
const TASK_ME = 18243
const TASK_OTHER = 197833

/** `GET /bpm/process-instance/get` 的实测形状（办理页头部那一块） */
const TASK_INSTANCE_DETAIL = {
  id: TASK_INSTANCE_ID,
  name: '加班审批',
  status: 1,
  businessKey: '36',
  startUser: { id: 18243, nickname: '姚淼鑫' },
  processDefinition: { key: 'hr_overtime_application', name: '加班审批', formType: 2 },
  // ⚠️ 流程实例的响应里**拿不到表单字段**（恒为 null），别指望从这里读出单据内容
  formFields: null,
}

/**
 * `GET /bpm/process-instance/getWorkflowPath` 的任务树（加签会产生 `children`）。
 *
 * 六个节点里只有一个半是「我该办的」，这一条用例就是要把那三条判据钉住：
 * `status ∈ {1 审批中, 6 委派中}`、`assigneeUser.id == 我`、**递归 children**。
 */
const TASK_WORKFLOW_TREE = [
  {
    id: 'Task_1o1sabd', name: '发起人自选2', status: 1, taskDefinitionKey: 'Activity_1o1sabd',
    assigneeUser: { id: 18243, nickname: '姚淼鑫' },
  },
  {
    id: 'Task_other', name: '部门负责人', status: 1, taskDefinitionKey: 'Activity_0hpwjd9',
    assigneeUser: { id: 197833, nickname: '别人' },
  },
  {
    // id 是**字符串**，判据是 String() 归一后的严格相等 —— `"018243"` 不是 `18243`
    id: 'Task_padded', name: '同形不同值', status: 1, taskDefinitionKey: 'Activity_pad',
    assigneeUser: { id: '018243', nickname: '不是同一个人' },
  },
  {
    id: 'Task_done', name: '已通过', status: 2, taskDefinitionKey: 'Activity_done',
    assigneeUser: { id: 18243, nickname: '姚淼鑫' },
  },
  {
    // 顶层 status === 4（已取消）会被 `workflowPath()` 直接丢掉，连展平都不进
    id: 'Task_cancelled', name: '已取消', status: 4, taskDefinitionKey: 'Activity_cancel',
    assigneeUser: { id: 18243, nickname: '姚淼鑫' },
  },
  {
    id: 'Task_added', name: '加签父（不是我的）', status: 1, taskDefinitionKey: 'Activity_add',
    assigneeUser: { id: 197833, nickname: '别人' },
    children: [
      {
        // 子任务是加签产生的，同样可能在等我；status 6 = 委派中（页面只认 1 与 6）
        id: 'Task_added_child', name: '加签子（委派中，是我的）', status: 6,
        taskDefinitionKey: 'Activity_add_child', assigneeUser: { id: 18243, nickname: '姚淼鑫' },
      },
    ],
  },
]

describe('docs/usage.md 用例 17：待办办理（先看清「该我办」的是哪条，再办）', () => {
  it('instance / workflowPath / myRunningTasks 是三个读；row.id 才是 taskId，assigneeUser.id 决定归谁', async () => {
    const sdk = createPortalHeadless(config)
    const s = stubByUrl(sdk, [
      // ⚠️ 顺序有讲究：`/bpm/process-instance/get` 是 `…/getWorkflowPath` 的前缀，先命中先用
      ['getWorkflowPath', TASK_WORKFLOW_TREE],
      ['/bpm/process-instance/get', TASK_INSTANCE_DETAIL],
    ])

    // ① 流程实例：办理页挂载时打的第一个读（流程名 / 发起人 / 业务单号）
    const instance = await sdk.taskAction.instance(TASK_INSTANCE_ID)
    expect(String(s.calls[0]?.url)).toContain('/bpm/process-instance/get?id=inst-20260921-1')
    expect(instance.name).toBe('加班审批')
    expect(instance.startUser?.id).toBe(TASK_ME)
    // 两条办理页的路径在规则表里都匹配不到 ⇒ 一个 module-type 头都不发（conventions 第 2 条）
    expect(moduleTypeOf(s.calls[0])).toBeUndefined()

    // ② 审批链路：这个流程**有哪些节点**（树 → 展平，加签产生的子任务也在里面）
    const tree = await sdk.taskAction.workflowPath(TASK_INSTANCE_ID)
    expect(String(s.calls[1]?.url)).toContain('/bpm/process-instance/getWorkflowPath')
    expect(String(s.calls[1]?.url)).toContain('processInstanceId=inst-20260921-1')
    expect(tree.map((task) => task.id)).toEqual([
      'Task_1o1sabd', 'Task_other', 'Task_padded', 'Task_done', 'Task_added', 'Task_added_child',
    ])

    // ③ **该我办的是哪条**：`status ∈ {1 审批中, 6 委派中}` 且 `assigneeUser.id == 我`（递归 children）
    const mine = await sdk.taskAction.myRunningTasks(TASK_INSTANCE_ID, TASK_ME)
    expect(mine.map((task) => task.id)).toEqual(['Task_1o1sabd', 'Task_added_child'])
    //   · Task_other        —— 审批中，但**归别人**（assigneeUser.id ≠ 我）
    //   · Task_padded       —— `"018243"` 与 `18243` 不是同一个 id（String() 归一后严格相等）
    //   · Task_done         —— status 2（已通过），已经办完了
    //   · Task_cancelled    —— 顶层 status 4，第二步就丢了
    //   · Task_added_child  —— 加签产生的**子任务**，它也在等我
    // `myRunningTasks()` 自己就是调 `workflowPath()` 再筛 —— 它是**一次读**（上面第 3 条请求），
    // 不是从第 ② 步那份结果里筛出来的：调用方要自己决定这两步是各打一次还是一次就够
    expect(String(s.calls[2]?.url)).toContain('/bpm/process-instance/getWorkflowPath')
    // userId 给不出就等于不筛 —— 本地直接拒，不发请求
    await expect(sdk.taskAction.myRunningTasks(TASK_INSTANCE_ID, '')).rejects.toThrow(/userId 不能为空/)
    expect(s.calls.length).toBe(3)

    // ④ 办它。**`row.id` 就是 taskId**（这里是 `mine[0].id`）—— 不是业务单据 id、也不是流程实例 id
    const s2 = stubByUrl(sdk, [['/bpm/task/approve', true]])
    const requestId = createRequestId()
    await sdk.capabilities.invoke('task-action-approve', { taskId: mine[0]!.id, requestId })
    expect(String(s2.calls[0]?.method).toUpperCase()).toBe('PUT')
    expect(String(s2.calls[0]?.url)).toContain('/bpm/task/approve')
    // 五个键与页面 `handleAudit()` 的 data 一一对应：**两个附件键没传时发空串，不是省略**
    expect(bodyOf(s2.calls[0])).toEqual({
      id: 'Task_1o1sabd',
      reason: '',
      attachmentUrl: '',
      attachmentName: '',
      copyUserIds: [],
    })
    expect(Object.keys(bodyOf(s2.calls[0]))).toEqual([
      'id', 'reason', 'attachmentUrl', 'attachmentName', 'copyUserIds',
    ])
    // 不是我的任务不要硬办：后端 `validateTask()` 会回「只能操作自己的任务」（那是后端的错，不是本地校验）
    expect(moduleTypeOf(s2.calls[0])).toBeUndefined()

    // 通用入口与手写路径是同一份实现（G1）：describe 给的 sdkPath 就是 sdk.taskAction.approve
    const described = sdk.catalog.describe('task-action-approve')
    if (!described.ok) throw new Error('describe(task-action-approve) 未命中')
    expect(described.invoke?.sdkPath).toBe('taskAction.approveIdempotent')
  })
})

describe('docs/usage.md 用例 18：待办的 7 个写能力全部带防重（D12）', () => {
  it('同 requestId 重发不再发请求；换 requestId 才发；同键换载荷直接抛', async () => {
    const sdk = createPortalHeadless(config)
    const s = stubByUrl(sdk, [['/bpm/task/', true]])

    // 七个写能力一个不落。`/bpm/task/**` **零幂等**，而且失败形态最坏：
    // 第一次其实成功了，超时重发第二次会拿到「流程任务不存在」——**调用方会把成功读成失败**。
    const writes: Array<[string, (requestId: string) => Promise<unknown>]> = [
      ['approve', (requestId) => sdk.taskAction.approveIdempotent({ taskId: 'Task_1o1sabd', requestId })],
      ['reject', (requestId) =>
        sdk.taskAction.rejectIdempotent({ taskId: 'Task_1o1sabd', requestId, reason: 'SDK-TEST-不通过' })],
      ['transfer', (requestId) =>
        sdk.taskAction.transferIdempotent({ taskId: 'Task_1o1sabd', requestId, assigneeUserId: TASK_OTHER, reason: 'SDK-TEST-转办' })],
      ['delegate', (requestId) =>
        sdk.taskAction.delegateIdempotent({ taskId: 'Task_1o1sabd', requestId, delegateUserId: TASK_OTHER, reason: 'SDK-TEST-委派' })],
      ['return', (requestId) =>
        sdk.taskAction.returnIdempotent({ taskId: 'Task_1o1sabd', requestId, targetTaskDefinitionKey: 'Activity_1o1sabd', reason: 'SDK-TEST-回退' })],
      ['batchApprove', (requestId) =>
        sdk.taskAction.batchApproveIdempotent({ taskIds: ['Task_1o1sabd', 'Task_added_child'], requestId })],
      ['batchReject', (requestId) =>
        sdk.taskAction.batchRejectIdempotent({ taskIds: ['Task_1o1sabd'], requestId, reason: 'SDK-TEST-批量不通过' })],
    ]

    for (const [label, run] of writes) {
      const before = s.calls.length
      const requestId = createRequestId()

      await run(requestId)
      expect(s.calls.length, `${label}：第一次应当真发一条`).toBe(before + 1)

      // 超时重试：**原样传回同一个 requestId** → 回放上次的结果，一个请求都没再发
      await run(requestId)
      expect(s.calls.length, `${label}：同一个 requestId 重发不该再发请求`).toBe(before + 1)

      // 换 requestId = 新的写意图 → 真的会再发一次
      // （这就是「每次重试都新生成 requestId」为什么等于没有防重：它不报错，只静默失效）
      await run(createRequestId())
      expect(s.calls.length, `${label}：换 requestId 应当再发`).toBe(before + 2)
    }

    // 同一个 requestId 配了**不同的载荷**：不发、不覆盖、不回放，直接抛
    const pinned = createRequestId()
    await sdk.taskAction.approveIdempotent({ taskId: 'Task_1o1sabd', requestId: pinned, reason: 'SDK-TEST-同意' })
    const after = s.calls.length
    await expect(
      sdk.taskAction.approveIdempotent({ taskId: 'Task_1o1sabd', requestId: pinned, reason: 'SDK-TEST-另一次意图' }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError)
    expect(s.calls.length).toBe(after)

    // ⚠️ 与通用审批那条线（§11.2）的一处**形态差异**：任务这条线的指纹就是**全部参数**
    // （`task-action-*` 没有另外的载荷构建器），所以「同 requestId 只多带了一个附件」
    // 也算换了意图、也会抛 —— 而在通用审批上换 `startUserSelectAssignees` 是静默回放的。
    await expect(
      sdk.taskAction.approveIdempotent({
        taskId: 'Task_1o1sabd', requestId: pinned, reason: 'SDK-TEST-同意',
        attachmentUrl: 'https://example.invalid/HR/approval/a.pdf',
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError)
    expect(s.calls.length).toBe(after)

    // 通用入口走的是**同一条**防重路（`task-action-approve` 绑的就是 `approveIdempotent`）：
    // 同 requestId 重发同样只发一次 —— 门面与 invoke 是同一份实现（G1）
    const viaInvoke = createRequestId()
    const beforeInvoke = s.calls.length
    await sdk.capabilities.invoke('task-action-approve', { taskId: 'Task_1o1sabd', requestId: viaInvoke })
    await sdk.capabilities.invoke('task-action-approve', { taskId: 'Task_1o1sabd', requestId: viaInvoke })
    expect(s.calls.length).toBe(beforeInvoke + 1)
  })
})

describe('docs/usage.md 用例 19：驳回要理由、回退前先读 returnOptions', () => {
  it('错误路径一个请求都不发；回退的目标节点只能来自 list-by-return', async () => {
    const sdk = createPortalHeadless(config)
    const s = stubByUrl(sdk, [
      ['/bpm/task/list-by-return', [{ name: '发起人', taskDefinitionKey: 'Activity_1o1sabd' }]],
      ['/bpm/task/return', null],
      ['/bpm/task/reject', null],
    ])

    // 驳回：**审批意见必填**（页面上空意见被 message.error 挡住，后端 reason 是 @NotNull）
    await expect(sdk.taskAction.reject({ taskId: 'Task_1o1sabd', reason: '   ' })).rejects.toThrow(/审批意见/)
    await expect(sdk.taskAction.reject({ taskId: 'Task_1o1sabd' } as never)).rejects.toThrow(/审批意见/)
    // taskId 本身是必填：空 id 发出去只会换回一个难懂的 404
    await expect(sdk.taskAction.reject({ taskId: '' })).rejects.toThrow(/taskId 不能为空/)
    expect(s.calls.length).toBe(0)

    // 回退：**先读它**。`targetTaskDefinitionKey` 的取值只能来自这里
    //（后端把 BPMN 里 UserTask 的 id 放进 `taskDefinitionKey`）
    const options = await sdk.taskAction.returnOptions('Task_1o1sabd')
    expect(String(s.calls[0]?.url)).toContain('/bpm/task/list-by-return')
    expect(options).toEqual([{ name: '发起人', taskDefinitionKey: 'Activity_1o1sabd' }])

    await sdk.taskAction.returnTask({
      taskId: 'Task_1o1sabd',
      targetTaskDefinitionKey: options[0]!.taskDefinitionKey!,
      reason: 'SDK-TEST-回退',
    })
    expect(String(s.calls[1]?.url)).toContain('/bpm/task/return')
    expect(bodyOf(s.calls[1])).toEqual({
      id: 'Task_1o1sabd',
      targetTaskDefinitionKey: 'Activity_1o1sabd',
      reason: 'SDK-TEST-回退',
    })
    // 回退意见也必填（同页面的 formRules）
    await expect(
      sdk.taskAction.returnTask({ taskId: 'Task_1o1sabd', targetTaskDefinitionKey: 'Activity_1o1sabd', reason: ' ' }),
    ).rejects.toThrow(/理由必填/)

    // 转办 / 委派：目标人（用户 id）与理由都必填。⚠️ 会**真的**把待办推给这个人
    await expect(
      sdk.taskAction.transfer({ taskId: 'Task_1o1sabd', assigneeUserId: '', reason: 'SDK-TEST-转办' }),
    ).rejects.toThrow(/assigneeUserId 不能为空/)
    await expect(
      sdk.taskAction.delegate({ taskId: 'Task_1o1sabd', delegateUserId: TASK_OTHER, reason: ' ' }),
    ).rejects.toThrow(/理由必填/)
    // 上面四条全是本地拒绝：只发过回退那一条请求（外加它前面那次只读）
    expect(s.calls.length).toBe(2)

    // 批量办理：附件的形状与单个办理**不一样** —— 提交时被拼成两个逗号分隔的字符串
    const s2 = stubByUrl(sdk, [['/bpm/task/batchApprove', null], ['/bpm/task/batchReject', null]])
    await sdk.taskAction.batchApprove({
      taskIds: ['Task_1o1sabd', 'Task_added_child'],
      attachments: [
        { url: 'https://example.invalid/a.pdf', name: 'a.pdf' },
        { url: 'https://example.invalid/b.pdf', name: 'b.pdf' },
      ],
    })
    expect(bodyOf(s2.calls[0])).toEqual({
      ids: ['Task_1o1sabd', 'Task_added_child'],
      reason: '',
      // `type: 0` 与 `variables: {}` 都是**页面写死的**，照抄
      type: 0,
      attachmentUrl: 'https://example.invalid/a.pdf,https://example.invalid/b.pdf',
      attachmentName: 'a.pdf,b.pdf',
      copyUserIds: [],
      variables: {},
    })
    await sdk.taskAction.batchReject({ taskIds: ['Task_1o1sabd'], reason: 'SDK-TEST-批量不通过' })
    // 批量**不通过**比批量通过少一个 `variables`，且意见必填
    expect(Object.keys(bodyOf(s2.calls[1]))).toEqual([
      'ids', 'reason', 'type', 'attachmentUrl', 'attachmentName', 'copyUserIds',
    ])
    await expect(
      sdk.taskAction.batchReject({ taskIds: ['Task_1o1sabd'], reason: ' ' }),
    ).rejects.toThrow(/批量不通过必须给审批意见/)
    // 抄送人上限 10 人（页面 handleCopyUserChange 截断），本地先拦
    await expect(
      sdk.taskAction.batchReject({
        taskIds: ['Task_1o1sabd'], reason: 'SDK-TEST-批量不通过',
        copyUserIds: Array.from({ length: 11 }, (_, index) => 19000 + index),
      }),
    ).rejects.toThrow(/最多 10 人/)
    expect(s2.calls.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 用例 20~21：加班审批（流程表单的第六条线）
//
// 与前四条线**形态不同**的两件事，也是这条线最值得教的两点：
//   1. 它**没有「发起人自选」节点** —— 审批人由后端按 candidateStrategy=23（直属上级）算出来；
//   2. 因此「别把审批人选成自己」那条守卫**拦不住**，守卫换成基于**真实审批链**的预览比对。
//
// 同样全部走假适配器：**一次真实提交都不做、一条待办都不推**。
// ---------------------------------------------------------------------------

/** 加班申请草稿：**只有这 6 个字段是调用方给的**（另外 6 个由 SDK 按只读联动算） */
const OVERTIME_DRAFT = {
  reason: 'SDK-TEST-加班审批',
  overtimeType: 0,   // 0 工作日加班 / 1 法定节假日加班 / 2 休息日加班
  subsidyType: 0,    // 0 转调休 / 1 转补贴 / 2 后期自行统计
  startTime: '2026-09-22 18:00:00',
  endTime: '2026-09-22 21:00:00',
  breakHours: 0.5,
}

/** `GET /sys/user/info` 的实测形状（另加两个**不许漏出去**的敏感字段：bcrypt 散列与盐） */
const OVERTIME_USER_INFO = {
  id: '18243',
  username: '2021070101',
  realName: '姚淼鑫',
  organizationId: '101',
  organizationName: '设计中心1236',
  password2: '$2a$10$X3s2CIV.fqSlm2mQTqxnler4EqFDbsOcOV/0vwmK7RqTAXrLiY0VO',
  salt: '$2a$10$X3s2CIV.fqSlm2mQTqxnle',
}

/** 审批链预览：本条流程唯一的 `USER_TASK` 是 `candidateStrategy=23`（直属上级），人是后端算的 */
const OVERTIME_PREVIEW = {
  state: 'CONFIRMED',
  nodes: [
    { nodeId: 'Event_1', type: 'START_EVENT', candidateUsers: [] },
    {
      nodeId: 'Activity_158exxp', name: '直属上级审批', type: 'USER_TASK',
      candidateStrategy: 23, candidateStrategyName: '直属上级',
      candidateUsers: [{ id: 15012, nickname: '乔娜' }],
    },
    { nodeId: 'Event_2', type: 'END_EVENT', candidateUsers: [] },
  ],
}

describe('docs/usage.md 用例 20：加班审批的读（没有自选节点 / 只读联动 / 白名单）', () => {
  it('prepare 要收完整载荷、返回 0 个节点；申请人与部门来自 /sys/user/info', async () => {
    const sdk = createPortalHeadless(config)
    const s = stubByUrl(sdk, [
      ['/sys/user/info', OVERTIME_USER_INFO],
      ['/hr/overtime-application/getRequiredStartUserSelectTasks', []],
      ['/bpm/process-definition/get', { key: 'hr_overtime_application', name: '加班审批', formFields: null }],
      ['/bpm/process-instance/preview', OVERTIME_PREVIEW],
    ])

    // `GET /system/user/profile/get` 在这个 token 上报 500 ⇒ `/sys/user/info` 是唯一可用的「我是谁」
    const me = await sdk.overtimeApplication.currentUser()
    expect(me.id).toBe('18243')             // ⚠️ 字符串：页面原样塞进 applicantId 发出去
    expect(me.numericId).toBe(TASK_ME)
    expect(me.organizationId).toBe('101')   // 同样字符串
    // **白名单收敛**：原响应里的 password2 / salt 连返回值里都不会出现
    expect('password2' in me).toBe(false)
    expect('salt' in me).toBe(false)

    const { payload, tasks, derived } = await sdk.overtimeApplication.prepare(OVERTIME_DRAFT)
    // ⚠️ prepare 会**再取一次**当前用户（SDK 不缓存它：组织关系可能刚变过），
    // 所以这里是三条请求：info → info → 自选节点。而且那个节点接口**要收完整载荷**
    //（传 {} 会被后端 @Valid 打回「结束加班时间不能为空」——与通用审批那条线不同）
    expect(s.calls.map(tailOf)).toEqual(['info', 'info', 'getRequiredStartUserSelectTasks'])
    expect(Object.keys(bodyOf(s.calls[2]))).toHaveLength(12)
    // ★ 本流程一个「发起人自选」节点都没有（审批人由后端按直属上级算）
    expect(tasks).toEqual([])
    // 加班时长由 SDK 按页面算法算（3.0 − 0.5 = 2.5）；页面上这一格是 disabled 的，调用方填不了
    expect(derived.overtimeHours).toBe(2.5)
    // 12 个字段一个不多一个不少，键顺序就是 formState 的声明顺序
    expect(Object.keys(payload)).toEqual([
      'applicantId', 'applicantName', 'applyDate', 'applyDepartmentId', 'applyDepartmentName',
      'reason', 'overtimeType', 'subsidyType', 'startTime', 'endTime', 'breakHours', 'overtimeHours',
    ])
    expect(payload.applicantId).toBe('18243')
    expect(payload.overtimeHours).toBe(2.5)
    // 「今天」是**门户时区**的今天（不是加班那一天，也不是进程所在时区的今天）
    expect(String(payload.applyDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // 时间关系与「加班时长为 0」在**发请求之前**就校完
    await expect(
      sdk.overtimeApplication.prepare({ ...OVERTIME_DRAFT, endTime: '2026-09-22 18:00:00' }),
    ).rejects.toThrow(/必须晚于/)
    await expect(
      sdk.overtimeApplication.prepare({ ...OVERTIME_DRAFT, breakHours: 3 }),
    ).rejects.toThrow(/加班时长算出来是 0/)
    expect(s.calls.length).toBe(3)

    // 流程定义：字段契约**不在**接口里（`formFields` 恒为 null），只能读前端源码
    expect((await sdk.overtimeApplication.definition()).formFields).toBeNull()
    expect(String(s.calls[3]?.url)).toContain('/bpm/process-definition/get')

    // ★ 审批链预览：先看清「这次会打扰谁」——调用了谁、以及能不能白名单掉
    const preview = await sdk.overtimeApplication.approvalChain(payload)
    expect(preview.nodes.map((node) => node.type)).toEqual(['START_EVENT', 'USER_TASK', 'END_EVENT'])
    expect(preview.nodes[1]?.candidateStrategyName).toBe('直属上级')
    expect(preview.nodes[1]?.candidateUsers?.[0]?.nickname).toBe('乔娜')
    // 发起人不是链上的任何一个人 ⇒ 守卫放行（纯函数，不发请求）
    expect(sdk.overtimeApplication.findSelfInApprovalChain(preview, TASK_ME)).toEqual([])
    // 守卫**只看 USER_TASK**：事件节点上没有「候选人」这回事（下面这个 START_EVENT 是故意
    // 塞了「我」进去的反例），拿它去比只会是噪音
    expect(
      sdk.overtimeApplication.findSelfInApprovalChain(
        {
          nodes: [
            { nodeId: 'Event_1', type: 'START_EVENT', candidateUsers: [{ id: TASK_ME }] },
            { nodeId: 'Activity_x', type: 'USER_TASK', candidateUsers: [{ id: TASK_OTHER }] },
          ],
        },
        TASK_ME,
      ),
    ).toEqual([])
  })
})

describe('docs/usage.md 用例 21：加班审批的写链路 + 审批链守卫', () => {
  it('submit 的顺序是 4 条请求（只有最后一条是写）；审批链命中发起人本人在 create 之前就抛', async () => {
    const sdk = createPortalHeadless(config)
    const s = stubByUrl(sdk, [
      ['/sys/user/info', OVERTIME_USER_INFO],
      ['/getRequiredStartUserSelectTasks', []],
      ['/bpm/process-instance/preview', OVERTIME_PREVIEW],
      ['/hr/overtime-application/create', 36],
    ])

    // ① 正常路径：① 当前用户 → ② 自选节点 → ③ 审批链预览（★ SDK 加的守卫）→ ④ create
    expect(await sdk.overtimeApplication.submit(OVERTIME_DRAFT)).toBe(36)
    expect(s.calls.map(tailOf)).toEqual([
      'info', 'getRequiredStartUserSelectTasks', 'preview', 'create',
    ])
    expect(String(s.calls[3]?.method).toUpperCase()).toBe('POST')
    // create 的 body = 载荷 + `startUserSelectAssignees`（**永远在最后**）
    expect(Object.keys(bodyOf(s.calls[3]))).toEqual([
      'applicantId', 'applicantName', 'applyDate', 'applyDepartmentId', 'applyDepartmentName',
      'reason', 'overtimeType', 'subsidyType', 'startTime', 'endTime', 'breakHours', 'overtimeHours',
      'startUserSelectAssignees',
    ])
    // 本流程没有自选节点 ⇒ {} 就是正确答案；给了非空值会被 assertTasksCovered 拒掉
    expect(bodyOf(s.calls[3]).startUserSelectAssignees).toEqual({})
    await expect(
      sdk.overtimeApplication.submit(OVERTIME_DRAFT, { startUserSelectAssignees: { Activity_1o1sabd: [TASK_OTHER] } }),
    ).rejects.toThrow(/不是本次的审批人节点/)

    // ② 防重：同 requestId 重发**一个请求都不再发**（重发一次就是第二条流程 + 第二串真人待办）
    const requestId = createRequestId()
    const before = s.calls.length
    expect(await sdk.overtimeApplication.submitIdempotent({ ...OVERTIME_DRAFT, requestId })).toBe(36)
    expect(s.calls.length).toBe(before + 4)
    expect(await sdk.overtimeApplication.submitIdempotent({ ...OVERTIME_DRAFT, requestId })).toBe(36)
    expect(s.calls.length).toBe(before + 4)

    // ③ ★ 守卫：审批链里出现**发起人本人** ⇒ 在 create 之前抛，一个写请求都不发
    const s2 = stubByUrl(sdk, [
      ['/sys/user/info', OVERTIME_USER_INFO],
      ['/getRequiredStartUserSelectTasks', []],
      ['/bpm/process-instance/preview', {
        state: 'CONFIRMED',
        nodes: [
          // START_EVENT 上没有 candidateUsers，拿它去比是自找噪音 —— 守卫只看 USER_TASK
          { nodeId: 'Event_1', type: 'START_EVENT', candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }] },
          {
            nodeId: 'Activity_158exxp', name: '直属上级审批', type: 'USER_TASK',
            candidateStrategy: 23, candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }],
          },
        ],
      }],
      ['/hr/overtime-application/create', 37],
    ])
    await expect(sdk.overtimeApplication.submit(OVERTIME_DRAFT)).rejects.toThrow(/审批链里出现了发起人本人/)
    expect(s2.calls.map(tailOf)).toEqual(['info', 'getRequiredStartUserSelectTasks', 'preview'])
    // 为什么是硬失败而不是 warn：命中时流程当场走完，cancel 必然报「流程不处于运行中」，单据永远撤不掉
    expect(s2.calls.some((call) => String(call.url).includes('/create'))).toBe(false)

    // 逃生口只有一个（`skipSelfApprovalGuard`），只在预览接口本身不可用时才该用
    const s3 = stubByUrl(sdk, [
      ['/sys/user/info', OVERTIME_USER_INFO],
      ['/getRequiredStartUserSelectTasks', []],
      ['/hr/overtime-application/create', 37],
    ])
    expect(await sdk.overtimeApplication.submit(OVERTIME_DRAFT, { skipSelfApprovalGuard: true })).toBe(37)
    expect(s3.calls.map(tailOf)).toEqual(['info', 'getRequiredStartUserSelectTasks', 'create'])

    // ④ 撤销：`create` 返回的是**业务单据 id**，而 cancel 要的是**流程实例 id**
    //（详情接口的响应里没有 processInstanceId）⇒ 给 businessKey 时 SDK 自己去「我的流程」换
    const s4 = stubByUrl(sdk, [
      ['/bpm/process-instance/my-page', {
        list: [{ id: 'inst-9', businessKey: '36', processDefinitionKey: 'hr_overtime_application' }],
        total: 1,
      }],
      ['/bpm/process-instance/cancel-by-start-user', null],
    ])
    await sdk.overtimeApplication.cancel({ businessKey: 36, reason: 'SDK-TEST-撤销' })
    expect(String(s4.calls[0]?.url)).toContain('/bpm/process-instance/my-page')
    expect(bodyOf(s4.calls[1])).toEqual({ id: 'inst-9', reason: 'SDK-TEST-撤销' })
    // 已经有流程实例 id 时就不用翻列表了（一次请求）
    await sdk.overtimeApplication.cancel({ processInstanceId: 'inst-9', reason: 'SDK-TEST-撤销' })
    expect(s4.calls.length).toBe(3)
    // reason 是后端 @NotEmpty：空串本地就拒，不发请求
    await expect(sdk.overtimeApplication.cancel({ processInstanceId: 'inst-9', reason: ' ' })).rejects.toThrow(/reason/)
    // 两个 id 一个都不给也是本地错误
    await expect(sdk.overtimeApplication.cancel({ reason: 'SDK-TEST-撤销' })).rejects.toThrow(/processInstanceId 或 businessKey/)
    expect(s4.calls.length).toBe(3)

    // 走通用入口时 requestId 是**必填**：缺了当场抛 CapabilityInvokeError，一个请求都不发
    const s5 = stubByUrl(sdk, [['/sys/user/info', OVERTIME_USER_INFO]])
    await expect(
      sdk.capabilities.invoke('overtime-application-submit', OVERTIME_DRAFT),
    ).rejects.toBeInstanceOf(CapabilityInvokeError)
    await expect(
      sdk.capabilities.invoke('overtime-application-submit', OVERTIME_DRAFT),
    ).rejects.toThrow(/invoke 必须带 requestId/)
    expect(s5.calls.length).toBe(0)

    // 而给了 requestId 之后，走的**就是**那条防重的路：同 requestId 重发只发一次
    const s6 = stubByUrl(sdk, [
      ['/sys/user/info', OVERTIME_USER_INFO],
      ['/getRequiredStartUserSelectTasks', []],
      ['/bpm/process-instance/preview', OVERTIME_PREVIEW],
      ['/hr/overtime-application/create', 36],
    ])
    const viaInvoke = createRequestId()
    expect(
      await sdk.capabilities.invoke<number>('overtime-application-submit', { ...OVERTIME_DRAFT, requestId: viaInvoke }),
    ).toBe(36)
    expect(s6.calls.length).toBe(4)
    await sdk.capabilities.invoke('overtime-application-submit', { ...OVERTIME_DRAFT, requestId: viaInvoke })
    expect(s6.calls.length).toBe(4)
  })
})
