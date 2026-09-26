import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  APPLICATION_CONTENT_MAX,
  APPLICATION_ITEM_MAX,
  GENERAL_APPROVAL_FORM_PATH,
  GENERAL_APPROVAL_MY_LIST_PATH,
  GENERAL_APPROVAL_PAGE_PATH,
  GENERAL_APPROVAL_PROCESS_KEY,
  assertAssigneesForTasks,
  buildGeneralApprovalCreatePayload,
  buildGeneralApprovalPayload,
  createGeneralApprovalCapability,
  generalApprovalCapabilities,
  type GeneralApprovalDraft,
  type ProcessInstanceRow,
  type StartUserSelectTask,
} from '../src/capabilities/general-approval.js'

/**
 * 通用审批（`hr_general_approval` / `/simple/hr/form/035`）—— 流程表单第二条线。
 *
 * 三条来源，逐条钉住：
 *   1. `baseline/general-approval.browser.json`：真实浏览器抓的请求（只读那几条）
 *   2. Portal 前端源码 `app/portal/views/simple/hr/form/035/**`
 *   3. 后端源码 `GeneralApprovalController` / `BpmProcessInstanceServiceImpl`
 *
 * 写链路（submit / cancel）的真实往返记录在 `docs/pages/通用审批.md` 的
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
  表单填写值: { applicationItem: string; applicationContent: string }
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/general-approval.browser.json'), 'utf8'),
)

/** 去掉主机与一次性时间戳，只留 path + query */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

const baselineUrls = new Set(baseline.请求.map((r) => normalize(r.u)))

/** 基准里那条 POST 的 body（buildGeneralApprovalSubmitData 的真实产物） */
const baselineTaskBody = baseline.请求.find((r) => r.于 === 'POST')?.body as string
const baselineTasKHeaders = baseline.请求.find((r) => r.于 === 'POST')?.headers as Record<string, string>

/**
 * 与基准同一份表单填写值。**写死**而不是从基准里读 —— 基准是"浏览器发出去的"，
 * 这里是"SDK 发出去的"，两边各自独立取值才叫对照；下面那条
 * «写死的填写值与基准里记的一致» 负责兜住两边漂移。
 */
const draft: GeneralApprovalDraft = {
  applicationItem: 'SDK-TEST-baseline',
  applicationContent: 'SDK-TEST-baseline content',
}

/** 实测本流程的那一个节点（baseline 的「审批人节点」一节原样抄下来） */
const REAL_TASKS: StartUserSelectTask[] = [
  {
    id: 'Activity_1o1sabd',
    name: '发起人自选2',
    approvalMode: 'SEQUENTIAL',
    executionMode: 'SEQUENTIAL',
    completionRule: 'ALL_APPROVED',
    minSelectCount: 1,
    maxSelectCount: null,
    selectionOrderRequired: true,
    approvalDescription: '所选人员按选择顺序依次审批，全部通过后节点通过',
  },
]

function captureSdk () {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: {} },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  // 组装点（src/index.ts）将来也是这样接的：能力收一个"已带页面上下文"的请求函数
  const capability = createGeneralApprovalCapability((requestConfig) =>
    sdk.call(GENERAL_APPROVAL_FORM_PATH, requestConfig),
  )
  return { sdk, calls, capability }
}

/** 造一个「后端会回什么由你定」的能力实例。`data` 原样进 `CommonResult.data` */
function captureSdkReturning (data: unknown, options?: { maxScanPages?: number; scanPageSize?: number }) {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const cap = createGeneralApprovalCapability(
    (requestConfig) => sdk.call(GENERAL_APPROVAL_FORM_PATH, requestConfig),
    options,
  )
  return { sdk, calls, cap }
}

/** axios 在到达 adapter 前已按 transformRequest 把对象序列化成字符串 */
function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

/**
 * 取这次请求的查询参数（**顺序即 qs 序列化后的顺序**）。
 *
 * ⚠️ 不能读 `config.params`：走到自定义 adapter 时 axios 已经把 params 折进
 * `config.url` 并把 `config.params` 清成 `{}`（实测）。所以只能从 URL 里解析回来。
 */
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

