import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  ANNUAL_LEAVE_TYPE,
  ATTACHMENT_ACCEPT_EXTENSIONS,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_REQUIRED_TYPES,
  LEAVE_APPLICATION_FORM_PATH,
  LEAVE_APPLICATION_MY_LIST_PATH,
  LEAVE_APPLICATION_PAGE_PATH,
  LEAVE_APPLICATION_PROCESS_KEY,
  LEAVE_APPLICATION_PROCESS_TYPE,
  LEAVE_PERIOD_OPTIONS,
  LEAVE_TYPE_OPTIONS,
  MARRIAGE_LEAVE_TYPE,
  PERIOD_AM,
  PERIOD_PM,
  REASON_MAX,
  assertAnnualLeaveEnough,
  assertAssigneesForTasks,
  assertAttachmentRequired,
  assertAttachments,
  assertPeriodOrder,
  buildLeavePayload,
  calculateLeaveDays,
  createLeaveApplicationCapability,
  isAttachmentRequired,
  isPeriodComplete,
  leaveApplicationCapabilities,
  startIsAfterEnd,
  type LeaveDraft,
  type LeaveProfile,
} from '../src/capabilities/leave-application.js'

/**
 * 请假申请（`qingjia` / `/simple/hr/form/005`）—— 流程表单第三条线。
 *
 * 三条来源，逐条钉住：
 *   1. `baseline/leave-application.browser.json`：真实浏览器抓的请求（只读那几条）
 *   2. Portal 前端源码 `app/portal/views/simple/hr/form/005/**`
 *      （`index.vue` 的模板与 formRules、`utils.js` 的 startIsAfterEnd / calculateDays、
 *      `components/picker-group.vue` 的复合日期控件）
 *   3. 后端源码 `AttendanceUserRelController` / `AttendanceUserRelServiceImpl` /
 *      `AttendanceUserRelProcessInstanceVariableBuilder` 与 `qingjia` 的 BPMN
 *
 * 写链路（submit / detail / cancel）的真实往返记录在 `docs/pages/请假申请.md` 的
 * 「真实验证记录」一节；这里只管契约与逐字段一致。
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
  // ⚠️ 这两个键里有全角括号，**必须带引号**（不带的话 oxc 会在解析期报
  // `Invalid Character （`，一个看起来像"编码问题"其实是语法问题的错）
  '提交载荷（从上面那条 preview 的 variables 里原样摘出来，键顺序即序列化顺序）': Record<string, unknown>
  '发起人信息的来源（同一次页面加载，未抓到请求：/sys/user/info 在应用外壳初始化时就发了、缓存住了）': {
    // 写死键名而不是 Record<string, string>：`noUncheckedIndexedAccess` 下
    // 用 Record 索引出来的是 `string | undefined`，赋给 LeaveProfile 会报错
    '响应（只摘相关的几项）': {
      id: string
      username: string
      realName: string
      organizationName: string
      organizationFullPathName: string
    }
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/leave-application.browser.json'), 'utf8'),
)

const baselinePayload = baseline['提交载荷（从上面那条 preview 的 variables 里原样摘出来，键顺序即序列化顺序）']
const baselineUserInfo = baseline['发起人信息的来源（同一次页面加载，未抓到请求：/sys/user/info 在应用外壳初始化时就发了、缓存住了）']['响应（只摘相关的几项）']

/** 去掉主机与一次性时间戳，只留 path + query */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

const baselineUrls = new Set(baseline.请求.map((r) => normalize(r.u)))

/** 基准里那条 preview POST 的 body（buildSubmitPayload 的真实产物） */
const baselinePreviewBody = baseline.请求.find((r) => r.u.endsWith('/bpm/process-instance/preview'))?.body as string
/** 基准里那条 getRestDuration 的 body */
const baselineDurationBody = baseline.请求.find((r) => r.u.endsWith('/getRestDuration'))?.body as string

/**
 * 与基准同一份表单填写值，**但 `type` 换成 6（探亲假）**。
 *
 * ⚠️ 为什么不能直接用基准里的 `type: 3`（事假）：事假属于
 * `ATTACHMENT_REQUIRED_TYPES`，页面的 `formRules.attachments` 对它要求必填。
 * 基准里那份是**点「查看审批流程」时**的产物，而预览**不做表单校验**
 * （`resolvePreviewVariables` 直接读 formState）——所以浏览器确实序列化出了
 * 「事假 + 无附件」这么一份载荷，但**它自己的提交按钮也会把它拦下来**。
 * SDK 的 `buildLeavePayload()` 复刻的是提交路径的规则，所以会拒绝它。
 * 下面单独有一条测试钉住这个差别。
 */
const draft: LeaveDraft = {
  type: 6,
  reason: 'SDK-TEST-baseline 请假事由（浏览器基准抓取，不会提交）',
  startDate: '2026-09-21',
  startType: PERIOD_AM,
  endDate: '2026-09-21',
  endType: PERIOD_PM,
  attachments: [],
}

/** 基准里那四个日期字段 */
const baselinePeriod = {
  startDate: '2026-09-21',
  startType: 1,
  endDate: '2026-09-21',
  endType: 2,
}

/**
 * `/sys/user/info` 的响应（**只摘相关的几项**，另加两个不该被投影出去的敏感字段）。
 *
 * `password2` / `salt` 是**真实响应里真有的**（bcrypt 口令散列与盐，实测）。
 * 放进来是为了让下面那条「profile 不整份透传」的断言**有东西可拦**。
 */
const USER_INFO = {
  id: '18243',
  username: '2021070101',
  realName: '姚淼鑫',
  organizationName: '设计中心1236',
  organizationFullPathName: '沃德辰龙-沃德博创-沃德博创-系统研发-设计中心1236',
  password2: '$2a$10$X3s2CIV.fqSlm2mQTqxnler4EqFDbsOcOV/0vwmK7RqTAXrLiY0VO',
  salt: '$2a$10$X3s2CIV.fqSlm2mQTqxnle',
  mobile: '15011141909',
}

/** 后端 getRestDuration 对上面那四个字段的答复（实测 1 天） */
const REST_DAY = 1

/**
 * 一个**按路径分派响应**的假后端。
 *
 * 为什么不是通用审批那条线那种"一律返回同一个 data"：请假的写链路是
 * **duration → getRequiredStartUserSelectTasks → create** 三步，
 * 每一步吃不同的响应，必须分开喂。
 */
