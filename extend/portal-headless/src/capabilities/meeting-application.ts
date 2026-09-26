import type { CapabilityDefinition } from './types.js'
import type { MeetingRoomUsageItem, PortalRequest } from './meeting-room.js'

/**
 * `/hr/meeting-application/meeting-room-usage` 的响应结构。
 * 实测：返回的是一个对象 `{ organizationId, date, meetingRooms }`，
 * **不是**会议室数组。曾误按数组处理过。
 */
export type MeetingRoomUsageResponse = {
  organizationId?: number
  date?: string
  meetingRooms: MeetingRoomUsageItem[]
}

/**
 * 会议室预定（会议申请）—— 阶段① 第二条业务线。
 *
 * 页面：`/simple/hr/form/033`，入口走「发起流程」：
 *   /dashboard/flow/form/edit?processDefinitionKey=meeting_application&bpmMode=edit
 *     &formCustomCreatePath=simple/hr/form/033
 *
 * 表单字段（实测自真实页面）：会议名称(必填,≤30) / 会议室(必填,下拉) /
 * 时间段(必填,两个日期时间) / 参会人数(必填) / 参会人(选填,≤500)，
 * 另有「查看会议室预定情况」「查看审批流程」两个按钮与提交。
 *
 * 覆盖范围：
 * - 读：流程定义、会议室占用、按关键字搜用户
 * - 写：prepare（只读的准备）→ submit（真提交）→ cancelReservation（撤销）
 *
 * 写链路已在测试环境端到端验证过，且拿到了浏览器侧的逐字段基准
 * （baseline/meeting-application-write.browser.json）——实测 SDK 与浏览器发出的
 * 请求没有差异，包括请求头的键集合。
 */

export const MEETING_APPLICATION_PAGE_PATH = '/dashboard/flow/form/edit'

/**
 * 表单本身的路径。写能力（prepare / submit / cancel）声明在这个页面上下文中，
 * 因为表单字段与校验都属于它；打开表单时真实发生的读操作走上面那个入口路由。
 */
export const MEETING_APPLICATION_FORM_PATH = '/simple/hr/form/033'

/** 流程定义 Key，实测自表单入口 URL */
export const MEETING_APPLICATION_PROCESS_KEY = 'meeting_application'

export type ProcessDefinition = {
  id: string
  key: string
  name: string
  formType?: number
  formCustomCreatePath?: string
  baseUrl?: string
  category?: string
  /** 需要人工指定审批人的节点（服务端会在提交时强校验，见设计 F14） */
  startUserSelectTasks?: Array<{ id: string; name: string }>
  [key: string]: unknown
}

export type SimpleUser = {
  id: number
  nickname?: string
  deptId?: number
  [key: string]: unknown
}

export type SimpleUserQuery = {
  /** 关键字。**长选项参数必须先由用户给出关键字**（设计 D6 / H35） */
  keyword?: string
  deptId?: number
  postName?: string
  pageNo?: number
  pageSize?: number
}

