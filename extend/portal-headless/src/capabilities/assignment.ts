import type { CapabilityDefinition } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/**
 * 作业管理 —— 阶段① 的**第一条换域 + 普通 CRUD** 业务线。
 *
 * 页面：`/dashboard/assignment/assignment/list`（清单 `generated/page-catalog.json` 第 736 行，
 * domain `assignment`，权限码 `/dashboard/assignment/assignment`）
 * 路由文件：`app/portal/views/dashboard/education/assignment/assignment/list.vue`
 *
 * ## 它与会议室那条线最大的不同：这条不是流程，是普通增删改
 *
 * 会议室预定是**流程类**（`prepare → submit → cancel`，走审批流的
 * `getRequiredStartUserSelectTasks` + `create` + `cancel-reservation`）。
 * 作业管理是 **REST CRUD**，后端没有任何"提交前先问一次"的接口：
 *
 * | 动作 | 请求 | 出处 |
 * | --- | --- | --- |
 * | 列表 | `GET /study/assignment/studyassignment/page` | `list.vue` 的 `getDataListURL` |
 * | 详情 | `GET /study/assignment/studyassignment/{id}` | `[mode]/[id].vue` 的 `customLoad` |
 * | 新建 | `POST /study/assignment/studyassignment` | 同上 `customSubmit`（`isCreateMode`） |
 * | 修改 | `PUT /study/assignment/studyassignment`（整单替换） | 同上（非 create 分支） |
 * | 改状态 | `PUT /study/assignment/studyassignment`，body `{id, status}` | `list.vue` 的 `actionStatus` |
 * | 删除 | `DELETE /study/assignment/studyassignment`，body `[id]` | `list.vue` 的 `actionDelete` |
 *
 * **所以这里刻意没有 `prepare()`。** `prepare` 在会议室那条线上的职责只有一个：
 * 提交前问后端"这次要人工指定哪些审批人"，那个答案会改变提交载荷。这个页面的后端
 * 没有这个接口，硬造一个就是给"读"套上"提交流程"的名字，是假的。
 *
 * 真有一个**只读前置步骤**要说明，但它不是 `prepare`：`update()` 打的是整单替换的 PUT
 * （页面的编辑模式也是先 `GET /{id}` 再把结果铺回表单，见 `[mode]/[id].vue` 的
 * `customLoad` + `{...result}`），所以**调用方必须先 `get()` 拿当前值再改**，否则没传的
 * 字段会被清空。它是独立能力 `get`，不在 `update` 内部代劳——自动合并会把表单不认识的
 * 服务端字段（`creator` / `createTime` / `tenantId` 之类）一并回写，那是没验证过的形状。
 *
 * ## 写链路里只有 create 需要防重（D12 在这里要收窄）
 *
 * `docs/conventions.md` 第 14 条说"后端零幂等，AI 超时重发 = 重复单据"。这句话的**代价**
 * 是"多出一条记录"，而这个页面上只有 `create` 会产生第二条记录：
 *
 * | 写能力 | 重发一次的后果 | 要不要 `requestId` |
 * | --- | --- | --- |
 * | `create` | **多一条作业**（后端零幂等） | **要**（`createIdempotent`） |
 * | `update` | 同样的整单替换再写一次，终态相同 | 不要 |
 * | `setStatus` | 写的是**绝对值**不是开关，终态相同 | 不要 |
 * | `remove` | 记录已经不在，最多一次业务报错，不会多出东西 | 不要 |
 *
 * 后三行的"不要"不是推断，是在测试环境实测过的（`smoke/assignment-crud.mjs`）：
 * 同一个 update 原样重发一次仍只有一条、重复 remove 后端直接返回成功。
 *
 * 注意 `setStatus` 收的是**目标状态**而不是"切换"：页面自己在客户端算好绝对值再发
 * （`record.status === 0 ? 1 : 0`）。做成 toggle 就会变成不幂等的，那是 SDK 自己造的坑。
 *
 * ## `remove` 是**逻辑删除**（实测）
 *
 * 删掉之后 `list` 查不到了，但 `get(id)` **仍然返回这一整行**，只是 `isDel` 从 0 变成 1。
 * 所以：调用方要确认"删干净了没有"，**只能看列表**——拿 `get` 复核会得到一个
 * 看起来像"没删掉"的假象。这是后端行为，SDK 如实透传，不做过滤。
 */

