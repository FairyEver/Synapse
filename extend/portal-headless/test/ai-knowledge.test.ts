import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/capabilities/meeting-room.js'

import {
  AUDIT_STATUS_FAILED,
  AUDIT_STATUS_PENDING,
  AUDIT_STATUS_SUCCESS,
  AI_KNOWLEDGE_REVIEW_PAGE_PATH,
  AI_KNOWLEDGE_REVIEW_PERMISSION,
  AI_KNOWLEDGE_REVIEW_PERMISSION_V1,
  AI_KNOWLEDGE_REVIEW_PERMISSION_V2,
  AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
  AI_KNOWLEDGE_WORKSPACE_PERMISSION,
  AI_KNOWLEDGE_WORKSPACE_PERMISSION_V1,
  AI_KNOWLEDGE_WORKSPACE_PERMISSION_V2,
  KNOWLEDGE_CHANGE_RECORD_AUDIT_PATH,
  KNOWLEDGE_CHANGE_RECORD_LIST_PATH,
  KNOWLEDGE_FILE_ADD_PATH,
  KNOWLEDGE_FILE_DELETE_PATH,
  KNOWLEDGE_FILE_GET_PERMISSION_PATH,
  KNOWLEDGE_FILE_LIST_PATH,
  KNOWLEDGE_FILE_MOVE_PATH,
  KNOWLEDGE_FILE_SET_PERMISSION_PATH,
  KNOWLEDGE_FILE_TYPE_DOCUMENT,
  KNOWLEDGE_FILE_TYPE_FOLDER,
  KNOWLEDGE_FILE_UPDATE_PATH,
  aiKnowledgeCapabilities,
  createAiKnowledgeCapability,
} from '../src/capabilities/ai-knowledge.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; httpInstance?: string }

const here = dirname(fileURLToPath(import.meta.url))

/**
 * 基准 `baseline/ai-knowledge.browser.json`（2026-09-21 抓，**7 条 / 2 页 / 全部 GET**）。
 *
 * 它到位之前这一组是 `describe.skipIf` 挂起的；现在**真跑**，而且**缺文件就是硬失败**
 * （不用 existsSync 兜底 —— 静默跳过会把「没验证」读成「已验证」）。
 *
 * 基准里实际有什么，逐条列在这里，免得后面的人以为它覆盖得更多：
 *
 * | 页面 | 基准里的请求 | 是不是页面自己的契约 |
 * | --- | --- | --- |
 * | 知识空间 | `GET /admin-api/manager/knowledgeFile/list?parentId=0` | ✅ 是（挂载时那条） |
 * | 知识空间 | `GET /admin-api/org/sensitive/info` | ❌ **外壳**（app 布局发的，不属于本页） |
 * | 知识空间 | `GET /admin-api/bpm/task/list-by-category?finished=1&pageNo=1&pageSize=10` | ❌ **外壳**（待办角标） |
 * | 知识审核 | `GET /admin-api/manager/knowledgeChangeRecord/list?order=&orderField=&pageNo=1&pageSize=20` ×2 | ✅ 是（同一条 URL 发了两次） |
 * | 知识审核 | 上面那两条外壳请求各一份 | ❌ 外壳 |
 *
 * ⚠️ **基准里 0 条写请求** ⇒ 五条写能力的契约**没有浏览器证据**，只有源码 + 后端源码 + 真机
 * （见 `docs/pages/知识空间.md` 的「真实验证」）。这一条在本文件里也有断言，别把它读成「已覆盖」。
 * ⚠️ **目录下钻（`parentId=<目录id>`）基准里没有**（抓取方两次没点中，已如实报）。
 */
const BASELINE_FILE = join(here, '../baseline/ai-knowledge.browser.json')

type BaselineRequest = {
  页面?: string
  pagePath?: string
  via?: string
  method?: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}
type Baseline = { requests: BaselineRequest[] }

const BASE: Baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline

/** 页面的两条「外壳请求」——由 app 布局发，**不是**这两页的契约 */
const SHELL_REQUEST_PARTS = ['/org/sensitive/info', '/bpm/task/list-by-category']

/** 按页面 + 方法 + URL 片段取基准里的那一条 */
function reqOf (method: string, urlPart: string, pagePath?: string): BaselineRequest {
  const hit = BASE.requests.find(
    (r) =>
      String(r.method).toUpperCase() === method &&
      r.url.includes(urlPart) &&
      (pagePath === undefined || r.pagePath === pagePath),
  )
  if (!hit) throw new Error(`基准里找不到 ${method} …${urlPart}`)
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

const keysOf = (rawUrl: string): string[] => queryPairs(rawUrl).map(([key]) => key)

/** 去掉 host，并把 `_t` 归一 —— 其余一切原样保留（多一个字符都不行） */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?_&]_t=)\d+/, '$1<ts>')
}

function bodyOf (call: CapturedCall | undefined): Record<string, unknown> | undefined {
  const raw = call?.data
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string') return JSON.parse(raw) as Record<string, unknown>
  return raw as Record<string, unknown>
}

