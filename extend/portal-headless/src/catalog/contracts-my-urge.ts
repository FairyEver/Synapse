import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { MY_URGE_METHODS, myUrgeCapabilities } from '../capabilities/my-urge.js'

const definitions = new Map(myUrgeCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const idType = 'string | number'
const idRules = ['保留Java Long可能序列化出的长整数字符串；任务ID、发起人ID和负责人ID不能互换。']

const supervisorFields: AiField[] = [
  field('supervisee', idType, '负责人用户ID；详情逐人提醒的userId取它', { source: 'hr_supervisee.supervisee' }),
  field('superviseeName', 'string | null', '负责人姓名；列表和详情展示使用', { nullable: true, nullMeaning: '用户资料不存在或后端未返回' }),
  field('isComplete', 'integer | null', '该负责人记录的状态：0未完成、1已完成', { nullable: true, values: { '0': '未完成', '1': '已完成' }, nullMeaning: '后端未返回' }),
  field('completeDate', 'string | null', '负责人完成日期，YYYY-MM-DD', { optional: true, nullable: true, format: 'YYYY-MM-DD', nullMeaning: '尚未完成或未返回' }),
  field('completeDetails', 'string | null', '负责人完成说明；非当前用户时可能被后端隐藏', { optional: true, nullable: true, nullMeaning: '尚未完成，或当前用户不是该负责人' }),
  field('url', 'string | null', '完成附件URL；多个URL以逗号分隔', { optional: true, nullable: true, nullMeaning: '没有附件或当前用户不可见' }),
  field('urlName', 'string | null', '完成附件名称；当前页面不展示名称', { optional: true, nullable: true, nullMeaning: '没有附件名称或当前用户不可见' }),
  field('isCanEdit', 'integer | null', '当前用户能否编辑该负责人完成记录：1可编辑、0不可编辑', { optional: true, nullable: true, values: { '0': '不可编辑', '1': '可编辑' }, nullMeaning: '列表响应未提供' }),
]

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, idType, '督办任务ID；详情、撤销和群发提醒使用它', { source: 'hr_oversee_task.id' }),
  field(`${prefix}.taskName`, 'string | null', '督办任务名称；列表任务列和taskName筛选对应', { nullable: true, nullMeaning: '未返回任务名称' }),
  field(`${prefix}.endDate`, 'string | null', '计划完成日期，YYYY-MM-DD', { nullable: true, format: 'YYYY-MM-DD', nullMeaning: '未设置或未返回' }),
  field(`${prefix}.degreeType`, 'integer | null', '紧急程度：1重要紧急、2不重要紧急、3不重要不紧急、4重要不紧急', { nullable: true, values: { '1': '重要紧急', '2': '不重要紧急', '3': '不重要不紧急', '4': '重要不紧急' }, nullMeaning: '未返回' }),
  field(`${prefix}.isComplete`, 'integer | null', '当前任务状态：0督办事项、1督办完成；撤销/提醒按钮只在0时显示', { nullable: true, values: { '0': '督办事项', '1': '督办完成' }, nullMeaning: '未返回' }),
  field(`${prefix}.tip`, 'string | null', '未完成任务的截止提示，例如剩余:3天、已延期:2天或剩余:0天', { optional: true, nullable: true, nullMeaning: '任务已完成或后端未返回' }),
  field(`${prefix}.superviseeList`, 'array', '任务负责人记录；列表消费姓名，详情还消费完成状态、说明、附件和提醒目标', { nullable: true, nullMeaning: '没有负责人或未返回' }),
  field(`${prefix}.superviseeList[]`, 'object', '一条负责人记录'),
  ...supervisorFields.map(item => ({ ...item, path: `${prefix}.superviseeList[].${item.path}` })),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [field('$', 'object', '我发起的督办任务分页结果'), field('list', 'array', '当前页任务'), field('list[]', 'object', '一条督办任务列表记录'), ...rowFields('list[]'), field('total', 'integer', '当前筛选条件下的任务总数，不是当前页长度')],
  empty: 'list=[]且total=0表示当前用户在筛选条件下没有发起的任务；权限、会话、网络或响应结构错误会抛出，不能把空列表解释成无权限。',
}

const supervisorSearchOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '负责人候选分页结果'),
    field('list', 'array', '当前关键字命中的负责人候选页'),
    field('list[]', 'object', '一个负责人候选'),
    field('list[].id', idType, '负责人用户ID；创建草稿superviseeList[].supervisee使用它', { source: 'hr_sys_user.id' }),
    field('list[].realName', 'string | null', '负责人姓名；页面候选显示字段', { nullable: true, nullMeaning: '用户姓名未返回' }),
    field('list[].username', 'string | null', '负责人账号/工号来源字段', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
    field('list[].organizationName', 'string | null', '负责人组织名称；页面候选辅助展示字段', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
    field('total', 'integer', '关键字筛选下的候选总数，不是当前页长度'),
  ],
  empty: 'list=[]且total=0表示关键字没有命中候选；不传关键字由SDK在请求前拒绝，权限、会话和网络错误会抛出。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('$', 'object', '督办任务详情；Java响应可能含页面未消费的扩展字段'),
    field('id', idType, '督办任务ID；提交撤销/提醒时映射为taskId'),
    field('taskName', 'string | null', '督办任务名称', { nullable: true, nullMeaning: '未返回' }),
    field('taskDescription', 'string | null', '任务详情文本；Portal将字面\\n转换成换行显示', { nullable: true, nullMeaning: '没有详情或未返回' }),
    field('endDate', 'string | null', '计划完成日期，YYYY-MM-DD', { nullable: true, format: 'YYYY-MM-DD', nullMeaning: '未设置或未返回' }),
    field('degreeType', 'integer | null', '紧急程度，取值含义同列表', { nullable: true, values: { '1': '重要紧急', '2': '不重要紧急', '3': '不重要不紧急', '4': '重要不紧急' }, nullMeaning: '未返回' }),
    field('createTime', 'string | null', '创建时间，Portal详情未展示但Java响应可能提供', { optional: true, nullable: true, nullMeaning: '未返回' }),
    field('supervisor', idType, '任务发起人用户ID；服务端详情权限判断使用它', { optional: true, source: 'hr_oversee_task.supervisor' }),
    field('supervisorName', 'string | null', '任务发起人姓名', { optional: true, nullable: true, nullMeaning: '用户资料不存在或未返回' }),
    field('isComplete', 'integer | null', '当前任务状态：0督办事项、1督办完成', { nullable: true, values: { '0': '督办事项', '1': '督办完成' }, nullMeaning: '未返回' }),
    field('isCreator', 'integer | null', '当前用户是否任务发起人：1是、0否', { optional: true, nullable: true, values: { '0': '不是发起人', '1': '发起人' }, nullMeaning: '未返回' }),
    field('isCanComplete', 'integer | null', '当前用户是否属于负责人：1是、0否；该页只展示它，不在本页提交完成', { optional: true, nullable: true, values: { '0': '不是负责人', '1': '负责人' }, nullMeaning: '未返回' }),
    field('tip', 'string | null', '未完成任务的截止提示', { optional: true, nullable: true, nullMeaning: '任务已完成或未返回' }),
    field('superviseeList', 'array', '负责人完成记录和详情提醒目标', { nullable: true, nullMeaning: '没有负责人或未返回' }),
    field('superviseeList[]', 'object', '一条负责人记录'),
    ...supervisorFields.map(item => ({ ...item, path: `superviseeList[].${item.path}` })),
  ],
  empty: '响应不是对象、任务已撤回或服务端错误时抛出；不把被后端隐藏的completeDetails解释成负责人未填写。',
}

const createOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', idType, '服务端创建成功返回的新督办任务ID', { source: 'OverseeTaskController.createOverseeTask' })],
  empty: '服务端不是正整数ID或请求抛错时不能报告创建成功；成功后用该ID读取详情核对。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '服务端成功包络中的true；代表接口回执，不代表任务已从列表消失或提醒已送达')],
  empty: '服务端不是true或请求抛错时不能报告撤销成功。',
}

