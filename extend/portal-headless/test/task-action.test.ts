import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import {
  BATCH_MAX_COPY_USERS,
  BATCH_TASK_TYPE,
  TASK_ACTION_BATCH_PAGE_PATH,
  TASK_ACTION_DETAIL_PAGE_PATH,
  TASK_STATUS,
  buildApprovePayload,
  buildBatchAuditPayload,
  buildRejectPayload,
  createTaskActionCapability,
  normalizeTaskId,
  normalizeUserIds,
  taskActionCapabilities,
  type TaskActionCapability,
  type WorkflowTask,
} from '../src/capabilities/task-action.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number }

const here = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/task-action.browser.json'), 'utf8'),
) as {
  requests: Array<{ name: string; method: string; url: string; headers: Record<string, string> }>
}

/** 取 path + query，把一次性时间戳归一化（基准里存的是带 host 的完整 URL） */
function normalizeUrl (rawUrl: string): string {
  return rawUrl
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/\/admin-api\//, '/')
    .replace(/([?&]_t=)\d+/, '$1<ts>')
}

/** 把基准里的 URL 拆成 [path, 有序 query 对] */
function splitUrl (rawUrl: string): { path: string; query: Array<[string, string]> } {
  const normalized = normalizeUrl(rawUrl)
  const [path, query = ''] = normalized.split('?')
  return {
    path: path ?? '',
    query: query === ''
      ? []
      : query.split('&').map((part) => {
        const index = part.indexOf('=')
        const key = index === -1 ? part : part.slice(0, index)
        const value = index === -1 ? '' : part.slice(index + 1)
        return [key, value] as [string, string]
      }),
  }
}

/**
 * 门面上还没有 `taskAction`（接线由派单方统一做，不在本任务范围），
 * 所以这里自己用公开的 `sdk.call(pagePath, config)` 组装一次请求函数——
 * 好处是它照样走「页面上下文」那条唯一实现，module-type 与 http 实例都不是绕过去的。
 *
 * **两条页面各一个请求函数**，这样「写能力有没有走批量页的上下文」也能被钉住。
 */
function makeSdk (data: unknown = { list: [], total: 0 }) {
  const calls: CapturedCall[] = []
  const batchCalls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  // 「流程详情页」那一份：批量页的请求要能被**单独看见**（页面上下文不同，必须分开验），
  // 所以另起一个 sdk 给批量页，而不是让两份共用一个记录数组。
  const capability: TaskActionCapability = createTaskActionCapability((config) =>
    sdk.call(TASK_ACTION_DETAIL_PAGE_PATH, config),
  )
  const batchSdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(batchSdk.http as AxiosInstance).defaults.adapter = async (config) => {
    batchCalls.push(config as CapturedCall)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  const batchCapability: TaskActionCapability = createTaskActionCapability(
    (config) => batchSdk.call(TASK_ACTION_DETAIL_PAGE_PATH, config),
    (config) => batchSdk.call(TASK_ACTION_BATCH_PAGE_PATH, config),
  )
  return { sdk, calls, capability, batchSdk, batchCalls, batchCapability }
}

/** 把 axios 请求配置里的 data 解析回对象（axios 适配器收到的是原对象，不是字符串） */
function bodyOf (call: CapturedCall): Record<string, unknown> {
  const data = call.data
  return typeof data === 'string' ? (JSON.parse(data) as Record<string, unknown>) : (data as Record<string, unknown>)
}

/**
 * 适配器里看到的 `config.url` 是**拦截器改过之后**的样子：`platform.js` 这条路径会
 * `applyUrlRewrite` 补上 `/admin-api`，并且把 GET 的 `params` 用 qs 序列化后**拼进 URL**
 * （`src/http/client.ts` 的 `querySerialization: 'qs-in-interceptor'` 分支）——
 * 所以 GET 请求在适配器里 `config.params` 是空的，参数只能从 URL 的 query 里读。
 * 这不是测试的将就，而是**这个页面真的走 platform.js 的证据**（基准里的浏览器请求同形）。
 */
function requestPath (call: CapturedCall): string {
  return String(call.url ?? '').replace(/^\/admin-api/, '').split('?')[0] ?? ''
}

/** URL query 的有序 [key, value] 对；`_t` 是一次性时间戳，归一化掉 */
function requestQuery (call: CapturedCall): Array<[string, string]> {
  const query = String(call.url ?? '').split('?')[1] ?? ''
  if (query === '') return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    // qs 在拦截器里做过百分号编码，读回来先解码——不解码的话中文关键字会比不出来
    return [key, key === '_t' ? '<ts>' : decodeURIComponent(value)] as [string, string]
  })
}

function queryObject (call: CapturedCall): Record<string, string> {
  return Object.fromEntries(requestQuery(call))
}

// ---------------------------------------------------------------------------
// 1. 能力定义
// ---------------------------------------------------------------------------

