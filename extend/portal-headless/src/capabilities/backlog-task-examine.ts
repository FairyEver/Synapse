import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'
import { normalizeTaskId } from './task-action.js'

/**
 * 待办事项 —— 阶段① 的又一条业务线（`backlog` 域），也是**第一条「一个组件被多条菜单复用」的列表页**，已办标签含撤销动作。
 *
 * 页面：`/dashboard/backlog/task-examine/list`（菜单「待办事项」，域 `backlog`）
 * 路由文件：`app/portal/views/dashboard/hr/backlog/task-examine/list.vue`
 *
 * 前面几条线各自回答了一个问题（会议室的写链路、考勤档案的"方法能不能泛化"、
 * 作业管理的"换域之后哪些做法不适用"）。这一页要回答的是：
 *
 * > **一个组件被三条菜单复用时，「这一页是哪一页」和「这一页上的一个开关」怎么分开？**
 *
 * 答案是本页的 `finished`（待办 / 已办）**与考勤档案的 `isArchived` 是相反的处理**，
 * 理由逐条写在下面 `finished` 与 `selectType` 的注释里——这两条不要照抄对方。
 *
 * 逐字段基准：`baseline/backlog-task-examine.browser.json`
 * 四件套记录：`docs/pages/待办事项.md`
 */

export const BACKLOG_TASK_EXAMINE_PAGE_PATH = '/dashboard/backlog/task-examine/list'

/** 本页在 Portal 里的权限码（菜单里与路径不同名，少了 `/list`） */
export const BACKLOG_TASK_EXAMINE_PERMISSION = '/dashboard/backlog/task-examine'

/** Portal 共享待办/已办组件使用的撤销审批接口。 */
export const BPM_TASK_WITHDRAW_PATH = '/bpm/task/withdraw'

/** Portal 的撤销审批弹窗在原因为空白时实际发送的占位值。 */
export const DEFAULT_TASK_WITHDRAW_REASON = '无'

/**
 * 列表请求的固定前缀参数。
 *
 * 依据是浏览器真实发出的 URL（`baseline/backlog-task-examine.browser.json`）：
 * `…/bpm/hr/task/list-by-category-web?order=&orderField=&name=&title=&…&pageNo=1&pageSize=20`。
 *
 * **顺序即 qs 序列化后的顺序**，也就是 `{ order, orderField, ...formState, pageNo, pageSize }`
 * （`common/libs/renren/list.js:473-482`），所以下面这张表是"契约"，不是"默认值表"。
 * `createTime` 不是标量（见 `buildListParams`），这里只占位。
 */
const LIST_QUERY: ReadonlyArray<{
  name: string
  defaultValue: unknown
}> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'title', defaultValue: '' },
  { name: 'createTime', defaultValue: null },
  { name: 'startUserName', defaultValue: '' },
  { name: 'finished', defaultValue: 1 },
  { name: 'selectType', defaultValue: 1 },
  { name: 'processCategory', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: 20 },
]

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/** 待办 / 已办。页面右上角的 `a-segmented`，`props.finished` 的默认值是 1 */
export type Finished = 1 | 2

export const FINISHED_OPTIONS: ReadonlyArray<{ label: string; value: Finished }> = [
  { label: '待办事项', value: 1 },
  { label: '已办事项', value: 2 },
]

/**
 * 「时间范围」。**只有 `finished === 2` 时页面上才有这个下拉**（`list.vue:11` 的 `v-if`）。
 *
 * 但它的初值在 `formState` 里恒为 1，所以**浏览器打开页面时（待办事项 тоже）照样发
 * `selectType=1`** —— 实测见基准的第 1 条。这一点必须照抄：它不是"已办专属参数"，
 * 而是列表请求里恒有的一个字段。
 */
export type SelectType = 1 | 2

export const SELECT_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: SelectType }> = [
  { label: '近30天内', value: 1 },
  { label: '全部', value: 2 },
]