const messageOutput: AiContract['output'] = {
  shape: 'string',
  fields: [field('$', 'string', '服务端提醒接口返回的成功文本；通常为发送成功，不等同于消息送达证明')],
  empty: '服务端不是非空文本或请求抛错时不能报告提醒接口成功。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e：app/portal/views/dashboard/hr/urge/my-urge/list.vue、detail.vue、create.vue、components/add-supervisor.vue、urge/utils/index.js', kind: 'reference', note: '核对列表筛选、当前用户发起范围、创建字段与校验、负责人关键字分页、详情提醒、撤销和群发提醒动作。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：OverseeTaskController、OverseeTaskServiceImpl、OverseeTaskMapper.xml、OverseeTask*VO、Supervisee*VO', kind: 'reference', note: '核对当前用户supervisor覆盖、返回字段、创建/删除/提醒回执、详情可见性和后端未显式校验任务归属的风险。' },
  { source: 'src/capabilities/my-urge.ts 与 test/my-urge.test.ts', kind: 'implementation', note: '锁定请求参数、表单长度/日期/负责人规则、状态门禁、路由和提醒载荷；未替代真实环境闭环。' },
]

const commonBoundaries = [
  '页面路径是/dashboard/urge/my-urge/list，权限码是/dashboard/urge/my-urge；使用platform实例，module-type按Portal页面规则为null（不发送该头）。',
  '这是当前用户发起的督办业务，不是“我的待办”负责人完成业务，也不是BPM流程；不能把任务ID和负责人ID互换，不能改用flowTask/taskAction能力。',
  '列表服务端强制把supervisor替换为当前登录用户；SDK不提供查询其他发起人的参数。详情、撤销、提醒接口的Java实现未显式校验当前用户归属，SDK的状态快照门禁不是服务端授权替代。',
  '发起督办按钮只准备跳转到/dashboard/urge/create；创建表单和负责人搜索的规则在本页面能力中表达为prepareCreate输入，但路由本身不属于独立菜单叶子。',
]

const commonFailures = [
  '会话、租户、菜单权限、数据范围、业务错误、网络错误和响应结构错误原样抛出；空列表只能表示当前用户筛选结果为空。',
  '创建无requestId，重复提交会创建重复任务并重复通知；撤销/提醒也没有服务端防重。请求超时先按任务ID读取详情/列表确认，再决定是否重新准备和提交。',
]

const contracts: Record<string, AiContract> = {}
function add (id: string, contract: AiContract): void {
  if (!definitions.has(id)) throw new Error(`My urge contract has no registered definition: ${id}`)
  contracts[id] = contract
}

add('my-urge-list', {
  purpose: '按负责人姓名、督办内容、计划完成日期和完成状态查询当前用户发起的督办任务分页。',
  whenToUse: '用户要查看自己发起的督办事项或已完成督办时使用；它不查询收到的待办任务。',
  effect: 'read',
  boundaries: commonBoundaries,
  prerequisites: ['使用当前用户会话、当前租户，并拥有Portal人力督办事项页面权限。'],
  inputs: {
    taskName: param('督办内容模糊筛选。', '用户在页面“督办内容”输入框输入；不传时SDK发送null。', { type: 'string | null', nullable: true, nullMeaning: '不限督办内容', omitted: 'SDK补null' }),
    superviseeName: param('负责人姓名模糊筛选。', '用户在页面“负责人”输入框输入；不传时SDK发送null。', { type: 'string | null', nullable: true, nullMeaning: '不限负责人', omitted: 'SDK补null' }),
    endDate: param('计划完成日期精确筛选，格式YYYY-MM-DD。', '用户在页面“完成时间”日期选择器选择。', { type: 'string | null', nullable: true, format: 'YYYY-MM-DD', nullMeaning: '不限日期', omitted: 'SDK发送null' }),
    isComplete: param('督办任务完成状态。', '用户在页面“督办事项/督办完成”切换器选择。', { type: 'integer', default: '0；SDK默认督办事项', options: [{ value: 0, label: '督办事项' }, { value: 1, label: '督办完成' }] }),
    pageNo: param('页码，从1开始。', '页面分页器。', { type: 'integer', default: '1' }),
    pageSize: param('每页记录数。', '页面分页器；SDK默认20，Portal可选10/20/50/100。', { type: 'integer', default: '20' }),
  },
  output: listOutput,
  consume: ['展示taskName、superviseeList[].superviseeName、degreeType和endDate；未完成状态再展示tip、撤销和发起提醒动作。', '使用list[].id调用详情、准备撤销或准备群发提醒；需要完整结果时继续翻页直到读取数量达到total。'],
  steps: [
    { role: 'optional', when: '用户选中一条任务查看详情', capabilityId: 'my-urge-prepare-detail', mapping: { id: 'result.list[].id' }, instruction: '使用同一列表行的id准备详情路由，再调用myUrge.get读取详情。' },
    { role: 'optional', when: '用户确认撤销或提醒一个未完成任务', capabilityId: 'my-urge-prepare-delete', mapping: { id: 'result.list[].id', currentIsComplete: 'result.list[].isComplete' }, instruction: '先使用最新列表状态准备对应动作；状态不是0时不要提交。' },
  ],
  completion: '返回当前用户发起任务的一页和total；查询完成不代表任务被创建、撤销或提醒。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['已完成Portal/Java静态逐字段核对和离线请求测试；尚未在真实测试环境执行列表读请求、不同用户范围和权限对照。'],
})