export const meetingApplicationCapabilities: CapabilityDefinition[] = [
  {
    id: 'meeting-application-definition',
    title: '查询会议室审批的流程定义',
    pagePath: MEETING_APPLICATION_PAGE_PATH,
    write: false,
    params: [
      { name: 'key', kind: 'enum', required: true, description: '流程定义 Key，固定为 meeting_application' },
    ],
  },
  {
    id: 'meeting-room-usage',
    title: '查询各会议室的预定占用情况',
    pagePath: MEETING_APPLICATION_PAGE_PATH,
    write: false,
    params: [
      { name: 'date', kind: 'date', required: false, description: '查询日期；不传时按页面默认行为' },
    ],
  },
  {
    id: 'meeting-user-search',
    title: '按关键字搜索参会人 / 审批人',
    pagePath: MEETING_APPLICATION_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: true,
        description: '姓名等关键字。候选人可达数千，禁止无关键字全量拉取（设计 D6 / H35）',
      },
      { name: 'deptId', kind: 'tree', required: false, description: '限定部门' },
      { name: 'pageNo', kind: 'number', required: false },
      { name: 'pageSize', kind: 'number', required: false, description: '建议 ≤50；不要用 -1' },
    ],
  },
  {
    id: 'meeting-application-prepare',
    title: '提交前准备：算出这次需要人工指定哪些审批人',
    pagePath: MEETING_APPLICATION_FORM_PATH,
    write: false,
    params: [
      { name: 'meetingName', kind: 'text', required: true, description: '会议名称，≤30 字' },
      {
        name: 'meetingRoomId',
        kind: 'search',
        required: true,
        description: '会议室 ID。用户给不出这个值，必须从数据里取：先按关键字查会议室候选，再把 id 填进来',
        // 候选来源（G2）：这是整条订会链上唯一一个"用户给不出、必须查"的必填参数。
        // 不登记它，调用方就只能靠猜——`consumption` 里那句"用 lookup 指定的能力查候选"会变成空头承诺。
        lookup: { capabilityId: 'meeting-room-list', keywordParam: 'name' },
      },
      { name: 'startTime', kind: 'date', required: true, description: '开始时间 YYYY-MM-DD HH:mm:ss，分钟只能是 00 或 30' },
      { name: 'endTime', kind: 'date', required: true, description: '结束时间，规则同上；必须晚于开始' },
      { name: 'attendeeCount', kind: 'number', required: true, description: '参会人数' },
      { name: 'attendees', kind: 'text', required: false, description: '参会人，≤500 字' },
    ],
  },
  {
    id: 'meeting-application-submit',
    title: '提交会议室预定申请',
    pagePath: MEETING_APPLICATION_FORM_PATH,
    write: true,
    params: [
      { name: 'meetingName', kind: 'text', required: true, description: '会议名称，≤30 字' },
      {
        name: 'meetingRoomId',
        kind: 'search',
        required: true,
        description: '会议室 ID。用户给不出这个值，必须从数据里取：先按关键字查会议室候选，再把 id 填进来',
        // 与 prepare 同一处候选来源：两个能力收的是同一个 meetingRoomId，
        // 在这里少登记一次，调用方走到 submit 时就又得猜一遍。
        lookup: { capabilityId: 'meeting-room-list', keywordParam: 'name' },
      },
      { name: 'startTime', kind: 'date', required: true, description: 'YYYY-MM-DD HH:mm:ss，分钟只能是 00 或 30' },
      { name: 'endTime', kind: 'date', required: true, description: '必须晚于开始时间' },
      { name: 'attendeeCount', kind: 'number', required: true },
      { name: 'attendees', kind: 'text', required: false },
      {
        name: 'startUserSelectAssignees',
        kind: 'search',
        required: false,
        description: '需人工指定的审批人节点；先调 meeting-application-prepare 问后端要哪些节点（实测会议室流程为 0 个）',
        // 节点 id 来自 prepare 的 tasks，节点里的**人**则要按关键字搜出来（数千候选人，D6）——
        // 所以候选来源是 meeting-user-search，不是"再调一次 prepare"。
        lookup: { capabilityId: 'meeting-user-search', keywordParam: 'keyword' },
      },
    ],
  },
  {
    id: 'meeting-application-cancel',
    title: '取消会议室预定',
    pagePath: MEETING_APPLICATION_FORM_PATH,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '单据 ID，即 submit 的返回值' },
    ],
  },
]

/** 提交载荷。形状来自表单的 formState（`buildSubmitData()` 就是原样展开它）。 */
export type MeetingApplicationDraft = {
  meetingName: string
  meetingRoomId: number
  /** 格式 YYYY-MM-DD HH:mm:ss，分钟只能是 00 或 30 */
  startTime: string
  endTime: string
  attendeeCount: number
  attendees?: string
}

/** 需要人工指定审批人的节点。会议室流程实测为空（见 docs/pages/会议室预定.md） */
export type StartUserSelectTask = {
  id: string
  name: string
  minSelectCount?: number
  maxSelectCount?: number
  approvalDescription?: string
  [key: string]: unknown
}

export type StartUserSelectAssignees = Record<string, number[]>

/**
 * 时间段规则（前端在 `disabledTime` 里实现，服务端也会校验）：
 * 分钟只能是 00 或 30、结束必须晚于开始。
 * 第二条由后端 `validateTime` 强制；第一条前端限制、后端也校验。
 */
export function assertTimeSlot (startTime: string, endTime: string): void {
  const start = new Date(startTime.replace(' ', 'T'))
  const end = new Date(endTime.replace(' ', 'T'))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('时间段格式应为 YYYY-MM-DD HH:mm:ss')
  }
  for (const [label, value] of [['startTime', start], ['endTime', end]] as const) {
    if (value.getMinutes() !== 0 && value.getMinutes() !== 30) {
      throw new Error(`${label} 的分钟只能是 00 或 30`)
    }
    if (value.getSeconds() !== 0) {
      throw new Error(`${label} 的秒只能是 00`)
    }
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error('结束时间必须晚于开始时间')
  }
}

export function buildMeetingApplicationPayload (draft: MeetingApplicationDraft): Record<string, unknown> {
  if (!draft.meetingName || draft.meetingName.length > 30) {
    throw new Error('会议名称必填且不超过 30 字')
  }
  if (draft.meetingRoomId === undefined || draft.meetingRoomId === null) {
    throw new Error('会议室必选')
  }
  if (draft.attendeeCount === undefined || draft.attendeeCount === null) {
    throw new Error('参会人数必填')
  }
  if ((draft.attendees ?? '').length > 500) {
    throw new Error('参会人不超过 500 字')
  }
  assertTimeSlot(draft.startTime, draft.endTime)

  // 与表单一致：create 时 id 为 null，attendees 缺省为空串
  return {
    id: null,
    meetingName: draft.meetingName,
    meetingRoomId: draft.meetingRoomId,
    startTime: draft.startTime,
    endTime: draft.endTime,
    attendeeCount: draft.attendeeCount,
    attendees: draft.attendees ?? '',
  }
}