export const ASSIGNMENT_PAGE_PATH = '/dashboard/assignment/assignment/list'

/** 该页的权限码（实测自 `generated/page-catalog.json`） */
export const ASSIGNMENT_PERMISSION = '/dashboard/assignment/assignment'

/**
 * 该页的 module-type。
 *
 * 实测自浏览器：`module-type: 12`（学习管理）。规则来源是
 * `app/portal/menus/index.js:176-192` 的第一条（前缀 `/dashboard/assignment/`），
 * 与 `resolveModuleType(ASSIGNMENT_PAGE_PATH)` 一致。
 *
 * ⚠️ 这个头**不要**当成页面常量去手工加：它是从 cookie `hr-0.0.0-menuPath`
 * 现读的，而那个 cookie 是**浏览器 profile 全局**的。实测多标签页并行时会被别的
 * 标签页覆盖（本页面上抓到过 `11` 与「完全不发」两种异常值）。SDK 按页面路径推导
 * 恰好就是"单标签页正常导航"下的值。
 */
export const ASSIGNMENT_MODULE_TYPE = 12

export type Assignment = {
  /** 后端把 Long 序列化成**字符串**（实测：删除 body 是 `["1071"]`，不是 `[1071]`） */
  id?: string | number
  title?: string
  demand?: string
  type?: number
  status?: number
  endTime?: string
  creatorName?: string
  createTime?: string
  [key: string]: unknown
}

