import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  BUSINESS_TRIP_APPLICATION_FORM_PATH,
  BUSINESS_TRIP_APPLICATION_MY_LIST_PATH,
  BUSINESS_TRIP_APPLICATION_PAGE_PATH,
  BUSINESS_TRIP_APPLICATION_PROCESS_KEY,
  BUSINESS_TRIP_APPLICATION_PROCESS_TYPE,
  COMPANIONS_MAX,
  DESTINATION_MAX,
  ORIGIN_MAX,
  PORTAL_DATE_FORMAT,
  PORTAL_DATE_TIME_FORMAT,
  REASON_MAX,
  TRIP_TYPE_OPTIONS,
  assertNotSelfApprover,
  assertTasksCovered,
  assertTimeOrder,
  assertTripType,
  buildBusinessTripCreatePayload,
  buildBusinessTripPayload,
  businessTripApplicationCapabilities,
  createBusinessTripApplicationCapability,
  dateTimeToMs,
  deriveFieldsFromUser,
  findSelfInApprovalChain,
  normalizeBusinessTripDraft,
  parsePortalDate,
  parsePortalDateTime,
  pickCurrentUser,
  portalToday,
  type ApprovalChainPreview,
  type BusinessTripApplicationDerived,
  type BusinessTripApplicationDraft,
  type PortalCurrentUser,
} from '../src/capabilities/business-trip-application.js'

/**
 * 出差申请（`hr_business_trip_application` / `/simple/hr/form/041`）—— 流程表单第九条线。
 *
 * 三条来源，逐条钉住：
 *   1. `baseline/business-trip-application.browser.json`：真实浏览器抓的只读请求
 *      （其中 `POST /bpm/process-instance/preview` 的 `variables` 就是 `buildSubmitData()` 的产物
 *      —— 本表单的特有路子：点「查看审批流程」就能看到"提交会发什么"，不用真的提交）
 *   2. Portal 前端源码 `app/portal/views/simple/hr/form/041/**`（pc + mobile + common/define.js）
 *   3. 后端源码 `BusinessTripApplicationController` / `BusinessTripApplicationSaveReqVO` /
 *      `BusinessTripApplicationServiceImpl`（`validateTime` / `fillApplicantInfo`）/
 *      `BusinessTripApplicationWorkflowListener` / `db/business_trip_application.sql`
 *
 * 真实写链路的往返记录在 `docs/pages/出差申请.md`。
 */

type BaselineRequest = {
  于: string
  u: string
  via: string
  headers: Record<string, string>
  次数?: number
  备注?: string
  body?: Record<string, unknown>
}
type Baseline = {
  入口: string
  页面: string
  请求: BaselineRequest[]
  表单填写值: {
    '只读（页面 disabled 的 input，来自 /sys/user/info）': Record<string, string>
    用户填: Record<string, unknown>
  }
  提交载荷: {
    body: Record<string, unknown>
    键顺序: string[]
    逐字段类型: Record<string, string>
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/business-trip-application.browser.json'), 'utf8'),
)

/** 去掉主机与一次性时间戳，只留 path + query */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

const baselineUrls = new Set(baseline.请求.map((r) => normalize(r.u)))
const baselinePreview = baseline.请求.find((r) => r.u.endsWith('/bpm/process-instance/preview'))
/** 基准里 preview 的请求体（顶层四个键） */
const baselinePreviewBody = baselinePreview?.body as Record<string, unknown>
/** 基准里 `variables` 那一层（= buildSubmitData() 的真实产物） */
const baselineVariables = baselinePreviewBody.variables as Record<string, unknown>

/**
 * 与基准同一份只读联动结果 + 填写值。**两边各自独立取值**，再由
 * «写死的填写值与基准里记的一致» 那一条兜住漂移。
 */
const BASELINE_DERIVED: BusinessTripApplicationDerived = {
  applicantId: '18243',
  applicantName: '姚淼鑫',
  applyDate: '2026-09-21',
  applyDepartmentId: '101',
  applyDepartmentName: '设计中心1236',
  applyPostId: '702',
  applyPostName: '高级产品经理',
}

const BASELINE_DRAFT: BusinessTripApplicationDraft = {
  tripType: 0,
  companions: 'SDK-TEST-同行人张三、李四',
  startTime: '2026-09-24 09:00:00',
  endTime: '2026-09-24 18:30:00',
  origin: 'SDK-TEST-北京',
  destination: 'SDK-TEST-上海',
  reason: 'SDK-TEST-客户拜访，用于抓取基准',
}

/** 只读联动那份（改草稿做校验用例时用它，避免把"只读字段"也改坏） */
const DERIVED: BusinessTripApplicationDerived = { ...BASELINE_DERIVED }

/** 日常用的一份草稿（不做逐字节对照时用这个） */
const draft: BusinessTripApplicationDraft = {
  tripType: 1,
  companions: 'SDK-TEST-同行人王五',
  startTime: '2026-09-28 08:30:00',
  endTime: '2026-09-28 17:00:00',
  origin: 'SDK-TEST-广州',
  destination: 'SDK-TEST-深圳',
  reason: 'SDK-TEST-出差申请冒烟',
}

/**
 * 【实测 2026-09-21】`POST /bpm/process-instance/preview` 的真实响应形状（原样抄下来）。
 * 审批人是「直属上级」算出来的 **乔娜(15012)**，发起人是 **18243** —— 不是同一个人。
 */
const REAL_PREVIEW: ApprovalChainPreview = {
  processDefinitionId: 'hr_business_trip_application:2:bd6f1c30-a1e4-11f1-9c77-0050568340ed',
  processDefinitionKey: 'hr_business_trip_application',
  processDefinitionName: '出差申请流程',
  state: 'CONFIRMED',
  nodes: [
    { nodeId: 'Event_0start', name: null, type: 'START_EVENT', candidateStrategy: null, candidateUsers: [] },
    {
      nodeId: 'Activity_158exxp',
      name: '直属上级审批',
      type: 'USER_TASK',
      candidateStrategy: 23,
      candidateStrategyName: '直属上级',
      candidateUsers: [{ id: 15012, nickname: '乔娜' }],
      approvalMode: 'SINGLE',
      state: 'CONFIRMED',
    },
    { nodeId: 'Event_1end', name: null, type: 'END_EVENT', candidateStrategy: null, candidateUsers: [] },
  ],
  copyUsers: [],
}

/**
 * 【实测 2026-09-21，**同一天的另一个流程**】`seal_application`（用章审批）的真实审批链形状：
 * 第一个节点是 `candidateStrategy=30（用户）+ candidateUsers=18243` —— **就是发起人本人**。
 *
 * 本能力**没有选**那条流程，正是因为它一提交就会撞上后端的
 * 「流程发起人与审批人相同，自动审核通过」。这条基准在这里的作用是：
 * 用它证明守卫**真的会拦**（不是只对某个构造出来的形状有效）。
 */
const SELF_APPROVER_PREVIEW: ApprovalChainPreview = {
  processDefinitionKey: 'seal_application',
  processDefinitionName: '用章审批',
  state: 'START_USER_SELECT',
  nodes: [
    { nodeId: 'Event_0cpjvq3', name: null, type: 'START_EVENT', candidateUsers: [] },
    {
      nodeId: 'Activity_09tm1if',
      name: '直属上级审批',
      type: 'USER_TASK',
      candidateStrategy: 30,
      candidateStrategyName: '用户',
      candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }],
      state: 'CONFIRMED',
    },
    {
      nodeId: 'Activity_14o2rxv',
      name: '1',
      type: 'USER_TASK',
      candidateStrategy: 35,
      candidateStrategyName: '发起人自选',
      candidateUsers: [],
      state: 'START_USER_SELECT',
    },
    { nodeId: 'Event_1y6dgy8', name: null, type: 'END_EVENT', candidateUsers: [] },
  ],
}

/** 【实测】`/sys/user/info` 的原响应，**含 password2 与 salt**（这两个必须被白名单挡掉） */
const REAL_USER_INFO = {
  id: '18243',
  username: '2021070101',
  // ⚠️ 真实的 bcrypt 串当然不写进仓库：这里放一个哨兵，测试断言它**不会出现在返回值里**
  password2: 'LEAK-CANARY-password2',
  salt: 'LEAK-CANARY-salt',
  realName: '姚淼鑫',
  headUrl: 'http://appimgcdn.world-tech.com.cn/client/imgs/g_55.png',
  email: null,
  mobile: 'LEAK-CANARY-mobile',
  deptId: null,
  superAdmin: 0,
  roleList: null,
  organizationCode: '103010101020706',
  organizationName: '设计中心1236',
  organizationFullPathName: '沃德辰龙-沃德博创-沃德博创-系统研发-设计中心1236',
  organizationId: '101',
  postId: '702',
  postName: '高级产品经理',
  tenantId: '1',
  staffId: '1163',
}

/**
 * 造一个能力实例。`routes` 让每个用例自己决定后端回什么。
 *
 * ⚠️ 默认的 `{}` 是**故意留的**：忘了给路由的用例会拿到 undefined，
 * 于是断言会红，而不是"碰巧过了"。
 *
 * ⚠️ 路由的**判断顺序**很要紧：`/hr/business-trip-application/get` 是
 * `/hr/business-trip-application/getRequiredStartUserSelectTasks` 的**前缀**，
 * 所以自选节点那条必须排在 `detail` 前面。
 */