/** 同上，但要一个按名字取值的对象 */
function queryMapOf (config: InternalAxiosRequestConfig | undefined): Record<string, string> {
  return Object.fromEntries(queryOf(config))
}

// ---------------------------------------------------------------------------
// 一、与浏览器基准一致
// ---------------------------------------------------------------------------

describe('通用审批 —— 读链路与浏览器基准一致', () => {
  it('写死的表单填写值与基准里记的一致（两边不会各自漂移）', () => {
    expect(draft.applicationItem).toBe(baseline.表单填写值.applicationItem)
    expect(draft.applicationContent).toBe(baseline.表单填写值.applicationContent)
  })

  it('流程定义请求与基准一致（key 是 hr_general_approval）', async () => {
    const { calls, capability } = captureSdk()
    await capability.definition()

    const actual = normalize(String(calls[0]?.url))
    expect(actual).toBe('/admin-api/bpm/process-definition/get?key=hr_general_approval&_t=<ts>')
    expect(baselineUrls.has(actual)).toBe(true)
  })

  it('prepare 打的审批人节点接口是 getTemporary… 那个变体，不是 getRequired…', async () => {
    const { calls, capability } = captureSdk()
    await capability.prepare(draft)

    const actual = String(calls[0]?.url)
    expect(normalize(actual)).toBe(
      '/admin-api/hr/general-approval/getTemporaryRequiredStartUserSelectTasks',
    )
    // 两个变体后端都写了；浏览器用的是 Temporary，SDK 必须跟前端走
    expect(actual).not.toContain('/getRequiredStartUserSelectTasks')
  })

  it('prepare 的请求体与基准**逐字节**相同（含键顺序）', async () => {
    const { calls, capability } = captureSdk()
    await capability.prepare(draft)

    // 逐字段
    expect(JSON.parse(rawBodyOf(calls[0]))).toEqual(JSON.parse(baselineTaskBody))
    // 逐字节：键顺序 applicationItem → applicationContent → attachments → copyUserIds，且没有 id
    expect(rawBodyOf(calls[0])).toBe(baselineTaskBody)
  })

  it('prepare 的请求头与基准同一个集合，且**不发 module-type**', async () => {
    const { calls, capability } = captureSdk()
    await capability.prepare(draft)

    const actual = calls[0]?.headers as unknown as Record<string, string>
    expect(actual['tenant-id']).toBe(baselineTasKHeaders['tenant-id'])
    expect(actual['Accept-Language']).toBe(baselineTasKHeaders['Accept-Language'])
    expect(actual['Accept']).toBe(baselineTasKHeaders['Accept'])
    expect(String(actual['Content-Type'] ?? actual['content-type'])).toContain('application/json')
    expect(Object.keys(actual).sort()).toEqual(Object.keys(baselineTasKHeaders).sort())
    expect(actual).not.toHaveProperty('module-type')
  })

  it('四条页面路径都算不出 module-type（SDK 与浏览器一致：不发这个头）', () => {
    for (const path of [
      GENERAL_APPROVAL_FORM_PATH,
      GENERAL_APPROVAL_PAGE_PATH,
      GENERAL_APPROVAL_MY_LIST_PATH,
    ]) {
      expect(createPortalHeadless({
        baseUrl: 'https://biz-api-test.wodecorp.cn',
        credential: { token: 'tk-test', tenantId: 1 },
      }).resolveModuleType(path).moduleType).toBeNull()
    }
  })

  it('基准本身记录了页面「无关键字拉 500 人」的行为（D6 的由来）', () => {
    const pulls = baseline.请求.filter((r) => r.u.includes('/system/user/simple-page'))
    expect(pulls.length).toBeGreaterThan(0)
    expect(pulls[0]?.u).toContain('pageSize=500')
    expect(pulls[0]?.u).not.toContain('nickname=')
  })
})

// ---------------------------------------------------------------------------
// 二、长选项保护
// ---------------------------------------------------------------------------

