import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/session/types.js'

import {
  buildFlowTaskCopyTimeRange,
  buildFlowTaskTimeRange,
  createFlowTaskCapability,
  describeProcessDefinitionError,
  flowTaskCapabilities,
  FLOW_TASK_COPY_PAGE_PATH,
  FLOW_TASK_CREATE_PAGE_PATH,
  FLOW_TASK_DONE_PAGE_PATH,
  FLOW_TASK_MY_LIST_PATH,
  FLOW_TASK_MY_PAGE_PATH,
  FLOW_TASK_MY_PERMISSION,
  FLOW_TASK_TODO_PAGE_PATH,
  isUsableProcessDefinition,
} from '../src/capabilities/flow-task.js'
import {
  buildAiReviewConfigTimeRange,
  buildFlowManageDayRange,
  createFlowManageCapability,
  flowManageCapabilities,
  FLOW_MANAGE_AI_REVIEW_PAGE_PATH,
  FLOW_MANAGE_INSTANCE_PAGE_PATH,
  FLOW_MANAGE_MODEL_PAGE_PATH,
  FLOW_MANAGE_MODEL_DELETE_PATH,
  FLOW_MANAGE_MODEL_DEPLOY_PATH,
  FLOW_MANAGE_MODEL_RULE_CREATE_PATH,
  FLOW_MANAGE_MODEL_UPDATE_PATH,
  FLOW_MANAGE_TASK_PAGE_PATH,
  FLOW_MANAGE_METHODS,
} from '../src/capabilities/flow-manage.js'
import { createPortalHeadless } from '../src/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; httpInstance?: string }

const here = dirname(fileURLToPath(import.meta.url))
const load = (name: string): Baseline =>
  JSON.parse(readFileSync(join(here, `../baseline/${name}`), 'utf8'))

type BaselineRequest = {
  页面: string
  pagePath: string
  via?: string
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
}
type Baseline = { requests: BaselineRequest[] }

const FLOW = load('flow-management.browser.json')

/** 按页面 + URL 特征取基准里的那一条 */
function reqOf (baseline: Baseline, pagePath: string, match: RegExp): BaselineRequest {
  const hit = baseline.requests.find((r) => r.pagePath === pagePath && match.test(r.url))
  if (!hit) throw new Error(`基准里找不到 ${pagePath} 的 ${match}`)
  return hit
}

/** 拆成有序的 [key, value] 列表：键顺序的差异也要能被发现（D20） */
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

/** 去掉 host 与时间戳，只留下「路径 + 有序参数」用于整体比对 */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

/**
 * 每个页面一个 `request`（与门面的接法一致）：记录 `call` 收到的配置，
 * 这样既能比 URL 的有序参数，也能看出请求级声明（`module-type` / `httpInstance`）。
 */
function makeSdk () {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const at = (pagePath: string, extra: Record<string, unknown> = {}): PortalRequest =>
    <T,>(config: unknown) => sdk.call<T>(pagePath, { ...(config as object), ...extra } as never)
  return { sdk, calls, at }
}

/** 五页的请求上下文按「页面」分别注入，与门面一致（约定第 1 / 29 条） */
function buildFlowTask () {
  const { calls, at } = makeSdk()
  const cap = createFlowTaskCapability(
    at(FLOW_TASK_CREATE_PAGE_PATH),
    at(FLOW_TASK_TODO_PAGE_PATH),
    at(FLOW_TASK_DONE_PAGE_PATH),
    at(FLOW_TASK_COPY_PAGE_PATH),
    at(FLOW_TASK_MY_PAGE_PATH),
  )
  return { calls, cap }
}

function buildFlowManage () {
  const { calls, at } = makeSdk()
  const cap = createFlowManageCapability(
    at(FLOW_MANAGE_MODEL_PAGE_PATH),
    at(FLOW_MANAGE_AI_REVIEW_PAGE_PATH),
    at(FLOW_MANAGE_INSTANCE_PAGE_PATH),
    at(FLOW_MANAGE_TASK_PAGE_PATH),
  )
  return { calls, cap }
}

// ---------------------------------------------------------------------------
// 发起流程（不是列表页）
// ---------------------------------------------------------------------------