function captureSdk (
  responder: (path: string, config: InternalAxiosRequestConfig) => unknown = () => ({}),
  options?: { maxScanPages?: number; scanPageSize?: number },
) {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    const path = String(config.url ?? '').split('?')[0]!.replace(/^.*\/admin-api/, '')
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: responder(path, config) },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  // 组装点（src/index.ts）将来也是这样接的：能力收一个"已带页面上下文"的请求函数
  const capability = createLeaveApplicationCapability(
    (requestConfig) => sdk.call(LEAVE_APPLICATION_FORM_PATH, requestConfig),
    options,
  )
  return { sdk, calls, capability }
}

/** 请假流程真正的默认假后端 */
function fakeBackend (overrides: Record<string, unknown> = {}) {
  return (path: string): unknown => {
    if (path in overrides) return overrides[path]
    switch (path) {
      case '/sys/user/info':
        return USER_INFO
      case '/hr/attendance-user-rel/getRestDuration':
        return REST_DAY
      case '/hr/attendance-user-rel/getRequiredStartUserSelectTasks':
        return []
      case '/hr/attendance-user-rel/create':
        return 66
      case '/hr/attendance-user-rel/getYearRest':
        return { rest: 5, unRest: 5 }
      case '/hr/attendance-user-rel/get':
        return { id: null, userId: '18243', typeName: '探亲假' }
      case '/bpm/process-instance/my-page':
        return { list: [], total: 0 }
      default:
        return {}
    }
  }
}

/** axios 在到达 adapter 前已按 transformRequest 把对象序列化成字符串 */
function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

function pathOf (config: InternalAxiosRequestConfig | undefined): string {
  return normalize(String(config?.url ?? '')).split('?')[0]!
}

/** 取这次请求的查询参数（**顺序即 qs 序列化后的顺序**） */
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

function queryMapOf (config: InternalAxiosRequestConfig | undefined): Record<string, string> {
  return Object.fromEntries(queryOf(config))
}

/** 一次写链路的调用序列（按路径） */
function pathsOf (calls: InternalAxiosRequestConfig[]): string[] {
  return calls.map((c) => pathOf(c))
}

// ---------------------------------------------------------------------------
// 一、与浏览器基准一致
// ---------------------------------------------------------------------------

describe('请假申请 —— 读链路与浏览器基准一致', () => {
  it('写死的表单填写值与基准里记的一致（两边不会各自漂移）', () => {
    expect(draft.reason).toBe(baseline.表单填写值.reason)
    expect(draft.startDate).toBe(baseline.表单填写值.startDate)
    expect(draft.startType).toBe(baseline.表单填写值.startType)
    expect(draft.endDate).toBe(baseline.表单填写值.endDate)
    expect(draft.endType).toBe(baseline.表单填写值.endType)
    // 唯一刻意不同的一处，理由见 draft 的注释：基准那份是「预览」的产物，
    // 而预览不做表单校验，所以它能带着 type=3（事假）+ 空附件跑出来。
    expect(baseline.表单填写值.type).toBe(3)
    expect(draft.type).toBe(6)
  })

  it('流程定义请求与基准一致（key 是 qingjia）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.definition()

    const actual = normalize(String(calls[0]?.url))
    expect(actual).toBe('/admin-api/bpm/process-definition/get?key=qingjia&_t=<ts>')
    expect(baselineUrls.has(actual)).toBe(true)
  })

  it('getRestDuration 的请求体与基准**逐字节**相同（含键顺序）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.duration(baselinePeriod)

    expect(pathOf(calls[0])).toBe('/admin-api/hr/attendance-user-rel/getRestDuration')
    expect(rawBodyOf(calls[0])).toBe(baselineDurationBody)
  })

  it('提交载荷与基准里的 `variables` 逐字段一致（键顺序也算）', () => {
    const who: LeaveProfile = {
      id: baselineUserInfo.id,
      userName: baselineUserInfo.realName,
      staffCode: baselineUserInfo.username,
      fullPath: baselineUserInfo.organizationName,
    }
    const payload = buildLeavePayload(draft, who, REST_DAY)

    // 键顺序：基准的 variables 是 { ...formState, restDay, creatorOrgFullPath }，
    // 后两个里只有 restDay 属于提交载荷，creatorOrgFullPath 是预览独有的。
    const baselineKeys = Object.keys(baselinePayload).filter((k) => k !== 'creatorOrgFullPath')
    expect(Object.keys(payload)).toEqual(baselineKeys)
    expect(Object.keys(payload)).toEqual([
      'userId', 'userName', 'staffCode', 'fullPath',
      'type', 'startDate', 'startType', 'endDate', 'endType',
      'reason', 'attachments', 'restDay',
    ])

    // 逐字段取值：除 type（见上一条的理由）外全部相同
    expect(payload.userId).toBe(baselinePayload.userId)
    expect(payload.userName).toBe(baselinePayload.userName)
    expect(payload.staffCode).toBe(baselinePayload.staffCode)
    expect(payload.fullPath).toBe(baselinePayload.fullPath)
    expect(payload.startDate).toBe(baselinePayload.startDate)
    expect(payload.startType).toBe(baselinePayload.startType)
    expect(payload.endDate).toBe(baselinePayload.endDate)
    expect(payload.endType).toBe(baselinePayload.endType)
    expect(payload.reason).toBe(baselinePayload.reason)
    expect(payload.attachments).toEqual(baselinePayload.attachments)
    expect(payload.restDay).toBe(baselinePayload.restDay)
  })

  it('★ `userId` 是**字符串**、`fullPath` 是 organizationName —— 这两个最容易"顺手改对"', () => {
    const who: LeaveProfile = {
      id: baselineUserInfo.id,
      userName: baselineUserInfo.realName,
      staffCode: baselineUserInfo.username,
      fullPath: baselineUserInfo.organizationName,
    }
    const payload = buildLeavePayload(draft, who, REST_DAY)

    // /sys/user/info 把 id 序列化成字符串，页面的 userStore.state.id 拿到什么就发什么
    expect(typeof payload.userId).toBe('string')
    expect(baselinePreviewBody).toContain('"userId":"18243"')

    // fullPath 取 organizationName（"设计中心1236"），**不是** organizationFullPathName。
    // 后者只出现在预览的 creatorOrgFullPath 里。
    expect(payload.fullPath).toBe('设计中心1236')
    expect(payload.fullPath).not.toBe(baselineUserInfo.organizationFullPathName)
    expect(String(baselineUserInfo.organizationFullPathName)).toContain(String(payload.fullPath))
  })

  it('基准那条 preview 的 body 里确实没有 module-type 头（qingjia 页面一条规则都匹配不到）', () => {
    const headers = baseline.请求.find((r) => r.u.endsWith('/bpm/process-instance/preview'))?.headers ?? {}
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('module-type')
  })

  it('基准里那条「长选项」拉取是 9 页 × 500 条 —— SDK 不暴露任何人员搜索参数，照抄不到', () => {
    const longOption = baseline.请求.find((r) => r.u.includes('/system/user/simple-page'))!
    expect(longOption.次数).toBe(9)
    expect(longOption.u).toContain('pageNo=1&pageSize=500')
    expect(longOption.u).not.toContain('nickname')

    // 本能力的参数表里**一个 search kind 都没有**（那是长选项的标记）
    const searchParams = leaveApplicationCapabilities.flatMap((c) => c.params).filter((p) => p.kind === 'search')
    expect(searchParams.map((p) => `${p.name}`)).toEqual(['startUserSelectAssignees'])
  })
})

