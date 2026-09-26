import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  OVERTIME_APPLICATION_FORM_PATH,
  OVERTIME_APPLICATION_MY_LIST_PATH,
  OVERTIME_APPLICATION_PAGE_PATH,
  OVERTIME_APPLICATION_PROCESS_KEY,
  OVERTIME_APPLICATION_PROCESS_TYPE,
  OVERTIME_TYPE_OPTIONS,
  REASON_MAX,
  SUBSIDY_TYPE_OPTIONS,
  assertNotSelfApprover,
  assertTasksCovered,
  buildOvertimeApplicationCreatePayload,
  buildOvertimeApplicationPayload,
  calculateOvertimeHours,
  createOvertimeApplicationCapability,
  findSelfInApprovalChain,
  overtimeApplicationCapabilities,
  parsePortalDateTime,
  pickCurrentUser,
  portalToday,
  type ApprovalChainPreview,
  type OvertimeApplicationDerived,
  type OvertimeApplicationDraft,
  type ProcessInstanceRow,
} from '../src/capabilities/overtime-application.js'

/**
 * 加班申请（`hr_overtime_application` / `/simple/hr/form/042`）—— 流程表单第三条线。
 *
 * 三条来源，逐条钉住：
 *   1. `baseline/overtime-application.browser.json`：真实浏览器抓的只读请求
 *      （其中 `POST /bpm/process-instance/preview` 的 `variables` 就是 `buildSubmitData()` 的产物
 *      —— 本表单的特有路子：点「查看审批流程」就能看到"提交会发什么"，不用真的提交）
 *   2. Portal 前端源码 `app/portal/views/simple/hr/form/042/**` 与 `common/libs/flow-form/**`
 *   3. 后端源码 `OvertimeApplicationController` / `OvertimeApplicationSaveReqVO` /
 *      `OvertimeApplicationServiceImpl` / `BpmTaskCandidateStrategyEnum`
 *
 * 真实写链路的往返记录在 `docs/pages/加班申请.md`。
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
  表单填写值: Record<string, unknown>
  提交载荷: { body: string; 逐字段类型: Record<string, string> }
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/overtime-application.browser.json'), 'utf8'),
)

/** 去掉主机与一次性时间戳，只留 path + query */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

const baselineUrls = new Set(baseline.请求.map((r) => normalize(r.u)))
const baselinePreview = baseline.请求.find((r) => r.u.endsWith('/bpm/process-instance/preview'))

/** 基准里 `variables` 那一层（= buildSubmitData() 的真实产物） */
const baselineVariablesBody = JSON.parse(
  JSON.parse(baselinePreview?.body as string).variables === undefined
    ? '{}'
    : JSON.stringify(JSON.parse(baselinePreview?.body as string).variables),
) as Record<string, unknown>
/** 基准里 preview 的完整 body（含 processDefinitionKey / startUserSelectAssignees / copyUserIds） */
const baselinePreviewBody = baselinePreview?.body as string

/**
 * 与基准同一份只读联动结果 + 填写值。**两边各自独立取值**，再由
 * «写死的填写值与基准里记的一致» 那一条兜住漂移。
 */
const BASELINE_DERIVED: OvertimeApplicationDerived = {
  applicantId: '18243',
  applicantName: '姚淼鑫',
  applyDate: '2026-09-21',
  applyDepartmentId: '101',
  applyDepartmentName: '设计中心1236',
  overtimeHours: 2.5,
}

/**
 * 只读联动的 5 个字段，**不带 overtimeHours**。
 *
 * 为什么要单分一份：`buildOvertimeApplicationPayload` 有一条"调用方给的 overtimeHours
 * 必须与算出来的一致"，而下面大量用例**故意改时间/休息时长**去验证算法。
 * 带着一个写死的 `overtimeHours: 2.5` 去改时间，红的会是那条一致性检查，**不是被测的那条**——
 * 那正是"测试看起来绿了、其实测的不是它"的典型。所以校验类用例用这一份（不给 = 不参与一致性检查）。
 */
const DERIVED: OvertimeApplicationDerived = {
  applicantId: '18243',
  applicantName: '姚淼鑫',
  applyDate: '2026-09-21',
  applyDepartmentId: '101',
  applyDepartmentName: '设计中心1236',
}

const BASELINE_DRAFT: OvertimeApplicationDraft = {
  reason: 'SDK-TEST-加班申请冒烟 基线抓取用（不会提交）',
  overtimeType: 1,
  subsidyType: 1,
  startTime: '2026-09-22 18:00:00',
  endTime: '2026-09-22 21:00:00',
  breakHours: 0.5,
}

/** 日常用的一份草稿（不做逐字节对照时用这个，名字明显是测试数据） */
const draft: OvertimeApplicationDraft = {
  reason: 'SDK-TEST-加班申请冒烟',
  overtimeType: 0,
  subsidyType: 0,
  startTime: '2026-09-22 18:00:00',
  endTime: '2026-09-22 21:00:00',
  breakHours: 0.5,
}

/**
 * 【实测 2026-09-21】`POST /bpm/process-instance/preview` 的真实响应（原样抄下来）。
 * 审批人是「直属上级」算出来的 **乔娜(15012)**，发起人是 **18243** —— 不是同一个人。
 */
