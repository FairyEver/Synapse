import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import type { CapabilityDefinition } from '../capabilities/types.js'
import { meetingRoomCapabilities } from '../capabilities/meeting-room.js'
import { meetingApplicationCapabilities } from '../capabilities/meeting-application.js'
import { generalApprovalCapabilities } from '../capabilities/general-approval.js'
import { leaveApplicationCapabilities } from '../capabilities/leave-application.js'
import { vehicleApplicationCapabilities } from '../capabilities/vehicle-application.js'
import { travelExpenseCapabilities } from '../capabilities/travel-expense-application.js'
import { productDesignApprovalCapabilities } from '../capabilities/product-design-approval.js'
import { taskActionCapabilities } from '../capabilities/task-action.js'
import { overtimeApplicationCapabilities } from '../capabilities/overtime-application.js'
import { restLeaveApplicationCapabilities } from '../capabilities/rest-leave-application.js'
import { businessTripApplicationCapabilities } from '../capabilities/business-trip-application.js'

const f = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const prefixed = (prefix: string, fields: AiField[]): AiField[] => fields.map(field => ({ ...field, path: `${prefix}${field.path}` }))
const state = { '0': '待提交', '1': '审批中', '2': '已审批', '3': '已驳回', '4': '已取消' }
const processState = { '1': '审批中', '2': '已通过', '3': '已驳回', '4': '已取消' }
const taskState = { '0': '待审批（尚未轮到的加签任务）', '1': '审批中', '2': '通过', '3': '不通过', '4': '已取消', '5': '已退回', '6': '委派中', '7': '通过中' }
const attachments = [f('url', 'string', '已上传的 OSS 文件地址；展示为附件链接'), f('name', 'string', '文件名，展示链接标题')]
const people = [f('id', 'number', '用户 ID；传给审批人、抄送人，不是员工 staffId'), f('nickname', 'string', '显示姓名', { optional: true }), f('code', 'string', '工号，用来区分同名人员', { optional: true }), f('deptId', 'number', '所属部门 ID', { optional: true })]
const tasks = [
  f('id', 'string', 'BPMN 自选节点 ID，作为 startUserSelectAssignees 对象键；不能用节点名称替代'),
  f('name', 'string', '自选审批节点名称，名称可能重复，仅用于展示'),
  f('minSelectCount', 'number', '最少选择人数；缺省按至少一人处理', { optional: true, nullable: true }),
  f('maxSelectCount', 'number', '最多选择人数；null/缺省表示未给上限', { optional: true, nullable: true }),
  f('selectionOrderRequired', 'boolean', 'true 时人员数组顺序就是依次审批顺序', { optional: true }),
  f('approvalMode', 'string', '审批方式，例如 SEQUENTIAL 依次、PARALLEL 并行；以实际值为准', { optional: true }),
  f('executionMode', 'string', '后端返回的执行方式标记，保持原值', { optional: true }),
  f('completionRule', 'string', '后端返回的完成规则，结合 approvalDescription 展示，不自行推算通过人数', { optional: true }),
  f('approvalDescription', 'string', '给选人者看的审批规则说明', { optional: true }),
]
const previewNodes = [
  f('nodeId', 'string', '预览节点 ID；与自选 tasks[].id 对应，不是实例 taskId'),
  f('name', 'string', '节点显示名称', { optional: true, nullable: true }),
  f('type', 'string', 'START_EVENT 开始、USER_TASK 人工任务、END_EVENT 结束；只对 USER_TASK 判断审批人'),
  f('candidateStrategy', 'number', '已知 23 直属上级、30 固定用户、35 发起人自选；其他值保留并结合名称解释', { optional: true, nullable: true }),
  f('candidateStrategyName', 'string', '审批人产生策略的中文名称', { optional: true, nullable: true }),
  f('candidateUsers', 'array', '当前变量下候选审批人，不能当成已经产生的待办任务', { optional: true }),
  ...prefixed('candidateUsers[].', people.filter(x => ['id', 'nickname'].includes(x.path))),
  f('approvalMode', 'string', 'SINGLE 单人等审批模式，按后端名称展示', { optional: true, nullable: true }),
  f('conditionDescription', 'string', '分支条件说明', { optional: true, nullable: true }),
  f('state', 'string', '预览节点解析状态（例如 CONFIRMED）；不是流程审批状态', { optional: true, nullable: true }),
  f('copyUsers', 'array', '该节点抄送用户', { optional: true }),
  ...prefixed('copyUsers[].', people.filter(x => ['id', 'nickname'].includes(x.path))),
]
const preview = [
  f('processDefinitionId', 'string', '流程定义版本 ID', { optional: true, nullable: true }),
  f('processDefinitionKey', 'string', '流程定义业务 key', { optional: true, nullable: true }),
  f('processDefinitionName', 'string', '流程名称', { optional: true, nullable: true }),
  f('state', 'string', '整份预览的解析状态，不是运行中流程状态', { optional: true, nullable: true }),
  f('nodes', 'array', '审批链预览，按顺序展示'), ...prefixed('nodes[].', previewNodes),
  f('copyUsers', 'array', '流程抄送人', { optional: true }), ...prefixed('copyUsers[].', people.filter(x => ['id', 'nickname'].includes(x.path))),
]
const instances = [
  f('list', 'array', '当前页的本人发起流程实例；不是某一种流程的专属列表'),
  f('total', 'number', '服务器匹配总数，不是当前页条数'),
  f('list[].id', 'string', '流程实例 ID → cancel.processInstanceId、task-action-instance.processInstanceId'),
  f('list[].businessKey', 'string', '业务单据 ID 的字符串形式；结合 processDefinitionKey 匹配，不能跨业务表只比较这个值', { optional: true }),
  f('list[].processDefinitionKey', 'string', '流程类型 key，用来区分同 ID 的不同业务单据', { optional: true }),
  f('list[].name', 'string', '流程名称', { optional: true }), f('list[].title', 'string', '审批内容', { optional: true }),
  f('list[].status', 'number', '流程实际状态；只有 1 能发起人取消', { optional: true, values: processState }),
  f('list[].startTime', 'string', '发起时间，按响应格式展示', { optional: true }), f('list[].endTime', 'string', '结束时间，运行中可为空', { optional: true, nullable: true }),
  f('list[].startUser.id', 'number', '发起用户 ID', { optional: true }), f('list[].startUser.nickname', 'string', '发起人显示姓名', { optional: true }),
]
const currentUser = [
  f('id', 'string', '当前会话用户 ID，保留字符串供业务载荷使用'), f('numericId', 'number', 'id 的数字形式，仅用于与 candidateUsers[].id 比较'),
  f('realName', 'string', '申请人姓名'), f('organizationId', 'string', '当前部门 ID'), f('organizationName', 'string', '当前部门名称'),
  ...[['username', '工号'], ['staffId', '员工 ID，与用户 ID 不同'], ['organizationCode', '部门编码'], ['postId', '岗位 ID'], ['postName', '岗位名称'], ['tenantId', '租户 ID']].map(([path, meaning]) => f(path!, 'string', meaning!, { optional: true })),
]
const definition = [
  f('id', 'string', '流程定义版本 ID，不能用作业务单据 ID'), f('key', 'string', '流程业务 key'), f('name', 'string', '流程显示名称'),
  f('formType', 'number', '后端表单类型码，用于识别配置；不能据此推导字段', { optional: true, nullable: true }),
  f('formCustomCreatePath', 'string', '自定义表单路径，仅作识别，不是 SDK 调用入口', { optional: true, nullable: true }),
  f('category', 'string', '流程分类', { optional: true, nullable: true }),
  f('startUserSelectTasks', 'array', '定义响应可能缺失；真实所需选人节点必须调用 prepare', { optional: true, nullable: true }),
  ...prefixed('startUserSelectTasks[].', tasks.slice(0, 2)),
  f('formFields', 'null', '历史真实响应为 null；本接口不提供可填写字段，不得据此宣称无字段', { optional: true, nullable: true }),
]
const writeFailure = '网络超时或响应丢失不等于未写入；先查业务详情/本人流程/任务链核实，禁止换 requestId 盲目重发。'
const commonFailures = ['本地字段校验失败时按具体字段修正；权限或登录失败需恢复当前用户会话或由管理员授予权限，不切换身份扩大范围。', '读请求的空结果只表示当前身份与筛选条件没有匹配；不要据此断言全租户不存在。']
const requestId: AiParameter = { meaning: '一次写意图的防重标识，invoke 写提交/办理必填', source: '调用方调用导出的 createRequestId() 生成并保存', constraints: ['同一意图重试复用原值及原载荷；新意图才换值', '只在 SDK 本地短窗口生效，不是后端永久幂等键'] }
const names: Record<string, string> = { pageNo: '从 1 开始的页码', pageSize: '每页条数；建议不超过 50，不使用 -1 全量', attendeeCount: '参会人数', attendees: '参会人自由文本，最多 500 字' }
const metadata = [
  { prefix: 'meeting-application', title: '会议室预定', file: 'meeting-application', key: 'meeting_application', defs: meetingApplicationCapabilities, detail: false, note: '预订指定会议室与半小时时间段；准备不会占用会议室，提交才创建预定。参会人是自由文本。' },
  { prefix: 'general-approval', title: '通用审批', file: 'general-approval', key: 'hr_general_approval', defs: generalApprovalCapabilities, detail: true, note: '用于申请事项和申请内容的通用审批。与产品设计审核字段相似但流程、节点 ID 不同；不能互换。' },
  { prefix: 'leave-application', title: '请假申请', file: 'leave-application', key: 'qingjia', defs: leaveApplicationCapabilities, detail: true, note: '按日期与上午/下午申请事假、病假、年假等；时长单位是天。调休小时明细走 rest-leave-application。' },
  { prefix: 'vehicle-application', title: '用车申请', file: 'vehicle-application', key: 'vehicle_usage_application', defs: vehicleApplicationCapabilities, detail: true, note: '为员工申请用车时间与目的地；申请人使用 staffId，审批人使用 userId，二者不能替换。' },
  { prefix: 'travel-expense', title: '差旅费报销', file: 'travel-expense-application', key: 'internal_transportation_expense_request_form', defs: travelExpenseCapabilities, detail: true, note: '差旅费用支出申请，包含组织、出差人、金额明细与收款信息；与只登记行程的出差申请不同。' },
  { prefix: 'product-design-approval', title: '产品设计文档审核', file: 'product-design-approval', key: 'hr_product_design_approval', defs: productDesignApprovalCapabilities, detail: true, note: '提交产品设计事项、内容和文档给独立的产品设计审核流程；不能复用通用审批的自选节点。' },
  { prefix: 'overtime-application', title: '加班申请', file: 'overtime-application', key: 'hr_overtime_application', defs: overtimeApplicationCapabilities, detail: true, note: '按开始结束时间、休息小时数申请加班及补贴方式；转调休是补贴类型，不会直接发起调休申请。' },
  { prefix: 'rest-leave-application', title: '调休申请', file: 'rest-leave-application', key: 'hr_rest_leave_application', defs: restLeaveApplicationCapabilities, detail: true, note: '用剩余加班小时申请逐日调休；按小时计，不走请假申请的上午/下午和年假天数。' },
  { prefix: 'business-trip-application', title: '出差申请', file: 'business-trip-application', key: 'hr_business_trip_application', defs: businessTripApplicationCapabilities, detail: true, note: '登记出差、外出或海外出差的行程与事由；不报销费用。同行人是自由文本，不是人员 ID 数组。' },
]
type Flow = typeof metadata[number]
const contracts: Record<string, AiContract> = {}
function inputsFor (def: CapabilityDefinition): Record<string, AiParameter> {
  return Object.fromEntries(def.params.map(p => [p.name, {
    meaning: p.description ?? names[p.name] ?? p.name,
    source: p.lookup ? `${p.lookup.capabilityId} 的候选结果；先用 ${p.lookup.keywordParam} 搜索再选定` : '用户提供业务值；ID 来源和固定值按本参数 meaning 与后续映射取用',
    ...(p.options?.length ? { constraints: [p.options.map(o => `${String(o.value)}=${o.label}`).join('；')] } : {}),
  }]))
}
function base (def: CapabilityDefinition, flow: Flow): AiContract {
  return {
    purpose: `${flow.title}：${def.title.replace(/[★⚠️]/g, '').trim()}`,
    whenToUse: flow.note,
    boundaries: [flow.note, `当前凭据绑定的用户和租户；流程 key=${flow.key}。`],
    effect: def.write ? 'write' : def.id.endsWith('-prepare') ? 'prepare' : 'read',
    prerequisites: ['已创建绑定当前用户与租户的 SDK 实例。'],
    inputs: inputsFor(def),
    output: { shape: '', fields: [], empty: '' },
    consume: [], steps: [], completion: '', failures: [...commonFailures], idempotency: null,
    evidence: [{ source: `src/capabilities/${flow.file}.ts`, kind: 'implementation', note: '执行方法、参数归一、返回投影与本地校验逐项核对' }, { source: `baseline/${flow.file}.browser.json`, kind: 'browser', note: '复用已保存浏览器基准；本轮未重放真实写操作，具体历史验证边界见页面四件套' }],
  }
}
function output (contract: AiContract, shape: string, fields: AiField[], empty: string, consume: string[], completion: string): void {
  contract.output = { shape, fields, empty }; contract.consume = consume; contract.completion = completion
}
function step (role: 'required' | 'optional' | 'recovery' | 'cancel', capabilityId: string, when: string, mapping: Record<string, string>, instruction: string): AiContract['steps'][number] {
  const target = [...metadata.flatMap(flow => flow.defs), ...meetingRoomCapabilities, ...taskActionCapabilities].find(def => def.id === capabilityId)
  const names = new Set(target?.params.map(param => param.name) ?? [])
  const entries = Object.entries(mapping)
  const mapped = Object.fromEntries(entries.filter(([, destination]) => names.has(destination)).map(([source, destination]) => [destination, /^(result|args|user|context)\./.test(source) ? source : `result.${source}`]))
  const explanatory = entries.filter(([, destination]) => !names.has(destination)).map(([source, destination]) => `${source} → ${destination}`).join('；')
  return { role, capabilityId, when, ...(Object.keys(mapped).length ? { mapping: mapped } : {}), instruction: explanatory ? `${instruction} ${explanatory}` : instruction }
}
function draftFields (flow: Flow): AiField[] {
  const prepare = flow.defs.find(d => d.id === `${flow.prefix}-prepare`)!
  return prepare.params.map(p => f(p.name, p.kind === 'number' ? 'number' : p.kind === 'boolean' ? 'boolean' : /Ids$|List$|Items$|attachments/.test(p.name) ? 'array' : 'string | number | object', p.description ?? names[p.name] ?? p.name, { optional: !p.required }))
}
for (const flow of metadata) {
  for (const def of flow.defs) {
    const c = base(def, flow)
    const suffix = def.id.slice(flow.prefix.length + 1)
    if (suffix === 'definition') {
      c.inputs.key = { meaning: `流程定义业务键，默认 ${flow.key}`, source: `本流程固定 ${flow.key}`, default: flow.key }
      output(c, '流程定义对象（已拆后端包络）', definition, '空/null 或定义不存在意味着当前环境未部署该流程，停止提交。', ['展示 name 与 key 核对业务；formFields 为 null 不代表免填，填写规则在 prepare/submit 的 SDK 描述中。'], '已确认流程身份；填写流程继续准备，单纯查询定义则交付名称与配置即可。')
      c.steps = [step('optional', `${flow.prefix}-prepare`, '用户需要发起此流程且草稿已齐全', {}, '先 describe prepare 取得实际字段契约；定义接口不是字段 schema。')]
    } else if (suffix === 'prepare') {
      const fields = [f('payload', 'object', '已归一的业务载荷预览，不等于已提交；后续 submit 仍接收原草稿'), ...prefixed('payload.', draftFields(flow)), f('tasks', 'array', '本次需要发起人选人的节点；空数组只表示无需自选，不表示无审批人'), ...prefixed('tasks[].', tasks)]
      output(c, '{ payload, tasks }（本流程附加字段见 fields）', fields, 'tasks=[] 是合法准备结果；仍可能有固定或直属上级审批节点。', ['给用户核对 payload 的业务值；按 tasks[].id 建立 startUserSelectAssignees 的键，人员来自候选查询，人数、去重与顺序服从任务规则。', '准备只读，不建单、不保留名额、不发送待办；任何草稿变更后应重新准备。'], '草稿校验并得到所需自选节点后准备完成；实际发起须再提交。')
      c.steps = [step('required', `${flow.prefix}-submit`, '用户要求实际发起且业务值/审批人已确定', { '原始草稿': '同名草稿参数', 'tasks[].id': 'startUserSelectAssignees 的键', '人员候选[].id': 'startUserSelectAssignees[节点ID][]' }, '保留原始草稿；不要把 payload 整体当成 invoke 参数。空 tasks 使用 {}，不是随意指定节点。')]
    } else if (suffix === 'submit') {
      c.inputs.requestId = requestId
      c.prerequisites.push(`同一份草稿先 ${flow.prefix}-prepare；按真实 tasks 填选人。`)
      c.boundaries.push('真实写入：创建业务记录并启动流程，可能向真人发待办/抄送。返回 ID 不表示审批已经通过。')
      output(c, 'number（业务单据 ID；SDK 不返回 code/data 包络）', [f('$', 'number', '业务单据主键；保留用于 detail.id、cancel.businessKey，不能当流程实例 ID')], '成功创建应获得业务 ID；没有可用 ID 时按写入不确定处理，先回读而不是重发。', ['保存业务 ID、流程类型及原 requestId；回读业务字段并查询流程实例确认已创建。', '取消属于用户改变决定时的可选操作，不是正常提交后的必做步骤。'], '回读确认业务记录及其流程后，向用户交付业务 ID 与当前审批状态；提交成功不等于审批完成。')
      c.steps = flow.detail ? [step('required', `${flow.prefix}-detail`, '拿到创建返回值', { '$': 'id' }, '核对实际保存的业务字段。'), step('optional', `${flow.prefix}-my-instances`, '需要实际流程状态或流程实例 ID', { '$（转字符串）': '客户端匹配 list[].businessKey' }, `同时确认 processDefinitionKey=${flow.key}。`), step('cancel', `${flow.prefix}-cancel`, '用户明确要撤销，且流程仍为 status=1', { '$': 'businessKey' }, '另填非空 reason；流程已结束不能撤回。')] : [step('required', 'meeting-room-usage', '提交后核实占用', { 'args.startTime': 'date' }, '从原草稿 startTime 提取 YYYY-MM-DD 日期部分，按会议室 ID 与时间段核实占用已出现。'), step('cancel', 'meeting-application-cancel', '用户要求取消预定', { '$': 'id' }, '传业务单据 ID；成功后复查占用。')]
      c.idempotency = 'invoke 使用 submitIdempotent：requestId 必填，同一意图复用；窗口内回放成功结果或共享进行中请求，不确定结果保留并阻止盲重试。原始 facade.submit 不防重。'
      c.failures.push(writeFailure)
    } else if (suffix === 'my-instances') {
      output(c, '{ list: 流程实例[], total: number }', instances, 'list=[] 表示当前页无匹配；total=0 表示当前筛选下没有本人发起流程。', [`本接口没有自动限定 ${flow.key}，按 processDefinitionKey 与 String(businessKey) 双重匹配；字段缺失时不可把跨业务重号当可靠确认。`, '页码默认 1、每页默认 20；逐页核对 total，列表局部不能用于全量汇总。'], '向用户展示流程名称、审批内容、状态与起止时间；有明确目标时只交付匹配实例。')
      c.steps = [step('cancel', `${flow.prefix}-cancel`, '用户要撤销，选中自己发起且 status=1 的行', { 'list[].id': 'processInstanceId' }, '补非空取消原因；2/3/4 是终态，不发取消请求。'), step('optional', 'task-action-instance', '需要流程办理详情', { 'list[].id': 'processInstanceId' }, '先读实例；本人发起不代表有权办理。')]
    } else if (suffix === 'cancel') {
      output(c, 'boolean（后端成功回执；SDK 原样返回拆包后的值）', [f('$', 'boolean', '取消请求回执；true 仍须通过查询确认流程/占用变化')], '空响应或丢失响应不是独立撤销证据，回读当前状态。', ['只取消自己发起且仍运行的流程；保留业务记录，不代表删除历史。', '查实际流程 status=4 才认定撤销完成；会议预定则核对占用时间段消失。'], flow.detail ? '流程实例 status=4，必要时详情也回读已取消，向用户报告撤销结果。' : '目标会议室对应时间段已不再占用，向用户报告已取消。')
      c.steps = [step('required', flow.detail ? `${flow.prefix}-my-instances` : 'meeting-room-usage', '取消请求后或响应不确定', {}, '使用提交时保留的业务 ID/日期回查，不凭成功回执就结束。')]
      c.idempotency = '该 cancel 门面没有短窗口防重包装；先回读状态，已取消不再重复发送。'
      c.failures.push('流程不处于运行中时后端拒绝取消；已通过或驳回不能以撤销代替删除。', writeFailure)
    } else if (suffix === 'approval-chain' || suffix === 'preview') {
      output(c, '{ nodes, processDefinitionId?, processDefinitionKey?, processDefinitionName?, state?, copyUsers? }', preview, 'nodes=[] 可能是无匹配链或定义不存在；不能据此保证不会通知任何人。', ['依次展示节点名称、candidateStrategyName 与 candidateUsers 姓名；节点用 nodeId 区分。', '将 USER_TASK 的 candidateUsers[].id 与当前用户 ID 比较，发起人=审批人可能自动通过而无法撤销。', '预览不产生任务，nodeId 不能传 task-action 的 taskId。'], '用户已知道当前变量下的审批路径；继续提交前仍需完整 prepare。')
      c.steps = [step('optional', `${flow.prefix}-prepare`, '已补齐草稿并需要真正发起', {}, '执行完整准备；预览变量可能尚不完整，不能代替输入校验。')]
      if (suffix === 'approval-chain') for (const input of Object.values(c.inputs)) input.meaning = input.meaning.replace(/必填/g, '完整预览时填写')
    } else if (suffix === 'current-user') {
      output(c, '当前登录用户白名单对象', currentUser, '缺失用户 id 或部门 id 会抛错，不能编造申请人信息。', ['展示 realName、organizationName、postName；由 SDK 自动填申请人/部门等只读字段，调用方不用回传。', '只含白名单字段；不返回 password2/salt 等凭据。'], '确认当前申请身份；若用户仅问本人信息，展示必要字段后结束。')
      c.steps = [step('optional', `${flow.prefix}-prepare`, '需要以当前用户提交申请', {}, '提供用户可编辑草稿，申请人字段由 prepare 自行派生。')]
    } else if (suffix === 'user-search' || suffix === 'approver-search' || def.id === 'meeting-user-search') {
      output(c, '{ list: 用户候选[], total: number }', [f('list', 'array', '当前页候选用户'), f('total', 'number', '匹配的用户总数'), ...prefixed('list[].', people)], '无候选时换关键词或缩小部门，不自行拼用户 ID。', ['展示姓名与工号给用户消歧；保存选中行 id 作为 userId。', 'keyword 或 deptId 至少给一个；pageSize=-1 被拒绝。'], '用户选定正确人员并保留 id 后候选查询完成。')
      c.steps = [step('optional', `${flow.prefix}-prepare`, '已选择人员并补齐业务草稿', { 'list[].id': '稍后 startUserSelectAssignees 的人员值' }, '节点键仍须 prepare 动态获取，不能把 userId 当节点 ID。')]
    }
    contracts[def.id] = c
  }
}

