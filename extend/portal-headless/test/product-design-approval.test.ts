import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  APPLICATION_CONTENT_MAX,
  APPLICATION_ITEM_MAX,
  ATTACHMENT_ACCEPT_EXTENSIONS,
  PRODUCT_DESIGN_APPROVAL_FORM_PATH,
  PRODUCT_DESIGN_APPROVAL_MY_LIST_PATH,
  PRODUCT_DESIGN_APPROVAL_PAGE_PATH,
  PRODUCT_DESIGN_APPROVAL_PROCESS_KEY,
  PRODUCT_DESIGN_APPROVAL_PROCESS_TYPE,
  assertAssigneesForTasks,
  buildProductDesignApprovalCreatePayload,
  buildProductDesignApprovalPayload,
  buildProductDesignApprovalPreviewPayload,
  createProductDesignApprovalCapability,
  productDesignApprovalCapabilities,
  type ProcessInstanceRow,
  type ProductDesignApprovalDraft,
  type StartUserSelectTask,
} from '../src/capabilities/product-design-approval.js'

/**
 * 产品设计文档审核（`hr_product_design_approval` / `/simple/hr/form/045`）—— 流程表单第三条线。
 *
 * 三条来源，逐条钉住：
 *   1. `baseline/product-design-approval.browser.json`：真实浏览器抓的请求（只读那几条）
 *   2. Portal 前端源码 `app/portal/views/simple/hr/form/045/**`
 *   3. 后端源码 `ProductDesignApprovalController` / `BpmProcessInstanceServiceImpl`
 *
 * 写链路（submit / cancel / 附件）的真实往返记录在
 * `docs/pages/产品设计文档审核.md` 的「真实验证记录」一节；这里只管契约与逐字段一致。
 *
 * ⚠️ **本文件刻意与 `general-approval.test.ts` 保持独立的两份取值**，不做成参数化模板：
 * 045 与 035 在**节点数**（2 vs 1）、`processType`、`a-alert` 那段说明上都不一样，
 * 合并成模板会把那些差异"抹平"，正好抹掉最该被钉住的东西。
 */

type BaselineRequest = {
  于: string
  u: string
  via: string
  headers: Record<string, string>
  次数?: number
  body?: string
  备注?: string
}
type Baseline = {
  入口: string
  请求: BaselineRequest[]
  表单填写值: { applicationItem: string; applicationContent: string }
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/product-design-approval.browser.json'), 'utf8'),
)

/** 去掉主机与一次性时间戳，只留 path + query */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

const baselineUrls = new Set(baseline.请求.map((r) => normalize(r.u)))

/** 基准里那条「审批人节点查询」的 POST（045 的 buildSubmitData 的真实产物） */
const baselineTaskRequest = baseline.请求.find(
  (r) => r.于 === 'POST' && r.u.includes('getTemporaryRequiredStartUserSelectTasks'),
)
const baselineTaskBody = baselineTaskRequest?.body as string
const baselineTaskHeaders = baselineTaskRequest?.headers as Record<string, string>

/** 基准里那条 preview 的 POST（「查看审批流程」按钮） */
const baselinePreviewRequest = baseline.请求.find(
  (r) => r.于 === 'POST' && r.u.includes('/bpm/process-instance/preview'),
)
const baselinePreviewBody = baselinePreviewRequest?.body as string

/**
 * 与基准同一份表单填写值。**写死**而不是从基准里读 —— 基准是"浏览器发出去的"，
 * 这里是"SDK 发出去的"，两边各自独立取值才叫对照；下面那条
 * «写死的填写值与基准里记的一致» 负责兜住两边漂移。
 */
const draft: ProductDesignApprovalDraft = {
  applicationItem: 'SDK-TEST-baseline',
  applicationContent: 'SDK-TEST-baseline content',
}

/**
 * 实测本流程的两个自选节点（**真实测试环境，2026-09-21，read-only prepare**）。
 *
 * ⚠️ **两个**，不是 035 的那一个。凡是拿这份当输入的用例，都必须是多元素的
 * ——单元素数组会让"只校了第一个"和"每个都校了"这两件事**看起来一样**。
 */
const REAL_TASKS: StartUserSelectTask[] = [
  {
    id: 'Activity_1qdzbtn',
    name: '业务人员审批',
    approvalMode: 'SEQUENTIAL',
    executionMode: 'SEQUENTIAL',
    minSelectCount: 1,
    maxSelectCount: null,
    selectionOrderRequired: true,
  },
  {
    id: 'Activity_1bkivtw',
    name: '博创内部审批',
    approvalMode: 'OR_SIGN',
    minSelectCount: 1,
    maxSelectCount: null,
    selectionOrderRequired: false,
  },
]

