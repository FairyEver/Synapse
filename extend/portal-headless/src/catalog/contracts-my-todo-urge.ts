import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { MY_TODO_URGE_METHODS, myTodoUrgeCapabilities } from '../capabilities/my-todo-urge.js'

const definitions = new Map(myTodoUrgeCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const idType = 'string | number'
const idRules = ['保留Java Long可能序列化出的长整数字符串；不要把任务ID、负责人ID和BPM流程ID互换。']

const assigneeFields: AiField[] = [
  field('superviseeName', 'string | null', '被督办人姓名；列表负责人列和详情负责人卡片使用', { nullable: true, nullMeaning: '后端没有补出姓名' }),
  field('isComplete', 'integer | null', '该负责人自己的完成状态：0未完成、1已完成', { nullable: true, values: { '0': '未完成', '1': '已完成' }, nullMeaning: '后端未返回状态' }),
  field('completeDate', 'string | null', '该负责人完成日期，YYYY-MM-DD', { nullable: true, format: 'YYYY-MM-DD', nullMeaning: '尚未完成或后端未返回' }),
  field('completeDetails', 'string | null', '完成说明；详情页换行显示', { nullable: true, nullMeaning: '未完成，或当前用户不是该负责人且后端按权限隐藏' }),
  field('url', 'string | null', '完成附件URL逗号串；详情页按逗号拆成图片预览项', { nullable: true, nullMeaning: '没有完成附件，或后端未返回附件' }),
  field('urlName', 'string | null', '完成附件名称逗号串；当前页面不展示名称', { optional: true, nullable: true, nullMeaning: '未返回附件名称' }),
  field('isCanEdit', 'integer | null', '当前登录用户能否编辑该负责人完成记录：1可编辑、0不可编辑；由后端按当前用户计算', { optional: true, nullable: true, values: { '0': '不可编辑', '1': '可编辑' }, nullMeaning: '列表响应未提供此详情权限标记' }),
]

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.overseeTaskId`, idType, '督办任务ID；列表详情动作使用它，不是列表行的id', { source: 'hr_oversee_task.id' }),
  field(`${prefix}.taskName`, 'string | null', '督办内容；列表筛选taskName对应的任务名称', { nullable: true, nullMeaning: '任务名称未返回' }),
  field(`${prefix}.endDate`, 'string | null', '计划完成日期，YYYY-MM-DD', { nullable: true, format: 'YYYY-MM-DD', nullMeaning: '任务没有计划完成日期' }),
  field(`${prefix}.degreeType`, 'integer | null', '紧急程度：1重要紧急、2不重要紧急、3不重要不紧急、4重要不紧急', { nullable: true, values: { '1': '重要紧急', '2': '不重要紧急', '3': '不重要不紧急', '4': '重要不紧急' }, nullMeaning: '后端未返回紧急程度' }),
  field(`${prefix}.isComplete`, 'integer | null', '当前登录用户在该任务下的完成状态：0待办、1已办；列表切换器和完成按钮使用', { nullable: true, values: { '0': '待办事项', '1': '已办事项' }, nullMeaning: '后端未返回当前用户状态' }),
  field(`${prefix}.tip`, 'string | null', '未完成任务的截止提示；例如剩余:3天或已逾期:2天，已办列表通常没有该列', { optional: true, nullable: true, nullMeaning: '任务已完成或服务端未返回提示' }),
  field(`${prefix}.superviseeList`, 'array', '任务下所有负责人记录；列表只消费其中的姓名，详情消费完成状态、说明、附件和isCanEdit', { nullable: true, nullMeaning: '后端未补出负责人列表' }),
  field(`${prefix}.superviseeList[]`, 'object', '一个负责人完成记录'),
  ...assigneeFields.map(item => ({ ...item, path: `${prefix}.superviseeList[].${item.path}` })),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '我的待办/已办督办事项分页结果'),
    field('list', 'array', '当前页督办任务，不是全部结果'),
    field('list[]', 'object', '一条督办任务列表记录'),
    ...rowFields('list[]'),
    field('total', 'integer', '当前筛选条件下的任务总数，不是当前页长度'),
  ],
  empty: 'list=[]且total=0表示当前用户在筛选条件下没有督办任务；权限、会话、网络或响应结构错误会抛出，不能把空列表解释成无权限。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('$', 'object', '督办任务详情；Java响应还可能有页面未消费的扩展字段'),
    field('id', idType, '督办任务主键；提交完成时映射为overseeTaskId', { source: 'hr_oversee_task.id' }),
    field('taskName', 'string | null', '督办内容', { nullable: true, nullMeaning: '未返回任务名称' }),
    field('degreeType', 'integer | null', '紧急程度，取值含义同列表', { nullable: true, values: { '1': '重要紧急', '2': '不重要紧急', '3': '不重要不紧急', '4': '重要不紧急' }, nullMeaning: '未返回' }),
    field('endDate', 'string | null', '计划完成日期，YYYY-MM-DD', { nullable: true, format: 'YYYY-MM-DD', nullMeaning: '未设置或未返回' }),
    field('tip', 'string | null', '只要任务下存在未完成负责人就计算的截止提示', { nullable: true, nullMeaning: '所有负责人已完成或未返回' }),
    field('taskDescription', 'string | null', '督办详情文本；Portal把字面\\n转换为换行显示', { nullable: true, nullMeaning: '没有详情文本' }),
    field('isComplete', 'integer | null', '当前登录用户在该任务下的完成状态；详情页据此显示完成/修改', { nullable: true, values: { '0': '未完成', '1': '已完成' }, nullMeaning: '后端未返回当前用户状态' }),
    field('isCreator', 'integer | null', '当前用户是否任务创建人：1是、0否', { optional: true, nullable: true, values: { '0': '不是创建人', '1': '创建人' }, nullMeaning: '未返回创建人标记' }),
    field('isCanComplete', 'integer | null', '当前用户是否属于负责人：1可以完成、0不可以', { optional: true, nullable: true, values: { '0': '不是负责人', '1': '负责人' }, nullMeaning: '未返回完成权限标记' }),
    field('superviseeList', 'array', '任务下所有负责人完成记录；创建人可看到全部，负责人只能看到自己完成说明/附件', { nullable: true, nullMeaning: '没有负责人记录或未返回' }),
    field('superviseeList[]', 'object', '一个负责人完成记录'),
    ...assigneeFields.map(item => ({ ...item, path: `superviseeList[].${item.path}` })),
  ],
  empty: '响应不是对象、任务不存在或服务端错误时抛出；不把空对象当作有效详情，也不把隐藏的completeDetails解释成该负责人未填写。',
}

const completionPreparationOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('$', 'object', '尚未提交的完成草稿'),
    field('draft', 'object', '按Portal完成弹窗实际POST字段构造的草稿'),
    field('draft.url', 'string', '已上传附件URL按逗号拼接；没有附件为空字符串'),
    field('draft.isComplete', 'integer', '固定为1，表示提交完成记录'),
    field('draft.completeDetails', 'string', '完成说明，最多500字符；当前Portal点击处理可发送空字符串'),
    field('draft.completeDate', 'string', 'SDK按Asia/Shanghai当天生成的日期，格式YYYY-MM-DD；后端实际以LocalDate.now()为准', { format: 'YYYY-MM-DD' }),
    field('draft.overseeTaskId', idType, '督办任务ID；提交接口字段名也是overseeTaskId', { source: '输入overseeTaskId' }),
  ],
  empty: '任务ID、附件数量、说明长度或日期不符合SDK规则时抛错且不发POST；取消只丢弃draft。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '服务端成功包络中的true；只代表接口回执，不是当前用户记录已回写证据')],
  empty: '服务端不是true或请求抛错时不能报告提交成功。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e：app/portal/views/dashboard/hr/urge/my-todo-urge/list.vue、detail.vue、components/complete.vue、urge/utils/index.js', kind: 'reference', note: '核对列表筛选/分页/列切换、详情展示、发起督办/详情路由、完成弹窗实际POST载荷、附件上限和权限标记消费。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：SuperviseeController、SuperviseeServiceImpl、SuperviseeMapper.xml、Supervisee*VO、OverseeTaskRespVO', kind: 'reference', note: '核对当前登录人范围、SQL筛选、返回字段、详情可见性、完成接口实际写入和主任务完成条件。' },
  { source: 'src/capabilities/my-todo-urge.ts 与 test/my-todo-urge.test.ts', kind: 'implementation', note: '锁定请求参数顺序、页面动作路由、完成载荷、日期/附件/说明边界和错误回执反证；未替代真实环境闭环。' },
]

const commonBoundaries = [
  '页面路径是/dashboard/urge/my-todo-urge/list，权限码是/dashboard/urge/my-todo-urge；使用platform实例，module-type按Portal页面规则为null（不发送该头）。',
  '这是hr_oversee_task/hr_supervisee督办业务，不是BPM流程待办；不能把overseeTaskId当成processInstanceId或BPM taskId，也不能改用flowTask/taskAction能力。',
  '列表后端强制把supervisee替换为当前会话用户；SDK不提供查询其他人的参数。isComplete筛选的是当前用户在任务下的记录，主任务只有所有负责人完成后才由后端置为完成。',
  '发起督办按钮这里只准备跳转到/dashboard/urge/create；发起页的负责人搜索、创建接口和“我的督办”列表不在本页面能力内，需使用对应页面节点。',
  '附件URL来自Portal/base-upload-file的上传结果；页面最多5项、单个上传控件限制6MB。完成接口只发送URL逗号串，不发送urlName，也不自动删除取消弹窗前已经上传的附件。',
]

const commonFailures = [
  '会话、租户、菜单权限、数据范围、后端业务错误和网络错误原样抛出；空列表只能表示当前用户的筛选结果为空。',
  'completedTask返回true但当前用户不是该任务负责人时，Java服务可能不更新任何负责人记录；必须用getTaskInfo回查当前用户对应的superviseeList项，不能只看true。',
]

const contracts: Record<string, AiContract> = {}
function add (id: string, contract: AiContract): void {
  if (!definitions.has(id)) throw new Error(`My todo urge contract has no registered definition: ${id}`)
  contracts[id] = contract
}

add('my-todo-urge-list', {
  purpose: '按完成状态、督办内容和计划完成日期查询当前用户收到的督办任务分页。',
  whenToUse: '用户要查看自己的待办事项或已办事项时使用；它只查询督办任务，不查询BPM审批待办。',
  effect: 'read',
  boundaries: commonBoundaries,
  prerequisites: ['使用当前用户会话、当前租户，并拥有Portal人力督办事项页面权限。'],
  inputs: {
    taskName: param('督办内容模糊筛选。', '用户在页面“督办内容”输入框输入；不传时SDK发送null。', { type: 'string | null', required: false, nullable: true, nullMeaning: '不限督办内容', omitted: 'SDK补null' }),
    endDate: param('计划完成日期精确筛选，格式YYYY-MM-DD。', '用户在页面“完成时间”日期选择器选择。', { type: 'string | null', required: false, nullable: true, format: 'YYYY-MM-DD', nullMeaning: '不限计划完成日期', omitted: 'SDK发送null' }),
    isComplete: param('当前用户负责人记录的完成状态。', '用户在页面“待办事项/已办事项”切换器选择。', { type: 'integer', required: false, default: '0；SDK默认待办事项', options: [{ value: 0, label: '待办事项' }, { value: 1, label: '已办事项' }] }),
    pageNo: param('页码，从1开始。', '页面分页器。', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页记录数。', '页面分页器；SDK默认20，Portal可选10/20/50/100。', { type: 'integer', required: false, default: '20', constraints: ['不要使用超过页面控件范围的值来声称与Web一致。'] }),
  },
  output: listOutput,
  consume: ['展示taskName、superviseeList[].superviseeName、degreeType和endDate；待办状态再展示tip和完成动作，已办状态不把缺少tip解释成异常。', '使用list[].overseeTaskId调用详情或准备完成；需要完整结果时继续翻页直到读取数量达到total。'],
  steps: [
    { role: 'optional', when: '用户选中一条任务查看详情', capabilityId: 'my-todo-urge-prepare-detail', mapping: { overseeTaskId: 'result.list[].overseeTaskId' }, instruction: '先使用同一条列表记录的overseeTaskId准备详情路由，再调用myTodoUrge.getTaskInfo读取详情。' },
    { role: 'optional', when: '用户要完成待办任务', capabilityId: 'my-todo-urge-detail', mapping: { overseeTaskId: 'result.list[].overseeTaskId' }, instruction: '先读取详情，确认当前用户的负责人行和isComplete状态，再准备完成草稿。' },
  ],
  completion: '返回当前用户筛选条件下的一页任务和total；查询完成不代表任何任务被完成。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['已完成Portal/Java静态逐字段核对和离线请求测试；尚未在真实测试环境执行列表读请求及不同用户/权限的数据范围对照。'],
})

add('my-todo-urge-detail', {
  purpose: '读取一个督办任务的详情、负责人完成状态和当前用户可编辑标记。',
  whenToUse: '用户从“我的待办”列表打开详情，或完成/修改后需要核实写入效果时使用。',
  effect: 'read',
  boundaries: commonBoundaries,
  prerequisites: ['overseeTaskId来自当前用户列表或用户明确确认的任务ID；使用当前用户会话读取权限裁剪后的详情。'],
  inputs: { overseeTaskId: param('督办任务ID；不是负责人ID、BPM任务ID或业务主表ID。', 'my-todo-urge-list.list[].overseeTaskId或myTodoUrge.prepareDetail返回的query.id。', { type: idType, required: true, constraints: idRules }) },
  output: detailOutput,
  consume: ['创建人看到所有负责人完成说明/附件；普通负责人只把自己isCanEdit=1的行作为完成/修改输入，其他人的completeDetails被隐藏。', '完成后必须检查当前用户行的isComplete=1；任务根isComplete表示当前用户状态，不等同于所有负责人都完成。'],
  steps: [{ role: 'optional', when: '当前用户负责人行的isComplete=0且用户确认完成', capabilityId: 'my-todo-urge-prepare-complete', mapping: { overseeTaskId: 'args.overseeTaskId' }, instruction: '把用户说明和已上传URL数组交给准备能力；页面按钮实际允许空说明，但调用方应优先询问用户完成说明。' }],
  completion: '返回当前用户可见的任务详情和权限标记；不产生写入。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['尚未在真实环境验证非负责人读取任意taskId时的部署权限表现；Java静态代码显示基础字段可能仍可返回，不能把SDK详情当作通用任务授权检查。'],
})

add('my-todo-urge-prepare-complete', {
  purpose: '按“我的待办”完成弹窗实际提交规则准备完成督办任务的请求草稿。',
  whenToUse: '用户确认要完成自己的待办任务，并已取得任务ID和已上传附件URL时使用；取消时只丢弃草稿。',
  effect: 'prepare',
  boundaries: commonBoundaries,
  prerequisites: ['先用myTodoUrge.getTaskInfo确认当前用户是负责人且目标行仍未完成；附件先通过base-upload-file上传到Portal/public。'],
  inputs: {
    overseeTaskId: param('要完成的督办任务ID。', 'my-todo-urge-list.list[].overseeTaskId或my-todo-urge-detail.id。', { type: idType, required: true, constraints: idRules }),
    remark: param('完成说明，最多500字符。', '用户在完成弹窗“完成情况”文本框输入；Portal当前按钮直接调用actionComplete，未走formSubmit，因此空字符串也会进入POST。', { type: 'string | null', required: false, nullable: true, nullMeaning: '按Portal实际载荷转换为空字符串', omitted: 'SDK补空字符串', constraints: ['最多500字符；建议业务上填写完成说明，但SDK不凭空增加页面未执行的必填拦截。'] }),
    fileList: param('已上传完成附件的URL数组。', 'base-upload-file的上传结果，或详情中当前用户isCanEdit=1行的url拆分结果。', { type: 'array', required: false, nullable: true, nullMeaning: '没有附件', omitted: 'SDK补空数组', constraints: ['最多5项；每项非空字符串；单文件6MB限制由Portal上传控件/base-upload-file阶段执行，完成接口只接收URL。'] }),
  },
  output: completionPreparationOutput,
  consume: ['用户确认后只把result.draft交给myTodoUrge.complete；用户取消不发POST。', 'completeDate由SDK按Asia/Shanghai当天生成，Java服务仍会忽略它并以服务端LocalDate.now()写入。'],
  steps: [
    { role: 'required', when: '用户确认完成且详情中的当前用户负责人行仍为isComplete=0', capabilityId: 'my-todo-urge-complete', mapping: { draft: 'result.draft' }, instruction: '提交完成草稿；成功或超时都必须再调用myTodoUrge.getTaskInfo核对自己的负责人行。' },
    { role: 'cancel', when: '用户取消完成弹窗', instruction: '丢弃draft，不调用completedTask；已经上传的附件不会因为Portal取消而自动删除。' },
  ],
  completion: '得到与Portal complete.vue实际POST字段一致、尚未写入服务端的草稿。',
  failures: commonFailures,
  idempotency: null,
  evidence,
  gaps: ['尚未在真实环境执行附件上传、完成提交和回查闭环；未验证服务端时区与SDK Asia/Shanghai日期在部署环境中的边界差异。'],
})

add('my-todo-urge-complete', {
  purpose: '提交当前用户对督办任务的完成说明和附件。',
  whenToUse: '仅在my-todo-urge-prepare-complete返回草稿并经用户确认后使用；详情页“修改”也复用同一接口。',
  effect: 'write',
  boundaries: commonBoundaries,
  prerequisites: ['必须使用当前会话用户；最好先读取详情确认当前用户负责人行isCanEdit=1。', '必须传prepareComplete生成的完整draft，不把任务根id、BPM任务id或附件对象直接替代overseeTaskId。'],
  inputs: {
    draft: param('完成请求草稿，包含url、isComplete=1、completeDetails、completeDate和overseeTaskId。', 'my-todo-urge-prepare-complete.draft', { type: 'object', required: true, constraints: ['只提交SDK生成的字段；不自行改写isComplete或任务ID。'] }),
    'draft.overseeTaskId': param('草稿中的督办任务ID；用于提交字段和完成后的详情回查。', 'my-todo-urge-prepare-complete.draft.overseeTaskId', { type: idType, required: true, constraints: idRules }),
  },
  output: trueOutput,
  consume: ['true只表示completedTask接口成功回执；随后用draft.overseeTaskId调用myTodoUrge.getTaskInfo，检查当前用户对应负责人行isComplete=1。', '所有负责人都完成时，回查详情中的任务状态和列表；当前用户完成并不等于主任务已经全部完成。'],
  steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'my-todo-urge-detail', mapping: { overseeTaskId: 'args.draft.overseeTaskId' }, instruction: '读取同一督办任务；按当前用户自己的负责人行核对isComplete=1、completeDetails和附件，不以根响应true代替回查。超时未回查前不要重发。' }],
  completion: '只有详情回查确认当前用户负责人行已完成后，才能报告本次完成记录已写入；若其它负责人仍未完成，任务整体仍是未完成。',
  failures: [
    ...commonFailures,
    '完成请求超时、断连或5xx时结果不确定；先用getTaskInfo回查，未确认前不能换requestId或重复提交。',
    '服务端明确返回非SUCCESS/权限错误时请求未被SDK确认写入；修正权限或参数后再准备新草稿。',
  ],
  idempotency: '无后端requestId，也未在此页面能力上包SDK防重；重复提交会再次写OSS附件关联并覆盖当前用户完成说明。超时必须先getTaskInfo回查，确认没有写入且用户再次确认后才能重新prepare/submit。',
  evidence,
  gaps: ['尚未在真实环境执行prepare→submit→getTaskInfo回查；后端completedTask对非负责人可能静默返回true而不更新记录，当前契约要求回查但没有真实用户矩阵证据。'],
})

add('my-todo-urge-prepare-detail', {
  purpose: '准备从我的待办列表打开与Portal一致的督办详情路由。',
  whenToUse: '用户选中列表行的详情动作时使用；这是本地路由参数准备，不发业务请求。',
  effect: 'local',
  boundaries: commonBoundaries,
  prerequisites: ['overseeTaskId必须来自列表当前行。'],
  inputs: { overseeTaskId: param('督办任务ID。', 'my-todo-urge-list.list[].overseeTaskId', { type: idType, required: true, constraints: idRules }) },
  output: { shape: '{ path: string, query: { id: string | number } }', fields: [field('$', 'object', '详情路由参数'), field('path', 'string', '固定为/dashboard/urge/my-todo-urge/detail'), field('query', 'object', '路由查询参数'), field('query.id', idType, '详情页读取的任务ID')], empty: '非法ID时抛错，不返回路由。' },
  consume: ['打开返回的path并传query.id；详情页会把query.id映射成GET /hr/supervisee/getTaskInfo的taskId。'],
  steps: [],
  completion: '返回与Portal actionDetail相同的路径和query；没有发起网络请求。',
  failures: ['任务ID不是正整数时本地抛错；本地路由准备不验证服务端任务是否存在。'],
  idempotency: null,
  evidence,
})

add('my-todo-urge-prepare-start', {
  purpose: '准备从我的待办列表打开发起督办页面。',
  whenToUse: '用户点击Portal“发起督办”按钮时使用；这里只复刻路由跳转，不代替发起页的表单和创建接口。',
  effect: 'local',
  boundaries: commonBoundaries,
  prerequisites: [],
  inputs: {},
  output: { shape: '{ path: string }', fields: [field('$', 'object', '发起督办页面路由参数'), field('path', 'string', '固定为/dashboard/urge/create')], empty: '本地路由固定返回，不产生业务空结果。' },
  consume: ['打开返回的path；发起页的负责人搜索、表单提交、消息通知和创建回查由“我的督办/发起督办”页面节点负责。'],
  steps: [],
  completion: '返回与Portal handleStartUrge相同的path；没有发起网络请求或任务。',
  failures: [],
  idempotency: null,
  evidence,
})

export const MY_TODO_URGE_AI_CONTRACTS = contracts
export const MY_TODO_URGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(MY_TODO_URGE_METHODS).map(([capabilityId, method]) => [
    `myTodoUrge.${method}`,
    {
      ...MY_TODO_URGE_AI_CONTRACTS[capabilityId]!,
      boundaries: [...MY_TODO_URGE_AI_CONTRACTS[capabilityId]!.boundaries, `直接方法使用sdk.myTodoUrge.${method}；写操作仍须按prepare→submit→getTaskInfo回查。`],
    },
  ]),
)