describe('发起流程 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时的 URL 与基准完全相同（含键顺序）', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listDefinitions()
    const base = reqOf(FLOW, FLOW_TASK_CREATE_PAGE_PATH, /process-definition\/create-list/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
  })

  it('这一页不是列表页：没有 order / orderField / pageNo / pageSize', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listDefinitions()
    const keys = queryPairs(String(calls[0]?.url)).map(([k]) => k)
    expect(keys).toEqual(['suspensionState', 'processType', '_t'])
  })

  it('两个 processType 都要能拉（实测 1=审核 25 个、2=审批 57 个）', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listDefinitions()
    await cap.listDefinitions({ processType: 2 })
    expect(String(calls[0]?.url)).toContain('processType=1')
    expect(String(calls[1]?.url)).toContain('processType=2')
  })

  it('suspensionState 钉死为 1，调用方改不了', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listDefinitions({ suspensionState: 0 } as never)
    expect(String(calls[0]?.url)).toContain('suspensionState=1')
    expect(String(calls[0]?.url)).not.toContain('suspensionState=0')
  })

  it('isUsableProcessDefinition 复刻页面那四条判据（实测 82 个全可用）', () => {
    expect(
      isUsableProcessDefinition({
        baseUrl: 'portal',
        formType: 20,
        formCustomCreatePath: 'simple/hr/form/005',
      }),
    ).toBe(true)
    // 四条判据逐条反着来一次
    expect(
      isUsableProcessDefinition({
        baseUrl: 'dhr',
        formType: 20,
        formCustomCreatePath: 'simple/hr/form/005',
      }),
    ).toBe(false)
    expect(
      isUsableProcessDefinition({
        baseUrl: 'portal',
        formType: 19,
        formCustomCreatePath: 'simple/hr/form/005',
      }),
    ).toBe(false)
    expect(
      isUsableProcessDefinition({ baseUrl: 'portal', formType: 20, formCustomCreatePath: '' }),
    ).toBe(false)
    expect(
      isUsableProcessDefinition({
        baseUrl: 'portal',
        formType: 20,
        formCustomCreatePath: 'hr/form/005',
      }),
    ).toBe(false)
  })

  it('describeProcessDefinitionError 的文案与页面的 tooltip 一致', () => {
    expect(describeProcessDefinitionError({} as never)).toBe('项目错误、类型错误、空地址')
    expect(
      describeProcessDefinitionError({
        baseUrl: 'portal',
        formType: 20,
        formCustomCreatePath: 'hr/form/005',
      }),
    ).toBe('地址错误')
    // 可用的卡片**不给文案**（页面上就是没有 tooltip）
    expect(
      describeProcessDefinitionError({
        baseUrl: 'portal',
        formType: 20,
        formCustomCreatePath: 'simple/hr/form/005',
      }),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 待办任务 / 已办任务（同一个组件、同一个接口，两个钉死值）
// ---------------------------------------------------------------------------

describe('待办任务 / 已办任务 —— 与浏览器基准逐字段一致（D20）', () => {
  it('待办任务：无筛选时的 URL 与基准逐字节相同（含键顺序）', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listTodo()
    const base = reqOf(FLOW, FLOW_TASK_TODO_PAGE_PATH, /list-by-category-web/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
  })

  /**
   * 这一条有过一段**已知分歧**的历史，别把它当普通用例看：
   *
   * - 初版基准（八页在同一次 SPA 会话里按 create → todo → done → copy 顺序抓）里，
   *   标着 `/dashboard/flow/task/done/list` 的那条发的是 **`finished=1`**，
   *   且与它前一条「待办任务」**逐字节相同**。
   * - 当时判定那是**采集侧的状态泄漏**而不是这一页的契约：两页共用的组件在非 setup 的
   *   `<script>` 里有模块级 `let stateCache = null`（`backlog/task-examine/list.vue:130`），
   *   `onBeforeUnmount` 存整个 `formState`（含 `finished`）、下次 setup `Object.assign` 覆盖回来
   *   （`:259-274`）——**不按路由分**，于是先访问的待办把 `finished=1` 漏给了后访问的已办。
   *   期间用例把这条分歧钉住了（同时断言"基准是 1"与"能力发 2"）。
   * - **2026-09-21 复核定案**：新会话**直接打开** `#/dashboard/flow/task/done/list`（不经过待办页），
   *   发的是 `finished=2` —— 泄漏判断成立，能力保持 2 是对的。基准已按新会话重抓修正，
   *   该行标注为「已办任务（新会话直开）」。
   *
   * ⇒ 所以下面就是与另外七页同形的普通逐字段一致断言。
   * **顺带的方法学结论**（比这一页本身更值钱）：`install-hook.js` 装在 SPA 里、跨 hash 导航不卸载，
   * **同域多页要么每页新会话、要么按顺序复核**，否则先访问的页面会把模块级状态漏给后访问的。
   */
  it('已办任务：无筛选时的 URL 与基准逐字节相同（含键顺序）', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listDone()
    const base = reqOf(FLOW, FLOW_TASK_DONE_PAGE_PATH, /list-by-category-web/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    // 基准这一条是「新会话直开」抓的，`finished` 必须是 2（不是被待办页漏过来的 1）
    expect(queryPairs(base.url).find(([k]) => k === 'finished')).toEqual(['finished', '2'])
  })

  it('两页的 finished 都由能力钉死，调用方改不了', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listTodo({ finished: 9 } as never)
    await cap.listDone({ finished: 9 } as never)
    expect(String(calls[0]?.url)).toContain('finished=1')
    expect(String(calls[1]?.url)).toContain('finished=2')
    expect(String(calls[0]?.url)).not.toContain('finished=9')
    expect(String(calls[1]?.url)).not.toContain('finished=9')
  })

  it('selectType：已办那一页开放（页面上有控件）、待办那一页钉死为 1（`v-if` 拿不到）', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listTodo()
    await cap.listTodo({ selectType: 2 } as never)
    await cap.listDone()
    await cap.listDone({ selectType: 2 })
    expect(String(calls[0]?.url)).toContain('selectType=1')
    // 待办页写了 2 也不进 URL —— 用户在那一页上到不了这个状态
    expect(String(calls[1]?.url)).toContain('selectType=1')
    expect(String(calls[1]?.url)).not.toContain('selectType=2')
    // 已办页是真实可见的控件，所以开放
    expect(String(calls[2]?.url)).toContain('selectType=1')
    expect(String(calls[3]?.url)).toContain('selectType=2')
  })

  it('createTime 区间：**没有 +1 天**，字面两端；数组按 qs 的 indices 序列化', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listTodo(
      buildFlowTaskTimeRange('2026-09-01 00:00:00', '2026-09-10 23:59:59'),
    )
    const url = String(calls[0]?.url)
    expect(url).toContain('createTime%5B0%5D=2026-09-01%2000%3A00%3A00')
    expect(url).toContain('createTime%5B1%5D=2026-09-10%2023%3A59%3A59')
    // 结束时刻就是字面值 —— 不是次日零点（那是 study-lesson 的写法）
    expect(url).not.toContain('2026-09-11')
    // 不带区间时这个键整个不出现（空数组被 qs 丢掉）
    const { calls: c2, cap: cap2 } = buildFlowTask()
    await cap2.listTodo()
    expect(queryPairs(String(c2[0]?.url)).map(([k]) => k)).not.toContain('createTime[0]')
  })

  it('区间单边给要 reject（且是 Promise.reject，不是同步抛）', async () => {
    const { calls, cap } = buildFlowTask()
    const p = cap.listTodo({ createTimeStart: '2026-09-01 00:00:00' })
    expect(p).toBeInstanceOf(Promise)
    await expect(p).rejects.toThrow(/成对给/)
    expect(calls).toHaveLength(0)
  })

  it('区间格式不是 YYYY-MM-DD HH:mm:ss 要 reject（date-only 也不行）', async () => {
    const { calls, cap } = buildFlowTask()
    await expect(
      cap.listDone({ createTimeStart: '2026-09-01', createTimeEnd: '2026-09-10' }),
    ).rejects.toThrow(/YYYY-MM-DD HH:mm:ss/)
    expect(calls).toHaveLength(0)
  })

  it('processCategory 默认**不发**（null 被 qs 的 skipNulls 丢掉），给了才出现在原位', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listTodo()
    expect(queryPairs(String(calls[0]?.url)).map(([k]) => k)).not.toContain('processCategory')
    await cap.listTodo({ processCategory: 'human_process' })
    const pairs = queryPairs(String(calls[1]?.url))
    expect(pairs.find(([k]) => k === 'processCategory')).toEqual([
      'processCategory',
      'human_process',
    ])
    // 位置在 selectType 与 pageNo 之间 —— 与 list.js 的展开顺序一致
    expect(pairs.map(([k]) => k).indexOf('processCategory')).toBe(
      pairs.map(([k]) => k).indexOf('selectType') + 1,
    )
  })

  it('buildFlowTaskTimeRange 只做校验、不改写（与 buildStudyLessonTimeRange 相反）', () => {
    expect(buildFlowTaskTimeRange('2026-09-01 08:00:00', '2026-09-01 09:00:00')).toEqual({
      createTimeStart: '2026-09-01 08:00:00',
      createTimeEnd: '2026-09-01 09:00:00',
    })
    expect(() => buildFlowTaskTimeRange('2026-09-01', '2026-09-02')).toThrow(/YYYY-MM-DD HH:mm:ss/)
  })
})