describe('task-action 能力定义', () => {
  it('十个能力，id 与预期完全一致（多一个少一个都要红）', () => {
    expect(taskActionCapabilities.map((item) => item.id).sort()).toEqual(
      [
        'task-action-approve',
        'task-action-batch-approve',
        'task-action-batch-reject',
        'task-action-delegate',
        'task-action-instance',
        'task-action-reject',
        'task-action-return',
        'task-action-return-options',
        'task-action-transfer',
        'task-action-workflow-path',
      ].sort(),
    )
  })

  it('每个能力的 pagePath 只能是这两条之一（不许悄悄挂到别的页面上）', () => {
    const allowed = new Set([TASK_ACTION_DETAIL_PAGE_PATH, TASK_ACTION_BATCH_PAGE_PATH])
    for (const item of taskActionCapabilities) {
      expect(allowed.has(item.pagePath), `${item.id} 挂到了 ${item.pagePath}`).toBe(true)
    }
  })

  it('批量两个能力挂在批量办理页，其余挂在流程详情页', () => {
    for (const item of taskActionCapabilities) {
      const expected = item.id.startsWith('task-action-batch-')
        ? TASK_ACTION_BATCH_PAGE_PATH
        : TASK_ACTION_DETAIL_PAGE_PATH
      expect(item.pagePath, item.id).toBe(expected)
    }
  })

  it('**同一条能力的 params 没有重名**（redocly 的 operation-parameters-unique 会拦）', () => {
    for (const item of taskActionCapabilities) {
      const names = item.params.map((param) => param.name)
      expect(new Set(names).size, `${item.id}: ${names.join(',')}`).toBe(names.length)
    }
  })

  it('写能力都声明 write: true，读能力都是 false', () => {
    const writeIds = taskActionCapabilities.filter((item) => item.write).map((item) => item.id).sort()
    expect(writeIds).toEqual(
      [
        'task-action-approve',
        'task-action-batch-approve',
        'task-action-batch-reject',
        'task-action-delegate',
        'task-action-reject',
        'task-action-return',
        'task-action-transfer',
      ].sort(),
    )
    for (const id of ['task-action-instance', 'task-action-workflow-path', 'task-action-return-options']) {
      expect(taskActionCapabilities.find((item) => item.id === id)?.write, id).toBe(false)
    }
  })

  it('每个写能力都收 taskId 或 taskIds（没有这个入参就无从定位任务）', () => {
    for (const item of taskActionCapabilities.filter((entry) => entry.write)) {
      const names = item.params.map((param) => param.name)
      expect(names.includes('taskId') || names.includes('taskIds'), item.id).toBe(true)
    }
  })

  it('驳回必须给理由，通过不必（页面与后端都是这么分的）', () => {
    const approveReason = taskActionCapabilities
      .find((item) => item.id === 'task-action-approve')
      ?.params.find((param) => param.name === 'reason')
    const rejectReason = taskActionCapabilities
      .find((item) => item.id === 'task-action-reject')
      ?.params.find((param) => param.name === 'reason')
    expect(approveReason?.required).toBe(false)
    expect(rejectReason?.required).toBe(true)
  })

  it('三个「把人交给别人」的动作都把人选声明成 search 且挂了长选项 lookup', () => {
    for (const [id, field] of [
      ['task-action-transfer', 'assigneeUserId'],
      ['task-action-delegate', 'delegateUserId'],
    ] as const) {
      const param = taskActionCapabilities
        .find((item) => item.id === id)
        ?.params.find((entry) => entry.name === field)
      expect(param?.kind, `${id}.${field}`).toBe('search')
      expect(param?.lookup?.capabilityId).toBe('general-approval-user-search')
    }
  })
})

// ---------------------------------------------------------------------------
// 2. 载荷：单个办理（通过 / 不通过）
// ---------------------------------------------------------------------------

