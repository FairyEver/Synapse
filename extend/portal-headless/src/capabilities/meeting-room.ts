import type { CapabilityDefinition, ParamSpec } from './types.js'

/** 由 SDK 门面注入的请求函数：已带好页面上下文与错误归因 */
export type PortalRequest = <T>(config: {
  url: string
  method: 'get' | 'post' | 'put' | 'delete'
  params?: unknown
  data?: unknown
  /**
   * 原样拿整个响应体、不拆包络。对应前端各实例响应拦截器里的 `isOriginal`
   * （`smart-layer-admin.js:60-62` 等）。只有走 `smart-layer` 那一档的接口会用到。
   */
  isOriginal?: boolean
}) => Promise<T>

/**
 * 会议室 —— 阶段① 的第一条业务线（设计 D32）。
 *
 * 页面上下文：清单第 228 行 `/dashboard/meeting-room/list`
 * 对应路由文件：app/portal/views/dashboard/hr/meeting-room/list.vue
 *
 * 列表页上的维护动作与「会议室预定」是两条不同的业务线：维护动作直接操作
 * 会议室主数据，预定仍由 meeting-application 能力负责。
 */

export const MEETING_ROOM_PAGE_PATH = '/dashboard/meeting-room/list'
export const MEETING_ROOM_PERMISSION = '/dashboard/meeting-room'

export type MeetingRoom = {
  id: number
  name: string
  authorizedOrgId?: number
  authorizedOrgName?: string
  status?: MeetingRoomStatus
  statusName?: string
  updateTime?: string
  updater?: number
  updaterName?: string
  [key: string]: unknown
}

export type MeetingRoomId = number | string
export type MeetingRoomStatus = 0 | 1

export type MeetingRoomPageQuery = {
  pageNo?: number
  pageSize?: number
  name?: string
  authorizedOrgId?: MeetingRoomId
  order?: string
  orderField?: string
}

export type MeetingRoomForm = {
  name: string
  authorizedOrgId: MeetingRoomId
}

export type MeetingRoomUpdateForm = MeetingRoomForm & { id: MeetingRoomId }
export type MeetingRoomCreateDraft = MeetingRoomForm
export type MeetingRoomUpdateDraft = MeetingRoomUpdateForm
export type MeetingRoomDeleteDraft = { id: MeetingRoomId }
export type MeetingRoomStatusDraft = { id: MeetingRoomId; status: MeetingRoomStatus }

export type MeetingRoomStatusPreparation = {
  draft: MeetingRoomStatusDraft
  previous: MeetingRoomStatusDraft
}

/**
 * renren 列表页默认会带上的查询参数（空值也发）。
 * 依据：baseline/meeting-room-page.browser.json 里浏览器真实发出的
 * `order=&orderField=&name=` —— 要做逐字段一致（D20）就必须一并复刻。
 * 对象键的书写顺序也要保持，qs 序列化后就是同样的 URL。
 */
const LIST_DEFAULTS = {
  order: '',
  orderField: '',
  name: '',
} as const

export type PageResult<T> = {
  list: T[]
  total: number
}

export type MeetingRoomUsageItem = {
  meetingRoomId: number
  meetingRoomName: string
  timeSlots: Array<{
    startTime: string
    endTime: string
    userName?: string
    meetingName?: string
  }>
}

export type { MeetingRoomUsageItem as MeetingRoomUsage }

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({
  name,
  kind,
  required,
  description,
})

const roomUpdateFormParam = p('form', 'text', true, '编辑表单对象；包含 id、name、authorizedOrgId，按 Portal 表单规则校验')
const roomDraftParam = p('draft', 'text', true, '对应 prepare 能力返回的会议室请求草稿；不要追加页面未提交的字段')

export const MEETING_ROOM_METHODS = {
  'meeting-room-list': 'list',
  'meeting-room-get': 'get',
  'meeting-room-prepare-create': 'prepareCreate',
  'meeting-room-create': 'create',
  'meeting-room-cancel-create': 'cancelCreate',
  'meeting-room-prepare-update': 'prepareUpdate',
  'meeting-room-update': 'update',
  'meeting-room-cancel-update': 'cancelUpdate',
  'meeting-room-prepare-delete': 'prepareDelete',
  'meeting-room-delete': 'delete',
  'meeting-room-cancel-delete': 'cancelDelete',
  'meeting-room-prepare-update-status': 'prepareUpdateStatus',
  'meeting-room-update-status': 'updateStatus',
  'meeting-room-cancel-update-status': 'cancelUpdateStatus',
} as const