add('my-urge-supervisor-search', {
  purpose: '按关键字分页搜索发起督办表单可选择的负责人候选。',
  whenToUse: '用户在Portal“添加负责人”弹窗输入姓名关键字后使用；不要使用空关键字加载全量人员。',
  effect: 'read',
  boundaries: commonBoundaries,
  prerequisites: ['keyword必须是非空关键字；SDK按长选项保护只查询5条一页。'],
  inputs: {
    keyword: param('负责人姓名关键字，不能为空。', '用户在负责人弹窗“姓名”筛选框输入；Portal接口字段名是name。', { type: 'string', required: true, constraints: ['至少一个非空字符；不传关键字时SDK拒绝全量候选请求。'] }),
    pageNo: param('候选页码，从1开始。', '负责人弹窗分页器；SDK默认1。', { type: 'integer', default: '1' }),
  },
  output: supervisorSearchOutput,
  consume: ['让用户从list[].id中选择负责人；把选中的ID映射到my-urge-prepare-create.superviseeList[].supervisee。', '只把候选页展示为选择结果，不把total解释成可直接全部加载的数组。'],
  steps: [{ role: 'required', when: '用户确认创建督办任务', capabilityId: 'my-urge-prepare-create', mapping: { superviseeList: 'result.list[].id' }, instruction: '将用户明确勾选的候选ID转换成[{ supervisee: id }]；不要把未选择的候选一并提交。' }],
  completion: '返回与Portal /sys/user/pageInfo 相同语义的关键字候选页；不产生写入。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['尚未在真实环境验证候选字段、关键字匹配规则和不同租户的人员数据范围。'],
})

add('my-urge-detail', {
  purpose: '读取我发起的督办任务详情、负责人完成记录和详情页可达的逐人提醒数据。',
  whenToUse: '用户从列表打开详情，或创建/撤销/提醒后需要核实结果时使用。',
  effect: 'read',
  boundaries: commonBoundaries,
  prerequisites: ['id来自当前用户列表或用户明确确认的任务ID；使用当前会话读取后端按身份裁剪的详情。'],
  inputs: { id: param('督办任务ID；不是负责人ID或BPM任务ID。', 'my-urge-list.list[].id或myUrge.prepareDetail返回的query.id。', { type: idType, required: true, constraints: idRules }) },
  output: detailOutput,
  consume: ['展示任务内容、计划日期、紧急程度、负责人和每人的完成信息；只有详情中的isComplete=0负责人行才可准备逐人提醒。', '不要把详情返回的基础信息当作当前用户一定有撤销/提醒权限；Java接口的归属校验不完整。'],
  steps: [
    { role: 'optional', when: '用户确认给某个未完成负责人发送提醒', capabilityId: 'my-urge-prepare-send-personal-message', mapping: { overseeTaskId: 'result.id', userId: 'result.superviseeList[].supervisee', currentIsComplete: 'result.superviseeList[].isComplete' }, instruction: '选择具体负责人行后，把该行的supervisee和isComplete映射到准备能力；不要把任务id当成userId。' },
  ],
  completion: '返回当前身份可见的详情；不产生写入。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['尚未在真实环境验证非发起人/非负责人读取任意任务ID时的部署权限表现，以及不同身份下附件和完成说明的实际脱敏。'],
})

