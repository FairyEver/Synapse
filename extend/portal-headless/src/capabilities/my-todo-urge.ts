import type { PortalRequest } from './meeting-room.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 督办事项 → 我的待办」列表及其实际可达的详情/完成动作。 */
export const MY_TODO_URGE_PAGE_PATH = '/dashboard/urge/my-todo-urge/list'
export const MY_TODO_URGE_PERMISSION = '/dashboard/urge/my-todo-urge'
export const MY_TODO_URGE_DETAIL_PATH = '/dashboard/urge/my-todo-urge/detail'
export const MY_TODO_URGE_CREATE_PATH = '/dashboard/urge/create'

const ROOT = '/hr/supervisee'
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export type MyTodoUrgeId = string | number

export type MyTodoUrgeAssignee = Record<string, unknown> & {
  id?: MyTodoUrgeId | null
  overseeTaskId?: MyTodoUrgeId | null
  supervisee?: MyTodoUrgeId | null
  superviseeName?: string | null
  isComplete?: number | null
  completeDate?: string | null
  completeDetails?: string | null
  url?: string | null
  urlName?: string | null
  isCanEdit?: number | null
}

export type MyTodoUrgeRow = Record<string, unknown> & {
  overseeTaskId: MyTodoUrgeId
  taskName?: string | null
  endDate?: string | null
  degreeType?: number | null
  isComplete?: 0 | 1 | number | null
  tip?: string | null
  superviseeList?: MyTodoUrgeAssignee[] | null
}

export type MyTodoUrgeDetail = Record<string, unknown> & MyTodoUrgeRow & {
  id?: MyTodoUrgeId | null
  supervisor?: MyTodoUrgeId | null
  supervisorName?: string | null
  taskDescription?: string | null
  type?: number | null
  businessId?: MyTodoUrgeId | null
  featureId?: MyTodoUrgeId | null
  isCreator?: 0 | 1 | number | null
  isCanComplete?: 0 | 1 | number | null
}

export type MyTodoUrgeQuery = {
  taskName?: string | null
  endDate?: string | null
  isComplete?: 0 | 1
  pageNo?: number
  pageSize?: number
}

export type MyTodoUrgeCompletionInput = {
  overseeTaskId: MyTodoUrgeId
  /** Portal 文本框的完成说明；源页面的点击处理绕过了 formSubmit，因此空字符串也会发出。 */
  remark?: string | null
  /** 已由 Portal/base-upload-file 上传完成的图片 URL，页面最多保留 5 项。 */
  fileList?: string[]
}

export type MyTodoUrgeCompletionDraft = {
  overseeTaskId: MyTodoUrgeId
  url: string
  isComplete: 1
  completeDetails: string
  completeDate: string
}

export type MyTodoUrgeDetailRoute = {
  path: typeof MY_TODO_URGE_DETAIL_PATH
  query: { id: MyTodoUrgeId }
}

export type MyTodoUrgeCreateRoute = {
  path: typeof MY_TODO_URGE_CREATE_PATH
}

const DEGREE_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '重要紧急', value: 1 },
  { label: '不重要紧急', value: 2 },
  { label: '不重要不紧急', value: 3 },
  { label: '重要不紧急', value: 4 },
]

export const MY_TODO_URGE_DEGREE_TYPE_OPTIONS = DEGREE_TYPE_OPTIONS

export const MY_TODO_URGE_COMPLETION_OPTIONS: ReadonlyArray<{ label: string; value: 0 | 1 }> = [
  { label: '待办事项', value: 0 },
  { label: '已办事项', value: 1 },
]