// ---------------------------------------------------------------------------
// 二、页面上每个控件都在契约里
// ---------------------------------------------------------------------------

describe('请假申请 —— 页面控件与参数契约一一对应', () => {
  const prepare = leaveApplicationCapabilities.find((c) => c.id === 'leave-application-prepare')!
  const submit = leaveApplicationCapabilities.find((c) => c.id === 'leave-application-submit')!
  const paramNames = (id: string) =>
    leaveApplicationCapabilities.find((c) => c.id === id)!.params.map((p) => p.name)

  it('十个能力都在，pagePath / write 都对', () => {
    expect(leaveApplicationCapabilities.map((c) => c.id)).toEqual([
      'leave-application-definition',
      'leave-application-profile',
      'leave-application-types',
      'leave-application-year-rest',
      'leave-application-duration',
      'leave-application-prepare',
      'leave-application-submit',
      'leave-application-detail',
      'leave-application-my-instances',
      'leave-application-cancel',
    ])
    const write = leaveApplicationCapabilities.filter((c) => c.write).map((c) => c.id)
    expect(write).toEqual(['leave-application-submit', 'leave-application-cancel'])

    const byId = Object.fromEntries(leaveApplicationCapabilities.map((c) => [c.id, c.pagePath]))
    expect(byId['leave-application-definition']).toBe(LEAVE_APPLICATION_PAGE_PATH)
    expect(byId['leave-application-my-instances']).toBe(LEAVE_APPLICATION_MY_LIST_PATH)
    expect(byId['leave-application-cancel']).toBe(LEAVE_APPLICATION_MY_LIST_PATH)
    for (const id of ['leave-application-prepare', 'leave-application-submit', 'leave-application-detail']) {
      expect(byId[id]).toBe(LEAVE_APPLICATION_FORM_PATH)
    }
  })

  it('六个输入控件（type/reason/两对日期）全在 prepare 与 submit 的参数里', () => {
    for (const list of [prepare.params, submit.params]) {
      const names = list.map((p) => p.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'type', 'reason', 'startDate', 'startType', 'endDate', 'endType', 'attachments',
        ]),
      )
    }
  })

  it('submit 比 prepare 只多一个 startUserSelectAssignees，且它在**最后**', () => {
    expect(submit.params.map((p) => p.name)).toEqual([
      ...prepare.params.map((p) => p.name),
      'startUserSelectAssignees',
    ])
  })

  it('请假类型的枚举选项与字典 absent_type 的实测值一致（含页面那个非数字序）', () => {
    expect(LEAVE_TYPE_OPTIONS.map((o) => o.value)).toEqual([1, 10, 11, 12, 13, 14, 2, 3, 4, 5, 6, 7, 8, 9, 15])
    const typeParam = prepare.params.find((p) => p.name === 'type')!
    expect(typeParam.kind).toBe('enum')
    expect(typeParam.required).toBe(true)
    expect(typeParam.options?.map((o) => o.value)).toEqual(LEAVE_TYPE_OPTIONS.map((o) => o.value))
    expect(typeParam.options?.find((o) => o.value === 3)?.label).toBe('事假')
    expect(typeParam.options?.find((o) => o.value === 13)?.label).toBe('年休假')
  })

  it('上午/下午两个选项与页面 leaveTimeTypeList 一致（硬编码，不是字典）', () => {
    expect(LEAVE_PERIOD_OPTIONS).toEqual([{ label: '上午', value: 1 }, { label: '下午', value: 2 }])
    for (const name of ['startType', 'endType']) {
      const param = prepare.params.find((p) => p.name === name)!
      expect(param.kind).toBe('enum')
      expect(param.required).toBe(true)
      expect(param.options?.map((o) => o.value)).toEqual([PERIOD_AM, PERIOD_PM])
    }
  })

  it('附件白名单是请假自己的那张（.pdf .jpg .jpeg .png），比通用审批窄', () => {
    expect([...ATTACHMENT_ACCEPT_EXTENSIONS]).toEqual(['pdf', 'jpg', 'jpeg', 'png'])
    expect(ATTACHMENT_ACCEPT_EXTENSIONS).not.toContain('docx')
    expect(ATTACHMENT_MAX_COUNT).toBe(10)
  })

  it('流程 key 与 processType 常量', () => {
    expect(LEAVE_APPLICATION_PROCESS_KEY).toBe('qingjia')
    // 请假是「审核」（1），通用审批是「审批」（2）—— 两者不同，取消时不要互相抄
    expect(LEAVE_APPLICATION_PROCESS_TYPE).toBe(1)
  })

  it('「我的流程」的 status / processType 枚举与页面一致', () => {
    const list = leaveApplicationCapabilities.find((c) => c.id === 'leave-application-my-instances')!
    expect(list.params.find((p) => p.name === 'status')?.options?.map((o) => o.value)).toEqual([1, 2, 3, 4])
    expect(list.params.find((p) => p.name === 'processType')?.options?.map((o) => o.value)).toEqual([1, 2])
  })

  it('cancel 的 reason 必填（后端 @NotEmpty），两个 id 参数都是可选', () => {
    const cancel = leaveApplicationCapabilities.find((c) => c.id === 'leave-application-cancel')!
    expect(cancel.params.find((p) => p.name === 'reason')?.required).toBe(true)
    expect(cancel.params.find((p) => p.name === 'processInstanceId')?.required).toBe(false)
    expect(cancel.params.find((p) => p.name === 'businessKey')?.required).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 三、复合日期控件：两个字段 + 一处跨字段合法性
// ---------------------------------------------------------------------------

describe('请假申请 —— 复合日期（日期 + 上午/下午）', () => {
  it('同一天「下午 → 上午」不合法（页面 utils.js 的 startIsAfterEnd 第二条）', () => {
    // 页面原文：start.isSame(end) && startType === 2 && endType === 1
    expect(() => assertPeriodOrder('2026-09-21', PERIOD_PM, '2026-09-21', PERIOD_AM)).toThrow(
      /结束时间不能早于开始时间/,
    )
    expect(startIsAfterEnd('2026-09-21', PERIOD_PM, '2026-09-21', PERIOD_AM)).toBe(true)

    // 反过来（上午 → 下午）是合法的
    expect(() => assertPeriodOrder('2026-09-21', PERIOD_AM, '2026-09-21', PERIOD_PM)).not.toThrow()
    expect(startIsAfterEnd('2026-09-21', PERIOD_AM, '2026-09-21', PERIOD_PM)).toBe(false)

    // 同一天同一个半天也合法（页面能提交「上午 → 上午」，是 0.5 天）
    expect(startIsAfterEnd('2026-09-21', PERIOD_AM, '2026-09-21', PERIOD_AM)).toBe(false)
    expect(startIsAfterEnd('2026-09-21', PERIOD_PM, '2026-09-21', PERIOD_PM)).toBe(false)
  })

  it('开始日期晚于结束日期不合法；跨天全都合法', () => {
    expect(startIsAfterEnd('2026-09-22', PERIOD_AM, '2026-09-21', PERIOD_PM)).toBe(true)
    expect(startIsAfterEnd('2026-09-21', PERIOD_AM, '2026-09-22', PERIOD_AM)).toBe(false)
    // 跨天时「下午 → 上午」也合法（local 算出来是整天数）
    expect(startIsAfterEnd('2026-09-21', PERIOD_PM, '2026-09-22', PERIOD_AM)).toBe(false)
  })

  it('日期必须是真实的 YYYY-MM-DD（2026-02-31 这种光过正则不够）', () => {
    expect(() => assertPeriodOrder('2026-2-1', PERIOD_AM, '2026-09-21', PERIOD_PM)).toThrow(/YYYY-MM-DD/)
    expect(() => assertPeriodOrder('2026-02-31', PERIOD_AM, '2026-09-21', PERIOD_PM)).toThrow(/不是一个真实存在的日期/)
  })

  it('上午/下午只能是 1 或 2', () => {
    expect(() => assertPeriodOrder('2026-09-21', 3 as number, '2026-09-21', PERIOD_PM)).toThrow(/1（上午）或 2（下午）/)
    expect(() => assertPeriodOrder('2026-09-21', PERIOD_AM, '2026-09-21', 0 as number)).toThrow(/1（上午）或 2（下午）/)
  })

  it('calculateDays 与页面 utils.js 的四条分支逐条一致（**不进载荷**，只是本地天数）', () => {
    // 同一天
    expect(calculateLeaveDays('2026-09-21', PERIOD_AM, '2026-09-21', PERIOD_AM)).toBe(0.5)
    expect(calculateLeaveDays('2026-09-21', PERIOD_AM, '2026-09-21', PERIOD_PM)).toBe(1)
    // 跨天：1-1 / 2-2 → daysDiff + 0.5；1-2 → +1；2-1 → daysDiff
    expect(calculateLeaveDays('2026-09-21', PERIOD_AM, '2026-09-22', PERIOD_AM)).toBe(1.5)
    expect(calculateLeaveDays('2026-09-21', PERIOD_PM, '2026-09-22', PERIOD_PM)).toBe(1.5)
    expect(calculateLeaveDays('2026-09-21', PERIOD_AM, '2026-09-22', PERIOD_PM)).toBe(2)
    expect(calculateLeaveDays('2026-09-21', PERIOD_PM, '2026-09-22', PERIOD_AM)).toBe(1)
    // 开始晚于结束 → 0（页面 console.error 后 return 0）
    expect(calculateLeaveDays('2026-09-22', PERIOD_AM, '2026-09-21', PERIOD_PM)).toBe(0)
  })

  it('★ 本地算的天数与接口给的不是一回事：9/21 上午 → 9/25 下午 本地 5、接口 4', () => {
    // 差的 1 天是法定节假日（2026-09-25 中秋节），后端 calculateLeaveDays 会跳过它。
    // 载荷里的 restDay 用的是**接口那个**（buildSubmitPayload 的 actualLeaveDuration）。
    expect(calculateLeaveDays('2026-09-21', PERIOD_AM, '2026-09-25', PERIOD_PM)).toBe(5)
    expect(REST_DAY).toBe(1) // 而基准里那次的接口值是 1（同一天上午→下午）
  })

  it('婚假（7）是页面唯一一个用**本地**天数显示的类型 —— 但载荷里的 restDay 仍是接口值', () => {
    // 页面 getActualLeaveDuration()：type === 7 时返回 leaveDuration（本地），否则返回接口值。
    // 而 buildSubmitPayload() 里写的是 actualLeaveDuration.value —— **接口那个**，婚假也不例外。
    expect(MARRIAGE_LEAVE_TYPE).toBe(7)
    expect((ATTACHMENT_REQUIRED_TYPES as readonly number[]).includes(MARRIAGE_LEAVE_TYPE)).toBe(true)
  })

  it('isPeriodComplete 复刻页面的 isShowLeaveDurationComputed（四个都填了才发请求）', () => {
    expect(isPeriodComplete(baselinePeriod)).toBe(true)
    expect(isPeriodComplete({ ...baselinePeriod, startType: '' })).toBe(false)
    expect(isPeriodComplete({ ...baselinePeriod, endDate: '' })).toBe(false)
    expect(isPeriodComplete({})).toBe(false)
    expect(isPeriodComplete({ ...baselinePeriod, endType: 0 })).toBe(true) // 0 是非空值，与页面一致
  })

  it('四个字段没齐时 duration() **不发请求**（页面那个 watch 的 else 分支）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await expect(capability.duration({ startDate: '2026-09-21', startType: 1, endDate: '', endType: 2 }))
      .rejects.toThrow(/四个字段都齐/)
    expect(calls.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 四、附件：条数 / 扩展名 / 类型相关必填
// ---------------------------------------------------------------------------

describe('请假申请 —— 附件', () => {
  it('只保留 url 与 name（与页面 onLeaveFileUploadDone 一致）', () => {
    const out = assertAttachments([
      { url: 'https://oss/x.pdf', name: 'a.pdf', size: 123, uid: 'x', status: 'done' },
    ])
    expect(out).toEqual([{ url: 'https://oss/x.pdf', name: 'a.pdf' }])
  })

  it('超过 10 件就拒绝（页面 :maxCount=10）', () => {
    const many = Array.from({ length: ATTACHMENT_MAX_COUNT + 1 }, (_, i) => ({
      url: `https://oss/${i}.pdf`,
      name: `${i}.pdf`,
    }))
    expect(() => assertAttachments(many)).toThrow(/最多 10 件/)
    expect(() => assertAttachments(many.slice(0, ATTACHMENT_MAX_COUNT))).not.toThrow()
  })

  it('扩展名白名单只收 pdf/jpg/jpeg/png；docx 这类通用审批能收的在这里要拒', () => {
    expect(() => assertAttachments([{ url: 'https://oss/a.docx', name: 'a.docx' }])).toThrow(/accept 白名单/)
    expect(() => assertAttachments([{ url: 'https://oss/a.PNG', name: 'a.PNG' }])).not.toThrow()
    // 没有扩展名时放行（与通用审批同一处理）
    expect(() => assertAttachments([{ url: 'https://oss/a', name: 'a' }])).not.toThrow()
  })

  it('缺 url 就拒绝（url 要先用 base-upload-file 传上去）', () => {
    expect(() => assertAttachments([{ name: 'a.pdf' }])).toThrow(/缺 url/)
    expect(() => assertAttachments('nope' as never)).toThrow(/必须是数组/)
    // 不传 = 空数组
    expect(assertAttachments(undefined)).toEqual([])
  })

  it('★ type ∈ {3,4,7,8,9} 时附件必填（页面 formRules 的 checkType）', () => {
    expect([...ATTACHMENT_REQUIRED_TYPES]).toEqual([3, 4, 7, 8, 9])
    for (const type of ATTACHMENT_REQUIRED_TYPES) {
      expect(isAttachmentRequired(type)).toBe(true)
      expect(() => assertAttachmentRequired(type, [])).toThrow(/必须上传附件/)
      // 带上附件就过
      expect(() => assertAttachmentRequired(type, [{ url: 'u', name: 'a.pdf' }])).not.toThrow()
    }
    // 探亲假(6)、年休假(13) 不强制
    for (const type of [6, 13, 1, 10]) {
      expect(isAttachmentRequired(type)).toBe(false)
      expect(() => assertAttachmentRequired(type, [])).not.toThrow()
    }
  })

  it('事假 + 空附件：buildLeavePayload 直接拒（基准那条 type=3 的载荷 SDK 不肯发）', () => {
    const who: LeaveProfile = { id: '18243', userName: '姚淼鑫', staffCode: '2021070101', fullPath: '设计中心1236' }
    expect(() => buildLeavePayload({ ...draft, type: 3 }, who, REST_DAY)).toThrow(/「事假」必须上传附件/)
    // 同一份载荷（type=6）就能过 —— 差别只在这条规则
    expect(() => buildLeavePayload(draft, who, REST_DAY)).not.toThrow()
  })

  it('事由必填、≤200（页面 formRules.reason 的 required + max: 200）', () => {
    const who: LeaveProfile = { id: '18243', userName: '姚淼鑫', staffCode: '2021070101', fullPath: '设计中心1236' }
    expect(() => buildLeavePayload({ ...draft, reason: '   ' }, who, REST_DAY)).toThrow(/请假事由 reason 必填/)
    expect(() => buildLeavePayload({ ...draft, reason: 'x'.repeat(REASON_MAX + 1) }, who, REST_DAY)).toThrow(/最多 200 个字/)
    expect(() => buildLeavePayload({ ...draft, reason: 'x'.repeat(REASON_MAX) }, who, REST_DAY)).not.toThrow()
  })

  it('restDay 必须是数字（不接受"没算就发"）', () => {
    const who: LeaveProfile = { id: '18243', userName: '姚淼鑫', staffCode: '2021070101', fullPath: '设计中心1236' }
    expect(() => buildLeavePayload(draft, who, undefined as never)).toThrow(/restDay 必须是数字/)
    expect(() => buildLeavePayload(draft, who, 'abc' as never)).toThrow(/restDay 必须是数字/)
  })

  it('发起人四项缺一不可', () => {
    expect(() => buildLeavePayload(draft, { id: '', userName: 'x', staffCode: 'y', fullPath: 'z' }, REST_DAY))
      .toThrow(/缺 id/)
  })
})

// ---------------------------------------------------------------------------
// 五、年休假（type = 13）的余额前置
// ---------------------------------------------------------------------------

describe('请假申请 —— 年休假余额', () => {
  it('余额 ≤ 0 直接拒（页面 message.error("年假已用完，请切换请假类型")）', () => {
    expect(() => assertAnnualLeaveEnough(ANNUAL_LEAVE_TYPE, 1, { rest: 5, unRest: 0 })).toThrow(/年假已用完/)
    expect(() => assertAnnualLeaveEnough(ANNUAL_LEAVE_TYPE, 1, { rest: 5, unRest: -0.5 })).toThrow(/年假已用完/)
  })

  it('时长 > 余额也拒（"年假剩余不足，请重新选择请假时间"）', () => {
    expect(() => assertAnnualLeaveEnough(ANNUAL_LEAVE_TYPE, 3, { rest: 5, unRest: 2 })).toThrow(/年假剩余不足/)
    // 刚好用完可以
    expect(() => assertAnnualLeaveEnough(ANNUAL_LEAVE_TYPE, 2, { rest: 5, unRest: 2 })).not.toThrow()
  })

  it('不是年休假就完全不看余额', () => {
    for (const type of [1, 3, 6, 7, 13.5]) {
      if (type === ANNUAL_LEAVE_TYPE) continue
      expect(() => assertAnnualLeaveEnough(type, 999, { rest: 0, unRest: 0 })).not.toThrow()
    }
  })

  it('拿不到余额（unRest 不是数字）时拒，而不是当 0 放过', () => {
    expect(() => assertAnnualLeaveEnough(ANNUAL_LEAVE_TYPE, 1, {} as never)).toThrow(/必须能拿到年假余额/)
  })

  it('年休假 + 余额为 0 时，prepare **在发请求之前**就拒（只打了 profile + duration）', async () => {
    const { calls, capability } = captureSdk(fakeBackend({ '/hr/attendance-user-rel/getYearRest': { rest: 5, unRest: 0 } }))
    await expect(capability.prepare({ ...draft, type: ANNUAL_LEAVE_TYPE })).rejects.toThrow(/年假已用完/)
    expect(pathsOf(calls)).toEqual([
      '/admin-api/sys/user/info',
      '/admin-api/hr/attendance-user-rel/getRestDuration',
      '/admin-api/hr/attendance-user-rel/getYearRest',
    ])
  })

  it('年休假余额够时，查余额这一步仍会打（顺序：profile → duration → yearRest → tasks）', async () => {
    const { calls, capability } = captureSdk(fakeBackend({ '/hr/attendance-user-rel/getYearRest': { rest: 5, unRest: 2 } }))
    await capability.prepare({ ...draft, type: ANNUAL_LEAVE_TYPE })
    expect(pathsOf(calls)).toEqual([
      '/admin-api/sys/user/info',
      '/admin-api/hr/attendance-user-rel/getRestDuration',
      '/admin-api/hr/attendance-user-rel/getYearRest',
      '/admin-api/hr/attendance-user-rel/getRequiredStartUserSelectTasks',
    ])
    expect(queryOf(calls[2])).toEqual([['userId', '18243'], ['_t', '<ts>']])
  })

  it('非年休假不会去查余额', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.prepare(draft)
    expect(pathsOf(calls)).toEqual([
      '/admin-api/sys/user/info',
      '/admin-api/hr/attendance-user-rel/getRestDuration',
      '/admin-api/hr/attendance-user-rel/getRequiredStartUserSelectTasks',
    ])
  })
})

// ---------------------------------------------------------------------------
// 六、profile：只投影四项，绝不透传
// ---------------------------------------------------------------------------

describe('请假申请 —— profile()', () => {
  it('打的是 /sys/user/info（页面 baseData: user-basic 那条）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.profile()
    expect(pathOf(calls[0])).toBe('/admin-api/sys/user/info')
    expect(calls[0]?.method).toBe('get')
  })

  it('★ **不整份透传**：password2 / salt / mobile 一个都不出现在返回值里', async () => {
    const { capability } = captureSdk(fakeBackend())
    const who = await capability.profile()
    expect(Object.keys(who).sort()).toEqual(['fullPath', 'id', 'staffCode', 'userName'])
    const serialized = JSON.stringify(who)
    expect(serialized).not.toContain('password2')
    expect(serialized).not.toContain('$2a$')
    expect(serialized).not.toContain('salt')
    expect(serialized).not.toContain('mobile')
    expect(serialized).not.toContain('15011141909')
  })

  it('四项的来源字段对得上（fullPath ← organizationName，不是 organizationFullPathName）', async () => {
    const { capability } = captureSdk(fakeBackend())
    const who = await capability.profile()
    expect(who).toEqual({
      id: '18243',
      userName: '姚淼鑫',
      staffCode: '2021070101',
      fullPath: '设计中心1236',
    })
  })
})

// ---------------------------------------------------------------------------
// 七、prepare / submit 的调用顺序与载荷
// ---------------------------------------------------------------------------

describe('请假申请 —— prepare 与 submit', () => {
  it('prepare 打的审批人节点接口是 getRequiredStartUserSelectTasks（**不是** Temporary 那个变体）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.prepare(draft)

    const tasksCall = calls.find((c) => pathOf(c).includes('getRequiredStartUserSelectTasks'))!
    expect(pathOf(tasksCall)).toBe('/admin-api/hr/attendance-user-rel/getRequiredStartUserSelectTasks')
    // 通用审批用的是另一个变体；两个变体后端都写了，但不能互相抄
    expect(String(tasksCall.url)).not.toContain('getTemporaryRequiredStartUserSelectTasks')
  })

  it('prepare 发给审批人节点接口的 body **就是**提交载荷（页面 fetchMethod 用的就是 submitData）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    const { payload } = await capability.prepare(draft)

    const tasksCall = calls.find((c) => pathOf(c).includes('getRequiredStartUserSelectTasks'))!
    expect(rawBodyOf(tasksCall)).toBe(JSON.stringify(payload))
    expect(JSON.parse(rawBodyOf(tasksCall)).restDay).toBe(REST_DAY)
  })

  it('本流程实测返回空数组：tasks = []，restDay 单独回（它是流程变量，决定走哪条分支）', async () => {
    const { capability } = captureSdk(fakeBackend())
    const result = await capability.prepare(draft)
    expect(result.tasks).toEqual([])
    expect(result.restDay).toBe(REST_DAY)
    expect((result.payload as Record<string, unknown>).restDay).toBe(REST_DAY)
  })

  it('submit 的三步顺序：profile → getRestDuration → getRequiredStartUserSelectTasks → create', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.submit(draft, {})
    expect(pathsOf(calls)).toEqual([
      '/admin-api/sys/user/info',
      '/admin-api/hr/attendance-user-rel/getRestDuration',
      '/admin-api/hr/attendance-user-rel/getRequiredStartUserSelectTasks',
      '/admin-api/hr/attendance-user-rel/create',
    ])
  })

  it('★ create 的 body = 提交载荷 + 末尾一个 startUserSelectAssignees（页面 actionSubmit 的最后一步）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.submit(draft, {})

    const createCall = calls.find((c) => pathOf(c).endsWith('/create'))!
    const body = rawBodyOf(createCall)
    expect(pathOf(createCall)).toBe('/admin-api/hr/attendance-user-rel/create')
    expect(Object.keys(JSON.parse(body))).toEqual([
      'userId', 'userName', 'staffCode', 'fullPath',
      'type', 'startDate', 'startType', 'endDate', 'endType',
      'reason', 'attachments', 'restDay',
      'startUserSelectAssignees',
    ])
    // 没有 id 字段（编辑分支在前端根本不存在）
    expect(body).not.toContain('"id"')
    // 本流程没有自选节点 ⇒ {}
    expect(JSON.parse(body).startUserSelectAssignees).toEqual({})
    expect(JSON.parse(body).restDay).toBe(REST_DAY)
  })

  it('submit 的返回值就是业务单据 id（原样透传后端的 CommonResult.data）', async () => {
    const { capability } = captureSdk(fakeBackend())
    await expect(capability.submit(draft, {})).resolves.toBe(66)
  })

  it('startUserSelectAssignees 里的人被归一成数字；传非数组 / 非数字会被拒（且**不发 create**）', async () => {
    const { calls, capability } = createSdkFor(() => fakeBackend())
    await capability.submit(draft, { Activity_1: [1, '2' as unknown as number] })
    const create = calls.find((c) => pathOf(c).endsWith('/create'))!
    expect(JSON.parse(rawBodyOf(create)).startUserSelectAssignees).toEqual({ Activity_1: [1, 2] })

    const bad = createSdkFor(() => fakeBackend())
    await expect(bad.capability.submit(draft, { Activity_1: 'x' } as never)).rejects.toThrow(/必须是用户 id 数组/)
    expect(bad.calls.some((c) => pathOf(c).endsWith('/create'))).toBe(false)

    // ⚠️ `Number(null) === 0` —— 只判 isFinite 的话 null 会**悄悄变成用户 0**，
    // 后端那条 `…ASSIGNEE_ID_NULL` 就是这么被绕过去的。这里必须一样严。
    for (const badId of [null, undefined, '', '  ', []]) {
      const bad2 = createSdkFor(() => fakeBackend())
      await expect(bad2.capability.submit(draft, { Activity_1: [badId] } as never)).rejects.toThrow(/不是有效的用户 id/)
      expect(bad2.calls.some((c) => pathOf(c).endsWith('/create'))).toBe(false)
    }
  })

  it('本地校验失败时**一个请求都不发**（写操作会惊动真人，能红在前面就红在前面）', async () => {
    const cases: Array<Partial<LeaveDraft>> = [
      { reason: '' },
      { type: 3 },                                        // 事假要求附件
      { startDate: '2026-09-22', endDate: '2026-09-21' }, // 开始晚于结束
      { startDate: '2026-09-21', startType: PERIOD_PM, endDate: '2026-09-21', endType: PERIOD_AM },
    ]
    for (const patch of cases) {
      const { calls, capability } = createSdkFor(() => fakeBackend())
      await expect(capability.submit({ ...draft, ...patch })).rejects.toThrow()
      expect(calls.length).toBe(0)
    }
  })

  it('submit 拒绝非法参数时是 rejected promise（async 语义，不是同步抛出）', async () => {
    const { capability } = captureSdk(fakeBackend())
    // 同步抛出的话这行会直接炸，而不是被 rejects 接住
    const promise = capability.submit({ ...draft, reason: '' })
    await expect(promise).rejects.toThrow(/请假事由/)
  })

  it('restDay 是现算的：duration 接口给几，载荷里就是几（调用方无法伪造）', async () => {
    const { calls, capability } = captureSdk(fakeBackend({ '/hr/attendance-user-rel/getRestDuration': 4 }))
    await capability.submit(draft, {})
    const create = calls.find((c) => pathOf(c).endsWith('/create'))!
    expect(JSON.parse(rawBodyOf(create)).restDay).toBe(4)
  })

  it('duration 那次请求的 body 与页面 getLeaveDuration(form) 的键顺序一致', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.duration(baselinePeriod)
    expect(rawBodyOf(calls[0])).toBe('{"startDate":"2026-09-21","startType":1,"endDate":"2026-09-21","endType":2}')
  })
})