describe('抄送人 / 审批人候选：长选项参数保护（设计 D6 / H35）', () => {
  it('无关键字、无部门时拒绝调用，且一个请求都不发', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.searchUsers({})).rejects.toThrow(/长选项参数/)
    expect(calls).toHaveLength(0)
  })

  it('pageSize = -1（全量拉取）被拒绝', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.searchUsers({ keyword: '李', pageSize: -1 })).rejects.toThrow(/全量拉取/)
    expect(calls).toHaveLength(0)
  })

  it('给了关键字时走 simple-page + nickname（浏览器用的就是这个接口）', async () => {
    const { calls, capability } = captureSdk()
    await capability.searchUsers({ keyword: '李' })

    const url = String(calls[0]?.url)
    expect(url).toContain('/admin-api/system/user/simple-page')
    expect(url).toContain('nickname=')
    // 不能用 simple-list：那是无关键字全量（实测 4225 条）
    expect(url).not.toContain('simple-list')
    expect(queryMapOf(calls[0]).pageSize).toBe('20')
    expect(queryMapOf(calls[0]).nickname).toBe('李')
  })

  it('给了部门也可以查（用户不知道关键字时的兜底路径）', async () => {
    const { calls, capability } = captureSdk()
    await capability.searchUsers({ deptId: 100 })
    expect(queryMapOf(calls[0]).deptId).toBe('100')
    // 没给关键字时**不发 nickname**（空串会被后端当成一个筛选条件）
    expect(queryMapOf(calls[0])).not.toHaveProperty('nickname')
  })
})

// ---------------------------------------------------------------------------
// 三、载荷构造
// ---------------------------------------------------------------------------

describe('载荷构造：逐字段复刻 buildGeneralApprovalSubmitData()', () => {
  it('键顺序与浏览器相同，且**没有 id 字段**（编辑分支前端已注释）', () => {
    const payload = buildGeneralApprovalPayload(draft)
    expect(JSON.stringify(payload)).toBe(baselineTaskBody)
    expect(Object.keys(payload)).toEqual([
      'applicationItem',
      'applicationContent',
      'attachments',
      'copyUserIds',
    ])
    expect(payload).not.toHaveProperty('id')
  })

  it('两个必填字段缺一不可，且分别卡 200 / 500 字', () => {
    expect(() => buildGeneralApprovalPayload({ ...draft, applicationItem: '' })).toThrow(/申请事项/)
    expect(() => buildGeneralApprovalPayload({ ...draft, applicationItem: '   ' })).toThrow(/申请事项/)
    expect(() => buildGeneralApprovalPayload({ ...draft, applicationContent: '' })).toThrow(/申请内容/)
    expect(() =>
      buildGeneralApprovalPayload({
        ...draft,
        applicationItem: 'x'.repeat(APPLICATION_ITEM_MAX + 1),
      }),
    ).toThrow(new RegExp(`最多 ${APPLICATION_ITEM_MAX}`))
    expect(() =>
      buildGeneralApprovalPayload({
        ...draft,
        applicationContent: 'x'.repeat(APPLICATION_CONTENT_MAX + 1),
      }),
    ).toThrow(new RegExp(`最多 ${APPLICATION_CONTENT_MAX}`))
    // 边界值是合法的（200 / 500 本身不拦）
    expect(() =>
      buildGeneralApprovalPayload({
        ...draft,
        applicationItem: 'x'.repeat(APPLICATION_ITEM_MAX),
        applicationContent: 'y'.repeat(APPLICATION_CONTENT_MAX),
      }),
    ).not.toThrow()
  })

  it('附件只保留 url 与 name —— 多给的字段必须被丢掉（页面的 map 就是这么写的）', () => {
    const payload = buildGeneralApprovalPayload({
      ...draft,
      attachments: [
        { url: 'https://oss.example.com/a.pdf', name: '合同.pdf', id: 999, size: 1234, pages: 3 },
      ],
    })
    expect(payload.attachments).toEqual([{ url: 'https://oss.example.com/a.pdf', name: '合同.pdf' }])
  })

  it('附件超过 10 件被拦（页面 :maxCount=10）', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      url: `https://oss.example.com/${i}.pdf`,
      name: `${i}.pdf`,
    }))
    expect(() => buildGeneralApprovalPayload({ ...draft, attachments: many })).toThrow(/最多 10 件/)
    expect(() => buildGeneralApprovalPayload({ ...draft, attachments: many.slice(0, 10) })).not.toThrow()
  })

  it('附件的扩展名按表单的 accept 白名单拦（.zip / .txt 进不来，无扩展名放行）', () => {
    // `.txt` 不是编出来的反例：2026-09-20 真跑附件冒烟时，探针文件就写成了 `.txt`，
    // 被这条守卫在**发出请求之前**挡住（真实路径上生效的现场，见 docs/pages/通用审批.md）。
    for (const name of ['a.zip', 'a.txt', 'a.exe']) {
      expect(() =>
        buildGeneralApprovalPayload({
          ...draft,
          attachments: [{ url: `https://oss.example.com/${name}`, name }],
        }),
      ).toThrow(/accept 白名单/)
    }
    // 白名单里的就是放行的；大小写不敏感
    for (const name of ['a.pdf', 'a.csv', 'a.xlsx', '台账.XLSX']) {
      expect(() =>
        buildGeneralApprovalPayload({
          ...draft,
          attachments: [{ url: `https://oss.example.com/${name}`, name }],
        }),
      ).not.toThrow()
    }
    // 没有扩展名时放行（页面上传的文件未必都带名字）
    expect(() =>
      buildGeneralApprovalPayload({
        ...draft,
        attachments: [{ url: 'https://oss.example.com/a', name: '没有扩展名' }],
      }),
    ).not.toThrow()
  })

  it('附件缺 url 被拦（url 得先用 base-upload-file 传上去）', () => {
    expect(() =>
      buildGeneralApprovalPayload({ ...draft, attachments: [{ url: '', name: 'a.pdf' }] }),
    ).toThrow(/base-upload-file/)
  })

  it('抄送人归一成数字数组；缺省是空数组', () => {
    expect(buildGeneralApprovalPayload(draft).copyUserIds).toEqual([])
    expect(buildGeneralApprovalPayload({ ...draft, copyUserIds: [3, 7] }).copyUserIds).toEqual([3, 7])
    expect(() =>
      buildGeneralApprovalPayload({ ...draft, copyUserIds: ['x' as unknown as number] }),
    ).toThrow(/不是数字/)
  })

  it('create 的 body = 基准 body + startUserSelectAssignees，且它**排在最后**', () => {
    const body = buildGeneralApprovalCreatePayload(draft, { Activity_1o1sabd: [197832] })
    expect(Object.keys(body)).toEqual([
      'applicationItem',
      'applicationContent',
      'attachments',
      'copyUserIds',
      'startUserSelectAssignees',
    ])
    const text = JSON.stringify(body)
    expect(text.startsWith(`${baselineTaskBody.slice(0, -1)},"startUserSelectAssignees":`)).toBe(true)
    expect(JSON.parse(text)).toEqual({
      ...JSON.parse(baselineTaskBody),
      startUserSelectAssignees: { Activity_1o1sabd: [197832] },
    })
  })
})