add('my-urge-prepare-create', {
  purpose: '按Portal发起督办表单规则准备创建请求草稿。',
  whenToUse: '用户填写督办任务、详情、负责人、计划完成时间和紧急程度并确认提交前使用；取消时丢弃草稿。',
  effect: 'prepare',
  boundaries: commonBoundaries,
  prerequisites: ['负责人ID来自关键字人员搜索结果；至少选择1人；endDate使用Portal当天或之后的日期。'],
  inputs: {
    taskName: param('督办任务名称，必填且最多30字符。', '用户在发起督办表单“督办任务”文本框填写。', { type: 'string', required: true, constraints: ['最多30个字符。'] }),
    taskDescription: param('任务详情，必填且最多200字符。', '用户在“任务详情”文本框填写。', { type: 'string', required: true, constraints: ['最多200个字符。'] }),
    superviseeList: param('负责人数组；至少一人，每项只有supervisee用户ID。', '用户通过负责人弹窗搜索、勾选后得到的用户ID；Portal提交时把cooperator映射成supervisee。', { type: 'object[]', required: true, constraints: ['不能重复选择同一负责人。'] }),
    endDate: param('计划完成日期，格式YYYY-MM-DD且不能早于Portal当天。', '用户在日期选择器选择；Portal通过formatDay()提交。', { type: 'string', required: true, format: 'YYYY-MM-DD' }),
    degreeType: param('紧急程度。', '用户在下拉框选择。', { type: 'integer', required: true, options: [{ value: 1, label: '重要紧急' }, { value: 2, label: '不重要紧急' }, { value: 3, label: '不重要不紧急' }, { value: 4, label: '重要不紧急' }] }),
  },
  output: { shape: '{ draft: object }', fields: [field('$', 'object', '尚未提交的创建草稿'), field('draft', 'object', '严格对应Portal create请求体'), field('draft.degreeType', 'integer', '紧急程度'), field('draft.taskName', 'string', '督办任务名称'), field('draft.taskDescription', 'string', '任务详情'), field('draft.superviseeList', 'object[]', '负责人ID数组对象'), field('draft.superviseeList[].supervisee', idType, '负责人用户ID'), field('draft.endDate', 'string', '计划完成日期', { format: 'YYYY-MM-DD' })], empty: '必填字段、长度、日期、紧急程度、负责人数量或ID不符合Portal规则时抛错且不发POST。' },
  consume: ['用户确认后只把result.draft交给myUrge.create；用户取消只丢弃草稿。', '创建返回新任务ID后调用myUrge.get核对任务、负责人和日期；不要把HTTP成功回执替代回查。'],
  steps: [{ role: 'required', when: '用户确认创建', capabilityId: 'my-urge-create', mapping: { draft: 'result.draft' }, instruction: '提交完整创建草稿；成功或超时都按返回ID读取详情核对。' }, { role: 'cancel', when: '用户取消创建', instruction: '丢弃draft，不调用create。' }],
  completion: '得到与Portal发起督办页面实际POST字段一致的本地草稿，不代表任务已经创建。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['尚未在真实环境执行人员搜索、创建通知、创建后详情回查和重复提交对照。'],
})

add('my-urge-create', {
  purpose: '提交一条新的督办任务并返回服务端任务ID。',
  whenToUse: '仅在my-urge-prepare-create完成且用户明确确认后使用。',
  effect: 'write',
  boundaries: commonBoundaries,
  prerequisites: ['必须提交SDK生成的完整draft；Java会忽略客户端supervisor并绑定当前登录用户。'],
  inputs: { draft: param('prepareCreate返回的完整创建草稿。', 'my-urge-prepare-create.draft', { type: 'object', required: true }) },
  output: createOutput,
  consume: ['成功返回的新任务ID只作为回查定位；随后调用myUrge.get逐字段核对任务、负责人和当前用户发起人。', '创建页Portal成功后直接返回上一页；SDK保留回查步骤以证明持久化结果。'],
  steps: [{ role: 'required', when: '返回新任务ID或响应超时', capabilityId: 'my-urge-detail', mapping: { id: 'result.$' }, instruction: '读取同一任务详情；超时时不能盲目重复创建，未确定是否已存在前不要换ID重试。' }],
  completion: 'myUrge.get回查确认新任务字段、负责人和当前用户supervisor正确后，才能报告创建完成。',
  failures: commonFailures,
  idempotency: '后端没有requestId；重复创建会插入重复任务并发送重复通知。响应超时先用列表/详情按返回ID或唯一字段回查，未确认前不自动重试。',
  evidence,
  gaps: ['尚未在真实环境执行创建、消息通知、回查和超时恢复。'],
})