function headersOf (call: CapturedCall | undefined): Record<string, unknown> {
  const raw = call?.headers as unknown as { toJSON?: () => Record<string, unknown> }
  return (raw?.toJSON ? raw.toJSON() : (raw as unknown as Record<string, unknown>)) ?? {}
}

/**
 * 两个页面各一个 `request`（与门面的接法一致）：记录 `call` 收到的配置，
 * 既能比 URL，也能看出请求级声明（实例 / module-type / 请求头）。
 */
function build (respond?: (config: InternalAxiosRequestConfig) => unknown) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    calls.push(config as CapturedCall)
    return {
      data: {
        ret: 'SUCCESS',
        code: 0,
        msg: '',
        data: respond ? respond(config) : { list: [], total: 0 },
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }) as never
  const at = (pagePath: string): PortalRequest =>
    <T,>(config: unknown) => sdk.call<T>(pagePath, { ...(config as object) } as never)
  return {
    calls,
    sdk,
    cap: createAiKnowledgeCapability(
      at(AI_KNOWLEDGE_WORKSPACE_PAGE_PATH),
      at(AI_KNOWLEDGE_REVIEW_PAGE_PATH),
    ),
  }
}

/** 一个最小可用的假响应：一层目录（一个文件夹 + 一份文档） */
const CHILDREN = {
  isAdmin: true,
  list: [
    { id: 11, type: 1, name: 'SDK-TEST-目录', parentId: 0, auditStatus: 2, auditorId: 7 },
    { id: 12, type: 2, name: 'SDK-TEST-文档', parentId: 0, auditStatus: 1, auditorId: null },
  ],
}

// ---------------------------------------------------------------------------
// 请求层：路径前缀、module-type、实例
// ---------------------------------------------------------------------------

describe('请求层：路径前缀与 module-type（conventions 2 / 25）', () => {
  it('页面写的是 /manager/…，实例拦截器补成 /admin-api/manager/…', async () => {
    const { calls, cap } = build()
    await cap.listChildren({ parentId: 0 })
    expect(String(calls[0]?.url)).toMatch(/^\/admin-api\/manager\/knowledgeFile\/list\?/)
    // 能力实现里**不该**手写 /admin-api（那会走 platform.js 的 passthrough 分支）
    expect(KNOWLEDGE_FILE_LIST_PATH.startsWith('/manager/')).toBe(true)
  })

  it('两个页面都**不发** module-type 头（规则表里匹配不到 ⇒ 与浏览器一致）', async () => {
    const { calls, cap } = build()
    await cap.listChildren({ parentId: 0 })
    await cap.listRecords()
    for (const call of calls) {
      const headers = headersOf(call)
      expect(headers['module-type'], `不该有 module-type：${String(call.url)}`).toBeUndefined()
    }
    expect(calls).toHaveLength(2)
  })

  it('两个页面都走 platform 实例 —— 判据是「补了 /admin-api」这一条（只有 platform.js 有这个拦截器）', async () => {
    // 为什么不用 `config.httpInstance` 断言：axios 的 `mergeConfig` 会丢掉它不认识的键，
    // 所以适配器拿到的那份 config 上**没有** `httpInstance` / `moduleType`（实测）。
    // 实例身份的可见证据只有两个：URL 被补了前缀、请求头是 generateHttpHeaders 那一套。
    const { calls, cap } = build()
    await cap.listChildren({ parentId: 0 })
    await cap.listRecords()
    for (const call of calls) {
      expect(String(call.url).startsWith('/admin-api/manager/')).toBe(true)
      const headers = headersOf(call)
      expect(String(headers['tenant-id'])).toBe('1')
      expect(headers['Accept-Language']).toBeDefined()
    }
    // 若实例解析不出来，`sdk.call` 会**拒绝发请求**（conventions 第 26 条），
    // 所以「两条请求都发出去了」本身就是解析成功的证据。
    expect(calls).toHaveLength(2)
  })

  it('只有 GET 会带 _t（防缓存）；POST / PUT / DELETE 不带', async () => {
    const { calls, cap } = build()
    await cap.createFolder({ parentId: 0, name: 'x' })
    await cap.rename({ id: 11, name: 'y' })
    await cap.move({ id: 11, targetParentId: 0 })
    await cap.remove(11)
    await cap.setPermission({ id: 11, isAllManager: 1 })
    await cap.audit({ id: 99, auditStatus: AUDIT_STATUS_SUCCESS })
    for (const call of calls) {
      expect(String(call.url)).not.toContain('_t=')
    }
  })
})

// ---------------------------------------------------------------------------
// 知识空间：读
// ---------------------------------------------------------------------------