// Details describe the final SDK value, including controller omissions documented by real rereads.
const draftTypes: Record<string, string> = {
  meetingName: 'string', meetingRoomId: 'number', startTime: 'string', endTime: 'string', attendeeCount: 'number', attendees: 'string',
  applicationItem: 'string', applicationContent: 'string', copyUserIds: 'number[]', attachments: 'array', type: 'number', reason: 'string', startDate: 'string', endDate: 'string', startType: 'number', endType: 'number',
  staffId: 'string', staffName: 'string', destination: 'string', remark: 'string', orgId: 'string | number', projectExpense: 'boolean', financeProjectId: 'number | string | null', travelerIds: 'number[]', reasons: 'string', feePurpose: 'string', paymentDate: 'string', feeItem: 'number', travelEntryList: 'array', payeeInfo: 'object', relatedRevenueSubjectId: 'number | string | null', relatedRevenueSubjectName: 'string | null',
  overtimeType: 'number', subsidyType: 'number', breakHours: 'number', leaveDateItems: 'array', tripType: 'number', companions: 'string', origin: 'string',
}
const derived: Record<string, AiField[]> = {
  'leave-application': [f('userId', 'string', '当前用户 profile.id'), f('userName', 'string', 'profile.userName，来自 realName'), f('staffCode', 'string', 'profile.staffCode，来自 username'), f('fullPath', 'string', 'profile.fullPath，来自 organizationName，不是组织全路径'), f('restDay', 'number', '后端计算的请假天数，不是自然日差')],
  'overtime-application': [f('applicantId', 'string', '当前用户 id'), f('applicantName', 'string', '当前用户 realName'), f('applyDate', 'string', 'Asia/Shanghai 的今天 YYYY-MM-DD，不是加班日期'), f('applyDepartmentId', 'string', '当前用户 organizationId'), f('applyDepartmentName', 'string', '当前用户 organizationName'), f('overtimeHours', 'number', 'max(0,结束-开始-休息)，小时，保留 1 位小数，必须大于 0')],
  'rest-leave-application': [f('applicantName', 'string', '当前用户 realName'), f('userId', 'string', '当前用户 id'), f('staffCode', 'string', '当前用户 username 工号'), f('departmentId', 'string', '当前用户 organizationId'), f('departmentName', 'string', '当前用户 organizationName'), f('leaveType', 'number', '固定 0=调休', { values: { '0': '调休' } }), f('leaveHours', 'number', '明细小时合计，1 位小数'), f('remainingOvertimeHours', 'number', '后端返回剩余可调休加班小时；不足时拒绝准备/提交')],
  'business-trip-application': [f('applicantId', 'string', '当前用户 id'), f('applicantName', 'string', '当前用户 realName'), f('applyDate', 'string', 'Asia/Shanghai 的今天 YYYY-MM-DD，不是出差日期'), f('applyDepartmentId', 'string', '当前用户 organizationId'), f('applyDepartmentName', 'string', '当前用户 organizationName'), f('applyPostId', 'string', '当前用户 postId，后端校验岗位存在'), f('applyPostName', 'string', '当前用户 postName；服务端会依据当前登录用户再次回填')],
}
const travelEntries = [
  f('startEndDate', 'string[2]', '用户输入开始/结束日期 YYYY-MM-DD，准备载荷保留该数组'),
  f('startDate', 'string', 'startEndDate[0] 拆出的开始日期 YYYY-MM-DD'), f('endDate', 'string', 'startEndDate[1] 拆出的结束日期 YYYY-MM-DD'),
  f('startRegion', 'string[3]', '出发地省/市/区 ID，顺序固定且恰好 3 个'), f('endRegion', 'string[3]', '目的地省/市/区 ID'),
  ...['start', 'end'].flatMap(side => ['Province', 'City', 'District'].map((level, i) => f(`${side}${level}`, 'string', `${side === 'start' ? '出发' : '到达'}地区 ${i + 1} 级 ID，由 ${side}Region[${i}] 拆出`))),
  f('startAddress', 'string', '出发地详细地址'), f('endAddress', 'string', '到达地详细地址'), f('tripMode', 'number', 'trip_mode 字典值，出行方式', { optional: true, nullable: true }),
  ...[['trafficAmount', '交通费用'], ['foodAmount', '餐食补助'], ['housingAmount', '住宿补助'], ['otherAmount', '其他补助'], ['inputTaxAmount', '进项税']].map(([path, meaning]) => f(path!, 'number', `${meaning}，元；缺省/空值归一为 0；范围 0..1000000000`)),
  f('travelTotalAmount', 'number', '交通+餐食+住宿+其他，不含进项税，元；SDK 重算覆盖输入'),
  f('fundSource', 'number', '项目资金来源 finance_project_fund_source；项目费用行必填', { optional: true, nullable: true }),
  f('budgetDetailId', 'number | string', '预算明细 ID，来自 contract-support-travel-budget-search.list[].id；同时保留单号与可用余额', { optional: true, nullable: true }),
  f('budgetDetailNo', 'string', '对应预算明细单号', { optional: true, nullable: true }),
  f('budgetAvailableAmount', 'number', '预算可用金额快照，元；校验交通+餐食+住宿+其他是否超额，不含进项税', { optional: true, nullable: true }),
]
const payeeFields = [
  f('payeeType', 'number', '1 个人、2 公司；不提供时 null', { nullable: true, values: { '1': '个人', '2': '公司' } }),
  f('companySubType', 'number', 'payeeType=2 时：1 内部分公司、2 外部公司', { nullable: true }),
  f('isInternalStaff', 'boolean', 'payeeType=1 时 true 内部员工、false 外部人员；必须布尔，0/字符串不等价', { nullable: true }),
  f('receivingCorporationId', 'number | string', '内部分公司法人库 ID，新单使用；从 contract-support-corporation-search.list[].id 选择，不传历史组织 ID', { nullable: true }),
  f('receivingCorporationName', 'string', '内部分公司法人名称，与法人 ID 对应', { nullable: true }),
  f('receivingCompanyId', 'number | string', '历史内部公司组织 ID，无 receivingCorporationId 才保留', { nullable: true }),
  f('receivingCompanyName', 'string', '外部公司名称；有法人库 ID 时归一为 null', { nullable: true }),
  f('payeeId', 'number | string', '外部客商候选 id，缺省空串'), f('payeeCode', 'string', '客商编码，CUSTOMER 来源必须保留 code；缺省空串'),
  f('payeeSourceType', 'string', 'SUPPLIER / FINANCE_PARTY / CUSTOMER 来源标记，仅外部收款人分支保留', { optional: true }),
  f('payeeStaffId', 'number | string', '内部收款员工的用户 ID，不是 HR staffId', { nullable: true }),
  f('payeeStaffNo', 'string', '内部收款人工号，后端可按用户回填', { nullable: true }), f('payeeName', 'string', '收款人姓名', { nullable: true }),
  f('receivingBankName', 'string', '收款银行名称', { nullable: true }), f('receivingBankDictValue', 'string', '使用银行字典时对应值', { nullable: true }), f('receivingAccount', 'string', '收款账号，按字符串保留前导零', { nullable: true }),
]
for (const flow of metadata) {
  const prepare = contracts[`${flow.prefix}-prepare`]!
  for (const field of prepare.output.fields) if (field.path.startsWith('payload.')) field.type = draftTypes[field.path.slice(8)] ?? field.type
  if (flow.prefix !== 'travel-expense') {
    prepare.output.fields.push(...prefixed('payload.', derived[flow.prefix] ?? []))
    if (['overtime-application', 'rest-leave-application', 'business-trip-application'].includes(flow.prefix)) {
      prepare.output.shape = '{ payload, derived, tasks }'
      prepare.output.fields.push(f('derived', 'object', '从当前用户、余额与草稿计算的只读字段'), ...prefixed('derived.', derived[flow.prefix]!))
    }
    if (flow.prefix === 'leave-application') {
      prepare.output.shape = '{ payload, tasks, restDay }'
      prepare.output.fields.push(f('restDay', 'number', '后端计算的请假天数；婚假 type=7 走自然日半天算法'))
      prepare.consume.push('type=13 年假必须有足够 unRest；type=3/4/7/8/9 必须附 PDF/JPG/JPEG/PNG 证明。')
    }
    if (flow.prefix === 'rest-leave-application') prepare.output.fields.push(...prefixed('payload.leaveDateItems[].', [f('leaveDate', 'string', 'YYYY-MM-DD 调休日期；相同日期不允许重复'), f('leaveHours', 'number', '当日调休小时，大于 0 且最多 1 位小数')]))
    if (flow.defs.some(d => d.params.some(p => p.name === 'attachments'))) prepare.output.fields.push(...prefixed('payload.attachments[].', attachments))
  }
  const detail = contracts[`${flow.prefix}-detail`]
  if (!detail) continue
  const fields = [f('id', 'number', '业务单据 ID，不能当流程实例 ID', { nullable: flow.prefix === 'leave-application' }), ...draftFields(flow).filter(x => !['copyUserIds', 'payeeInfo', 'travelerIds'].includes(x.path)).map(x => ({ ...x, type: draftTypes[x.path] ?? x.type, optional: true })), ...(derived[flow.prefix] ?? []).filter(x => x.path !== 'restDay').map(x => ({ ...x, optional: true }))]
  if (flow.prefix !== 'leave-application' && flow.prefix !== 'travel-expense') fields.push(f('status', 'number', '业务单据状态；流程是否运行以 my-instances.status 为准', { optional: true, values: state }), f('statusName', 'string', '业务状态中文标签', { optional: true, nullable: true }))
  if (flow.prefix === 'vehicle-application' || flow.prefix === 'travel-expense') fields.push(f('processInstanceId', 'string', '实际流程实例 ID，可直接用于 cancel.processInstanceId', { optional: true, nullable: true }))
  if (flow.defs.some(d => d.params.some(p => p.name === 'attachments')) && flow.prefix !== 'travel-expense') fields.push(...prefixed('attachments[].', attachments))
  output(detail, flow.prefix === 'vehicle-application' ? '业务单据对象 | null' : '业务单据对象（拆包后）', fields, 'null/空值时停止消费字段并核对业务 ID、当前身份与权限；不要把不存在的详情拼成记录。', ['展示本次申请的业务字段与附件；原请求业务 ID 必须单独保存，详情不保证能提供流程实例 ID。', '状态应区分业务单据与流程实例；需要可撤回性时查 my-instances，而不是只看详情 status。'], '用户查询详情时交付业务信息与可靠状态即可；需要取消则先确认对应实例仍运行。')
  detail.steps = [step('optional', `${flow.prefix}-my-instances`, '需要可靠流程状态或实例 ID', { '调用 detail 时的 id（转字符串）': '客户端匹配 list[].businessKey' }, `同时匹配 processDefinitionKey=${flow.key}。`), step('cancel', `${flow.prefix}-cancel`, '用户要撤回且流程 status=1', { 'args.id': 'businessKey' }, '填写非空 reason；不能以业务 status=0 推断没有发起。')]
  if (flow.prefix === 'leave-application') {
    detail.output.fields.find(x => x.path === 'id')!.meaning = '历史实测恒为 null，后端未 setId；必须保留 submit 返回的业务 ID'
    detail.consume.push('本详情没有 restDay 与 processInstanceId；请假天数须用 duration 重算，流程实例须按提交返回 ID 查询。')
    detail.output.fields.push(f('typeName', 'string', '实时 absent_type 字典标签，展示优先用它', { optional: true }))
  }
  if (['vehicle-application', 'business-trip-application'].includes(flow.prefix)) detail.consume.push('真实新提交后业务 status 仍可能为 0（待提交），流程已在运行；不能以 0 判断提交失败。')
  if (['vehicle-application', 'general-approval', 'product-design-approval'].includes(flow.prefix)) detail.output.fields.find(x => x.path === 'statusName')!.meaning = '后端未填充，历史实测为 null；按 status 映射标签'
}
// Meeting room inventory and occupancy are different results, neither is a reservation.
const meetingFlow = metadata[0]!
const room = base(meetingRoomCapabilities[0]!, meetingFlow)
output(room, '{ list: 会议室[], total: number }', [f('list', 'array', '当前页会议室'), f('total', 'number', '匹配总数'), f('list[].id', 'number', '会议室 ID → meetingRoomId'), f('list[].name', 'string', '会议室显示名称'), f('list[].authorizedOrgId', 'number', '授权组织 ID', { optional: true })], '无会议室候选时调整名称/组织或告知无可选会议室。', ['按 name 搜索后让用户选中 id；列表不表示可用时间，必须另查 usage。'], '给用户交付会议室候选或保存选中的 id。')
room.steps = [step('optional', 'meeting-room-usage', '需要预订时间', {}, '用 YYYY-MM-DD 查询占用；按 id 对应 meetingRooms[].meetingRoomId。')]
contracts['meeting-room-list'] = room
output(contracts['meeting-room-usage']!, '{ organizationId?, date?, meetingRooms: 会议室占用[] }', [f('organizationId', 'number', '占用查询的组织范围', { optional: true }), f('date', 'string', '查询日期 YYYY-MM-DD', { optional: true }), f('meetingRooms', 'array', '会议室与其占用时间段，不是顶层数组'), f('meetingRooms[].meetingRoomId', 'number', '会议室 ID → prepare.meetingRoomId'), f('meetingRooms[].meetingRoomName', 'string', '会议室名称'), f('meetingRooms[].timeSlots', 'array', '已占用时间段；空数组仅表示返回范围内无占用'), f('meetingRooms[].timeSlots[].startTime', 'string', '开始日期时间 YYYY-MM-DD HH:mm:ss'), f('meetingRooms[].timeSlots[].endTime', 'string', '结束日期时间 YYYY-MM-DD HH:mm:ss'), f('meetingRooms[].timeSlots[].userName', 'string', '预订人名称', { optional: true }), f('meetingRooms[].timeSlots[].meetingName', 'string', '会议名称', { optional: true })], 'meetingRooms=[] 为本次范围无会议室结果；timeSlots=[] 为无已登记占用，不是写入锁。', ['按同一会议室比较时段交集；结束等于下一开始不算重叠。展示名称、日期、起止时间，避免用数组长度推空闲房间数。'], '查询需求交付占用表；预订需求选定无冲突时间后进入准备。')
contracts['meeting-room-usage']!.steps = [step('optional', 'meeting-application-prepare', '用户选定会议室及时间段', { 'meetingRooms[].meetingRoomId': 'meetingRoomId' }, '填写会议名称、人数及 YYYY-MM-DD HH:mm:ss 起止时间；分钟只能 00/30，秒 00。')]
contracts['meeting-application-prepare']!.output.fields.unshift(f('payload.id', 'null', '新建时固定 null，不是已创建单据', { nullable: true }))
contracts['meeting-application-submit']!.output.fields[0]!.meaning = '新建会议预订单据 ID → meeting-application-cancel.id；不是会议室 ID'
contracts['meeting-application-definition']!.evidence = [{ source: 'src/capabilities/meeting-application.ts', kind: 'implementation', note: '定义、占用和提交方法' }, { source: 'baseline/meeting-application-form.browser.json', kind: 'browser', note: '定义与占用读基准' }]
for (const id of ['meeting-room-usage', 'meeting-user-search', 'meeting-application-prepare', 'meeting-application-submit', 'meeting-application-cancel']) contracts[id]!.evidence = [{ source: 'src/capabilities/meeting-application.ts', kind: 'implementation', note: '返回与半小时时段约束' }, { source: 'baseline/meeting-application-write.browser.json', kind: 'browser', note: '历史准备、提交、取消基准；本轮离线复核' }]
room.evidence = [{ source: 'baseline/meeting-room-page.browser.json', kind: 'browser', note: '真实分页请求' }, { source: 'src/capabilities/meeting-room.ts', kind: 'implementation', note: '返回 list/total；组织过滤' }]