/** 与 captureSdk 同一个东西，只是让上面那组用例能拿到 calls 的同时还保留 capability */
function createSdkFor (responder: () => (path: string) => unknown) {
  return captureSdk(responder())
}

// ---------------------------------------------------------------------------
// 八、detail / myInstances / findInstanceByBusinessKey
// ---------------------------------------------------------------------------

describe('请假申请 —— 查', () => {
  it('detail 打 GET /hr/attendance-user-rel/get?id=', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.detail(66)
    expect(pathOf(calls[0])).toBe('/admin-api/hr/attendance-user-rel/get')
    expect(calls[0]?.method).toBe('get')
    expect(queryOf(calls[0])).toEqual([['id', '66'], ['_t', '<ts>']])
  })

  it('detail 的响应里 id 恒为 null、也没有 restDay —— 后端就是没填（不是 SDK 漏读）', async () => {
    const { capability } = captureSdk(fakeBackend())
    const record = await capability.detail(66)
    expect(record.id).toBeNull()
    expect(record.restDay).toBeUndefined()
    expect(record.processInstanceId).toBeUndefined()
    // typeName 倒是真有值（后端现查 absent_type 字典）
    expect(record.typeName).toBe('探亲假')
  })

  it('detail 空 id 直接拒，不发请求', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await expect(capability.detail('')).rejects.toThrow(/不能为空/)
    expect(calls.length).toBe(0)
  })

  it('myInstances 带上页面那三个恒发空串的过滤参数（D20 逐字段一致）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.myInstances()
    expect(queryOf(calls[0])).toEqual([
      ['order', ''], ['orderField', ''], ['name', ''], ['title', ''], ['category', ''],
      ['pageNo', '1'], ['pageSize', '20'], ['_t', '<ts>'],
    ])
  })

  it('myInstances 的 status / processType 给了才发（不给不塞空值）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.myInstances({ status: 1, processType: LEAVE_APPLICATION_PROCESS_TYPE })
    const q = queryMapOf(calls[0])
    expect(q.status).toBe('1')
    expect(q.processType).toBe('1')
  })

  it('★ findInstanceByBusinessKey：撞上同名的**通用审批**单据时不会认错（按 processDefinitionKey 再筛一道）', async () => {
    let page = 0
    const { capability } = captureSdk((path, config) => {
      if (path === '/bpm/process-instance/my-page') {
        page += 1
        expect(queryMapOf(config).pageNo).toBe(String(page))
        // 第一页：一条 businessKey 撞上、但 processDefinitionKey 是别人的（通用审批 51 与请假 51 同号）
        // 第二页：才是请假那条
        return page === 1
          ? { list: [{ id: 'inst-other', businessKey: '66', processDefinitionKey: 'hr_general_approval', status: 1 }], total: 2 }
          : { list: [{ id: 'inst-leave', businessKey: '66', processDefinitionKey: 'qingjia', status: 1 }], total: 2 }
      }
      return fakeBackend()(path)
    }, { scanPageSize: 1 })

    const hit = await capability.findInstanceByBusinessKey(66)
    expect(hit.id).toBe('inst-leave')
    expect(page).toBe(2)
  })

  it('一页就找到时不会多翻；翻完没有就报错（不是返回 null）', async () => {
    const one = captureSdk((path) =>
      path === '/bpm/process-instance/my-page'
        ? { list: [{ id: 'inst-leave', businessKey: '66', processDefinitionKey: 'qingjia' }], total: 1 }
        : fakeBackend()(path),
    )
    await expect(one.capability.findInstanceByBusinessKey(66)).resolves.toMatchObject({ id: 'inst-leave' })
    expect(one.calls.length).toBe(1)

    const none = captureSdk((path) =>
      path === '/bpm/process-instance/my-page' ? { list: [], total: 0 } : fakeBackend()(path),
    )
    await expect(none.capability.findInstanceByBusinessKey(66)).rejects.toThrow(/也没找到 businessKey=66/)
  })
})