export type BacklogTaskRow = {
  /** 任务 id。行上的所有动作（办理 / 跟进 / 撤销审批）都拿它当入参 */
  id: number | string
  /** 流程名称列。页面渲染的是 `record.name || '无'` */
  name?: string | null
  /** 发起时间列 */
  createTime?: string
  /**
   * 审批内容 / 发起人 / 业务主键都挂在 `processInstance` 下，不在这层。
   * 页面渲染的是 `record.processInstance?.title` 与 `?.startUserNickname`。
   */
  processInstance?: {
    id?: number | string
    /** 审批内容。页面经 `getApprovalContent()` 处理后展示（trim，空则显示「无」） */
    title?: string | null
    startUserNickname?: string | null
    /** 2=年度协议审核 3=月度协议审核 4=任务审核 5=任务评分 6=协议评分 7=协议申诉 8=流程详情 */
    category?: string | null
    result?: number | null
    /** 协议类流程（category 6/7）跳详情要用的业务主键 */
    businessKey?: string | null
    [key: string]: unknown
  } | null
  /** 已办列表里为 true 时行上才有「撤销审批」（`finished === 2` 分支） */
  canWithdraw?: boolean
  [key: string]: unknown
}

export type PageResult<T> = { list: T[]; total: number }

export type BacklogTaskExamineQuery = {
  /** 流程名称。页面是普通文本输入框 */
  name?: string
  /** 审批内容。页面是普通文本输入框 */
  title?: string
  /** 发起人。页面是普通文本输入框（不是人员选择器，直接按名字匹配） */
  startUserName?: string
  /**
   * 发起时间区间的起点，格式 `YYYY-MM-DD HH:mm:ss`。
   * 必须与 `createTimeEnd` 成对给——页面上是一个 `a-range-picker`，给不出单边。
   */
  createTimeStart?: string
  /** 发起时间区间的终点。格式同上。**没有 +1 天的开区间改写**（见文件末尾注释） */
  createTimeEnd?: string
  /** 1=待办事项（默认）2=已办事项 */
  finished?: Finished
  /** 1=近30天内（默认）2=全部。页面上只有已办事项才有这个控件，但请求里恒有 */
  selectType?: SelectType
  /**
   * 流程分类。页面上它来自深链 `?taskKey=`（如 `Task_month`）。
   * ⚠️ 但那个值是**坏的**：后端拿它去流程模型分类里分组，取不到就 NPE 500，
   * 而深链那四个 taskKey 在测试环境一个都取不到。见参数说明里的实测记录。
   */
  processCategory?: string
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

export type TaskWithdrawParams = {
  /** 已办列表行的历史任务 ID，不是流程实例 ID，也不是下一节点任务 ID。 */
  taskId: string | number
  /** 撤销原因；Portal 表单可不填，空白值会变成「无」。 */
  reason?: string | null
}

export const TASK_WITHDRAW_PARAMS: ParamSpec[] = [
  {
    name: 'taskId',
    kind: 'text',
    required: true,
    description:
      '已办列表行的历史任务 ID（`list[].id`）。不是流程实例 ID、业务单据 ID 或下一节点待办 ID；' +
      '只能对当前用户且后端返回 `canWithdraw=true` 的已办行尝试撤销',
  },
  {
    name: 'reason',
    kind: 'text',
    required: false,
    description:
      '撤销原因，可省略。Portal 弹窗提交前会 trim；空串或全空白实际发送字符串「无」，' +
      '不是省略字段；后端本身允许空原因，但 SDK 要与 Portal 请求形状一致',
  },
]

/** 复刻 Portal `task-withdraw.js` 的请求体，供共享组件的两个页面能力复用。 */
export function buildTaskWithdrawPayload (params: TaskWithdrawParams): Record<string, unknown> {
  const id = normalizeTaskId(params?.taskId)
  const reason = typeof params?.reason === 'string' ? params.reason.trim() : ''
  return { id, reason: reason || DEFAULT_TASK_WITHDRAW_REASON }
}

const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/**
 * 发起时间的格式校验。
 *
 * 与 `assertYearMonth` / `assertTimeSlot` 同一个来历：格式是**前端控件**决定的
 * （`value-format="YYYY-MM-DD HH:mm:ss"` + `show-time`，实测面板上选完就是这个形状，
 * 见基准第 4 条）。后端 `HrTaskQuery` 那层的日期入参是字符串，格式错了**不会报错、
 * 只会查不到或查错范围**，所以挡在本地。
 *
 * 注意这里的规则**比会议室那条线松**：分钟不限于 00/30、秒不限于 00
 * （那个约束来自会议室表单自己的 `disabledTime` + 后端 `validateTime`，本页没有对应物）。
 * 也**不做"结束必须晚于开始"的校验**——先后顺序由 picker 保证，后端未见校验，
 * 本地硬拦会把后端本来接受的调用挡在门外。
 */
export function assertDateTime (value: string, field: string): void {
  if (!DATE_TIME_PATTERN.test(value)) {
    throw new Error(
      `${field} 必须是 YYYY-MM-DD HH:mm:ss（例如 2026-09-01 00:00:00），收到的是 ${JSON.stringify(value)}。` +
        '格式来自页面的发起时间区间选择器（value-format="YYYY-MM-DD HH:mm:ss"）；' +
        '传别的格式后端不会报错，只会查不到或查到错的范围。',
    )
  }
}

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildListParams (query: BacklogTaskExamineQuery): Record<string, unknown> {
  const provided = query as Record<string, unknown>
  const params: Record<string, unknown> = {}
  const createTime =
    query.createTimeStart === undefined && query.createTimeEnd === undefined
      ? []
      : [query.createTimeStart, query.createTimeEnd]

  for (const item of LIST_QUERY) {
    const value = item.name === 'createTime' ? createTime : provided[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

const LIST_PARAMS: ParamSpec[] = [
  {
    name: 'name',
    kind: 'text',
    required: false,
    description: '流程名称，模糊匹配。对应请求里的 name',
  },
  {
    name: 'title',
    kind: 'text',
    required: false,
    description: '审批内容，模糊匹配。对应请求里的 title',
  },
  {
    name: 'startUserName',
    kind: 'text',
    required: false,
    description: '发起人姓名，模糊匹配。**页面这里是纯文本输入框，不是人员选择器**，直接给名字即可',
  },
  {
    name: 'createTimeStart',
    kind: 'date',
    required: false,
    description:
      '发起时间区间起点，格式必须是 YYYY-MM-DD HH:mm:ss。**必须与 createTimeEnd 成对给**；' +
      '结束时刻就是字面值（本页没有作业管理那种"结束日 +1 天"的开区间改写），' +
      '要含 9-10 一整天得自己给 2026-09-10 23:59:59',
  },
  {
    name: 'createTimeEnd',
    kind: 'date',
    required: false,
    description: '发起时间区间终点，格式同上，必须与 createTimeStart 成对给',
  },
  {
    name: 'finished',
    kind: 'enum',
    required: false,
    description:
      '1=待办事项（默认）2=已办事项。页面右上角的「待办事项 / 已办事项」标签就是它，' +
      '用户可以在这页上直接切换，所以两个值都是本页的正常状态',
    options: FINISHED_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  },
  {
    name: 'selectType',
    kind: 'enum',
    required: false,
    description:
      '1=近30天内（默认）2=全部。它只对已办事项（finished=2）有意义——那是页面上唯一出现这个控件的分支——' +
      '但浏览器在待办事项下也照样发 1，默认值就照这个来',
    options: SELECT_TYPE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  },
  {
    name: 'processCategory',
    kind: 'text',
    required: false,
    description:
      '流程分类（后端拿它去 `bpmModelApi.getModelList()` 的分类里分组）。不传 = 不过滤。' +
      '⚠️ **这个参数目前是坏的，而且是后端坏的，不是 SDK 坏的**：后端实现是 ' +
      '`modelMapGroupCategory.get(processCategory).stream()`，取不到就空指针——' +
      '**只要这个键在请求里、且值不是某个真实存在的流程分类，一律 500**（业务 code，HTTP 仍是 200）。' +
      '实测：`human_process` 有数据（total=16）；消息中心深链传过来的四个 taskKey' +
      '（Task_month / Protocol_year / Protocol_month / protocolMonthScore）**全部 500**，' +
      '连空串 `processCategory=` 也 500，而**完全不传这个键就是好的**。' +
      '也就是说页面自己那条深链路径（以及「重置」之后）在测试环境里渲染成「暂无数据」。' +
      'SDK 保留这个参数是因为它确实是页面上的一个真实状态（`route.query.taskKey`），默认不传；' +
      '调用方要按分类筛，请给**真实存在的流程分类**，别照抄深链的 taskKey',
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

export const backlogTaskExamineCapabilities: CapabilityDefinition[] = [
  {
    id: 'backlog-task-examine-list',
    title: '查询待办事项 / 已办事项列表',
    pagePath: BACKLOG_TASK_EXAMINE_PAGE_PATH,
    permission: BACKLOG_TASK_EXAMINE_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
  {
    id: 'backlog-task-examine-withdraw',
    title: '撤销已通过审批',
    pagePath: BACKLOG_TASK_EXAMINE_PAGE_PATH,
    permission: BACKLOG_TASK_EXAMINE_PERMISSION,
    write: true,
    params: TASK_WITHDRAW_PARAMS,
  },
]

/**
 * 能力实现。
 *
 * `request` 由 SDK 门面注入，已经带好页面上下文
 * （module-type 走 `/dashboard/backlog/task-examine/list` 的推导结果：**推导不到，不发这个头**，
 * 与浏览器一致；http 实例推导为全局默认的 `platform.js`，实测请求落到 `/admin-api/…`）。
 */
export function createBacklogTaskExamineCapability (request: PortalRequest) {
  return {
    /** 分页查询待办 / 已办事项。列表本身只读。 */
    list (query: BacklogTaskExamineQuery = {}): Promise<PageResult<BacklogTaskRow>> {
      // 参数错误一律走 Promise.reject，与 searchUsers / attendanceArchive.list 一致：调用方总能 .catch 到
      const hasStart = query.createTimeStart !== undefined && query.createTimeStart !== null
      const hasEnd = query.createTimeEnd !== undefined && query.createTimeEnd !== null
      if (hasStart !== hasEnd) {
        return Promise.reject(
          new Error(
            'createTimeStart 与 createTimeEnd 必须成对给：页面上是一个 a-range-picker，' +
              '它只会把两个值一起写进 formState，给单边等于造了一个页面上不存在的状态。',
          ),
        )
      }
      if (hasStart && hasEnd) {
        try {
          assertDateTime(query.createTimeStart as string, 'createTimeStart')
          assertDateTime(query.createTimeEnd as string, 'createTimeEnd')
        } catch (error) {
          return Promise.reject(error)
        }
      }
      return request<PageResult<BacklogTaskRow>>({
        url: '/bpm/hr/task/list-by-category-web',
        method: 'get',
        params: buildListParams(query),
      })
    },

    /**
     * 撤销已办列表中后端标记为可撤销的审批。
     *
     * Portal 只在 `finished === 2 && record.canWithdraw === true` 时显示入口，
     * 但列表快照可能在弹窗期间过期，最终是否允许由后端实时校验。成功后原历史任务 ID
     * 不复用，调用方必须重新读取待办、已办或流程详情；没有 requestId，不自动重试。
     */
    async withdraw (params: TaskWithdrawParams): Promise<boolean> {
      return request<boolean>({
        url: BPM_TASK_WITHDRAW_PATH,
        method: 'put',
        data: buildTaskWithdrawPayload(params),
      })
    },
  }
}

export type BacklogTaskExamineCapability = ReturnType<typeof createBacklogTaskExamineCapability>

/**
 * 为什么 `finished` 开放、而考勤档案的 `isArchived` 钉死？
 *
 * 两页看起来是同一件事（同一个接口、一个参数决定取哪一批数据），处理**刻意相反**：
 *
 * | | 考勤档案 `isArchived` | 本页 `finished` |
 * | --- | --- | --- |
 * | 页面上有控件吗 | **没有**，用户无法在页面上换 | **有**，右上角 segmented 可直接切 |
 * | 不开放会怎样 | 忠实：用户在这个页面看不到另一种数据 | 不忠实：把用户看得见、点得到的标签藏起来 |
 *
 * 判据是**用户能不能在页面上到达那个状态**，不是"换个值会不会拿到别处也有的一批数据"。
 * `finished=2` 的数据在别的菜单（`/dashboard/flow/task/done/list`）也能看到，
 * 但那两条菜单只是把同一个组件预置了 `finished` 并关掉切换器（见基准的「对照组」），
 * 不是一条独立的数据边界。
 *
 * 反过来说：本页**没有**把 `selectable` / `componentMode` 这类纯 UI 开关开放出去。
 *
 * ## `createTime` 为什么没有"结束日 +1 天"
 *
 * 作业管理那条线的 `convertFetchForm` 把结束日改成次日 00:00:00（开区间）。
 * 本页**没有** `convertFetchForm`（页面只传了 `styleV2` / `getDataListURL` / `form` / `columns`），
 * 两个值原样进 qs，序列化成 `createTime[0]` / `createTime[1]`（`allowDots` + 默认 indices）。
 * 照抄作业管理那套 +1 天会**静默多查一天**。
 */