output(contracts['leave-application-profile']!, '{ id, userName, staffCode, fullPath }', [f('id', 'string', '当前用户 ID，映射业务载荷 userId'), f('userName', 'string', '来自 realName 的申请人姓名'), f('staffCode', 'string', '来自 username 的工号'), f('fullPath', 'string', '来自 organizationName 的部门名称；不是 organizationFullPathName')], '缺失必需身份字段会在准备时拒绝；不能代填其他人。', ['只显示姓名、工号、部门；prepare 自动获取，不接受冒充申请人。'], '确认当前请假申请身份。')
output(contracts['leave-application-types']!, '{ label: string, value: number }[]', [f('[].label', 'string', '请假类型名称'), f('[].value', 'number', '传给 prepare/submit.type；13 年假需余额，3/4/7/8/9 需附件')], '缺少 absent_type 字典时返回 []，不能猜类型值。', ['以实时字典展示选择；静态 options 仅作参考。'], '保存选中的 value 作为 type。')
contracts['leave-application-types']!.steps = [step('optional', 'leave-application-prepare', '用户选定类型并完成草稿', { '[].value': 'type' }, '按附件与年假规则准备。')]
output(contracts['leave-application-year-rest']!, '{ rest?, unRest? }', [f('rest', 'number', '当年应享年假天数，按司龄计算', { optional: true }), f('unRest', 'number', '剩余年假天数，可以是负数或半天', { optional: true })], '余额字段缺失不能按 0 猜测；年假准备会拒绝无法比较的余额。', ['年假 type=13 时比较申请天数 <= unRest 且 unRest>0；负数表示欠额，不截成可用天数。'], '交付年假总额/剩余天数，或确认本次申请余额够用。')
output(contracts['leave-application-duration']!, 'number', [f('$', 'number', '请假天数；由后端 calculateRestDay 计算，本接口不接收 type')], '日期/时段不全时返回 0；0 不代表具备合法提交草稿。', ['开始/结束为 YYYY-MM-DD + 1 上午/2 下午；用结果展示天数。', '婚假 type=7 的 prepare 使用自然日半天算法，不能拿本通用接口结果覆盖婚假 restDay。'], '已获得当前日期时段的后端工作日天数。')
contracts['leave-application-submit']!.output.fields[0]!.meaning = '请假记录按日/半天多行插入后的最后一行 ID，也是流程 businessKey；必须保存，detail.id 历史为 null'
output(contracts['rest-leave-application-remaining-hours']!, 'number', [f('$', 'number', '剩余可调休加班小时；后端 null 被 SDK 归一为 0')], 'null 归一为 0，表示当前可用小时不足以正数调休。', ['userId 来自 current-user.id，不能把 staffId 放这里；比较调休明细小时合计与本值。'], '展示可调休小时；正式提交会重新查询余额。')