describe('单个办理的载荷 —— 逐字段复刻 handleAudit()', () => {
  it('通过：键顺序是 id → reason → attachmentUrl → attachmentName → copyUserIds，且没有多余键', () => {
    const payload = buildApprovePayload({ taskId: 'task-1', reason: '同意' })
    expect(JSON.stringify(payload)).toBe(
      '{"id":"task-1","reason":"同意","attachmentUrl":"","attachmentName":"","copyUserIds":[]}',
    )
  })

  it('不通过：同一套键、同一个顺序（页面两个分支用的是同一个 data 对象）', () => {
    const payload = buildRejectPayload({ taskId: 'task-2', reason: '不同意' })
    expect(JSON.stringify(payload)).toBe(
      '{"id":"task-2","reason":"不同意","attachmentUrl":"","attachmentName":"","copyUserIds":[]}',
    )
  })

  it('附件两个键**没传时也发空串**，不是省略（页面的 auditForms 初值就是空串）', () => {
    const payload = buildApprovePayload({ taskId: 't' })
    expect('attachmentUrl' in payload).toBe(true)
    expect('attachmentName' in payload).toBe(true)
    expect(payload.attachmentUrl).toBe('')
    expect(payload.attachmentName).toBe('')
  })

  it('通过允许空意见（后端把空串换成「无」），不通过不允许', () => {
    expect(buildApprovePayload({ taskId: 't' }).reason).toBe('')
    expect(buildApprovePayload({ taskId: 't', reason: '' }).reason).toBe('')
    expect(() => buildRejectPayload({ taskId: 't', reason: '' })).toThrow(/不通过/)
    expect(() => buildRejectPayload({ taskId: 't', reason: '   ' })).toThrow(/不通过/)
  })

  it('抄送人归一成数字数组，缺省是空数组；字符串 id 也收', () => {
    expect(buildApprovePayload({ taskId: 't' }).copyUserIds).toEqual([])
    expect(buildApprovePayload({ taskId: 't', copyUserIds: [1, '2' as unknown as number] }).copyUserIds).toEqual([1, 2])
    expect(buildApprovePayload({ taskId: 't', copyUserIds: [] }).copyUserIds).toEqual([])
  })

  it('抄送人里混进非数字会红，且报出是第几个（别让人去数）', () => {
    expect(() => buildApprovePayload({ taskId: 't', copyUserIds: [1, 'abc' as unknown as number] })).toThrow(/copyUserIds\[1\]/)
  })

  it('taskId 是空串 / 空白 / null 都红（空 id 发出去只会换回一个难懂的 404）', () => {
    expect(() => normalizeTaskId('')).toThrow(/taskId/)
    expect(() => normalizeTaskId('   ')).toThrow(/taskId/)
    expect(() => normalizeTaskId(null)).toThrow(/taskId/)
    expect(() => normalizeTaskId(undefined)).toThrow(/taskId/)
    // 数字 0 不是合法任务 id 的「空值例外」——它照样被转成 "0" 发出去
    expect(normalizeTaskId(0)).toBe('0')
  })

  it('normalizeUserIds：非数组直接红，缺省给空数组', () => {
    expect(normalizeUserIds(undefined, 'x')).toEqual([])
    expect(normalizeUserIds(null, 'x')).toEqual([])
    expect(() => normalizeUserIds('1,2', 'x')).toThrow(/数组/)
  })
})

// ---------------------------------------------------------------------------
// 3. 载荷：批量办理
// ---------------------------------------------------------------------------

describe('批量办理的载荷 —— 逐字段复刻 batch-process/index.vue', () => {
  it('批量通过：键顺序 ids → reason → type → attachmentUrl → attachmentName → copyUserIds → variables', () => {
    const payload = buildBatchAuditPayload(
      { taskIds: ['a', 'b'], reason: '同意' },
      { withVariables: true, requireReason: false },
    )
    expect(JSON.stringify(payload)).toBe(
      '{"ids":["a","b"],"reason":"同意","type":0,"attachmentUrl":"","attachmentName":"","copyUserIds":[],"variables":{}}',
    )
  })

  it('批量不通过：**没有 variables 这个键**（页面的两个分支就差这一处）', () => {
    const payload = buildBatchAuditPayload(
      { taskIds: ['a'], reason: '不同意' },
      { withVariables: false, requireReason: true },
    )
    expect('variables' in payload).toBe(false)
    expect(Object.keys(payload)).toEqual(['ids', 'reason', 'type', 'attachmentUrl', 'attachmentName', 'copyUserIds'])
  })

  it('type 恒为 0（页面写死的），且是数字不是字符串', () => {
    const payload = buildBatchAuditPayload({ taskIds: ['a'] }, { withVariables: true, requireReason: false })
    expect(payload.type).toBe(0)
    expect(payload.type).toBe(BATCH_TASK_TYPE)
    expect(typeof payload.type).toBe('number')
  })

  it('多个附件被拼成逗号分隔的**两个字符串**，顺序与数组一致', () => {
    const payload = buildBatchAuditPayload(
      {
        taskIds: ['a'],
        attachments: [
          { url: 'https://oss/1.pdf', name: '1.pdf' },
          { url: 'https://oss/2.png', name: '2.png' },
          { url: 'https://oss/3.csv', name: '3.csv' },
        ],
      },
      { withVariables: false, requireReason: false },
    )
    expect(payload.attachmentUrl).toBe('https://oss/1.pdf,https://oss/2.png,https://oss/3.csv')
    expect(payload.attachmentName).toBe('1.pdf,2.png,3.csv')
  })

  it('没有附件时两个键是空串（不是省略、也不是 undefined）', () => {
    const payload = buildBatchAuditPayload({ taskIds: ['a'] }, { withVariables: false, requireReason: false })
    expect(payload.attachmentUrl).toBe('')
    expect(payload.attachmentName).toBe('')
  })

  it('taskIds 空数组 / 非数组都红（后端 @NotEmpty）', () => {
    expect(() => buildBatchAuditPayload({ taskIds: [] }, { withVariables: false, requireReason: false })).toThrow(/taskIds/)
    expect(() =>
      buildBatchAuditPayload({ taskIds: 'a' as unknown as string[] }, { withVariables: false, requireReason: false }),
    ).toThrow(/taskIds/)
  })

  it('ids 里第 2 个为空时，报错点名 taskIds[1]（三元素用例，别拿单元素蒙混）', () => {
    expect(() =>
      buildBatchAuditPayload({ taskIds: ['a', '', 'c'] }, { withVariables: false, requireReason: false }),
    ).toThrow(/taskIds\[1\]/)
  })

  it('ids 的顺序被原样保留（办理顺序在依次审批里是有意义的）', () => {
    const payload = buildBatchAuditPayload(
      { taskIds: ['z', 'a', 'm'] },
      { withVariables: false, requireReason: false },
    )
    expect(payload.ids).toEqual(['z', 'a', 'm'])
  })

  it('批量不通过必须给理由；批量通过可以不给', () => {
    expect(() =>
      buildBatchAuditPayload({ taskIds: ['a'], reason: '  ' }, { withVariables: false, requireReason: true }),
    ).toThrow(/批量不通过/)
    expect(
      buildBatchAuditPayload({ taskIds: ['a'] }, { withVariables: false, requireReason: false }).reason,
    ).toBe('')
  })

  it('抄送人上限 10：刚好 10 个过，11 个红，报错里写的是 10（边界两侧都测）', () => {
    // 10 / 11 是**写死的**，两端都不用 BATCH_MAX_COPY_USERS 自证——
    // 否则把常量改成 20，断言跟着一起变，等于同义反复（这一条本来就是这么漏过去的）
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const eleven = [...ten, 11]
    expect(BATCH_MAX_COPY_USERS).toBe(10)
    expect(
      buildBatchAuditPayload({ taskIds: ['a'], copyUserIds: ten }, { withVariables: false, requireReason: false })
        .copyUserIds,
    ).toEqual(ten)
    expect(() =>
      buildBatchAuditPayload({ taskIds: ['a'], copyUserIds: eleven }, { withVariables: false, requireReason: false }),
    ).toThrow(/最多 10 人/)
  })
})