// ---------------------------------------------------------------------------
// 抄送我的
// ---------------------------------------------------------------------------

describe('抄送我的 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时的 URL 与基准完全相同（含键顺序）', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listCopy()
    const base = reqOf(FLOW, FLOW_TASK_COPY_PAGE_PATH, /process-instance\/copy\/page/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
  })

  it('三个选择器空值**整个丢掉**、两个输入框空串**照发**', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listCopy()
    const keys = queryPairs(String(calls[0]?.url)).map(([k]) => k)
    // 丢掉的三个
    for (const k of ['startUserId', 'creator', 'status']) {
      expect(keys, `${k} 不该出现`).not.toContain(k)
    }
    // 照发的两个（空串，不是省略）
    expect(queryPairs(String(calls[0]?.url)).find(([k]) => k === 'processInstanceName')).toEqual([
      'processInstanceName',
      '',
    ])
    expect(queryPairs(String(calls[0]?.url)).find(([k]) => k === 'title')).toEqual(['title', ''])
    expect(keys).toEqual([
      'order',
      'orderField',
      'processInstanceName',
      'title',
      'pageNo',
      'pageSize',
      '_t',
    ])
  })

  it('三个选择器给了值就出现在各自的位置上（startUserId → creator → status）', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listCopy({ startUserId: 7, creator: 9, status: 1 })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['processInstanceName', ''],
      ['title', ''],
      ['startUserId', '7'],
      ['creator', '9'],
      ['status', '1'],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('空串形式的选择器同样被丢掉（页面 convertFetchForm 删的就是空值）', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listCopy({ startUserId: '', creator: '', status: '' } as never)
    const keys = queryPairs(String(calls[0]?.url)).map(([k]) => k)
    expect(keys).not.toContain('startUserId')
    expect(keys).not.toContain('creator')
    expect(keys).not.toContain('status')
  })

  it('抄送时间区间：原样两端（不 +1 天）；页面 picker 没有 show-time，所以要显式给时分秒', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listCopy(
      buildFlowTaskCopyTimeRange('2026-09-01 00:00:00', '2026-09-10 23:59:59'),
    )
    const url = String(calls[0]?.url)
    expect(url).toContain('createTime%5B0%5D=2026-09-01%2000%3A00%3A00')
    expect(url).toContain('createTime%5B1%5D=2026-09-10%2023%3A59%3A59')
    expect(url).not.toContain('2026-09-11')
  })

  it('buildFlowTaskCopyTimeRange 只做校验：date-only 会被拒（不给"两个零点"的机会）', () => {
    expect(() => buildFlowTaskCopyTimeRange('2026-09-01', '2026-09-10')).toThrow(
      /YYYY-MM-DD HH:mm:ss/,
    )
    expect(buildFlowTaskCopyTimeRange('2026-09-01 00:00:00', '2026-09-10 23:59:59')).toEqual({
      createTimeStart: '2026-09-01 00:00:00',
      createTimeEnd: '2026-09-10 23:59:59',
    })
  })

  it('区间单边给要 reject', async () => {
    const { calls, cap } = buildFlowTask()
    await expect(cap.listCopy({ createTimeEnd: '2026-09-10 00:00:00' })).rejects.toThrow(/成对给/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 我的流程
// ---------------------------------------------------------------------------

describe('我的流程 —— 与 Portal formState / 已有基准逐字段一致（D20）', () => {
  it('无筛选时保留 Portal 的空串字段，空 null/数组筛选不出现在 URL', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listMy()
    expect(String(calls[0]?.url)).toContain(FLOW_TASK_MY_LIST_PATH)
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['name', ''],
      ['title', ''],
      ['category', ''],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('筛选参数按 processDefinitionId → category → status → createTime → 分页排列', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.listMy({
      name: '通用',
      title: '采购',
      processDefinitionId: 'hr_general_approval',
      status: 1,
      createTimeStart: '2026-09-01 00:00:00',
      createTimeEnd: '2026-09-10 23:59:59',
      pageNo: 2,
      pageSize: 50,
    })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['name', '%E9%80%9A%E7%94%A8'],
      ['title', '%E9%87%87%E8%B4%AD'],
      ['processDefinitionId', 'hr_general_approval'],
      ['category', ''],
      ['status', '1'],
      ['createTime%5B0%5D', '2026-09-01%2000%3A00%3A00'],
      ['createTime%5B1%5D', '2026-09-10%2023%3A59%3A59'],
      ['pageNo', '2'],
      ['pageSize', '50'],
      ['_t', '<ts>'],
    ])
  })

  it('时间范围必须成对且是完整日期时间格式', async () => {
    const { calls, cap } = buildFlowTask()
    await expect(cap.listMy({ createTimeStart: '2026-09-01 00:00:00' })).rejects.toThrow(/成对给/)
    await expect(
      cap.listMy({ createTimeStart: '2026-09-01', createTimeEnd: '2026-09-10' }),
    ).rejects.toThrow(/YYYY-MM-DD HH:mm:ss/)
    expect(calls).toHaveLength(0)
  })

  it('取消发送 DELETE body {id, reason}，并在发送前拒绝空 ID/空白原因', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.cancel({ id: ' instance-1 ', reason: '  测试取消  ' })
    expect(calls[0]).toMatchObject({
      url: '/admin-api/bpm/process-instance/cancel-by-start-user',
      method: 'delete',
    })
    expect(JSON.parse(String(calls[0]?.data))).toEqual({ id: 'instance-1', reason: '测试取消' })

    const before = calls.length
    await expect(cap.cancel({ id: '', reason: '取消' })).rejects.toThrow(/id 不能为空/)
    await expect(cap.cancel({ id: 'instance-1', reason: '   ' })).rejects.toThrow(/reason 必填/)
    expect(calls).toHaveLength(before)
  })

  it('已办撤销审批使用已办页面上下文、历史 task id 和 Portal 的空原因默认值', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.withdrawDone({ taskId: ' done-task-1 ', reason: ' 重新确认审批意见 ' })
    expect(calls[0]).toMatchObject({
      url: '/admin-api/bpm/task/withdraw',
      method: 'put',
    })
    expect(JSON.parse(String(calls[0]?.data))).toEqual({
      id: 'done-task-1',
      reason: '重新确认审批意见',
    })
    expect(calls[0]?.headers).not.toHaveProperty('module-type')

    await cap.withdrawDone({ taskId: 'done-task-2' })
    expect(JSON.parse(String(calls[1]?.data))).toEqual({ id: 'done-task-2', reason: '无' })

    const before = calls.length
    await expect(cap.withdrawDone({ taskId: '   ', reason: '撤销' })).rejects.toThrow(/taskId/)
    expect(calls).toHaveLength(before)
  })
})