const staffFields = [f('id', 'string | number', '员工 ID，历史与 staffId 同值'), f('staffId', 'string | number', '员工 ID → 用车草稿 staffId；不是 userId'), f('staffCode', 'string | number', '工号'), f('username', 'string | number', '工号别名'), f('name', 'string', '员工姓名，优先取为 staffName'), f('realName', 'string', 'name 缺失时的姓名后备'), f('status', 'number', '员工在职状态', { values: { '1': '在职', '2': '离职', '3': '退休', '4': '返聘', '5': '在编不在岗' } }), f('organizationId', 'string | number', '所属组织 ID'), f('organizationName', 'string', '所属组织名称')].map(x => ({ ...x, optional: true }))
output(contracts['vehicle-application-applicant-scope']!, '{ organizationIds: (string|number)[], tree: 组织树 }', [f('organizationIds', 'array', '可用于申请人选择的根组织 ID；从顶层的下一层取，去重，最多 50 个'), f('tree', 'array', '原始权限组织树'), f('tree[].id', 'string | number', '组织节点 ID'), f('tree[].name', 'string', '组织显示名称', { optional: true }), f('tree[].children', 'array', '递归同结构的子组织', { optional: true })], '根组织为空或超过 50 时 SDK 抛错；联系管理员调整组织入口。', ['把 organizationIds 原样传 applicant-picker；不把整棵树当人员结果。'], '获得当前用户权限内的申请人查询范围。')
contracts['vehicle-application-applicant-scope']!.steps = [step('required', 'vehicle-application-applicant-picker', '需要选择用车申请人', { organizationIds: 'organizationIds' }, '再提供姓名/工号关键字，分页查候选。')]
output(contracts['vehicle-application-applicant-picker']!, '{ list?, total?, selectedItems? }', [f('list', 'array', '当前页员工候选', { optional: true }), f('total', 'number | string', '匹配总数；用于分页时转 Number', { optional: true }), ...prefixed('list[].', staffFields), f('selectedItems', 'array', 'selectedStaffIds 的回显行，不是另一页候选', { optional: true }), ...prefixed('selectedItems[].', staffFields)], 'list=[] 时调整关键词或组织，不把 selectedItems 当新增搜索结果。', ['用 name || realName 和 staffCode || username 展示消歧；保留 staffId || id 作为员工标识。', '不传 organizationIds 时 SDK 自动查权限根组织；pageSize 上限 100、selectedStaffIds 上限 100。'], '用户选中员工后保存员工 ID 与姓名。')
contracts['vehicle-application-applicant-picker']!.steps = [step('optional', 'vehicle-application-prepare', '申请人已确认且其他用车字段完整', { 'list[].staffId': 'staffId', 'list[].name': 'staffName' }, 'staffId 缺失时回退同一行 id，并转字符串；name 缺失时回退 realName。审批人另走 approver-search，不能把员工 ID 当审批用户 ID。')]
const optionsFields = [f('[].label', 'string', '选项显示名称'), f('[].value', 'number', '字段实际提交的字典值，非数组下标')]
for (const id of ['travel-expense-fee-items', 'travel-expense-dict-options']) {
  output(contracts[id]!, '{ label: string, value: number }[]', optionsFields, '[] 表示本次源或字典无选项，不猜一个值。', [id.endsWith('fee-items') ? '本表单 sourceKey=finance_travel，历史仅 1=差旅费；不是 finance_payment_fee_item 那张大字典。' : 'trip_mode→明细 tripMode；finance_project_fund_source→明细 fundSource；payee_type→payeeInfo.payeeType；finance_project_type/attribute 仅用于项目快照显示。'], '保存选项 value 到对应业务字段，并用 label 展示。')
}
output(contracts['travel-expense-org-options']!, '成本中心组织扁平数组', [f('[].id', 'string', '组织 ID → orgId'), f('[].name', 'string', '组织名称'), f('[].depth', 'number', '原树深度，从 0 开始'), f('[].selectable', 'boolean', 'true 表示 financeCostCenter=1，可作为页面成本中心'), f('[].financialCostCenter', 'number', '保留的财务成本中心标记', { optional: true, nullable: true })], '无匹配时换关键词；不得选择未授权或非成本中心组织。', ['keyword 在 SDK 本地筛组织名；默认 costCenterOnly=true，只保留可选项。', '列表已经扁平，不要按 children 再遍历。'], '选中组织 id，并展示名称供确认。')
contracts['travel-expense-org-options']!.steps = [step('optional', 'travel-expense-prepare', '成本中心及其他费用字段已齐全', { '[].id': 'orgId' }, '项目费用还需项目、逐行资金来源及后端组织归属校验。')]
output(contracts['travel-expense-area-options']!, '地区树节点[]', [f('[].id', 'string | number', '地区 ID，构造 startRegion/endRegion 时转字符串'), f('[].name', 'string', '地区名称'), f('[].children', 'array', '下一级地区，递归同结构', { optional: true })], '未知 parentId 或叶子节点返回 []；不能据此编造缺失的区 ID。', ['无 parentId 返回整棵树；有 parentId 返回该节点直接子节点。按省→市→区选出恰好 3 个 ID。'], '获得地区三级 ID 数组，并另填详细地址。')
contracts['travel-expense-area-options']!.steps = [step('optional', 'travel-expense-area-options', '尚未选到第三级', { '[].id': 'parentId' }, '将所选 id 转字符串后逐级下钻，保留省市区各级 ID。')]
const projects = [f('[].id', 'number | string', '项目 ID → financeProjectId'), f('[].projectName', 'string', '项目名称'), f('[].projectCode', 'string', '项目编码'), f('[].projectType', 'number', '项目类型，用 finance_project_type 字典展示', { nullable: true }), f('[].projectAttribute', 'number', '项目属性，用 finance_project_attribute 字典展示', { nullable: true }), f('[].companyId', 'number', '项目所属公司 ID', { nullable: true }), f('[].companyName', 'string', '项目所属公司名称', { nullable: true })]
output(contracts['travel-expense-projects']!, '项目候选[]', projects, '[] 表示无匹配项目，projectExpense=true 时必须先选出有效项目。', ['keyword 按项目名称查询；选定 id，prepare 会重新按 ID 获取项目快照，不信调用方自填项目名称。'], '保存选择的 financeProjectId，展示对应项目名称及公司。')
contracts['travel-expense-projects']!.steps = [step('optional', 'travel-expense-prepare', '项目与其他费用字段已齐全', { '[].id': 'financeProjectId' }, 'projectExpense=true 时每行还必须填 fundSource。')]
const principalContract = contracts['travel-expense-project-principal']!
principalContract.inputs.id = { meaning: '项目主键，不是员工或用户 ID', source: 'travel-expense-projects[].id', required: true, lookup: { capabilityId: 'travel-expense-projects', args: { keyword: '$keyword' }, valueField: '[].id', labelField: '[].projectName' } }
output(principalContract, '{ id, principalStaffId, principalName, status }', [f('id', 'number | string', '项目主键，与输入 id 一致'), f('principalStaffId', 'number | string | null', '课题负责人员工 ID；转字符串填预览 variables.课题负责人，不是用户 ID', { nullable: true }), f('principalName', 'string | null', '负责人显示姓名', { nullable: true }), f('status', 'number | null', '项目启停状态；预览要求 1', { nullable: true, values: { '0': '停用', '1': '启用' } })], '项目不存在或返回 id 不符时抛错；负责人 null 或状态非 1 时不能准备项目费用。', ['显示负责人姓名；由 prepare 自动校验启用状态并将员工 ID 转字符串补入流程变量。'], '负责人来源已核实；还需 prepare 获得完整审批链。')
principalContract.steps = [step('required', 'travel-expense-prepare', '项目费用草稿齐全', { id: 'financeProjectId' }, '使用原始完整草稿；prepare 自动重新读取负责人。')]
principalContract.evidence = [{ source: 'Portal 项目设置页 /finance/project/get 与 Java FinanceProjectRespVO、BpmSpendingApplyTravelServiceImpl.buildProcessInstanceVariables', kind: 'reference', note: '源码确认 principalStaffId 转字符串；本轮仅离线验证，未发真实请求。' }]
output(contracts['travel-expense-travelers']!, '{ list: 出差人候选[], total: number }', [f('list', 'array', '当前页在职/返聘用户（statusList=1,4）'), f('total', 'number', '匹配总数'), f('list[].id', 'string', '用户 ID → travelerIds[]，SDK 提交时转数字'), f('list[].realName', 'string', '姓名', { nullable: true, optional: true }), f('list[].username', 'string', '工号', { nullable: true, optional: true }), f('list[].organizationName', 'string', '所属组织', { nullable: true, optional: true }), f('list[].postName', 'string', '岗位', { nullable: true, optional: true })], 'list=[] 时调整关键字，不能猜 userId。', ['必须先有 keyword，默认每页 20；用姓名+工号+部门消歧，至少选一人。'], '保存选中的用户 ID 数组，第一人会同时写入兼容字段 traveler。')
contracts['travel-expense-travelers']!.steps = [step('optional', 'travel-expense-prepare', '出差人已确定且费用草稿完整', { 'list[].id': 'travelerIds' }, '把选中行的 id 组成数组，保留用户选定顺序，SDK 以第一人为 traveler。')]
const travel = contracts['travel-expense-prepare']!
output(travel, '{ payload, variables, approvalChain, previewComplete, approvers, amount }', [
  f('payload', 'object', '实际将提交的归一业务载荷预览；不含 payeeInfo，收款字段摊在顶层'),
  ...prefixed('payload.', draftFields(metadata.find(x => x.prefix === 'travel-expense')!).filter(x => x.path !== 'payeeInfo').map(x => ({ ...x, path: x.path === 'attachments' ? 'attachmentList' : x.path, type: draftTypes[x.path] ?? x.type }))),
  f('payload.traveler', 'number', 'travelerIds 第一个用户 ID'), f('payload.amount', 'number', '费用总额，元，包含每行进项税'),
  ...prefixed('payload.', payeeFields), ...prefixed('payload.travelEntryList[].', travelEntries), ...prefixed('payload.attachmentList[].', attachments),
  ...['Name', 'Code', 'Type', 'Attribute', 'CompanyId', 'CompanyName'].map(key => f(`payload.financeProject${key}`, /Type|Attribute|CompanyId/.test(key) ? 'number | null' : 'string', `所选项目的 ${key} 快照，SDK 查询项目后回填`, { optional: key === 'CompanyId' })),
  f('variables', 'object', '客户端可构造的流程变量；不是允许任意注入的 submit 参数'), f('variables.targetOrgId', 'number', '所选成本中心 orgId 转数字；非有限数值时省略', { optional: true }), f('variables.费用申请类型', 'string', '项目费用或非项目费用，按 projectExpense 派生'),
  f('approvalChain', 'array', '按现有变量预览的审批链'), ...prefixed('approvalChain[].', previewNodes),
  f('variables.课题负责人', 'string', '项目费用时由项目详情 principalStaffId 转字符串；员工 ID，不是用户 ID', { optional: true }),
  f('previewComplete', 'boolean', '成功 prepare 为 true，表示按当前 Java 创建规则补齐变量；不保证预览后配置不变'),
  f('approvers', 'array', '链中实际候选人去重列表；空列表不代表不启动流程'), f('approvers[].node', 'string', '审批节点名称'), f('approvers[].id', 'number', '候选用户 ID'), f('approvers[].nickname', 'string', '候选姓名'),
  f('amount', 'number', '所有行交通+餐食+住宿+其他+进项税之和，元'),
], 'approvers=[] 仅表示当前预览未解析出候选；成功时 previewComplete=true 也不能当作无通知或提交必成功的证明。', ['展示费用金额与费用用途，按行核对日期、地区、金额；travelTotalAmount 不含税，amount 含税，不要重复累加。', 'prepare 做自审拦截，submit 本身不再执行这次预览；修改草稿后必须重新准备。', 'projectExpense=true 自动读取项目负责人并补齐预览变量；缺负责人或非启用状态时停止。组织归属仍由提交后端校验。'], '当前草稿变量与金额已核对，并通过自审拦截；真实提交仍可能因组织归属、预算或配置变化失败。')
travel.steps = [step('required', 'travel-expense-submit', '用户已确认费用草稿且所需审批证据齐全', { '原始草稿': '同名参数' }, '不传 startUserSelectAssignees，本表单没有自选审批人参数；不要整体传 payload 或 variables。')]
travel.gaps = ['预算明细、销售费用关联收入科目、内部收款法人候选未接入；相关可选字段只能使用用户已核对来源的值，不能自行获取或猜 ID。']
contracts['travel-expense-submit']!.prerequisites = ['先以同一草稿调用 travel-expense-prepare，核对金额、自审与预览完整性；submit 自身不会再次调用审批预览。']
contracts['travel-expense-submit']!.gaps = [...travel.gaps]
contracts['travel-expense-submit']!.boundaries.push('收款信息与预算分支本轮只核对源码及离线测试，没有真实提交回读证据。')
const travelDetail = contracts['travel-expense-detail']!
output(travelDetail, '差旅费业务单据对象', [
  f('id', 'number', '业务单据 ID', { optional: true, nullable: true }), f('orgId', 'number | string', '费用组织 ID', { optional: true, nullable: true }), f('projectExpense', 'boolean', '是否项目费用', { optional: true, nullable: true }),
  f('financeProjectId', 'number', '项目 ID', { optional: true, nullable: true }), f('financeProjectName', 'string', '项目显示名称', { optional: true, nullable: true }), f('traveler', 'number', '首位出差人 ID', { optional: true, nullable: true }),
  f('travelerIds', 'string', '后端保存的多出差人标识字符串；不是提交用数字数组', { optional: true, nullable: true }), f('travelerName', 'string', '出差人显示名称', { optional: true, nullable: true }),
  f('reasons', 'string', '出差事由', { optional: true, nullable: true }), f('amount', 'number', '费用总额，元，含进项税', { optional: true, nullable: true }), f('paymentDate', 'string', '预计付款日期 YYYY-MM-DD', { optional: true, nullable: true }),
  f('remark', 'string', '其他说明', { optional: true, nullable: true }), f('feeItem', 'number', '费用项目值', { optional: true, nullable: true }), f('feePurpose', 'string', '费用用途', { optional: true, nullable: true }),
  f('processInstanceId', 'string', '流程实例 ID → cancel.processInstanceId', { optional: true, nullable: true }), f('attachment', 'string', '后端附件存储字段，显示优先用 attachmentList', { optional: true, nullable: true }),
  f('attachmentList', 'array', '附件展示列表', { optional: true }), ...prefixed('attachmentList[].', attachments),
  f('travelEntryList', 'array', '保存的差旅明细；单独开始结束日期及省市区 ID 用于显示/回填', { optional: true }), ...prefixed('travelEntryList[].', travelEntries.filter(x => !['startEndDate', 'startRegion', 'endRegion'].includes(x.path))),
], '详情为空时先核对业务 ID 与权限，不能判成功或替用户重建。', ['展示出差人、费用用途、含税总额与明细；查询审批状态要读实例，不从金额或详情存在推导已通过。', '重新发起是另一次 create；必须把保存字段转回草稿日期区间与三级地区数组，重新查询候选/预算并 prepare，不能把详情直接当更新载荷。'], '已交付单据详情；要撤回时使用 processInstanceId 或原业务 ID。')