/** Portal 会议室列表页可达的读、表单提交及行操作。 */
export const meetingRoomCapabilities: CapabilityDefinition[] = ([
  {
    id: 'meeting-room-list',
    title: '查询会议室列表',
    pagePath: MEETING_ROOM_PAGE_PATH,
    permission: MEETING_ROOM_PERMISSION,
    write: false,
    params: [
      { name: 'name', kind: 'text', required: false, description: '会议室名称，模糊匹配' },
      {
        name: 'authorizedOrgId',
        kind: 'tree',
        required: false,
        description: '授权组织。成千上万个节点，属于长选项参数，应先问用户关键字再查（设计 D6）',
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 10' },
    ],
  },
  { id: 'meeting-room-get', title: '读取会议室编辑详情', write: false, params: [p('id', 'text', true, '会议室 ID；来自同一列表的 list[].id')] },
  { id: 'meeting-room-prepare-create', title: '准备新建会议室', write: false, params: [p('form', 'text', true, '新建表单对象；包含 name、authorizedOrgId，按 Portal/Java 校验') ] },
  { id: 'meeting-room-create', title: '新建会议室', write: true, params: [roomDraftParam] },
  { id: 'meeting-room-cancel-create', title: '取消新建会议室', write: false, params: [] },
  { id: 'meeting-room-prepare-update', title: '准备编辑会议室', write: false, params: [roomUpdateFormParam] },
  { id: 'meeting-room-update', title: '编辑会议室', write: true, params: [roomDraftParam] },
  { id: 'meeting-room-cancel-update', title: '取消编辑会议室', write: false, params: [] },
  { id: 'meeting-room-prepare-delete', title: '准备删除会议室', write: false, params: [
    p('id', 'text', true, '会议室 ID；来自当前列表行'),
    p('currentStatus', 'enum', true, '当前列表行状态；只有 0（禁用）允许删除',),
  ] },
  { id: 'meeting-room-delete', title: '删除会议室', write: true, params: [roomDraftParam] },
  { id: 'meeting-room-cancel-delete', title: '取消删除会议室', write: false, params: [] },
  { id: 'meeting-room-prepare-update-status', title: '准备启用或禁用会议室', write: false, params: [
    p('id', 'text', true, '会议室 ID；来自当前列表行'),
    p('currentStatus', 'enum', true, '当前列表行状态：1 启用或 0 禁用；提交目标状态按 Portal 逻辑取反',),
  ] },
  { id: 'meeting-room-update-status', title: '启用或禁用会议室', write: true, params: [roomDraftParam] },
  { id: 'meeting-room-cancel-update-status', title: '取消启用或禁用会议室', write: false, params: [] },
] as CapabilityDefinition[]).map(definition => ({
  ...definition,
  pagePath: MEETING_ROOM_PAGE_PATH,
  permission: MEETING_ROOM_PERMISSION,
}))

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): MeetingRoomId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function statusOf (value: unknown, label = 'status'): MeetingRoomStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（禁用）或1（启用）`)
  return value
}

function formOf (value: unknown, label: string): MeetingRoomForm {
  const form = objectOf(value, label)
  if (typeof form.name !== 'string' || form.name.trim() === '') throw new Error(`${label}.name不能为空`)
  if (form.name.length > 50) throw new Error(`${label}.name最多50个字符`)
  return {
    name: form.name,
    authorizedOrgId: idOf(form.authorizedOrgId, `${label}.authorizedOrgId`),
  }
}

function updateFormOf (value: unknown): MeetingRoomUpdateForm {
  const form = objectOf(value, '编辑会议室表单')
  const normalized = formOf(form, '编辑会议室表单')
  return { ...normalized, id: idOf(form.id, '编辑会议室表单.id') }
}

function draftOf<T extends object> (value: unknown, label: string): T {
  return objectOf(value, label) as T
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function createdIdOf (value: unknown): MeetingRoomId {
  return idOf(value, '创建会议室返回的id')
}

export function createMeetingRoomCapability (request: PortalRequest) {
  return {
    /** 分页查询会议室 */
    list (query: MeetingRoomPageQuery = {}): Promise<PageResult<MeetingRoom>> {
      return request<PageResult<MeetingRoom>>({
        url: '/hr/meeting-room/page',
        method: 'get',
        params: { ...LIST_DEFAULTS, ...query },
      })
    },

    /** 单个会议室详情 */
    get (id: MeetingRoomId): Promise<MeetingRoom> {
      return request<MeetingRoom>({ url: '/hr/meeting-room/get', method: 'get', params: { id: idOf(id, '会议室id') } })
    },

    /** 只校验并整理 Portal 新建弹窗提交的两个字段，不发请求。 */
    prepareCreate (input: { form: MeetingRoomForm }): { draft: MeetingRoomCreateDraft } {
      return { draft: formOf(input?.form, '新建会议室表单') }
    },

    /** POST /hr/meeting-room/create；只提交 Portal 表单的两个字段。 */
    async create (input: { draft: MeetingRoomCreateDraft }): Promise<MeetingRoomId> {
      const draft = formOf(draftOf(input?.draft, '新建会议室草稿'), '新建会议室草稿')
      return createdIdOf(await request<unknown>({ url: '/hr/meeting-room/create', method: 'post', data: draft }))
    },

    cancelCreate (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 只校验并整理 Portal 编辑弹窗提交的三个字段，不发请求。 */
    prepareUpdate (input: { form: MeetingRoomUpdateForm }): { draft: MeetingRoomUpdateDraft } {
      const form = updateFormOf(input?.form)
      return { draft: { name: form.name, authorizedOrgId: form.authorizedOrgId, id: form.id } }
    },

    /** PUT /hr/meeting-room/update；body 键与列表页 ModalForm 一致。 */
    async update (input: { draft: MeetingRoomUpdateDraft }): Promise<true> {
      const form = updateFormOf(draftOf(input?.draft, '编辑会议室草稿'))
      return trueResult(await request<unknown>({
        url: '/hr/meeting-room/update',
        method: 'put',
        data: { name: form.name, authorizedOrgId: form.authorizedOrgId, id: form.id },
      }), '编辑会议室')
    },

    cancelUpdate (): { cancelled: true } {
      return { cancelled: true }
    },

    /** Java 端只允许删除禁用中的会议室；当前状态必须来自最新列表行。 */
    prepareDelete (input: { id: MeetingRoomId; currentStatus: MeetingRoomStatus }): { draft: MeetingRoomDeleteDraft } {
      const id = idOf(input?.id, '删除会议室id')
      const currentStatus = statusOf(input?.currentStatus, '删除会议室currentStatus')
      if (currentStatus !== 0) throw new Error('只有当前状态为0（禁用）的会议室才能删除')
      return { draft: { id } }
    },

    /** DELETE /hr/meeting-room/delete/{id}；无 query、无 body。 */
    async delete (input: { draft: MeetingRoomDeleteDraft }): Promise<true> {
      const id = idOf(draftOf<MeetingRoomDeleteDraft>(input?.draft, '删除会议室草稿').id, '删除会议室草稿.id')
      return trueResult(await request<unknown>({ url: `/hr/meeting-room/delete/${id}`, method: 'delete' }), '删除会议室')
    },

    cancelDelete (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 复刻列表行按钮：按当前 status 取反，不能让调用方直接伪造目标状态。 */
    prepareUpdateStatus (input: { id: MeetingRoomId; currentStatus: MeetingRoomStatus }): MeetingRoomStatusPreparation {
      const id = idOf(input?.id, '启停会议室id')
      const currentStatus = statusOf(input?.currentStatus, '启停会议室currentStatus')
      return {
        previous: { id, status: currentStatus },
        draft: { id, status: currentStatus === 1 ? 0 : 1 },
      }
    },

    /** PUT /hr/meeting-room/update-status/{id}?status={target}；body 明确为 null。 */
    async updateStatus (input: { draft: MeetingRoomStatusDraft }): Promise<true> {
      const draft = draftOf<MeetingRoomStatusDraft>(input?.draft, '启停会议室草稿')
      const id = idOf(draft.id, '启停会议室草稿.id')
      const status = statusOf(draft.status, '启停会议室草稿.status')
      return trueResult(await request<unknown>({
        url: `/hr/meeting-room/update-status/${id}`,
        method: 'put',
        params: { status },
        data: null,
      }), '启停会议室')
    },

    cancelUpdateStatus (): { cancelled: true } {
      return { cancelled: true }
    },

    // 会议室占用情况不在这个 controller 下，见 capabilities/meeting-application.ts。
    // 曾误写成 /hr/meeting-room-usage；真实路径是
    // /hr/meeting-application/meeting-room-usage（会议预定表单页 4 处调用均如此）。
  }
}

export type MeetingRoomCapability = ReturnType<typeof createMeetingRoomCapability>