add('my-urge-prepare-delete', {
  purpose: '准备撤回一条尚未完成的督办任务。',
  whenToUse: '用户点击列表未完成行的“撤销”并确认前使用；Portal确认文案说明撤回后无法恢复。',
  effect: 'prepare',
  boundaries: commonBoundaries,
  prerequisites: ['必须使用最新列表/详情快照；currentIsComplete必须为0。'],
  inputs: { id: param('要撤回的督办任务ID。', 'my-urge-list.list[].id或my-urge-detail.id。', { type: idType, required: true, constraints: idRules }), currentIsComplete: param('最新任务完成状态；只有0允许撤回。', '同一列表行或详情根的isComplete。', { type: 'integer', required: false, options: [{ value: 0, label: '督办事项' }, { value: 1, label: '督办完成' }] }) },
  output: { shape: '{ draft: { id: string | number } }', fields: [field('$', 'object', '撤回草稿'), field('draft', 'object', '待确认的任务ID'), field('draft.id', idType, '撤回目标任务ID')], empty: 'ID非法或当前状态已完成时抛错，不发DELETE。' },
  consume: ['用户确认后调用myUrge.remove；取消只丢弃draft。', '成功或超时后重新list/get确认任务已被撤回；Java没有恢复接口。'],
  steps: [{ role: 'required', when: '用户确认撤回', capabilityId: 'my-urge-delete', mapping: { draft: 'result.draft' }, instruction: '提交撤回草稿；不可把完成状态任务强行改成可撤回。' }, { role: 'cancel', when: '用户取消撤回', instruction: '丢弃draft，不调用delete。' }],
  completion: '得到可撤回的任务ID草稿，不代表任务已经删除。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['尚未在真实环境验证归属权限、软删除结果、列表刷新和不可恢复性。'],
})

add('my-urge-delete', {
  purpose: '撤回并逻辑删除一条督办任务及其负责人关联记录。',
  whenToUse: '仅在prepareDelete通过未完成状态门禁且用户明确确认后使用。',
  effect: 'write',
  boundaries: commonBoundaries,
  prerequisites: ['必须传prepareDelete生成的draft；后端实现只校验存在性，SDK不能把本地状态门禁当作服务端归属授权。'],
  inputs: { draft: param('prepareDelete返回的任务ID草稿。', 'my-urge-prepare-delete.draft', { type: 'object', required: true }), 'draft.id': param('撤回目标督办任务ID。', 'my-urge-prepare-delete.draft.id', { type: idType, required: true, constraints: idRules }) },
  output: trueOutput,
  consume: ['true只表示delete接口回执；随后用myUrge.list/get确认任务不再出现或详情报告已撤回。', '删除后不能调用取消恢复；用户若需新任务必须重新prepareCreate。'],
  steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'my-urge-list', mapping: {}, instruction: '重新查询当前用户列表，确认同一任务ID已不可见；若列表仍有记录，不能报告撤回完成。' }],
  completion: '列表/详情回查确认任务已撤回并且关联负责人记录不再作为有效任务返回后，才能报告完成。',
  failures: commonFailures,
  idempotency: '后端没有requestId且删除不是幂等成功；重复调用会因任务不存在报错。超时先list/get回查，确认仍存在且用户再次确认后才可重新提交。',
  evidence,
  gaps: ['尚未在真实环境执行撤回和软删除回查；后端未显式校验当前用户归属。'],
})

add('my-urge-prepare-send-message', {
  purpose: '准备给一条未完成督办任务的所有未完成负责人发送提醒。',
  whenToUse: '用户点击列表未完成行“发起提醒”并确认前使用。',
  effect: 'prepare',
  boundaries: commonBoundaries,
  prerequisites: ['先读取最新列表或详情；currentIsComplete必须为0。提醒是副作用，不能当作任务状态变更。'],
  inputs: { id: param('督办任务ID。', 'my-urge-list.list[].id或my-urge-detail.id。', { type: idType, required: true, constraints: idRules }), currentIsComplete: param('最新任务完成状态；只有0显示并允许提醒。', '同一列表行或详情根的isComplete。', { type: 'integer', required: false, options: [{ value: 0, label: '督办事项' }, { value: 1, label: '督办完成' }] }) },
  output: { shape: '{ draft: { taskId: string | number } }', fields: [field('$', 'object', '群发提醒草稿'), field('draft', 'object', '待确认的任务ID'), field('draft.taskId', idType, '提醒目标任务ID')], empty: 'ID非法或任务已完成时抛错，不发提醒请求。' },
  consume: ['用户确认后调用myUrge.sendMessage；取消只丢弃draft。', '接口成功仅说明服务端接受了发送动作，不代表每条消息送达。'],
  steps: [{ role: 'required', when: '用户确认提醒', capabilityId: 'my-urge-send-message', mapping: { draft: 'result.draft' }, instruction: '按Portal GET /sendMessage发送提醒；不要把提醒当作完成状态。' }, { role: 'cancel', when: '用户取消提醒', instruction: '丢弃draft，不调用sendMessage。' }],
  completion: '得到一个未完成任务的群发提醒草稿，不产生消息副作用。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['尚未在真实环境验证消息发送、重复点击去重和送达结果。'],
})