const REAL_PREVIEW: ApprovalChainPreview = {
  processDefinitionId: 'hr_overtime_application:2:69371eab-18f5-11f1-954e-00505683dd67',
  processDefinitionKey: 'hr_overtime_application',
  processDefinitionName: '加班审批',
  state: 'CONFIRMED',
  nodes: [
    { nodeId: 'Event_055wg5p', name: null, type: 'START_EVENT', candidateStrategy: null, candidateUsers: [] },
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
    { nodeId: 'Event_04lk73x', name: null, type: 'END_EVENT', candidateStrategy: null, candidateUsers: [] },
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
 */
function makeCapability (routes: {
  userInfo?: unknown
  tasks?: unknown
  preview?: unknown
  create?: unknown
  detail?: unknown
  myPage?: unknown
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
    else if (url.includes('getRequiredStartUserSelectTasks')) data = routes.tasks ?? []
    else if (url.includes('/bpm/process-instance/preview')) data = routes.preview ?? REAL_PREVIEW
    else if (url.includes('/hr/overtime-application/create')) data = routes.create ?? 777
    else if (url.includes('/hr/overtime-application/get')) data = routes.detail ?? { id: 777 }
    else if (url.includes('/bpm/process-instance/my-page')) data = routes.myPage ?? { list: [], total: 0 }
    else if (url.includes('cancel-by-start-user')) data = routes.cancel ?? true
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const capability = createOvertimeApplicationCapability(
    (requestConfig) => sdk.call(OVERTIME_APPLICATION_FORM_PATH, requestConfig),
    options,
  )
  return { sdk, calls, capability }
}

/** axios 在到达 adapter 前已按 transformRequest 把对象序列化成字符串 */
function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
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

// ---------------------------------------------------------------------------
// 一、与浏览器基准一致
// ---------------------------------------------------------------------------

describe('加班申请 —— 读链路与浏览器基准一致', () => {
  it('写死的填写值与只读联动结果与基准里记的一致（两边不会各自漂移）', () => {
    const 表单填写值 = baseline.表单填写值 as Record<string, unknown>
    expect(BASELINE_DRAFT.reason).toBe(表单填写值.reason)
    expect(BASELINE_DRAFT.overtimeType).toBe(表单填写值.overtimeType)
    expect(BASELINE_DRAFT.subsidyType).toBe(表单填写值.subsidyType)
    expect(BASELINE_DRAFT.startTime).toBe(表单填写值.startTime)
    expect(BASELINE_DRAFT.endTime).toBe(表单填写值.endTime)
    expect(BASELINE_DRAFT.breakHours).toBe(表单填写值.breakHours)

    const 类型 = baseline.提交载荷.逐字段类型
    expect(BASELINE_DERIVED.applicantId).toBe('18243')
    expect(类型.applicantId).toContain('字符串')
    expect(BASELINE_DERIVED.applyDepartmentId).toBe('101')
    expect(类型.applyDepartmentId).toContain('字符串')
  })

  it('流程 key 与入口 URL 里的值一致，表单路径也一致', () => {
    expect(OVERTIME_APPLICATION_PROCESS_KEY).toBe('hr_overtime_application')
    expect(baseline.入口).toContain(`processDefinitionKey=${OVERTIME_APPLICATION_PROCESS_KEY}`)
    expect(baseline.入口).toContain('formCustomCreatePath=simple/hr/form/042')
    expect(OVERTIME_APPLICATION_FORM_PATH).toBe('/simple/hr/form/042')
  })

  it('流程定义请求与基准一致', async () => {
    const { calls, capability } = makeCapability()
    await capability.definition()

    const actual = normalize(String(calls[0]?.url))
    expect(actual).toBe(`/admin-api/bpm/process-definition/get?key=${OVERTIME_APPLICATION_PROCESS_KEY}&_t=<ts>`)
    expect(baselineUrls.has(actual)).toBe(true)
  })

  it('三条页面路径都算不出 module-type（SDK 与浏览器一致：不发这个头）', () => {
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    for (const path of [
      OVERTIME_APPLICATION_FORM_PATH,
      OVERTIME_APPLICATION_PAGE_PATH,
      OVERTIME_APPLICATION_MY_LIST_PATH,
    ]) {
      expect(sdk.resolveModuleType(path).moduleType).toBeNull()
    }
  })

  it('基准本身记录了「页面挂载时无关键字拉全量人员」（D6 的由来）', () => {
    const pulls = baseline.请求.filter((r) => r.u.includes('/system/user/simple-page'))
    expect(pulls.length).toBeGreaterThan(0)
    for (const pull of pulls) {
      expect(pull.u).toContain('pageSize=500')
      expect(pull.u).not.toContain('nickname=')
    }
    // 本能力**一条都不打**这个接口（页面上没有人员控件）；上面那条基准只是记录页面的行为
    const urls = baseline.请求.map((r) => r.u)
    expect(urls.filter((u) => u.includes('simple-list')).length).toBeGreaterThan(0)
  })

  it('提交载荷的 12 个字段一个不多一个不少，且与基准逐字节相同（含键顺序）', () => {
    const payload = buildOvertimeApplicationPayload(BASELINE_DERIVED, BASELINE_DRAFT)
    expect(Object.keys(payload)).toEqual([
      'applicantId',
      'applicantName',
      'applyDate',
      'applyDepartmentId',
      'applyDepartmentName',
      'reason',
      'overtimeType',
      'subsidyType',
      'startTime',
      'endTime',
      'breakHours',
      'overtimeHours',
    ])
    expect(JSON.stringify(payload)).toBe(baseline.提交载荷.body)
    expect(JSON.parse(JSON.stringify(payload))).toEqual(baselineVariablesBody)
  })

  it('create 的 body = 基准 body + startUserSelectAssignees，且它**排在最后**', () => {
    const body = buildOvertimeApplicationCreatePayload(BASELINE_DERIVED, BASELINE_DRAFT, {})
    const text = JSON.stringify(body)
    expect(text).toBe(`${baseline.提交载荷.body.slice(0, -1)},"startUserSelectAssignees":{}}`)
    expect(JSON.parse(text)).toEqual({ ...baselineVariablesBody, startUserSelectAssignees: {} })
  })

  it('审批链预览的请求体与基准**逐字节**相同', async () => {
    const { calls, capability } = makeCapability()
    await capability.approvalChain(
      JSON.parse(JSON.stringify(baselineVariablesBody)) as Record<string, unknown>,
    )

    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/bpm/process-instance/preview')
    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(rawBodyOf(calls[0])).toBe(baselinePreviewBody)
  })

  it('preview 与定义这两条请求的头部集合与基准一致，且**都不发 module-type**', async () => {
    const { calls, capability } = makeCapability()
    await capability.definition()
    await capability.approvalChain({})

    const headers = calls[0]?.headers as unknown as Record<string, string>
    expect(headers['tenant-id']).toBe('1')
    expect(headers['Accept-Language']).toBe('zh-CN')
    for (const call of calls) {
      expect(call.headers as unknown as Record<string, string>).not.toHaveProperty('module-type')
    }
  })
})

// ---------------------------------------------------------------------------
// 二、只读联动：加班时长（页面上 disabled 的那个字段）
// ---------------------------------------------------------------------------

describe('只读联动：calculateOvertimeHours 逐位复刻页面（含 toFixed(1) 的尾数行为）', () => {
  const cases: Array<{ start: string; end: string; breakHours: number; expected: number; 说明: string }> = [
    { start: '2026-09-22 18:00:00', end: '2026-09-22 21:00:00', breakHours: 0, expected: 3, 说明: '3 小时整，不带休息' },
    { start: '2026-09-22 18:00:00', end: '2026-09-22 21:00:00', breakHours: 0.5, expected: 2.5, 说明: '★ 基准那一组：3 - 0.5 = 2.5' },
    { start: '2026-09-22 09:00:00', end: '2026-09-22 18:00:00', breakHours: 1, expected: 8, 说明: '白天 9 小时扣 1' },
    { start: '2026-09-22 18:00:00', end: '2026-09-22 21:20:00', breakHours: 0, expected: 3.3, 说明: '3.3333… 被 toFixed(1) 收成 3.3（**不是** round-half 的 3.4）' },
    { start: '2026-09-22 20:30:00', end: '2026-09-22 22:00:00', breakHours: 0, expected: 1.5, 说明: '非整点也要能算' },
    { start: '2026-09-22 22:00:00', end: '2026-09-23 01:00:00', breakHours: 0, expected: 3, 说明: '**跨天**：结束时间落在第二天' },
    { start: '2026-09-22 18:00:00', end: '2026-09-22 21:00:00', breakHours: 3, expected: 0, 说明: '休息 == 总时长 ⇒ Math.max 夹成 0（这一条会被「不能为0」拦下）' },
    { start: '2026-09-22 18:00:00', end: '2026-09-22 21:00:00', breakHours: 5, expected: 0, 说明: '休息 > 总时长 ⇒ 还是 0，**不会变成负数**' },
    { start: '2026-09-22 18:00:00', end: '2026-09-22 18:30:00', breakHours: 0, expected: 0.5, 说明: '半小时' },
  ]

  it('9 组输入各自算出期望值（含跨天、非整点、夹到 0 三类边界）', () => {
    // 断言逐个写死，**不是**把期望值写成 calculate(...) 的同义反复
    expect(cases.map((c) => c.expected)).toEqual([3, 2.5, 8, 3.3, 1.5, 3, 0, 0, 0.5])
    for (const item of cases) {
      const value = calculateOvertimeHours(
        parsePortalDateTime(item.start, 'start'),
        parsePortalDateTime(item.end, 'end'),
        item.breakHours,
      )
      expect(value, item.说明).toBe(item.expected)
    }
  })

  it('结果永远是 1 位小数以内的数字（toFixed(1) + parseFloat 的产物形状）', () => {
    for (const item of cases) {
      const value = calculateOvertimeHours(
        parsePortalDateTime(item.start, 'start'),
        parsePortalDateTime(item.end, 'end'),
        item.breakHours,
      )
      // parseFloat 会把 3.0 变回 3：所以小数位只可能是 0 或 1 位
      expect(String(value)).not.toMatch(/\.\d\d/)
    }
  })

  it('★ 走的是 JS toFixed 的舍入，不是"四舍五入"的直觉（这一条专门用来杀 Math.round 变异）', () => {
    // 3 小时 3 分 = 3.05，二进制里是 3.0499999999999998 ⇒ `(3.05).toFixed(1)` 给 "3.0" ⇒ 3。
    // 而 `Math.round(3.05*10)/10` 给 3.1。两条路在这一组输入上**分叉**，
    // 所以"把 toFixed 换成 Math.round"这个变异会红 —— 页面用的是 toFixed，SDK 必须一样。
    const ms = (h: number, m: number) => Date.UTC(2026, 8, 22, h, m)
    expect((3.05).toFixed(1)).toBe('3.0') // 先把"JS 到底怎么舍"钉住，免得后人以为断言写错了
    expect(calculateOvertimeHours(ms(0, 0), ms(3, 3), 0)).toBe(3)
    // 另一组：3 小时 5 分 = 3.0833… ⇒ 3.1（这组两条路一致，作为对照）
    expect(calculateOvertimeHours(ms(0, 0), ms(3, 5), 0)).toBe(3.1)
    // 1 小时 1 分 = 1.0166… ⇒ 1，且 parseFloat 把 "1.0" 变回整数 1
    expect(calculateOvertimeHours(ms(0, 0), ms(1, 1), 0)).toBe(1)
  })
})

describe('时间解析与「今天」', () => {
  it('严格格式：斜杠 / 缺秒 / 非字符串 / 不存在的日期 全部拒绝', () => {
    for (const bad of [
      '2026/09/22 18:00:00',
      '2026-09-22T18:00:00',
      '2026-09-22 18:00',
      '2026-9-22 18:00:00',
      '2026-02-30 10:00:00',
      '2026-13-01 10:00:00',
      '2026-09-22 25:00:00',
      '  ',
      '',
    ]) {
      expect(() => parsePortalDateTime(bad, '开始加班时间'), bad).toThrow()
    }
    for (const bad of [null, undefined, 20260922180000, {}]) {
      expect(() => parsePortalDateTime(bad, '开始加班时间')).toThrow(/必须是/)
    }
  })

  it('合法值按**本地时区**解析（与页面用的 dayjs 一致），不是 UTC', () => {
    const ms = parsePortalDateTime('2026-09-22 18:00:00', 'start')
    const d = new Date(ms)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(22)
    expect(d.getHours()).toBe(18)
    expect(d.getMinutes()).toBe(0)
  })

  it('portalToday 按 Asia/Shanghai 取日期，而不是进程本地时区', () => {
    // 2026-09-21 16:30 UTC == 2026-09-22 00:30 北京时间 ⇒ 门户的"今天"是 22 号
    const utcEvening = new Date(Date.UTC(2026, 8, 21, 16, 30, 0))
    expect(portalToday(utcEvening, 'UTC')).toBe('2026-09-21')
    expect(portalToday(utcEvening, 'Asia/Shanghai')).toBe('2026-09-22')
    // 默认参数就是 Asia/Shanghai
    expect(portalToday(utcEvening)).toBe('2026-09-22')
  })
})

// ---------------------------------------------------------------------------
// 三、载荷构造：本地校验（每一条都在**发请求之前**）
// ---------------------------------------------------------------------------

describe('载荷构造：页面的 formRules 与后端的 @Valid 一起复刻', () => {
  it('reason 空 / 全空白 / 超 500 字被拦；500 字本身放行', () => {
    for (const bad of ['', '   ', '\n\t']) {
      expect(() => buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, reason: bad })).toThrow(/加班事由/)
    }
    expect(() =>
      buildOvertimeApplicationPayload(DERIVED, {
        ...BASELINE_DRAFT,
        reason: 'x'.repeat(REASON_MAX + 1),
      }),
    ).toThrow(new RegExp(`最多 ${REASON_MAX}`))
    expect(() =>
      buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, reason: 'x'.repeat(REASON_MAX) }),
    ).not.toThrow()
  })

  it('两个下拉各 3 个合法值，越界 / 非数字 / 字符串数字 全部拒绝', () => {
    expect(OVERTIME_TYPE_OPTIONS.map((o) => o.value)).toEqual([0, 1, 2])
    expect(SUBSIDY_TYPE_OPTIONS.map((o) => o.value)).toEqual([0, 1, 2])
    for (const bad of [3, -1, 1.5, '0', null, undefined, true]) {
      expect(
        () => buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, overtimeType: bad as number }),
        `overtimeType=${JSON.stringify(bad)}`,
      ).toThrow(/加班类型/)
      expect(
        () => buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, subsidyType: bad as number }),
        `subsidyType=${JSON.stringify(bad)}`,
      ).toThrow(/补贴类型/)
    }
    for (const good of [0, 1, 2]) {
      expect(() =>
        buildOvertimeApplicationPayload(DERIVED, {
          ...BASELINE_DRAFT,
          overtimeType: good,
          subsidyType: good,
        }),
      ).not.toThrow()
    }
  })

  it('结束时间必须**严格晚于**开始时间：相等也红（后端 !endTime.isAfter）', () => {
    expect(() =>
      buildOvertimeApplicationPayload(DERIVED, {
        ...BASELINE_DRAFT,
        endTime: BASELINE_DRAFT.startTime,
      }),
    ).toThrow(/必须晚于/)
    expect(() =>
      buildOvertimeApplicationPayload(DERIVED, {
        ...BASELINE_DRAFT,
        startTime: '2026-09-22 21:00:00',
        endTime: '2026-09-22 18:00:00',
      }),
    ).toThrow(/必须晚于/)
    // 晚 1 秒就合法
    expect(() =>
      buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, endTime: '2026-09-22 21:00:01' }),
    ).not.toThrow()
  })

  it('breakHours 负数 / NaN / 字符串 全部拒绝，0 放行', () => {
    for (const bad of [-0.1, Number.NaN, '0.5', null, undefined]) {
      expect(
        () => buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, breakHours: bad as number }),
        JSON.stringify(bad),
      ).toThrow(/中途休息时长/)
    }
    expect(() =>
      buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, breakHours: 0 }),
    ).not.toThrow()
  })

  it('★ 加班时长算成 0 时红，并说清是"休息时长吃掉了整段"（页面会弹「加班时长不能为0」）', () => {
    // 页面 `:max="maxBreakHours"` 的上限就是「结束-开始」；越界过一次，这一条兜住
    expect(() =>
      buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, breakHours: 3 }),
    ).toThrow(/加班时长不能为0|算出来是 0/)
    expect(() =>
      buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, breakHours: 3.05 }),
    ).toThrow(/算出来是 0/)
    // 擦边但 > 0 的放行
    expect(() =>
      buildOvertimeApplicationPayload(DERIVED, { ...BASELINE_DRAFT, breakHours: 2.9 }),
    ).not.toThrow()
  })

  it('只读联动的 5 个字段缺一个就红（它们没有输入口，不能由调用方编）', () => {
    const keys = ['applicantId', 'applicantName', 'applyDate', 'applyDepartmentId', 'applyDepartmentName'] as const
    // 逐个拿掉，每一次红的信息里要点到那个字段名 —— 一次只测一个才是"逐条"
    for (const key of keys) {
      const broken = { ...DERIVED, [key]: undefined } as OvertimeApplicationDerived
      expect(() => buildOvertimeApplicationPayload(broken, BASELINE_DRAFT), key).toThrow(
        new RegExp(key),
      )
    }
    expect(() =>
      buildOvertimeApplicationPayload(null as unknown as OvertimeApplicationDerived, BASELINE_DRAFT),
    ).toThrow(/只读联动/)
  })

  it('★ overtimeHours 是只读自动算的：调用方塞一个不一样的值 ⇒ 红', () => {
    expect(() =>
      buildOvertimeApplicationPayload({ ...DERIVED, overtimeHours: 99 }, BASELINE_DRAFT),
    ).toThrow(/不接受调用方给值/)
    // 塞一个**恰好正确**的值不红（它不是"不能出现"，是"不能是别的值"）
    expect(() =>
      buildOvertimeApplicationPayload({ ...DERIVED, overtimeHours: 2.5 }, BASELINE_DRAFT),
    ).not.toThrow()
  })

  it('create 的 assignees：字符串 id 归一成数字，非数字红，null 红', () => {
    const body = buildOvertimeApplicationCreatePayload(DERIVED, BASELINE_DRAFT, {
      Task_A: ['197832' as unknown as number],
    })
    expect((body.startUserSelectAssignees as Record<string, number[]>).Task_A).toEqual([197832])
    expect(() =>
      buildOvertimeApplicationCreatePayload(DERIVED, BASELINE_DRAFT, {
        Task_A: ['x' as unknown as number],
      }),
    ).toThrow(/不是数字/)
    expect(() =>
      buildOvertimeApplicationCreatePayload(DERIVED, BASELINE_DRAFT, {
        Task_A: 1 as unknown as number[],
      }),
    ).toThrow(/必须是用户 id 数组/)
    expect(() =>
      buildOvertimeApplicationCreatePayload(
        DERIVED,
        BASELINE_DRAFT,
        null as unknown as Record<string, number[]>,
      ),
    ).toThrow(/startUserSelectAssignees/)
  })
})