function makeCapability (
  routes: {
    userInfo?: unknown
    tasks?: unknown
    preview?: unknown
    create?: unknown
    detail?: unknown
    myPage?: unknown
    myPageByPage?: Record<number, unknown>
    cancel?: unknown
  } = {},
  options: { maxScanPages?: number; scanPageSize?: number; now?: () => Date } = {},
) {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    const url = String(config.url)
    let data: unknown = {}
    if (url.includes('/sys/user/info')) data = 'userInfo' in routes ? routes.userInfo : REAL_USER_INFO
    else if (url.includes('getRequiredStartUserSelectTasks')) data = routes.tasks ?? []
    else if (url.includes('/bpm/process-instance/preview')) data = routes.preview ?? REAL_PREVIEW
    else if (url.includes('/hr/business-trip-application/create')) data = routes.create ?? 777
    else if (url.includes('/hr/business-trip-application/get')) data = routes.detail ?? { id: 777 }
    else if (url.includes('/bpm/process-instance/my-page')) {
      if (routes.myPageByPage) {
        const pageNo = Number(/pageNo=(\d+)/.exec(url)?.[1] ?? '1')
        data = routes.myPageByPage[pageNo] ?? { list: [], total: 0 }
      } else {
        data = routes.myPage ?? { list: [], total: 0 }
      }
    } else if (url.includes('cancel-by-start-user')) data = routes.cancel ?? true
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const capability = createBusinessTripApplicationCapability(
    (requestConfig) => sdk.call(BUSINESS_TRIP_APPLICATION_FORM_PATH, requestConfig),
    options,
  )
  return { sdk, calls, capability }
}

/** axios 在到达 adapter 前已按 transformRequest 把对象序列化成字符串 */
function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

function jsonBodyOf (config: InternalAxiosRequestConfig | undefined): Record<string, unknown> {
  return JSON.parse(rawBodyOf(config)) as Record<string, unknown>
}

/** 取请求的查询参数（顺序即 qs 序列化后的顺序） */
function queryOf (config: InternalAxiosRequestConfig | undefined): Array<[string, string]> {
  const query = String(config?.url ?? '').split('?')[1] ?? ''
  if (query === '') return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    return [key, key === '_t' ? '<ts>' : decodeURIComponent(value)] as [string, string]
  })
}

const urlsOf = (calls: InternalAxiosRequestConfig[]) => calls.map((c) => normalize(String(c.url)))
const writeCalls = (calls: InternalAxiosRequestConfig[]) =>
  calls.filter((c) => {
    const method = String(c.method ?? 'get').toLowerCase()
    return method !== 'get' && method !== 'head'
  })
/** ★ create 那一条（"一个写请求都不发"要判的是它，不是"没有 POST" ——
 *  prepare 的 tasks 与守卫的 preview 也都是 POST，但它们不写业务数据） */
const createCalls = (calls: InternalAxiosRequestConfig[]) =>
  calls.filter((c) => String(c.url).includes('/hr/business-trip-application/create'))

/** `x`.repeat 的简写，让长度用例读起来短一点 */
const rep = (n: number) => 'x'.repeat(n)

// ---------------------------------------------------------------------------
// 一、与浏览器基准一致
// ---------------------------------------------------------------------------

