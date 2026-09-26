import type { PortalRequest } from './meeting-room.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 督办事项 → 我的督办」列表及其实际可达的动作。 */
export const MY_URGE_PAGE_PATH = '/dashboard/urge/my-urge/list'
export const MY_URGE_PERMISSION = '/dashboard/urge/my-urge'
export const MY_URGE_DETAIL_PATH = '/dashboard/urge/my-urge/detail'
export const MY_URGE_CREATE_PATH = '/dashboard/urge/create'

const ROOT = '/hr/oversee-task'
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DEGREE_VALUES = new Set([1, 2, 3, 4])

export type MyUrgeId = string | number

export type MyUrgeSupervisor = Record<string, unknown> & {
  id?: MyUrgeId | null
  overseeTaskId?: MyUrgeId | null
  supervisee?: MyUrgeId | null
  superviseeName?: string | null
  isComplete?: 0 | 1 | number | null
  completeDate?: string | null
  completeDetails?: string | null
  url?: string | null
  urlName?: string | null
  isCanEdit?: 0 | 1 | number | null
  isSend?: boolean
}

export type MyUrgeSupervisorOption = Record<string, unknown> & {
  id: MyUrgeId
  realName?: string | null
  username?: string | null
  organizationName?: string | null
}

export type MyUrgeRow = Record<string, unknown> & {
  id: MyUrgeId
  taskName?: string | null
  endDate?: string | null
  degreeType?: number | null
  isComplete?: 0 | 1 | number | null
  tip?: string | null
  superviseeList?: MyUrgeSupervisor[] | null
}

export type MyUrgeDetail = Record<string, unknown> & MyUrgeRow & {
  createTime?: string | null
  supervisor?: MyUrgeId | null
  supervisorName?: string | null
  taskDescription?: string | null
  type?: number | null
  businessId?: MyUrgeId | null
  featureId?: MyUrgeId | null
  isCreator?: 0 | 1 | number | null
  isCanComplete?: 0 | 1 | number | null
}

export type MyUrgeQuery = {
  taskName?: string | null
  superviseeName?: string | null
  endDate?: string | null
  isComplete?: 0 | 1
  pageNo?: number
  pageSize?: number
}

export type MyUrgeSupervisorSearchQuery = {
  keyword: string
  pageNo?: number
}

export type MyUrgeCreateInput = {
  taskName: string
  taskDescription: string
  superviseeList: Array<{ supervisee: MyUrgeId }>
  endDate: string
  degreeType: 1 | 2 | 3 | 4
}

export type MyUrgeCreateDraft = {
  degreeType: 1 | 2 | 3 | 4
  taskName: string
  taskDescription: string
  superviseeList: Array<{ supervisee: MyUrgeId }>
  endDate: string
}

export type MyUrgeDeleteDraft = { id: MyUrgeId }
export type MyUrgeReminderDraft = { taskId: MyUrgeId }
export type MyUrgePersonalReminderDraft = { taskId: MyUrgeId; userId: MyUrgeId }

export type MyUrgeDetailRoute = {
  path: typeof MY_URGE_DETAIL_PATH
  query: { id: MyUrgeId }
}

export type MyUrgeCreateRoute = { path: typeof MY_URGE_CREATE_PATH }

export const MY_URGE_DEGREE_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: 1 | 2 | 3 | 4 }> = [
  { label: '重要紧急', value: 1 },
  { label: '不重要紧急', value: 2 },
  { label: '不重要不紧急', value: 3 },
  { label: '重要不紧急', value: 4 },
]

export const MY_URGE_COMPLETION_OPTIONS: ReadonlyArray<{ label: string; value: 0 | 1 }> = [
  { label: '督办事项', value: 0 },
  { label: '督办完成', value: 1 },
]