export function createMeetingApplicationCapability (request: PortalRequest) {
  return {
    /** 流程定义（含需要人工指定审批人的节点） */
    definition (key: string = MEETING_APPLICATION_PROCESS_KEY): Promise<ProcessDefinition> {
      return request<ProcessDefinition>({
        url: '/bpm/process-definition/get',
        method: 'get',
        params: { key },
      })
    },

    /**
     * 各会议室的占用情况。
     *
     * 路径是 `/hr/meeting-application/meeting-room-usage`，不是 `/hr/meeting-room-usage`。
     * 依据：baseline/meeting-application-form.browser.json 与表单页的 4 处调用。
     */
    roomUsage (date?: string): Promise<MeetingRoomUsageResponse> {
      return request<MeetingRoomUsageResponse>({
        url: '/hr/meeting-application/meeting-room-usage',
        method: 'get',
        params: date ? { date } : {},
      })
    },

    /**
     * 按关键字搜索用户。
     *
     * 页面本身的做法是 `simple-page?pageNo=1..9&pageSize=500` —— 一次拉 4500 个用户
     * （实测于 baseline/meeting-application-form.browser.json）。**无头下不能照抄**：
     * 那会把几千条数据塞进 AI 上下文。这里强制要求关键字（设计 D6 / H35）。
     */
    searchUsers (query: SimpleUserQuery): Promise<{ list: SimpleUser[]; total: number }> {
      if (!query.keyword && query.deptId === undefined) {
        return Promise.reject(
          new Error('会议室参选人属于长选项参数：必须提供 keyword 或 deptId，不允许无条件下全量拉取（设计 D6）'),
        )
      }
      if (query.pageSize === -1) {
        return Promise.reject(
          new Error('不允许 pageSize = -1（全量拉取）；请用关键字 + 分页（设计 D6）'),
        )
      }
      return request<{ list: SimpleUser[]; total: number }>({
        url: '/system/user/simple-page',
        method: 'get',
        params: {
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? 20,
          ...(query.keyword ? { nickname: query.keyword } : {}),
          ...(query.deptId === undefined ? {} : { deptId: query.deptId }),
          ...(query.postName ? { postName: query.postName } : {}),
        },
      })
    },

    /**
     * 提交前准备（**只读**）：算出这次提交需要人工指定哪些审批人节点。
     *
     * 与表单的 `handleSubmit` 第一步一致。会议室流程实测返回空
     * （审批链只有「发起 → 发起人 → 结束」），但页面提示流程可能随填写内容变化，
     * 所以提交前必须问一次，不能假定为空。
     */
    async prepare (draft: MeetingApplicationDraft): Promise<{
      payload: Record<string, unknown>
      tasks: StartUserSelectTask[]
    }> {
      const payload = buildMeetingApplicationPayload(draft)
      const tasks = await request<StartUserSelectTask[]>({
        url: '/hr/meeting-application/getRequiredStartUserSelectTasks',
        method: 'post',
        data: payload,
      })
      return { payload, tasks: Array.isArray(tasks) ? tasks : [] }
    },

    /**
     * 真正提交（**写操作**，会创建单据并触发流程）。
     *
     * 调用方必须先走 `prepare()`，把返回的 tasks 交给用户选定后，
     * 以 `{ [task.id]: [userId, ...] }` 的形式传进来。
     */
    async submit (
      draft: MeetingApplicationDraft,
      startUserSelectAssignees: StartUserSelectAssignees = {},
    ): Promise<unknown> {
      // async 不是为了 await，是为了让本地校验失败变成 **rejected promise** 而不是
      // 同步抛出——否则调用方用 try/catch 包 await 会漏掉它。
      // 与 prepare()（本来就是 async）、searchUsers()（显式 Promise.reject）保持一致。
      const payload = buildMeetingApplicationPayload(draft)
      return request({
        url: '/hr/meeting-application/create',
        method: 'post',
        data: { ...payload, startUserSelectAssignees },
      })
    },

    /**
     * 取消预定（**写操作**）。
     *
     * `submit()` 成功时后端返回的是新单据 id，把它传进来即可。
     * 已取消的单据再取消，后端会报「该会议预定已取消，请勿重复操作」。
     */
    async cancelReservation (id: number): Promise<unknown> {
      return request({
        url: `/hr/meeting-application/cancel-reservation/${id}`,
        method: 'put',
      })
    },
  }
}

export type MeetingApplicationCapability = ReturnType<typeof createMeetingApplicationCapability>

/**
 * 组装点（`src/index.ts` / `src/server.ts`）在能力之上加的那一层。
 *
 * 为什么包装放在组装点而不是这里：`withIdempotency` 需要**身份**（租户/用户），
 * 那是会话层的东西，能力模块不该知道。能力模块只定义形状。
 */
export type MeetingApplicationCapabilityWithIdempotency = MeetingApplicationCapability & {
  /**
   * 带短窗口防重的提交（设计 D12）。参数比 `submit` 多一个 `requestId`。
   *
   * **`requestId` 由调用方生成并保管**：超时重试时必须**原样传回上一次的那个**，
   * 每次重新生成等于没有防重。用 `createRequestId()` 生成。
   */
  submitIdempotent: (
    params: MeetingApplicationDraft & {
      requestId: string
      startUserSelectAssignees?: StartUserSelectAssignees
    },
  ) => Promise<unknown>
}