describe('出差申请 —— 读链路与浏览器基准一致', () => {
  it('写死的填写值与只读联动结果与基准里记的一致（两边不会各自漂移）', () => {
    expect(baseline.表单填写值.用户填).toEqual({
      tripType: BASELINE_DRAFT.tripType,
      companions: BASELINE_DRAFT.companions,
      startTime: BASELINE_DRAFT.startTime,
      endTime: BASELINE_DRAFT.endTime,
      origin: BASELINE_DRAFT.origin,
      destination: BASELINE_DRAFT.destination,
      reason: BASELINE_DRAFT.reason,
    })
    expect(baseline.表单填写值['只读（页面 disabled 的 input，来自 /sys/user/info）']).toEqual({
      申请人: BASELINE_DERIVED.applicantName,
      申请时间: BASELINE_DERIVED.applyDate,
      申请部门: BASELINE_DERIVED.applyDepartmentName,
      申请岗位: BASELINE_DERIVED.applyPostName,
    })
  })

  it('流程 key / 表单路径 / 入口 URL / processType 四处一致', () => {
    expect(BUSINESS_TRIP_APPLICATION_PROCESS_KEY).toBe('hr_business_trip_application')
    expect(baseline.入口).toContain(`processDefinitionKey=${BUSINESS_TRIP_APPLICATION_PROCESS_KEY}`)
    expect(baseline.入口).toContain('formCustomCreatePath=simple/hr/form/041')
    expect(baseline.页面).toBe('/simple/hr/form/041')
    expect(BUSINESS_TRIP_APPLICATION_FORM_PATH).toBe('/simple/hr/form/041')
    // ★ 实测：两个 processType 都拉过，本流程在 2（审批）里，不在 1（审核）里
    expect(BUSINESS_TRIP_APPLICATION_PROCESS_TYPE).toBe(2)
    expect(BUSINESS_TRIP_APPLICATION_PAGE_PATH).toBe('/dashboard/flow/form/edit')
    expect(BUSINESS_TRIP_APPLICATION_MY_LIST_PATH).toBe('/dashboard/flow/task/my/list')
  })

  it('★ 构造出来的载荷与基准里 variables 那一层**逐字段逐键序**一致', () => {
    const built = buildBusinessTripPayload(BASELINE_DERIVED, BASELINE_DRAFT)
    expect(Object.keys(built)).toEqual(Object.keys(baselineVariables))
    expect(Object.keys(built)).toEqual(baseline.提交载荷.键顺序)
    expect(built).toEqual(baselineVariables)
    // 逐字节地比一次（axios 发出去的就是这个字符串）
    expect(JSON.stringify(built)).toBe(JSON.stringify(baselineVariables))
  })

  it('★ 基准里记的键序**不是**字母序、也不是我另写的一份 —— 它就是 formState 的声明顺序', () => {
    // 期望值是**写死的字面量**：拿 baseline.键顺序 自己断言自己等于什么都没测
    expect(Object.keys(baselineVariables)).toEqual([
      'applicantId',
      'applicantName',
      'applyDate',
      'applyDepartmentId',
      'applyDepartmentName',
      'applyPostId',
      'applyPostName',
      'tripType',
      'companions',
      'startTime',
      'endTime',
      'origin',
      'destination',
      'reason',
    ])
  })

  it('★ 三个 id 类字段在基准里是**字符串**（页面原样发 userStore 的值，不做数字转换）', () => {
    expect(baselineVariables.applicantId).toBe('18243')
    expect(baselineVariables.applyDepartmentId).toBe('101')
    expect(baselineVariables.applyPostId).toBe('702')
    for (const key of ['applicantId', 'applyDepartmentId', 'applyPostId'] as const) {
      expect(typeof baselineVariables[key]).toBe('string')
      expect(baseline.提交载荷.逐字段类型[key]).toContain('字符串')
    }
    // 类型是数字，不是字符串 —— 这一条与上面三条是**相反**的，容易一起抄错
    expect(baselineVariables.tripType).toBe(0)
    expect(typeof baselineVariables.tripType).toBe('number')
  })

  it('★ 三个文本字段在基准里已被 trim（页面的 trimSubmitText）', () => {
    expect(baseline.提交载荷.逐字段类型.companions).toContain('trim')
    expect(baseline.提交载荷.逐字段类型.origin).toContain('trim')
    expect(baseline.提交载荷.逐字段类型.destination).toContain('trim')
    expect(baseline.提交载荷.逐字段类型.reason).toContain('trim')
  })

  it('流程定义请求与基准一致（`GET /bpm/process-definition/get?key=`）', async () => {
    const { calls, capability } = makeCapability()
    await capability.definition()
    const call = calls[0]
    expect(String(call?.method).toLowerCase()).toBe('get')
    expect(normalize(String(call?.url))).toBe(
      '/admin-api/bpm/process-definition/get?key=hr_business_trip_application&_t=<ts>',
    )
    expect(queryOf(call)).toEqual([
      ['key', 'hr_business_trip_application'],
      ['_t', '<ts>'],
    ])
  })

  it('★ preview 的请求体是**四个顶层键**，`variables` 与基准逐字节一致', async () => {
    const { calls, capability } = makeCapability()
    await capability.approvalChain(buildBusinessTripPayload(DERIVED, draft))
    const call = calls[0]
    expect(String(call?.method).toLowerCase()).toBe('post')
    expect(normalize(String(call?.url))).toBe('/admin-api/bpm/process-instance/preview')
    const body = jsonBodyOf(call)
    expect(Object.keys(body)).toEqual(['processDefinitionKey', 'variables', 'startUserSelectAssignees', 'copyUserIds'])
    expect(body.processDefinitionKey).toBe(BUSINESS_TRIP_APPLICATION_PROCESS_KEY)
    expect(body.startUserSelectAssignees).toEqual({})
    expect(body.copyUserIds).toEqual([])
    // 基准里 preview 的 body 也是这四个键，顺序一致
    expect(Object.keys(baselinePreviewBody)).toEqual(Object.keys(body))
  })

  it('三条页面路径都算不出 module-type（SDK 与浏览器一致：不发这个头）', async () => {
    const { sdk } = makeCapability()
    for (const path of [
      BUSINESS_TRIP_APPLICATION_PAGE_PATH,
      BUSINESS_TRIP_APPLICATION_FORM_PATH,
      BUSINESS_TRIP_APPLICATION_MY_LIST_PATH,
    ]) {
      expect(sdk.resolveModuleType(path).moduleType).toBeNull()
    }
  })

  it('基准里记的请求头里没有 module-type（浏览器也没发）', () => {
    const withHeaders = baseline.请求.filter((r) => r.headers)
    expect(withHeaders.length).toBeGreaterThanOrEqual(4)
    for (const request of withHeaders) {
      expect(Object.keys(request.headers)).not.toContain('module-type')
    }
    // 反向对照：确实抓到了带头的请求（否则上面那个循环什么都没检查）
    expect(baseline.请求.some((r) => Object.keys(r.headers).includes('token'))).toBe(true)
  })

  it('★ 基准里凡是凭据类请求头都已被脱敏成 <redacted>（文件里没有凭据）', () => {
    const raw = JSON.stringify(baseline)
    expect(raw).not.toMatch(/Bearer\s/)
    for (const request of baseline.请求) {
      for (const [key, value] of Object.entries(request.headers ?? {})) {
        if (key === 'token' || key === 'Authorization') expect(value).toBe('<redacted>')
      }
    }
    // 反向对照：文件里确实有这两类头（否则上面那个循环是空转）
    const headerNames = baseline.请求.flatMap((r) => Object.keys(r.headers ?? {}))
    expect(headerNames).toContain('token')
    expect(headerNames).toContain('Authorization')
  })

  it('★ 基准里那条 9 页的全量人员目录请求，本能力一条都不打（本表单没有人员控件）', async () => {
    const { calls, capability } = makeCapability()
    await capability.prepare(draft)
    for (const url of urlsOf(calls)) {
      expect(url).not.toContain('user/simple-page')
      expect(url).not.toContain('/system/user/simple-list')
    }
    // 基线里确实记着这条（它是 D6 的现场证据，不是本能力要做的事）
    const ninePages = baseline.请求.filter((r) => r.u.includes('user/simple-page'))
    expect(ninePages).toHaveLength(1)
    expect(ninePages[0]?.次数).toBe(9)
    expect(ninePages[0]?.备注).toContain('本能力一条都不打')
  })

  it('能力挂的页面路径**不在**「发起流程」那一条上（否则会把目录里的页面错标成已完成）', () => {
    type CatalogPage = { menuPath: string | null; permission: string; title: string }
    const catalog = JSON.parse(
      readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
    ) as { total: number; items: CatalogPage[] }
    expect(catalog.total).toBeGreaterThan(0)
    const paths = new Set(
      catalog.items.flatMap((p) => [p.menuPath, p.permission]).filter((p): p is string => typeof p === 'string'),
    )
    // 表单页与动态流程页不在菜单目录；撤销入口「我的流程」是当前真实菜单页。
    expect(paths.has(BUSINESS_TRIP_APPLICATION_PAGE_PATH)).toBe(false)
    expect(paths.has(BUSINESS_TRIP_APPLICATION_FORM_PATH)).toBe(false)
    expect(paths.has(BUSINESS_TRIP_APPLICATION_MY_LIST_PATH)).toBe(true)
    // 反向对照：目录里有「发起流程」，证明上述判断不是因为目录整体为空。
    expect(paths.has('/dashboard/flow/task/create/list')).toBe(true)
    expect(paths.has('/dashboard/flow/task/my/list')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 二、日期与时刻解析
// ---------------------------------------------------------------------------

describe('出差申请 —— 日期 / 时刻解析', () => {
  it(`applyDate 必须是 ${PORTAL_DATE_FORMAT}`, () => {
    expect(PORTAL_DATE_FORMAT).toBe('YYYY-MM-DD')
    expect(parsePortalDate('2026-09-21', 'x')).toBe('2026-09-21')
    expect(parsePortalDate(' 2026-09-21 ', 'x')).toBe('2026-09-21')
    expect(() => parsePortalDate('2026-9-21', 'x')).toThrow(/YYYY-MM-DD/)
    expect(() => parsePortalDate('2026/09/21', 'x')).toThrow(/YYYY-MM-DD/)
    expect(() => parsePortalDate('20260921', 'x')).toThrow(/YYYY-MM-DD/)
    // ⚠️ 带时分秒的**不能**冒充 applyDate
    expect(() => parsePortalDate('2026-09-21 00:00:00', 'x')).toThrow(/YYYY-MM-DD/)
    expect(() => parsePortalDate(20260921 as never, 'x')).toThrow(/必须是 'YYYY-MM-DD' 格式的字符串/)
    expect(() => parsePortalDate(null as never, 'x')).toThrow(/必须是 'YYYY-MM-DD' 格式的字符串/)
  })

  it('★ 不存在的日期必须被回读校验拦下（静默进位才是真正要防的那件事）', () => {
    // new Date(2026, 1, 30) 会被静默进位成 3 月 2 日
    expect(() => parsePortalDate('2026-02-30', 'x')).toThrow(/不是一个真实存在的日期/)
    expect(() => parsePortalDate('2026-13-01', 'x')).toThrow(/不是一个真实存在的日期/)
    expect(() => parsePortalDate('2026-04-31', 'x')).toThrow(/不是一个真实存在的日期/)
    // 反向对照：静默进位这件事是真的（否则上面三条钉不住任何东西）
    expect(new Date(2026, 1, 30).getMonth()).toBe(2)
    // 闰年的 2-29 是真实的，不能误伤
    expect(parsePortalDate('2028-02-29', 'x')).toBe('2028-02-29')
    expect(() => parsePortalDate('2026-02-29', 'x')).toThrow(/不是一个真实存在的日期/)
  })

  it(`两个时间必须是 ${PORTAL_DATE_TIME_FORMAT}（页面 formatSubmitDateTime 的形状）`, () => {
    expect(PORTAL_DATE_TIME_FORMAT).toBe('YYYY-MM-DD HH:mm:ss')
    expect(parsePortalDateTime('2026-09-24 09:00:00', 'x')).toBe('2026-09-24 09:00:00')
    expect(parsePortalDateTime(' 2026-09-24 18:30:05 ', 'x')).toBe('2026-09-24 18:30:05')
    // 只有日期、没有时分秒 ⇒ 拒（后端 @DateTimeFormat 也会 400）
    expect(() => parsePortalDateTime('2026-09-24', 'x')).toThrow(/YYYY-MM-DD HH:mm:ss/)
    // 用 T 分隔（ISO）也拒 —— 页面不会产出这种形状
    expect(() => parsePortalDateTime('2026-09-24T09:00:00', 'x')).toThrow(/YYYY-MM-DD HH:mm:ss/)
    // 缺秒
    expect(() => parsePortalDateTime('2026-09-24 09:00', 'x')).toThrow(/YYYY-MM-DD HH:mm:ss/)
    expect(() => parsePortalDateTime(undefined as never, 'x')).toThrow(/必须是 'YYYY-MM-DD HH:mm:ss' 格式的字符串/)
  })

  it('★ 时/分/秒越界要单独报出来（不是笼统说"格式不对"）', () => {
    expect(() => parsePortalDateTime('2026-09-24 24:00:00', 'x')).toThrow(/小时超出 0–23/)
    expect(() => parsePortalDateTime('2026-09-24 10:60:00', 'x')).toThrow(/分钟超出 0–59/)
    expect(() => parsePortalDateTime('2026-09-24 10:00:60', 'x')).toThrow(/秒超出 0–59/)
    // 边界值本身要放行（多值：0 与 23/59/59）
    expect(parsePortalDateTime('2026-09-24 00:00:00', 'x')).toBe('2026-09-24 00:00:00')
    expect(parsePortalDateTime('2026-09-24 23:59:59', 'x')).toBe('2026-09-24 23:59:59')
  })

  it('两个时间里的日期部分也要回读校验（不存在的日期不能靠 00:00:00 混过去）', () => {
    expect(() => parsePortalDateTime('2026-02-30 09:00:00', 'x')).toThrow(/不是一个真实存在的日期/)
    expect(() => parsePortalDateTime('2026-04-31 09:00:00', 'x')).toThrow(/不是一个真实存在的日期/)
  })

  it('dateTimeToMs 按**本地时区**解析（与 dayjs 一致，不能按 UTC 解）', () => {
    // 'YYYY-MM-DD HH:mm:ss' 直接给 new Date() 会被当 UTC 解（Chrome/Node 的既有行为）；
    // 所以实现里把空格换成了 T。这一条钉住"没走那条会偏 8 小时的路"
    const ms = dateTimeToMs('2026-09-24 09:00:00')
    expect(new Date(ms).getFullYear()).toBe(2026)
    expect(new Date(ms).getMonth()).toBe(8)
    expect(new Date(ms).getDate()).toBe(24)
    expect(new Date(ms).getHours()).toBe(9)
    // 同一天的两个时刻，差 9.5 小时
    expect(dateTimeToMs('2026-09-24 18:30:00') - ms).toBe(9.5 * 3600 * 1000)
  })

  it('★ portalToday 按门户时区取"今天"（跑在 UTC 上的进程不能在跨天时算错）', () => {
    // 2026-09-21T17:30:00Z = 北京时间 2026-09-22 01:30 —— 两地在日期上**不同天**
    const crossDay = new Date('2026-09-21T17:30:00Z')
    expect(portalToday(crossDay, 'Asia/Shanghai')).toBe('2026-09-22')
    expect(portalToday(crossDay, 'UTC')).toBe('2026-09-21')
    // 再取一个跨天的：北京时间 23:30 时 UTC 还是同一天的前半天
    const evening = new Date('2026-09-21T15:30:00Z')
    expect(portalToday(evening, 'Asia/Shanghai')).toBe('2026-09-21')
    expect(portalToday(evening, 'UTC')).toBe('2026-09-21')
    // 默认时区就是 Asia/Shanghai
    expect(portalToday(crossDay)).toBe('2026-09-22')
    // 形状必须是 YYYY-MM-DD（en-CA 的短日期），不是 2026/09/22
    expect(portalToday(crossDay)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// 三、本地校验
// ---------------------------------------------------------------------------

describe('出差申请 —— 本地校验', () => {
  it('类型必填，且只能是三个本地常量之一', () => {
    expect(TRIP_TYPE_OPTIONS.map((o) => o.value)).toEqual([0, 1, 2])
    expect(TRIP_TYPE_OPTIONS.map((o) => o.label)).toEqual(['出差', '外出', '海外出差'])
    // 选得出的是 3 个，所以 3 必须被拒（不是"<=2 就行"）
    expect(assertTripType(0)).toBe(0)
    expect(assertTripType(1)).toBe(1)
    expect(assertTripType(2)).toBe(2)
    expect(() => assertTripType(3)).toThrow(/只能是 0=出差 \/ 1=外出 \/ 2=海外出差/)
    expect(() => assertTripType(-1)).toThrow(/只能是/)
    expect(() => assertTripType(1.5)).toThrow(/只能是/)
    // 必填的三条路子：null / undefined / 空串（页面 a-select 无默认值，不选就是 null）
    expect(() => assertTripType(null)).toThrow(/必填/)
    expect(() => assertTripType(undefined)).toThrow(/必填/)
    expect(() => assertTripType('')).toThrow(/必填/)
  })

  it('★ 三个文本框必填 + 各自的上限（500 / 200 / 200 / 500，期望值是写死的数字）', () => {
    // 常量本身钉一下（改了要有人知道），但**不用它当断言的右边**
    expect(COMPANIONS_MAX).toBe(500)
    expect(ORIGIN_MAX).toBe(200)
    expect(DESTINATION_MAX).toBe(200)
    expect(REASON_MAX).toBe(500)

    const fields = [
      { key: 'companions', max: 500, label: '同行人' },
      { key: 'origin', max: 200, label: '始发地' },
      { key: 'destination', max: 200, label: '目的地' },
      { key: 'reason', max: 500, label: '事由' },
    ] as const

    for (const field of fields) {
      // 恰好到上限要放行
      expect(normalizeBusinessTripDraft({ ...draft, [field.key]: rep(field.max) })[field.key]).toHaveLength(field.max)
      // 多一个字就拒，且报错里带的是**这个字段**的名字与这个字段的上限
      expect(() => normalizeBusinessTripDraft({ ...draft, [field.key]: rep(field.max + 1) })).toThrow(
        new RegExp(`${field.label} ${field.key}最多 ${field.max} 个字`),
      )
      // 必填：空串 / 纯空白 / undefined
      expect(() => normalizeBusinessTripDraft({ ...draft, [field.key]: '' })).toThrow(new RegExp(`${field.label} ${field.key} 必填`))
      expect(() => normalizeBusinessTripDraft({ ...draft, [field.key]: '   ' })).toThrow(new RegExp(`${field.label} ${field.key} 必填`))
      expect(() => normalizeBusinessTripDraft({ ...draft, [field.key]: undefined as never })).toThrow(
        new RegExp(`${field.label} ${field.key} 必填`),
      )
      // 非字符串也拒（不能靠 String() 蒙过去）
      expect(() => normalizeBusinessTripDraft({ ...draft, [field.key]: 123 as never })).toThrow(
        new RegExp(`${field.label} ${field.key} 必填`),
      )
    }
  })

  it('★ 四个文本框的报错各自带自己的名字（堵住"四个都写同一个 label"）', () => {
    const messages = [
      () => normalizeBusinessTripDraft({ ...draft, companions: '' }),
      () => normalizeBusinessTripDraft({ ...draft, origin: '' }),
      () => normalizeBusinessTripDraft({ ...draft, destination: '' }),
      () => normalizeBusinessTripDraft({ ...draft, reason: '' }),
    ].map((run) => {
      try {
        run()
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })
    expect(messages[0]).toContain('同行人')
    expect(messages[1]).toContain('始发地')
    expect(messages[2]).toContain('目的地')
    expect(messages[3]).toContain('事由')
    // 四个都不为空、且两两不同（否则上面的 toContain 可能被同一句话满足）
    expect(messages.every((m) => m !== '')).toBe(true)
    expect(new Set(messages).size).toBe(4)
  })

  it('文本框提交前会被 trim（页面 trimSubmitText 那一条）', () => {
    const normalized = normalizeBusinessTripDraft({
      ...draft,
      companions: '  SDK-TEST-王五  ',
      origin: '  广州  ',
      destination: ' 深圳 ',
      reason: '  客户拜访  ',
    })
    expect(normalized.companions).toBe('SDK-TEST-王五')
    expect(normalized.origin).toBe('广州')
    expect(normalized.destination).toBe('深圳')
    expect(normalized.reason).toBe('客户拜访')
  })

  it('★ 结束时间必须**严格晚于**开始时间（后端 validateTime + 移动端 onEndTimeConfirm 同一条；PC 页缺）', () => {
    // 口径来源写死在注释里：后端 `!endTime.isAfter(startTime)`、移动端 `end.isBefore(start)||end.isSame(start)`,
    // **PC 页**（基准抓的那一页）没有这条 —— 所以这不是"SDK 比页面严"。
    // 相等也要拒：后端是 !endTime.isAfter(startTime)
    expect(() => assertTimeOrder('2026-09-24 09:00:00', '2026-09-24 09:00:00')).toThrow(/严格晚于/)
    // 早于
    expect(() => assertTimeOrder('2026-09-24 09:00:00', '2026-09-24 08:59:59')).toThrow(/严格晚于/)
    // 跨天早于（差一天也不行）
    expect(() => assertTimeOrder('2026-09-24 09:00:00', '2026-09-23 09:00:00')).toThrow(/严格晚于/)
    // 晚 1 秒就放行 —— 边界是多值里的另一个端点，不能只测"明显合法"的那种
    expect(assertTimeOrder('2026-09-24 09:00:00', '2026-09-24 09:00:01')).toEqual({
      startTime: '2026-09-24 09:00:00',
      endTime: '2026-09-24 09:00:01',
    })
    // 跨天晚于也放行
    expect(assertTimeOrder('2026-09-24 23:00:00', '2026-09-25 01:00:00').endTime).toBe('2026-09-25 01:00:00')
    // 报错里同时给出两个值，便于定位
    expect(() => assertTimeOrder('2026-09-24 09:00:00', '2026-09-24 08:00:00')).toThrow(
      /startTime=2026-09-24 09:00:00、endTime=2026-09-24 08:00:00/,
    )
  })

  it('两个时间的格式错会在**先后比较之前**先报出来（不会报成"先后不对"）', () => {
    expect(() => assertTimeOrder('2026-09-24', '2026-09-25 09:00:00')).toThrow(/YYYY-MM-DD HH:mm:ss/)
    expect(() => assertTimeOrder('2026-09-24 09:00:00', '2026-09-25')).toThrow(/YYYY-MM-DD HH:mm:ss/)
    expect(() => assertTimeOrder(undefined, '2026-09-25 09:00:00')).toThrow(/必须是 'YYYY-MM-DD HH:mm:ss' 格式的字符串/)
  })

  it('★ 本地校验不过 ⇒ **一个请求都不发**（`prepare` 也一样）', async () => {
    const bads: Array<Partial<BusinessTripApplicationDraft>> = [
      { reason: '' },
      { companions: '' },
      { origin: '' },
      { destination: '' },
      { tripType: 9 },
      { tripType: undefined },
      { endTime: '2026-09-28 08:29:59' },
      { startTime: '2026-09-28' },
    ]
    for (const bad of bads) {
      const { calls, capability } = makeCapability()
      await expect(capability.submit({ ...draft, ...bad })).rejects.toThrow()
      expect(calls).toHaveLength(0)
      const { calls: prepareCalls, capability: prepareCapability } = makeCapability()
      await expect(prepareCapability.prepare({ ...draft, ...bad })).rejects.toThrow()
      expect(prepareCalls).toHaveLength(0)
    }
  })

  it('★ 8 组非法草稿的报错各不相同（堵住"所有校验都走同一条兜底"）', () => {
    const messages = (
      [
        { reason: '' },
        { companions: '' },
        { origin: '' },
        { destination: '' },
        { tripType: 9 },
        { endTime: '2026-09-28 08:29:59' },
        { startTime: '2026-09-28' },
        { companions: rep(501) },
      ] as Array<Partial<BusinessTripApplicationDraft>>
    ).map((bad) => {
      try {
        normalizeBusinessTripDraft({ ...draft, ...bad })
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })
    expect(messages.every((m) => m !== '')).toBe(true)
    expect(new Set(messages).size).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// 四、载荷构造
// ---------------------------------------------------------------------------

describe('出差申请 —— 载荷构造', () => {
  it('键顺序 = formState 的声明顺序（= 基准里 variables 的键顺序）', () => {
    const built = buildBusinessTripPayload(DERIVED, draft)
    expect(Object.keys(built)).toEqual([
      'applicantId',
      'applicantName',
      'applyDate',
      'applyDepartmentId',
      'applyDepartmentName',
      'applyPostId',
      'applyPostName',
      'tripType',
      'companions',
      'startTime',
      'endTime',
      'origin',
      'destination',
      'reason',
    ])
    expect(Object.keys(built)).toHaveLength(14)
  })

  it('★ 三个 id 类只读字段**原样发字符串**，不做数字转换', () => {
    const built = buildBusinessTripPayload(
      { ...DERIVED, applicantId: '18243', applyDepartmentId: '101', applyPostId: '702' },
      draft,
    )
    expect(built.applicantId).toBe('18243')
    expect(built.applyDepartmentId).toBe('101')
    expect(built.applyPostId).toBe('702')
    expect(typeof built.applicantId).toBe('string')
    expect(typeof built.applyDepartmentId).toBe('string')
    expect(typeof built.applyPostId).toBe('string')
    // 就算调用方给了数字，也要按原样发出去（**不做转换**），因为页面就是原样发的
    const numeric = buildBusinessTripPayload(
      { ...DERIVED, applicantId: 18243 as unknown as string },
      draft,
    )
    expect(numeric.applicantId).toBe(18243)
  })

  it('tripType 以**数字**发出去（与三个字符串 id 形成对照）', () => {
    for (const type of [0, 1, 2]) {
      const built = buildBusinessTripPayload(DERIVED, { ...draft, tripType: type })
      expect(built.tripType).toBe(type)
      expect(typeof built.tripType).toBe('number')
      expect(JSON.parse(JSON.stringify(built)).tripType).toBe(type)
    }
  })

  it('★ 7 个只读字段缺**任意一个**都要抛，且报错里点名是哪个', () => {
    const keys = [
      'applicantId',
      'applicantName',
      'applyDate',
      'applyDepartmentId',
      'applyDepartmentName',
      'applyPostId',
      'applyPostName',
    ] as const
    // 逐个删一次 —— 只测一个字段时，"某字段被单独跳过了"这种错误测不出来
    for (const key of keys) {
      const broken = { ...DERIVED } as Record<string, unknown>
      delete broken[key]
      expect(() => buildBusinessTripPayload(broken as never, draft)).toThrow(new RegExp(key))
      // 空串也一样（不是只有 undefined 才算缺）
      expect(() => buildBusinessTripPayload({ ...DERIVED, [key]: '' } as never, draft)).toThrow(
        new RegExp(key),
      )
    }
    // 反向对照：7 个齐全时**不抛**
    expect(() => buildBusinessTripPayload(DERIVED, draft)).not.toThrow()
    // 传 null / undefined 时给的是另一句更有用的报错
    expect(() => buildBusinessTripPayload(null as never, draft)).toThrow(/缺少只读联动的字段/)
    expect(() => buildBusinessTripPayload(undefined as never, draft)).toThrow(/缺少只读联动的字段/)
  })

  it('★ applyDate 必须是 YYYY-MM-DD，别的形状直接拒（后端 @DateTimeFormat 会 400）', () => {
    expect(() => buildBusinessTripPayload({ ...DERIVED, applyDate: '2026-09-21 00:00:00' }, draft)).toThrow(
      /applyDate/,
    )
    expect(() => buildBusinessTripPayload({ ...DERIVED, applyDate: '2026/09/21' }, draft)).toThrow(/applyDate/)
    expect(() => buildBusinessTripPayload({ ...DERIVED, applyDate: '2026-02-30' }, draft)).toThrow(
      /不是一个真实存在的日期/,
    )
    expect(buildBusinessTripPayload({ ...DERIVED, applyDate: '2026-09-21' }, draft).applyDate).toBe('2026-09-21')
  })

  it('四个文本框在载荷里已被 trim（页面 buildSubmitData 就是这么做的）', () => {
    const built = buildBusinessTripPayload(DERIVED, {
      ...draft,
      companions: '  王五  ',
      origin: ' 广州 ',
      destination: ' 深圳 ',
      reason: '  拜访  ',
    })
    expect(built.companions).toBe('王五')
    expect(built.origin).toBe('广州')
    expect(built.destination).toBe('深圳')
    expect(built.reason).toBe('拜访')
  })

  it('create 载荷：`startUserSelectAssignees` **永远在最后**，且默认是 `{}`', () => {
    const built = buildBusinessTripCreatePayload(DERIVED, draft)
    const keys = Object.keys(built)
    expect(keys[keys.length - 1]).toBe('startUserSelectAssignees')
    expect(keys).toHaveLength(15)
    expect(built.startUserSelectAssignees).toEqual({})
    // 前面 14 个与不带 assignees 的那一份逐字段一致
    const { startUserSelectAssignees, ...rest } = built
    expect(startUserSelectAssignees).toEqual({})
    expect(rest).toEqual(buildBusinessTripPayload(DERIVED, draft))
  })

  it('create 载荷：`startUserSelectAssignees` 里的 id 被归一成数字', () => {
    const built = buildBusinessTripCreatePayload(DERIVED, draft, {
      Activity_14o2rxv: ['15012' as unknown as number, 15013],
    })
    expect(built.startUserSelectAssignees).toEqual({ Activity_14o2rxv: [15012, 15013] })
    // 多元素才看得出归一化是逐项做的（只有一个元素时 [0] 与 [last] 同值）
    expect(() => buildBusinessTripCreatePayload(DERIVED, draft, { node: ['x' as unknown as number] })).toThrow(
      /不是数字/,
    )
    expect(() => buildBusinessTripCreatePayload(DERIVED, draft, { node: 'x' as never })).toThrow(/必须是用户 id 数组/)
    expect(() => buildBusinessTripCreatePayload(DERIVED, draft, null as never)).toThrow(/必须是 \{ \[节点 id\]/)
  })
})

// ---------------------------------------------------------------------------
// 五、当前用户白名单 + 到载荷的映射
// ---------------------------------------------------------------------------

describe('出差申请 —— 当前用户白名单', () => {
  it('★ `password2` / `salt` / `mobile` 等不在白名单里的字段**不会出现在返回值里**', () => {
    const user = pickCurrentUser(REAL_USER_INFO)
    const serialized = JSON.stringify(user)
    expect(serialized).not.toContain('LEAK-CANARY')
    expect(serialized).not.toContain('password2')
    expect(serialized).not.toContain('salt')
    expect(serialized).not.toContain('mobile')
    // 白名单是**白名单**：逐字段对一遍，多一个都不行
    expect(Object.keys(user).sort()).toEqual(
      [
        'id',
        'organizationCode',
        'organizationId',
        'organizationName',
        'numericId',
        'postId',
        'postName',
        'realName',
        'staffId',
        'tenantId',
        'username',
      ].sort(),
    )
  })

  it('`id` / `organizationId` / `postId` 都是**字符串**（页面原样发出去）', () => {
    const user = pickCurrentUser(REAL_USER_INFO)
    expect(user.id).toBe('18243')
    expect(user.organizationId).toBe('101')
    expect(user.postId).toBe('702')
    expect(user.numericId).toBe(18243)
    expect(user.realName).toBe('姚淼鑫')
    expect(user.organizationName).toBe('设计中心1236')
    expect(user.postName).toBe('高级产品经理')
  })

  it('缺 id / organizationId 就抛（否则会填出一个空白的申请部门）', () => {
    expect(() => pickCurrentUser({ ...REAL_USER_INFO, id: undefined })).toThrow(/没有 id/)
    expect(() => pickCurrentUser({ ...REAL_USER_INFO, organizationId: undefined })).toThrow(/没有 organizationId/)
    expect(() => pickCurrentUser(null)).toThrow(/当前用户信息为空/)
    expect(() => pickCurrentUser('x')).toThrow(/当前用户信息为空/)
    // 反向对照：两个都在时不抛
    expect(() => pickCurrentUser({ id: 1, organizationId: 2 })).not.toThrow()
  })

  it('★ `deriveFieldsFromUser` 的 7 条映射逐条对（id→applicantId、postId→applyPostId，不是 username）', () => {
    const user = pickCurrentUser(REAL_USER_INFO)
    const derived = deriveFieldsFromUser(user, '2026-09-21')
    expect(derived).toEqual({
      applicantId: '18243', // ← id
      applicantName: '姚淼鑫', // ← realName
      applyDate: '2026-09-21', // ← 传进来的"今天"
      applyDepartmentId: '101', // ← organizationId
      applyDepartmentName: '设计中心1236', // ← organizationName
      applyPostId: '702', // ← postId（**不是** username / staffId）
      applyPostName: '高级产品经理', // ← postName
    })
    // 反向对照：username / staffId 都**没有**被当成岗位或工号混进去
    expect(derived.applyPostId).not.toBe(user.username)
    expect(derived.applyPostId).not.toBe(user.staffId)
  })

  it('★ 缺 postId / postName 时是**空串**，然后被载荷构造拦下（后端会抛「申请岗位不存在」）', () => {
    const user = pickCurrentUser({ ...REAL_USER_INFO, postId: undefined, postName: undefined })
    const derived = deriveFieldsFromUser(user, '2026-09-21')
    expect(derived.applyPostId).toBe('')
    expect(derived.applyPostName).toBe('')
    expect(() => buildBusinessTripPayload(derived, draft)).toThrow(/applyPostId/)
  })

  it('"今天"由调用方（= 门户时区）给，`deriveFieldsFromUser` 不自己取', () => {
    const user = pickCurrentUser(REAL_USER_INFO)
    expect(deriveFieldsFromUser(user, '2026-01-01').applyDate).toBe('2026-01-01')
    expect(deriveFieldsFromUser(user, '2026-12-31').applyDate).toBe('2026-12-31')
    expect(() => deriveFieldsFromUser(user, '2026-1-1')).toThrow(/YYYY-MM-DD/)
  })

  it('★ `resolveDerivedFields` 把 /sys/user/info 与门户时区的今天合起来（now 注入口钉住日期）', async () => {
    const fixedNow = new Date('2026-09-21T17:30:00Z') // 北京时间已是 09-22
    const { calls, capability } = makeCapability({}, { now: () => fixedNow })
    const derived = await capability.resolveDerivedFields(draft)
    expect(derived.applyDate).toBe('2026-09-22')
    expect(calls).toHaveLength(1)
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/sys/user/info?_t=<ts>')
    // 只读联动里没有"算出来"的字段 —— 7 个键，一个不多一个不少
    expect(Object.keys(derived).sort()).toEqual([
      'applicantId',
      'applicantName',
      'applyDate',
      'applyDepartmentId',
      'applyDepartmentName',
      'applyPostId',
      'applyPostName',
    ])
  })
})

// ---------------------------------------------------------------------------
// 六、★ 审批链守卫
// ---------------------------------------------------------------------------

describe('出差申请 —— ★ 审批链守卫', () => {
  it('真实的审批链（发起人 18243）放行 —— 审批人是乔娜(15012)，不是同一个人', () => {
    expect(findSelfInApprovalChain(REAL_PREVIEW, 18243)).toEqual([])
    expect(() => assertNotSelfApprover(REAL_PREVIEW, 18243)).not.toThrow()
    // 反向对照：同一个链，把发起人换成审批人那个 id 就必须命中（否则上面那条是空转）
    expect(findSelfInApprovalChain(REAL_PREVIEW, 15012)).toHaveLength(1)
    expect(() => assertNotSelfApprover(REAL_PREVIEW, 15012)).toThrow(/审批链里出现了发起人本人/)
  })

  it('★ 真实世界的反例：用章审批那条链的第一个节点就是发起人本人（所以本能力没有选它）', () => {
    const hits = findSelfInApprovalChain(SELF_APPROVER_PREVIEW, 18243)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.nodeId).toBe('Activity_09tm1if')
    expect(hits[0]?.candidateStrategy).toBe(30)
    expect(hits[0]?.candidateStrategyName).toBe('用户')
    // 策略 35（发起人自选）那个节点**没有候选人**，不该被算成命中
    expect(hits.map((h) => h.nodeId)).not.toContain('Activity_14o2rxv')
    expect(() => assertNotSelfApprover(SELF_APPROVER_PREVIEW, 18243)).toThrow(/Activity_09tm1if/)
  })

  it('★ 多节点多候选人：命中在**第二个**节点的第二个候选人上也要报出来', () => {
    const preview: ApprovalChainPreview = {
      nodes: [
        {
          nodeId: 'n1',
          name: '一级审批',
          type: 'USER_TASK',
          candidateUsers: [{ id: 1, nickname: '甲' }, { id: 2, nickname: '乙' }],
        },
        {
          nodeId: 'n2',
          name: '二级审批',
          type: 'USER_TASK',
          candidateUsers: [{ id: 3, nickname: '丙' }, { id: 18243, nickname: '姚淼鑫' }, { id: 4, nickname: '丁' }],
        },
      ],
    }
    const hits = findSelfInApprovalChain(preview, 18243)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.nodeId).toBe('n2')
    expect(hits[0]?.user.nickname).toBe('姚淼鑫')
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/二级审批/)
  })

  it('★ 三处都命中时**三处都要在**（堵住"找到第一个就停"）', () => {
    const preview: ApprovalChainPreview = {
      nodes: [
        { nodeId: 'a', name: 'A', type: 'USER_TASK', candidateUsers: [{ id: 18243, nickname: '姚' }] },
        {
          nodeId: 'b',
          name: 'B',
          type: 'USER_TASK',
          candidateUsers: [{ id: 7, nickname: '别' }, { id: 18243, nickname: '姚' }],
        },
        { nodeId: 'c', name: 'C', type: 'USER_TASK', candidateUsers: [{ id: 18243, nickname: '姚' }] },
      ],
    }
    const hits = findSelfInApprovalChain(preview, 18243)
    expect(hits.map((h) => h.nodeId)).toEqual(['a', 'b', 'c'])
    const message = (() => {
      try {
        assertNotSelfApprover(preview, 18243)
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()
    for (const nodeId of ['a', 'b', 'c']) expect(message).toContain(`（${nodeId}`)
  })

  it('★ 只看 USER_TASK：发起人出现在 START_EVENT / END_EVENT 里**不算命中**', () => {
    const preview: ApprovalChainPreview = {
      nodes: [
        { nodeId: 's', name: '开始', type: 'START_EVENT', candidateUsers: [{ id: 18243, nickname: '姚' }] },
        { nodeId: 'e', name: '结束', type: 'END_EVENT', candidateUsers: [{ id: 18243, nickname: '姚' }] },
        { nodeId: 't', name: '审批', type: 'USER_TASK', candidateUsers: [{ id: 18243, nickname: '姚' }] },
      ],
    }
    expect(findSelfInApprovalChain(preview, 18243).map((h) => h.nodeId)).toEqual(['t'])
    // 只有非 USER_TASK 节点时不命中
    expect(findSelfInApprovalChain({ nodes: preview.nodes.slice(0, 2) }, 18243)).toEqual([])
  })

  it('id 比较不受字符串/数字类型影响（后端两种都可能回）', () => {
    const preview: ApprovalChainPreview = {
      nodes: [
        {
          nodeId: 'n',
          name: '审批',
          type: 'USER_TASK',
          candidateUsers: [{ id: '18243' as unknown as number, nickname: '姚' }],
        },
      ],
    }
    expect(findSelfInApprovalChain(preview, 18243)).toHaveLength(1)
    expect(findSelfInApprovalChain(preview, Number('18243'))).toHaveLength(1)
    // 别的 id 不命中
    expect(findSelfInApprovalChain(preview, 18244)).toEqual([])
  })

  it('空/缺失的审批链不炸，也不误报', () => {
    expect(findSelfInApprovalChain(null, 18243)).toEqual([])
    expect(findSelfInApprovalChain(undefined, 18243)).toEqual([])
    expect(findSelfInApprovalChain({ nodes: [] }, 18243)).toEqual([])
    expect(findSelfInApprovalChain({ nodes: [{ nodeId: 'n', type: 'USER_TASK' }] }, 18243)).toEqual([])
    expect(findSelfInApprovalChain({ nodes: [{ nodeId: 'n', type: 'USER_TASK', candidateUsers: [] }] }, 18243)).toEqual([])
    expect(() => assertNotSelfApprover(null, 18243)).not.toThrow()
    expect(() => assertNotSelfApprover({ nodes: [] }, 18243)).not.toThrow()
  })

  it('命中时的报错说清了"为什么不能发"（不可逆、撤不掉）', () => {
    const message = (() => {
      try {
        assertNotSelfApprover(REAL_PREVIEW, 15012)
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()
    expect(message).toContain('流程发起人与审批人相同，自动审核通过')
    expect(message).toContain('永远撤不掉')
    expect(message).toContain('userId=15012')
    expect(message).toContain('乔娜(15012)')
  })

  it('★ submit 默认跑守卫：命中时**一个写请求都不发**', async () => {
    const { calls, capability } = makeCapability({ preview: SELF_APPROVER_PREVIEW })
    await expect(capability.submit(draft)).rejects.toThrow(/审批链里出现了发起人本人/)
    // 读请求发生过（prepare 的两条 + preview），但**没有任何写请求**
    expect(createCalls(calls)).toHaveLength(0)
    expect(urlsOf(calls)).not.toContain('/admin-api/hr/business-trip-application/create')
    // 而且守卫确实跑过：preview 那条请求在调用序列里（不是"因为压根没跑到守卫"才没有写）
    expect(urlsOf(calls)).toContain('/admin-api/bpm/process-instance/preview')
  })

  it('★ `skipSelfApprovalGuard` 默认**关着**（守卫默认开着）；只有显式传 true 才跳过', async () => {
    // 默认：守卫开
    const guarded = makeCapability({ preview: SELF_APPROVER_PREVIEW })
    await expect(guarded.capability.submit(draft)).rejects.toThrow(/发起人本人/)
    expect(urlsOf(guarded.calls)).toContain('/admin-api/bpm/process-instance/preview')
    expect(createCalls(guarded.calls)).toHaveLength(0)

    // 显式 false：还是开
    const explicitFalse = makeCapability({ preview: SELF_APPROVER_PREVIEW })
    await expect(
      explicitFalse.capability.submit(draft, { skipSelfApprovalGuard: false }),
    ).rejects.toThrow(/发起人本人/)

    // 显式 true：跳过 preview，直接写（逃生口，调用方自己承担后果）
    const skipped = makeCapability({ preview: SELF_APPROVER_PREVIEW })
    await expect(skipped.capability.submit(draft, { skipSelfApprovalGuard: true })).resolves.toBe(777)
    expect(urlsOf(skipped.calls)).not.toContain('/admin-api/bpm/process-instance/preview')
    expect(createCalls(skipped.calls)).toHaveLength(1)
    // 跳过守卫时**仍然**打了 prepare 那条 tasks（页面上 formSubmit 的第一步），只是没打 preview
    expect(writeCalls(skipped.calls)).toHaveLength(2)
  })

  it('★ 守卫用的是**本次载荷**算出来的审批链，不是空表单', async () => {
    const { calls, capability } = makeCapability()
    await capability.submit(draft)
    const previewCall = calls.find((c) => String(c.url).includes('/bpm/process-instance/preview'))
    const body = jsonBodyOf(previewCall)
    // variables 必须是**这次的 14 个字段**，不是 {}
    expect(Object.keys(body.variables as object)).toHaveLength(14)
    expect((body.variables as Record<string, unknown>).reason).toBe(draft.reason)
    expect((body.variables as Record<string, unknown>).tripType).toBe(draft.tripType)
    expect((body.variables as Record<string, unknown>).startTime).toBe(draft.startTime)
    expect((body.variables as Record<string, unknown>).endTime).toBe(draft.endTime)
  })
})

// ---------------------------------------------------------------------------
// 七、自选审批人节点（本流程实测 0 个）
// ---------------------------------------------------------------------------

describe('出差申请 —— 自选审批人节点（本流程实测 0 个）', () => {
  it('prepare 返回 0 个节点（实测 getRequiredStartUserSelectTasks 恒返回 []）', async () => {
    const { calls, capability } = makeCapability()
    const prepared = await capability.prepare(draft)
    expect(prepared.tasks).toEqual([])
    // 那条 tasks 请求的 body 是**完整载荷**（@Valid @RequestBody，传 {} 会被打回）
    const taskCall = calls.find((c) => String(c.url).includes('getRequiredStartUserSelectTasks'))
    expect(Object.keys(jsonBodyOf(taskCall))).toHaveLength(14)
    // 后端回的不是数组时归一成 []（不是 undefined）
    const notArray = makeCapability({ tasks: null })
    expect((await notArray.capability.prepare(draft)).tasks).toEqual([])
  })

  it('节点没覆盖就抛（将来流程被改成带自选节点时不静默出错）', () => {
    const tasks = [
      { id: 'n1', name: '一级审批' },
      { id: 'n2', name: '二级审批' },
    ]
    // 一个都没给
    expect(() => assertTasksCovered(tasks, {})).toThrow(/「一级审批」没有选人/)
    // 只给了一个 —— 报错要指向**第二个**那个还没覆盖的
    const message = (() => {
      try {
        assertTasksCovered(tasks, { n1: [15012] })
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()
    expect(message).toContain('二级审批')
    expect(message).not.toContain('「一级审批」没有选人')
    // 全覆盖就放行
    expect(() => assertTasksCovered(tasks, { n1: [1], n2: [2] })).not.toThrow()
    // 空 tasks 时给什么都不该抛（本流程的真实情形）
    expect(() => assertTasksCovered([], {})).not.toThrow()
    expect(() => assertTasksCovered([], {})).not.toThrow()
  })

  it('多给了节点 id 也抛（本流程正常应当传 {}）', () => {
    expect(() => assertTasksCovered([], { nope: [1] })).toThrow(/"nope" 不是本次的审批人节点/)
    expect(() => assertTasksCovered([], { nope: [1] })).toThrow(/一个都没有/)
    // 有节点时，报错里要把本次节点列出来
    expect(() => assertTasksCovered([{ id: 'n1', name: '一级审批' }], { n1: [1], n2: [2] })).toThrow(/n2/)
  })

  it('submit 会在写之前挡住"给了节点但本次没有节点"', async () => {
    const { calls, capability } = makeCapability()
    await expect(
      capability.submit(draft, { startUserSelectAssignees: { ghost: [15012] } }),
    ).rejects.toThrow(/不是本次的审批人节点/)
    expect(createCalls(calls)).toHaveLength(0)
    expect(urlsOf(calls)).not.toContain('/admin-api/bpm/process-instance/preview')
  })
})

// ---------------------------------------------------------------------------
// 八、写链路的请求形状
// ---------------------------------------------------------------------------

describe('出差申请 —— 写链路的请求形状', () => {
  it('★ submit 的请求顺序：读 → 任务节点 → 守卫 → create（只有最后一条是写）', async () => {
    const { calls, capability } = makeCapability()
    await capability.submit(draft)
    expect(urlsOf(calls)).toEqual([
      '/admin-api/sys/user/info?_t=<ts>',
      '/admin-api/hr/business-trip-application/getRequiredStartUserSelectTasks',
      '/admin-api/bpm/process-instance/preview',
      '/admin-api/hr/business-trip-application/create',
    ])
    // 四条里只有最后一条是写业务数据的（前面那条 tasks 虽然也是 POST，但它只是问审批节点）
    expect(createCalls(calls)).toHaveLength(1)
    expect(String(createCalls(calls)[0]?.url)).toContain('/hr/business-trip-application/create')
    expect(String(createCalls(calls)[0]?.method).toLowerCase()).toBe('post')
  })

  it('★ create 的 body = 提交载荷 + 末尾的 `startUserSelectAssignees`', async () => {
    const { calls, capability } = makeCapability()
    await capability.submit(draft)
    const createCall = calls.find((c) => String(c.url).includes('/create'))
    const body = jsonBodyOf(createCall)
    const keys = Object.keys(body)
    expect(keys[keys.length - 1]).toBe('startUserSelectAssignees')
    expect(body.startUserSelectAssignees).toEqual({})
    expect(keys).toHaveLength(15)
    // 载荷那 14 个字段与 prepare 的 payload 逐字段一致
    const { startUserSelectAssignees, ...rest } = body
    expect(startUserSelectAssignees).toEqual({})
    const prepared = await capability.prepare(draft)
    expect(rest).toEqual(prepared.payload)
    // 后端会覆盖的 6 个身份字段确实**发出去了**（D20 逐字段一致），不是省掉不发
    expect(body.applicantId).toBe('18243')
    expect(body.applyPostId).toBe('702')
    expect(body.applyDate).toBe(portalToday())
  })

  it('detail 的请求与基准里的路径同族（GET + id 查询参数）', async () => {
    const { calls, capability } = makeCapability()
    await capability.detail(777)
    expect(String(calls[0]?.method).toLowerCase()).toBe('get')
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/hr/business-trip-application/get?id=777&_t=<ts>')
    expect(() => capability.detail('')).toThrow(/id 不能为空/)
    expect(() => capability.detail('   ')).toThrow(/id 不能为空/)
  })

  it('my-page 的查询参数与「我的流程」页一致（空串也要发）', async () => {
    const { calls, capability } = makeCapability()
    await capability.myInstances()
    expect(queryOf(calls[0])).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['name', ''],
      ['title', ''],
      ['category', ''],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
    // 给了 status / processType 才带上（不给就**不发**这个参数）
    const filtered = makeCapability()
    await filtered.capability.myInstances({ status: 1, processType: 2, pageNo: 3, pageSize: 5 })
    expect(queryOf(filtered.calls[0])).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['name', ''],
      ['title', ''],
      ['category', ''],
      ['status', '1'],
      ['processType', '2'],
      ['pageNo', '3'],
      ['pageSize', '5'],
      ['_t', '<ts>'],
    ])
  })

  it(
    '★ `findInstanceByBusinessKey` 要按 `processDefinitionKey` 再筛一道（businessKey 会撞车）',
    async () => {
      // 同一页里有一条 businessKey 相同、但属于别的流程的记录，还有一条真正属于本流程的
      const { capability } = makeCapability({
        myPage: {
          list: [
            { id: '999', businessKey: '777', processDefinitionKey: 'hr_overtime_application', status: 1 },
            { id: '888', businessKey: '777', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY, status: 1 },
          ],
          total: 2,
        },
      })
      const instance = await capability.findInstanceByBusinessKey(777)
      expect(instance.id).toBe('888')
    },
  )

  it('★ 第一页没有就翻第二页（提前 break 的分支走不到就是假绿）', async () => {
    const pageSize = 3
    const { calls, capability } = makeCapability(
      {
        myPageByPage: {
          1: {
            list: [
              { id: '1', businessKey: '11', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY },
              { id: '2', businessKey: '12', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY },
              { id: '3', businessKey: '13', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY },
            ],
            total: 4,
          },
          2: {
            list: [{ id: '4', businessKey: '77', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY }],
            total: 4,
          },
        },
      },
      { scanPageSize: pageSize, maxScanPages: 2 },
    )
    const instance = await capability.findInstanceByBusinessKey(77)
    expect(instance.id).toBe('4')
    expect(queryOf(calls[1])).toContainEqual(['pageNo', '2'])
  })

  it('★ 第一页返回不满一页时**立刻停**（不再多翻一页）', async () => {
    const { calls, capability } = makeCapability(
      { myPage: { list: [{ id: '1', businessKey: '5', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY }], total: 1 } },
      { scanPageSize: 50, maxScanPages: 5 },
    )
    await capability.findInstanceByBusinessKey(5)
    expect(calls).toHaveLength(1)
  })

  it('翻完上限还没找到就抛，且说清可能的原因', async () => {
    const fullPage = {
      list: [
        { id: '1', businessKey: '11', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY },
        { id: '2', businessKey: '12', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY },
      ],
      total: 6,
    }
    const { calls, capability } = makeCapability(
      // 每一页都是满的 ⇒ 必须一路翻到上限才停（否则第一条"不满一页就停"的捷径会让它提前结束）
      { myPageByPage: { 1: fullPage, 2: fullPage, 3: fullPage } },
      { scanPageSize: 2, maxScanPages: 3 },
    )
    await expect(capability.findInstanceByBusinessKey(404)).rejects.toThrow(/翻到第 3 页也没找到 businessKey=404/)
    expect(calls).toHaveLength(3)
    await expect(capability.findInstanceByBusinessKey('')).rejects.toThrow(/不能为空/)
    await expect(capability.findInstanceByBusinessKey('   ')).rejects.toThrow(/不能为空/)
  })

  it('★ cancel 走 `processInstanceId` 时直接发，不再去翻「我的流程」', async () => {
    const { calls, capability } = makeCapability()
    await capability.cancel({ processInstanceId: '888', reason: 'SDK-TEST 撤销' })
    expect(urlsOf(calls)).toEqual(['/admin-api/bpm/process-instance/cancel-by-start-user'])
    expect(String(calls[0]?.method).toLowerCase()).toBe('delete')
    expect(jsonBodyOf(calls[0])).toEqual({ id: '888', reason: 'SDK-TEST 撤销' })
  })

  it('★ cancel 走 `businessKey` 时先换流程实例 id（因为 detail 里没有 processInstanceId）', async () => {
    const { calls, capability } = makeCapability({
      myPage: {
        list: [
          { id: '888', businessKey: '777', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY, status: 1 },
        ],
        total: 1,
      },
    })
    await capability.cancel({ businessKey: 777, reason: 'SDK-TEST 撤销' })
    expect(urlsOf(calls)).toEqual([
      '/admin-api/bpm/process-instance/my-page?order=&orderField=&name=&title=&category=&pageNo=1&pageSize=50&_t=<ts>',
      '/admin-api/bpm/process-instance/cancel-by-start-user',
    ])
    // 发出去的 id 是**流程实例 id**（888），不是业务单据 id（777）
    expect(jsonBodyOf(calls[1])).toEqual({ id: '888', reason: 'SDK-TEST 撤销' })
  })

  it('cancel 的 reason 必填且要 trim；两个 id 至少要有一个', async () => {
    const { calls, capability } = makeCapability()
    await expect(capability.cancel({ processInstanceId: '888', reason: '' })).rejects.toThrow(/reason 必填/)
    await expect(capability.cancel({ processInstanceId: '888', reason: '   ' })).rejects.toThrow(/reason 必填/)
    await expect(capability.cancel({ processInstanceId: '888', reason: undefined as never })).rejects.toThrow(
      /reason 必填/,
    )
    await expect(capability.cancel({ reason: 'x' })).rejects.toThrow(/processInstanceId 或 businessKey/)
    expect(calls).toHaveLength(0)
    // 首尾空白会被 trim 掉
    const trimmed = makeCapability()
    await trimmed.capability.cancel({ processInstanceId: '888', reason: '  SDK-TEST 撤销  ' })
    expect(jsonBodyOf(trimmed.calls[0])).toEqual({ id: '888', reason: 'SDK-TEST 撤销' })
  })

  it('★ 本流程特有：detail 的 status 在提交后仍是 0，判定「流程在跑」只能看流程实例', async () => {
    // 后端 createApplication() 没有 setStatus（表默认 0），监听器只处理 APPROVE/REJECT/CANCEL。
    // 这条用例把"不能拿 detail.status 当流程状态"这件事钉成一条断言：
    const { capability } = makeCapability({ detail: { id: 777, status: 0, statusName: '待提交' } })
    const record = await capability.detail(777)
    expect(record.status).toBe(0)
    // 而流程实例那一边是 1（审批中）——两者**同时**成立，所以谁也不能替谁
    const running = makeCapability({
      myPage: {
        list: [{ id: '888', businessKey: '777', processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY, status: 1 }],
        total: 1,
      },
    })
    expect((await running.capability.findInstanceByBusinessKey(777)).status).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 九、能力定义
// ---------------------------------------------------------------------------

describe('出差申请 —— 能力定义', () => {
  it('每个能力内部的参数名**不重名**（否则 redocly 的 operation-parameters-unique 会拦下）', () => {
    for (const capability of businessTripApplicationCapabilities) {
      const names = capability.params.map((p) => p.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('能力 id 不重复，且都带 business-trip-application 前缀', () => {
    const ids = businessTripApplicationCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith('business-trip-application-')).toBe(true)
    // 写能力只有两条：submit 与 cancel
    const writeIds = businessTripApplicationCapabilities.filter((c) => c.write).map((c) => c.id)
    expect(writeIds.sort()).toEqual(['business-trip-application-cancel', 'business-trip-application-submit'])
  })

  it('★ 参数的 kind 按页面控件判：4 个 textarea → text、两个时间 → date、类型 → enum', () => {
    const submit = businessTripApplicationCapabilities.find(
      (c) => c.id === 'business-trip-application-submit',
    )
    const kinds = Object.fromEntries((submit?.params ?? []).map((p) => [p.name, p.kind]))
    expect(kinds).toEqual({
      tripType: 'enum',
      companions: 'text',
      startTime: 'date',
      endTime: 'date',
      origin: 'text',
      destination: 'text',
      reason: 'text',
      startUserSelectAssignees: 'text',
      skipSelfApprovalGuard: 'boolean',
    })
    // 类型的选项就是 define.js 那三个
    const tripType = submit?.params.find((p) => p.name === 'tripType')
    expect(tripType?.options).toEqual([
      { label: '出差', value: 0 },
      { label: '外出', value: 1 },
      { label: '海外出差', value: 2 },
    ])
  })

  it('★ 哪些参数必填、哪些不必填，逐条对（页面上打不出空值的那 7 个都是 required）', () => {
    const required = Object.fromEntries(
      businessTripApplicationCapabilities.map((c) => [
        c.id,
        c.params.filter((p) => p.required).map((p) => p.name),
      ]),
    )
    expect(required).toEqual({
      'business-trip-application-definition': ['key'],
      'business-trip-application-current-user': [],
      // 审批链预览是**提交前**的可选动作，7 个字段都可省（省略时接口自己会打回）
      'business-trip-application-approval-chain': [],
      'business-trip-application-prepare': [
        'tripType',
        'companions',
        'startTime',
        'endTime',
        'origin',
        'destination',
        'reason',
      ],
      'business-trip-application-submit': [
        'tripType',
        'companions',
        'startTime',
        'endTime',
        'origin',
        'destination',
        'reason',
      ],
      'business-trip-application-detail': ['id'],
      'business-trip-application-my-instances': [],
      'business-trip-application-cancel': ['reason'],
    })
  })

  it('★ 没有 search / tree 类长选项参数（本表单没有人员控件，加了就是对不上的接口）', () => {
    for (const capability of businessTripApplicationCapabilities) {
      for (const param of capability.params) {
        expect(param.kind).not.toBe('search')
        expect(param.kind).not.toBe('tree')
      }
    }
    // 反向对照：参数确实存在（否则上面那个循环是空转）
    expect(businessTripApplicationCapabilities.flatMap((c) => c.params).length).toBeGreaterThan(15)
  })

  it('挂的页面路径都是那三条里的一条（不会挂到「发起流程」上）', () => {
    const allowed = new Set([
      BUSINESS_TRIP_APPLICATION_PAGE_PATH,
      BUSINESS_TRIP_APPLICATION_FORM_PATH,
      BUSINESS_TRIP_APPLICATION_MY_LIST_PATH,
    ])
    for (const capability of businessTripApplicationCapabilities) {
      expect(allowed.has(capability.pagePath)).toBe(true)
      expect(capability.pagePath).not.toBe('/dashboard/flow/task/create/list')
    }
    // 反向对照：三条路径都真的被用到（不是只有一条）
    expect(new Set(businessTripApplicationCapabilities.map((c) => c.pagePath)).size).toBe(3)
  })
})