export type AssignmentPageQuery = {
  /** 作业名称，模糊匹配 */
  title?: string
  /** 作业状态。**注意这个参数在本页上语义是坏的**，见 `assignmentCapabilities` 里的说明 */
  status?: string
  /** 作业类型，`ASSIGNMENT_TYPE_OPTIONS` 的 value */
  type?: number | ''
  /** 创建时间起，`YYYY-MM-DD HH:mm:ss` */
  createTimeStart?: string
  /** 创建时间止，`YYYY-MM-DD HH:mm:ss`，**开区间**（用 `buildCreateTimeRange` 生成） */
  createTimeEnd?: string
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

/**
 * renren 列表页默认会带的空值查询参数。
 * 依据：`baseline/assignment-list.browser.json` 里浏览器真实发出的
 * `order=&orderField=&title=&status=&type=&createTimeStart=&createTimeEnd=`
 * —— 一次查询都没加，这些参数照样在。逐字段一致（D20）就必须一并复刻，
 * 且键顺序要保持（qs 序列化后就是同样的 URL）。
 */
const LIST_DEFAULTS = {
  order: '',
  orderField: '',
  title: '',
  status: '',
  type: '',
  createTimeStart: '',
  createTimeEnd: '',
} as const

/** 作业类型。**实测自新建表单的单选按钮**（`assignment_type` 字典的 6 个值） */
export const ASSIGNMENT_TYPE_OPTIONS = [
  { label: '文件', value: 1 },
  { label: '图片+文字', value: 2 },
  { label: '图片', value: 3 },
  { label: '文字', value: 4 },
  { label: '视频', value: 5 },
  { label: '视频+文字', value: 6 },
] as const

/** 分页每页条数默认 20：`useListPageModule` 的 `styleV2` 分支（`list.js:391`） */
const DEFAULT_PAGE_SIZE = 20

/**
 * 作业的新建/修改载荷。
 *
 * 只列**语义上说得通、且无头下真能给**的字段。附件类（参考答案的图片/PDF/视频、
 * 课程核心的对应项）要先把文件传到 OSS 才能给出 URL，SDK 目前不覆盖上传，
 * 因此它们在载荷里**固定发页面创建态的那份默认值**，不开放给调用方。
 */
export type AssignmentDraft = {
  /** 作业名称，必填，≤30 字 */
  title: string
  /** 作业要求，必填，≤200 字 */
  demand: string
  /** 作业类型，必填，见 `ASSIGNMENT_TYPE_OPTIONS` */
  type: number
  /** 作业提交截止时间，必填，`YYYY-MM-DD HH:mm:ss` */
  endTime: string
  /** 是否上传答案。页面用 0/1；默认 0 */
  isUploadAnswer?: number
  /** 答案类型（1 文字 / 2 文件 / 3 图片 / 4 视频）。页面初值是空串 */
  answerType?: number | ''
  /** 答案发布时间，`YYYY-MM-DD HH:mm:ss`；页面初值是 null */
  answerPublishTime?: string | null
  /** 参考答案（文字） */
  textAnswer?: string
  /**
   * 是否上传课程核心。**页面初值是这个字段唯一一个非数字的默认值：空串 `''`**
   * （`[mode]/[id].vue` 的 `form.isUploadCore: ''`）。这里如实复刻，不"顺手改成 0"——
   * 改了请求体就不再与浏览器逐字段一致（D20）。
   */
  isUploadCore?: number | ''
  coreType?: number | ''
  corePublishTime?: string | null
  textCore?: string
  /** 是否需要自评。默认 0 */
  isSelfScoring?: number
  /** 自评截止时间，页面初值 null */
  selfScoringEndTime?: string | null
  /** 是否需要讲师评分。默认 0 */
  isTeacherCheck?: number
  /** 评分模式，页面初值空串 */
  scoreType?: number | ''
}

/** 修改用的载荷：整单替换，多一个 `id` */
export type AssignmentUpdateDraft = AssignmentDraft & {
  /** 记录 id，来自 `list()` / `get()`。数字会被转成字符串（后端就是这么给的） */
  id: string | number
}

export type AssignmentStatus = 0 | 1

/** 把 id 归一成字符串：后端把 Long 序列化成字符串，浏览器回传的也是字符串 */
function normalizeId (id: string | number): string {
  const value = typeof id === 'number' ? String(id) : id.trim()
  if (value === '') {
    throw new Error('作业 id 不能为空')
  }
  return value
}

/**
 * 把「创建时间」的日期区间转成列表接口收的两个参数。
 *
 * 页面的 `convertFetchForm`（`list.vue`）对用户选的两天是这么处理的：
 *
 * ```js
 * createTimeStart = date[0].startOf('date').format('YYYY-MM-DD HH:mm:ss')
 * createTimeEnd   = date[1].startOf('date').add(1, 'day').format('YYYY-MM-DD HH:mm:ss')
 * ```
 *
 * 也就是 **结束日 +1 天，是开区间**。实测（`baseline/assignment-list-daterange.browser.json`）：
 * 选 2026-09-01 ~ 2026-09-05，浏览器发的是
 * `createTimeStart=2026-09-01 00:00:00&createTimeEnd=2026-09-06 00:00:00`。
 *
 * 这个 +1 天不写出来就会**静默少一天**（选到 9-05 却查不到 9-05 当天的数据），
 * 所以单独给一个函数，而不是让调用方自己拼。
 */
export function buildCreateTimeRange (
  startDate: string,
  endDate: string,
): { createTimeStart: string; createTimeEnd: string } {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00`)
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('创建时间区间应为 YYYY-MM-DD（或带时间的同格式字符串）')
  }
  if (end.getTime() < start.getTime()) {
    throw new Error('创建时间的结束日必须不早于开始日')
  }
  const pad = (value: number): string => String(value).padStart(2, '0')
  const format = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  // 结束日 +1 天，与页面的 add(1, 'day') 一致；跨月跨年由 Date 自己进位
  const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000)
  return { createTimeStart: format(start), createTimeEnd: format(endExclusive) }
}

/** 两个日期时间字符串的格式（页面用 `value-format="YYYY-MM-DD HH:mm:ss"`） */
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

function assertDateTime (label: string, value: string | null | undefined): void {
  if (value === null || value === undefined || value === '') return
  if (!DATE_TIME_PATTERN.test(value)) {
    throw new Error(`${label} 的格式应为 YYYY-MM-DD HH:mm:ss，收到的是 ${JSON.stringify(value)}`)
  }
}

/**
 * 构造新建/修改的请求体。
 *
 * **逐字段复刻页面 `customSubmit` 的 `submitData`**，包括键的书写顺序——D20 要求
 * 与浏览器发出的请求逐字段一致，键顺序不同也算不一致。
 * 基准：`baseline/assignment-write.browser.json`。
 *
 * 关于校验的边界（有意为之）：这里只强制页面**无条件**要求的那四条
 * （作业名称、作业要求、作业类型、作业提交截止时间）。页面还有几条**条件必填**
 * （`isUploadAnswer === 1` 时要求答案类型与发布时间，`isTeacherCheck === 1` 时要求
 * 评分模式，修改时截止时间不能早于当前时间），以及长度上限——那些是**前端表单规则**，
 * 后端未必校验，SDK 不代为强制（强制了会把后端本来接受的调用挡在门外）。
 * 条件规则的出处逐条写在 `docs/pages/作业管理.md`。
 */
export function buildAssignmentPayload (draft: AssignmentDraft): Record<string, unknown> {
  if (!draft.title || draft.title.length > 30) {
    throw new Error('作业名称必填且不超过 30 字')
  }
  if (!draft.demand || draft.demand.length > 200) {
    throw new Error('作业要求必填且不超过 200 字')
  }
  if (draft.type === undefined || draft.type === null || draft.type === ('' as unknown)) {
    throw new Error('作业类型必填')
  }
  if (!draft.endTime) {
    throw new Error('作业提交截止时间必填')
  }
  assertDateTime('作业提交截止时间', draft.endTime)
  assertDateTime('答案发布时间', draft.answerPublishTime)
  assertDateTime('课程核心发布时间', draft.corePublishTime)
  assertDateTime('自评截止时间', draft.selfScoringEndTime)

  // 键顺序原样照抄浏览器抓下来的 body；附件类字段固定发页面创建态的默认值。
  return {
    title: draft.title,
    demand: draft.demand,
    type: draft.type,
    endTime: draft.endTime,
    isUploadAnswer: draft.isUploadAnswer ?? 0,
    answerType: draft.answerType ?? '',
    answerPublishTime: draft.answerPublishTime ?? null,
    imageAnswer: [],
    fileAnswer: '',
    fileAnswerName: '',
    videoAnswer: '',
    textAnswer: draft.textAnswer ?? '',
    isUploadCore: draft.isUploadCore ?? '',
    coreType: draft.coreType ?? '',
    corePublishTime: draft.corePublishTime ?? null,
    imageCore: [],
    fileCore: '',
    fileCoreName: '',
    videoCores: '',
    textCore: draft.textCore ?? '',
    isSelfScoring: draft.isSelfScoring ?? 0,
    selfScoringEndTime: draft.selfScoringEndTime ?? null,
    isTeacherCheck: draft.isTeacherCheck ?? 0,
    scoreType: draft.scoreType ?? '',
  }
}

/**
 * 能力定义。
 *
 * 关于 `status` 参数的一个实测结论（**这条在本页上是坏的，如实记下来而不是粉饰**）：
 * 页面把「作业状态」的字典写成了 `type="status"`，而 `status` 是**全平台共用的字典 key**，
 * 实测它装的是**交易状态**（`TRADE_FINISHED` / `WAIT_BUYER_PAY` …），不是作业状态。
 * 证据：下拉里的选项是「待确认 / 等待付款 / 处理中 / 已完成 / 已关闭」，
 * 选中后请求里是 `status=TRADE_FINISHED`；而列表里作业自身的状态列**渲染为空**
 * （作业的 status 是 0/1，在这份字典里找不到对应项）。
 *
 * 所以这里**不把 status 声明成 enum**：那等于把一份错误的候选值当契约发给 AI。
 * 它如实声明成 text，并在描述里写清它的真实取值来自哪个字典。
 */
export const assignmentCapabilities: CapabilityDefinition[] = [
  {
    id: 'assignment-list',
    title: '查询作业列表',
    pagePath: ASSIGNMENT_PAGE_PATH,
    permission: ASSIGNMENT_PERMISSION,
    write: false,
    params: [
      { name: 'title', kind: 'text', required: false, description: '作业名称，模糊匹配' },
      {
        name: 'status',
        kind: 'text',
        required: false,
        description:
          '作业状态。⚠️ 本页的取值来自全平台共用的 status 字典，实测装的是交易状态' +
          '（如 TRADE_FINISHED），不是作业自己的状态——传之前先确认这个值是你要的',
      },
      {
        name: 'type',
        kind: 'enum',
        required: false,
        description: '作业类型',
        options: ASSIGNMENT_TYPE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
      {
        name: 'createTimeStart',
        kind: 'date',
        required: false,
        description: '创建时间起 YYYY-MM-DD HH:mm:ss；与 createTimeEnd 成对，用 buildCreateTimeRange 生成',
      },
      {
        name: 'createTimeEnd',
        kind: 'date',
        required: false,
        description:
          '创建时间止 YYYY-MM-DD HH:mm:ss。**开区间**：页面是「结束日 +1 天」（D6 式的坑，' +
          '自己拼容易少一天），用 buildCreateTimeRange 生成',
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
    ],
  },
  {
    id: 'assignment-get',
    title: '查询单条作业详情',
    pagePath: ASSIGNMENT_PAGE_PATH,
    permission: ASSIGNMENT_PERMISSION,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '作业 id，来自 assignment-list。也会返回**已逻辑删除**的行（isDel=1），' +
          '判断"还在不在"要用 assignment-list 而不是这里',
      },
    ],
  },
  {
    id: 'assignment-create',
    title: '新建作业',
    pagePath: ASSIGNMENT_PAGE_PATH,
    permission: ASSIGNMENT_PERMISSION,
    write: true,
    params: [
      { name: 'title', kind: 'text', required: true, description: '作业名称，≤30 字' },
      { name: 'demand', kind: 'text', required: true, description: '作业要求，≤200 字' },
      {
        name: 'type',
        kind: 'enum',
        required: true,
        description: '作业类型',
        options: ASSIGNMENT_TYPE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
      { name: 'endTime', kind: 'date', required: true, description: '作业提交截止时间 YYYY-MM-DD HH:mm:ss' },
      { name: 'isUploadAnswer', kind: 'boolean', required: false, description: '是否上传答案，0/1，默认 0' },
      { name: 'answerType', kind: 'enum', required: false, description: '答案类型，页面初值为空' },
      { name: 'answerPublishTime', kind: 'date', required: false, description: '答案发布时间' },
      { name: 'textAnswer', kind: 'text', required: false, description: '参考答案（文字）' },
      { name: 'isUploadCore', kind: 'text', required: false, description: '是否上传课程核心，页面初值为空串' },
      { name: 'selfScoringEndTime', kind: 'date', required: false, description: '自评截止时间' },
      { name: 'isSelfScoring', kind: 'boolean', required: false, description: '是否需要自评，0/1，默认 0' },
      { name: 'isTeacherCheck', kind: 'boolean', required: false, description: '是否需要讲师评分，0/1，默认 0' },
    ],
  },
  {
    id: 'assignment-update',
    title: '修改作业（整单替换）',
    pagePath: ASSIGNMENT_PAGE_PATH,
    permission: ASSIGNMENT_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description: '作业 id。**先调 assignment-get 拿当前值**：这个接口是整单替换，没传的字段会被清空',
      },
      { name: 'title', kind: 'text', required: true, description: '作业名称，≤30 字' },
      { name: 'demand', kind: 'text', required: true, description: '作业要求，≤200 字' },
      {
        name: 'type',
        kind: 'enum',
        required: true,
        description: '作业类型',
        options: ASSIGNMENT_TYPE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
      { name: 'endTime', kind: 'date', required: true, description: '作业提交截止时间' },
    ],
  },
  {
    id: 'assignment-set-status',
    title: '启用 / 停用作业',
    pagePath: ASSIGNMENT_PAGE_PATH,
    permission: ASSIGNMENT_PERMISSION,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '作业 id' },
      {
        name: 'status',
        kind: 'enum',
        required: true,
        description: '**目标状态**（1 启用 / 0 停用），不是"切换"。写绝对值才可重发',
        options: [
          { label: '启用', value: 1 },
          { label: '停用', value: 0 },
        ],
      },
    ],
  },
  {
    id: 'assignment-remove',
    title: '删除作业',
    pagePath: ASSIGNMENT_PAGE_PATH,
    permission: ASSIGNMENT_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '作业 id。**逻辑删除**：删完列表查不到，但 assignment-get 仍返回这一行（isDel=1）；' +
          '要确认删掉了请看 assignment-list，不要看 assignment-get',
      },
    ],
  },
]

export function createAssignmentCapability (request: PortalRequest) {
  return {
    /**
     * 分页查询作业。
     *
     * 基准：`baseline/assignment-list.browser.json`（浏览器点「查询」时发出的真实请求）。
     */
    async list (query: AssignmentPageQuery = {}): Promise<PageResult<Assignment>> {
      return request<PageResult<Assignment>>({
        url: '/study/assignment/studyassignment/page',
        method: 'get',
        params: {
          ...LIST_DEFAULTS,
          ...query,
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        },
      })
    },

    /** 单条作业详情。页面的编辑态就是先打它 */
    async get (id: string | number): Promise<Assignment> {
      return request<Assignment>({
        url: `/study/assignment/studyassignment/${normalizeId(id)}`,
        method: 'get',
      })
    },

    /**
     * 新建（**写操作**）。
     *
     * 会真的建出一条作业。后端零幂等，重发一次就是两条——所以门面上暴露的
     * `createIdempotent` 才是给 AI 用的那个（D12），这里保留无防重的原函数。
     */
    async create (draft: AssignmentDraft): Promise<unknown> {
      return request({
        url: '/study/assignment/studyassignment',
        method: 'post',
        data: buildAssignmentPayload(draft),
      })
    },

    /**
     * 修改（**写操作**）。
     *
     * **整单替换**：请求体是 `buildAssignmentPayload(...)` 加上 `id`，页面也是把
     * `GET /{id}` 的结果铺回表单后整份 PUT。没传的字段会按默认值写回去，
     * 所以调用方必须先 `get()` 拿当前值。本函数**不代为合并**——自动合并会把表单
     * 不认识的服务端字段（`creator` / `createTime` / …）一并回写，那形状没被验证过。
     */
    async update (draft: AssignmentUpdateDraft): Promise<unknown> {
      return request({
        url: '/study/assignment/studyassignment',
        method: 'put',
        data: { ...buildAssignmentPayload(draft), id: normalizeId(draft.id) },
      })
    },

    /**
     * 改启用状态（**写操作**）。
     *
     * 页面在客户端算好绝对值再发（`actionStatus`），所以收的是目标状态而不是"切换"。
     * 载荷只有两个键、顺序与浏览器一致：`{ id, status }`。
     *
     * `id` 发**字符串**是照抄浏览器的：后端的 Long 序列化成字符串，`record.id` 就是
     * `"1071"`，回传时原样带回去（基准里是 `{"id":"1071","status":0}`）。
     */
    async setStatus (id: string | number, status: AssignmentStatus): Promise<unknown> {
      if (status !== 0 && status !== 1) {
        throw new Error('作业状态只能是 1（启用）或 0（停用）')
      }
      return request({
        url: '/study/assignment/studyassignment',
        method: 'put',
        data: { id: normalizeId(id), status },
      })
    },

    /**
     * 删除（**写操作**）。
     *
     * 页面的 `actionDelete` 打的是 `http.delete(url, { data: ids })`，
     * 即 **body 是一个 id 数组**（`["1071"]`），不是路径参数——虽然
     * `common/libs/renren/list.js` 的通用删除是 `${deleteURL}/${id}`，
     * 这个页面用自己的实现覆盖掉了。
     *
     * ⚠️ **这是逻辑删除**（实测）：删完 `list()` 查不到，但 `get(id)` 仍然返回那一行、
     * `isDel` 变成 1。要用独立证据确认删掉了，看列表，不要看 `get`。
     * 重复删同一个 id 后端直接返回成功，所以这个操作重发没有副作用。
     */
    async remove (id: string | number | Array<string | number>): Promise<unknown> {
      const ids = (Array.isArray(id) ? id : [id]).map(normalizeId)
      if (ids.length === 0) {
        throw new Error('删除作业需要至少一个 id')
      }
      return request({
        url: '/study/assignment/studyassignment',
        method: 'delete',
        data: ids,
      })
    },
  }
}

export type AssignmentCapability = ReturnType<typeof createAssignmentCapability>

/**
 * 门面上带防重的那一层。与会议室那条线同样的分工：`withIdempotency` 需要**身份**，
 * 那是会话层的东西，所以包装放在组装点（`src/index.ts` / `src/server.ts`），
 * 不放进能力模块。
 *
 * 这里只声明"多了一个 requestId"的形状。
 */
export type AssignmentCapabilityWithIdempotency = AssignmentCapability & {
  /**
   * 带短窗口防重的建作业（设计 D12）。`requestId` 由调用方生成并保管，
   * 超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  createIdempotent: (
    params: AssignmentDraft & { requestId: string },
  ) => Promise<unknown>
}
