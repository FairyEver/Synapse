import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  ATTACHMENT_ACCEPT_EXTENSIONS,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_OSS_FOLDER,
  LEAVE_TYPE_OPTIONS,
  LEAVE_TYPE_REST,
  REASON_MAX,
  REASON_MAX_BACKEND,
  REST_LEAVE_APPLICATION_FORM_PATH,
  REST_LEAVE_APPLICATION_MY_LIST_PATH,
  REST_LEAVE_APPLICATION_PAGE_PATH,
  REST_LEAVE_APPLICATION_PROCESS_KEY,
  REST_LEAVE_APPLICATION_PROCESS_TYPE,
  REMAINING_OVERTIME_HOURS_URL,
  assertAttachments,
  assertLeaveDateItems,
  assertNotSelfApprover,
  assertTasksCovered,
  buildRestLeaveApplicationCreatePayload,
  buildRestLeaveApplicationPayload,
  calculateLeaveHours,
  createRestLeaveApplicationCapability,
  findSelfInApprovalChain,
  normalizeRestLeaveDraft,
  parseRestLeaveDate,
  pickCurrentUser,
  restLeaveApplicationCapabilities,
  type ApprovalChainPreview,
  type RestLeaveApplicationDerived,
  type RestLeaveApplicationDraft,
} from '../src/capabilities/rest-leave-application.js'

/**
 * 调休申请（`hr_rest_leave_application` / `/simple/hr/form/043`）—— 「加班申请」的孪生流程。
 *
 * 三条来源，逐条钉住：
 *   1. `baseline/rest-leave-application.browser.json`：真实浏览器抓的只读请求
 *      （其中 `POST /bpm/process-instance/preview` 的 `variables` 就是 `buildSubmitData()` 的产物
 *      —— 本表单的特有路子：点「查看审批流程」就能看到"提交会发什么"，不用真的提交）
 *   2. Portal 前端源码 `app/portal/views/simple/hr/form/043/**`（pc + mobile + common/define.js）
 *   3. 后端源码 `RestLeaveApplicationController` / `RestLeaveApplicationSaveReqVO` /
 *      `RestLeaveDateItemVO` / `RestLeaveApplicationServiceImpl` / `OssResourceApiImpl.saveFile`
 *
 * 真实写链路的往返记录在 `docs/pages/调休申请.md`。
 */