// ---------------------------------------------------------------------------
// 四、★ 当前用户白名单（本文件最要紧的两条之一）
// ---------------------------------------------------------------------------

describe('当前用户：/sys/user/info 的响应必须白名单收敛', () => {
  it('★ password2 / salt / mobile 等一律不进返回值（逐条点名，不是"检查某个键不存在"）', () => {
    const user = pickCurrentUser(REAL_USER_INFO)
    const serialized = JSON.stringify(user)
    for (const canary of ['LEAK-CANARY-password2', 'LEAK-CANARY-salt', 'LEAK-CANARY-mobile']) {
      expect(serialized, canary).not.toContain(canary)
    }
    for (const key of ['password2', 'salt', 'mobile', 'headUrl', 'email', 'superAdmin', 'roleList', 'deptId']) {
      expect(user, key).not.toHaveProperty(key)
    }
    // 键集**恰好**是白名单那 10 个对应的子集（含派生出来的 numericId）
    expect(Object.keys(user).sort()).toEqual(
      [
        'id',
        'numericId',
        'organizationCode',
        'organizationId',
        'organizationName',
        'postId',
        'postName',
        'realName',
        'staffId',
        'tenantId',
        'username',
      ].sort(),
    )
  })

  it('id / organizationId / staffId / postId 保持**字符串**（载荷里原样发出去的那几个）', () => {
    const user = pickCurrentUser(REAL_USER_INFO)
    expect(user.id).toBe('18243')
    expect(typeof user.id).toBe('string')
    expect(user.organizationId).toBe('101')
    expect(typeof user.organizationId).toBe('string')
    expect(user.staffId).toBe('1163')
    expect(user.postId).toBe('702')
    // numericId 只是给比较用的派生值
    expect(user.numericId).toBe(18243)
  })

  it('用收敛出来的用户拼的载荷，applicantId 是字符串 "18243"（与浏览器逐字段一致）', () => {
    const user = pickCurrentUser(REAL_USER_INFO)
    const derived: OvertimeApplicationDerived = {
      applicantId: user.id,
      applicantName: user.realName,
      applyDate: '2026-09-21',
      applyDepartmentId: user.organizationId,
      applyDepartmentName: user.organizationName,
      overtimeHours: 2.5,
    }
    expect(JSON.stringify(buildOvertimeApplicationPayload(derived, BASELINE_DRAFT))).toBe(
      baseline.提交载荷.body,
    )
  })

  it('缺 id / 缺 organizationId / 非对象 都红，且说清是哪个字段', () => {
    const { id: _id, ...noId } = REAL_USER_INFO
    const { organizationId: _org, ...noOrg } = REAL_USER_INFO
    expect(() => pickCurrentUser(noId)).toThrow(/没有 id/)
    expect(() => pickCurrentUser(noOrg)).toThrow(/organizationId/)
    for (const bad of [null, undefined, 'x', 1]) {
      expect(() => pickCurrentUser(bad)).toThrow(/没返回对象|为空/)
    }
  })

  it('接口层的 currentUser() 已经把原响应换掉了（真实 adapter 上再验一次）', async () => {
    const { calls, capability } = makeCapability()
    const user = await capability.currentUser()
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/sys/user/info?_t=<ts>')
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
    expect(JSON.stringify(user)).not.toContain('LEAK-CANARY')
  })
})