add('my-urge-send-message', {
  purpose: '调用Portal群发提醒接口，给目标任务未完成负责人发送提醒。',
  whenToUse: '仅在prepareSendMessage返回草稿且用户明确确认后使用。',
  effect: 'write',
  boundaries: commonBoundaries,
  prerequisites: ['draft.taskId必须来自最新未完成任务；后端未显式校验任务归属。'],
  inputs: { draft: param('prepareSendMessage返回的提醒草稿。', 'my-urge-prepare-send-message.draft', { type: 'object', required: true }), 'draft.taskId': param('提醒目标任务ID。', 'my-urge-prepare-send-message.draft.taskId', { type: idType, required: true, constraints: idRules }) },
  output: messageOutput,
  consume: ['返回“发送成功”只表示接口成功文本；Portal页面只显示提示，不重新拉取列表。', '不要重复点击或把非幂等提醒当成可安全重试操作。'],
  steps: [],
  completion: '收到非空服务端成功文本后，只能报告提醒请求已接受，不能报告消息已送达。',
  failures: commonFailures,
  idempotency: '后端没有去重键；重复调用可能重复发送。请求超时不确定时先结合用户确认和服务端消息记录（若有）判断，不自动重发。',
  evidence,
  gaps: ['尚未在真实环境验证消息是否送达、任务归属权限和重复提醒行为。'],
})

add('my-urge-prepare-send-personal-message', {
  purpose: '准备给详情中一名未完成负责人发送提醒。',
  whenToUse: '用户在督办详情选择负责人行并确认“发送提醒”前使用。',
  effect: 'prepare',
  boundaries: commonBoundaries,
  prerequisites: ['overseeTaskId来自详情根id，userId来自选中负责人行supervisee；currentIsComplete必须为0。'],
  inputs: {
    overseeTaskId: param('督办任务ID。', 'my-urge-detail.id', { type: idType, required: true, constraints: idRules }),
    userId: param('目标负责人用户ID。', 'my-urge-detail.superviseeList[].supervisee；不能使用任务id。', { type: idType, required: true, constraints: idRules }),
    currentIsComplete: param('选中负责人行的最新完成状态；只有0允许提醒。', 'my-urge-detail.superviseeList[].isComplete。', { type: 'integer', required: false, options: [{ value: 0, label: '未完成' }, { value: 1, label: '已完成' }] }),
  },
  output: { shape: '{ draft: { taskId: string | number, userId: string | number } }', fields: [field('$', 'object', '逐人提醒草稿'), field('draft', 'object', '待确认的任务和负责人ID'), field('draft.taskId', idType, '提醒目标任务ID'), field('draft.userId', idType, '提醒目标负责人ID')], empty: '任务ID、负责人ID非法或负责人已完成时抛错，不发POST。' },
  consume: ['用户确认后调用myUrge.sendPersonalMessage；取消只丢弃draft。', '后端未校验userId是否属于任务，调用方必须只使用详情负责人行的supervisee。'],
  steps: [{ role: 'required', when: '用户确认逐人提醒', capabilityId: 'my-urge-send-personal-message', mapping: { draft: 'result.draft' }, instruction: '按任务ID和负责人ID发送；不要把当前行的本地isSend标记当成服务端送达证据。' }, { role: 'cancel', when: '用户取消逐人提醒', instruction: '丢弃draft，不调用sendPersonalMessage。' }],
  completion: '得到目标任务和负责人ID的逐人提醒草稿，不产生消息副作用。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['尚未在真实环境验证目标负责人归属、消息送达和重复提醒行为。'],
})