const workflowFields = [
  f('[].id', 'string', '真实运行任务 ID → 办理动作 taskId'), f('[].name', 'string', '任务名称', { optional: true }),
  f('[].status', 'number', '任务状态，不是流程实例状态；1/6 且本人持有才可办理', { optional: true, values: taskState }),
  f('[].taskDefinitionKey', 'string', 'BPMN 节点键，不能当任务 ID', { optional: true }),
  f('[].assigneeUser', 'object', '当前被分配人', { optional: true, nullable: true }), f('[].assigneeUser.id', 'number | string', '当前办理人用户 ID，按 String 比较当前用户'), f('[].assigneeUser.nickname', 'string', '当前办理人姓名', { optional: true }),
  f('[].children', 'array', '原节点保留的子任务；SDK 已将其加入顶层扁平结果，不再递归计数', { optional: true, nullable: true }),
]
const actionDescriptions: Record<string, string> = {
  approve: '通过分配给自己的当前任务；下一节点仍可能继续审批，不能直接认定全流程通过。',
  reject: '对分配给自己的当前任务给出不通过意见；业务单据后续状态按流程监听器回写。',
  transfer: '转办给另一个用户，我不再持有该任务；与委派后回到本人不同。',
  delegate: '委派给另一个用户先处理，处理后回到原持有人；不是转办。',
  return: '退回到后端给出的可回退节点；不是取消流程、不是发起人撤回。',
  'batch-approve': '对选中的本人通用待办批量通过；只处理 category=null 或 8，不能用在 KPI 专属协议任务。',
  'batch-reject': '对选中的本人通用待办批量不通过；必填意见，逐项回查处理结果。',
}
for (const def of taskActionCapabilities) {
  const c = base(def, { ...meetingFlow, prefix: 'task-action', title: '待办办理', file: 'task-action', key: '按实例实际流程', note: '审批侧操作本人持有的待办任务；与发起/取消自己的流程不同。', defs: taskActionCapabilities })
  c.boundaries = ['只允许当前用户办理 assigneeUser.id 等于本人且 status 为 1 或 6 的任务。', '不覆盖 KPI 协议族 category=2..7 的 HR 特殊办理，不覆盖加签/减签。']
  const suffix = def.id.slice('task-action-'.length)
  if (suffix === 'instance') {
    output(c, '流程实例对象', [f('id', 'string', '流程实例 ID，不是 taskId', { optional: true }), f('name', 'string', '流程名称', { optional: true }), f('status', 'number', '流程实际状态', { optional: true, values: processState }), f('businessKey', 'string', '对应业务单据 ID', { optional: true }), f('startUser.id', 'number | string', '发起人用户 ID，不一定是当前办理人', { optional: true }), f('startUser.nickname', 'string', '发起人姓名', { optional: true }), f('processDefinition.key', 'string', '流程 key，用于选择相应业务 detail', { optional: true }), f('processDefinition.name', 'string', '流程定义名称', { optional: true }), f('processDefinition.formType', 'number', '流程表单类型', { optional: true }), f('formFields', 'null', '历史实测 null，无法从实例响应获取可填写表单字段', { optional: true, nullable: true })], '空实例时核对来自待办的 processInstance.id，不猜业务 ID。', ['显示流程名称、发起人与状态；业务内容按 processDefinition.key + businessKey 转到对应流程 detail。', '不能用 startUser.id 判断该谁办，必须读取 workflow-path 的 assigneeUser。'], '查询需求展示流程概览；办理需求继续获取本人运行任务。')
    c.steps = [step('required', 'task-action-workflow-path', '需要判断哪些任务可办理', { 'id': 'processInstanceId' }, '用当前登录用户 ID 比较每个任务的 assigneeUser.id。')]
  } else if (suffix === 'workflow-path') {
    output(c, 'WorkflowTask[]（已经展平，且去掉顶层已取消节点）', workflowFields, '[] 或无本人 status=1/6 任务，表示当前没有可由本人办理的任务；不创建写动作。', ['SDK 已递归展平 children，不要再次展开造成重复处理。', '只取 status===1 或 status===6 且 String(assigneeUser.id)===String(当前用户ID) 的行；0 是待审批，不可办理。'], '已列出本人可办任务；没有匹配时告知用户当前无可办理任务。')
    c.steps = [step('optional', 'task-action-approve', '用户明确要通过所选本人可办任务', { '[].id': 'taskId' }, '先核对业务详情，再生成 requestId。'), step('optional', 'task-action-return-options', '用户希望退回', { '[].id': 'taskId' }, '先查询合法回退节点。')]
  } else if (suffix === 'return-options') {
    output(c, '{ name?, taskDefinitionKey? }[]', [f('[].name', 'string', '可回退节点名称', { optional: true }), f('[].taskDefinitionKey', 'string', '回退目标 BPMN 节点键 → targetTaskDefinitionKey', { optional: true })], '[] 表示当前没有可回退节点，停止回退流程。', ['让用户从返回节点中选择；必须用 taskDefinitionKey，不用 name 或当前 taskId 代替。'], '已选定合法回退目标或确认不可回退。')
    c.steps = [step('optional', 'task-action-return', '用户选定回退节点并说明理由', { '[].taskDefinitionKey': 'targetTaskDefinitionKey', 'args.taskId': 'taskId' }, '补非空 reason 与 requestId。')]
  } else {
    c.purpose = actionDescriptions[suffix]!
    c.whenToUse = actionDescriptions[suffix]!
    c.inputs.requestId = requestId
    if (suffix === 'approve' || suffix === 'batch-approve') c.inputs.reason = { meaning: '审批意见，可选，SDK 缺省空串；后端把空串替换为“无”', source: '用户给出的审批意见' }
    output(c, 'boolean（拆包后的后端成功回执）', [f('$', 'boolean', 'true 表示接口受理成功；实际任务归属、任务状态和流程状态需回读确认')], '没有回执或网络中断时按结果不确定处理，不发送新的写意图。', [actionDescriptions[suffix]!, '办理后用保留的 processInstanceId 重新查任务链和实例状态；批量需逐个实例核对，不能由一条回执推断全部终态。'], suffix === 'transfer' ? '任务当前办理人已变为目标用户，向用户报告转办完成。' : suffix === 'delegate' ? '任务已进入委派处理链；说明后续仍会返回原持有人。' : '已确认相应任务状态/走向发生预期改变；如流程仍运行，报告等待后续审批。')
    c.steps = [step('required', 'task-action-workflow-path', '动作后或回执不确定', { 'context.previous.processInstanceId': 'processInstanceId' }, '核对原 taskId 的状态、持有人及后续任务，不能把 TASK_NOT_EXISTS 一律解释为失败。')]
    c.idempotency = '通过 invoke 或对应 *Idempotent 门面传 requestId；同意图复用同值/同载荷。原始 approve/reject/transfer/delegate/returnTask/batchApprove/batchReject 不防重。'
    c.failures.push(writeFailure, '任务不存在可能是别人已处理或前次写已成功，先回查；任务不属于当前用户时停止，不通过切换身份绕过。')
    c.boundaries.push('历史只验证读链和不存在 taskId 的错误探针；缺少由第二个授权测试账号发起、当前账号成功办理并回读状态的端到端证据。行为说明依据固定后端源码和离线响应测试，不代表成功写链已实测。')
    c.evidence.push({ source: '后端 test/test dcb3f360194 的 BpmTaskController.java', kind: 'reference', note: '七种写操作返回 CommonResult<Boolean>；SDK 拆包后为 boolean，非新任务 ID' })
  }
  contracts[def.id] = c
}

// Explicit candidate sources and nested inputs: identifiers always retain their business namespace.
const lookups: Record<string, { capabilityId: string; args: Record<string, unknown>; valueField: string; labelField: string }> = {
  meetingRoomId: { capabilityId: 'meeting-room-list', args: { name: '<会议室关键词>' }, valueField: 'list[].id', labelField: 'list[].name' },
  staffId: { capabilityId: 'vehicle-application-applicant-picker', args: { keyword: '<姓名或工号>' }, valueField: 'list[].staffId', labelField: 'list[].name' },
  orgId: { capabilityId: 'travel-expense-org-options', args: { keyword: '<组织关键词>' }, valueField: '[].id', labelField: '[].name' },
  financeProjectId: { capabilityId: 'travel-expense-projects', args: { keyword: '<项目关键词>' }, valueField: '[].id', labelField: '[].projectName' },
  travelerIds: { capabilityId: 'travel-expense-travelers', args: { keyword: '<姓名或工号>' }, valueField: 'list[].id', labelField: 'list[].realName' },
  type: { capabilityId: 'leave-application-types', args: { dictType: 'absent_type' }, valueField: '[].value', labelField: '[].label' },
  targetTaskDefinitionKey: { capabilityId: 'task-action-return-options', args: { taskId: '<当前 taskId>' }, valueField: '[].taskDefinitionKey', labelField: '[].name' },
}
for (const [id, c] of Object.entries(contracts)) {
  for (const [name, input] of Object.entries(c.inputs)) {
    if (lookups[name]) { input.lookup = lookups[name]; input.source = `${lookups[name]!.capabilityId} 的 ${lookups[name]!.valueField}` }
    if (['copyUserIds', 'startUserSelectAssignees', 'assigneeUserId', 'delegateUserId'].includes(name)) {
      const search = id.startsWith('meeting-') ? 'meeting-user-search' : id.startsWith('product-design-approval') ? 'product-design-approval-user-search' : id.startsWith('vehicle-application') ? 'vehicle-application-approver-search' : 'general-approval-user-search'
      input.lookup = { capabilityId: search, args: { keyword: '<姓名关键词>' }, valueField: 'list[].id', labelField: 'list[].nickname' }
      input.source = name === 'startUserSelectAssignees' ? `${id.replace(/-(submit|preview)$/, '-prepare')} 的 tasks[].id 作键，人员搜索的 list[].id 作数字数组值` : `${search}.list[].id；与 HR staffId 不同`
    }
    if (name === 'attachments') {
      c.inputs['attachments[].url'] = { meaning: '已上传文件的 OSS 地址，不能传本地文件路径', source: 'base-upload-file 的 url；上传需单独提供文件内容/路径参数，查看其描述', constraints: [id.startsWith('travel-expense') ? '上传目录 Finance/expense' : '上传目录 HR/approval'] }
      c.inputs['attachments[].name'] = { meaning: '文件名（含扩展名）；按当前表单的允许扩展名校验', source: '上传原文件名' }
    }
  }
  if (c.inputs.travelEntryList) {
    for (const field of travelEntries.filter(x => !['startDate', 'endDate', 'startProvince', 'startCity', 'startDistrict', 'endProvince', 'endCity', 'endDistrict'].includes(x.path))) c.inputs[`travelEntryList[].${field.path}`] = { meaning: field.meaning, source: /Region/.test(field.path) ? 'travel-expense-area-options 逐级取得省市区 id；转字符串组成数组' : field.path === 'fundSource' ? 'travel-expense-dict-options({dictType:"finance_project_fund_source"}) 的 value' : '用户行程/费用资料；预算标识需已核实的来源，不可猜测', format: field.type }
    for (const field of payeeFields) c.inputs[`payeeInfo.${field.path}`] = { meaning: field.meaning, source: /payeeId|payeeCode|payeeSourceType/.test(field.path) ? 'catalog.describeMethod("travelExpense.payeeOptions") 获取真实门面说明，再查候选 id/code/sourceType' : '用户已确认的收款信息；没有候选入口的法人标识不得猜测', format: field.type }
  }
  if (c.inputs.leaveDateItems) {
    c.inputs['leaveDateItems[].leaveDate'] = { meaning: '调休日期，不允许同日重复行', source: '用户选择日期', format: 'YYYY-MM-DD' }
    c.inputs['leaveDateItems[].leaveHours'] = { meaning: '本日调休小时，大于 0，最多 1 位小数；合计不能超过实时余额', source: '用户选择小时数', format: 'number，小时' }
  }
}

export const WORKFLOW_AI_CONTRACTS: Record<string, AiContract> = contracts