describe('知识空间 —— 读（/manager/knowledgeFile/*）', () => {
  it('listChildren 只有 parentId 一个查询参数（**没有分页**，接口本身不分页）', async () => {
    const { calls, cap } = build()
    await cap.listChildren({ parentId: 0 })
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/knowledgeFile/list?parentId=0&_t=<ts>')
    expect(keysOf(String(calls[0]?.url))).toEqual(['parentId', '_t'])
  })

  it('parentId 原样发（数字不归一成字符串，钻目录时换成节点 id）', async () => {
    const { calls, cap } = build()
    await cap.listChildren({ parentId: 4242 })
    expect(String(calls[0]?.url)).toContain('parentId=4242')
  })

  it('parentId 为空当场拒绝、不发请求（页面上根目录是 0，不是空）', async () => {
    const { calls, cap } = build()
    await expect(cap.listChildren({ parentId: '' })).rejects.toThrow(/parentId/)
    await expect(cap.listChildren({} as never)).rejects.toThrow(/parentId/)
    expect(calls).toHaveLength(0)
  })

  it('返回 {isAdmin, list}，且把三个页面自己丢掉的字段留下（parentId / auditStatus / auditorId）', async () => {
    const { cap } = build(() => CHILDREN)
    const result = await cap.listChildren({ parentId: 0 })
    expect(result.isAdmin).toBe(true)
    expect(result.list).toHaveLength(2)
    expect(result.list[0]?.auditStatus).toBe(2)
    expect(result.list[1]?.auditorId).toBeNull()
  })

  it('isAdmin 只认布尔 true：缺字段 / null / 字符串 "false" / 数字 1 都不算', async () => {
    // 后端是 `result.put("isAdmin", isAdmin)`，isAdmin 是 Java boolean ⇒ 真机只会回 true/false。
    // 这条钉的是**反方向**的失败：写成 `Boolean(v)` 的话，字符串 "false" 会变成 true ——
    // 那正是本仓库最怕的那种「看起来正常但是反的」。反证时 ⑨ 号变异就是这一条抓出来的。
    const { cap } = build(() => ({ list: [] }))
    expect((await cap.listChildren({ parentId: 0 })).isAdmin).toBe(false)

    const cases: unknown[] = [undefined, null, 'false', 0, 1, 'true']
    for (const value of cases) {
      const built = build(() => ({ isAdmin: value, list: [] }))
      expect((await built.cap.listChildren({ parentId: 0 })).isAdmin, String(value)).toBe(false)
    }
    const yes = build(() => ({ isAdmin: true, list: [] }))
    expect((await yes.cap.listChildren({ parentId: 0 })).isAdmin).toBe(true)
  })

  it('getPermission 的 id 在**路径**里，不是查询参数；GET 仍然带 _t', async () => {
    const { calls, cap } = build()
    await cap.getPermission(7)
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/knowledgeFile/getPermission/7?_t=<ts>')
    expect(keysOf(String(calls[0]?.url))).toEqual(['_t'])
    expect(KNOWLEDGE_FILE_GET_PERMISSION_PATH).toBe('/manager/knowledgeFile/getPermission')
  })

  it('getPermission 的 id 为空当场拒绝、不发请求', async () => {
    const { calls, cap } = build()
    await expect(cap.getPermission('')).rejects.toThrow(/id/)
    await expect(cap.getPermission(undefined as never)).rejects.toThrow(/id/)
    expect(calls).toHaveLength(0)
  })

  it('prepareCreate / prepareMove 都是**只读**的：只发一条 list，绝不发写请求', async () => {
    const { calls, cap } = build(() => CHILDREN)
    const created = await cap.prepareCreate({ parentId: 0, name: 'SDK-TEST-目录' })
    expect(created.duplicateName).toBe(true)
    expect(created.siblings).toHaveLength(2)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('get')

    const moved = await cap.prepareMove({ targetParentId: 0, name: '别的东西' })
    expect(moved.duplicateName).toBe(false)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.method).toBe('get')
    for (const call of calls) expect(String(call.url)).toContain(KNOWLEDGE_FILE_LIST_PATH)
  })

  it('prepare 不给 name 就不算重名（而不是默认 false 之外的别的语义）', async () => {
    const { cap } = build(() => CHILDREN)
    expect((await cap.prepareCreate({ parentId: 0 })).duplicateName).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 知识空间：写
// ---------------------------------------------------------------------------

describe('知识空间 —— 写（body 键序逐字照抄页面）', () => {
  it('新建目录：POST /add，body 键序 type → name → parentId，type = 1', async () => {
    const { calls, cap } = build()
    await cap.createFolder({ parentId: 0, name: 'SDK-TEST-目录' })
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/knowledgeFile/add')
    expect(calls[0]?.method).toBe('post')
    expect(Object.keys(bodyOf(calls[0]) ?? {})).toEqual(['type', 'name', 'parentId'])
    expect(bodyOf(calls[0])).toEqual({ type: KNOWLEDGE_FILE_TYPE_FOLDER, name: 'SDK-TEST-目录', parentId: 0 })
  })

  it('新建文档：**同一个接口**，只有 type 换成 2', async () => {
    const { calls, cap } = build()
    await cap.createFile({ parentId: 11, name: 'SDK-TEST-文档' })
    expect(String(calls[0]?.url)).toContain(KNOWLEDGE_FILE_ADD_PATH)
    expect(bodyOf(calls[0])).toEqual({ type: KNOWLEDGE_FILE_TYPE_DOCUMENT, name: 'SDK-TEST-文档', parentId: 11 })
  })

  it('新建的名字为空当场拒绝（页面弹窗也拦），不发请求', async () => {
    const { calls, cap } = build()
    await expect(cap.createFolder({ parentId: 0, name: '   ' })).rejects.toThrow(/目录名/)
    await expect(cap.createFile({ parentId: 0, name: '' })).rejects.toThrow(/文档名/)
    expect(calls).toHaveLength(0)
  })

  it('重命名：PUT /update，body 键序 id → name', async () => {
    const { calls, cap } = build()
    await cap.rename({ id: 11, name: 'SDK-TEST-新名' })
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/knowledgeFile/update')
    expect(calls[0]?.method).toBe('put')
    expect(Object.keys(bodyOf(calls[0]) ?? {})).toEqual(['id', 'name'])
    expect(bodyOf(calls[0])).toEqual({ id: 11, name: 'SDK-TEST-新名' })
  })

  it('cancelRename 就是拿旧名字再 update 一次（不是删除变更记录）', async () => {
    const { calls, cap } = build()
    await cap.rename({ id: 11, name: '新名' })
    await cap.cancelRename({ id: 11, originalName: '旧名' })
    expect(String(calls[1]?.url)).toContain(KNOWLEDGE_FILE_UPDATE_PATH)
    expect(calls[1]?.method).toBe('put')
    expect(bodyOf(calls[1])).toEqual({ id: 11, name: '旧名' })
  })

  it('移动：POST /move/{源}/{目标}，**源在前目标在后**，没有请求体', async () => {
    const { calls, cap } = build()
    await cap.move({ id: 11, targetParentId: 0 })
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/knowledgeFile/move/11/0')
    expect(calls[0]?.method).toBe('post')
    expect(calls[0]?.data).toBeUndefined()
    expect(KNOWLEDGE_FILE_MOVE_PATH).toBe('/manager/knowledgeFile/move')
  })

  it('cancelMove 把两个路径参数调过来（回到 originalParentId）', async () => {
    const { calls, cap } = build()
    await cap.move({ id: 11, targetParentId: 99 })
    await cap.cancelMove({ id: 11, originalParentId: 0 })
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/manager/knowledgeFile/move/11/0')
  })

  it('删除：DELETE /delete/{id}，没有查询参数也没有请求体', async () => {
    const { calls, cap } = build()
    await cap.remove(11)
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/knowledgeFile/delete/11')
    expect(calls[0]?.method).toBe('delete')
    expect(calls[0]?.data).toBeUndefined()
    expect(KNOWLEDGE_FILE_DELETE_PATH).toBe('/manager/knowledgeFile/delete')
  })

  it('setPermission：PUT /setPermission，body 键序 id → isAllManager → authManagerIds → authRoleIds → auditorId', async () => {
    const { calls, cap } = build()
    await cap.setPermission({ id: 11, isAllManager: 3, authManagerIds: [5, 6] })
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/knowledgeFile/setPermission')
    expect(calls[0]?.method).toBe('put')
    expect(Object.keys(bodyOf(calls[0]) ?? {})).toEqual([
      'id',
      'isAllManager',
      'authManagerIds',
      'authRoleIds',
      'auditorId',
    ])
    // 页面是 `.join(',')` —— 数组要拼成逗号串，不是数组
    expect(bodyOf(calls[0])).toEqual({
      id: 11,
      isAllManager: 3,
      authManagerIds: '5,6',
      authRoleIds: null,
      auditorId: null,
    })
  })

  it('「全部用户」时两个 id 字段都发 null（不是省略）—— 后端 else 分支会 split(",")', async () => {
    const { calls, cap } = build()
    await cap.setPermission({ id: 11, isAllManager: 1, authManagerIds: [5], authRoleIds: [2] })
    expect(bodyOf(calls[0])).toEqual({
      id: 11,
      isAllManager: 1,
      authManagerIds: null,
      authRoleIds: null,
      auditorId: null,
    })
  })

  it('「指定角色」时 authRoleIds 拼串、authManagerIds 发 null', async () => {
    const { calls, cap } = build()
    await cap.setPermission({ id: 11, isAllManager: 2, authRoleIds: '3,4', auditorId: 7 })
    expect(bodyOf(calls[0])).toEqual({
      id: 11,
      isAllManager: 2,
      authManagerIds: null,
      authRoleIds: '3,4',
      auditorId: 7,
    })
  })

  it('isAllManager 不是 1/2/3 当场拒绝（后端三条 if/else 分支，别的值会掉进最后那条）', async () => {
    const { calls, cap } = build()
    await expect(cap.setPermission({ id: 11, isAllManager: 9 } as never)).rejects.toThrow(/isAllManager/)
    expect(calls).toHaveLength(0)
  })

  it('指定用户 / 指定角色但没给 id 列表：当场拒绝，不发请求', async () => {
    const { calls, cap } = build()
    await expect(cap.setPermission({ id: 11, isAllManager: 3 })).rejects.toThrow(/authManagerIds/)
    await expect(cap.setPermission({ id: 11, isAllManager: 2 })).rejects.toThrow(/authRoleIds/)
    await expect(cap.setPermission({ id: 11, isAllManager: 3, authManagerIds: [] })).rejects.toThrow(/authManagerIds/)
    expect(calls).toHaveLength(0)
  })

  it('cancelSetPermission：把 getPermission 读到的整份原样写回（含 auditorId）', async () => {
    const { calls, cap } = build()
    await cap.cancelSetPermission({
      id: 11,
      previous: { isAllManager: 2, authRoleIds: [3, 4], auditorId: 7 },
    })
    expect(String(calls[0]?.url)).toContain(KNOWLEDGE_FILE_SET_PERMISSION_PATH)
    expect(bodyOf(calls[0])).toEqual({
      id: 11,
      isAllManager: 2,
      authManagerIds: null,
      authRoleIds: '3,4',
      auditorId: 7,
    })
  })

  it('cancelSetPermission 的 previous 缺 isAllManager 当场拒绝（多半是没先 getPermission）', async () => {
    const { calls, cap } = build()
    await expect(cap.cancelSetPermission({ id: 11, previous: {} })).rejects.toThrow(/getPermission/)
    await expect(cap.cancelSetPermission({ id: 11, previous: null as never })).rejects.toThrow(/previous/)
    expect(calls).toHaveLength(0)
  })

  it('「全部用户」那一份 original 也能原样写回（它的 authManagerIds 回显是空数组）', async () => {
    const { calls, cap } = build()
    // 后端 getPermission 在 isAllManager=1 时把 manager_id=0 那行过滤掉了 ⇒ authManagerIds 是 []
    await cap.cancelSetPermission({ id: 11, previous: { isAllManager: 1, authManagerIds: [], auditorId: null } })
    expect(bodyOf(calls[0])).toEqual({
      id: 11,
      isAllManager: 1,
      authManagerIds: null,
      authRoleIds: null,
      auditorId: null,
    })
  })
})

// ---------------------------------------------------------------------------
// 知识审核
// ---------------------------------------------------------------------------

describe('知识审核 —— 读（/manager/knowledgeChangeRecord/list）', () => {
  it('不填筛选时只发 order/orderField/pageNo/pageSize（表单 6 项初值是 null，被 skipNulls 丢掉）', async () => {
    const { calls, cap } = build()
    await cap.listRecords()
    expect(normalize(String(calls[0]?.url))).toBe(
      '/admin-api/manager/knowledgeChangeRecord/list?order=&orderField=&pageNo=1&pageSize=20&_t=<ts>',
    )
    expect(keysOf(String(calls[0]?.url))).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
    expect(KNOWLEDGE_CHANGE_RECORD_LIST_PATH).toBe('/manager/knowledgeChangeRecord/list')
  })

  it('筛选参数的顺序是 order → orderField → 表单 6 项 → submitStartTime/EndTime → 分页', async () => {
    const { calls, cap } = build()
    await cap.listRecords({
      parentFileName: 'SDK-TEST',
      fileName: 'a',
      submitterName: '张三',
      auditorName: '李四',
      auditStatus: AUDIT_STATUS_PENDING,
      auditType: 2,
      submitStartTime: '2026-09-01 00:00:00',
      submitEndTime: '2026-09-21 23:59:59',
      pageNo: 3,
      pageSize: 50,
    })
    expect(keysOf(String(calls[0]?.url))).toEqual([
      'order',
      'orderField',
      'parentFileName',
      'fileName',
      'submitterName',
      'auditStatus',
      'auditorName',
      'auditType',
      'submitStartTime',
      'submitEndTime',
      'pageNo',
      'pageSize',
      '_t',
    ])
    const url = String(calls[0]?.url)
    expect(url).toContain('parentFileName=SDK-TEST')
    expect(url).toContain(`auditStatus=${AUDIT_STATUS_PENDING}`)
    expect(url).toContain('auditType=2')
    expect(url).toContain('submitStartTime=' + encodeURIComponent('2026-09-01 00:00:00'))
    expect(url).toContain('submitEndTime=' + encodeURIComponent('2026-09-21 23:59:59'))
    expect(url).toContain('pageNo=3&pageSize=50')
  })

  it('只看待审：auditStatus=2 是待办箱的判据', async () => {
    const { calls, cap } = build()
    await cap.listRecords({ auditStatus: AUDIT_STATUS_PENDING })
    expect(String(calls[0]?.url)).toContain('auditStatus=2')
    expect(keysOf(String(calls[0]?.url))).toEqual(['order', 'orderField', 'auditStatus', 'pageNo', 'pageSize', '_t'])
  })

  it('返回 {list, total} 原样透出（含 newContent / fileId / auditorId）', async () => {
    const { cap } = build(() => ({
      list: [
        {
          id: 99,
          fileId: 11,
          auditType: 2,
          auditStatus: 2,
          auditorId: 7,
          newContent: 'SDK-TEST-新名',
          fileName: 'SDK-TEST-旧名',
        },
      ],
      total: 1,
    }))
    const page = await cap.listRecords({ auditStatus: 2 })
    expect(page.total).toBe(1)
    expect(page.list[0]?.id).toBe(99)
    // 重命名的目标名字在 newContent 里，文件行的 name 审核通过前不会变
    expect(page.list[0]?.newContent).toBe('SDK-TEST-新名')
  })
})

describe('知识审核 —— 写（PUT /manager/knowledgeChangeRecord/audit）', () => {
  it('审核通过：body 键序 id → auditStatus，值是 1', async () => {
    const { calls, cap } = build()
    await cap.audit({ id: 99, auditStatus: AUDIT_STATUS_SUCCESS })
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/knowledgeChangeRecord/audit')
    expect(calls[0]?.method).toBe('put')
    expect(Object.keys(bodyOf(calls[0]) ?? {})).toEqual(['id', 'auditStatus'])
    expect(bodyOf(calls[0])).toEqual({ id: 99, auditStatus: 1 })
    expect(KNOWLEDGE_CHANGE_RECORD_AUDIT_PATH).toBe('/manager/knowledgeChangeRecord/audit')
  })

  it('审核拒绝：同一个接口，auditStatus 换成 3', async () => {
    const { calls, cap } = build()
    await cap.audit({ id: 99, auditStatus: AUDIT_STATUS_FAILED })
    expect(bodyOf(calls[0])).toEqual({ id: 99, auditStatus: 3 })
  })

  it('auditStatus 只认 1 / 3：传 2（待审核）当场拒绝，不发请求', async () => {
    const { calls, cap } = build()
    await expect(cap.audit({ id: 99, auditStatus: AUDIT_STATUS_PENDING })).rejects.toThrow(/auditStatus/)
    await expect(cap.audit({ id: 99, auditStatus: undefined as never })).rejects.toThrow(/auditStatus/)
    await expect(cap.audit({ id: 99, auditStatus: 0 })).rejects.toThrow(/auditStatus/)
    expect(calls).toHaveLength(0)
  })

  it('id 为空当场拒绝（它不是 fileId，传错那一个后端会 NPE 报 500）', async () => {
    const { calls, cap } = build()
    await expect(cap.audit({ id: '', auditStatus: 1 })).rejects.toThrow(/id/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 能力定义本身：与目录（page-catalog.json）逐字对齐
// ---------------------------------------------------------------------------

describe('九条能力定义与 page-catalog.json 对齐', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string; permission: string; title: string }> }

  it('只有这两个 pagePath，且都在目录里逐字存在（多一个字少一个字都要红）', () => {
    expect(aiKnowledgeCapabilities).toHaveLength(9)
    const paths = new Set(catalog.items.map((item) => item.menuPath))
    for (const capability of aiKnowledgeCapabilities) {
      expect(
        paths.has(capability.pagePath),
        `${capability.id} 的 pagePath 不在目录里：${capability.pagePath}`,
      ).toBe(true)
    }
    expect(new Set(aiKnowledgeCapabilities.map((c) => c.pagePath))).toEqual(
      new Set([AI_KNOWLEDGE_WORKSPACE_PAGE_PATH, AI_KNOWLEDGE_REVIEW_PAGE_PATH]),
    )
  })

  it('permission 用的是 Portal 当前生效的 **v2** 码，与目录里那一份逐字一致', () => {
    const byPath = new Map(catalog.items.map((item) => [item.menuPath, item]))
    for (const capability of aiKnowledgeCapabilities) {
      const entry = byPath.get(capability.pagePath)
      expect(capability.permission, capability.id).toBe(entry?.permission)
    }
    expect(byPath.get(AI_KNOWLEDGE_WORKSPACE_PAGE_PATH)?.permission).toBe(AI_KNOWLEDGE_WORKSPACE_PERMISSION)
    expect(byPath.get(AI_KNOWLEDGE_REVIEW_PAGE_PATH)?.permission).toBe(AI_KNOWLEDGE_REVIEW_PERMISSION)
  })

  it('v1 旧码只用于历史对照，v2 码与路由文件 meta 和当前菜单一致', () => {
    const toV2 = (v1: string): string => v1.replace('/dashboard/platform/', '/dashboard/platform-v2/')
    expect(AI_KNOWLEDGE_WORKSPACE_PERMISSION_V2).toBe(toV2(AI_KNOWLEDGE_WORKSPACE_PERMISSION_V1))
    expect(AI_KNOWLEDGE_REVIEW_PERMISSION_V2).toBe(toV2(AI_KNOWLEDGE_REVIEW_PERMISSION_V1))
    expect(AI_KNOWLEDGE_WORKSPACE_PERMISSION).toBe(AI_KNOWLEDGE_WORKSPACE_PERMISSION_V2)
    expect(AI_KNOWLEDGE_REVIEW_PERMISSION).toBe(AI_KNOWLEDGE_REVIEW_PERMISSION_V2)
    const paths = new Set(catalog.items.map((item) => item.menuPath))
    expect(paths.has('/dashboard/platform-v2/intelligence/knowledge/review/list')).toBe(false)
  })

  it('读写标记：3 条只读 + 6 条写（写的那六条就是页面上有入口的那六个）', () => {
    const writes = aiKnowledgeCapabilities.filter((c) => c.write).map((c) => c.id).sort()
    expect(writes).toEqual([
      'ai-knowledge-review-audit',
      'ai-knowledge-workspace-create',
      'ai-knowledge-workspace-move',
      'ai-knowledge-workspace-remove',
      'ai-knowledge-workspace-rename',
      'ai-knowledge-workspace-set-permission',
    ].sort())
    expect(aiKnowledgeCapabilities.filter((c) => !c.write).map((c) => c.id).sort()).toEqual([
      'ai-knowledge-review-list',
      'ai-knowledge-workspace-list',
      'ai-knowledge-workspace-permission-get',
    ].sort())
  })

  it('能力 id 互不重复，且都带 ai-knowledge- 前缀', () => {
    const ids = aiKnowledgeCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith('ai-knowledge-')).toBe(true)
  })

  it('长选项参数都声明了 lookup（组织树 → 本页读能力；人员 → base-user-search）', () => {
    const byId = new Map(aiKnowledgeCapabilities.map((c) => [c.id, c]))
    const lookupOf = (id: string, name: string): string | undefined =>
      byId.get(id)?.params.find((p) => p.name === name)?.lookup?.capabilityId

    expect(lookupOf('ai-knowledge-workspace-list', 'parentId')).toBe('ai-knowledge-workspace-list')
    expect(lookupOf('ai-knowledge-workspace-create', 'parentId')).toBe('ai-knowledge-workspace-list')
    expect(lookupOf('ai-knowledge-workspace-move', 'targetParentId')).toBe('ai-knowledge-workspace-list')
    expect(lookupOf('ai-knowledge-workspace-set-permission', 'authManagerIds')).toBe('base-user-search')
    expect(lookupOf('ai-knowledge-workspace-set-permission', 'auditorId')).toBe('base-user-search')
    // 角色**没有**候选入口（SDK 里没有角色检索能力），所以它是 text，不许编一个 lookup
    const roleParam = byId.get('ai-knowledge-workspace-set-permission')?.params.find((p) => p.name === 'authRoleIds')
    expect(roleParam?.kind).toBe('text')
    expect(roleParam?.lookup).toBeUndefined()
  })

  it('审核状态 / 审核类型是两个 enum，候选值来自页面本地常量', () => {
    const auditParams = aiKnowledgeCapabilities.find((c) => c.id === 'ai-knowledge-review-audit')?.params ?? []
    expect(auditParams.find((p) => p.name === 'auditStatus')?.options?.map((o) => o.value)).toEqual([1, 3])
    const listParams = aiKnowledgeCapabilities.find((c) => c.id === 'ai-knowledge-review-list')?.params ?? []
    expect(listParams.find((p) => p.name === 'auditType')?.options).toHaveLength(11)
    expect(listParams.find((p) => p.name === 'auditStatus')?.options?.map((o) => o.value)).toEqual([2, 1, 3])
  })

  it('知识空间的列表能力**没有** pageNo / pageSize（这个接口不分页，照抄隔壁会凭空多两个参数）', () => {
    const params = aiKnowledgeCapabilities.find((c) => c.id === 'ai-knowledge-workspace-list')?.params ?? []
    expect(params.map((p) => p.name)).toEqual(['parentId'])
  })
})

// ---------------------------------------------------------------------------
// 与浏览器基准逐字段一致 —— ⚠️ 等 baseline/ai-knowledge.browser.json
// ---------------------------------------------------------------------------

/**
 * 这一组的**期望值来自基准文件本身**（`reqOf` 现取现比），所以它比的是
 * 「我发的请求 == 浏览器发的请求」，不是我写下的字面量。
 *
 * ⚠️ 基准只有 7 条、全是 GET。**写请求一条都没有** ⇒ 下面那两条「写契约没有浏览器证据」的断言
 * 是**刻意**写成断言的：别人误以为写链有基准兜着时，它会红。
 */
describe('与浏览器基准逐字段一致（D20）', () => {
  it('知识空间挂载时那条 list?parentId=0 与基准逐字段一致（含键顺序）', async () => {
    const { calls, cap } = build()
    await cap.listChildren({ parentId: 0 })
    const base = reqOf('GET', '/manager/knowledgeFile/list', AI_KNOWLEDGE_WORKSPACE_PAGE_PATH)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(queryPairs(base.url)).toEqual([
      ['parentId', '0'],
      ['_t', '<ts>'],
    ])
  })

  it('⚠️ 这一页只有 parentId 一个业务参数：基准里**没有** order/orderField/pageNo/pageSize', async () => {
    const base = reqOf('GET', '/manager/knowledgeFile/list', AI_KNOWLEDGE_WORKSPACE_PAGE_PATH)
    for (const key of ['order', 'orderField', 'pageNo', 'pageSize', 'name']) {
      expect(queryPairs(base.url).map(([k]) => k), key).not.toContain(key)
    }
    // 断言的反面由上面那条 `queryPairs(...).toEqual([...])` 兜住：多一个键、少一个键都会红
  })

  it('知识审核挂载时那条 list 与基准逐字段一致，且 pageSize 是 **20**（不是后端的默认 10）', async () => {
    const { calls, cap } = build()
    await cap.listRecords()
    const base = reqOf('GET', '/manager/knowledgeChangeRecord/list', AI_KNOWLEDGE_REVIEW_PAGE_PATH)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(queryPairs(base.url)).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
    // `pageSize=20` 现在有硬证据了。后端这个接口的 `@RequestParam` 默认是 **10**（`KnowledgeChangeRecordController:42-43`），
    // 20 是页面按 `useListPageModule({ styleV2: true })` 发出来的 —— 少了这条断言，写成 10 也没人拦。
    expect(base.url).toContain('pageSize=20')
    expect(base.url).not.toContain('pageSize=10')
  })

  it('知识审核页在基准里把**同一条 URL 发了两次**；能力只发一次（这是页面自己的行为）', async () => {
    const same = BASE.requests.filter((r) => r.url.includes('/manager/knowledgeChangeRecord/list'))
    expect(same).toHaveLength(2)
    expect(normalize(same[0]?.url ?? '')).toBe(normalize(same[1]?.url ?? ''))
    const { calls, cap } = build()
    await cap.listRecords()
    expect(calls).toHaveLength(1)
  })

  it('两个页面全都不发 module-type —— 基准 7 条的 headers 里**都不存在**这个键', async () => {
    // 这是硬证据（conventions 第 2 条：算不出就别发）。按页断言，别只看自己那两条。
    const byPage = new Map<string, BaselineRequest[]>()
    for (const r of BASE.requests) {
      const list = byPage.get(String(r.pagePath)) ?? []
      list.push(r)
      byPage.set(String(r.pagePath), list)
    }
    expect([...byPage.keys()].sort()).toEqual(
      [AI_KNOWLEDGE_WORKSPACE_PAGE_PATH, AI_KNOWLEDGE_REVIEW_PAGE_PATH].sort(),
    )
    for (const [pagePath, list] of byPage) {
      for (const r of list) {
        expect(
          Object.prototype.hasOwnProperty.call(r.headers ?? {}, 'module-type'),
          `${pagePath} 的 ${r.url} 带了 module-type`,
        ).toBe(false)
      }
    }
    // 同一时刻，SDK 自己发的两条也不带
    const { calls, cap } = build()
    await cap.listChildren({ parentId: 0 })
    await cap.listRecords()
    for (const call of calls) {
      expect(headersOf(call)['module-type']).toBeUndefined()
    }
  })

  it('⚠️ 基准里 **0 条写请求** ⇒ 五条写能力的契约没有浏览器证据（只有源码 + 真机）', () => {
    const writes = BASE.requests.filter((r) => String(r.method).toUpperCase() !== 'GET')
    expect(writes).toHaveLength(0)
    // 同一条事实的另一半：基准里也**没有**路径参数的写接口
    for (const part of ['/knowledgeFile/add', '/knowledgeFile/update', '/knowledgeFile/delete', '/knowledgeFile/move', '/setPermission', '/audit']) {
      expect(BASE.requests.some((r) => r.url.includes(part)), part).toBe(false)
    }
  })

  it('目录下钻（parentId=<目录id>）**基准里没有** —— 抓取方两次没点中，那一支仍然只是推断', () => {
    const drills = BASE.requests.filter((r) => r.url.includes('/manager/knowledgeFile/list'))
    expect(drills).toHaveLength(1)
    expect(queryPairs(drills[0]?.url ?? '').find(([k]) => k === 'parentId')?.[1]).toBe('0')
    // 若将来有人重抓基准把下钻抓进来了，这条会红 —— 那时请把 queryPairs 断言补上，别只删这条
  })

  it('两条外壳请求（org/sensitive/info、bpm/task/list-by-category）在基准里，但**能力一条都不发**', async () => {
    for (const part of SHELL_REQUEST_PARTS) {
      expect(BASE.requests.some((r) => r.url.includes(part)), part).toBe(true)
    }
    const { calls, cap } = build()
    await cap.listChildren({ parentId: 0 })
    await cap.listRecords()
    for (const call of calls) {
      for (const part of SHELL_REQUEST_PARTS) {
        expect(String(call.url), part).not.toContain(part)
      }
    }
  })

  it('污染检查：knowledgeFile/** 只出现在知识空间页、knowledgeChangeRecord/** 只出现在知识审核页', () => {
    for (const r of BASE.requests) {
      if (r.url.includes('/manager/knowledgeFile/list')) {
        expect(r.pagePath, r.url).toBe(AI_KNOWLEDGE_WORKSPACE_PAGE_PATH)
      }
      if (r.url.includes('/manager/knowledgeChangeRecord/list')) {
        expect(r.pagePath, r.url).toBe(AI_KNOWLEDGE_REVIEW_PAGE_PATH)
      }
    }
    // 预热页面（抓基准时先访问的那一页）不能漏进来
    expect(BASE.requests.some((r) => r.url.includes('formula/definition'))).toBe(false)
    // 只有测试环境一个 host
    for (const r of BASE.requests) {
      expect(new URL(r.url).host).toBe('biz-api-test.wodecorp.cn')
    }
  })

  it('基准与源码推导**不冲突**：两条页面请求逐字段对得上（所以没有"线上不一致"要记）', async () => {
    const { calls, cap } = build()
    await cap.listChildren({ parentId: 0 })
    await cap.listRecords()
    expect(normalize(String(calls[0]?.url))).toBe(
      normalize(reqOf('GET', '/manager/knowledgeFile/list', AI_KNOWLEDGE_WORKSPACE_PAGE_PATH).url),
    )
    expect(normalize(String(calls[1]?.url))).toBe(
      normalize(reqOf('GET', '/manager/knowledgeChangeRecord/list', AI_KNOWLEDGE_REVIEW_PAGE_PATH).url),
    )
  })
})