// ---------------------------------------------------------------------------
// 五、★ 审批链守卫（本文件最要紧的两条之二）
// ---------------------------------------------------------------------------

describe('★ 审批链守卫：审批链里不能有发起人本人', () => {
  it('真实的 preview 响应里没有发起人本人（乔娜 15012 ≠ 姚淼鑫 18243）', () => {
    expect(findSelfInApprovalChain(REAL_PREVIEW, 18243)).toEqual([])
    expect(() => assertNotSelfApprover(REAL_PREVIEW, 18243)).not.toThrow()
  })

  it('发起人就是直属上级时命中，错误信息点名**节点与策略**，并说清后果不可逆', () => {
    const preview: ApprovalChainPreview = {
      ...REAL_PREVIEW,
      nodes: REAL_PREVIEW.nodes.map((node) =>
        node.type === 'USER_TASK' ? { ...node, candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }] } : node,
      ),
    }
    const hits = findSelfInApprovalChain(preview, 18243)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.nodeId).toBe('Activity_158exxp')
    expect(hits[0]?.nodeName).toBe('直属上级审批')
    expect(hits[0]?.candidateStrategy).toBe(23)

    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/发起人本人/)
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/直属上级审批/)
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/自动审核通过/)
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/userId=18243/)
  })

  it('★ 只看 USER_TASK：把发起人塞进 START_EVENT / END_EVENT 不算命中', () => {
    // 这是一条**多分支**用例：三个节点里只有 USER_TASK 那个该被看
    const preview: ApprovalChainPreview = {
      ...REAL_PREVIEW,
      nodes: [
        { nodeId: 'start', type: 'START_EVENT', candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }] },
        { nodeId: 'end', type: 'END_EVENT', candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }] },
      ],
    }
    expect(findSelfInApprovalChain(preview, 18243)).toEqual([])
    expect(() => assertNotSelfApprover(preview, 18243)).not.toThrow()

    // 补上 USER_TASK 那一个之后立刻命中 —— 证明上面"不命中"不是因为整个函数不工作
    const withUserTask: ApprovalChainPreview = {
      ...preview,
      nodes: [...preview.nodes, { nodeId: 'task', type: 'USER_TASK', candidateUsers: [{ id: 18243 }] }],
    }
    expect(findSelfInApprovalChain(withUserTask, 18243)).toHaveLength(1)
  })

  it('★ 多节点多候选人：命中的那一处必须定位准确（不是只看第一个/最后一个）', () => {
    const preview: ApprovalChainPreview = {
      ...REAL_PREVIEW,
      nodes: [
        { nodeId: 'T1', name: '一级审批', type: 'USER_TASK', candidateUsers: [{ id: 11 }, { id: 12 }] },
        { nodeId: 'T2', name: '二级审批', type: 'USER_TASK', candidateUsers: [{ id: 21 }, { id: 18243 }] },
        { nodeId: 'T3', name: '三级审批', type: 'USER_TASK', candidateUsers: [{ id: 31 }] },
      ],
    }
    const hits = findSelfInApprovalChain(preview, 18243)
    expect(hits).toHaveLength(1)
    // 命中的是 T2 的**第二个**候选人 —— 写死到这一层，[0]/[last] 的取值是不同的
    expect(hits[0]?.nodeId).toBe('T2')
    expect(hits[0]?.nodeName).toBe('二级审批')
    expect(hits[0]?.user.id).toBe(18243)
  })

  it('多处命中时全部返回（不是找到第一个就 break）', () => {
    const preview: ApprovalChainPreview = {
      ...REAL_PREVIEW,
      nodes: [
        { nodeId: 'T1', name: '一级审批', type: 'USER_TASK', candidateUsers: [{ id: 18243 }] },
        { nodeId: 'T2', name: '二级审批', type: 'USER_TASK', candidateUsers: [{ id: 7 }, { id: 18243 }] },
        { nodeId: 'T3', name: '三级审批', type: 'USER_TASK', candidateUsers: [{ id: 18243 }] },
      ],
    }
    const hits = findSelfInApprovalChain(preview, 18243)
    expect(hits.map((h) => h.nodeId)).toEqual(['T1', 'T2', 'T3'])
    expect(() => assertNotSelfApprover(preview, 18243)).toThrow(/T1|一级审批/)
  })

  it('id 的类型不影响判定：字符串 "18243" 与数字 18243 都算命中', () => {
    const preview: ApprovalChainPreview = {
      ...REAL_PREVIEW,
      nodes: [{ nodeId: 'T', type: 'USER_TASK', candidateUsers: [{ id: '18243' as unknown as number }] }],
    }
    expect(findSelfInApprovalChain(preview, 18243)).toHaveLength(1)
    expect(findSelfInApprovalChain(preview, Number('18243'))).toHaveLength(1)
    expect(findSelfInApprovalChain(preview, 999)).toHaveLength(0)
  })

  it('空审批链 / 没有 nodes / null 都不抛（不能因为预览为空就拦住一切）', () => {
    for (const empty of [
      null,
      undefined,
      { nodes: [] } as unknown as ApprovalChainPreview,
      { nodes: undefined } as unknown as ApprovalChainPreview,
    ]) {
      expect(findSelfInApprovalChain(empty, 18243)).toEqual([])
      expect(() => assertNotSelfApprover(empty, 18243)).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// 六、提交：守卫必须在 create **之前**
// ---------------------------------------------------------------------------

describe('submit：写操作 —— 守卫在 create 之前，本地校验在一切之前', () => {
  it('★ 审批链命中发起人本人时，**一个 create 请求都不发**', async () => {
    const selfPreview: ApprovalChainPreview = {
      ...REAL_PREVIEW,
      nodes: REAL_PREVIEW.nodes.map((node) =>
        node.type === 'USER_TASK' ? { ...node, candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }] } : node,
      ),
    }
    const { calls, capability } = makeCapability({ preview: selfPreview })

    await expect(capability.submit(draft)).rejects.toThrow(/发起人本人/)
    const urls = urlsOf(calls)
    expect(urls.some((u) => u.includes('/hr/overtime-application/create'))).toBe(false)
    // 但读请求确实发出去了：先起了 getRequiredStartUserSelectTasks，再起了 preview
    expect(urls.some((u) => u.includes('getRequiredStartUserSelectTasks'))).toBe(true)
    expect(urls.some((u) => u.includes('/bpm/process-instance/preview'))).toBe(true)
  })

  it('★ 守卫的判据是**审批链**，不是"调用方说自己没选自己"——调用方什么也没传也照样拦', async () => {
    const selfPreview: ApprovalChainPreview = {
      ...REAL_PREVIEW,
      nodes: [{ nodeId: 'T', name: '直属上级审批', type: 'USER_TASK', candidateUsers: [{ id: 18243 }] }],
    }
    const { calls, capability } = makeCapability({ preview: selfPreview })
    // 本流程没有自选节点，调用方**根本没有地方**可以声明"审批人是谁"
    await expect(capability.submit(draft, { startUserSelectAssignees: {} })).rejects.toThrow(/发起人本人/)
    expect(urlsOf(calls).some((u) => u.includes('/create'))).toBe(false)
  })

  it('正常路径：getRequired → preview → create 三条，create 在最后且 body 是 载荷 + {}', async () => {
    const { calls, capability } = makeCapability()
    const result = await capability.submit(draft)

    expect(result).toBe(777)
    expect(urlsOf(calls)).toEqual([
      '/admin-api/sys/user/info?_t=<ts>',
      '/admin-api/hr/overtime-application/getRequiredStartUserSelectTasks',
      '/admin-api/bpm/process-instance/preview',
      '/admin-api/hr/overtime-application/create',
    ])
    // 守卫那次 preview 的 variables 必须是**这次的载荷**（不是空的）——
    // 不然"审批链预览"就变成对着一个空表单算，守卫的意义也就没了
    expect(JSON.parse(rawBodyOf(calls[2]))).toEqual({
      processDefinitionKey: OVERTIME_APPLICATION_PROCESS_KEY,
      variables: JSON.parse(rawBodyOf(calls[1])),
      startUserSelectAssignees: {},
      copyUserIds: [],
    })

    const createBody = JSON.parse(rawBodyOf(calls[3])) as Record<string, unknown>
    expect(createBody.startUserSelectAssignees).toEqual({})
    expect(Object.keys(createBody)).toEqual([
      'applicantId',
      'applicantName',
      'applyDate',
      'applyDepartmentId',
      'applyDepartmentName',
      'reason',
      'overtimeType',
      'subsidyType',
      'startTime',
      'endTime',
      'breakHours',
      'overtimeHours',
      'startUserSelectAssignees',
    ])
    expect(createBody.overtimeHours).toBe(2.5)
    expect(createBody.applicantId).toBe('18243')
  })

  it('prepare 收到的 body 就是完整载荷（后端 @Valid 要它，与通用审批不同）', async () => {
    const { calls, capability } = makeCapability()
    await capability.prepare(draft)
    expect(urlsOf(calls)).toEqual([
      '/admin-api/sys/user/info?_t=<ts>',
      '/admin-api/hr/overtime-application/getRequiredStartUserSelectTasks',
    ])
    const body = JSON.parse(rawBodyOf(calls[1])) as Record<string, unknown>
    expect(body.endTime).toBe('2026-09-22 21:00:00')
    expect(body.startTime).toBe('2026-09-22 18:00:00')
    expect(body).not.toHaveProperty('startUserSelectAssignees')
  })

  it('/sys/user/info 每次提交只打一次（守卫不再重复问一遍"我是谁"）', async () => {
    const { calls, capability } = makeCapability()
    await capability.submit(draft)
    const userInfoCalls = urlsOf(calls).filter((u) => u.includes('/sys/user/info'))
    expect(userInfoCalls).toHaveLength(1)
  })

  it('skipSelfApprovalGuard: true 才跳过预览；默认**不跳过**', async () => {
    const guarded = makeCapability()
    await guarded.capability.submit(draft)
    expect(urlsOf(guarded.calls).some((u) => u.includes('/preview'))).toBe(true)

    const skipped = makeCapability()
    await skipped.capability.submit(draft, { skipSelfApprovalGuard: true })
    expect(urlsOf(skipped.calls).some((u) => u.includes('/preview'))).toBe(false)
    expect(urlsOf(skipped.calls)).toEqual([
      '/admin-api/sys/user/info?_t=<ts>',
      '/admin-api/hr/overtime-application/getRequiredStartUserSelectTasks',
      '/admin-api/hr/overtime-application/create',
    ])
  })

  it('本地校验不过时**一个请求都不发**（写请求当然更没有）', async () => {
    const { calls, capability } = makeCapability()
    await expect(capability.submit({ ...draft, reason: '' })).rejects.toThrow(/加班事由/)
    await expect(capability.submit({ ...draft, endTime: draft.startTime })).rejects.toThrow(/必须晚于/)
    await expect(capability.submit({ ...draft, overtimeType: 9 })).rejects.toThrow(/加班类型/)
    await expect(capability.submit({ ...draft, breakHours: 3 })).rejects.toThrow(/算出来是 0/)
    expect(calls).toHaveLength(0)
  })

  it('prepare 返回的 tasks 是 []（本流程实测没有自选节点）', async () => {
    const { capability } = makeCapability({ tasks: null })
    const result = await capability.prepare(draft)
    expect(result.tasks).toEqual([])
    expect(result.derived.overtimeHours).toBe(2.5)
  })

  it('★ 流程被改出「自选节点」时：没给 assignees 直接拒绝，一个写请求都不发', async () => {
    const { calls, capability } = makeCapability({
      tasks: [{ id: 'Activity_9', name: '发起人自选' }],
    })
    await expect(capability.submit(draft)).rejects.toThrow(/发起人自选审批人不能为空/)
    expect(urlsOf(calls).some((u) => u.includes('/create'))).toBe(false)
  })

  it('★ 反过来：流程没有节点、调用方却塞了一个节点 id ⇒ 也拒绝（不静默丢掉）', async () => {
    const { calls, capability } = makeCapability({ tasks: [] })
    await expect(
      capability.submit(draft, { startUserSelectAssignees: { Activity_9: [1] } }),
    ).rejects.toThrow(/不是本次的审批人节点/)
    expect(urlsOf(calls).some((u) => u.includes('/create'))).toBe(false)
  })

  it('assertTasksCovered：节点全覆盖放行；缺一个 / 多一个都红', () => {
    const tasks = [{ id: 'A', name: '一级' }, { id: 'B', name: '二级' }]
    expect(() => assertTasksCovered(tasks, { A: [1], B: [2] })).not.toThrow()
    expect(() => assertTasksCovered(tasks, { A: [1] })).toThrow(/二级/)
    expect(() => assertTasksCovered(tasks, { A: [1], B: [], C: [3] })).toThrow(/二级/)
    expect(() => assertTasksCovered(tasks, { A: [1], B: [2], C: [3] })).toThrow(/"C"/)
    expect(() => assertTasksCovered([], {})).not.toThrow()
    // 没有节点时给任何东西都是多的
    expect(() => assertTasksCovered([], { A: [1] })).toThrow(/不是本次的审批人节点/)
  })
})

// ---------------------------------------------------------------------------
// 七、详情 / 我的流程 / 找实例
// ---------------------------------------------------------------------------

describe('detail 与「我的流程」', () => {
  it('detail 打 /hr/overtime-application/get?id=，且接受数字与字符串', async () => {
    const { calls, capability } = makeCapability()
    await capability.detail(51)
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/hr/overtime-application/get?id=51&_t=<ts>')
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
    await capability.detail('51')
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/hr/overtime-application/get?id=51&_t=<ts>')
    expect(() => capability.detail('')).toThrow(/不能为空/)
  })

  it('myInstances 的参数与页面一致（五个空值也发）', async () => {
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
    expect(normalize(String(calls[0]?.url))).toContain('/admin-api/bpm/process-instance/my-page')
  })

  it('status / processType 只在给了的时候才发', async () => {
    const { calls, capability } = makeCapability()
    await capability.myInstances({ status: 1, processType: 2 })
    const withFilters = Object.fromEntries(queryOf(calls[0]))
    expect(withFilters.status).toBe('1')
    expect(withFilters.processType).toBe('2')

    await capability.myInstances()
    const without = Object.fromEntries(queryOf(calls[1]))
    expect(without).not.toHaveProperty('status')
    expect(without).not.toHaveProperty('processType')
  })

  it('findInstanceByBusinessKey 用 businessKey 对上流程实例', async () => {
    const rows: ProcessInstanceRow[] = [
      { id: 'inst-1', businessKey: '50', processDefinitionKey: 'hr_overtime_application' },
      { id: 'inst-2', businessKey: '51', processDefinitionKey: 'hr_overtime_application' },
    ]
    const { calls, capability } = makeCapability({ myPage: { list: rows, total: 2 } })
    expect((await capability.findInstanceByBusinessKey(51)).id).toBe('inst-2')
    expect((await capability.findInstanceByBusinessKey('51')).id).toBe('inst-2')
    expect(calls).toHaveLength(2)
  })

  it('★ businessKey 撞车时按 processDefinitionKey 认（同名主键的另一条流程不能被认成自己）', async () => {
    const rows: ProcessInstanceRow[] = [
      { id: 'meeting-51', businessKey: '51', processDefinitionKey: 'meeting_application' },
      { id: 'ot-999', businessKey: '999', processDefinitionKey: 'hr_overtime_application' },
    ]
    const { capability } = makeCapability({ myPage: { list: rows, total: 2 } })
    await expect(capability.findInstanceByBusinessKey(51)).rejects.toThrow(/也没找到/)
    expect((await capability.findInstanceByBusinessKey(999)).id).toBe('ot-999')
  })

  it('翻页上限用尽后抛错，而不是返回 undefined 让下一步去 cancel 一个空 id', async () => {
    let page = 0
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      page += 1
      return {
        data: {
          ret: 'SUCCESS',
          code: 0,
          msg: '',
          data: { list: [{ id: `x-${page}`, businessKey: '1' }], total: 999 },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const cap = createOvertimeApplicationCapability(
      (requestConfig) => sdk.call(OVERTIME_APPLICATION_FORM_PATH, requestConfig),
      { maxScanPages: 2, scanPageSize: 1 },
    )
    await expect(cap.findInstanceByBusinessKey(42)).rejects.toThrow(/翻到第 2 页也没找到/)
    expect(page).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 八、取消
// ---------------------------------------------------------------------------

describe('cancel：DELETE /bpm/process-instance/cancel-by-start-user', () => {
  it('给了流程实例 id 时直接取消，body 是 {id, reason}', async () => {
    const { calls, capability } = makeCapability()
    await capability.cancel({ processInstanceId: 'inst-51', reason: 'SDK-TEST 撤销' })

    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/bpm/process-instance/cancel-by-start-user')
    expect(String(calls[0]?.method).toUpperCase()).toBe('DELETE')
    expect(rawBodyOf(calls[0])).toBe('{"id":"inst-51","reason":"SDK-TEST 撤销"}')
  })

  it('只给 businessKey 时先去「我的流程」换 id，再取消（两步）', async () => {
    const { calls, capability } = makeCapability({
      myPage: {
        list: [{ id: 'inst-77', businessKey: '77', processDefinitionKey: 'hr_overtime_application' }],
        total: 1,
      },
    })
    await capability.cancel({ businessKey: 77, reason: 'SDK-TEST 撤销' })

    expect(calls).toHaveLength(2)
    expect(String(calls[0]?.url)).toContain('/bpm/process-instance/my-page')
    expect(rawBodyOf(calls[1])).toBe('{"id":"inst-77","reason":"SDK-TEST 撤销"}')
  })

  it('reason 为空 / 全空白 / 非字符串都拒绝，且一个请求都不发', async () => {
    const { calls, capability } = makeCapability()
    await expect(capability.cancel({ processInstanceId: 'i', reason: '' })).rejects.toThrow(/reason 必填/)
    await expect(capability.cancel({ processInstanceId: 'i', reason: '   ' })).rejects.toThrow(/reason 必填/)
    await expect(
      capability.cancel({ processInstanceId: 'i', reason: undefined as unknown as string }),
    ).rejects.toThrow(/reason 必填/)
    expect(calls).toHaveLength(0)
  })

  it('两个 id 都不给时拒绝，且不发请求', async () => {
    const { calls, capability } = makeCapability()
    await expect(capability.cancel({ reason: '撤销' })).rejects.toThrow(/processInstanceId 或 businessKey/)
    expect(calls).toHaveLength(0)
  })

  it('后端说「流程不处于运行中」时如实抛出去，不吞错、也不假装撤成功', async () => {
    const calls: InternalAxiosRequestConfig[] = []
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      calls.push(config)
      return {
        data: { ret: 'FAIL', code: 500, msg: '流程取消失败，流程不处于运行中', data: null },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const cap = createOvertimeApplicationCapability((requestConfig) =>
      sdk.call(OVERTIME_APPLICATION_FORM_PATH, requestConfig),
    )
    await expect(cap.cancel({ processInstanceId: 'inst-1', reason: '撤销' })).rejects.toThrow(
      /流程不处于运行中/,
    )
    expect(calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 九、能力定义本身
// ---------------------------------------------------------------------------

describe('能力定义', () => {
  it('八条能力，id 不重复，写能力恰好两条（submit / cancel）', () => {
    const ids = overtimeApplicationCapabilities.map((c) => c.id)
    expect(ids).toEqual([
      'overtime-application-definition',
      'overtime-application-current-user',
      'overtime-application-approval-chain',
      'overtime-application-prepare',
      'overtime-application-submit',
      'overtime-application-detail',
      'overtime-application-my-instances',
      'overtime-application-cancel',
    ])
    expect(new Set(ids).size).toBe(ids.length)
    expect(overtimeApplicationCapabilities.filter((c) => c.write).map((c) => c.id)).toEqual([
      'overtime-application-submit',
      'overtime-application-cancel',
    ])
  })

  it('★ 同一条能力里参数名不重复（redocly 的 operation-parameters-unique 会拦）', () => {
    for (const capability of overtimeApplicationCapabilities) {
      const names = capability.params.map((p) => p.name)
      expect(new Set(names).size, `${capability.id}: ${names.join(',')}`).toBe(names.length)
    }
  })

  it('pagePath 只落在流程页面与「我的流程」上 —— **绝不能用「发起流程」那条路径**', () => {
    const paths = new Set(overtimeApplicationCapabilities.map((c) => c.pagePath))
    expect(paths).toEqual(
      new Set([
        OVERTIME_APPLICATION_PAGE_PATH,
        OVERTIME_APPLICATION_FORM_PATH,
        OVERTIME_APPLICATION_MY_LIST_PATH,
      ]),
    )
    for (const capability of overtimeApplicationCapabilities) {
      expect(capability.pagePath).not.toBe('/dashboard/flow/task/create/list')
    }
  })

  it('两个时间参数是 date 类，两个下拉的候选与 define.js 逐值一致', () => {
    const submit = overtimeApplicationCapabilities.find((c) => c.id === 'overtime-application-submit')
    expect(submit?.params.find((p) => p.name === 'startTime')?.kind).toBe('date')
    expect(submit?.params.find((p) => p.name === 'endTime')?.kind).toBe('date')
    expect(submit?.params.find((p) => p.name === 'overtimeType')?.options).toEqual([
      { label: '工作日加班', value: 0 },
      { label: '法定节假日加班', value: 1 },
      { label: '休息日加班', value: 2 },
    ])
    expect(submit?.params.find((p) => p.name === 'subsidyType')?.options).toEqual([
      { label: '转调休', value: 0 },
      { label: '转补贴', value: 1 },
      { label: '后期自行统计', value: 2 },
    ])
    // 本表单没有人员控件 ⇒ 参数里**不该**出现任何 search 类（那是抄隔壁流程抄多了的症状）
    for (const capability of overtimeApplicationCapabilities) {
      expect(capability.params.filter((p) => p.kind === 'search')).toEqual([])
    }
  })

  it('流程类型常量是实测的 2（审批）', () => {
    expect(OVERTIME_APPLICATION_PROCESS_TYPE).toBe(2)
    const myInstances = overtimeApplicationCapabilities.find(
      (c) => c.id === 'overtime-application-my-instances',
    )
    expect(myInstances?.params.find((p) => p.name === 'processType')?.description).toContain('2（审批）')
  })

  it('prepare 的 6 个参数全是必填，approval-chain 的同名参数全是选填（预览允许空表单）', () => {
    const prepare = overtimeApplicationCapabilities.find((c) => c.id === 'overtime-application-prepare')
    const chain = overtimeApplicationCapabilities.find(
      (c) => c.id === 'overtime-application-approval-chain',
    )
    expect(prepare?.params).toHaveLength(6)
    expect(prepare?.params.every((p) => p.required)).toBe(true)
    expect(chain?.params).toHaveLength(6)
    expect(chain?.params.every((p) => p.required)).toBe(false)
    expect(chain?.params.map((p) => p.name)).toEqual(prepare?.params.map((p) => p.name))
  })

  it('submit 的 startUserSelectAssignees 是选填且 kind 不是 search（本流程没有人员候选入口）', () => {
    const submit = overtimeApplicationCapabilities.find((c) => c.id === 'overtime-application-submit')
    const param = submit?.params.find((p) => p.name === 'startUserSelectAssignees')
    expect(param?.required).toBe(false)
    expect(param?.kind).not.toBe('search')
    expect(param?.lookup).toBeUndefined()
  })
})