function idOf (value: unknown, label: string): MyUrgeId {
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

function degreeTypeOf (value: unknown): 1 | 2 | 3 | 4 {
  if (typeof value !== 'number' || !Number.isInteger(value) || !DEGREE_VALUES.has(value)) {
    throw new Error(`degreeType必须是1到4，收到 ${JSON.stringify(value)}`)
  }
  return value as 1 | 2 | 3 | 4
}

function requiredTextOf (value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}不能为空`)
  if (value.length > maxLength) throw new Error(`${label}不能超过${maxLength}个字符`)
  return value
}

function keywordOf (value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('keyword不能为空；负责人候选必须先给关键字')
  return value
}

function createDraftOf (input: MyUrgeCreateInput | MyUrgeCreateDraft): MyUrgeCreateDraft {
  const source = input as Partial<MyUrgeCreateInput> | null | undefined
  const taskName = requiredTextOf(source?.taskName, 'taskName', 30)
  const taskDescription = requiredTextOf(source?.taskDescription, 'taskDescription', 200)
  const endDate = dateOf(source?.endDate, 'endDate')
  if (endDate < todayInPortalTimeZone()) throw new Error('endDate不能早于今天，与Portal日期选择器一致')
  const degreeType = degreeTypeOf(source?.degreeType)
  if (!Array.isArray(source?.superviseeList) || source.superviseeList.length === 0) {
    throw new Error('superviseeList至少需要选择1名负责人')
  }
  const seen = new Set<string>()
  const superviseeList = source.superviseeList.map((item, index) => {
    const supervisee = idOf(item?.supervisee, `superviseeList[${index}].supervisee`)
    const key = String(supervisee)
    if (seen.has(key)) throw new Error(`superviseeList不能重复选择负责人${key}`)
    seen.add(key)
    return { supervisee }
  })
  return { degreeType, taskName, taskDescription, superviseeList, endDate }
}

function deleteDraftOf (value: unknown, currentIsComplete?: unknown): MyUrgeDeleteDraft {
  if (currentIsComplete !== undefined && currentIsComplete !== 0) throw new Error('只有isComplete=0的督办事项可以撤销')
  const source = value as { id?: unknown } | null | undefined
  return { id: idOf(source?.id, 'id') }
}

function reminderDraftOf (value: unknown, currentIsComplete?: unknown): MyUrgeReminderDraft {
  if (currentIsComplete !== undefined && currentIsComplete !== 0) throw new Error('只有isComplete=0的督办事项可以发送提醒')
  const source = value as { id?: unknown } | null | undefined
  return { taskId: idOf(source?.id, 'id') }
}

function personalReminderDraftOf (value: unknown, currentIsComplete?: unknown): MyUrgePersonalReminderDraft {
  if (currentIsComplete !== undefined && currentIsComplete !== 0) throw new Error('只有未完成的负责人记录可以发送提醒')
  const source = value as { overseeTaskId?: unknown; taskId?: unknown; userId?: unknown } | null | undefined
  return {
    taskId: idOf(source?.overseeTaskId ?? source?.taskId, 'overseeTaskId'),
    userId: idOf(source?.userId, 'userId'),
  }
}

function listParamsOf (query: MyUrgeQuery): Record<string, unknown> {
  const endDate = query.endDate === undefined || query.endDate === null || query.endDate === ''
    ? null
    : dateOf(query.endDate, 'endDate')
  const isComplete = query.isComplete ?? 0
  if (isComplete !== 0 && isComplete !== 1) throw new Error('isComplete只能是0督办事项或1督办完成')
  return {
    order: '',
    orderField: '',
    taskName: query.taskName === undefined ? null : query.taskName,
    superviseeName: query.superviseeName === undefined ? null : query.superviseeName,
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

const currentStatus = p('currentIsComplete', 'enum', false, '来自最新列表/详情的当前任务状态；撤销或提醒仅允许0=未完成', [{ label: '督办事项', value: 0 }, { label: '督办完成', value: 1 }])
const createParams: ParamSpec[] = [
  p('taskName', 'text', true, '督办任务，最多30个字符'),
  p('taskDescription', 'text', true, '任务详情，最多200个字符'),
  p('superviseeList', 'text', true, '负责人ID数组对象；至少1人，来自负责人关键字搜索'),
  p('endDate', 'date', true, '计划完成日期YYYY-MM-DD，不能早于Portal当天'),
  p('degreeType', 'enum', true, '1重要紧急、2不重要紧急、3不重要不紧急、4重要不紧急', MY_URGE_DEGREE_TYPE_OPTIONS.map(item => ({ ...item }))),
]

export const myUrgeCapabilities: CapabilityDefinition[] = [
  { id: 'my-urge-list', title: '查询我发起的督办任务', write: false, params: [p('taskName', 'text', false, '督办内容模糊筛选'), p('superviseeName', 'text', false, '负责人姓名模糊筛选'), p('endDate', 'date', false, '计划完成日期YYYY-MM-DD'), p('isComplete', 'enum', false, '0=督办事项（默认），1=督办完成', MY_URGE_COMPLETION_OPTIONS.map(item => ({ ...item }))), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，Portal默认20，可选10/20/50/100')] },
  { id: 'my-urge-supervisor-search', title: '按关键字搜索发起督办负责人', write: false, params: [p('keyword', 'text', true, '负责人姓名关键字；长选项必须先给关键字'), p('pageNo', 'number', false, '页码，默认1；Portal候选页固定每页5条')] },
  { id: 'my-urge-detail', title: '读取我发起的督办详情', write: false, params: [p('id', 'number', true, '督办任务ID，来自列表行id')] },
  { id: 'my-urge-prepare-create', title: '准备发起督办任务', write: false, params: createParams },
  { id: 'my-urge-create', title: '提交发起督办任务', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的督办任务草稿')] },
  { id: 'my-urge-prepare-delete', title: '准备撤销督办任务', write: false, params: [p('id', 'number', true, '督办任务ID，来自最新列表行id'), currentStatus] },
  { id: 'my-urge-delete', title: '撤销督办任务', write: true, params: [p('draft', 'text', true, 'prepareDelete返回的任务ID草稿')] },
  { id: 'my-urge-prepare-send-message', title: '准备给未完成督办任务群发提醒', write: false, params: [p('id', 'number', true, '督办任务ID，来自最新列表行id'), currentStatus] },
  { id: 'my-urge-send-message', title: '给未完成督办任务群发提醒', write: true, params: [p('draft', 'text', true, 'prepareSendMessage返回的任务ID草稿')] },
  { id: 'my-urge-prepare-send-personal-message', title: '准备给单个负责人发送提醒', write: false, params: [p('overseeTaskId', 'number', true, '督办任务ID，来自详情根id'), p('userId', 'number', true, '负责人ID，来自详情superviseeList[].supervisee'), currentStatus] },
  { id: 'my-urge-send-personal-message', title: '给单个负责人发送提醒', write: true, params: [p('draft', 'text', true, 'prepareSendPersonalMessage返回的任务/负责人草稿')] },
  { id: 'my-urge-prepare-detail', title: '准备打开督办详情页', write: false, params: [p('id', 'number', true, '督办任务ID，来自列表行id')] },
  { id: 'my-urge-prepare-start', title: '准备打开发起督办页', write: false, params: [],
  },
].map(definition => ({
  ...definition,
  pagePath: MY_URGE_PAGE_PATH,
  permission: MY_URGE_PERMISSION,
  moduleType: null,
  httpInstance: 'platform',
}))

export const MY_URGE_METHODS = {
  'my-urge-list': 'list',
  'my-urge-supervisor-search': 'supervisorSearch',
  'my-urge-detail': 'get',
  'my-urge-prepare-create': 'prepareCreate',
  'my-urge-create': 'create',
  'my-urge-prepare-delete': 'prepareDelete',
  'my-urge-delete': 'remove',
  'my-urge-prepare-send-message': 'prepareSendMessage',
  'my-urge-send-message': 'sendMessage',
  'my-urge-prepare-send-personal-message': 'prepareSendPersonalMessage',
  'my-urge-send-personal-message': 'sendPersonalMessage',
  'my-urge-prepare-detail': 'prepareDetail',
  'my-urge-prepare-start': 'prepareStart',
} as const

function successMessageOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}响应必须是非空成功文本`)
  return value
}