// ---------------------------------------------------------------------------
// 四、prepare 的前置（页面的 isGeneralApprovalDataComplete）
// ---------------------------------------------------------------------------

describe('prepare 的前置：两个必填字段都填了才去问审批人节点', () => {
  it('字段不全时不发请求，直接拒绝（页面的 refreshApprovalTasks 就是这么做的）', async () => {
    const { calls, capability } = captureSdk()
    await expect(
      capability.prepare({ applicationItem: '', applicationContent: 'x' }),
    ).rejects.toThrow(/都填了才能问审批人节点/)
    await expect(
      capability.prepare({ applicationItem: 'x', applicationContent: '' }),
    ).rejects.toThrow(/都填了才能问审批人节点/)
    expect(calls).toHaveLength(0)
  })

  it('字段齐了才发，且返回的是数组（后端 data 为 null 时归一成空数组）', async () => {
    const { calls, capability } = captureSdk()
    const result = await capability.prepare(draft)
    expect(calls).toHaveLength(1)
    expect(result.tasks).toEqual([])
    expect(result.payload).toEqual(JSON.parse(baselineTaskBody))
  })
})

// ---------------------------------------------------------------------------
// 五、审批人节点：后端那四条规则
// ---------------------------------------------------------------------------

describe('assertAssigneesForTasks：复刻后端 validateStartUserSelectAssignees', () => {
  it('合法的一份能过', () => {
    expect(() => assertAssigneesForTasks(REAL_TASKS, { Activity_1o1sabd: [197832] })).not.toThrow()
  })

  it('少了必选节点 → 红（后端 ASSIGNEES_NOT_CONFIG）', () => {
    expect(() => assertAssigneesForTasks(REAL_TASKS, {})).toThrow(/没有选人/)
    expect(() => assertAssigneesForTasks(REAL_TASKS, { Activity_1o1sabd: [] })).toThrow(/没有选人/)
    expect(() => assertAssigneesForTasks(REAL_TASKS, { Other_Task: [1] })).toThrow(/没有选人/)
  })

  it('重复的人 → 红（后端 ASSIGNEES_DUPLICATE）', () => {
    expect(() =>
      assertAssigneesForTasks(REAL_TASKS, { Activity_1o1sabd: [1, 1] }),
    ).toThrow(/重复的人/)
  })

  it('数量越界 → 红（后端 ASSIGNEES_COUNT_INVALID）', () => {
    const task: StartUserSelectTask = { id: 'T', name: '节点', minSelectCount: 2, maxSelectCount: 3 }
    expect(() => assertAssigneesForTasks([task], { T: [1] })).toThrow(/至少要选 2 个人/)
    expect(() => assertAssigneesForTasks([task], { T: [1, 2, 3, 4] })).toThrow(/最多选 3 个人/)
    expect(() => assertAssigneesForTasks([task], { T: [1, 2, 3] })).not.toThrow()
  })

  it('空值 / 非数字 → 红（后端 ASSIGNEE_ID_NULL）', () => {
    expect(() =>
      assertAssigneesForTasks(REAL_TASKS, { Activity_1o1sabd: [null as unknown as number] }),
    ).toThrow(/空值或非数字/)
  })

  it('没有节点（会议室那种流程）时不拦任何东西', () => {
    expect(() => assertAssigneesForTasks([], {})).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 六、提交
// ---------------------------------------------------------------------------

describe('submit：写操作（会真的起流程、推真人待办）', () => {
  it('打的是 /hr/general-approval/create，方法 POST', async () => {
    const { calls, capability } = captureSdk()
    await capability.submit(draft, { Activity_1o1sabd: [197832] })

    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/hr/general-approval/create')
    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(String(calls[0]?.url)).not.toContain('_t=')
  })

  it('body 是基准 body + assignees，assignees 排在最后', async () => {
    const { calls, capability } = captureSdk()
    await capability.submit(draft, { Activity_1o1sabd: [197832] })

    expect(rawBodyOf(calls[0])).toBe(
      `${baselineTaskBody.slice(0, -1)},"startUserSelectAssignees":{"Activity_1o1sabd":[197832]}}`,
    )
  })

  it('assignees 的值被归一成数字（字符串 id 也收）', async () => {
    const { calls, capability } = captureSdk()
    await capability.submit(draft, { Activity_1o1sabd: ['197832' as unknown as number] })
    expect(JSON.parse(rawBodyOf(calls[0])).startUserSelectAssignees).toEqual({
      Activity_1o1sabd: [197832],
    })
  })

  it('本地校验失败时**一个请求都不发**（省下一次必然失败的写请求）', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.submit({ ...draft, applicationItem: '' }, {})).rejects.toThrow(/申请事项/)
    await expect(
      capability.submit(draft, { Activity_1o1sabd: ['not-a-number' as unknown as number] }),
    ).rejects.toThrow(/不是数字/)
    await expect(
      capability.submit(draft, null as unknown as Record<string, number[]>),
    ).rejects.toThrow(/startUserSelectAssignees/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 七、详情 / 我的流程 / 找实例
// ---------------------------------------------------------------------------

describe('detail 与「我的流程」', () => {
  it('detail 打 /hr/general-approval/get?id=', async () => {
    const { calls, capability } = captureSdk()
    await capability.detail(51)
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/hr/general-approval/get?id=51&_t=<ts>')
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
  })

  it('myInstances 的参数与页面一致（order/orderField/name/title/category 空值也发）', async () => {
    const { calls, capability } = captureSdk()
    await capability.myInstances()

    // 顺序即 qs 序列化后的顺序：与抓包看到的
    // `my-page?order=&orderField=&name=&title=&category=&pageNo=1&pageSize=20&_t=…` 一致
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

  it('status / processType 只在给了的时候才发（页面空着时不发）', async () => {
    const { calls, capability } = captureSdk()
    await capability.myInstances({ status: 1, processType: 2 })
    expect(queryMapOf(calls[0]).status).toBe('1')
    expect(queryMapOf(calls[0]).processType).toBe('2')

    await capability.myInstances()
    expect(queryMapOf(calls[1])).not.toHaveProperty('status')
    expect(queryMapOf(calls[1])).not.toHaveProperty('processType')
  })

  it('findInstanceByBusinessKey 用 businessKey 对上流程实例（cancel 要的就是这个 id）', async () => {
    const rows: ProcessInstanceRow[] = [
      { id: 'inst-1', businessKey: '50', processDefinitionKey: 'hr_general_approval' },
      { id: 'inst-2', businessKey: '51', processDefinitionKey: 'hr_general_approval' },
    ]
    const { cap, calls } = captureSdkReturning({ list: rows, total: rows.length })

    const hit = await cap.findInstanceByBusinessKey(51)
    expect(hit.id).toBe('inst-2')
    expect(calls).toHaveLength(1)
    // 传数字还是字符串都认（businessKey 在响应里是字符串）
    expect((await cap.findInstanceByBusinessKey('51')).id).toBe('inst-2')
  })

  it('businessKey 撞车时按 processDefinitionKey 认，不会认错成别的流程', async () => {
    // 会议室预定的 businessKey 也是数字（后端 setBusinessKey(String.valueOf(业务 id))），
    // 两张表的主键各自从 1 开始 ⇒ 一定会撞
    const rows: ProcessInstanceRow[] = [
      { id: 'meeting-51', businessKey: '51', processDefinitionKey: 'meeting_application' },
      { id: 'ga-999', businessKey: '999', processDefinitionKey: 'hr_general_approval' },
    ]
    const { cap } = captureSdkReturning({ list: rows, total: rows.length })

    // 51 那条是会议室的，不能认成通用审批的 —— 只有 businessKey 对上不够
    await expect(cap.findInstanceByBusinessKey(51)).rejects.toThrow(/也没找到/)
    expect((await cap.findInstanceByBusinessKey(999)).id).toBe('ga-999')
  })

  it('翻页上限用尽后抛错，而不是返回 undefined 让下一步去 cancel 一个空的 id', async () => {
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
    const cap = createGeneralApprovalCapability(
      (requestConfig) => sdk.call(GENERAL_APPROVAL_FORM_PATH, requestConfig),
      { maxScanPages: 2, scanPageSize: 1 },
    )
    await expect(cap.findInstanceByBusinessKey(42)).rejects.toThrow(/翻到第 2 页也没找到/)
    // 上限真的生效了：只发了 2 次，没有把整个列表翻完
    expect(page).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 八、取消
// ---------------------------------------------------------------------------

describe('cancel：DELETE /bpm/process-instance/cancel-by-start-user', () => {
  it('给了流程实例 id 时直接取消，body 是 {id, reason}', async () => {
    const { calls, capability } = captureSdk()
    await capability.cancel({ processInstanceId: 'inst-51', reason: 'SDK-TEST 撤销' })

    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/bpm/process-instance/cancel-by-start-user')
    expect(String(calls[0]?.method).toUpperCase()).toBe('DELETE')
    expect(rawBodyOf(calls[0])).toBe('{"id":"inst-51","reason":"SDK-TEST 撤销"}')
  })

  it('只给 businessKey 时先去「我的流程」把它换成流程实例 id，再取消（两步）', async () => {
    const calls: InternalAxiosRequestConfig[] = []
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      calls.push(config)
      const isList = String(config.url).includes('my-page')
      return {
        data: {
          ret: 'SUCCESS',
          code: 0,
          msg: '',
          data: isList
            ? {
                list: [{ id: 'inst-77', businessKey: '77', processDefinitionKey: 'hr_general_approval' }],
                total: 1,
              }
            : true,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const cap = createGeneralApprovalCapability((requestConfig) =>
      sdk.call(GENERAL_APPROVAL_FORM_PATH, requestConfig),
    )

    await cap.cancel({ businessKey: 77, reason: 'SDK-TEST 撤销' })

    expect(calls).toHaveLength(2)
    expect(String(calls[0]?.url)).toContain('/bpm/process-instance/my-page')
    expect(rawBodyOf(calls[1])).toBe('{"id":"inst-77","reason":"SDK-TEST 撤销"}')
  })

  it('reason 为空时拒绝，且一个请求都不发（后端 @NotEmpty）', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.cancel({ processInstanceId: 'i', reason: '' })).rejects.toThrow(/reason 必填/)
    await expect(
      capability.cancel({ processInstanceId: 'i', reason: '   ' }),
    ).rejects.toThrow(/reason 必填/)
    await expect(
      capability.cancel({ processInstanceId: 'i', reason: undefined as unknown as string }),
    ).rejects.toThrow(/reason 必填/)
    expect(calls).toHaveLength(0)
  })

  it('两个 id 都不给时拒绝，且不发请求', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.cancel({ reason: '撤销' })).rejects.toThrow(/processInstanceId 或 businessKey/)
    expect(calls).toHaveLength(0)
  })

  it('后端说「流程不处于运行中」时如实抛出去，不吞错、也不假装撤成功', async () => {
    // 真实碰到过：审批人选了自己 ⇒ 后端「发起人与审批人相同自动通过」直接把流程走完
    // ⇒ cancel 报这句。SDK 的立场是"如实透传失败"（与合同模板删除那条线一致）。
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
    const cap = createGeneralApprovalCapability((requestConfig) =>
      sdk.call(GENERAL_APPROVAL_FORM_PATH, requestConfig),
    )

    await expect(
      cap.cancel({ processInstanceId: 'inst-1', reason: '撤销' }),
    ).rejects.toThrow(/流程不处于运行中/)
    // 请求确实发出去了 —— 这不是本地校验拦下来的，是后端说的
    expect(calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 九、能力定义本身
// ---------------------------------------------------------------------------

describe('能力定义', () => {
  it('七条能力，id 不重复，写能力恰好两条（submit / cancel）', () => {
    const ids = generalApprovalCapabilities.map((c) => c.id)
    expect(ids).toEqual([
      'general-approval-definition',
      'general-approval-user-search',
      'general-approval-prepare',
      'general-approval-submit',
      'general-approval-detail',
      'general-approval-my-instances',
      'general-approval-cancel',
    ])
    expect(new Set(ids).size).toBe(ids.length)
    expect(generalApprovalCapabilities.filter((c) => c.write).map((c) => c.id)).toEqual([
      'general-approval-submit',
      'general-approval-cancel',
    ])
  })

  it('pagePath 只落在流程页面与「我的流程」上 —— **绝不能用「发起流程」那条路径**', () => {
    const paths = new Set(generalApprovalCapabilities.map((c) => c.pagePath))
    expect(paths).toEqual(new Set([GENERAL_APPROVAL_PAGE_PATH, GENERAL_APPROVAL_FORM_PATH, GENERAL_APPROVAL_MY_LIST_PATH]))
    // /dashboard/flow/task/create/list 在 page-catalog 里，挂上去会把那个页面错误地标成已完成
    for (const c of generalApprovalCapabilities) {
      expect(c.pagePath).not.toBe('/dashboard/flow/task/create/list')
    }
  })

  it('长选项参数都登记了 lookup（否则调用方只能靠猜）', () => {
    const submit = generalApprovalCapabilities.find((c) => c.id === 'general-approval-submit')
    for (const name of ['copyUserIds', 'startUserSelectAssignees']) {
      const param = submit?.params.find((p) => p.name === name)
      expect(param?.lookup).toEqual({
        capabilityId: 'general-approval-user-search',
        keywordParam: 'keyword',
      })
    }
  })

  it('流程 key 常量与浏览器入口 URL 里的值一致', () => {
    expect(GENERAL_APPROVAL_PROCESS_KEY).toBe('hr_general_approval')
    expect(baseline.入口).toContain(`processDefinitionKey=${GENERAL_APPROVAL_PROCESS_KEY}`)
    expect(baseline.入口).toContain('formCustomCreatePath=simple/hr/form/035')
  })
})