/** 两个节点各选一个人的合法组合 */
const REAL_ASSIGNEES = { Activity_1qdzbtn: [187508], Activity_1bkivtw: [21611] }

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
  const capability = createProductDesignApprovalCapability((requestConfig) =>
    sdk.call(PRODUCT_DESIGN_APPROVAL_FORM_PATH, requestConfig),
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
  const cap = createProductDesignApprovalCapability(
    (requestConfig) => sdk.call(PRODUCT_DESIGN_APPROVAL_FORM_PATH, requestConfig),
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
 * `config.url` 并把 `config.params` 清成 `{}`（实测）。
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

function queryMapOf (config: InternalAxiosRequestConfig | undefined): Record<string, string> {
  return Object.fromEntries(queryOf(config))
}

// ---------------------------------------------------------------------------
// 一、与浏览器基准一致
// ---------------------------------------------------------------------------

describe('产品设计文档审核 —— 读链路与浏览器基准一致', () => {
  it('写死的表单填写值与基准里记的一致（两边不会各自漂移）', () => {
    expect(draft.applicationItem).toBe(baseline.表单填写值.applicationItem)
    expect(draft.applicationContent).toBe(baseline.表单填写值.applicationContent)
  })

  it('基准里确实有那条「审批人节点查询」的 POST，body 不是空的', () => {
    // 这条先兜住基准本身：后面那些逐字节断言全靠它，它要是 undefined 就全变成假绿
    expect(typeof baselineTaskBody).toBe('string')
    expect(baselineTaskBody.length).toBeGreaterThan(0)
    expect(typeof baselinePreviewBody).toBe('string')
    expect(baselinePreviewBody.length).toBeGreaterThan(0)
  })

  it('流程定义请求与基准一致（key 是 hr_product_design_approval）', async () => {
    const { calls, capability } = captureSdk()
    await capability.definition()

    const actual = normalize(String(calls[0]?.url))
    expect(actual).toBe('/admin-api/bpm/process-definition/get?key=hr_product_design_approval&_t=<ts>')
    expect(baselineUrls.has(actual)).toBe(true)
  })

  it('prepare 打的审批人节点接口是 getTemporary… 那个变体，不是 getRequired…', async () => {
    const { calls, capability } = captureSdk()
    await capability.prepare(draft)

    const actual = String(calls[0]?.url)
    expect(normalize(actual)).toBe(
      '/admin-api/hr/product-design-approval/getTemporaryRequiredStartUserSelectTasks',
    )
    expect(actual).not.toContain('/getRequiredStartUserSelectTasks')
  })

  it('prepare 的请求体与基准**逐字节**相同（含键顺序）', async () => {
    const { calls, capability } = captureSdk()
    await capability.prepare(draft)

    expect(JSON.parse(rawBodyOf(calls[0]))).toEqual(JSON.parse(baselineTaskBody))
    // 逐字节：键顺序 applicationItem → applicationContent → attachments → copyUserIds，且没有 id
    expect(rawBodyOf(calls[0])).toBe(baselineTaskBody)
  })

  it('prepare 的请求头与基准同一个集合，且**不发 module-type**', async () => {
    const { calls, capability } = captureSdk()
    await capability.prepare(draft)

    const actual = calls[0]?.headers as unknown as Record<string, string>
    expect(actual['tenant-id']).toBe(baselineTaskHeaders['tenant-id'])
    expect(actual['Accept-Language']).toBe(baselineTaskHeaders['Accept-Language'])
    expect(actual['Accept']).toBe(baselineTaskHeaders['Accept'])
    expect(String(actual['Content-Type'] ?? actual['content-type'])).toContain('application/json')
    expect(Object.keys(actual).sort()).toEqual(Object.keys(baselineTaskHeaders).sort())
    expect(actual).not.toHaveProperty('module-type')
  })

  it('三条页面路径都算不出 module-type（SDK 与浏览器一致：不发这个头）', () => {
    for (const path of [
      PRODUCT_DESIGN_APPROVAL_FORM_PATH,
      PRODUCT_DESIGN_APPROVAL_PAGE_PATH,
      PRODUCT_DESIGN_APPROVAL_MY_LIST_PATH,
    ]) {
      expect(createPortalHeadless({
        baseUrl: 'https://biz-api-test.wodecorp.cn',
        credential: { token: 'tk-test', tenantId: 1 },
      }).resolveModuleType(path).moduleType).toBeNull()
    }
  })

  it('★ 基准记录了页面「无关键字把整个组织拉完」的行为（D6 的由来，045 比 035 更极端）', () => {
    const pulls = baseline.请求.filter((r) => r.u.includes('/system/user/simple-page'))
    expect(pulls.length).toBeGreaterThan(0)
    // 关键：**没有 nickname=**，也就是无关键字
    for (const pull of pulls) expect(pull.u).not.toContain('nickname=')
    expect(pulls[0]?.u).toContain('pageSize=500')

    // ★ 045 的现场：pageNo 从 1 翻到 9（pageSize=500）⇒ 约 4500 人，不是 035 那样的 1 页。
    //   这条是 045 与 035 的**实测差异**，写成断言免得后人拿 035 的"1 页"来理解 045。
    const everyCaptured = (pulls[0] as unknown as { 抓到的每一条?: string[] })?.抓到的每一条 ?? []
    expect(everyCaptured.length).toBeGreaterThan(0)
    for (const url of everyCaptured) {
      expect(url).not.toContain('nickname=')
      expect(url).toContain('pageSize=500')
    }
    const pages = everyCaptured
      .map((url) => Number(/[?&]pageNo=(\d+)/.exec(url)?.[1]))
      .filter((n) => Number.isFinite(n))
    // 去重后的页码必须是完整的 1..9 —— 少一页就说明"整组织拉完"这句话不成立
    expect([...new Set(pages)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
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
    // 不能用 simple-list：那是无关键字全量（045 的源码里写的就是它，但页面实际发的是 simple-page）
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

describe('载荷构造：逐字段复刻 045 的 buildSubmitData()', () => {
  it('键顺序与浏览器相同，且**没有 id 字段**（编辑分支前端已注释）', () => {
    const payload = buildProductDesignApprovalPayload(draft)
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
    expect(() => buildProductDesignApprovalPayload({ ...draft, applicationItem: '' })).toThrow(/申请事项/)
    expect(() => buildProductDesignApprovalPayload({ ...draft, applicationItem: '   ' })).toThrow(/申请事项/)
    expect(() => buildProductDesignApprovalPayload({ ...draft, applicationContent: '' })).toThrow(/申请内容/)
    expect(() =>
      buildProductDesignApprovalPayload({
        ...draft,
        applicationItem: 'x'.repeat(APPLICATION_ITEM_MAX + 1),
      }),
    ).toThrow(new RegExp(`最多 ${APPLICATION_ITEM_MAX}`))
    expect(() =>
      buildProductDesignApprovalPayload({
        ...draft,
        applicationContent: 'x'.repeat(APPLICATION_CONTENT_MAX + 1),
      }),
    ).toThrow(new RegExp(`最多 ${APPLICATION_CONTENT_MAX}`))
    // 边界值是合法的（200 / 500 本身不拦）
    expect(() =>
      buildProductDesignApprovalPayload({
        ...draft,
        applicationItem: 'x'.repeat(APPLICATION_ITEM_MAX),
        applicationContent: 'y'.repeat(APPLICATION_CONTENT_MAX),
      }),
    ).not.toThrow()
  })

  it('附件只保留 url 与 name —— 多给的字段必须被丢掉（页面的 map 就是这么写的）', () => {
    const payload = buildProductDesignApprovalPayload({
      ...draft,
      attachments: [
        { url: 'https://oss.example.com/a.pdf', name: '合同.pdf', id: 999, size: 1234, pages: 3 },
      ],
    })
    expect(payload.attachments).toEqual([{ url: 'https://oss.example.com/a.pdf', name: '合同.pdf' }])
  })

  it('★ 附件是**多件**时逐件保序映射，不是只看第一件', () => {
    // 单元素数组在这里会假绿：[0] 与 [last] 同值，"只映射了第一件"和"逐件映射"看不出区别
    const input = [
      { url: 'https://oss.example.com/a.pdf', name: 'A文档.pdf', id: 1, size: 10, pages: 2 },
      { url: 'https://oss.example.com/b.docx', name: 'B文档.docx', id: 2, size: 20, pages: 5 },
      { url: 'https://oss.example.com/c.pptx', name: '方案.pptx', id: 3, size: 30, pages: 9 },
    ]
    const payload = buildProductDesignApprovalPayload({ ...draft, attachments: input })
    expect(payload.attachments).toEqual([
      { url: 'https://oss.example.com/a.pdf', name: 'A文档.pdf' },
      { url: 'https://oss.example.com/b.docx', name: 'B文档.docx' },
      { url: 'https://oss.example.com/c.pptx', name: '方案.pptx' },
    ])
    // 顺序也要对：把顺序反过来必须是另一个结果，否则"保序"这条没被测到
    const reversed = buildProductDesignApprovalPayload({
      ...draft,
      attachments: [...input].reverse(),
    })
    expect(reversed.attachments).not.toEqual(payload.attachments)
    expect((reversed.attachments as Array<{ name: string }>)[0]?.name).toBe('方案.pptx')
  })

  it('附件超过 10 件被拦（页面 :maxCount=10）', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      url: `https://oss.example.com/${i}.pdf`,
      name: `${i}.pdf`,
    }))
    expect(() => buildProductDesignApprovalPayload({ ...draft, attachments: many })).toThrow(/最多 10 件/)
    expect(() => buildProductDesignApprovalPayload({ ...draft, attachments: many.slice(0, 10) })).not.toThrow()
    // 10 件时**每一件都在**（不是只留了第一件）
    const ten = buildProductDesignApprovalPayload({ ...draft, attachments: many.slice(0, 10) })
    expect((ten.attachments as unknown[]).length).toBe(10)
  })

  it('附件的扩展名按表单的 accept 白名单拦（.zip / .txt 进不来，无扩展名放行）', () => {
    for (const name of ['a.zip', 'a.txt', 'a.exe']) {
      expect(() =>
        buildProductDesignApprovalPayload({
          ...draft,
          attachments: [{ url: `https://oss.example.com/${name}`, name }],
        }),
      ).toThrow(/accept 白名单/)
    }
    // 白名单里的就是放行的；大小写不敏感。**逐个扩展名都试**，不是只试一个就下结论
    for (const ext of ATTACHMENT_ACCEPT_EXTENSIONS) {
      expect(() =>
        buildProductDesignApprovalPayload({
          ...draft,
          attachments: [{ url: `https://oss.example.com/a.${ext}`, name: `a.${ext}` }],
        }),
      ).not.toThrow()
    }
    expect(() =>
      buildProductDesignApprovalPayload({
        ...draft,
        attachments: [{ url: 'https://oss.example.com/a.XLSX', name: '台账.XLSX' }],
      }),
    ).not.toThrow()
    // 没有扩展名时放行（页面上传的文件未必都带名字）
    expect(() =>
      buildProductDesignApprovalPayload({
        ...draft,
        attachments: [{ url: 'https://oss.example.com/a', name: '没有扩展名' }],
      }),
    ).not.toThrow()
    // ⚠️ 名字**以点结尾**也是"没有扩展名"（源判据是 `dot > -1 && dot < name.length - 1`）。
    // 少了后半句的话 `文件名.` 会被当成扩展名是空串而拦下来 —— 这条用例就是锁后半句的。
    expect(() =>
      buildProductDesignApprovalPayload({
        ...draft,
        attachments: [{ url: 'https://oss.example.com/a', name: '没有扩展名.' }],
      }),
    ).not.toThrow()
    // ⚠️ 同名反例：`a.pdf.zip` 的**最后一段**是 zip ⇒ 必须被拦（别被第一个点骗过去）
    expect(() =>
      buildProductDesignApprovalPayload({
        ...draft,
        attachments: [{ url: 'https://oss.example.com/a.pdf.zip', name: 'a.pdf.zip' }],
      }),
    ).toThrow(/accept 白名单/)
  })

  it('附件缺 url 被拦（url 得先用 base-upload-file 传上去）', () => {
    expect(() =>
      buildProductDesignApprovalPayload({ ...draft, attachments: [{ url: '', name: 'a.pdf' }] }),
    ).toThrow(/base-upload-file/)
  })

  it('★ 附件数组里**不是第一件**的那件缺 url 也要被拦（错误信息指向它那一件）', () => {
    // 单元素数组测不出这个：循环只跑了 index 0
    expect(() =>
      buildProductDesignApprovalPayload({
        ...draft,
        attachments: [
          { url: 'https://oss.example.com/a.pdf', name: 'a.pdf' },
          { url: 'https://oss.example.com/b.pdf', name: 'b.pdf' },
          { url: '   ', name: 'c.pdf' },
        ],
      }),
    ).toThrow(/第 3 件附件缺 url/)
  })

  it('抄送人归一成数字数组；缺省是空数组', () => {
    expect(buildProductDesignApprovalPayload(draft).copyUserIds).toEqual([])
    expect(buildProductDesignApprovalPayload({ ...draft, copyUserIds: [3, 7] }).copyUserIds).toEqual([3, 7])
    expect(() =>
      buildProductDesignApprovalPayload({ ...draft, copyUserIds: ['x' as unknown as number] }),
    ).toThrow(/不是数字/)
  })

  it('★ 抄送人是**多个**时保序，且非第一位的坏值也要被拦', () => {
    // 多元素：既测保序，也测"每个都校了"
    expect(buildProductDesignApprovalPayload({ ...draft, copyUserIds: [11, 22, 33] }).copyUserIds).toEqual([
      11, 22, 33,
    ])
    expect(
      buildProductDesignApprovalPayload({
        ...draft,
        copyUserIds: [11, 22, 33],
      }).copyUserIds,
    ).not.toEqual([33, 22, 11])
    // 坏值在**第 3 位**：只看第一个的话这条不会红
    expect(() =>
      buildProductDesignApprovalPayload({
        ...draft,
        copyUserIds: [11, 22, 'bad' as unknown as number],
      }),
    ).toThrow(/copyUserIds\[2\]/)
  })

  it('create 的 body = 基准 body + startUserSelectAssignees，且它**排在最后**', () => {
    const body = buildProductDesignApprovalCreatePayload(draft, REAL_ASSIGNEES)
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
      startUserSelectAssignees: REAL_ASSIGNEES,
    })
    // ★ 两个节点**都在**（只有一个的话"整份传过去"与"只传了第一个"就分不出来）
    expect(Object.keys(JSON.parse(text).startUserSelectAssignees)).toEqual([
      'Activity_1qdzbtn',
      'Activity_1bkivtw',
    ])
  })
})

// ---------------------------------------------------------------------------
// 三之二、审批链预览（045 比 035 多做的那一条）
// ---------------------------------------------------------------------------

describe('preview：逐字段复刻页面「查看审批流程」发出的那条 POST', () => {
  it('请求体与基准**逐字节**相同（含 variables 里嵌的那份 buildSubmitData）', () => {
    const body = buildProductDesignApprovalPreviewPayload(draft)
    expect(JSON.stringify(body)).toBe(baselinePreviewBody)
    expect(Object.keys(body)).toEqual([
      'processDefinitionKey',
      'variables',
      'startUserSelectAssignees',
      'copyUserIds',
    ])
    // variables 就是 buildSubmitData 的产物，逐字节等于 create 的那份载荷
    expect(JSON.stringify((body as { variables: unknown }).variables)).toBe(baselineTaskBody)
    // 顶层那个 copyUserIds 与 variables 里的是**同一个值**（页面就是这么摊的，照抄不合并不省略）
    expect((body as { copyUserIds: unknown }).copyUserIds).toEqual([])
  })

  it('打了 preview 接口，方法 POST，且 payload 里 processDefinitionKey 是本流程', async () => {
    const { calls, capability } = captureSdk()
    await capability.preview(draft)

    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/bpm/process-instance/preview')
    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(JSON.parse(rawBodyOf(calls[0])).processDefinitionKey).toBe(PRODUCT_DESIGN_APPROVAL_PROCESS_KEY)
  })

  it('★ 给了两个节点的 assignees 时两处都带上（顶层与 variables 之外各一份）', async () => {
    const { calls, capability } = captureSdk()
    await capability.preview(draft, REAL_ASSIGNEES)

    const body = JSON.parse(rawBodyOf(calls[0]))
    expect(body.startUserSelectAssignees).toEqual(REAL_ASSIGNEES)
    expect(Object.keys(body.startUserSelectAssignees)).toHaveLength(2)
  })

  it('顶层 copyUserIds 跟着 draft 走（不是写死的空数组）', async () => {
    const { calls, capability } = captureSdk()
    await capability.preview({ ...draft, copyUserIds: [5, 6] })

    const body = JSON.parse(rawBodyOf(calls[0]))
    expect(body.copyUserIds).toEqual([5, 6])
    expect(body.variables.copyUserIds).toEqual([5, 6])
  })

  it('非数字的 assignees 在本地就被拦，不发请求', async () => {
    const { calls, capability } = captureSdk()
    await expect(
      capability.preview(draft, { Activity_1qdzbtn: ['x' as unknown as number] }),
    ).rejects.toThrow(/非数字/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 四、prepare 的前置
// ---------------------------------------------------------------------------

describe('prepare 的前置：两个必填字段都填了才去问审批人节点', () => {
  it('字段不全时不发请求，直接拒绝（045 上这一步由 antd 表单校验承担）', async () => {
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

  it('★ 后端返回**两个**节点时，两个都原样透传（不是只取第一个）', async () => {
    const { cap } = captureSdkReturning(REAL_TASKS)
    const result = await cap.prepare(draft)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.map((t) => t.id)).toEqual(['Activity_1qdzbtn', 'Activity_1bkivtw'])
    expect(result.tasks.map((t) => t.name)).toEqual(['业务人员审批', '博创内部审批'])
    // 两个节点的 approvalMode 不同这件事也要留住（后面 OR_SIGN 与 SEQUENTIAL 的差别会被用到）
    expect(result.tasks.map((t) => t.approvalMode)).toEqual(['SEQUENTIAL', 'OR_SIGN'])
  })
})

// ---------------------------------------------------------------------------
// 五、审批人节点：后端那四条规则
// ---------------------------------------------------------------------------

describe('assertAssigneesForTasks：复刻后端 validateStartUserSelectAssignees', () => {
  it('两个节点各选一个人时能过', () => {
    expect(() => assertAssigneesForTasks(REAL_TASKS, REAL_ASSIGNEES)).not.toThrow()
  })

  it('★ 只填了**其中一个**节点 → 红（后端对每个 START_USER_SELECT 节点都校）', () => {
    // 这条是本流程与 035 最要紧的差别：035 只有一个节点，这里有两个，
    // 「只填一个」在 035 上根本构造不出来，在 045 上是必然失败的一种输入。
    expect(() =>
      assertAssigneesForTasks(REAL_TASKS, { Activity_1qdzbtn: [187508] }),
    ).toThrow(/博创内部审批.*没有选人/)
    expect(() =>
      assertAssigneesForTasks(REAL_TASKS, { Activity_1bkivtw: [21611] }),
    ).toThrow(/业务人员审批.*没有选人/)
  })

  it('少了必选节点 → 红（后端 ASSIGNEES_NOT_CONFIG）', () => {
    expect(() => assertAssigneesForTasks(REAL_TASKS, {})).toThrow(/没有选人/)
    expect(() =>
      assertAssigneesForTasks(REAL_TASKS, { Activity_1qdzbtn: [], Activity_1bkivtw: [] }),
    ).toThrow(/没有选人/)
    expect(() => assertAssigneesForTasks(REAL_TASKS, { Other_Task: [1] })).toThrow(/没有选人/)
  })

  it('★ 重复的人落在**第二个**节点上也要红（不是只看第一个节点）', () => {
    expect(() =>
      assertAssigneesForTasks(REAL_TASKS, { Activity_1qdzbtn: [1], Activity_1bkivtw: [2, 2] }),
    ).toThrow(/博创内部审批.*重复的人/)
  })

  it('数量越界 → 红（后端 ASSIGNEES_COUNT_INVALID）', () => {
    const tasks: StartUserSelectTask[] = [
      { id: 'T1', name: '节点一', minSelectCount: 2, maxSelectCount: 3 },
      { id: 'T2', name: '节点二', minSelectCount: 1, maxSelectCount: 1 },
    ]
    // 只越第一个界
    expect(() => assertAssigneesForTasks(tasks, { T1: [1], T2: [9] })).toThrow(/节点一.*至少要选 2 个人/)
    // 只越第二个界（max）
    expect(() => assertAssigneesForTasks(tasks, { T1: [1, 2, 3], T2: [8, 9] })).toThrow(/节点二.*最多选 1 个人/)
    // 两个都合法
    expect(() => assertAssigneesForTasks(tasks, { T1: [1, 2, 3], T2: [9] })).not.toThrow()
  })

  it('空值 / 非数字 → 红（后端 ASSIGNEE_ID_NULL）', () => {
    expect(() =>
      assertAssigneesForTasks(REAL_TASKS, { Activity_1qdzbtn: [187508], Activity_1bkivtw: [null as unknown as number] }),
    ).toThrow(/博创内部审批.*空值或非数字/)
  })

  it('没有节点（会议室那种流程）时不拦任何东西', () => {
    expect(() => assertAssigneesForTasks([], {})).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 六、提交
// ---------------------------------------------------------------------------

describe('submit：写操作（会真的起流程、推真人待办）', () => {
  it('打的是 /hr/product-design-approval/create，方法 POST', async () => {
    const { calls, capability } = captureSdk()
    await capability.submit(draft, REAL_ASSIGNEES)

    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/hr/product-design-approval/create')
    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(String(calls[0]?.url)).not.toContain('_t=')
  })

  it('body 是基准 body + assignees，assignees 排在最后且两个节点都在', async () => {
    const { calls, capability } = captureSdk()
    await capability.submit(draft, REAL_ASSIGNEES)

    expect(rawBodyOf(calls[0])).toBe(
      `${baselineTaskBody.slice(0, -1)},"startUserSelectAssignees":` +
        '{"Activity_1qdzbtn":[187508],"Activity_1bkivtw":[21611]}}',
    )
  })

  it('assignees 的值被归一成数字（字符串 id 也收），且**两个节点都归一**', async () => {
    const { calls, capability } = captureSdk()
    await capability.submit(draft, {
      Activity_1qdzbtn: ['187508' as unknown as number],
      Activity_1bkivtw: ['21611' as unknown as number],
    })
    expect(JSON.parse(rawBodyOf(calls[0])).startUserSelectAssignees).toEqual({
      Activity_1qdzbtn: [187508],
      Activity_1bkivtw: [21611],
    })
  })

  it('本地校验失败时**一个请求都不发**（省下一次必然失败的写请求）', async () => {
    const { calls, capability } = captureSdk()
    await expect(capability.submit({ ...draft, applicationItem: '' }, {})).rejects.toThrow(/申请事项/)
    await expect(
      capability.submit(draft, { Activity_1qdzbtn: ['not-a-number' as unknown as number] }),
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
  it('detail 打 /hr/product-design-approval/get?id=', async () => {
    const { calls, capability } = captureSdk()
    await capability.detail(51)
    expect(normalize(String(calls[0]?.url))).toBe(
      '/admin-api/hr/product-design-approval/get?id=51&_t=<ts>',
    )
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
  })

  it('myInstances 的参数与页面一致（order/orderField/name/title/category 空值也发）', async () => {
    const { calls, capability } = captureSdk()
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

  it('status / processType 只在给了的时候才发（页面空着时不发）', async () => {
    const { calls, capability } = captureSdk()
    await capability.myInstances({ status: 1, processType: PRODUCT_DESIGN_APPROVAL_PROCESS_TYPE })
    expect(queryMapOf(calls[0]).status).toBe('1')
    expect(queryMapOf(calls[0]).processType).toBe('2')

    await capability.myInstances()
    expect(queryMapOf(calls[1])).not.toHaveProperty('status')
    expect(queryMapOf(calls[1])).not.toHaveProperty('processType')
  })

  it('★ findInstanceByBusinessKey 在三家 businessKey 撞车时认准自己那一条', async () => {
    // 三张业务表主键各自从 1 开始 ⇒ 51 这个 businessKey 一定同时属于三条流程。
    // 多行 + 三个不同 processDefinitionKey：只有一行的用例测不出"按 key 认"。
    const rows: ProcessInstanceRow[] = [
      { id: 'meeting-51', businessKey: '51', processDefinitionKey: 'meeting_application' },
      { id: 'ga-51', businessKey: '51', processDefinitionKey: 'hr_general_approval' },
      { id: 'pda-51', businessKey: '51', processDefinitionKey: PRODUCT_DESIGN_APPROVAL_PROCESS_KEY },
      { id: 'pda-77', businessKey: '77', processDefinitionKey: PRODUCT_DESIGN_APPROVAL_PROCESS_KEY },
    ]
    const { cap } = captureSdkReturning({ list: rows, total: rows.length })

    // 51 那条**必须**认成 pda-51，不能认成会议室或通用审批的
    expect((await cap.findInstanceByBusinessKey(51)).id).toBe('pda-51')
    expect((await cap.findInstanceByBusinessKey('77')).id).toBe('pda-77')
    // 一个不存在于本流程的 businessKey 必须抛错，**不能"顺手返回同 businessKey 的别人那条"**
    await expect(cap.findInstanceByBusinessKey(999)).rejects.toThrow(/也没找到/)
  })

  it('★ 第一页就取完了（不满一页）时**只发一次请求**，不接着翻', async () => {
    // 「本页不满 ⇒ 后面没有了 ⇒ 停」这条是 `if (list.length < scanPageSize) break`。
    // 少了它，找到一个不存在于本流程的 businessKey 会把 5 页全翻完（5 倍请求量）。
    let calls = 0
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      calls += 1
      return {
        data: {
          ret: 'SUCCESS',
          code: 0,
          msg: '',
          // 只有 3 条，明显不满一页（默认 scanPageSize=50）
          data: {
            list: [
              { id: 'a', businessKey: '1', processDefinitionKey: PRODUCT_DESIGN_APPROVAL_PROCESS_KEY },
              { id: 'b', businessKey: '2', processDefinitionKey: PRODUCT_DESIGN_APPROVAL_PROCESS_KEY },
              { id: 'c', businessKey: '3', processDefinitionKey: PRODUCT_DESIGN_APPROVAL_PROCESS_KEY },
            ],
            total: 3,
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const cap = createProductDesignApprovalCapability((requestConfig) =>
      sdk.call(PRODUCT_DESIGN_APPROVAL_FORM_PATH, requestConfig),
    )
    await expect(cap.findInstanceByBusinessKey(999)).rejects.toThrow(/也没找到/)
    expect(calls).toBe(1)
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
          data: {
            list: [
              { id: `x-${page}-a`, businessKey: '1' },
              { id: `x-${page}-b`, businessKey: '2' },
            ],
            total: 999,
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const cap = createProductDesignApprovalCapability(
      (requestConfig) => sdk.call(PRODUCT_DESIGN_APPROVAL_FORM_PATH, requestConfig),
      { maxScanPages: 2, scanPageSize: 2 },
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
                list: [
                  // 先放一条**同 businessKey 的别的流程**：换 id 那一步不能认错它
                  { id: 'meeting-77', businessKey: '77', processDefinitionKey: 'meeting_application' },
                  { id: 'pda-77', businessKey: '77', processDefinitionKey: PRODUCT_DESIGN_APPROVAL_PROCESS_KEY },
                ],
                total: 2,
              }
            : true,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const cap = createProductDesignApprovalCapability((requestConfig) =>
      sdk.call(PRODUCT_DESIGN_APPROVAL_FORM_PATH, requestConfig),
    )

    await cap.cancel({ businessKey: 77, reason: 'SDK-TEST 撤销' })

    expect(calls).toHaveLength(2)
    expect(String(calls[0]?.url)).toContain('/bpm/process-instance/my-page')
    // ★ 用的是 pda-77，**不是** meeting-77
    expect(rawBodyOf(calls[1])).toBe('{"id":"pda-77","reason":"SDK-TEST 撤销"}')
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
    // 真实碰到过：审批人选了自己 ⇒ 后端「发起人与审批人相同自动通过」直接把流程走完 ⇒ cancel 报这句。
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
    const cap = createProductDesignApprovalCapability((requestConfig) =>
      sdk.call(PRODUCT_DESIGN_APPROVAL_FORM_PATH, requestConfig),
    )

    await expect(
      cap.cancel({ processInstanceId: 'inst-1', reason: '撤销' }),
    ).rejects.toThrow(/流程不处于运行中/)
    expect(calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 九、能力定义本身
// ---------------------------------------------------------------------------

describe('能力定义', () => {
  it('八条能力，id 不重复，写能力恰好两条（submit / cancel）', () => {
    const ids = productDesignApprovalCapabilities.map((c) => c.id)
    expect(ids).toEqual([
      'product-design-approval-definition',
      'product-design-approval-user-search',
      'product-design-approval-prepare',
      'product-design-approval-preview',
      'product-design-approval-submit',
      'product-design-approval-detail',
      'product-design-approval-my-instances',
      'product-design-approval-cancel',
    ])
    expect(new Set(ids).size).toBe(ids.length)
    expect(productDesignApprovalCapabilities.filter((c) => c.write).map((c) => c.id)).toEqual([
      'product-design-approval-submit',
      'product-design-approval-cancel',
    ])
    // preview 是只读的（后端那条只算审批链、不落库）—— 它写进 write: true 会让调用方白白犹豫
    expect(productDesignApprovalCapabilities.find((c) => c.id === 'product-design-approval-preview')?.write)
      .toBe(false)
  })

  it('★ 每条能力内部 params 的 name 不重复（OpenAPI operation-parameters-unique 会拦）', () => {
    // 前一轮有一条能力声明了 5 个同名参数，被 redocly 的 operation-parameters-unique 拦下。
    for (const capability of productDesignApprovalCapabilities) {
      const names = capability.params.map((p) => p.name)
      expect(new Set(names).size, `${capability.id} 的 params 里有重名：${names.join(', ')}`).toBe(names.length)
    }
  })

  it('pagePath 只落在流程页面与「我的流程」上 —— **绝不能用「发起流程」那条路径**', () => {
    const paths = new Set(productDesignApprovalCapabilities.map((c) => c.pagePath))
    expect(paths).toEqual(
      new Set([
        PRODUCT_DESIGN_APPROVAL_PAGE_PATH,
        PRODUCT_DESIGN_APPROVAL_FORM_PATH,
        PRODUCT_DESIGN_APPROVAL_MY_LIST_PATH,
      ]),
    )
    // /dashboard/flow/task/create/list 在 page-catalog 里，挂上去会把那个页面错误地标成已完成
    for (const c of productDesignApprovalCapabilities) {
      expect(c.pagePath).not.toBe('/dashboard/flow/task/create/list')
    }
  })

  it('长选项参数都登记了 lookup（否则调用方只能靠猜）', () => {
    for (const id of [
      'product-design-approval-submit',
      'product-design-approval-prepare',
      'product-design-approval-preview',
    ]) {
      const capability = productDesignApprovalCapabilities.find((c) => c.id === id)
      const param = capability?.params.find((p) => p.name === 'copyUserIds')
      expect(param?.lookup, `${id} 的 copyUserIds 没有 lookup`).toEqual({
        capabilityId: 'product-design-approval-user-search',
        keywordParam: 'keyword',
      })
    }
    for (const id of ['product-design-approval-submit', 'product-design-approval-preview']) {
      const capability = productDesignApprovalCapabilities.find((c) => c.id === id)
      const param = capability?.params.find((p) => p.name === 'startUserSelectAssignees')
      expect(param?.lookup, `${id} 的 startUserSelectAssignees 没有 lookup`).toEqual({
        capabilityId: 'product-design-approval-user-search',
        keywordParam: 'keyword',
      })
    }
  })

  it('流程 key / 类型 / 表单路径常量与浏览器入口 URL 与实测一致', () => {
    expect(PRODUCT_DESIGN_APPROVAL_PROCESS_KEY).toBe('hr_product_design_approval')
    expect(PRODUCT_DESIGN_APPROVAL_FORM_PATH).toBe('/simple/hr/form/045')
    expect(baseline.入口).toContain(`processDefinitionKey=${PRODUCT_DESIGN_APPROVAL_PROCESS_KEY}`)
    expect(baseline.入口).toContain('formCustomCreatePath=simple/hr/form/045')
  })

  it('★ processType 钉死是 2（审批）—— 派单里说它属「审核（1）」,实测不是', () => {
    // 这条是**刻意钉住的一个纠正**。照抄「审核类」会把 my-instances 的筛选参数写成 1，
    // 调用方就筛不到自己的单据。基准里的入口 URL 与 prepare 的响应都佐证它走的是审批那条链。
    expect(PRODUCT_DESIGN_APPROVAL_PROCESS_TYPE).toBe(2)
    const myInstances = productDesignApprovalCapabilities.find(
      (c) => c.id === 'product-design-approval-my-instances',
    )
    const param = myInstances?.params.find((p) => p.name === 'processType')
    expect(param?.options).toEqual([
      { label: '审核', value: 1 },
      { label: '审批', value: 2 },
    ])
    expect(param?.description).toMatch(/实测是 2/)
  })

  it('★ 一个节点 id 都没写死（045 的节点与 035 不同，是每个流程各自画的）', () => {
    // 把整份能力定义 + 本文件已知的两个真实节点 id 对一遍：定义里不能出现它们。
    // 写死节点 id 会让能力在流程改版后**静默**打到一个不存在的节点上。
    const dump = JSON.stringify(productDesignApprovalCapabilities)
    expect(dump).not.toContain('Activity_1qdzbtn')
    expect(dump).not.toContain('Activity_1bkivtw')
    // 连 035 的那个也不能出现（照抄 035 的典型症状）
    expect(dump).not.toContain('Activity_1o1sabd')
  })
})