describe('我的流程动态动作 —— 跟进 / 附件 / 短信提醒与 Portal body 对齐', () => {
  it('会议预定取消使用 businessKey、PUT 路径和我的流程上下文', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.cancelReservation(' 123 ')
    expect(calls[0]).toMatchObject({
      url: '/admin-api/hr/meeting-application/cancel-reservation/123',
      method: 'put',
    })
    expect(calls[0]?.headers).not.toHaveProperty('module-type')

    const before = calls.length
    await expect(cap.cancelReservation('')).rejects.toThrow(/businessKey/)
    await expect(cap.cancelReservation('0')).rejects.toThrow(/businessKey/)
    await expect(cap.cancelReservation('1.5')).rejects.toThrow(/businessKey/)
    expect(calls).toHaveLength(before)
  })

  it('跟进能力与列表都只带 processInstanceId，走我的流程页面上下文', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.getFollowUpCapability('instance-1')
    await cap.listFollowUps('instance-1')
    expect(String(calls[0]?.url)).toContain('/admin-api/bpm/process-follow-up/capability?processInstanceId=instance-1')
    expect(String(calls[1]?.url)).toContain('/admin-api/bpm/process-follow-up/list?processInstanceId=instance-1')
    expect(calls[0]).toMatchObject({ method: 'get' })
    expect(calls[1]).toMatchObject({ method: 'get' })
    expect(calls[0]?.headers).not.toHaveProperty('module-type')
    expect(calls[1]?.headers).not.toHaveProperty('module-type')
  })

  it('跟进附件登记与创建 body 的键和值和 Portal 一致', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.registerFollowUpAttachment({ name: '说明.pdf', url: 'https://oss.example/a.pdf', size: 1024 })
    await cap.createFollowUp({
      processInstanceId: ' instance-1 ',
      content: '  跟进内容  ',
      resourceIds: [1001, 1002],
      clientRequestId: 'follow-up-1',
    })
    expect(JSON.parse(String(calls[0]?.data))).toEqual({
      name: '说明.pdf',
      url: 'https://oss.example/a.pdf',
      size: 1024,
    })
    expect(JSON.parse(String(calls[1]?.data))).toEqual({
      processInstanceId: 'instance-1',
      content: '跟进内容',
      resourceIds: [1001, 1002],
      clientRequestId: 'follow-up-1',
    })
  })

  it('跟进提交复刻前端和后端边界：内容、附件和客户端幂等键不合法时不发请求', async () => {
    const { calls, cap } = buildFlowTask()
    await expect(cap.createFollowUp({ processInstanceId: 'i', content: '   ', clientRequestId: 'r' })).rejects.toThrow(/content/)
    await expect(cap.createFollowUp({ processInstanceId: 'i', content: 'ok', resourceIds: [1, 1], clientRequestId: 'r' })).rejects.toThrow(/不能重复/)
    await expect(cap.createFollowUp({ processInstanceId: 'i', content: 'ok', resourceIds: [1, 2, 3, 4], clientRequestId: 'r' })).rejects.toThrow(/最多 3/)
    await expect(cap.createFollowUp({ processInstanceId: 'i', content: 'ok', clientRequestId: '' })).rejects.toThrow(/clientRequestId/)
    await expect(cap.registerFollowUpAttachment({ name: 'a', url: 'u', size: 100 * 1024 * 1024 + 1 })).rejects.toThrow(/100 MiB/)
    expect(calls).toHaveLength(0)
  })

  it('短信提醒详情、历史、发送请求与 Portal 一致，发送保留 clientRequestId', async () => {
    const { calls, cap } = buildFlowTask()
    await cap.getSmsRemindDetail('instance-2')
    await cap.listSmsRemindHistory('instance-2')
    await cap.sendSmsRemind({ processInstanceId: 'instance-2', clientRequestId: 'sms-1' })
    expect(String(calls[0]?.url)).toContain('/admin-api/bpm/process-sms-remind/detail?processInstanceId=instance-2')
    expect(String(calls[1]?.url)).toContain('/admin-api/bpm/process-sms-remind/history?processInstanceId=instance-2')
    expect(calls[2]).toMatchObject({ url: expect.stringContaining('/admin-api/bpm/process-sms-remind/send'), method: 'post' })
    expect(JSON.parse(String(calls[2]?.data))).toEqual({ processInstanceId: 'instance-2', clientRequestId: 'sms-1' })
    expect(calls[2]?.headers).not.toHaveProperty('module-type')
  })

  it('短信发送缺少流程实例或幂等键时不发请求', async () => {
    const { calls, cap } = buildFlowTask()
    await expect(cap.sendSmsRemind({ processInstanceId: '', clientRequestId: 'r' })).rejects.toThrow(/processInstanceId/)
    await expect(cap.sendSmsRemind({ processInstanceId: 'i', clientRequestId: ' ' })).rejects.toThrow(/clientRequestId/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 流程模型（双赢协议）
// ---------------------------------------------------------------------------

describe('流程模型（双赢协议）—— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时的 URL 与基准完全相同（含键顺序）', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listModels()
    const base = reqOf(FLOW, FLOW_MANAGE_MODEL_PAGE_PATH, /hr\/model\/page/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
  })

  it('分页参数名是 **limit**（不是 pageSize）—— 这一页的罕见例外', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listModels()
    const keys = queryPairs(String(calls[0]?.url)).map(([k]) => k)
    expect(keys).toContain('limit')
    expect(keys).not.toContain('pageSize')
    expect(queryPairs(String(calls[0]?.url)).find(([k]) => k === 'limit')).toEqual(['limit', '20'])
  })

  it('调用方给 pageSize 不会进 URL（只会被忽略），limit 才是可用的那个', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listModels({ pageSize: 99 } as never)
    expect(String(calls[0]?.url)).not.toContain('pageSize')
    await cap.listModels({ limit: 50 })
    expect(String(calls[0 + 1]?.url)).toContain('limit=50')
  })

  it('三个筛选字段是空串但**照发**（与 AI审核配置那页相反）', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listModels()
    const pairs = queryPairs(String(calls[0]?.url))
    for (const k of ['order', 'orderField', 'key', 'name', 'category']) {
      expect(pairs.find(([pair]) => pair === k)).toEqual([k, ''])
    }
  })
})