/** Public business methods without a directory ID remain discoverable by describeMethod(sdkPath). */
export const WORKFLOW_METHOD_CONTRACTS: Record<string, AiContract> = {}
const facades: Record<string, string> = {
  'meeting-application': 'meetingApplication', 'general-approval': 'generalApproval', 'leave-application': 'leaveApplication',
  'vehicle-application': 'vehicleApplication', 'travel-expense': 'travelExpense', 'product-design-approval': 'productDesignApproval',
  'overtime-application': 'overtimeApplication', 'rest-leave-application': 'restLeaveApplication', 'business-trip-application': 'businessTripApplication',
}
const clone = (c: AiContract): AiContract => structuredClone(c)
for (const flow of metadata) {
  const facade = facades[flow.prefix]!
  const raw = clone(contracts[`${flow.prefix}-submit`]!)
  delete raw.inputs.requestId
  raw.idempotency = '此原始 submit 方法不防重；推荐通过 capabilities.invoke(能力ID, {草稿,requestId}) 或 submitIdempotent。'
  raw.consume.unshift(`直接调用 sdk.${facade}.submit(draft${flow.prefix === 'travel-expense' ? '' : ['overtime-application', 'rest-leave-application', 'business-trip-application'].includes(flow.prefix) ? ', {startUserSelectAssignees, skipSelfApprovalGuard}' : ', startUserSelectAssignees'})；第一个参数是草稿对象，第二个参数不是草稿字段。`)
  WORKFLOW_METHOD_CONTRACTS[`${facade}.submit`] = raw
  if (flow.detail) {
    const finder = clone(contracts[`${flow.prefix}-my-instances`]!)
    finder.purpose = `按业务 ID 在本人流程中定位${flow.title}实例。`
    finder.inputs = { businessKey: { meaning: '业务单据 ID；按字符串比较', source: `${flow.prefix}-submit 返回值`, format: 'number | string' } }
    finder.output = { shape: '一个流程实例行对象', fields: instances.filter(x => x.path.startsWith('list[].')).map(x => ({ ...x, path: x.path.slice(7) })), empty: '默认最多扫描 5 页，每页 50；未找到则抛错，不返回 null。' }
    finder.consume = [`直接调用 sdk.${facade}.findInstanceByBusinessKey(businessKey)。业务 ID 与 ${flow.key} 联合匹配；缺少 processDefinitionKey 的行实现会放行，需额外核对名称/内容，不能视为无歧义。`, '本方法扫描受限，不是全量不存在证明；找不到可以用 my-instances 带业务条件继续查。']
    finder.steps = [step('optional', `${flow.prefix}-cancel`, '用户要撤销且实例 status=1', { id: 'processInstanceId' }, '补非空取消原因。')]
    WORKFLOW_METHOD_CONTRACTS[`${facade}.findInstanceByBusinessKey`] = finder
  }
  if (derived[flow.prefix] && flow.prefix !== 'leave-application') {
    const d = clone(contracts[`${flow.prefix}-prepare`]!)
    d.purpose = `${flow.title}：取得申请人、组织、日期/时长等只读联动值。`
    d.output = { shape: '只读派生字段对象', fields: derived[flow.prefix]!, empty: '用户/部门/岗位或余额缺失时拒绝，不编造派生字段。' }
    d.effect = 'read'
    d.consume = [`直接调用 sdk.${facade}.resolveDerivedFields(draft)；先校验完整草稿，再读当前用户${flow.prefix === 'rest-leave-application' ? '与剩余加班余额' : ''}。`, '用于展示只读字段；正式提交仍由 SDK 自行重算，不支持调用方替换申请人。']
    d.completion = '显示申请身份及计算结果后完成预览。'
    d.steps = [step('optional', `${flow.prefix}-prepare`, '需要进一步准备提交', {}, '仍传原始草稿，不能把派生字段当可编辑输入。')]
    WORKFLOW_METHOD_CONTRACTS[`${facade}.resolveDerivedFields`] = d
    const self = clone(contracts[`${flow.prefix}-approval-chain`]!)
    self.purpose = '在预览的 USER_TASK 候选人中查找发起人本人，用于识别自动通过风险。'
    self.effect = 'local'
    self.inputs = { preview: { meaning: '审批链预览对象', source: `${flow.prefix}-approval-chain 返回对象` }, selfUserId: { meaning: '当前发起人用户 ID', source: `${flow.prefix}-current-user 的 numericId`, format: 'number | string' } }
    self.output = { shape: 'SelfApprovalHit[]', fields: [f('[].nodeId', 'string', '命中节点 ID'), f('[].nodeName', 'string', '命中节点名称'), f('[].candidateStrategy', 'number', '候选策略', { optional: true, nullable: true }), f('[].candidateStrategyName', 'string', '策略显示名称', { optional: true, nullable: true }), f('[].user.id', 'number', '命中的发起人 ID'), f('[].user.nickname', 'string', '命中用户姓名', { optional: true })], empty: '[] 仅表示这份预览未命中本人，不证明预览完整或未来流程不变。' }
    self.consume = [`sdk.${facade}.findSelfInApprovalChain(preview, selfUserId) 是纯函数，不发请求；命中后停止自动提交并解释发起人自审会自动通过的事实。`]
    self.steps = []
    self.completion = '报告每个命中节点；结果为空时继续按完整预览与提交规则判断。'
    WORKFLOW_METHOD_CONTRACTS[`${facade}.findSelfInApprovalChain`] = self
  }
}
const resolveVehicle = clone(WORKFLOW_METHOD_CONTRACTS['vehicleApplication.findInstanceByBusinessKey']!)
resolveVehicle.purpose = '按用车业务 ID 解析流程实例 ID，优先详情，列表作后备。'
resolveVehicle.consume = ['sdk.vehicleApplication.resolveProcessInstanceId(businessKey)：先 detail.processInstanceId；没有时扫描本人流程。']
resolveVehicle.output = { shape: 'string', fields: [f('$', 'string', '流程实例 ID → cancel.processInstanceId')], empty: '详情没有实例 ID 且扫描未找到时抛错。' }
resolveVehicle.steps = [step('optional', 'vehicle-application-cancel', '用户希望取消运行中流程', { '$': 'processInstanceId' }, '补 reason，并回查状态。')]
WORKFLOW_METHOD_CONTRACTS['vehicleApplication.resolveProcessInstanceId'] = resolveVehicle
const payee = clone(contracts['travel-expense-travelers']!)
payee.purpose = '按费用组织或法人范围搜索外部收款客商；返回银行账户用于填写收款信息。'
payee.inputs = { keyword: { meaning: '名称或编码关键词，必填非空', source: '用户提供的收款方名称/编码' }, orgId: { meaning: '费用组织 ID，与 companyId 至少一个', source: 'travel-expense-org-options 的 id' }, companyId: { meaning: '法人公司 ID，与 orgId 至少一个；不能用组织 ID 替代', source: '已核对的法人资料；当前 SDK 无独立法人候选' }, limit: { meaning: '本地筛选后最多返回条数', source: '调用方分页/展示需要', default: '20', format: 'number' } }
payee.output = { shape: '外部客商候选[]（SDK 按关键词筛选并截断，不是分页对象）', fields: [
  f('[].id', 'number', '客商 ID → payeeInfo.payeeId'), f('[].sourceType', 'string', 'SUPPLIER/FINANCE_PARTY/CUSTOMER → payeeInfo.payeeSourceType'), f('[].companyId', 'number', '候选所属法人公司 ID'), f('[].companyName', 'string', '候选所属公司名称'), f('[].code', 'string', '客商编码 → payeeInfo.payeeCode'), f('[].name', 'string', '收款方名称，按个人/公司分支填 payeeName/receivingCompanyName'), f('[].status', 'number', '来源客商状态码；不同 sourceType 的状态体系不在本接口统一，不能用它判支付许可'), f('[].originalPartyId', 'number', '映射前原客商 ID，提交使用候选 id 而不是它'),
  f('[].bankAccounts', 'array', '可选银行账户；用户确认账号后填写收款字段'), ...prefixed('[].bankAccounts[].', [f('id', 'number', '账户记录 ID'), f('bankId', 'number', '银行字典 ID'), f('bankCode', 'string', '银行字典值 → receivingBankDictValue'), f('bankName', 'string', '所属银行 → receivingBankName'), f('bankBranchName', 'string', '开户支行名称'), f('bankAccount', 'string', '银行账号 → receivingAccount；保留字符串'), f('bankDescription', 'string', '供应商账户银行信息说明')]),
], empty: '无匹配返回 []，不把姓名当唯一 ID，也不自动选择第一银行账户。' }
payee.consume = ['直接调用 sdk.travelExpense.payeeOptions({keyword,orgId?,companyId?,limit?})；服务端取范围后 SDK 本地过滤 name/code。', '外部客商候选不能用于内部员工/法人选项。按 payeeType/companySubType/isInternalStaff 选择分支，保留 sourceType 和 code。']
payee.steps = [step('optional', 'travel-expense-prepare', '收款方已选定并核对账号', {}, '将 id/code/sourceType 映射到 payeeInfo.payeeId/payeeCode/payeeSourceType；将选定银行的 bankCode/bankName/bankAccount 映射到 receivingBankDictValue/receivingBankName/receivingAccount。')]
payee.completion = '用户已确认收款方及银行账号，保存对应字段供费用草稿使用。'
payee.evidence = [{ source: 'src/capabilities/travel-expense-application.ts payeeOptions', kind: 'implementation', note: '最终值为筛选截断的数组' }, { source: '后端 test/test dcb3f360194 FinancePartyOptionRespVO/FinancePartyBankAccountRespVO', kind: 'reference', note: '逐字段返回类型；状态枚举由 FinancePartyServiceImpl 补充核对' }]
payee.boundaries.push('收款字段非空分支缺少真实提交回读证据；枚举与字段按后端固定版本核对。')
WORKFLOW_METHOD_CONTRACTS['travelExpense.payeeOptions'] = payee
const travelProfile = clone(contracts['business-trip-application-current-user']!)
travelProfile.purpose = '取得差旅费用发起人身份供自审预览比较。'
travelProfile.inputs = {}
travelProfile.output = { shape: '{id,realName,organizationId}', fields: currentUser.filter(x => ['id', 'realName', 'organizationId'].includes(x.path)), empty: '缺失字段被归一为空串；不能据此伪造用户 ID 或宣称已完成自审检查。' }
travelProfile.consume = ['sdk.travelExpense.profile()；返回仅 id、realName、organizationId，不能期待 numericId、岗位或其他资料。']
travelProfile.steps = []
travelProfile.completion = '识别用于比对审批链的当前用户。'
WORKFLOW_METHOD_CONTRACTS['travelExpense.profile'] = travelProfile
const amount = clone(travel)
amount.purpose = '按差旅费用明细本地计算含进项税的总金额。'
amount.effect = 'local'
amount.inputs = { entries: { meaning: '差旅明细数组；使用各行交通/餐食/住宿/其他/进项税金额', source: '用户费用草稿 travelEntryList' } }
amount.output = { shape: 'number', fields: [f('$', 'number', '五项金额逐行求和，元，含进项税')], empty: '[] 返回 0；正式提交要求有效明细和正金额，金额计算不等于草稿合法。' }
amount.consume = ['sdk.travelExpense.amount(entries) 不发请求，展示总额；不要再加一次进项税。']
amount.steps = []
amount.gaps = []
amount.completion = '返回本地计算的费用总额。'
WORKFLOW_METHOD_CONTRACTS['travelExpense.amount'] = amount
const travelPreview = clone(travel)
travelPreview.purpose = '按已构造流程变量预览差旅费审批节点；该方法不做自审拦截。'
travelPreview.inputs = { variables: { meaning: '含 targetOrgId 数字、“费用申请类型”字符串；项目费用还须含“课题负责人”员工 ID 字符串的流程变量对象', source: 'travel-expense-prepare.variables；必须保留项目费用的课题负责人，不得用 userId 替换' } }
travelPreview.output = { shape: '审批节点[]', fields: prefixed('[].', previewNodes), empty: '后端没有 nodes 时归一为 []；不等于流程没有审批人。' }
travelPreview.effect = 'read'
travelPreview.consume = ['sdk.travelExpense.previewApprovalChain(variables)；返回节点数组，不返回 prepare 的金额/完整性标记/审批人汇总。', '完整准备请使用 prepare，那里才有 self guard 与 previewComplete。']
travelPreview.steps = [step('optional', 'travel-expense-prepare', '需要可核对的业务准备结果', {}, '使用完整草稿，不能把 variables 当草稿。')]
travelPreview.completion = '交付变量对应的节点预览并注明项目分支不完整。'
WORKFLOW_METHOD_CONTRACTS['travelExpense.previewApprovalChain'] = travelPreview
const myTasks = clone(contracts['task-action-workflow-path']!)
myTasks.purpose = '获取某流程中当前用户真正可办理的任务。'
myTasks.inputs.userId = { meaning: '当前办理人用户 ID', source: '可信当前会话身份，或 taskAction.currentUserId() 非空结果；不是员工 ID' }
myTasks.consume = ['sdk.taskAction.myRunningTasks(processInstanceId,userId)；SDK 已展开子任务并筛选 status=1/6、assigneeUser.id 等于 userId。']
myTasks.output.empty = '[] 表示此流程中当前没有该用户可办理任务。'
WORKFLOW_METHOD_CONTRACTS['taskAction.myRunningTasks'] = myTasks
const currentUserId = clone(myTasks)
currentUserId.purpose = '从本人发起流程的 startUser.id 推断当前用户 ID。'
currentUserId.inputs = {}
currentUserId.output = { shape: 'number | undefined', fields: [f('$', 'number | undefined', '本人发起流程中的 startUser.id；从未发起流程或扫描未取到时为 undefined')], empty: 'undefined 不是用户 0，不能用于过滤任务。' }
currentUserId.consume = ['sdk.taskAction.currentUserId()；默认扫描最多 5 页×50。结果是从本人流程推断，优先使用已有可信会话用户 ID。']
currentUserId.steps = []
currentUserId.completion = '得到用户 ID 或明确无法推断；无 ID 时停止自动办理。'
WORKFLOW_METHOD_CONTRACTS['taskAction.currentUserId'] = currentUserId
const taskSearch = clone(contracts['general-approval-user-search']!)
taskSearch.purpose = '搜索待办转办、委派及抄送用户候选。'
taskSearch.consume.unshift('sdk.taskAction.searchUsers({keyword,deptId?,pageNo?,pageSize?})；结果与 general-approval-user-search 同形。')
taskSearch.steps = [step('optional', 'task-action-transfer', '用户明确要把任务转交该人', { 'list[].id': 'assigneeUserId' }, '另给 taskId/reason/requestId。'), step('optional', 'task-action-delegate', '用户明确让该人先处理再回来', { 'list[].id': 'delegateUserId' }, '另给 taskId/reason/requestId。')]
WORKFLOW_METHOD_CONTRACTS['taskAction.searchUsers'] = taskSearch
for (const [suffix, method] of Object.entries({ approve: 'approve', reject: 'reject', transfer: 'transfer', delegate: 'delegate', return: 'returnTask', 'batch-approve': 'batchApprove', 'batch-reject': 'batchReject' })) {
  const raw = clone(contracts[`task-action-${suffix}`]!)
  delete raw.inputs.requestId
  raw.consume.unshift(`sdk.taskAction.${method}(params) 为原始写方法，无 requestId 参数。`)
  raw.idempotency = '此原始写方法没有防重；AI 优先使用相应能力 invoke 或 *Idempotent 方法。'
  WORKFLOW_METHOD_CONTRACTS[`taskAction.${method}`] = raw
}

// payeeOptions is also present in the current source registry; older dist builds omitted it.
contracts['travel-expense-payee-options'] = clone(payee)

