import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_INSURANCE_PAYMENT_SUMMARY_METHODS, reportInsurancePaymentSummaryCapabilities } from '../capabilities/report-insurance-payment-summary.js'

const definitions = new Map(reportInsurancePaymentSummaryCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })

const summaryFields: AiField[] = [
  field('list[].id', 'string | number', '汇总单ID；人员明细使用该ID'),
  field('list[].socialFundSummaryIds', '(string | number)[]', '按缴存单位聚合时对应的底层汇总单ID数组'),
  field('list[].organizationId', 'string | number', '部门ID'),
  field('list[].organizationName', 'string', '部门组织全路径'),
  field('list[].staffCount', 'number | string', '人数'),
  field('list[].useYearMonth', 'string', '使用年月；页面按YYYY-MM展示'),
  field('list[].pensionCompany', 'number | string', '养老单位金额；服务端BigDecimal按原值返回'),
  field('list[].pensionPersonal', 'number | string', '养老个人金额；服务端BigDecimal按原值返回'),
  field('list[].unemploymentCompany', 'number | string', '失业单位金额；服务端BigDecimal按原值返回'),
  field('list[].unemploymentPersonal', 'number | string', '失业个人金额；服务端BigDecimal按原值返回'),
  field('list[].injuryCompany', 'number | string', '工伤单位金额；服务端BigDecimal按原值返回'),
  field('list[].injuryPersonal', 'number | string', '工伤个人金额；服务端BigDecimal按原值返回'),
  field('list[].medicalCompany', 'number | string', '医疗单位金额；服务端BigDecimal按原值返回'),
  field('list[].medicalPersonal', 'number | string', '医疗个人金额；服务端BigDecimal按原值返回'),
  field('list[].majorMedicalPersonal', 'number | string', '大额医疗个人金额；服务端BigDecimal按原值返回'),
  field('list[].totalCompany', 'number | string', '保险单位合计；服务端BigDecimal按原值返回'),
  field('list[].totalPersonal', 'number | string', '保险个人合计；服务端BigDecimal按原值返回'),
  field('list[].status', 'number', '汇总单状态：0待提交、1待审核、2待付款、3已驳回、4已付款'),
]
const personFields: AiField[] = [
  field('page.list[].name', 'string', '员工姓名'),
  field('page.list[].useYearMonth', 'string', '年月'),
  field('page.list[].pensionCompany', 'number | string', '养老单位金额'),
  field('page.list[].pensionPersonal', 'number | string', '养老个人金额'),
  field('page.list[].unemploymentCompany', 'number | string', '失业单位金额'),
  field('page.list[].unemploymentPersonal', 'number | string', '失业个人金额'),
  field('page.list[].injuryCompany', 'number | string', '工伤单位金额'),
  field('page.list[].injuryPersonal', 'number | string', '工伤个人金额'),
  field('page.list[].medicalCompany', 'number | string', '医疗单位金额'),
  field('page.list[].medicalPersonal', 'number | string', '医疗个人金额'),
  field('page.list[].majorMedicalPersonal', 'number | string', '大额医疗个人金额'),
  field('page.list[].totalCompany', 'number | string', '保险单位合计'),
  field('page.list[].totalPersonal', 'number | string', '保险个人合计'),
  field('page.list[].status', 'number', '关联汇总状态：0待提交、1待审核、2待付款、3已驳回、4已付款'),
]
const paymentFields: AiField[] = [
  field('id', 'string | number', '缴纳单业务ID；submit返回值'),
  field('processInstanceId', 'string | null', '审批流程实例ID；与业务ID不同'),
  field('useYearMonth', 'string', '使用年月YYYY-MM'),
  field('paymentDate', 'string', '预计付款日期YYYY-MM-DD'),
  field('name', 'string | null', '缴纳单名称'),
  field('organizationId', 'string | number', '申请部门ID'),
  field('organizationName', 'string', '申请部门名称快照'),
  field('depositUnitIds', '(string | number)[]', '缴存单位ID数组；不选时后端为空'),
  field('depositUnitNames', 'string[]', '缴存单位名称快照'),
  field('totalAmount', 'number | string', '总金额；后端按选中的汇总重新计算'),
  field('type', 'number', '固定为1，表示社保缴纳单'),
  field('status', 'number', '缴纳单状态：0草稿、1审批中、2审批通过、3驳回、4取消'),
  field('socialFundSummaryVOList', 'object[]', '金额明细及关联的社保汇总ID'),
  field('budgetNo', 'string | null', '预算明细编号快照'),
  field('budgetIds', 'string | null', '预算明细ID逗号字符串'),
]
const outputPage: AiContract['output'] = { shape: '{ list: object[], total: number }', fields: [field('list', 'object[]', '当前页社保缴纳汇总'), field('total', 'number', '筛选结果总数'), ...summaryFields], empty: 'list=[]且total=0表示筛选无结果；不能据此判断无权限。' }
const outputPerson: AiContract['output'] = { shape: '{ title: string | null, page: { list: object[], total: number } }', fields: [field('title', 'string | null', '弹窗标题'), field('page', 'object', '人员明细分页包络'), field('page.list', 'object[]', '当前页人员明细'), field('page.total', 'number', '人员明细总数'), ...personFields], empty: 'page.list=[]且page.total=0表示当前明细筛选无结果。' }
const outputTasks: AiContract['output'] = { shape: '{ payload: object, tasks: object[] }', fields: [field('payload', 'object', '将提交给创建接口的业务载荷，不含审批人映射'), field('tasks', 'object[]', '当前载荷需要人工选择的审批节点；使用每项id作为映射键')], empty: 'tasks=[]表示当前流程没有发起人自选节点；不要臆造节点ID。' }
const outputId: AiContract['output'] = { shape: 'string | number', fields: [field('$', 'string | number', '新建社保缴纳单业务ID')], empty: '不会返回空业务ID。' }
const outputPayment: AiContract['output'] = { shape: 'object | null', fields: paymentFields, empty: 'null表示后端没有找到该业务单据；不要当作创建成功。' }