export function createMyUrgeCapability (request: PortalRequest) {
  return {
    list (query: MyUrgeQuery = {}): Promise<PageResult<MyUrgeRow>> {
      return request<PageResult<MyUrgeRow>>({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) })
    },

    supervisorSearch (query: MyUrgeSupervisorSearchQuery): Promise<PageResult<MyUrgeSupervisorOption>> {
      const keyword = keywordOf(query?.keyword)
      return request<PageResult<MyUrgeSupervisorOption>>({
        url: '/sys/user/pageInfo',
        method: 'get',
        params: { name: keyword, pageNo: query?.pageNo ?? 1, pageSize: 5 },
      })
    },

    get (input: { id: MyUrgeId }): Promise<MyUrgeDetail> {
      const id = idOf(input?.id, 'id')
      return request<MyUrgeDetail>({ url: `${ROOT}/get`, method: 'get', params: { id } })
    },

    prepareCreate (input: MyUrgeCreateInput): { draft: MyUrgeCreateDraft } {
      return { draft: createDraftOf(input) }
    },

    async create (input: { draft: MyUrgeCreateDraft }): Promise<MyUrgeId> {
      const draft = createDraftOf(input?.draft)
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: draft })
      return idOf(result, '创建督办任务响应')
    },

    prepareDelete (input: { id: MyUrgeId; currentIsComplete?: 0 | 1 }): { draft: MyUrgeDeleteDraft } {
      return { draft: deleteDraftOf(input, input?.currentIsComplete) }
    },

    async remove (input: { draft: MyUrgeDeleteDraft }): Promise<boolean> {
      const draft = deleteDraftOf(input?.draft)
      const result = await request<unknown>({ url: `${ROOT}/delete`, method: 'delete', params: { id: draft.id } })
      if (result !== true) throw new Error('撤销督办任务响应不是true')
      return true
    },

    prepareSendMessage (input: { id: MyUrgeId; currentIsComplete?: 0 | 1 }): { draft: MyUrgeReminderDraft } {
      return { draft: reminderDraftOf(input, input?.currentIsComplete) }
    },

    async sendMessage (input: { draft: MyUrgeReminderDraft }): Promise<string> {
      const draft = reminderDraftOf({ id: input?.draft?.taskId })
      const result = await request<unknown>({ url: `${ROOT}/sendMessage`, method: 'get', params: { taskId: draft.taskId } })
      return successMessageOf(result, '群发提醒')
    },

    prepareSendPersonalMessage (input: { overseeTaskId: MyUrgeId; userId: MyUrgeId; currentIsComplete?: 0 | 1 }): { draft: MyUrgePersonalReminderDraft } {
      return { draft: personalReminderDraftOf(input, input?.currentIsComplete) }
    },

    async sendPersonalMessage (input: { draft: MyUrgePersonalReminderDraft }): Promise<string> {
      const draft = personalReminderDraftOf(input?.draft)
      const result = await request<unknown>({
        url: `${ROOT}/sendPersonalMessage`,
        method: 'post',
        data: null,
        params: { taskId: draft.taskId, userId: draft.userId },
      })
      return successMessageOf(result, '单人提醒')
    },

    prepareDetail (input: { id: MyUrgeId }): MyUrgeDetailRoute {
      return { path: MY_URGE_DETAIL_PATH, query: { id: idOf(input?.id, 'id') } }
    },

    prepareStart (): MyUrgeCreateRoute {
      return { path: MY_URGE_CREATE_PATH }
    },
  }
}

export type MyUrgeCapability = ReturnType<typeof createMyUrgeCapability>