add('my-urge-send-personal-message', {
  purpose: '调用Portal逐人提醒接口给一个负责人发送督办提醒。',
  whenToUse: '仅在prepareSendPersonalMessage返回草稿且用户明确确认后使用。',
  effect: 'write',
  boundaries: commonBoundaries,
  prerequisites: ['draft.taskId和draft.userId必须来自同一详情的任务根和负责人行；Java未显式校验目标用户归属。'],
  inputs: { draft: param('prepareSendPersonalMessage返回的任务/负责人草稿。', 'my-urge-prepare-send-personal-message.draft', { type: 'object', required: true }), 'draft.taskId': param('提醒目标任务ID。', 'my-urge-prepare-send-personal-message.draft.taskId', { type: idType, required: true, constraints: idRules }), 'draft.userId': param('提醒目标负责人用户ID。', 'my-urge-prepare-send-personal-message.draft.userId', { type: idType, required: true, constraints: idRules }) },
  output: messageOutput,
  consume: ['返回非空成功文本只表示接口接受发送动作；Portal只更新当前详情行的本地isSend标记，不重新读取详情。', '不要据此声称消息已送达或负责人已完成任务。'],
  steps: [],
  completion: '收到非空服务端成功文本后，只能报告逐人提醒请求已接受。',
  failures: commonFailures,
  idempotency: '后端没有去重键；重复调用可能重复发送。请求超时不确定时不要自动重发。',
  evidence,
  gaps: ['尚未在真实环境验证userId归属、消息送达和重复发送行为。'],
})

add('my-urge-prepare-detail', {
  purpose: '准备从我的督办列表打开与Portal一致的详情路由。',
  whenToUse: '用户选中列表行的详情动作时使用；这是本地路由准备，不发请求。',
  effect: 'local',
  boundaries: commonBoundaries,
  prerequisites: ['id必须来自当前列表行。'],
  inputs: { id: param('督办任务ID。', 'my-urge-list.list[].id', { type: idType, required: true, constraints: idRules }) },
  output: { shape: '{ path: string, query: { id: string | number } }', fields: [field('$', 'object', '详情路由'), field('path', 'string', '固定为/dashboard/urge/my-urge/detail'), field('query', 'object', '路由查询参数'), field('query.id', idType, '详情读取的任务ID')], empty: 'ID非法时抛错，不返回路由。' },
  consume: ['打开返回的path并传query.id；随后调用myUrge.get读取任务详情。'],
  steps: [],
  completion: '返回与Portal actionDetail一致的路径和query；没有网络副作用。',
  failures: ['任务ID非法时本地抛错；路由准备不验证任务是否存在。'],
  idempotency: null,
  evidence,
  gaps: ['尚未在真实浏览器验证深链参数和详情页部署路由。'],
})

add('my-urge-prepare-start', {
  purpose: '准备从我的督办列表打开发起督办页面。',
  whenToUse: '用户点击“发起督办”时使用；列表页只跳转，不发创建请求。',
  effect: 'local',
  boundaries: commonBoundaries,
  prerequisites: ['用户拥有发起督办页面权限并准备填写新表单。'],
  inputs: {},
  output: { shape: '{ path: string }', fields: [field('$', 'object', '发起督办路由'), field('path', 'string', '固定为/dashboard/urge/create')], empty: '无输入；始终返回Portal列表按钮使用的路由。' },
  consume: ['打开path后按my-urge-prepare-create准备表单；不要把路由准备报告成任务创建成功。'],
  steps: [],
  completion: '返回与Portal handleStartUrge一致的路由；没有网络副作用。',
  failures: ['路由跳转失败由宿主页面处理；本能力不发业务请求。'],
  idempotency: null,
  evidence,
  gaps: ['尚未在真实浏览器验证创建页菜单权限和返回上一页行为。'],
})

export const MY_URGE_AI_CONTRACTS = contracts
export const MY_URGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(MY_URGE_METHODS).map(([capabilityId, method]) => [
    `myUrge.${method}`,
    {
      ...MY_URGE_AI_CONTRACTS[capabilityId]!,
      boundaries: [...MY_URGE_AI_CONTRACTS[capabilityId]!.boundaries, `直接方法使用sdk.myUrge.${method}；写操作仍须按prepare→submit→回查与实际副作用边界执行。`],
    },
  ]),
)