// ---------------------------------------------------------------------------
// 九、cancel
// ---------------------------------------------------------------------------

describe('请假申请 —— 取消', () => {
  it('给了 processInstanceId 就直接打 cancel-by-start-user，body {id, reason}', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.cancel({ processInstanceId: 'inst-1', reason: '不请了' })
    expect(pathOf(calls[0])).toBe('/admin-api/bpm/process-instance/cancel-by-start-user')
    expect(calls[0]?.method).toBe('delete')
    expect(rawBodyOf(calls[0])).toBe('{"id":"inst-1","reason":"不请了"}')
  })

  it('只给 businessKey 时先去「我的流程」换流程实例 id', async () => {
    const { calls, capability } = captureSdk((path) =>
      path === '/bpm/process-instance/my-page'
        ? { list: [{ id: 'inst-9', businessKey: '66', processDefinitionKey: 'qingjia' }], total: 1 }
        : fakeBackend()(path),
    )
    await capability.cancel({ businessKey: 66, reason: '不请了' })
    expect(pathsOf(calls)).toEqual([
      '/admin-api/bpm/process-instance/my-page',
      '/admin-api/bpm/process-instance/cancel-by-start-user',
    ])
    expect(rawBodyOf(calls[1])).toBe('{"id":"inst-9","reason":"不请了"}')
  })

  it('reason 必填（后端 @NotEmpty），空串 / 全空格都拒，且不发请求', async () => {
    for (const reason of ['', '   ']) {
      const { calls, capability } = captureSdk(fakeBackend())
      await expect(capability.cancel({ processInstanceId: 'inst-1', reason })).rejects.toThrow(/reason 必填/)
      expect(calls.length).toBe(0)
    }
  })

  it('两个 id 都不给就拒', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await expect(capability.cancel({ reason: 'x' })).rejects.toThrow(/processInstanceId 或 businessKey/)
    expect(calls.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 十、其它只读能力
// ---------------------------------------------------------------------------

describe('请假申请 —— 其它只读', () => {
  it('types() 从 grouped-list 里摘 dictType = absent_type 的那一组', async () => {
    const { calls, capability } = captureSdk((path) =>
      path === '/system/dict-data/grouped-list'
        ? [
            { dictType: 'reason_leave', dataList: [{ label: '离家远', value: '1' }] },
            { dictType: 'absent_type', dataList: [{ label: '事假', value: '3' }, { label: '年休假', value: '13' }] },
          ]
        : fakeBackend()(path),
    )
    const types = await capability.types()
    expect(types).toEqual([{ label: '事假', value: 3 }, { label: '年休假', value: 13 }])
    expect(pathOf(calls[0])).toBe('/admin-api/system/dict-data/grouped-list')
    // 字典里 value 是字符串，SDK 归一成数字（页面的 getDictListByType(type, true) 也这么干）
    expect(typeof types[0]!.value).toBe('number')
  })

  it('yearRest() 不给 userId 时用当前登录用户（页面只查自己）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.yearRest()
    expect(pathsOf(calls)).toEqual(['/admin-api/sys/user/info', '/admin-api/hr/attendance-user-rel/getYearRest'])
    expect(queryOf(calls[1])).toEqual([['userId', '18243'], ['_t', '<ts>']])
  })

  it('yearRest(别人) 时不去查 profile —— 调用方自己的选择', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.yearRest(15012)
    expect(pathsOf(calls)).toEqual(['/admin-api/hr/attendance-user-rel/getYearRest'])
    expect(queryMapOf(calls[0]).userId).toBe('15012')
  })

  it('duration() 返回接口给的天数（Number 归一）', async () => {
    const { capability } = captureSdk(fakeBackend({ '/hr/attendance-user-rel/getRestDuration': '2' }))
    await expect(capability.duration(baselinePeriod)).resolves.toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 十一、`assertAssigneesForTasks` 的本地复刻与通用审批那份**行为等价**
// ---------------------------------------------------------------------------

describe('请假申请 —— 自选审批人预检（与通用审批那份是同一套规则）', () => {
  const REAL_TASK = {
    id: 'Activity_1',
    name: '发起人自选',
    minSelectCount: 1,
    maxSelectCount: 2,
    approvalDescription: '所选人员按选择顺序依次审批',
  }

  it('空 tasks 时永远不抛（本流程 prepare 恒返回 []，这一步是空转）', () => {
    expect(() => assertAssigneesForTasks([], {})).not.toThrow()
    expect(() => assertAssigneesForTasks([], { Activity_1: [1] })).not.toThrow()
  })

  it('五类输入上，本文件的复刻与 general-approval 的**结论逐例一致**', async () => {
    // ⚠️ 这条是**防止两份实现漂移**的那一条：本文件不能 import
    // general-approval 的值（Node 类型剥离跑不起来，见能力文件头的导入注释），
    // 所以只能复刻；复刻就会漂。这里把两边都拉进来跑同一张表。
    const { assertAssigneesForTasks: reference } = await import('../src/capabilities/general-approval.js')

    const cases: Array<[string, Record<string, number[]>, boolean]> = [
      ['没选人', {}, true],
      ['选了 1 个（合法）', { Activity_1: [1] }, false],
      ['选了 2 个（合法，等于 max）', { Activity_1: [1, 2] }, false],
      ['超了 max（3 > 2）', { Activity_1: [1, 2, 3] }, true],
      ['有重复（1,1）', { Activity_1: [1, 1] }, true],
      ['有 NaN 那一类（Number 后仍不是有限数）', { Activity_1: [Number.NaN] }, true],
    ]
    for (const [label, assignees, shouldThrow] of cases) {
      const run = (fn: typeof reference) => {
        try {
          fn([REAL_TASK as never], assignees as never)
          return false
        } catch {
          return true
        }
      }
      expect(run(assertAssigneesForTasks), label).toBe(shouldThrow)
      expect(run(reference), label).toBe(shouldThrow)
    }
  })

  it('min 不满足时拒（本流程没有这种节点，规则照留）', () => {
    expect(() => assertAssigneesForTasks([{ ...REAL_TASK, minSelectCount: 3 } as never], { Activity_1: [1] }))
      .toThrow(/至少要选 3 个人/)
  })

  it('null / undefined 两边都拦得住；但空串与空数组是个洞（Number("") === 0 / Number([]) === 0）', async () => {
    // 拦得住的
    for (const bad of [null, undefined]) {
      expect(() => assertAssigneesForTasks([REAL_TASK as never], { Activity_1: [bad] } as never))
        .toThrow(/空值或非数字/)
    }
    // ⚠️ **拦不住的**：`Number('')` 与 `Number([])` 都是 0，
    // `Number.isFinite(0)` 为真 —— 第二条规则就这么被绕过去了。
    // 这是**如实记录**（本文件刻意与通用审批那份行为等价，上一段那条对照测试才是一句真话），
    // 不是"设计如此"。真正的写请求由 submit 里的 normalizeAssignees 守住：
    for (const sneaky of ['', '  ', []]) {
      expect(() => assertAssigneesForTasks([REAL_TASK as never], { Activity_1: [sneaky] } as never)).not.toThrow()

      const { capability, calls } = captureSdk(fakeBackend())
      await expect(capability.submit(draft, { Activity_1: [sneaky] } as never))
        .rejects.toThrow(/不是有效的用户 id/)
      expect(calls.some((c) => pathOf(c).endsWith('/create'))).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 十二、防重那一层只声明形状（包装在组装点）
// ---------------------------------------------------------------------------

describe('请假申请 —— 组装点要补的那一层', () => {
  it('能力实例上没有 submitIdempotent（包装归组装点，与通用审批同一分工）', async () => {
    const { capability } = captureSdk(fakeBackend())
    expect((capability as Record<string, unknown>).submitIdempotent).toBeUndefined()
    expect(typeof capability.submit).toBe('function')
  })
})