// Fill execution-supported filters that are absent from the older capability parameter lists.
contracts['meeting-room-list']!.inputs.order = { meaning: '排序方向，SDK 原样传给列表接口', source: '调用方已有已核对排序要求；默认留空', type: 'string', required: false, default: '' }
contracts['meeting-room-list']!.inputs.orderField = { meaning: '排序字段，SDK 原样传给列表接口', source: '已核对的页面排序字段；没有依据时留空', type: 'string', required: false, default: '' }
contracts['meeting-user-search']!.inputs.postName = { meaning: '按岗位名称限定人员候选', source: '用户提供岗位关键词', type: 'string', required: false }
contracts['meeting-room-usage']!.inputs.date = { meaning: '查询指定日期的会议室占用', source: '用户希望预定的日期', type: 'string', required: false, format: 'YYYY-MM-DD', omitted: '不发送 date，使用后端默认日期；明确业务日期时应显式填写' }
const definitions = [...metadata.flatMap(flow => flow.defs), ...meetingRoomCapabilities, ...taskActionCapabilities]
for (const [id, c] of Object.entries(contracts)) {
  const definition = definitions.find(d => d.id === id)
  for (const p of definition?.params ?? []) {
    const input = c.inputs[p.name]
    if (!input) continue
    input.required ??= p.required
    input.type ??= draftTypes[p.name] ?? ({ number: 'number', boolean: 'boolean', date: 'string', text: 'string', search: 'string | number', tree: 'string | number', enum: p.options?.some(o => typeof o.value === 'number') ? 'number' : 'string', array: 'unknown[]' }[p.kind])
  }
  if (c.inputs.requestId) { c.inputs.requestId.required = true; c.inputs.requestId.type = 'string' }
  for (const key of ['startUserSelectAssignees', 'payeeInfo']) if (c.inputs[key]) c.inputs[key]!.type = 'object'
  for (const key of ['copyUserIds', 'taskIds', 'organizationIds', 'selectedStaffIds', 'travelerIds', 'attachments', 'leaveDateItems', 'travelEntryList']) if (c.inputs[key]) c.inputs[key]!.type = 'array'
  if (c.inputs.pageNo) { c.inputs.pageNo.default = '1'; c.inputs.pageNo.source = '调用方逐页查询，首次用 1' }
  if (c.inputs.pageSize) c.inputs.pageSize.default = id === 'meeting-room-list' ? '10（页面默认，SDK list 不主动补 pageSize）' : '20'
  if (c.inputs.id && !id.startsWith('task-action')) c.inputs.id.source = id === 'meeting-application-cancel' ? 'meeting-application-submit 的数字返回值' : `${id.replace(/-detail$/, '-submit')} 的业务 ID 返回值`
  if (c.inputs.businessKey) c.inputs.businessKey.source = `${id.replace(/-cancel$/, '-submit')} 的数字返回值`
  if (c.inputs.processInstanceId) c.inputs.processInstanceId.source = id.startsWith('task-action') ? '待办行 processInstance.id，或本人流程 list[].id；不是 taskId/businessKey' : `${id.replace(/-cancel$/, '-my-instances')} 的 list[].id；用业务 key 与流程类型联合匹配`
  if (c.inputs.taskId) c.inputs.taskId.source = 'backlog-task-examine-list 行 id，或 task-action-workflow-path 本人可办理行 id'
  if (c.inputs.taskIds) c.inputs.taskIds.source = '本人待办中已选中且 category 为 null/8 的行 id 数组'
  if (id.endsWith('-my-instances')) c.inputs.category = { meaning: '流程分类筛选值；不同于 processType 审核/审批', source: '已知流程/待办行的 category；无筛选需求省略', type: 'string', required: false, default: '' }
}
for (const name of ['authorizedOrgId', 'deptId']) {
  for (const c of Object.values(contracts)) if (c.inputs[name]) {
    c.inputs[name]!.lookup = { capabilityId: 'base-dept-search', args: { keyword: '<组织名称>' }, valueField: 'list[].id', labelField: 'list[].name' }
    c.inputs[name]!.source = 'base-dept-search 按关键词得到的组织节点 id；不能凭组织名猜 ID'
  }
}
for (const id of ['rest-leave-application-prepare']) {
  const c = contracts[id]!
  c.output.fields.push(f('payload.id', 'null', '新建单据固定 null', { nullable: true }), f('payload.leaveDateItems[].id', 'null', '新建调休明细固定 null', { nullable: true }), f('payload.attachments[].id', 'number', '新附件固定 0，占位不复用已有附件记录'), f('payload.attachments[].size', 'number', '附件字节数，缺省 0'), f('payload.attachments[].pages', 'number', '附件页数，缺省 0'))
}
contracts['rest-leave-application-detail']!.output.fields.push(f('startDate', 'string', '明细最早调休日期 YYYY-MM-DD', { optional: true }), f('endDate', 'string', '明细最晚调休日期 YYYY-MM-DD', { optional: true }), ...prefixed('leaveDateItems[].', [f('leaveDate', 'string', '调休日期，后端按日期升序返回'), f('leaveHours', 'number', '该日调休小时，最多 1 位小数')]))
for (const prefix of ['overtime-application', 'rest-leave-application', 'business-trip-application']) {
  const c = contracts[`${prefix}-submit`]!
  c.consume.push('提交默认预览审批链并拒绝发起人命中 USER_TASK 候选审批人；skipSelfApprovalGuard=true 会绕过该守卫，不应用它掩盖真实自审命中。')
  c.inputs.skipSelfApprovalGuard!.default = 'false'
  c.inputs.skipSelfApprovalGuard!.type = 'boolean'
}

