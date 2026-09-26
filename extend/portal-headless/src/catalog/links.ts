/**
 * 能力之间的业务链路（"下游域"）—— **人工维护的数据文件**。
 *
 * ⚠️ 与 `aliases.ts` 一样，这是人写的，不是生成物。
 *
 * 为什么必须有这份表（设计 D14）：
 * `-llm` 要回答的不只是"这个能力怎么调"，还有"**拿到这批数据后下一步去哪**"。
 * 前半句能从能力定义推出来（参数契约、module-type），后半句推不出来——
 * "会议室列表里的哪一项对应哪个会议预定表单"，是**业务语义**，
 * 目录里没有任何字段能推导出它。所以只能人工登记，等服务端能下发时替换掉。
 *
 * 维护规则：
 * 1. `from` / `to` 必须是真实存在的 capability id（测试会校验，写错会红）。
 * 2. `viaField` 写**上游返回数据里的字段名**，这是 D14 说的
 *    "列表里哪一项对应哪个下游 ID" 的落点。
 * 3. `note` 是给 AI 看的消费说明，写业务含义，别写实现。
 * 4. `role` 缺省是 `next`（这条链的正常下一步）；`detour` 表示岔路/可选——
 *    评测实测"引导路径 3 跳 vs 语义最短 2 跳"就是缺这个标记（G3）。
 */

/** 这条边的性质：`next` = 完成当前任务的必经下一步；`detour` = 岔路/可选 */
export type CapabilityLinkRole = 'next' | 'detour'

export type CapabilityLink = {
  /** 上游能力 ID */
  from: string
  /** 下游能力 ID */
  to: string
  /** 上游返回数据里，指向下游的关键字段 */
  viaField: string
  /** 拿到上游数据后该做什么 */
  note: string
  /** 边的性质，缺省 `next` */
  role?: CapabilityLinkRole
}