type BaselineRequest = {
  于: string
  u: string
  via: string
  headers: Record<string, string>
  次数?: number
  body?: string
}
type Baseline = {
  入口: string
  请求: BaselineRequest[]
  表单填写值: { reason: string; leaveDateItems: Array<{ leaveDate: string; leaveHours: number }> }
  提交载荷: {
    body: Record<string, unknown>
    键顺序: string[]
    逐字段类型: Record<string, string>
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/rest-leave-application.browser.json'), 'utf8'),
)

/** 去掉主机与一次性时间戳，只留 path + query */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

const baselineUrls = new Set(baseline.请求.map((r) => normalize(r.u)))
const baselinePreview = baseline.请求.find((r) => r.u.endsWith('/bpm/process-instance/preview'))

/** 基准里 `variables` 那一层（= buildSubmitData() 的真实产物） */
const baselineVariables = baseline.提交载荷.body

/**
 * 与基准同一份只读联动结果 + 填写值。**两边各自独立取值**，再由
 * «写死的填写值与基准里记的一致» 那一条兜住漂移。
 */
const BASELINE_DERIVED: RestLeaveApplicationDerived = {
  applicantName: '姚淼鑫',
  userId: '18243',
  staffCode: '2021070101',
  departmentId: '101',
  departmentName: '设计中心1236',
  leaveType: 0,
  remainingOvertimeHours: 4,
  leaveHours: 1,
}

const BASELINE_DRAFT: RestLeaveApplicationDraft = {
  reason: 'SDK-TEST-调休申请基线抓取（不会提交）',
  leaveDateItems: [{ leaveDate: '2026-09-24', leaveHours: 1 }],
  attachments: [],
}

/**
 * 只读联动里**除了 `leaveHours` 之外**的那几项。
 *
 * 为什么要单分一份：`buildRestLeaveApplicationPayload` 有一条"调用方给的 leaveHours
 * 必须与算出来的一致"，而下面大量用例**故意改明细行**去验证算法。
 * 带着一个写死的 `leaveHours: 1` 去改明细行，红的会是那条一致性检查、**不是被测的那条**——
 * 那正是"测试看起来绿了、其实测的不是它"的典型。所以校验类用例用这一份（不给 = 不参与一致性检查）。
 */
const DERIVED: RestLeaveApplicationDerived = {
  applicantName: '姚淼鑫',
  userId: '18243',
  staffCode: '2021070101',
  departmentId: '101',
  departmentName: '设计中心1236',
  leaveType: 0,
  remainingOvertimeHours: 4,
}

/** 日常用的一份草稿（不做逐字节对照时用这个，名字明显是测试数据） */
const draft: RestLeaveApplicationDraft = {
  reason: 'SDK-TEST-调休申请冒烟',
  leaveDateItems: [
    { leaveDate: '2026-09-24', leaveHours: 2 },
    { leaveDate: '2026-09-25', leaveHours: 1.5 },
  ],
}

/**
 * 【实测 2026-09-21】`POST /bpm/process-instance/preview` 的真实响应（原样抄下来）。
 * 审批人是「直属上级」算出来的 **乔娜(15012)**，发起人是 **18243** —— 不是同一个人。
 */
const REAL_PREVIEW: ApprovalChainPreview = {
  processDefinitionId: 'hr_rest_leave_application:2:61d3f1ea-18f5-11f1-9323-0050568340ed',
  processDefinitionKey: 'hr_rest_leave_application',
  processDefinitionName: '调休审批',
  state: 'CONFIRMED',
  nodes: [
    { nodeId: 'Event_1nue66s', name: null, type: 'START_EVENT', candidateStrategy: null, candidateUsers: [] },
    {
      nodeId: 'Activity_1ee4c6r',
      name: '直属上级审批',
      type: 'USER_TASK',
      candidateStrategy: 23,
      candidateStrategyName: '直属上级',
      candidateUsers: [{ id: 15012, nickname: '乔娜' }],
      approvalMode: 'SINGLE',
      state: 'CONFIRMED',
    },
    { nodeId: 'Event_15m52e5', name: null, type: 'END_EVENT', candidateStrategy: null, candidateUsers: [] },
  ],
  copyUsers: [],
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
 * ⚠️ 路由的**判断顺序**很要紧：`/hr/rest-leave-application/get` 是
 * `/hr/rest-leave-application/getRequiredStartUserSelectTasks` 的**前缀**，
 * 所以自选节点那条必须排在 `detail` 前面。
 */
function makeCapability (routes: {
  userInfo?: unknown
  remainingHours?: unknown
  tasks?: unknown
  preview?: unknown
  create?: unknown
  detail?: unknown
  myPage?: unknown
  myPageByPage?: Record<number, unknown>
  cancel?: unknown
} = {}, options: { maxScanPages?: number; scanPageSize?: number } = {}) {
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
    else if (url.includes('/record/remaining-hours')) {
      data = 'remainingHours' in routes ? routes.remainingHours : 4
    } else if (url.includes('getRequiredStartUserSelectTasks')) data = routes.tasks ?? []
    else if (url.includes('/bpm/process-instance/preview')) data = routes.preview ?? REAL_PREVIEW
    else if (url.includes('/hr/rest-leave-application/create')) data = routes.create ?? 777
    else if (url.includes('/hr/rest-leave-application/get')) data = routes.detail ?? { id: 777 }
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
  const capability = createRestLeaveApplicationCapability(
    (requestConfig) => sdk.call(REST_LEAVE_APPLICATION_FORM_PATH, requestConfig),
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
const createCalls = (calls: InternalAxiosRequestConfig[]) =>
  calls.filter((c) => String(c.url).includes('/hr/rest-leave-application/create'))

// ---------------------------------------------------------------------------
// 一、与浏览器基准一致
// ---------------------------------------------------------------------------

describe('调休申请 —— 读链路与浏览器基准一致', () => {
  it('写死的填写值与只读联动结果与基准里记的一致（两边不会各自漂移）', () => {
    expect(BASELINE_DRAFT.reason).toBe(baseline.表单填写值.reason)
    expect(BASELINE_DRAFT.leaveDateItems).toEqual(baseline.表单填写值.leaveDateItems)

    const 类型 = baseline.提交载荷.逐字段类型
    expect(BASELINE_DERIVED.userId).toBe('18243')
    expect(类型.userId).toContain('字符串')
    expect(BASELINE_DERIVED.staffCode).toBe('2021070101')
    expect(类型.staffCode).toContain('字符串')
    expect(BASELINE_DERIVED.departmentId).toBe('101')
    expect(类型.departmentId).toContain('字符串')
    expect(BASELINE_DERIVED.remainingOvertimeHours).toBe(4)
    expect(BASELINE_DERIVED.leaveHours).toBe(1)
  })

  it('流程 key / 表单路径 / 入口 URL 三处一致', () => {
    expect(REST_LEAVE_APPLICATION_PROCESS_KEY).toBe('hr_rest_leave_application')
    expect(baseline.入口).toContain(`processDefinitionKey=${REST_LEAVE_APPLICATION_PROCESS_KEY}`)
    expect(baseline.入口).toContain('formCustomCreatePath=simple/hr/form/043')
    expect(REST_LEAVE_APPLICATION_FORM_PATH).toBe('/simple/hr/form/043')
    expect(REST_LEAVE_APPLICATION_PROCESS_TYPE).toBe(2)
  })

  it('★ 构造出来的载荷与基准里 variables 那一层**逐字段逐键序**一致', () => {
    const built = buildRestLeaveApplicationPayload(BASELINE_DERIVED, BASELINE_DRAFT)
    // toEqual 不看键序，所以再单独断言一次键序（D20 要求键顺序也算一致）
    expect(Object.keys(built)).toEqual(baseline.提交载荷.键顺序)
    expect(built).toEqual(baselineVariables)
    // 序列化后的字节也要一致 —— 这才是"浏览器发什么、SDK 发什么"
    expect(JSON.stringify(built)).toBe(JSON.stringify(baselineVariables))
  })

  it('流程定义请求与基准一致', async () => {
    const { calls, capability } = makeCapability()
    await capability.definition()

    const actual = normalize(String(calls[0]?.url))
    expect(actual).toBe(`/admin-api/bpm/process-definition/get?key=${REST_LEAVE_APPLICATION_PROCESS_KEY}&_t=<ts>`)
    expect(baselineUrls.has(actual)).toBe(true)
  })

  it('剩余加班时长的请求与基准一致（★ 挂在 overtime-application 下，不是 rest-leave-application）', async () => {
    const { calls, capability } = makeCapability({ remainingHours: 4 })
    const value = await capability.remainingOvertimeHours(18243)

    expect(value).toBe(4)
    const [config] = calls
    expect(normalize(String(config?.url))).toBe(
      `/admin-api/hr/overtime-application/record/remaining-hours?userId=18243&_t=<ts>`,
    )
    expect(baselineUrls.has(normalize(String(config?.url)))).toBe(true)
    expect(REMAINING_OVERTIME_HOURS_URL).toBe('/hr/overtime-application/record/remaining-hours')
  })

  it('★ preview 的请求体是**五个键**，与基准里那条抓包逐字节一致', async () => {
    const { calls, capability } = makeCapability()
    await capability.approvalChain(baselineVariables)

    const [config] = calls
    expect(normalize(String(config?.url))).toBe('/admin-api/bpm/process-instance/preview')
    expect(jsonBodyOf(config)).toEqual(JSON.parse(baselinePreview?.body as string))
  })

  it('三条页面路径都算不出 module-type（SDK 与浏览器一致：不发这个头）', () => {
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    for (const path of [
      REST_LEAVE_APPLICATION_FORM_PATH,
      REST_LEAVE_APPLICATION_PAGE_PATH,
      REST_LEAVE_APPLICATION_MY_LIST_PATH,
    ]) {
      expect(sdk.resolveModuleType(path).moduleType).toBeNull()
    }
  })

  it('基准里记的请求头里没有 module-type（浏览器也没发）', () => {
    for (const request of baseline.请求) {
      expect(Object.keys(request.headers).map((h) => h.toLowerCase())).not.toContain('module-type')
    }
  })

  it('★ 基准里凡是凭据类请求头都已被脱敏成 <redacted>（文件里没有凭据）', () => {
    // 只断言"没有 authorization 这个 key"是不够的：`simple-page` 那条走的是另一个 http 实例，
    // 它的鉴权头就叫 `Authorization`，确实存在——存在没关系，**值必须是 <redacted>**。
    let sawCredentialHeader = 0
    for (const request of baseline.请求) {
      for (const [name, value] of Object.entries(request.headers)) {
        if (/^(authorization|token|cookie|access_token)$/i.test(name)) {
          expect(value).toBe('<redacted>')
          sawCredentialHeader += 1
        }
        expect(String(value)).not.toMatch(/eyJ|Bearer [A-Za-z0-9]|^[a-f0-9]{32}$/)
      }
    }
    // 确认这条断言真的看过了东西（否则"全都脱敏了"可能只是因为一个凭据头都没有）
    expect(sawCredentialHeader).toBeGreaterThan(0)
  })

  it('能力挂的页面路径**不在**「发起流程」那一条上（否则会把目录里的页面错标成已完成）', () => {
    for (const definition of restLeaveApplicationCapabilities) {
      expect(definition.pagePath).not.toBe('/dashboard/flow/task/create/list')
      expect([
        REST_LEAVE_APPLICATION_PAGE_PATH,
        REST_LEAVE_APPLICATION_FORM_PATH,
        REST_LEAVE_APPLICATION_MY_LIST_PATH,
      ]).toContain(definition.pagePath)
    }
  })
})

// ---------------------------------------------------------------------------
// 二、调休时长的算法（只读联动）
// ---------------------------------------------------------------------------

describe('调休时长 —— 逐行复刻页面的 totalLeaveHours', () => {
  it('多行合计的期望值是**逐个写死的字面量**，不是复算出来的', () => {
    const cases: Array<[Array<{ leaveHours: number }>, number]> = [
      [[{ leaveHours: 1 }], 1],
      [[{ leaveHours: 2 }, { leaveHours: 1.5 }], 3.5],
      [[{ leaveHours: 1 }, { leaveHours: 1 }, { leaveHours: 1 }], 3],
      // 0.1 + 0.2 = 0.30000000000000004 ⇒ toFixed(1) ⇒ "0.3" ⇒ 0.3
      [[{ leaveHours: 0.1 }, { leaveHours: 0.2 }], 0.3],
      // 0.15 是 toFixed 与 Math.round 分叉的那一类（见下一条）
      [[{ leaveHours: 0.15 }], 0.1],
      [[{ leaveHours: 0.35 }], 0.3],
      [[{ leaveHours: 4 }], 4],
      [[{ leaveHours: 0.5 }, { leaveHours: 0.5 }, { leaveHours: 0.5 }], 1.5],
    ]
    for (const [items, expected] of cases) {
      expect(calculateLeaveHours(items)).toBe(expected)
    }
  })

  it('★ `toFixed(1)` + Number 的尾数行为与页面一致（这一组能钉住"没用 Math.round 抄近路"）', () => {
    // 3.05 的 double 是 3.0499999999999998 ⇒ toFixed(1) 给 "3.0" ⇒ 3
    // 而 Math.round(3.05*10)/10 会给 3.1 —— 实测 0..40 之间按 0.01 步进有 160 组分叉，
    // 这里挑三组写死（期望值是**字面量**，不是把算式再算一遍）
    expect(calculateLeaveHours([{ leaveHours: 3 }, { leaveHours: 0.05 }])).toBe(3)
    expect(calculateLeaveHours([{ leaveHours: 0.15 }])).toBe(0.1)
    expect(calculateLeaveHours([{ leaveHours: 0.35 }])).toBe(0.3)
    // 反向对照：这三组确实是与 Math.round 分叉的，否则上面三条钉不住任何东西
    expect(Math.round(3.05 * 10) / 10).toBe(3.1)
    expect(Math.round(0.15 * 10) / 10).toBe(0.2)
    expect(Math.round(0.35 * 10) / 10).toBe(0.4)
    // 不分叉的那一类也要对
    expect(calculateLeaveHours([{ leaveHours: 1.05 }])).toBe(1.1)
    expect(calculateLeaveHours([{ leaveHours: 2.04 }])).toBe(2)
    // 整数化之后不带小数点：Number("3.0") === 3（与浏览器发出去的 JSON 一致）
    expect(JSON.stringify({ v: calculateLeaveHours([{ leaveHours: 3 }]) })).toBe('{"v":3}')
  })

  it('非数字的行按 0 计（页面的 Number.isFinite 兜底那一条）', () => {
    expect(calculateLeaveHours([{ leaveHours: 2 }, { leaveHours: null }, { leaveHours: 0.5 }])).toBe(2.5)
    expect(calculateLeaveHours([{ leaveHours: 'x' }, { leaveHours: 1 }])).toBe(1)
  })

  it('空数组是 0（页面上删不到 0 行，但算法本身要复刻对）', () => {
    expect(calculateLeaveHours([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 三、本地校验
// ---------------------------------------------------------------------------

describe('调休申请 —— 本地校验', () => {
  it('事由必填', () => {
    expect(() => normalizeRestLeaveDraft({ ...draft, reason: '' })).toThrow(/请假事由/)
    expect(() => normalizeRestLeaveDraft({ ...draft, reason: '   ' })).toThrow(/请假事由/)
    expect(() => normalizeRestLeaveDraft({ ...draft, reason: undefined as never })).toThrow(/请假事由/)
  })

  it('★ 事由长度按**页面**那个 200 拦（后端是 500，页面更严）—— 期望值写死成字面量', () => {
    // ⚠️ 这一条**故意不用 REASON_MAX 去构造期望**：拿被测量自己断言自己是"测试太弱"的典型，
    // 把常量改坏（200 → 300）时它照样绿。所以这里 200 / 201 / 500 全是写死的数字。
    expect(REASON_MAX).toBe(200)
    expect(REASON_MAX_BACKEND).toBe(500)

    expect(normalizeRestLeaveDraft({ ...draft, reason: 'x'.repeat(200) }).reason).toHaveLength(200)
    expect(() => normalizeRestLeaveDraft({ ...draft, reason: 'x'.repeat(201) })).toThrow(/最多 200 个字/)
    // 页面拦得住、后端拦不住的那一段（201..500）必须由 SDK 拦
    expect(() => normalizeRestLeaveDraft({ ...draft, reason: 'x'.repeat(500) })).toThrow(/最多 200 个字/)
    expect(() => normalizeRestLeaveDraft({ ...draft, reason: 'x'.repeat(501) })).toThrow(/最多 200 个字/)
  })

  it('明细行必须至少 1 行', () => {
    expect(() => assertLeaveDateItems([])).toThrow(/至少 1 行/)
    expect(() => normalizeRestLeaveDraft({ ...draft, leaveDateItems: [] })).toThrow(/至少 1 行/)
    expect(() => normalizeRestLeaveDraft({ ...draft, leaveDateItems: null as never })).toThrow(/必须是数组/)
  })

  it('明细行：日期必填、格式必须是 YYYY-MM-DD', () => {
    const one = (leaveDate: unknown) => [{ leaveDate, leaveHours: 1 }]
    expect(() => assertLeaveDateItems(one(''))).toThrow(/leaveDate/)
    expect(() => assertLeaveDateItems(one('2026/09/24'))).toThrow(/YYYY-MM-DD/)
    expect(() => assertLeaveDateItems(one('2026-9-24'))).toThrow(/YYYY-MM-DD/)
    expect(() => assertLeaveDateItems(one(20260924))).toThrow(/必须是 'YYYY-MM-DD' 格式的字符串/)
  })

  it('★ 明细行：不存在的日期要被回读校验拦下（静默进位是真正要防的那件事）', () => {
    // new Date(2026, 1, 30) 会被静默进位成 3 月 2 日 —— 拦不住的话 SDK 会发一个没人填过的日期
    expect(() => parseRestLeaveDate('2026-02-30', 'x')).toThrow(/不是一个真实存在的日期/)
    expect(() => parseRestLeaveDate('2026-13-01', 'x')).toThrow(/不是一个真实存在的日期/)
    expect(() => parseRestLeaveDate('2026-04-31', 'x')).toThrow(/不是一个真实存在的日期/)
    // 闰年边界：2028 是闰年，2026 不是
    expect(parseRestLeaveDate('2028-02-29', 'x')).toBe('2028-02-29')
    expect(() => parseRestLeaveDate('2026-02-29', 'x')).toThrow(/不是一个真实存在的日期/)
  })

  it('明细行：时长必须 > 0', () => {
    const withHours = (leaveHours: unknown) => [{ leaveDate: '2026-09-24', leaveHours }]
    expect(() => assertLeaveDateItems(withHours(0))).toThrow(/必须大于 0/)
    expect(() => assertLeaveDateItems(withHours(-1))).toThrow(/必须大于 0/)
    // ⚠️ `null` 走的是"大于 0"那条：`Number(null)` 是 0（页面 `Number(row?.leaveHours)` 同理），
    // 不是 NaN。真正走"必须是数字"的是 `undefined` / 非数字串。
    expect(() => assertLeaveDateItems(withHours(null))).toThrow(/必须大于 0/)
    expect(() => assertLeaveDateItems(withHours(undefined))).toThrow(/必须是数字/)
    expect(() => assertLeaveDateItems(withHours('x'))).toThrow(/必须是数字/)
    expect(assertLeaveDateItems(withHours(0.1))).toEqual([{ leaveDate: '2026-09-24', leaveHours: 0.1 }])
  })

  it('★ 明细行：时长最多 1 位小数（页面 :precision="1"，两端一致）', () => {
    const withHours = (leaveHours: number) => [{ leaveDate: '2026-09-24', leaveHours }]
    expect(assertLeaveDateItems(withHours(0.3))).toHaveLength(1)
    expect(assertLeaveDateItems(withHours(7.5))).toHaveLength(1)
    expect(assertLeaveDateItems(withHours(1))).toHaveLength(1)
    expect(() => assertLeaveDateItems(withHours(0.25))).toThrow(/最多 1 位小数/)
    expect(() => assertLeaveDateItems(withHours(1.05))).toThrow(/最多 1 位小数/)
    // 科学计数法那种形状也不能被放过去（用字符串数小数点会漏掉它）
    expect(() => assertLeaveDateItems(withHours(1e-7))).toThrow(/最多 1 位小数/)
  })

  it('★ 明细行的报错带行号，多行时指得出是哪一行', () => {
    expect(() =>
      assertLeaveDateItems([
        { leaveDate: '2026-09-24', leaveHours: 1 },
        { leaveDate: '2026-09-25', leaveHours: 0 },
        { leaveDate: '2026-09-26', leaveHours: 1 },
      ]),
    ).toThrow(/明细行\[1\]/)
    expect(() =>
      assertLeaveDateItems([
        { leaveDate: '2026-09-24', leaveHours: 1 },
        { leaveDate: '2026-09-25', leaveHours: 1 },
        { leaveDate: '2026-09-26', leaveHours: 1 },
        { leaveDate: 'bad', leaveHours: 1 },
      ]),
    ).toThrow(/明细行\[3\]/)
  })

  it('归一后的明细行**只留 leaveDate / leaveHours**（行内的 id 在载荷里才补）', () => {
    const normalized = normalizeRestLeaveDraft({
      ...draft,
      leaveDateItems: [{ leaveDate: '2026-09-24', leaveHours: 1, id: 99 } as never],
    })
    expect(normalized.leaveDateItems).toEqual([{ leaveDate: '2026-09-24', leaveHours: 1 }])
  })

  it(`附件：条数上限 ${ATTACHMENT_MAX_COUNT}`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://oss/${i}.png` }))
    expect(assertAttachments(many(ATTACHMENT_MAX_COUNT))).toHaveLength(ATTACHMENT_MAX_COUNT)
    expect(() => assertAttachments(many(ATTACHMENT_MAX_COUNT + 1))).toThrow(/最多 10 件/)
    expect(assertAttachments(undefined)).toEqual([])
    expect(assertAttachments(null)).toEqual([])
    expect(() => assertAttachments({} as never)).toThrow(/必须是数组/)
  })

  it('附件：扩展名白名单就是 accept 那四个（.pdf .jpg .jpeg .png）', () => {
    expect([...ATTACHMENT_ACCEPT_EXTENSIONS]).toEqual(['pdf', 'jpg', 'jpeg', 'png'])
    for (const ext of ATTACHMENT_ACCEPT_EXTENSIONS) {
      expect(assertAttachments([{ url: 'https://oss/a', name: `a.${ext}` }])).toHaveLength(1)
    }
    // 大写扩展名要按小写认
    expect(assertAttachments([{ url: 'https://oss/a', name: 'a.PDF' }])).toHaveLength(1)
    // 通用审批那条线的白名单里有 doc/xls/csv，**本表单不收** —— 不能抄错
    expect(() => assertAttachments([{ url: 'https://oss/a', name: 'a.docx' }])).toThrow(/\.docx/)
    expect(() => assertAttachments([{ url: 'https://oss/a', name: 'a.csv' }])).toThrow(/\.csv/)
    // 没有扩展名时放行（页面上传的文件未必都带名字）
    expect(assertAttachments([{ url: 'https://oss/a', name: '' }])).toHaveLength(1)
    expect(assertAttachments([{ url: 'https://oss/a' }])).toHaveLength(1)
  })

  it('附件：没有 url 就抛，且报错里给出该传到哪个 OSS 目录', () => {
    expect(() => assertAttachments([{ name: 'a.pdf' }])).toThrow(/缺 url/)
    expect(() => assertAttachments([{ url: '   ' }])).toThrow(/缺 url/)
    expect(() => assertAttachments([{ url: '' }])).toThrow(new RegExp(ATTACHMENT_OSS_FOLDER))
    expect(ATTACHMENT_OSS_FOLDER).toBe('HR/approval')
  })

  it('★ 附件的键与键顺序逐字段复刻页面的 onFileUploadDone()', () => {
    const [built] = assertAttachments([{ url: 'https://oss/a.pdf', name: 'a.pdf', size: 12, pages: 3 }])
    expect(Object.keys(built as object)).toEqual(['id', 'name', 'url', 'size', 'pages'])
    expect(built).toEqual({ id: 0, name: 'a.pdf', url: 'https://oss/a.pdf', size: 12, pages: 3 })
    // 页面写的是 file.size || 0 / file.pages || 0 —— 没给就是 0，不是 undefined
    expect(assertAttachments([{ url: 'https://oss/a.pdf', name: 'a.pdf' }])[0]).toEqual({
      id: 0,
      name: 'a.pdf',
      url: 'https://oss/a.pdf',
      size: 0,
      pages: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// 四、载荷构造
// ---------------------------------------------------------------------------

describe('调休申请 —— 载荷构造', () => {
  it('键顺序 = formState 的声明顺序（= 基准里 variables 的键顺序）', () => {
    const built = buildRestLeaveApplicationPayload(DERIVED, draft)
    expect(Object.keys(built)).toEqual([
      'id',
      'applicantName',
      'userId',
      'staffCode',
      'departmentId',
      'departmentName',
      'leaveType',
      'remainingOvertimeHours',
      'reason',
      'leaveDateItems',
      'leaveHours',
      'attachments',
    ])
  })

  it('★ `userId` / `staffCode` / `departmentId` **原样发字符串**，不做数字转换', () => {
    const built = buildRestLeaveApplicationPayload(DERIVED, draft)
    expect(built.userId).toBe('18243')
    expect(typeof built.userId).toBe('string')
    expect(built.departmentId).toBe('101')
    expect(typeof built.departmentId).toBe('string')
    expect(built.staffCode).toBe('2021070101')
    expect(typeof built.staffCode).toBe('string')
    // 序列化之后也必须是带引号的字符串 —— 这才是"浏览器发什么、SDK 发什么"
    expect(JSON.stringify(built)).toContain('"userId":"18243"')
  })

  it('`id` 恒为 null；明细行里的 `id` 也恒为 null', () => {
    const built = buildRestLeaveApplicationPayload(DERIVED, draft)
    expect(built.id).toBeNull()
    expect(built.leaveDateItems).toEqual([
      { id: null, leaveDate: '2026-09-24', leaveHours: 2 },
      { id: null, leaveDate: '2026-09-25', leaveHours: 1.5 },
    ])
  })

  it('`leaveType` 恒 0（只读），非 0 直接拒绝', () => {
    expect(buildRestLeaveApplicationPayload(DERIVED, draft).leaveType).toBe(LEAVE_TYPE_REST)
    expect(LEAVE_TYPE_OPTIONS).toEqual([{ value: 0, label: '调休' }])
    expect(() => buildRestLeaveApplicationPayload({ ...DERIVED, leaveType: 1 }, draft)).toThrow(
      /请假类型必须为调休/,
    )
    expect(() => buildRestLeaveApplicationPayload({ ...DERIVED, leaveType: null as never }, draft)).toThrow(
      /leaveType/,
    )
  })

  it('`leaveHours` 是算出来的只读字段：调用方给了就必须与算法一致', () => {
    // 对得上 → 放行
    expect(buildRestLeaveApplicationPayload({ ...DERIVED, leaveHours: 3.5 }, draft).leaveHours).toBe(3.5)
    // 对不上 → 拒绝（页面上它是一个只读文本，调用方没有地方能填对它）
    expect(() => buildRestLeaveApplicationPayload({ ...DERIVED, leaveHours: 99 }, draft)).toThrow(
      /leaveHours 被改过/,
    )
  })

  it('只读字段缺失就抛（页面上它们没有输入口，不能由调用方编）', () => {
    for (const key of ['applicantName', 'userId', 'staffCode', 'departmentId', 'departmentName'] as const) {
      expect(() => buildRestLeaveApplicationPayload({ ...DERIVED, [key]: '' }, draft)).toThrow(
        new RegExp(`只读联动字段 ${key} 缺失`),
      )
      expect(() => buildRestLeaveApplicationPayload({ ...DERIVED, [key]: undefined as never }, draft)).toThrow(
        new RegExp(`只读联动字段 ${key} 缺失`),
      )
    }
    expect(() => buildRestLeaveApplicationPayload(null as never, draft)).toThrow(/缺少只读联动的字段/)
  })

  it('`remainingOvertimeHours` 必须是数字', () => {
    expect(buildRestLeaveApplicationPayload({ ...DERIVED, remainingOvertimeHours: 0 }, draft)).toBeTruthy()
    expect(() =>
      buildRestLeaveApplicationPayload({ ...DERIVED, remainingOvertimeHours: '四' as never }, draft),
    ).toThrow(/remainingOvertimeHours 必须是数字/)
  })

  it('★ `remainingOvertimeHours` 缺省填的是 0（不是别的什么数字）', () => {
    // 期望值是**字面量 0**：这条盯的是"缺省值不能随手编一个"（改成 999 之类必须会红）
    const built = buildRestLeaveApplicationPayload({ ...DERIVED, remainingOvertimeHours: undefined }, draft)
    expect(built.remainingOvertimeHours).toBe(0)
    // 真值也要原样传出去，不能被缺省值覆盖
    expect(buildRestLeaveApplicationPayload({ ...DERIVED, remainingOvertimeHours: 7.5 }, draft).remainingOvertimeHours).toBe(7.5)
  })

  it('`attachments` 缺省就是 `[]`（页面 formState 的初值）', () => {
    expect(buildRestLeaveApplicationPayload(DERIVED, draft).attachments).toEqual([])
    expect(buildRestLeaveApplicationPayload(DERIVED, { ...draft, attachments: undefined }).attachments).toEqual([])
  })

  it('create 载荷：`startUserSelectAssignees` **永远在最后**，且默认是 `{}`', () => {
    const built = buildRestLeaveApplicationCreatePayload(DERIVED, draft)
    expect(Object.keys(built)).toEqual([
      'id',
      'applicantName',
      'userId',
      'staffCode',
      'departmentId',
      'departmentName',
      'leaveType',
      'remainingOvertimeHours',
      'reason',
      'leaveDateItems',
      'leaveHours',
      'attachments',
      'startUserSelectAssignees',
    ])
    expect(built.startUserSelectAssignees).toEqual({})
  })

  it('create 载荷：`startUserSelectAssignees` 里的 id 被归一成数字', () => {
    const built = buildRestLeaveApplicationCreatePayload(DERIVED, draft, { t1: ['12' as never, 34] })
    expect(built.startUserSelectAssignees).toEqual({ t1: [12, 34] })
    expect(() => buildRestLeaveApplicationCreatePayload(DERIVED, draft, { t1: 'x' as never })).toThrow(
      /必须是用户 id 数组/,
    )
    expect(() => buildRestLeaveApplicationCreatePayload(DERIVED, draft, { t1: ['a' as never] })).toThrow(
      /不是数字/,
    )
    expect(() => buildRestLeaveApplicationCreatePayload(DERIVED, draft, null as never)).toThrow(
      /必须是 \{ \[节点 id\]/,
    )
  })

  it('★ 本地校验不过 ⇒ **一个请求都不发**（`prepare` 也一样）', async () => {
    const { calls, capability } = makeCapability()
    await expect(capability.prepare({ ...draft, reason: '' })).rejects.toThrow(/请假事由/)
    expect(calls).toHaveLength(0)

    await expect(capability.prepare({ ...draft, leaveDateItems: [] })).rejects.toThrow(/至少 1 行/)
    expect(calls).toHaveLength(0)

    await expect(capability.submit({ ...draft, leaveDateItems: [] })).rejects.toThrow(/至少 1 行/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 五、当前用户白名单
// ---------------------------------------------------------------------------

describe('调休申请 —— 当前用户白名单', () => {
  it('★ `password2` / `salt` / `mobile` 等不在白名单里的字段**不会出现在返回值里**', () => {
    const picked = pickCurrentUser(REAL_USER_INFO)
    const serialized = JSON.stringify(picked)
    expect(serialized).not.toContain('LEAK-CANARY-password2')
    expect(serialized).not.toContain('LEAK-CANARY-salt')
    expect(serialized).not.toContain('LEAK-CANARY-mobile')
    expect(serialized).not.toContain('password2')
    expect(serialized).not.toContain('salt')
    // 表单要用的那几个必须在
    expect(picked).toMatchObject({
      id: '18243',
      realName: '姚淼鑫',
      organizationId: '101',
      organizationName: '设计中心1236',
      username: '2021070101',
    })
  })

  it('`id` / `organizationId` / `staffId` 都是**字符串**（页面原样发出去）', () => {
    const picked = pickCurrentUser(REAL_USER_INFO)
    expect(typeof picked.id).toBe('string')
    expect(typeof picked.organizationId).toBe('string')
    expect(typeof picked.staffId).toBe('string')
    expect(picked.numericId).toBe(18243)
  })

  it('缺 id / organizationId 就抛（否则会填出一个空白的申请部门）', () => {
    expect(() => pickCurrentUser({ ...REAL_USER_INFO, id: undefined })).toThrow(/没有 id/)
    expect(() => pickCurrentUser({ ...REAL_USER_INFO, organizationId: undefined })).toThrow(/没有 organizationId/)
    expect(() => pickCurrentUser(null)).toThrow(/当前用户信息为空/)
  })

  it('★ `resolveDerivedFields` 把 username 当工号（不是 staffId）、把 id 当 userId', async () => {
    const { calls, capability } = makeCapability()
    const derived = await capability.resolveDerivedFields(draft)

    expect(derived).toEqual({
      applicantName: '姚淼鑫',
      userId: '18243',
      // ⚠️ 工号是 username "2021070101"；staffId 是 "1163"，**不要用错那个**
      staffCode: '2021070101',
      departmentId: '101',
      departmentName: '设计中心1236',
      leaveType: 0,
      leaveHours: 3.5,
      remainingOvertimeHours: 4,
    })
    // 两次读请求，顺序是 user/info → remaining-hours
    expect(urlsOf(calls)).toEqual([
      '/admin-api/sys/user/info?_t=<ts>',
      '/admin-api/hr/overtime-application/record/remaining-hours?userId=18243&_t=<ts>',
    ])
  })

  it('剩余加班时长归一成数字（后端回字符串时也一样）', async () => {
    const { capability } = makeCapability({ remainingHours: '4.00' })
    expect(await capability.remainingOvertimeHours(18243)).toBe(4)
    const { capability: c2 } = makeCapability({ remainingHours: null })
    expect(await c2.remainingOvertimeHours(18243)).toBe(0)
    await expect(makeCapability().capability.remainingOvertimeHours('abc' as never)).rejects.toThrow(
      /userId 必须是数字/,
    )
  })
})

// ---------------------------------------------------------------------------
// 六、★ 审批链守卫（本能力最有价值的一段）
// ---------------------------------------------------------------------------

function previewOf (nodes: ApprovalChainPreview['nodes']): ApprovalChainPreview {
  return { nodes }
}

describe('调休申请 —— ★ 审批链守卫', () => {
  it('真实的审批链（发起人 18243）放行 —— 审批人是乔娜(15012)，不是同一个人', () => {
    expect(findSelfInApprovalChain(REAL_PREVIEW, 18243)).toEqual([])
    expect(() => assertNotSelfApprover(REAL_PREVIEW, 18243)).not.toThrow()
  })

  it('★ 多节点多候选人：命中在**第二个**候选人的第二个节点上也要报出来', () => {
    // 钉子：如果实现"找到第一个就 break"，这里会漏报；如果只扫 candidateUsers[0]，也会漏报
    const preview = previewOf([
      { nodeId: 'T1', name: '一级审批', type: 'USER_TASK', candidateUsers: [{ id: 11 }, { id: 12 }] },
      { nodeId: 'T2', name: '二级审批', type: 'USER_TASK', candidateUsers: [{ id: 21 }, { id: 18243 }] },
      { nodeId: 'T3', name: '三级审批', type: 'USER_TASK', candidateUsers: [{ id: 31 }] },
    ])
    const hits = findSelfInApprovalChain(preview, 18243)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.nodeId).toBe('T2')
    expect(hits[0]?.user.id).toBe(18243)
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/二级审批/)
  })

  it('★ 三处都命中时**三处都要在**（堵住"找到第一个就停"）', () => {
    const preview = previewOf([
      { nodeId: 'T1', name: '甲', type: 'USER_TASK', candidateUsers: [{ id: 18243 }] },
      { nodeId: 'T2', name: '乙', type: 'USER_TASK', candidateUsers: [{ id: 5 }, { id: 18243 }] },
      { nodeId: 'T3', name: '丙', type: 'USER_TASK', candidateUsers: [{ id: 18243 }, { id: 6 }] },
    ])
    const hits = findSelfInApprovalChain(preview, 18243)
    expect(hits.map((h) => h.nodeId)).toEqual(['T1', 'T2', 'T3'])
    expect(hits.map((h) => h.nodeName)).toEqual(['甲', '乙', '丙'])
    const message = (() => {
      try {
        assertNotSelfApprover(preview, 18243)
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()
    for (const name of ['甲', '乙', '丙']) expect(message).toContain(name)
  })

  it('★ 只看 USER_TASK：发起人出现在 START_EVENT / END_EVENT 里**不算命中**', () => {
    // 反向用例 + 正向对照：只说"不命中"可能是整个函数不工作，所以再加一个 USER_TASK 证明它会命中
    const eventsOnly = previewOf([
      { nodeId: 'S', name: null, type: 'START_EVENT', candidateUsers: [{ id: 18243 }] },
      { nodeId: 'E', name: null, type: 'END_EVENT', candidateUsers: [{ id: 18243 }] },
    ])
    expect(findSelfInApprovalChain(eventsOnly, 18243)).toEqual([])
    expect(() => assertNotSelfApprover(eventsOnly, 18243)).not.toThrow()

    const withUserTask = previewOf([
      { nodeId: 'S', name: null, type: 'START_EVENT', candidateUsers: [{ id: 18243 }] },
      { nodeId: 'U', name: '审批任务', type: 'USER_TASK', candidateUsers: [{ id: 18243 }] },
    ])
    expect(findSelfInApprovalChain(withUserTask, 18243)).toHaveLength(1)
  })

  it('id 比较不受字符串/数字类型影响（后端两种都可能回）', () => {
    const preview = previewOf([
      { nodeId: 'U', name: '审批任务', type: 'USER_TASK', candidateUsers: [{ id: '18243' as never }] },
    ])
    expect(findSelfInApprovalChain(preview, 18243)).toHaveLength(1)
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/发起人本人/)
  })

  it('空/缺失的审批链不炸，也不误报', () => {
    expect(findSelfInApprovalChain(null, 18243)).toEqual([])
    expect(findSelfInApprovalChain(undefined, 18243)).toEqual([])
    expect(findSelfInApprovalChain({ nodes: [] }, 18243)).toEqual([])
    expect(findSelfInApprovalChain({ nodes: undefined as never }, 18243)).toEqual([])
    expect(findSelfInApprovalChain(previewOf([{ nodeId: 'U', type: 'USER_TASK' }]), 18243)).toEqual([])
  })

  it('命中时的报错说清了"为什么不能发"（不可逆、撤不掉）', () => {
    const preview = previewOf([
      {
        nodeId: 'U',
        name: '直属上级审批',
        type: 'USER_TASK',
        candidateStrategy: 23,
        candidateStrategyName: '直属上级',
        candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }],
      },
    ])
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/自动审核通过/)
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/流程不处于运行中/)
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/candidateStrategy=23=直属上级/)
  })

  it('★ submit 默认跑守卫：命中时**一个写请求都不发**', async () => {
    const preview = previewOf([
      {
        nodeId: 'Activity_1ee4c6r',
        name: '直属上级审批',
        type: 'USER_TASK',
        candidateStrategy: 23,
        candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }],
      },
    ])
    const { calls, capability } = makeCapability({ preview })

    await expect(capability.submit(draft)).rejects.toThrow(/发起人本人/)
    // 三个读请求都在（user/info、remaining-hours、getRequiredStartUserSelectTasks），
    // 但 **create 一条都没有**
    expect(createCalls(calls)).toHaveLength(0)
    expect(urlsOf(calls).some((u) => u.includes('process-instance/preview'))).toBe(true)
    expect(urlsOf(calls).filter((u) => u.includes('/sys/user/info'))).toHaveLength(1)
  })

  it('★ `skipSelfApprovalGuard` 默认**关着**（守卫默认开着）；只有显式传 true 才跳过', async () => {
    const preview = previewOf([
      { nodeId: 'U', name: '直属上级审批', type: 'USER_TASK', candidateUsers: [{ id: 18243 }] },
    ])
    // 显式 false 与不传，都还在跑守卫
    for (const options of [{}, { skipSelfApprovalGuard: false }]) {
      const { calls, capability } = makeCapability({ preview })
      await expect(capability.submit(draft, options)).rejects.toThrow(/发起人本人/)
      expect(createCalls(calls)).toHaveLength(0)
    }
    // 显式 true 才放行，且**不再打 preview**（逃生口就应该是这个语义）
    const { calls, capability } = makeCapability({ preview })
    const result = await capability.submit(draft, { skipSelfApprovalGuard: true })
    expect(result).toBe(777)
    expect(createCalls(calls)).toHaveLength(1)
    expect(urlsOf(calls).some((u) => u.includes('process-instance/preview'))).toBe(false)
  })

  it('★ 守卫用的是**本次载荷**算出来的审批链，不是空表单', async () => {
    const { calls, capability } = makeCapability()
    await capability.submit(draft)

    const previewCall = calls.find((c) => String(c.url).includes('process-instance/preview'))
    const body = jsonBodyOf(previewCall)
    expect(body.processDefinitionKey).toBe(REST_LEAVE_APPLICATION_PROCESS_KEY)
    expect(body.copyUserIds).toEqual([])
    expect(body.startUserSelectAssignees).toEqual({})
    // variables 就是这次要提交的那份载荷（含用户填的事由与明细行）
    expect(body.variables).toEqual(buildRestLeaveApplicationPayload(
      { ...DERIVED, leaveHours: 3.5, remainingOvertimeHours: 4 },
      draft,
    ))
    expect((body.variables as Record<string, unknown>).reason).toBe(draft.reason)
  })
})

// ---------------------------------------------------------------------------
// 七、自选审批人节点
// ---------------------------------------------------------------------------

describe('调休申请 —— 自选审批人节点（本流程实测 0 个）', () => {
  it('prepare 返回 0 个节点（实测 getRequiredStartUserSelectTasks 恒返回 []）', async () => {
    const { calls, capability } = makeCapability()
    const prepared = await capability.prepare(draft)
    expect(prepared.tasks).toEqual([])
    // 它**要收完整载荷**（@Valid @RequestBody）：body 就是那份提交载荷
    const tasksCall = calls.find((c) => String(c.url).includes('getRequiredStartUserSelectTasks'))
    expect(jsonBodyOf(tasksCall)).toEqual(prepared.payload)
    expect(prepared.derived.leaveHours).toBe(3.5)
  })

  it('节点没覆盖就抛（将来流程被改成带自选节点时不静默出错）', () => {
    const tasks = [
      { id: 'T1', name: '甲' },
      { id: 'T2', name: '乙' },
    ]
    expect(() => assertTasksCovered(tasks, {})).toThrow(/「甲」没有选人/)
    expect(() => assertTasksCovered(tasks, { T1: [1] })).toThrow(/「乙」没有选人/)
    expect(() => assertTasksCovered(tasks, { T1: [1], T2: [2] })).not.toThrow()
    expect(() => assertTasksCovered(tasks, { T1: [1], T2: [] })).toThrow(/「乙」没有选人/)
  })

  it('多给了节点 id 也抛（本流程正常应当传 {}）', () => {
    expect(() => assertTasksCovered([], { T9: [1] })).toThrow(/不是本次的审批人节点/)
    expect(() => assertTasksCovered([{ id: 'T1', name: '甲' }], { T1: [1], T9: [1] })).toThrow(/T9/)
    expect(() => assertTasksCovered([], {})).not.toThrow()
  })

  it('submit 会在写之前挡住"给了节点但本次没有节点"', async () => {
    const { calls, capability } = makeCapability()
    await expect(capability.submit(draft, { startUserSelectAssignees: { T9: [1] } })).rejects.toThrow(
      /不是本次的审批人节点/,
    )
    expect(createCalls(calls)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 八、提交 / 查询 / 撤销链路
// ---------------------------------------------------------------------------

describe('调休申请 —— 写链路的请求形状', () => {
  it('★ submit 的请求顺序：读 → 读 → 任务节点 → 守卫 → create（只有最后一条是写）', async () => {
    const { calls, capability } = makeCapability()
    const result = await capability.submit(draft)

    expect(result).toBe(777)
    expect(urlsOf(calls)).toEqual([
      '/admin-api/sys/user/info?_t=<ts>',
      '/admin-api/hr/overtime-application/record/remaining-hours?userId=18243&_t=<ts>',
      '/admin-api/hr/rest-leave-application/getRequiredStartUserSelectTasks',
      '/admin-api/bpm/process-instance/preview',
      '/admin-api/hr/rest-leave-application/create',
    ])
  })

  it('create 的 body = 提交载荷 + 末尾的 startUserSelectAssignees', async () => {
    const { calls, capability } = makeCapability()
    await capability.submit(draft)
    const body = jsonBodyOf(createCalls(calls)[0])
    expect(Object.keys(body)).toEqual([
      'id',
      'applicantName',
      'userId',
      'staffCode',
      'departmentId',
      'departmentName',
      'leaveType',
      'remainingOvertimeHours',
      'reason',
      'leaveDateItems',
      'leaveHours',
      'attachments',
      'startUserSelectAssignees',
    ])
    expect(body.startUserSelectAssignees).toEqual({})
    expect(body.leaveHours).toBe(3.5)
  })

  it('detail 的请求与基准里的路径同族（GET + id 查询参数）', async () => {
    const { calls, capability } = makeCapability({ detail: { id: 777, status: 4, statusName: '已取消' } })
    const record = await capability.detail(777)
    expect(record.status).toBe(4)
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/hr/rest-leave-application/get?id=777&_t=<ts>')
    await expect(Promise.resolve().then(() => capability.detail(''))).rejects.toThrow(/id 不能为空/)
  })

  it('my-page 的查询参数与「我的流程」页一致（空串也要发）', async () => {
    const { calls, capability } = makeCapability()
    await capability.myInstances({ status: 1, processType: 2 })
    expect(queryOf(calls[0])).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['name', ''],
      ['title', ''],
      ['category', ''],
      ['status', '1'],
      ['processType', '2'],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('★ `findInstanceByBusinessKey` 要按 `processDefinitionKey` 再筛一道（businessKey 会撞车）', async () => {
    const { capability } = makeCapability({
      myPage: {
        list: [
          // 同一个 businessKey 77，但属于别的流程 —— 认它就会取消错单子
          { id: 'inst-other', businessKey: '77', processDefinitionKey: 'meeting_application', status: 1 },
          { id: 'inst-mine', businessKey: '77', processDefinitionKey: REST_LEAVE_APPLICATION_PROCESS_KEY, status: 1 },
        ],
        total: 2,
      },
    })
    const instance = await capability.findInstanceByBusinessKey(77)
    expect(instance.id).toBe('inst-mine')
  })

  it('★ 第一页没有就翻第二页（提前 break 的分支走不到就是假绿）', async () => {
    const page1 = {
      list: Array.from({ length: 50 }, (_, i) => ({
        id: `p1-${i}`,
        businessKey: String(1000 + i),
        processDefinitionKey: REST_LEAVE_APPLICATION_PROCESS_KEY,
      })),
      total: 60,
    }
    const page2 = {
      list: [
        { id: 'p2-0', businessKey: '2000', processDefinitionKey: REST_LEAVE_APPLICATION_PROCESS_KEY },
        { id: 'p2-1', businessKey: '77', processDefinitionKey: REST_LEAVE_APPLICATION_PROCESS_KEY },
      ],
      total: 60,
    }
    const { calls, capability } = makeCapability(
      { myPageByPage: { 1: page1, 2: page2 } },
      { scanPageSize: 50, maxScanPages: 3 },
    )
    const instance = await capability.findInstanceByBusinessKey(77)
    expect(instance.id).toBe('p2-1')
    expect(queryOf(calls[0])).toContainEqual(['pageNo', '1'])
    expect(queryOf(calls[1])).toContainEqual(['pageNo', '2'])
  })

  it('翻完上限还没找到就抛，且说清可能的原因', async () => {
    const { calls, capability } = makeCapability(
      { myPage: { list: [], total: 0 } },
      { maxScanPages: 2, scanPageSize: 50 },
    )
    await expect(capability.findInstanceByBusinessKey(77)).rejects.toThrow(/没找到 businessKey=77/)
    expect(calls).toHaveLength(1) // 空页直接 break，不会白翻第 2 页
    await expect(capability.findInstanceByBusinessKey('')).rejects.toThrow(/businessKey 不能为空/)
  })

  it('★ cancel 走 processInstanceId 时直接发，不再去翻「我的流程」', async () => {
    const { calls, capability } = makeCapability()
    await capability.cancel({ processInstanceId: 'inst-1', reason: 'SDK-TEST 撤销' })
    expect(urlsOf(calls)).toEqual(['/admin-api/bpm/process-instance/cancel-by-start-user'])
    expect(jsonBodyOf(calls[0])).toEqual({ id: 'inst-1', reason: 'SDK-TEST 撤销' })
    expect(String(calls[0]?.method).toLowerCase()).toBe('delete')
  })

  it('★ cancel 走 businessKey 时先换流程实例 id（因为 detail 里没有 processInstanceId）', async () => {
    const { calls, capability } = makeCapability({
      myPage: {
        list: [
          { id: 'inst-9', businessKey: '77', processDefinitionKey: REST_LEAVE_APPLICATION_PROCESS_KEY, status: 1 },
        ],
        total: 1,
      },
    })
    await capability.cancel({ businessKey: 77, reason: 'SDK-TEST 撤销' })
    expect(urlsOf(calls)).toEqual([
      '/admin-api/bpm/process-instance/my-page?order=&orderField=&name=&title=&category=&pageNo=1&pageSize=50&_t=<ts>',
      '/admin-api/bpm/process-instance/cancel-by-start-user',
    ])
    expect(jsonBodyOf(calls[1])).toEqual({ id: 'inst-9', reason: 'SDK-TEST 撤销' })
  })

  it('cancel 的 reason 必填且要 trim；两个 id 至少要有一个', async () => {
    const { calls, capability } = makeCapability()
    await expect(capability.cancel({ processInstanceId: 'i', reason: '   ' })).rejects.toThrow(/@NotEmpty/)
    await expect(capability.cancel({ processInstanceId: 'i', reason: '' })).rejects.toThrow(/reason 必填/)
    await expect(capability.cancel({ processInstanceId: 'i' } as never)).rejects.toThrow(/reason 必填/)
    await expect(capability.cancel({ reason: 'x' })).rejects.toThrow(/processInstanceId 或 businessKey/)
    expect(calls).toHaveLength(0)

    // trim 只去掉**两端**的空白（页面/后端要的是非空串），中间的空格原样保留
    await capability.cancel({ processInstanceId: 'i', reason: '  撤销原因  ' })
    expect(jsonBodyOf(calls[0]).reason).toBe('撤销原因')
    expect(jsonBodyOf(calls[0]).id).toBe('i')
  })
})

// ---------------------------------------------------------------------------
// 九、能力定义本身
// ---------------------------------------------------------------------------

describe('调休申请 —— 能力定义', () => {
  it('每个能力内部的参数名**不重名**（否则 redocly 的 operation-parameters-unique 会拦下）', () => {
    for (const definition of restLeaveApplicationCapabilities) {
      const names = definition.params.map((p) => p.name)
      expect(new Set(names).size, `能力 ${definition.id} 的参数名有重复：${names.join(',')}`).toBe(names.length)
    }
  })

  it('能力 id 不重复，且都带 rest-leave-application 前缀', () => {
    const ids = restLeaveApplicationCapabilities.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith('rest-leave-application-')).toBe(true)
  })

  it('写能力只有两个：submit 与 cancel', () => {
    const writes = restLeaveApplicationCapabilities.filter((d) => d.write).map((d) => d.id).sort()
    expect(writes).toEqual(['rest-leave-application-cancel', 'rest-leave-application-submit'])
  })

  it('enum 参数都带 options；本流程**没有** search/tree 类长选项参数', () => {
    for (const definition of restLeaveApplicationCapabilities) {
      for (const param of definition.params) {
        if (param.kind === 'enum') expect(param.options?.length, `${definition.id}.${param.name}`).toBeGreaterThan(0)
      }
      // 本表单没有人员/部门选择器，加 search/tree 就是凭空多一条对不上的接口
      expect(definition.params.some((p) => p.kind === 'search' || p.kind === 'tree')).toBe(false)
    }
  })

  it('提交能力的必填参数就是调用方能填的那 3 个（其余全是只读联动）', () => {
    const submit = restLeaveApplicationCapabilities.find((d) => d.id === 'rest-leave-application-submit')
    const required = submit?.params.filter((p) => p.required).map((p) => p.name).sort()
    expect(required).toEqual(['leaveDateItems', 'reason'])
    expect(submit?.params.map((p) => p.name).sort()).toEqual([
      'attachments',
      'leaveDateItems',
      'reason',
      'skipSelfApprovalGuard',
      'startUserSelectAssignees',
    ])
  })
})