// Supplement passthrough detail fields from the pinned backend response VOs.
const backendDetailFields: Record<string, AiField[]> = {
  "meeting-room-list": [
    {
      "path": "id",
      "type": "number",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true,
      "source": "MeetingRoomRespVO@dcb3f360194"
    },
    {
      "path": "name",
      "type": "string",
      "meaning": "会议室名称",
      "optional": true,
      "nullable": true,
      "source": "MeetingRoomRespVO@dcb3f360194"
    },
    {
      "path": "authorizedOrgId",
      "type": "number",
      "meaning": "授权组织ID",
      "optional": true,
      "nullable": true,
      "source": "MeetingRoomRespVO@dcb3f360194"
    },
    {
      "path": "authorizedOrgName",
      "type": "string",
      "meaning": "授权组织名称",
      "optional": true,
      "nullable": true,
      "source": "MeetingRoomRespVO@dcb3f360194"
    },
    {
      "path": "status",
      "type": "number",
      "meaning": "状态：0=禁用，1=启用",
      "optional": true,
      "nullable": true,
      "source": "MeetingRoomRespVO@dcb3f360194"
    },
    {
      "path": "statusName",
      "type": "string",
      "meaning": "状态名称",
      "optional": true,
      "nullable": true,
      "source": "MeetingRoomRespVO@dcb3f360194"
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "修改时间",
      "optional": true,
      "nullable": true,
      "source": "MeetingRoomRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "updater",
      "type": "number",
      "meaning": "修改人ID",
      "optional": true,
      "nullable": true,
      "source": "MeetingRoomRespVO@dcb3f360194"
    },
    {
      "path": "updaterName",
      "type": "string",
      "meaning": "修改人姓名",
      "optional": true,
      "nullable": true,
      "source": "MeetingRoomRespVO@dcb3f360194"
    }
  ],
  "general-approval-detail": [
    {
      "path": "id",
      "type": "number",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true,
      "source": "GeneralApprovalRespVO@dcb3f360194"
    },
    {
      "path": "applicationItem",
      "type": "string",
      "meaning": "申请事项",
      "optional": true,
      "nullable": true,
      "source": "GeneralApprovalRespVO@dcb3f360194"
    },
    {
      "path": "applicationContent",
      "type": "string",
      "meaning": "申请内容",
      "optional": true,
      "nullable": true,
      "source": "GeneralApprovalRespVO@dcb3f360194"
    },
    {
      "path": "attachments",
      "type": "array",
      "meaning": "附件列表",
      "optional": true,
      "nullable": true,
      "source": "GeneralApprovalRespVO@dcb3f360194"
    },
    {
      "path": "status",
      "type": "number",
      "meaning": "状态：0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消",
      "optional": true,
      "nullable": true,
      "source": "GeneralApprovalRespVO@dcb3f360194"
    },
    {
      "path": "statusName",
      "type": "string",
      "meaning": "状态名称",
      "optional": true,
      "nullable": true,
      "source": "GeneralApprovalRespVO@dcb3f360194"
    }
  ],
  "leave-application-detail": [
    {
      "path": "id",
      "type": "number",
      "meaning": "主键",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "userId",
      "type": "number",
      "meaning": "用户id",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "type",
      "type": "number",
      "meaning": "请假类型",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "typeName",
      "type": "string",
      "meaning": "请假类型名称",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "reason",
      "type": "string",
      "meaning": "事由",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "attachments",
      "type": "array",
      "meaning": "附件",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "leavetimeVOs",
      "type": "array",
      "meaning": "请假时间段",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "startDate",
      "type": "string",
      "meaning": "开始时间",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194",
      "format": "YYYY-MM-DD"
    },
    {
      "path": "startType",
      "type": "number",
      "meaning": "开始请假类型",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "endDate",
      "type": "string",
      "meaning": "结束时间",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194",
      "format": "YYYY-MM-DD"
    },
    {
      "path": "endType",
      "type": "number",
      "meaning": "开始请假类型",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "userName",
      "type": "string",
      "meaning": "用户姓名",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "staffCode",
      "type": "string",
      "meaning": "用户姓名",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "fullPath",
      "type": "string",
      "meaning": "组织路径",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    },
    {
      "path": "startUserSelectAssignees",
      "type": "object",
      "meaning": "发起人自选审批人 Map",
      "optional": true,
      "nullable": true,
      "source": "AttendanceUserRelSaveReqVO@dcb3f360194"
    }
  ],
  "vehicle-application-detail": [
    {
      "path": "id",
      "type": "number",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "staffId",
      "type": "number",
      "meaning": "申请人ID（员工ID）",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "staffName",
      "type": "string",
      "meaning": "申请人姓名",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "reason",
      "type": "string",
      "meaning": "用车事由",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "startTime",
      "type": "string",
      "meaning": "开始时间",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "endTime",
      "type": "string",
      "meaning": "结束时间",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "destination",
      "type": "string",
      "meaning": "用车目的地",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "remark",
      "type": "string",
      "meaning": "备注",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "status",
      "type": "number",
      "meaning": "状态",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "statusName",
      "type": "string",
      "meaning": "状态名称",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "processInstanceId",
      "type": "string",
      "meaning": "BPM流程实例ID",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "creator",
      "type": "number",
      "meaning": "创建人",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "创建时间",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "updater",
      "type": "number",
      "meaning": "更新人",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194"
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "更新时间",
      "optional": true,
      "nullable": true,
      "source": "VehicleUsageApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    }
  ],
  "overtime-application-detail": [
    {
      "path": "id",
      "type": "number",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applicantId",
      "type": "number",
      "meaning": "申请人ID",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applicantName",
      "type": "string",
      "meaning": "申请人姓名",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applyDepartmentId",
      "type": "number",
      "meaning": "申请部门ID",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applyDepartmentName",
      "type": "string",
      "meaning": "申请部门名称",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applyDate",
      "type": "string",
      "meaning": "申请时间",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD"
    },
    {
      "path": "reason",
      "type": "string",
      "meaning": "加班事由",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    },
    {
      "path": "overtimeType",
      "type": "number",
      "meaning": "加班类型：0=工作日加班，1=法定节假日加班，2=休息日加班",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    },
    {
      "path": "subsidyType",
      "type": "number",
      "meaning": "补贴类型：0=转调休，1=转补贴，2=后期自行统计",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    },
    {
      "path": "startTime",
      "type": "string",
      "meaning": "开始加班时间",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "endTime",
      "type": "string",
      "meaning": "结束加班时间",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "breakHours",
      "type": "number",
      "meaning": "中途休息时长（小时）",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "overtimeHours",
      "type": "number",
      "meaning": "加班时长（小时）",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "status",
      "type": "number",
      "meaning": "状态：0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    },
    {
      "path": "statusName",
      "type": "string",
      "meaning": "状态名称",
      "optional": true,
      "nullable": true,
      "source": "OvertimeApplicationRespVO@dcb3f360194"
    }
  ],
  "rest-leave-application-detail": [
    {
      "path": "id",
      "type": "number",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applicantName",
      "type": "string",
      "meaning": "姓名",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "staffCode",
      "type": "string",
      "meaning": "工号",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "departmentId",
      "type": "number",
      "meaning": "部门ID",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "departmentName",
      "type": "string",
      "meaning": "部门名称",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "leaveType",
      "type": "number",
      "meaning": "请假类型：0=调休",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "remainingOvertimeHours",
      "type": "number",
      "meaning": "剩余加班时长（小时）",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "reason",
      "type": "string",
      "meaning": "请假事由",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "startDate",
      "type": "string",
      "meaning": "开始日期",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD"
    },
    {
      "path": "endDate",
      "type": "string",
      "meaning": "结束日期",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD"
    },
    {
      "path": "leaveHours",
      "type": "number",
      "meaning": "调休时长（小时）",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "leaveDateItems",
      "type": "array",
      "meaning": "请假时间明细",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "attachments",
      "type": "array",
      "meaning": "附件列表",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "status",
      "type": "number",
      "meaning": "状态：0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    },
    {
      "path": "statusName",
      "type": "string",
      "meaning": "状态名称",
      "optional": true,
      "nullable": true,
      "source": "RestLeaveApplicationRespVO@dcb3f360194"
    }
  ],
  "business-trip-application-detail": [
    {
      "path": "id",
      "type": "number",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applicantId",
      "type": "number",
      "meaning": "申请人ID",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applicantName",
      "type": "string",
      "meaning": "申请人姓名",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applyDate",
      "type": "string",
      "meaning": "申请时间",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD"
    },
    {
      "path": "applyDepartmentId",
      "type": "number",
      "meaning": "申请部门ID",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applyDepartmentName",
      "type": "string",
      "meaning": "申请部门名称",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applyPostId",
      "type": "number",
      "meaning": "申请岗位ID",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "applyPostName",
      "type": "string",
      "meaning": "申请岗位名称",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "tripType",
      "type": "number",
      "meaning": "类型：0=出差，1=外出，2=海外出差",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "companions",
      "type": "string",
      "meaning": "同行人",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "startTime",
      "type": "string",
      "meaning": "开始时间",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "endTime",
      "type": "string",
      "meaning": "结束时间",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "origin",
      "type": "string",
      "meaning": "始发地",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "destination",
      "type": "string",
      "meaning": "目的地",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "reason",
      "type": "string",
      "meaning": "事由",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "status",
      "type": "number",
      "meaning": "状态：0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    },
    {
      "path": "statusName",
      "type": "string",
      "meaning": "状态名称",
      "optional": true,
      "nullable": true,
      "source": "BusinessTripApplicationRespVO@dcb3f360194"
    }
  ],
  "travel-expense-detail": [
    {
      "path": "id",
      "type": "number",
      "meaning": "主键",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "detail",
      "type": "number",
      "meaning": "明细",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "orgId",
      "type": "number",
      "meaning": "组织 id",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "orgName",
      "type": "string",
      "meaning": "组织名称",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "corporationName",
      "type": "string",
      "meaning": "公司名称",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "paymentType",
      "type": "number",
      "meaning": "支付类型：预算内；预算外",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "traveler",
      "type": "number",
      "meaning": "出差人",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "travelerIds",
      "type": "string",
      "meaning": "出差人ID集合，逗号分隔",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "staffCode",
      "type": "number",
      "meaning": "工号",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "travelerName",
      "type": "string",
      "meaning": "出差人姓名",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "postName",
      "type": "string",
      "meaning": "岗位名称",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "reasons",
      "type": "string",
      "meaning": "出差事由",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "amount",
      "type": "number",
      "meaning": "金额",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "receiver",
      "type": "string",
      "meaning": "领款人",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "receiverName",
      "type": "string",
      "meaning": "领款人姓名",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "receiverStaffCode",
      "type": "number",
      "meaning": "领款人工号",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "paymentDate",
      "type": "string",
      "meaning": "预计付款日期",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194",
      "format": "YYYY-MM-DD"
    },
    {
      "path": "remark",
      "type": "string",
      "meaning": "其他说明",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "attachment",
      "type": "string",
      "meaning": "附件id",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "attachmentNumber",
      "type": "number",
      "meaning": "附件数量",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "attachmentPage",
      "type": "number",
      "meaning": "附件页数",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "processInstanceId",
      "type": "string",
      "meaning": "流程实例的编号",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "displayStatus",
      "type": "number",
      "meaning": "财务复核展示状态（字典值，按本能力字典入口翻译）",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "displayStatusName",
      "type": "string",
      "meaning": "财务复核展示状态名称",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "录入时间",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "travelEntryList",
      "type": "array",
      "meaning": "差旅行程集合",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "attachmentList",
      "type": "array",
      "meaning": "附件信息",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "payeeId",
      "type": "number",
      "meaning": "收款人",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "payeeSourceType",
      "type": "string",
      "meaning": "收款方主数据来源：SUPPLIER-采购供应商，FINANCE_PARTY-财务客商档案",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "payeeCode",
      "type": "string",
      "meaning": "收款方字符主键；CUSTOMER 来源使用客户编码",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "payeeName",
      "type": "string",
      "meaning": "收款人姓名",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "payeeType",
      "type": "number",
      "meaning": "收款方类型：1-个人，2-公司",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "companySubType",
      "type": "number",
      "meaning": "公司子类型：1-内部分公司，2-外部公司",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "isInternalStaff",
      "type": "boolean",
      "meaning": "是否内部员工",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "receivingCompanyId",
      "type": "number",
      "meaning": "收款公司ID",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "receivingCompanyName",
      "type": "string",
      "meaning": "收款公司名称",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "receivingCorporationId",
      "type": "number",
      "meaning": "收款方法人库ID，内部分公司新单使用",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "receivingCorporationName",
      "type": "string",
      "meaning": "收款方法人名称快照，内部分公司新单使用",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "payeeStaffId",
      "type": "number",
      "meaning": "收款人员工ID",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "payeeStaffNo",
      "type": "string",
      "meaning": "收款人工号",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "receivingBankName",
      "type": "string",
      "meaning": "收款银行",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "receivingAccount",
      "type": "string",
      "meaning": "收款账号",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "feeItem",
      "type": "number",
      "meaning": "费用项目（字典值，按本能力字典入口翻译）",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "feePurpose",
      "type": "string",
      "meaning": "费用用途",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "budgetNo",
      "type": "string",
      "meaning": "预算单号",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "budgetAmount",
      "type": "number",
      "meaning": "预算金额",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "availableAmount",
      "type": "number",
      "meaning": "可用金额",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "budgetTypeName",
      "type": "string",
      "meaning": "预算类型名称",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "relatedRevenueSubjectId",
      "type": "number",
      "meaning": "关联收入科目ID（来自 finance_ledger_accounts，用于生成凭证时写入产品组辅助核算）",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "relatedRevenueSubjectName",
      "type": "string",
      "meaning": "关联收入科目名称（冗余，与 relatedRevenueSubjectId 成套传递）",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "projectExpense",
      "type": "boolean",
      "meaning": "是否项目费用申请",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "financeProjectId",
      "type": "number",
      "meaning": "项目ID",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "financeProjectName",
      "type": "string",
      "meaning": "项目名称快照",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "financeProjectCode",
      "type": "string",
      "meaning": "项目编号快照",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "financeProjectType",
      "type": "number",
      "meaning": "项目类型（字典值，按本能力字典入口翻译）",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "financeProjectAttribute",
      "type": "number",
      "meaning": "项目属性（字典值，按本能力字典入口翻译）",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "financeProjectCompanyId",
      "type": "number",
      "meaning": "项目所属公司ID",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    },
    {
      "path": "financeProjectCompanyName",
      "type": "string",
      "meaning": "项目所属公司名称",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelRespVO@dcb3f360194"
    }
  ],
  "travel-expense-detail:travelEntryList[].": [
    {
      "path": "id",
      "type": "number",
      "meaning": "主键",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "travelId",
      "type": "number",
      "meaning": "差旅费申请表 id",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "startDate",
      "type": "string",
      "meaning": "起始日期",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "format": "YYYY-MM-DD"
    },
    {
      "path": "endDate",
      "type": "string",
      "meaning": "终止日期",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "format": "YYYY-MM-DD"
    },
    {
      "path": "startProvince",
      "type": "string",
      "meaning": "出发省",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "startCity",
      "type": "string",
      "meaning": "出发市",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "startDistrict",
      "type": "string",
      "meaning": "出发区",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "startAddress",
      "type": "string",
      "meaning": "出发地址",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "endProvince",
      "type": "string",
      "meaning": "目的省",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "endCity",
      "type": "string",
      "meaning": "目的市",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "endDistrict",
      "type": "string",
      "meaning": "目的区",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "endAddress",
      "type": "string",
      "meaning": "目的地址",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "tripMode",
      "type": "number",
      "meaning": "出行方式",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "trafficAmount",
      "type": "number",
      "meaning": "交通费用",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "foodAmount",
      "type": "number",
      "meaning": "餐食补助",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "housingAmount",
      "type": "number",
      "meaning": "住宿补助",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "otherAmount",
      "type": "number",
      "meaning": "其他补助",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "inputTaxAmount",
      "type": "number",
      "meaning": "增值税进项税",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "travelTotalAmount",
      "type": "number",
      "meaning": "差旅费合计",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "budgetDetailId",
      "type": "number",
      "meaning": "预算明细ID",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "budgetDetailNo",
      "type": "string",
      "meaning": "预算明细单号",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "budgetAvailableAmount",
      "type": "number",
      "meaning": "预算可用金额快照",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "fundSource",
      "type": "number",
      "meaning": "项目资金来源（字典值，按本能力字典入口翻译）",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "totalAmount",
      "type": "number",
      "meaning": "合计金额",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "unit": "元"
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "录入时间",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194",
      "format": "YYYY-MM-DD HH:mm:ss"
    },
    {
      "path": "fullStartAddress",
      "type": "string",
      "meaning": "完整出发地址",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    },
    {
      "path": "fullEndAddress",
      "type": "string",
      "meaning": "完整目的地址",
      "optional": true,
      "nullable": true,
      "source": "BpmSpendingApplyTravelEntryRespVO@dcb3f360194"
    }
  ]
}
for (const [target, fields] of Object.entries(backendDetailFields)) {
  const [id, prefix = ''] = target.split(':')
  const c = contracts[id!]!
  const actualPrefix = id === 'meeting-room-list' ? 'list[].' : prefix
  for (const field of fields) if (!c.output.fields.some(existing => existing.path === `${actualPrefix}${field.path}`)) c.output.fields.push({ ...field, path: `${actualPrefix}${field.path}` })
  c.evidence.push({ source: fields[0]?.source ?? 'backend@dcb3f360194', kind: 'reference', note: '补齐后端响应 VO 原样透传的字段；可选/null 如实保留，不把源码字段存在声称每次响应有值' })
}
contracts['meeting-room-list']!.output.fields.find(field => field.path === 'list[].status')!.values = { '0': '禁用', '1': '启用' }
contracts['meeting-room-list']!.consume.push('status=0 的禁用会议室不作为可预定候选；启用也须另查指定日期占用。')
for (const c of [contracts['travel-expense-payee-options']!, WORKFLOW_METHOD_CONTRACTS['travelExpense.payeeOptions']!]) {
  const status = c.output.fields.find(field => field.path === '[].status')!
  status.meaning = '收款候选启用状态；供应商/客户转换统一设为 0，财务客商筛选启用记录'
  status.values = { '0': '启用', '1': '停用' }
  c.consume.push('SDK 未把 keyword 发给后端，后端候选最多 500 条后再本地过滤；空结果不证明范围内全体客商都无匹配。')
  c.evidence.push({ source: 'FinancePartyServiceImpl@getPayeeOptions/toSupplierOptionVOList/toCustomerOptionVOList@dcb3f360194', kind: 'reference', note: 'STATUS_ENABLED=0、STATUS_DISABLED=1；跨来源归一与最多500候选核对' })
  c.boundaries.push('收款字段非空分支缺少真实提交回读证据；字段与状态依据固定后端源码核对。')
}
contracts['travel-expense-detail']!.output.fields.find(field => field.path === 'travelerIds')!.meaning = '出差人 ID 逗号分隔字符串；重新发起时拆分、校验并转数字数组，不是直接复用字符串'
contracts['travel-expense-detail']!.steps.push({ role: 'optional', capabilityId: 'base-dict-get', when: '需要翻译财务复核 displayStatus', mapping: { dictType: 'literal:"finance_expense_display_status"' }, instruction: '用 displayStatus 转字符串匹配字典 value，展示 label；不能套流程状态1/2/3/4。' })
room.steps.push(step('optional', 'meeting-application-prepare', '已查明占用无冲突并确认会议室、起止时间、会议名称和人数', { 'list[].id': 'meetingRoomId' }, '这里仅传已选会议室 ID，完整草稿仍由用户业务要求补齐。'))
contracts['meeting-room-usage']!.steps[0]!.role = 'required'
contracts['meeting-room-usage']!.steps.push(step('optional', 'meeting-application-definition', '需要确认当前环境部署的会议审批定义', {}, '查询固定 key=meeting_application；定义不能替代准备接口。'))
for (const flow of metadata) {
  const prepare = contracts[`${flow.prefix}-prepare`]!
  const toSubmit = prepare.steps.find(step => step.capabilityId === `${flow.prefix}-submit`)!
  const prepareDef = flow.defs.find(def => def.id === `${flow.prefix}-prepare`)!
  toSubmit.mapping = Object.fromEntries(prepareDef.params.map(param => [param.name, `args.${param.name}`]))
  if (flow.prefix !== 'travel-expense') toSubmit.mapping.startUserSelectAssignees = 'result.tasks[].id'
  const submit = contracts[`${flow.prefix}-submit`]!
  submit.steps.push(step('recovery', `${flow.prefix}-prepare`, '尚未准备、校验失败或草稿/候选发生变化；不能在成功提交后自动重建', {}, '使用修正后的草稿重新准备，已成功写入的意图不可重发。'))
}

// Detail endpoints return stored OSS records, beyond the url/name accepted by drafts.
const storedAttachmentFields = [
  f('id', 'number', '已保存附件记录 ID'),
  f('systemName', 'string', '附件所属系统'), f('module', 'string', '附件所属模块'),
  f('funcName', 'string', '附件所属功能'), f('tag', 'string', '附件标签'),
  f('fileHash', 'string', '文件内容哈希；不是可下载 URL'),
  f('expiredTime', 'string', '附件过期时间；有值时按返回时间展示', { format: 'YYYY-MM-DD HH:mm:ss' }),
  f('pages', 'number', '附件页数'), f('size', 'number', '附件文件大小', { unit: '字节' }),
].map(field => ({ ...field, optional: true, nullable: true, source: 'AttachmentDTO/OssResourceDTO@dcb3f360194' }))
for (const id of ['general-approval-detail', 'product-design-approval-detail', 'leave-application-detail', 'rest-leave-application-detail', 'travel-expense-detail']) {
  const prefix = id === 'travel-expense-detail' ? 'attachmentList[].' : 'attachments[].'
  const contract = contracts[id]!
  for (const field of prefixed(prefix, storedAttachmentFields)) if (!contract.output.fields.some(existing => existing.path === field.path)) contract.output.fields.push(field)
}
for (const path of ['leavetimeVOs', 'startUserSelectAssignees']) {
  const field = contracts['leave-application-detail']!.output.fields.find(field => field.path === path)!
  field.type = 'null'
  field.meaning = '后端详情组装未填充，返回 null 或省略；不能从该字段恢复请假明细或自选审批人'
}

for (const id of ['travel-expense-prepare', 'travel-expense-submit']) {
  const c = WORKFLOW_AI_CONTRACTS[id]!
  c.inputs['travelEntryList[].budgetDetailId'] = { meaning: '本行预算明细 ID；选定候选的 id', source: 'contract-support-travel-budget-search.list[].id；orgId与费用承担组织一致，budgetMonth取paymentDate前7字符', type: 'number|string|null', required: false, lookup: { capabilityId: 'contract-support-travel-budget-search', args: { keyword: '$keyword', orgId: '$args.orgId', budgetMonth: '$context.budgetMonth' }, valueField: 'list[].id', labelField: 'list[].budgetDetailNo' }, constraints: ['仅选selectable=true；同一行budgetDetailNo与budgetAvailableAmount分别取budgetDetailNo与availableBalance，不能混用其他行', '付款月或组织改变后重新查询预算；可用余额不是后端占用保证'] }
  c.inputs.relatedRevenueSubjectId = { ...c.inputs.relatedRevenueSubjectId!, meaning: '销售费用关联收入科目 ID', source: 'contract-support-revenue-subject-search.list[].id；同一行name填relatedRevenueSubjectName', lookup: { capabilityId: 'contract-support-revenue-subject-search', args: { keyword: '$keyword' }, valueField: 'list[].id', labelField: 'list[].name' } }
  c.inputs['payeeInfo.receivingCorporationId'] = { ...c.inputs['payeeInfo.receivingCorporationId']!, meaning: '内部收款法人库主键；不是外部客商payeeId，也不是历史组织receivingCompanyId', source: 'contract-support-corporation-search.list[].id；同一行name填receivingCorporationName', type: 'number|string|null', required: false, requiredWhen: 'payeeType=2且companySubType=1时选择内部法人；历史组织回填分支另按已有单据', lookup: { capabilityId: 'contract-support-corporation-search', args: { keyword: '$keyword' }, valueField: 'list[].id', labelField: 'list[].name' } }
  c.consume.push('预算候选按费用承担组织与付款月份查，list[].id/budgetDetailNo/availableBalance对应明细budgetDetailId/budgetDetailNo/budgetAvailableAmount。收入科目的id/name成对传relatedRevenueSubjectId/Name。内部收款法人先按名称查候选，外部客商仍走payee-options。')
  c.steps.push({ role: 'required', when: 'payeeType=2且companySubType=1选择或更换内部法人', capabilityId: 'contract-support-corporation-payee-get', instruction: '用已选receivingCorporationId传corporationId读取开户资料；清除旧组织/外部客商/银行字典及旧账号后，按同一详情七字段回填payeeInfo，再重新prepare。' })
  c.gaps = []
}
WORKFLOW_METHOD_CONTRACTS['travelExpense.submit']!.inputs = WORKFLOW_AI_CONTRACTS['travel-expense-submit']!.inputs
WORKFLOW_METHOD_CONTRACTS['travelExpense.submit']!.gaps = []
WORKFLOW_METHOD_CONTRACTS['travelExpense.previewApprovalChain']!.gaps = []