export const CAPABILITY_LINKS: CapabilityLink[] = [
  {
    from: 'meeting-room-list',
    to: 'meeting-room-usage',
    viaField: 'list[].id',
    note: '列表里每行的 id 就是会议室 ID（meetingRoomId）。先拿到候选会议室的 ID，再用同一个 date 查占用，才能挑出空闲的那个，而不是把全部会议室丢给用户选。',
  },
  {
    // 订会议室链上语义最短的一跳：挑好空闲会议室就直接进表单准备。
    // 评测实测（G3）：这条边缺了以后，沿 next 走 usage → definition → prepare 要 3 跳，
    // 而 definition 的那一跳对订会议室没有贡献（它的 key 参数在 submit 的参数表里不存在）。
    from: 'meeting-room-usage',
    to: 'meeting-application-prepare',
    viaField: 'meetingRooms[].meetingRoomId',
    note: '占用查询按会议室分组返回 timeSlots（每段含 startTime/endTime/userName/meetingName）。挑出「目标时段没有 timeSlot」的那间，**它的 meetingRoomId 就是提交时要填的会议室**——直接进 prepare 准备提交，不必先去看流程定义。',
  },
  {
    from: 'meeting-room-list',
    to: 'meeting-application-prepare',
    viaField: 'list[].id',
    note: '会议室列表每行的 id 就是 meetingRoomId：用户按名称挑定会议室后，把这个 id 填进 prepare 的 meetingRoomId（与 list → usage 是同一个连接键，只是下游不同）。',
  },
  {
    from: 'meeting-room-usage',
    to: 'meeting-application-definition',
    viaField: 'meetingRooms[].meetingRoomId',
    note: '占用查询按会议室分组返回 timeSlots（每段含 startTime/endTime/userName/meetingName）。进「会议室审批流程」这个下游域取流程定义，是为了回答"这次提交要人工指定哪些审批人节点"与拿表单路径——订会议室本身不需要它。',
    role: 'detour',
  },
  {
    from: 'meeting-application-definition',
    to: 'meeting-user-search',
    viaField: 'startUserSelectTasks',
    note: '流程定义里的 startUserSelectTasks 是**需要人工指定审批人的节点**；实测会议室流程为空，但不能假定为空，提交前必须问一次。节点存在时才用关键字搜人，把 userId 填进 startUserSelectAssignees。另外 formCustomCreatePath 指向流程表单页（会议室 = simple/hr/form/033），那是再下游的一个域。',
    // 实测会议室流程 tasks 为空 —— 这条边是"有条件才走"的：一律算 next
    // 会让调用方在订会议室时白搜一次人（模型真这么干过一次）。
    role: 'detour',
  },
  {
    from: 'meeting-application-definition',
    to: 'meeting-room-usage',
    viaField: 'key',
    note: '流程定义拿到的 key（meeting_application）是提交时用的固定值；提交前用占用查询确认目标时段仍然空闲——页面上的「查看会议室预定情况」就是这个动作。',
  },
  {
    from: 'meeting-application-definition',
    to: 'meeting-application-prepare',
    viaField: 'formCustomCreatePath',
    note: '流程定义里的 formCustomCreatePath 指向该流程的表单域（会议室 = /simple/hr/form/033）。进表单域后先 prepare：它把草稿校验成提交载荷，并回答"这次提交需要人工指定哪些审批人节点"。',
  },
  {
    from: 'meeting-application-prepare',
    to: 'meeting-application-submit',
    viaField: 'tasks',
    note: 'prepare 返回 payload 与 tasks（需要人工指定审批人的节点，实测会议室流程为空但不能假定为空）。把 tasks 交给用户选完人，再连同 payload 一起 submit。',
  },
  {
    from: 'meeting-application-submit',
    to: 'meeting-application-cancel',
    viaField: 'id',
    note: 'submit 成功时后端返回的是新单据 id；要取消这笔预定就把它传进 cancel。已取消的单据再取消，后端会报「该会议预定已取消，请勿重复操作」。',
    // 取消是**事后动作**，不是订会议室这条链的下一步：标 next 会把它排到
    // "还差哪个参数"的前面，让调用方以为该顺手取消一下。id 的消费关系仍然保留。
    role: 'detour',
  },
]

/**
 * 能力 → 包内四件套文档（D26）。有文档的能力，`-llm` 会把它带出来。
 * 路径相对包根目录。
 */
export const CAPABILITY_DOCS: Record<string, string> = {
  'meeting-application-definition': 'docs/pages/会议室预定.md',
  'meeting-room-usage': 'docs/pages/会议室预定.md',
  'meeting-user-search': 'docs/pages/会议室预定.md',
}

/**
 * **页面级**的消费说明：整页拿到数据后要额外注意什么。key 是页面 menuPath。
 *
 * ⚠️ 作用域（G7）：这里的每一句都只对它 key 上那一页成立。`describe()` 会把它们
 * 挂到**入口页面等于这一页的每一个能力**上（一个能力可能有多个入口），
 * 所以写"这一页上没有什么"时，必须限定在**这一页**，不能顺延成
 * "这条业务链上没有什么"——评测里就是这句话把一条有解的订会链路说成了无解。
 */
export const PAGE_CONSUME_NOTES: Record<string, string[]> = {
  '/dashboard/meeting-room/list': [
    '会议室列表含「禁用会议室」，预定前要按名称/状态确认它可用。',
    '这一页只登记了读能力：新建/修改/停用/删除会议室还没有能力定义。',
  ],
  '/dashboard/flow/form/edit': [
    '这是「发起流程」的通用表单页，不在菜单树里（H36）——用户从「发起流程」页跳进来，入口带 processDefinitionKey，表单实际是哪个流程由它决定。',
    '这一页只是流程表单的**入口路由**：逐条推进过的流程（目前是会议室预定）有自己的 prepare / submit；还没推进到的流程在目录里没有对应能力，不要用别的流程的提交接口代替。',
  ],
}