function idOf (value: unknown, label: string): MyTodoUrgeId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须是正整数ID，收到 ${JSON.stringify(value)}`)
}

function dateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new Error(`${label}必须是YYYY-MM-DD格式，收到 ${JSON.stringify(value)}`)
  }
  return value
}

function todayInPortalTimeZone (now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function completionDetailsOf (value: unknown): string {
  const details = value === undefined || value === null ? '' : value
  if (typeof details !== 'string') throw new Error('完成说明 remark 必须是字符串')
  if (details.length > 500) throw new Error('完成说明 remark 不能超过500个字符')
  return details
}

function fileListOf (value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('附件 fileList 必须是字符串数组')
  if (value.length > 5) throw new Error('附件 fileList 最多5项，与Portal上传控件一致')
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new Error(`附件 fileList[${index}] 必须是非空URL字符串`)
    }
    return item
  })
}

function completionPayloadOf (input: MyTodoUrgeCompletionInput, completeDate: string): MyTodoUrgeCompletionDraft {
  const source = input as Partial<MyTodoUrgeCompletionInput> | null | undefined
  const overseeTaskId = idOf(source?.overseeTaskId, 'overseeTaskId')
  const completeDetails = completionDetailsOf(source?.remark)
  const fileList = fileListOf(source?.fileList)
  return {
    // 键顺序与 complete.vue 的 http.post 载荷一致。
    url: fileList.join(','),
    isComplete: 1,
    completeDetails,
    completeDate: dateOf(completeDate, 'completeDate'),
    overseeTaskId,
  }
}

export function buildMyTodoUrgeCompletionPayload (
  input: MyTodoUrgeCompletionInput,
  completeDate = todayInPortalTimeZone(),
): MyTodoUrgeCompletionDraft {
  const payload = completionPayloadOf(input, completeDate)
  return payload
}

function completionDraftOf (value: unknown): MyTodoUrgeCompletionDraft {
  if (value === null || typeof value !== 'object') throw new Error('缺少完成草稿 draft')
  const draft = value as Partial<MyTodoUrgeCompletionDraft>
  if (draft.isComplete !== 1) throw new Error('完成草稿 isComplete 必须固定为1')
  if (typeof draft.url !== 'string') throw new Error('完成草稿 url 必须是逗号拼接的字符串')
  return {
    url: draft.url,
    isComplete: 1,
    completeDetails: completionDetailsOf(draft.completeDetails),
    completeDate: dateOf(draft.completeDate, 'completeDate'),
    overseeTaskId: idOf(draft.overseeTaskId, 'draft.overseeTaskId'),
  }
}

function listParamsOf (query: MyTodoUrgeQuery): Record<string, unknown> {
  const endDate = query.endDate === undefined || query.endDate === null || query.endDate === ''
    ? null
    : dateOf(query.endDate, 'endDate')
  const isComplete = query.isComplete ?? 0
  if (isComplete !== 0 && isComplete !== 1) throw new Error('isComplete只能是0待办事项或1已办事项')
  return {
    // useListPageModule 在 customLoad 前固定注入这两个空排序字段。
    order: '',
    orderField: '',
    taskName: query.taskName === undefined ? null : query.taskName,
    endDate,
    isComplete,
    pageNo: query.pageNo ?? 1,
    pageSize: query.pageSize ?? 20,
  }
}

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
  ...(options === undefined ? {} : { options }),
})

const listParams: ParamSpec[] = [
  p('taskName', 'text', false, '督办内容模糊筛选；不传时按Portal初值发送null'),
  p('endDate', 'date', false, '计划完成日期筛选，格式YYYY-MM-DD；空值不筛选'),
  p('isComplete', 'enum', false, '0=待办事项（默认），1=已办事项；对应页面右上角切换器', MY_TODO_URGE_COMPLETION_OPTIONS.map(item => ({ ...item }))),
  p('pageNo', 'number', false, '页码，默认1'),
  p('pageSize', 'number', false, '每页条数，Portal默认20，可选10/20/50/100'),
]

export const myTodoUrgeCapabilities: CapabilityDefinition[] = [
  { id: 'my-todo-urge-list', title: '查询我的待办/已办督办事项', write: false, params: listParams },
  { id: 'my-todo-urge-detail', title: '读取督办事项详情', write: false, params: [p('overseeTaskId', 'number', true, '督办任务ID，来自列表行overseeTaskId')] },
  { id: 'my-todo-urge-prepare-complete', title: '准备督办事项完成草稿', write: false, params: [p('overseeTaskId', 'number', true, '督办任务ID，来自列表或详情'), p('remark', 'text', false, '完成说明；最多500字符，Portal当前点击处理允许空字符串'), p('fileList', 'text', false, '已上传附件URL数组；Portal最多5项')] },
  { id: 'my-todo-urge-complete', title: '提交督办事项完成情况', write: true, params: [p('draft', 'text', true, 'prepareComplete返回的完成草稿')] },
  { id: 'my-todo-urge-prepare-detail', title: '准备打开督办事项详情页', write: false, params: [p('overseeTaskId', 'number', true, '督办任务ID，来自列表行overseeTaskId')] },
  { id: 'my-todo-urge-prepare-start', title: '准备打开发起督办页面', write: false, params: [] },
].map(definition => ({
  ...definition,
  pagePath: MY_TODO_URGE_PAGE_PATH,
  permission: MY_TODO_URGE_PERMISSION,
  moduleType: null,
  httpInstance: 'platform',
}))

export const MY_TODO_URGE_METHODS = {
  'my-todo-urge-list': 'list',
  'my-todo-urge-detail': 'getTaskInfo',
  'my-todo-urge-prepare-complete': 'prepareComplete',
  'my-todo-urge-complete': 'complete',
  'my-todo-urge-prepare-detail': 'prepareDetail',
  'my-todo-urge-prepare-start': 'prepareStart',
} as const

export function createMyTodoUrgeCapability (request: PortalRequest) {
  return {
    list (query: MyTodoUrgeQuery = {}): Promise<PageResult<MyTodoUrgeRow>> {
      return request<PageResult<MyTodoUrgeRow>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: listParamsOf(query),
      })
    },

    getTaskInfo (input: { overseeTaskId: MyTodoUrgeId }): Promise<MyTodoUrgeDetail> {
      const taskId = idOf(input?.overseeTaskId, 'overseeTaskId')
      return request<MyTodoUrgeDetail>({
        url: `${ROOT}/getTaskInfo`,
        method: 'get',
        params: { taskId },
      })
    },

    prepareComplete (input: MyTodoUrgeCompletionInput): { draft: MyTodoUrgeCompletionDraft } {
      return { draft: buildMyTodoUrgeCompletionPayload(input) }
    },

    async complete (input: { draft: MyTodoUrgeCompletionDraft }): Promise<boolean> {
      const draft = completionDraftOf(input?.draft)
      const result = await request<unknown>({
        url: `${ROOT}/completedTask`,
        method: 'post',
        data: draft,
      })
      if (result !== true) throw new Error('完成督办事项响应不是true')
      return true
    },

    prepareDetail (input: { overseeTaskId: MyTodoUrgeId }): MyTodoUrgeDetailRoute {
      return {
        path: MY_TODO_URGE_DETAIL_PATH,
        query: { id: idOf(input?.overseeTaskId, 'overseeTaskId') },
      }
    },

    prepareStart (): MyTodoUrgeCreateRoute {
      return { path: MY_TODO_URGE_CREATE_PATH }
    },
  }
}

export type MyTodoUrgeCapability = ReturnType<typeof createMyTodoUrgeCapability>