// ---------------------------------------------------------------------------
// AI审核配置
// ---------------------------------------------------------------------------

describe('AI审核配置 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时 URL 上**只剩分页** —— 连 order= / orderField= 都不在', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listAiReviewConfigs()
    const base = reqOf(FLOW, FLOW_MANAGE_AI_REVIEW_PAGE_PATH, /ai-review-config\/page/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('`enabled=false` 是**有效筛选值、要照发**；不传才是"不过滤"', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listAiReviewConfigs()
    expect(String(calls[0]?.url)).not.toContain('enabled')
    await cap.listAiReviewConfigs({ enabled: false })
    expect(String(calls[1]?.url)).toContain('enabled=false')
    await cap.listAiReviewConfigs({ enabled: true })
    expect(String(calls[2]?.url)).toContain('enabled=true')
  })

  it('空串 / null / undefined / 空数组一律丢；有值才出现、且顺序照契约', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listAiReviewConfigs({ processDefinitionKey: '', taskDefinitionKey: '' })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
    await cap.listAiReviewConfigs({ processDefinitionKey: 'qingjia', taskDefinitionKey: 't1' })
    expect(queryPairs(String(calls[1]?.url))).toEqual([
      ['processDefinitionKey', 'qingjia'],
      ['taskDefinitionKey', 't1'],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('createTime 区间原样两端（本页不 +1 天、也不归到当日边界）', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listAiReviewConfigs(
      buildAiReviewConfigTimeRange('2026-09-01 08:00:00', '2026-09-10 18:30:00'),
    )
    const url = String(calls[0]?.url)
    expect(url).toContain('createTime%5B0%5D=2026-09-01%2008%3A00%3A00')
    expect(url).toContain('createTime%5B1%5D=2026-09-10%2018%3A30%3A00')
  })

  it('区间单边给要 reject', async () => {
    const { calls, cap } = buildFlowManage()
    await expect(
      cap.listAiReviewConfigs({ createTimeStart: '2026-09-01 00:00:00' }),
    ).rejects.toThrow(/成对给/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 流程实例
// ---------------------------------------------------------------------------

describe('流程实例 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时的 URL 与基准完全相同（含键顺序）：空串照发、null 不发', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listProcessInstances()
    const base = reqOf(FLOW, FLOW_MANAGE_INSTANCE_PAGE_PATH, /process-instance\/manager-page/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    // 三个"没填就不发"的：startUserId / processDefinitionId / status
    const keys = queryPairs(String(calls[0]?.url)).map(([k]) => k)
    expect(keys).not.toContain('startUserId')
    expect(keys).not.toContain('processDefinitionId')
    expect(keys).not.toContain('status')
    // 两个空串照发
    expect(keys).toContain('name')
    expect(keys).toContain('title')
  })

  it('填了的值按契约顺序出现（startUserId 在 name 之前）', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listProcessInstances({
      startUserId: 3,
      name: 'n',
      title: 't',
      processDefinitionId: 'p1',
      category: 'human_process',
      status: 1,
    })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['startUserId', '3'],
      ['name', 'n'],
      ['title', 't'],
      ['processDefinitionId', 'p1'],
      ['category', 'human_process'],
      ['status', '1'],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('区间语义是**按天归边的闭区间**（与 study-lesson 的 +1 天**不是一回事**）', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listProcessInstances(
      buildFlowManageDayRange('2026-09-01 15:30:00', '2026-09-10 08:00:00'),
    )
    const url = String(calls[0]?.url)
    // 起点归到当日零点、终点归到当日 23:59:59（传进来的时分秒被吃掉，页面就是这么写的）
    expect(url).toContain('createTime%5B0%5D=2026-09-01%2000%3A00%3A00')
    expect(url).toContain('createTime%5B1%5D=2026-09-10%2023%3A59%3A59')
    expect(url).not.toContain('2026-09-11')
  })
})

// ---------------------------------------------------------------------------
// 流程任务
// ---------------------------------------------------------------------------

describe('流程任务 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时的 URL 与基准完全相同（含键顺序）', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listFlowTasks()
    const base = reqOf(FLOW, FLOW_MANAGE_TASK_PAGE_PATH, /task\/manager-page/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['name', ''],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('区间与流程实例页同一套：按天归边', async () => {
    const { calls, cap } = buildFlowManage()
    await cap.listFlowTasks(buildFlowManageDayRange('2026-09-01', '2026-09-10'))
    const url = String(calls[0]?.url)
    expect(url).toContain('createTime%5B0%5D=2026-09-01%2000%3A00%3A00')
    expect(url).toContain('createTime%5B1%5D=2026-09-10%2023%3A59%3A59')
  })

  it('区间单边给要 reject', async () => {
    const { calls, cap } = buildFlowManage()
    await expect(cap.listFlowTasks({ createTimeEnd: '2026-09-10 00:00:00' })).rejects.toThrow(
      /成对给/,
    )
    expect(calls).toHaveLength(0)
  })

  it('buildFlowManageDayRange：边界与倒序校验', () => {
    expect(buildFlowManageDayRange('2026-09-01', '2026-09-10')).toEqual({
      createTimeStart: '2026-09-01 00:00:00',
      createTimeEnd: '2026-09-10 23:59:59',
    })
    // 跨月 / 跨年也走同一个格式
    expect(buildFlowManageDayRange('2026-12-31', '2027-01-01').createTimeEnd).toBe(
      '2027-01-01 23:59:59',
    )
    expect(() => buildFlowManageDayRange('2026-09-10', '2026-09-01')).toThrow(/不早于/)
    expect(() => buildFlowManageDayRange('not-a-date', '2026-09-01')).toThrow(/YYYY-MM-DD/)
  })
})

// ---------------------------------------------------------------------------
// 请求头：module-type 一律不发
// ---------------------------------------------------------------------------

describe('九个流程管理页面请求都不发 module-type（与基准/源码规则一致）', () => {
  it('九条 SDK 请求的 moduleType 全是 undefined，且既有基准请求头里也没有这个头', async () => {
    const task = buildFlowTask()
    await task.cap.listDefinitions()
    await task.cap.listTodo()
    await task.cap.listDone()
    await task.cap.listCopy()
    await task.cap.listMy()
    const manage = buildFlowManage()
    await manage.cap.listModels()
    await manage.cap.listAiReviewConfigs()
    await manage.cap.listProcessInstances()
    await manage.cap.listFlowTasks()

    const calls = [...task.calls, ...manage.calls]
    expect(calls).toHaveLength(9)
    for (const call of calls) {
      expect(call.moduleType).toBeUndefined()
    }
    // 基准那一侧：八页的列表请求头里都没有 module-type 这个键
    for (const pagePath of [
      FLOW_TASK_CREATE_PAGE_PATH,
      FLOW_TASK_TODO_PAGE_PATH,
      FLOW_TASK_DONE_PAGE_PATH,
      FLOW_TASK_COPY_PAGE_PATH,
      FLOW_MANAGE_MODEL_PAGE_PATH,
      FLOW_MANAGE_AI_REVIEW_PAGE_PATH,
      FLOW_MANAGE_INSTANCE_PAGE_PATH,
      FLOW_MANAGE_TASK_PAGE_PATH,
    ]) {
      const hit = FLOW.requests.find((r) => r.pagePath === pagePath)
      expect(hit, `基准里应当有 ${pagePath}`).toBeDefined()
      expect(Object.keys(hit?.headers ?? {})).not.toContain('module-type')
      expect(Object.keys(hit?.headers ?? {})).toEqual([
        'tenant-id',
        'token',
        'Accept-Language',
        'Accept',
      ])
    }
  })
})

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

describe('能力定义：页面路径与目录一致，且没有两个能力指向同一页', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string; permission: string | null }> }

  const all = [...flowTaskCapabilities, ...flowManageCapabilities]

  it('流程能力的 pagePath 都在目录里，动态动作写能力明确登记', () => {
    expect(all).toHaveLength(46)
    for (const def of all) {
      expect(
        catalog.items.some((i) => i.menuPath === def.pagePath),
        `${def.id} 的 pagePath 不在目录里`,
      ).toBe(true)
    }
    expect(all.filter((def) => def.write).map((def) => def.id)).toEqual([
      'flow-task-done-withdraw',
      'flow-task-my-cancel',
      'flow-task-my-cancel-reservation',
      'flow-task-my-follow-up-attachment-register',
      'flow-task-my-follow-up-create',
      'flow-task-my-sms-remind-send',
      'flow-manage-model-create',
      'flow-manage-model-update',
      'flow-manage-model-deploy',
      'flow-manage-model-update-state',
      'flow-manage-model-delete',
      'flow-manage-model-rule-create',
      'flow-manage-model-rule-update',
      'flow-manage-ai-review-config-create',
      'flow-manage-ai-review-config-update',
      'flow-manage-ai-review-config-delete',
      'flow-manage-process-instance-cancel-by-admin',
    ])
  })

  it('permission 与目录里那一页逐字相同（含菜单源码里那个 `process-tasnk` 拼写）', () => {
    for (const def of all) {
      const row = catalog.items.find((i) => i.menuPath === def.pagePath)
      expect(def.permission, `${def.id} 的 permission 与目录不一致`).toBe(row?.permission)
    }
    // 逐字核对那条拼写错的（不要"顺手修好"）
    expect(
      flowManageCapabilities.find((d) => d.id === 'flow-manage-task-list')?.permission,
    ).toBe('/dashboard/frame/bpm/manager/process-tasnk')
    expect(flowManageCapabilities.find((d) => d.id === 'flow-manage-model-rule-create')).toMatchObject({
      pagePath: FLOW_MANAGE_MODEL_PAGE_PATH,
      permission: FLOW_MANAGE_MODEL_PAGE_PATH,
      write: true,
    })
    expect(FLOW_MANAGE_METHODS['flow-manage-model-rule-prepare-create']).toBe('prepareTaskAssignRuleCreate')
    expect(FLOW_MANAGE_METHODS['flow-manage-model-rule-create']).toBe('createTaskAssignRule')
    expect(FLOW_MANAGE_METHODS['flow-manage-model-rule-cancel-create']).toBe('cancelTaskAssignRuleCreate')
  })

  it('流程表单复用我的流程页时，所有查询/撤销能力继承可见菜单权限', () => {
    const reused = ALL_CAPABILITY_DEFINITIONS.filter(definition => definition.pagePath === FLOW_TASK_MY_PAGE_PATH)
    expect(reused).toHaveLength(26)
    expect(reused.every(definition => definition.permission === FLOW_TASK_MY_PERMISSION)).toBe(true)
  })

  it('流程能力 id 互不重复，且包含动态动作', () => {
    const ids = all.map((d) => d.id)
    expect(new Set(ids).size).toBe(46)
    expect(ids).toContain('flow-task-todo-list')
    expect(ids).toContain('flow-task-done-list')
    expect(ids).toContain('flow-task-done-withdraw')
    expect(ids).toContain('flow-task-my-list')
    expect(ids).toContain('flow-task-my-cancel')
    expect(ids).toContain('flow-task-my-cancel-reservation')
    expect(ids).toContain('flow-task-my-follow-up-capability')
    expect(ids).toContain('flow-task-my-follow-up-list')
    expect(ids).toContain('flow-task-my-follow-up-attachment-register')
    expect(ids).toContain('flow-task-my-follow-up-create')
    expect(ids).toContain('flow-task-my-sms-remind-detail')
    expect(ids).toContain('flow-task-my-sms-remind-history')
    expect(ids).toContain('flow-task-my-sms-remind-send')
    expect(ids).toContain('flow-manage-model-list')
    expect(ids).toContain('flow-manage-model-rule-prepare-create')
    expect(ids).toContain('flow-manage-model-rule-create')
    expect(ids).toContain('flow-manage-model-rule-cancel-create')
  })

  it('待办页不开放 selectType / finished，已办页开放 selectType 但不开放 finished', () => {
    const todo = flowTaskCapabilities.find((d) => d.id === 'flow-task-todo-list')
    const done = flowTaskCapabilities.find((d) => d.id === 'flow-task-done-list')
    const names = (def: typeof todo): string[] => (def?.params ?? []).map((p) => p.name)
    expect(names(todo)).not.toContain('selectType')
    expect(names(todo)).not.toContain('finished')
    expect(names(done)).toContain('selectType')
    expect(names(done)).not.toContain('finished')
  })

  /**
   * 三个「字典枚举」参数的候选入口必须指向 `base-dict-get`（按 dictType 取一个字典的**全部选项**），
   * **不是 `base-dict-search`**（那一个要的是 dictType 的**名字关键字**，参数表里根本没有 `dictType`）。
   *
   * 这条是补的：第一版这三个 `lookup` 全写成了 `base-dict-search` + `keywordParam: 'dictType'`，
   * 被本仓库既有的接线校验（`test/base-dept-dict-permission.test.ts:184` 同款规则：
   * "候选入口必须有 `keywordParam` 那个参数"）抓出来 —— 3 条错误。
   * 这里补一条**本文件自己的**窄断言，免得日后再改回去。
   */
  it('三个字典枚举参数的候选入口是 base-dict-get，不是 base-dict-search', () => {
    const dictLookups = all.flatMap((def) =>
      def.params
        .filter((p) => p.lookup?.capabilityId === 'base-dict-get')
        .map((p) => `${def.id}.${p.name}:${p.lookup?.keywordParam}`),
    )
    expect(dictLookups.sort()).toEqual([
      'flow-manage-model-list.category:dictType',
      'flow-manage-process-instance-list.status:dictType',
      'flow-task-copy-list.status:dictType',
      'flow-task-my-list.status:dictType',
    ])
    // 一条都不许指向 base-dict-search（它没有 dictType 参数）
    const wrong = all.flatMap((def) =>
      def.params.filter((p) => p.lookup?.capabilityId === 'base-dict-search').map((p) => p.name),
    )
    expect(wrong).toEqual([])
    // 人员候选那两个仍然指向 base-user-search（强制要关键字），别一起改坏
    const userLookups = all.flatMap((def) =>
      def.params
        .filter((p) => p.lookup?.capabilityId === 'base-user-search')
        .map((p) => `${def.id}.${p.name}`),
    )
    expect(userLookups.sort()).toEqual([
      'flow-manage-process-instance-list.startUserId',
      'flow-task-copy-list.creator',
      'flow-task-copy-list.startUserId',
    ])
  })

  it('流程模型那一个能力的参数名是 limit（不是 pageSize）', () => {
    const model = flowManageCapabilities.find((d) => d.id === 'flow-manage-model-list')
    const names = (model?.params ?? []).map((p) => p.name)
    expect(names).toContain('limit')
    expect(names).not.toContain('pageSize')
  })
})

// ---------------------------------------------------------------------------
// 流程治理写能力：表单、multipart 字段顺序与按钮条件
// ---------------------------------------------------------------------------

describe('流程模型/规则/AI审核/实例写能力', () => {
  type Call = Parameters<PortalRequest>[0]

  function fakeCapability (response: unknown = undefined) {
    const calls: Call[] = []
    const request: PortalRequest = async <T>(config: Call) => {
      calls.push(config)
      return response as T
    }
    const cap = createFlowManageCapability(request, request, request, request)
    return { calls, cap }
  }

  it('新建流程模型按 Portal 顺序提交 multipart，并保留取消无副作用', async () => {
    const { calls, cap } = fakeCapability('model-100')
    const base64 = Buffer.from('<definitions id="demo"/>').toString('base64')
    const preparation = cap.prepareModelCreate({
      key: 'demo',
      name: '演示流程',
      category: 'human_process',
      fileName: 'demo.bpmn',
      base64,
    })
    expect(preparation.draft.description).toBe('')
    expect(cap.cancelModelCreate()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(0)

    await expect(cap.createModel({ draft: preparation.draft })).resolves.toBe('model-100')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: '/bpm/hr/model/import', method: 'post' })
    const entries = Array.from((calls[0]?.data as FormData).entries())
    expect(entries.map(([name]) => name)).toEqual(['key', 'name', 'bpmnFile', 'category', 'description'])
    expect(entries[0]?.[1]).toBe('demo')
    expect(entries[1]?.[1]).toBe('演示流程')
    expect(entries[3]?.[1]).toBe('human_process')
    expect(entries[4]?.[1]).toBe('')
    expect(entries[2]?.[1]).toBeInstanceOf(Blob)
  })

  it('新增流程分配规则按 Portal/Java 字段走 prepare → submit → cancel', async () => {
    const { calls, cap } = fakeCapability(701)
    const preparation = cap.prepareTaskAssignRuleCreate({
      form: {
        id: null,
        modelId: 'model-100',
        taskDefinitionKey: 'approve-task',
        type: 30,
        options: ['8', '9'],
      },
    })
    expect(preparation.draft).toEqual({
      id: null,
      modelId: 'model-100',
      options: ['8', '9'],
      taskDefinitionKey: 'approve-task',
      type: 30,
    })
    expect(cap.cancelTaskAssignRuleCreate()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(0)

    await expect(cap.createTaskAssignRule({ draft: preparation.draft })).resolves.toBe(701)
    expect(calls[0]).toMatchObject({
      url: FLOW_MANAGE_MODEL_RULE_CREATE_PATH,
      method: 'post',
      data: {
        id: null,
        modelId: 'model-100',
        options: ['8', '9'],
        taskDefinitionKey: 'approve-task',
        type: 30,
      },
    })
    expect(calls[0]?.data).not.toHaveProperty('processDefinitionId')
    expect(Object.keys((calls[0]?.data ?? {}) as Record<string, unknown>)).toEqual([
      'id',
      'modelId',
      'options',
      'taskDefinitionKey',
      'type',
    ])
  })

  it('新增规则反证：已有 id、非法 type、空 options 或缺少模型/节点不会发 POST', async () => {
    const { calls, cap } = fakeCapability(701)
    const base = {
      id: null,
      modelId: 'model-100',
      taskDefinitionKey: 'approve-task',
      type: 30,
      options: ['8'],
    }
    expect(() => cap.prepareTaskAssignRuleCreate({ form: { ...base, id: 'rule-1' } })).toThrow(/form.id/)
    expect(() => cap.prepareTaskAssignRuleCreate({ form: { ...base, id: 0 } })).toThrow(/form.id/)
    expect(() => cap.prepareTaskAssignRuleCreate({ form: { ...base, type: 0 } })).toThrow(/10\/20\/30\/40\/50\/60/)
    expect(() => cap.prepareTaskAssignRuleCreate({ form: { ...base, options: [] } })).toThrow(/至少包含一项/)
    expect(() => cap.prepareTaskAssignRuleCreate({ form: { ...base, modelId: '' } })).toThrow(/流程模型 id/)
    expect(() => cap.prepareTaskAssignRuleCreate({ form: { ...base, taskDefinitionKey: '' } })).toThrow(/任务定义 Key/)
    await expect(cap.createTaskAssignRule({ draft: { ...base, modelId: '' } })).rejects.toThrow(/流程模型 id/)
    expect(calls).toHaveLength(0)
  })

  it('模型更新/部署/删除与 Portal/Java Controller 的方法、路径和 body 一致', async () => {
    const { calls, cap } = fakeCapability()
    const draft = {
      id: 'model-100',
      key: 'demo',
      name: '演示流程',
      description: null,
      category: 'human_process',
      bpmnXml: '<definitions />',
    }

    await cap.updateModel({ draft })
    await cap.deployModel({ id: 'model-100' })
    await cap.deleteModel({ id: 'model-100' })

    expect(calls[0]).toMatchObject({
      url: FLOW_MANAGE_MODEL_UPDATE_PATH,
      method: 'put',
      data: draft,
    })
    expect(calls[1]).toMatchObject({
      url: FLOW_MANAGE_MODEL_DEPLOY_PATH,
      method: 'post',
      data: { id: 'model-100' },
    })
    expect(calls[2]).toMatchObject({
      url: `${FLOW_MANAGE_MODEL_DELETE_PATH}/model-100`,
      method: 'delete',
    })
    expect(calls[2]?.data).toBeUndefined()
    expect(calls[2]?.params).toBeUndefined()
  })

  it('模型状态只接受 Portal switch 的反向状态，规则更新保留 id/type/options', async () => {
    const { calls, cap } = fakeCapability()
    await cap.updateModelState({ id: '12', currentState: 1, state: 2 })
    await expect(cap.updateModelState({ id: '12', currentState: 1, state: 1 })).rejects.toThrow(/相反/)
    await cap.updateTaskAssignRule({ draft: { id: '33', type: 30, options: ['8', '9'] } })
    expect(calls[0]).toMatchObject({ url: '/bpm/hr/model/update-state', method: 'put', data: { id: '12', state: 2 } })
    expect(calls[1]).toMatchObject({ url: '/bpm/hr/task-assign-rule/update', method: 'put', data: { id: '33', type: 30, options: ['8', '9'] } })
  })

  it('AI 配置显式保留 modelConfigId=null，删除使用 query id', async () => {
    const { calls, cap } = fakeCapability()
    const create = cap.prepareCreateAiReviewConfig({
      form: {
        processDefinitionKey: 'demo',
        taskDefinitionKey: 'approve',
        skillId: '8',
        modelConfigId: null,
        enabled: true,
      },
    })
    expect(create.draft.modelConfigId).toBeNull()
    await cap.createAiReviewConfig({ draft: create.draft })
    await cap.deleteAiReviewConfig({ id: '8' })
    expect(calls[0]).toMatchObject({ url: '/bpm/ai-review-config/create', method: 'post', data: expect.objectContaining({ modelConfigId: null }) })
    expect(calls[1]).toMatchObject({ url: '/bpm/ai-review-config/delete', method: 'delete', params: { id: '8' } })
  })

  it('管理员取消只允许列表中的运行中实例且原因 trim 后提交', async () => {
    const { calls, cap } = fakeCapability()
    expect(cap.prepareAdminCancel({ id: '101', currentStatus: 1, reason: '  测试取消  ' })).toEqual({
      currentStatus: 1,
      draft: { id: '101', reason: '测试取消' },
    })
    expect(() => cap.prepareAdminCancel({ id: '101', currentStatus: 2, reason: '取消' })).toThrow(/运行中/)
    await cap.submitAdminCancel({ draft: { id: '101', reason: '测试取消' } })
    expect(calls[0]).toMatchObject({
      url: '/bpm/process-instance/cancel-by-admin',
      method: 'delete',
      data: { id: '101', reason: '测试取消' },
    })
  })
})