// ---------------------------------------------------------------------------
// 4. 载荷：转办 / 委派 / 回退
// ---------------------------------------------------------------------------

describe('转办 / 委派 / 回退的载荷', () => {
  it('转办的 body 键顺序是 id → assigneeUserId → reason（formData 的书写顺序）', async () => {
    const { capability, calls } = makeSdk()
    await capability.transfer({ taskId: 't-1', assigneeUserId: 197832, reason: '我不熟这块' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('put')
    expect(requestPath(calls[0]!)).toBe('/bpm/task/transfer')
    expect(JSON.stringify(bodyOf(calls[0]!))).toBe('{"id":"t-1","assigneeUserId":197832,"reason":"我不熟这块"}')
  })

  it('委派的 body 键顺序是 id → delegateUserId → reason', async () => {
    const { capability, calls } = makeSdk()
    await capability.delegate({ taskId: 't-2', delegateUserId: 16580, reason: '你先看看' })
    expect(requestPath(calls[0]!)).toBe('/bpm/task/delegate')
    expect(JSON.stringify(bodyOf(calls[0]!))).toBe('{"id":"t-2","delegateUserId":16580,"reason":"你先看看"}')
  })

  it('回退的 body 键顺序是 id → targetTaskDefinitionKey → reason（目标是个字符串 Key，不能被转成数字）', async () => {
    const { capability, calls } = makeSdk()
    await capability.returnTask({ taskId: 't-3', targetTaskDefinitionKey: 'Activity_1o1sabd', reason: '退回重填' })
    expect(requestPath(calls[0]!)).toBe('/bpm/task/return')
    expect(JSON.stringify(bodyOf(calls[0]!))).toBe(
      '{"id":"t-3","targetTaskDefinitionKey":"Activity_1o1sabd","reason":"退回重填"}',
    )
  })

  it('三个动作的空理由都红，且**一个请求都不发**（空白与空串两种）', async () => {
    const { capability, calls } = makeSdk()
    await expect(capability.transfer({ taskId: 't', assigneeUserId: 1, reason: '  ' })).rejects.toThrow(/理由/)
    await expect(capability.delegate({ taskId: 't', delegateUserId: 1, reason: '' })).rejects.toThrow(/理由/)
    await expect(
      capability.returnTask({ taskId: 't', targetTaskDefinitionKey: 'Activity_1', reason: '' }),
    ).rejects.toThrow(/理由/)
    expect(calls).toHaveLength(0)
  })

  it('**理由整个不给**（不是空串）也红——后端是 @NotEmpty，不给理由就发不出去', async () => {
    const { capability, calls } = makeSdk()
    await expect(
      capability.transfer({ taskId: 't', assigneeUserId: 1 } as unknown as Parameters<typeof capability.transfer>[0]),
    ).rejects.toThrow(/理由/)
    await expect(
      capability.delegate({ taskId: 't', delegateUserId: 1 } as unknown as Parameters<typeof capability.delegate>[0]),
    ).rejects.toThrow(/理由/)
    await expect(
      capability.returnTask(
        { taskId: 't', targetTaskDefinitionKey: 'Activity_1' } as unknown as Parameters<typeof capability.returnTask>[0],
      ),
    ).rejects.toThrow(/理由/)
    expect(calls).toHaveLength(0)
  })

  it('三个动作的目标为空也红（转办选不出人、回退选不出节点，都不是页面上存在的状态）', async () => {
    const { capability, calls } = makeSdk()
    await expect(capability.transfer({ taskId: 't', assigneeUserId: '' as unknown as number, reason: 'r' }))
      .rejects.toThrow(/assigneeUserId/)
    await expect(capability.delegate({ taskId: 't', delegateUserId: null as unknown as number, reason: 'r' }))
      .rejects.toThrow(/delegateUserId/)
    await expect(
      capability.returnTask({ taskId: 't', targetTaskDefinitionKey: '  ', reason: 'r' }),
    ).rejects.toThrow(/targetTaskDefinitionKey/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 5. 读链路
// ---------------------------------------------------------------------------

describe('办理页的三条读', () => {
  it('instance 打 /bpm/process-instance/get?id=', async () => {
    const { capability, calls } = makeSdk({ id: 'inst-1' })
    await capability.instance('inst-1')
    expect(calls[0]!.method).toBe('get')
    expect(requestPath(calls[0]!)).toBe('/bpm/process-instance/get')
    expect(queryObject(calls[0]!)).toMatchObject({ id: 'inst-1' })
  })

  it('workflowPath 打 /bpm/process-instance/getWorkflowPath?processInstanceId=', async () => {
    const { capability, calls } = makeSdk([])
    await capability.workflowPath('inst-2')
    expect(calls[0]!.method).toBe('get')
    expect(requestPath(calls[0]!)).toBe('/bpm/process-instance/getWorkflowPath')
    expect(queryObject(calls[0]!)).toMatchObject({ processInstanceId: 'inst-2' })
  })

  it('workflowPath 丢掉**顶层** status=4（已取消）的节点，但保留子节点里的', async () => {
    const tree: WorkflowTask[] = [
      { id: 'a', name: 'A', status: TASK_STATUS.CANCEL },
      { id: 'b', name: 'B', status: TASK_STATUS.RUNNING },
      { id: 'c', name: 'C', status: TASK_STATUS.APPROVE, children: [{ id: 'c1', name: 'C1', status: TASK_STATUS.CANCEL }] },
    ]
    const { capability } = makeSdk(tree)
    const flat = await capability.workflowPath('inst-3')
    expect(flat.map((task) => task.id)).toEqual(['b', 'c', 'c1'])
  })

  it('workflowPath 递归展平 children（父 + 两个子 + 一个孙，多元素才算数）', async () => {
    const tree: WorkflowTask[] = [
      {
        id: 'p',
        status: TASK_STATUS.RUNNING,
        children: [
          { id: 'c1', status: TASK_STATUS.RUNNING },
          { id: 'c2', status: TASK_STATUS.APPROVE, children: [{ id: 'g1', status: TASK_STATUS.RUNNING }] },
        ],
      },
      { id: 'q', status: TASK_STATUS.RUNNING },
    ]
    const { capability } = makeSdk(tree)
    expect((await capability.workflowPath('i')).map((task) => task.id)).toEqual(['p', 'c1', 'c2', 'g1', 'q'])
  })

  it('后端 data 为 null 时归一成空数组，不把 null 传出去', async () => {
    const { capability } = makeSdk(null)
    expect(await capability.workflowPath('i')).toEqual([])
    const { capability: c2 } = makeSdk(null)
    expect(await c2.returnOptions('t-1')).toEqual([])
  })

  it('returnOptions 打 /bpm/task/list-by-return?id=', async () => {
    const { capability, calls } = makeSdk([{ name: '发起人自选2', taskDefinitionKey: 'Activity_1o1sabd' }])
    const options = await capability.returnOptions('t-9')
    expect(calls[0]!.method).toBe('get')
    expect(requestPath(calls[0]!)).toBe('/bpm/task/list-by-return')
    expect(queryObject(calls[0]!)).toMatchObject({ id: 't-9' })
    expect(options).toEqual([{ name: '发起人自选2', taskDefinitionKey: 'Activity_1o1sabd' }])
  })
})

// ---------------------------------------------------------------------------
// 6. myRunningTasks：页面的 loadRunningTask 三条判据
// ---------------------------------------------------------------------------

describe('myRunningTasks —— 复刻页面 loadRunningTask() 的三条判据', () => {
  /** 七个状态各来一个 + 一个 null assignee + 一个别人，全部在**同一层** */
  const mixed: WorkflowTask[] = [
    { id: 's0', status: TASK_STATUS.WAIT, assigneeUser: { id: 18243 } },
    { id: 's1', status: TASK_STATUS.RUNNING, assigneeUser: { id: 18243 } },
    { id: 's2', status: TASK_STATUS.APPROVE, assigneeUser: { id: 18243 } },
    { id: 's3', status: TASK_STATUS.REJECT, assigneeUser: { id: 18243 } },
    { id: 's4', status: TASK_STATUS.CANCEL, assigneeUser: { id: 18243 } },
    { id: 's5', status: TASK_STATUS.RETURN, assigneeUser: { id: 18243 } },
    { id: 's6', status: TASK_STATUS.DELEGATE, assigneeUser: { id: 18243 } },
    { id: 's7', status: TASK_STATUS.APPROVING, assigneeUser: { id: 18243 } },
    { id: 'null-assignee', status: TASK_STATUS.RUNNING, assigneeUser: null },
    { id: 'no-assignee-field', status: TASK_STATUS.RUNNING },
    { id: 'someone-else', status: TASK_STATUS.RUNNING, assigneeUser: { id: 16580 } },
  ]

  it('只有 status 1（审批中）与 6（委派中）留下——七个状态一起喂，别只喂两个', async () => {
    const { capability } = makeSdk(mixed)
    const mine = await capability.myRunningTasks('i', 18243)
    expect(mine.map((task) => task.id)).toEqual(['s1', 's6'])
  })

  it('assigneeUser 为 null / 缺字段 / 是别人，三种都被排除', async () => {
    const { capability } = makeSdk(mixed)
    const ids = (await capability.myRunningTasks('i', 18243)).map((task) => task.id)
    expect(ids).not.toContain('null-assignee')
    expect(ids).not.toContain('no-assignee-field')
    expect(ids).not.toContain('someone-else')
  })

  it('userId 的数字/字符串两种形态都认（页面用的是 String(x) 比对）', async () => {
    const { capability } = makeSdk([
      { id: 'a', status: TASK_STATUS.RUNNING, assigneeUser: { id: 18243 } },
      { id: 'b', status: TASK_STATUS.RUNNING, assigneeUser: { id: '18243' } },
      { id: 'c', status: TASK_STATUS.RUNNING, assigneeUser: { id: 18244 } },
    ])
    expect((await capability.myRunningTasks('i', '18243')).map((task) => task.id)).toEqual(['a', 'b'])
    expect((await capability.myRunningTasks('i', 18243)).map((task) => task.id)).toEqual(['a', 'b'])
    expect((await capability.myRunningTasks('i', 18244)).map((task) => task.id)).toEqual(['c'])
  })

  it('比对是**字符串**比对，不是数值比对（"018243" 不该被认成 18243）', async () => {
    // 页面写的是 `String(task.assigneeUser.id) !== String(userId)`。
    // 改成 Number 比对的话 "018243" 会被算成 18243 —— 那是另一个 id，不是同一个人。
    const { capability } = makeSdk([
      { id: 'padded', status: TASK_STATUS.RUNNING, assigneeUser: { id: '018243' } },
      { id: 'exact', status: TASK_STATUS.RUNNING, assigneeUser: { id: '18243' } },
    ])
    expect((await capability.myRunningTasks('i', 18243)).map((task) => task.id)).toEqual(['exact'])
  })

  it('子任务里的「该我办」也会被翻出来（加签产生的 children 同样要判）', async () => {
    const { capability } = makeSdk([
      {
        id: 'parent',
        status: TASK_STATUS.RUNNING,
        assigneeUser: { id: 16580 },
        children: [{ id: 'child', status: TASK_STATUS.RUNNING, assigneeUser: { id: 18243 } }],
      },
    ])
    expect((await capability.myRunningTasks('i', 18243)).map((task) => task.id)).toEqual(['child'])
  })

  it('userId 为空时拒绝，且**一个请求都不发**（给不出身份就别筛，筛了等于没筛）', async () => {
    const { capability, calls } = makeSdk(mixed)
    await expect(capability.myRunningTasks('i', '')).rejects.toThrow(/userId/)
    await expect(capability.myRunningTasks('i', null as unknown as number)).rejects.toThrow(/userId/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 7. 身份：currentUserId
// ---------------------------------------------------------------------------

describe('currentUserId —— 从「我的流程」推身份', () => {
  it('取**第一条**（列表按时间倒序）的 startUser.id，不是最后一条', async () => {
    const { capability, calls } = makeSdk({
      list: [{ startUser: { id: 18243 } }, { startUser: { id: 16580 } }, { startUser: { id: 15012 } }],
      total: 3,
    })
    expect(await capability.currentUserId()).toBe(18243)
    expect(requestPath(calls[0]!)).toBe('/bpm/process-instance/my-page')
    expect(requestQuery(calls[0]!).map(([key]) => key)).toEqual([
      'order', 'orderField', 'name', 'title', 'category', 'pageNo', 'pageSize', '_t',
    ])
    expect(queryObject(calls[0]!)).toMatchObject({
      order: '', orderField: '', name: '', title: '', category: '', pageNo: '1', pageSize: '20',
    })
  })

  it('一条都没有时返回 undefined（**不是**拿别人的 id 顶上）', async () => {
    const { capability } = makeSdk({ list: [], total: 0 })
    expect(await capability.currentUserId()).toBeUndefined()
  })

  it('startUser 缺 id 时也返回 undefined，不会返回 NaN 或字符串', async () => {
    const { capability } = makeSdk({ list: [{ startUser: { nickname: '谁' } }], total: 1 })
    expect(await capability.currentUserId()).toBeUndefined()
  })

  it('id 是字符串时也返回 undefined ——「我是谁」只认真正的数字，不把字符串当 id 发出去', async () => {
    const { capability } = makeSdk({ list: [{ startUser: { id: '18243' } }], total: 1 })
    expect(await capability.currentUserId()).toBeUndefined()
  })

  it('第一页没数据但满页时继续翻（翻页真的会翻，不是只看第一页）', async () => {
    let call = 0
    const pages = [
      { list: Array.from({ length: 20 }, () => ({ startUser: {} })), total: 40 },
      { list: [{ startUser: { id: 999 } }], total: 40 },
    ]
    const { capability } = makeSdk()
    // 直接换适配器：这个用例要的是「翻页」，用 makeSdk 的固定响应表达不了
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    const seen: number[] = []
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      // GET 的 params 已被拦截器拼进 url（platform.js 的 qs-in-interceptor），从 url 里读
      seen.push(Number(new URLSearchParams(String(config.url ?? '').split('?')[1] ?? '').get('pageNo')))
      const data = pages[call++] ?? { list: [], total: 0 }
      return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
    }
    void capability
    const cap = createTaskActionCapability((config) => sdk.call(TASK_ACTION_DETAIL_PAGE_PATH, config))
    expect(await cap.currentUserId()).toBe(999)
    expect(seen).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------
// 8. 转办 / 委派的人选必须带关键字（D6 / H35）
// ---------------------------------------------------------------------------

describe('searchUsers：长选项参数保护', () => {
  it('无关键字也没有部门时拒绝，且一个请求都不发', async () => {
    const { capability, calls } = makeSdk()
    await expect(capability.searchUsers({})).rejects.toThrow(/长选项/)
    expect(calls).toHaveLength(0)
  })

  it('pageSize = -1（全量）被拒绝，且一个请求都不发', async () => {
    const { capability, calls } = makeSdk()
    await expect(capability.searchUsers({ keyword: '姚', pageSize: -1 })).rejects.toThrow(/pageSize/)
    expect(calls).toHaveLength(0)
  })

  it('给了关键字时走 simple-page + nickname（浏览器在办理页上用的就是 simple-page，只是没带关键字）', async () => {
    const { capability, calls } = makeSdk({ list: [], total: 0 })
    await capability.searchUsers({ keyword: '姚', pageSize: 5 })
    expect(requestPath(calls[0]!)).toBe('/system/user/simple-page')
    expect(queryObject(calls[0]!)).toMatchObject({ pageNo: '1', pageSize: '5', nickname: '姚' })
  })

  it('只给部门不给关键字也放行（用户不知道名字时的兜底路径）', async () => {
    const { capability, calls } = makeSdk({ list: [], total: 0 })
    await capability.searchUsers({ deptId: 12 })
    expect(queryObject(calls[0]!)).toMatchObject({ deptId: '12' })
    expect(queryObject(calls[0]!).nickname).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 9. 写操作：打哪个接口、走哪个页面上下文
// ---------------------------------------------------------------------------

describe('写操作打哪个接口', () => {
  it('approve → PUT /bpm/task/approve，body 是 buildApprovePayload 的原样', async () => {
    const { capability, calls } = makeSdk()
    await capability.approve({ taskId: 'task-1', reason: '同意' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('put')
    expect(requestPath(calls[0]!)).toBe('/bpm/task/approve')
    expect(JSON.stringify(bodyOf(calls[0]!))).toBe(
      '{"id":"task-1","reason":"同意","attachmentUrl":"","attachmentName":"","copyUserIds":[]}',
    )
  })

  it('reject → PUT /bpm/task/reject（**不是** POST /bpm/hr/task/reject 那条 KPI 专用的）', async () => {
    const { capability, calls } = makeSdk()
    await capability.reject({ taskId: 'task-1', reason: '不同意' })
    expect(calls[0]!.method).toBe('put')
    expect(requestPath(calls[0]!)).toBe('/bpm/task/reject')
  })

  it('本地校验失败时**一个请求都不发**（省下一次必然失败的写请求）', async () => {
    const { capability, calls } = makeSdk()
    await expect(capability.reject({ taskId: 'task-1', reason: '' })).rejects.toThrow()
    await expect(capability.approve({ taskId: '', reason: 'x' })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('批量两个动作走的是**批量办理页**的页面上下文，不是流程详情页的', async () => {
    const { batchCapability, batchCalls } = makeSdk()
    await batchCapability.batchApprove({ taskIds: ['a', 'b'] })
    await batchCapability.batchReject({ taskIds: ['a'], reason: '不同意' })
    expect(batchCalls.map((call) => requestPath(call))).toEqual(['/bpm/task/batchApprove', '/bpm/task/batchReject'])
    expect(batchCalls.every((call) => call.method === 'put')).toBe(true)
    expect(JSON.stringify(bodyOf(batchCalls[0]!))).toBe(
      '{"ids":["a","b"],"reason":"","type":0,"attachmentUrl":"","attachmentName":"","copyUserIds":[],"variables":{}}',
    )
    expect(JSON.stringify(bodyOf(batchCalls[1]!))).toBe(
      '{"ids":["a"],"reason":"不同意","type":0,"attachmentUrl":"","attachmentName":"","copyUserIds":[]}',
    )
  })

  it('批量办理的本地校验也在发请求之前拦住', async () => {
    const { batchCapability, batchCalls } = makeSdk()
    await expect(batchCapability.batchReject({ taskIds: ['a'], reason: '' })).rejects.toThrow()
    await expect(batchCapability.batchApprove({ taskIds: [] })).rejects.toThrow()
    expect(batchCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 10. 页面上下文：module-type 与 http 实例
// ---------------------------------------------------------------------------

describe('页面上下文', () => {
  it('两条页面路径都算不出 module-type，所以**都不发**这个头（与浏览器一致）', async () => {
    const { capability, calls } = makeSdk({ list: [], total: 0 })
    await capability.instance('i')
    await capability.workflowPath('i')
    await capability.searchUsers({ keyword: 'x' })
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      const headers = call.headers as unknown as Record<string, unknown>
      const moduleType = headers['module-type'] ?? call.moduleType
      expect(moduleType, String(call.url)).toBeUndefined()
    }
  })

  it('批量页那一侧同样不发 module-type', async () => {
    const { batchCapability, batchCalls } = makeSdk()
    await batchCapability.batchApprove({ taskIds: ['a'] })
    const headers = batchCalls[0]!.headers as unknown as Record<string, unknown>
    expect(headers['module-type'] ?? batchCalls[0]!.moduleType).toBeUndefined()
  })

  it('URL 走 platform.js 的 /admin-api 前缀（与基准里的浏览器请求同一个落点）', async () => {
    const { capability, calls } = makeSdk({ list: [], total: 0 })
    await capability.instance('i')
    expect(String((calls[0] as unknown as { baseURL?: string }).baseURL ?? '')).toContain('biz-api-test')
  })
})

// ---------------------------------------------------------------------------
// 11. 基准对齐：读请求与浏览器抓到的逐字段一致
// ---------------------------------------------------------------------------

describe('读请求与浏览器基准对齐', () => {
  it('基准里有三个读，且都是 GET（写请求抓不到，理由写在基准文件里）', () => {
    expect(baseline.requests).toHaveLength(3)
    for (const request of baseline.requests) expect(request.method, request.name).toBe('GET')
  })

  it('第 1、2 条基准的 path 与 query 与 SDK 实现一致（含参数名）', async () => {
    const instanceRequest = baseline.requests[0]!
    const workflowRequest = baseline.requests[1]!
    expect(splitUrl(instanceRequest.url).path).toBe('/bpm/process-instance/get')
    expect(splitUrl(instanceRequest.url).query.map(([key]) => key)).toEqual(['id', '_t'])
    expect(splitUrl(workflowRequest.url).path).toBe('/bpm/process-instance/getWorkflowPath')
    expect(splitUrl(workflowRequest.url).query.map(([key]) => key)).toEqual(['processInstanceId', '_t'])

    const { capability, calls } = makeSdk({ list: [], total: 0 })
    await capability.instance('i')
    await capability.workflowPath('i')
    expect(calls.map((call) => requestPath(call))).toEqual([
      splitUrl(instanceRequest.url).path,
      splitUrl(workflowRequest.url).path,
    ])
    expect(requestQuery(calls[0]!).map(([key]) => key)).toEqual(['id', '_t'])
    expect(requestQuery(calls[1]!).map(([key]) => key)).toEqual(['processInstanceId', '_t'])
  })

  it('第 3 条基准（抄送人）记录的是**无关键字拉全量**，SDK 刻意不照抄——这条差异必须留在基准里', () => {
    const simplePage = baseline.requests[2]!
    const { path, query } = splitUrl(simplePage.url)
    expect(path).toBe('/system/user/simple-page')
    const pairs = Object.fromEntries(query)
    expect(pairs.pageSize).toBe('500')
    // **没有 nickname** —— 这正是 D6/H35 说的长选项，SDK 的 searchUsers 必须带关键字
    expect(pairs.nickname).toBeUndefined()
    expect(simplePage.name).toMatch(/无关键字|全量/)
  })

  it('基准里三个读的请求头集合一致，且都没有 module-type', () => {
    const sets = baseline.requests.map((request) =>
      Object.keys(request.headers).sort().join(','),
    )
    expect(new Set(sets).size).toBe(1)
    for (const request of baseline.requests) {
      expect(Object.keys(request.headers)).not.toContain('module-type')
      expect(Object.keys(request.headers)).toContain('tenant-id')
    }
  })
})