const queryInputs: Record<string, AiParameter> = {
  orgIds: optional('角色组织树选中的部门ID数组；发送前连接为逗号字符串', 'Portal部门树多选值', '未选择时发送空字符串', { type: '(string | number)[]' }),
  costDateRange: optional('年月区间；每端点为YYYY-MM，发送时转YYYY-MM-01', 'Portal月份区间选择器', '未选择时两个日期发送null', { type: '[string | null, string | null]' }),
}
const personInputs: Record<string, AiParameter> = {
  summaryId: optional('单个汇总单ID', '列表行id或summaryId', '与summaryIds二选一', { type: 'string | number', nullable: true }),
  summaryIds: optional('多个底层汇总单ID', '聚合列表行socialFundSummaryIds', '与summaryId二选一', { type: '(string | number)[]', nullable: true }),
  depositUnitIds: optional('缴存单位ID数组', '缴纳汇总表单已选缴存单位', '未选择时不发送', { type: '(string | number)[]' }),
  name: optional('员工姓名', '人员明细弹窗姓名筛选', '未填写时发送空字符串'),
}

function inputsOf (id: string): Record<string, AiParameter> {
  if (id.endsWith('-list')) return { ...queryInputs, pageNo: optional('页码，从1开始', 'Portal分页器', '默认1', { type: 'number' }), pageSize: optional('每页条数，仅支持Portal页大小选项', 'Portal分页器', '默认20', { type: 'number' }) }
  if (id.endsWith('-person-detail')) return { ...personInputs, pageNo: optional('页码，从1开始', 'Portal人员明细分页器', '默认1', { type: 'number' }), pageSize: optional('每页条数，仅支持Portal页大小选项', 'Portal人员明细分页器', '默认20', { type: 'number' }) }
  const definition = definitions.get(id)
  if (!definition) throw new Error(`社保缴纳汇总契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, { type: parameter.kind === 'number' ? 'number' : 'string', required: parameter.required, meaning: parameter.description ?? parameter.name, source: 'Portal 社保缴纳汇总表或社保缴纳单表单。' }]))
}

const draftInput: AiParameter = input('社保缴纳单草稿。useYearMonth、paymentDate、organizationId、organizationName、socialFundSummaryVOList必填；depositUnitIds非空时按缴存单位聚合并要求每行socialFundSummaryIds；否则每行必须有socialFundSummaryId。预算明细可选，但会触发后端财务预算校验和占用。', 'Portal /simple/hr/form/018 页面字段与金额明细', { type: 'object' })
const gaps = ['尚未在真实测试环境执行本页面列表、人员明细及社保缴纳单完整写链路；当前证据来自Portal源码、Java Controller/VO/Service与离线请求断言。', '预算候选、组织树和缴存单位候选由Portal组件加载；SDK不复制全量候选，调用方需先取得并核实ID。', '审批节点由后端按当前草稿返回，不能按名称臆造；必须用prepare返回的task.id建立startUserSelectAssignees。']

const base = (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries: ['只操作当前用户在 /dashboard/report/insurance-payment-summary 权限范围内的社保汇总和缴纳单；列表/明细使用platform实例并发送module-type=14。', 'type固定为1（社保）；写提交会创建业务单据、占用已选预算并发起审批，成功会影响汇总状态和流程待办。'],
  effect: 'read',
  prerequisites: ['使用会话token和租户创建SDK；组织、汇总单、缴存单位及预算ID必须来自当前用户可见数据。'],
  inputs: inputsOf(id),
  output,
  consume,
  steps: [],
  completion: '返回与页面对应的分页、审批节点、业务ID、详情或撤销结果；写入成功后必须回查详情/流程状态。',
  failures: ['非法ID、日期、分页或空金额明细在请求前失败；权限、预算、汇总状态、网络和后端错误原样抛出。', '后端可能因汇总已被其他缴纳单占用、组织无权限、预算余额不足或审批节点映射不完整而拒绝。'],
  idempotency: null,
  evidence: [
    { source: 'src/capabilities/report-insurance-payment-summary.ts', kind: 'implementation', note: '锁定列表/明细参数顺序、社保表单转换、审批节点和权限module-type。' },
    { source: 'test/report-insurance-payment-summary.test.ts', kind: 'test', note: '离线锁定Portal日期/组织转换、保险金额明细形状、prepare→submit链路和坏输入。' },
    { source: 'docs/pages/社保缴纳汇总表.md', kind: 'reference', note: '记录Portal页面动作、Java VO/Controller约束和真实环境边界。' },
  ],
  gaps,
  ...extra,
})

const contracts: Record<string, AiContract> = {
  'report-insurance-payment-summary-list': base('report-insurance-payment-summary-list', '查询社保缴纳汇总表。', outputPage, ['按list展示部门、人数、年月、养老/失业/工伤/医疗/大额医疗及单位个人合计金额和状态；金额按原值消费，total只用于分页。']),
  'report-insurance-payment-summary-person-detail': base('report-insurance-payment-summary-person-detail', '查看社保缴纳汇总行的人员明细。', outputPerson, ['展示page.list人员的各项保险金额和状态；page.total只用于分页。传聚合行的socialFundSummaryIds，不要只传展示名称。']),
  'report-insurance-payment-summary-prepare': { ...base('report-insurance-payment-summary-prepare', '提交社保缴纳单前准备当前草稿并获取发起人自选审批节点。', outputTasks, ['先逐项核对payload中的金额明细和totalAmount，再按tasks[].id向用户收集审批人用户ID。']), effect: 'prepare', inputs: { draft: draftInput }, steps: [{ capabilityId: 'report-insurance-payment-summary-prepare', mapping: { draft: 'args.draft' }, instruction: '在任何提交前调用；返回tasks后按每个task.id收集审批人。', role: 'required', when: '用户准备创建社保缴纳单' }] },
  'report-insurance-payment-summary-submit': { ...base('report-insurance-payment-summary-submit', '提交社保缴纳单并发起 social_security_payment 审批流程。', outputId, ['保存返回的业务ID；立即调用report-insurance-payment-summary-payment-detail核对实际保存的组织、月份、金额和状态。', '如需撤回且单据仍允许撤销，调用report-insurance-payment-summary-cancel并回查详情。']), effect: 'write', inputs: { draft: draftInput, startUserSelectAssignees: input('审批节点到用户ID数组的映射；键必须来自prepare.tasks[].id，用户ID必须来自当前用户可见审批人候选。', 'report-insurance-payment-summary-prepare.tasks[].id与人员候选', { type: 'object' }) }, steps: [{ capabilityId: 'report-insurance-payment-summary-prepare', mapping: { draft: 'args.draft' }, instruction: '提交前必须准备同一份草稿并取得当前审批节点。', role: 'required', when: '尚未准备或草稿有任何变更' }, { capabilityId: 'report-insurance-payment-summary-submit', mapping: { draft: 'args.draft', startUserSelectAssignees: 'args.startUserSelectAssignees' }, instruction: '用户确认金额、预算和审批人后提交；会创建单据、占用预算并发送审批待办。', role: 'required', when: '用户明确确认提交' }, { capabilityId: 'report-insurance-payment-summary-payment-detail', mapping: { id: 'result.$' }, instruction: '提交响应后回查详情，确认业务单据和流程状态。', role: 'required', when: 'submit返回业务ID' }], idempotency: '后端创建会发起审批且未提供SDK幂等键；超时或响应不确定时先按业务ID/名称/月份和流程key回查，禁止盲目重试。' },
  'report-insurance-payment-summary-payment-detail': base('report-insurance-payment-summary-payment-detail', '查询社保缴纳单详情。', outputPayment, ['区分业务单据id与processInstanceId；展示status和processInstanceId，不把返回对象当作审批已通过。']),
  'report-insurance-payment-summary-cancel': { ...base('report-insurance-payment-summary-cancel', '撤销社保缴纳单。', { shape: 'boolean', fields: [field('$', 'boolean', '后端撤销成功回执')], empty: '不会返回空值。' }, ['撤销成功后再次调用payment-detail，确认status已变化；不能仅凭请求成功回执推断预算和流程都已回滚。']), effect: 'write', inputs: { id: input('社保缴纳单业务ID，不是流程实例ID。', 'report-insurance-payment-summary-submit返回值或payment-detail.id', { type: 'string | number' }) }, idempotency: '撤销不是可无限重放的状态切换；失败或超时先查询详情和流程状态。' },
}

export const REPORT_INSURANCE_PAYMENT_SUMMARY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_INSURANCE_PAYMENT_SUMMARY_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_INSURANCE_PAYMENT_SUMMARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_INSURANCE_PAYMENT_SUMMARY_METHODS).map(([id, method]) => [`reportInsurancePaymentSummary.${method}`, REPORT_INSURANCE_PAYMENT_SUMMARY_AI_CONTRACTS[id]!]))
