import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_MODULE_TYPE,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PERMISSION,
  reportUnitInterferenceCostAllocationCapabilities,
} from '../capabilities/report-unit-interference-cost-allocation.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(reportUnitInterferenceCostAllocationCapabilities.map(definition => [definition.id, definition]))

const statusValues = { '0': '待提交', '1': '审批中', '2': '审批通过', '3': '已驳回', '4': '已取消' }
const amountFields = ['salaryAmount', 'insuranceAmount', 'welfareAmount', 'otherAmount', 'providentFundAmount']

const rowFields: AiField[] = [
  field('list', 'object[]', '当前用户角色组织权限范围内、当前筛选和分页下的分摊明细记录。', { optional: false, nullable: false }),
  field('list[].id', 'string | number | null', '明细记录ID；后端按接收部门拆成明细行，查看详情时使用。'),
  field('list[].allocateDeptId', 'string | number | null', '分配部门ID；来自角色组织树。'),
  field('list[].allocateDeptName', 'string | null', '分配部门名称；列表展示值。'),
  field('list[].useYearMonth', 'string | null', '费用使用年月；Portal月份选择器按YYYY-MM提交。', { format: 'YYYY-MM' }),
  field('list[].name', 'string | null', '员工姓名；来自员工候选接口并随新建请求提交。'),
  field('list[].staffId', 'string | number | null', '员工ID；不能用员工姓名代替。'),
  field('list[].receiveDeptId', 'string | number | null', '接收部门ID；明细行对应的接收部门。'),
  field('list[].receiveDeptName', 'string | null', '接收部门名称；列表展示值。'),
  ...amountFields.map(name => field(`list[].${name}`, 'number | string | null', `${name}金额；Java BigDecimal原值，Portal合计按当前页数字求和并格式化为两位小数。`, { unit: '后端原始金额单位' })),
  field('list[].status', 'integer | null', '流程状态：0待提交、1审批中、2审批通过、3已驳回、4已取消。', { values: statusValues }),
  field('list[].processInstanceId', 'string | null', '流程实例ID；查看详情和重新发起动作的流程目标，不是明细记录ID。'),
  field('list[].createTime', 'string | null', '后端创建时间原值；当前列表未展示。'),
  field('list[].updateTime', 'string | null', '后端更新时间原值；当前列表未展示。'),
  field('total', 'integer', '符合筛选条件的总明细行数，用于分页，不是当前页长度。', { optional: false, nullable: false }),
  field('summary', 'object', 'Portal对当前页五个金额列求和后的展示值。', { optional: false, nullable: false }),
  ...amountFields.map(name => field(`summary.${name}`, 'string', `当前页${name}合计，严格按Portal numberFormat(total, 2, true, '0.00')格式化；空页也是0.00。`, { optional: false, nullable: false, format: '0.00' })),
]

const detailFields: AiField[] = [
  field('id', 'string | number | null', '单条后端明细记录ID。'),
  field('allocateDeptId', 'string | number | null', '分配部门ID。'),
  field('allocateDeptName', 'string | null', '分配部门名称。'),
  field('useYearMonth', 'string | null', '费用使用年月。', { format: 'YYYY-MM' }),
  field('name', 'string | null', '员工姓名。'),
  field('staffId', 'string | number | null', '员工ID。'),
  field('receiveDeptId', 'string | number | null', '该明细行接收部门ID。'),
  field('receiveDeptName', 'string | null', '该明细行接收部门名称。'),
  ...amountFields.map(name => field(name, 'number | string | null', `${name}金额；Java返回BigDecimal原值。`, { unit: '后端原始金额单位' })),
  field('status', 'integer | null', '流程状态，取值0至4。', { values: statusValues }),
  field('processInstanceId', 'string | null', '流程实例ID。'),
  field('createTime', 'string | null', '创建时间原值。'),
  field('updateTime', 'string | null', '更新时间原值。'),
]

const draftFields: AiField[] = [
  field('draft', 'object', '无副作用的新建提交草稿；字段只来自Portal可达表单。', { optional: false, nullable: false }),
  field('draft.allocateDeptId', 'string | number', '分配部门ID。', { optional: false, nullable: false }),
  field('draft.useYearMonth', 'string', '费用使用年月，格式YYYY-MM。', { optional: false, nullable: false, format: 'YYYY-MM' }),
  field('draft.staffId', 'string | number', '员工ID。', { optional: false, nullable: false }),
  field('draft.name', 'string', '员工姓名；由Portal员工组件按staffId解析，服务端保存所需。', { optional: false, nullable: false }),
  field('draft.onlySave', '0', 'Portal固定提交值0，表示提交审批而不是只保存草稿。', { optional: false, nullable: false, values: { '0': '提交' } }),
  field('draft.items', 'object[]', '至少一条接收部门明细；后端按每条明细落一条记录并计算总金额。', { optional: false, nullable: false }),
  field('draft.items[].receiveDeptId', 'string | number', '接收部门ID；不能等于分配部门，且同一分摊单内不能重复。', { optional: false, nullable: false }),
  ...amountFields.map(name => field(`draft.items[].${name}`, 'number', `${name}金额；空输入按Portal normalizeAmount归一为0，范围0至9999999999.99，最多两位小数。`, { optional: false, nullable: false, unit: '后端原始金额单位' })),
]

const staffFields: AiField[] = [
  field('list', 'object[]', '关键字命中的员工候选当前页。', { optional: false, nullable: false }),
  field('list[].id', 'string | number', '员工ID；回填或提交staffId。', { optional: false, nullable: false }),
  field('list[].name', 'string', '员工姓名；提交时作为name快照。', { optional: false, nullable: false }),
  field('list[].staffCode', 'string | null', '员工工号；可能为空。'),
  field('list[].label', 'string', 'Portal员工下拉展示文本；有工号时为姓名(工号)，否则为姓名。', { optional: false, nullable: false }),
  field('total', 'integer', '员工候选总数，用于分页；不是关键字命中数以外的全量人数。', { optional: false, nullable: false }),
]

const treeFields: AiField[] = [
  field('[]', 'object[]', '当前会话可见的角色组织树。', { optional: false, nullable: false }),
  field('[].id', 'string | number | null', '组织节点ID。'),
  field('[].name', 'string | null', '组织节点名称或路径。'),
  field('[].isStandardUnit', 'boolean', '是否标准化单元；Portal接收部门选择器禁用该节点。'),
  field('[].children', 'object[]', '子组织节点；没有子节点时可能缺省。'),
  field('[].children[].id', 'string | number | null', '子组织节点ID。'),
  field('[].children[].name', 'string | null', '子组织节点名称。'),
  field('[].children[].isStandardUnit', 'boolean', '子组织是否标准化单元。'),
]

const statusDraftFields: AiField[] = [
  field('id', 'string | number', '被驳回分摊单的后端明细ID。', { optional: false, nullable: false }),
  field('processInstanceId', 'string | number', '被驳回分摊单的流程实例ID；Portal重新发起动作以此调用流程实例查询。', { optional: false, nullable: false }),
  field('currentStatus', '3', '已通过状态门禁的当前状态。', { optional: false, nullable: false, values: { '3': '已驳回' } }),
]

const actionDraftFields: AiField[] = [
  field('id', 'string | number', '通过状态门禁的分摊单明细ID。', { optional: false, nullable: false }),
  field('currentStatus', '0 | 1', '通过状态门禁的当前流程状态；提交为0待提交，撤销为1审批中。', { optional: false, nullable: false }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer, summary: object }',
  fields: rowFields,
  empty: 'list=[]且total=0表示当前筛选无记录；summary五项仍返回0.00。权限、网络或响应结构错误会抛出，不静默返回空列表。',
}

const boundaries = [
  `页面范围是${REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH}，菜单权限是${REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PERMISSION}；请求使用platform实例并发送module-type=${REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_MODULE_TYPE}。`,
  '列表只复刻Portal实际表单字段name、allocateDeptId、receiveDeptId、useYearMonth、status，以及order、orderField、pageNo、pageSize；Java PageReqVO虽有更多字段，但当前页面没有暴露，SDK不扩展筛选。',
  'Java服务端按module-type=14取得当前用户角色组织范围，并在分页查询中收敛allocateDeptId；调用方不能用组织树之外的ID扩大可见数据。',
  '组织候选来自Portal实际调用的/org/organization/getRoleOrganizationTree；接收部门还遵守Portal禁用标准化单元、分配部门和重复已选节点的规则，SDK在提交前复核同/重复部门，后端仍会再次校验。',
  '员工组件在Portal默认无关键字分页拉取最多100页、每页200条；SDK不复制这个无头高成本行为，staffSearch必须先给姓名关键字，再按20/50/100/200分页。',
  '新建页面真正提交POST /hr/unit-staff-salary-expense/create，payload只有allocateDeptId、useYearMonth、staffId、name、onlySave=0和items五项金额；不发送名称字段、totalAmount、status或流程字段。',
  '金额输入可为空，Portal normalizeAmount将其提交为0；非空值必须是有限数字、>=0、<=9999999999.99且最多两位小数。后端按items拆行并计算totalAmount，SDK不自行发送或覆盖后端合计。',
  '列表的查看详情和重新发起使用processInstanceId；重新发起仅对status=3可用，先经过流程实例/流程定义检查，再由Portal表单按businessKey调用单条/get。当前页面没有可达的update、delete、import按钮，SDK不注册这些后端端点。',
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行该页面的列表、详情以及prepare→submit→回查闭环；当前证据为Portal/Java源码与离线请求形状测试。',
  '尚未确认当前测试租户返回的具体角色组织树和员工候选数据；SDK只验证响应结构，并保留服务端返回的额外字段。',
]

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`单元间人员混用费用分摊契约缺少能力：${id}`)
  const suffix = id.replace('report-unit-interference-cost-allocation-', '')
  if (suffix === 'list') return {
    name: param('员工姓名筛选；空值表示不筛选。', 'Portal列表筛选表单', { type: 'string', required: false, nullable: true, nullMeaning: '不按姓名筛选。', omitted: 'SDK发送null。' }),
    allocateDeptId: param('分配部门ID；来自角色组织树。', 'Portal分配部门筛选', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按分配部门筛选。', omitted: 'SDK发送null。' }),
    receiveDeptId: param('接收部门ID；来自角色组织树。', 'Portal接收部门筛选', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按接收部门筛选。', omitted: 'SDK发送null。' }),
    useYearMonth: param('月份筛选，格式YYYY-MM。', 'Portal月份选择器', { type: 'string', required: false, nullable: true, format: 'YYYY-MM', nullMeaning: '不按月份筛选。', omitted: 'SDK发送null。' }),
    status: param('流程状态。', 'Portal状态下拉框', { type: '0 | 1 | 2 | 3 | 4', required: false, nullable: true, options: Object.entries(statusValues).map(([value, label]) => ({ value: Number(value), label })), nullMeaning: '不按状态筛选。', omitted: 'SDK发送null。' }),
    pageNo: param('从1开始的页码。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数，仅支持10、20、50、100。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'detail') return { id: param('列表行的后端明细ID。', 'list.result.list[].id', { type: 'string | number', required: true }) }
  if (suffix === 'staff-search') return {
    keyword: param('员工姓名关键字；必须先提供非空关键字，避免无头调用复制Portal的全量拉取。', '用户输入的员工姓名关键字', { type: 'string', required: true, constraints: ['去除首尾空格后不能为空。'], lookup: { capabilityId: 'report-unit-interference-cost-allocation-staff-search', args: { keyword: 'user.keyword' }, valueField: 'list[].id', labelField: 'list[].name' } }),
    pageNo: param('员工候选页码。', '员工候选分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('员工候选每页条数，仅支持20、50、100、200。', '员工候选分页状态', { type: '20 | 50 | 100 | 200', required: false, default: '20' }),
  }
  if (suffix === 'prepare-create') return { form: param('Portal分摊单表单；包含分配部门、年月、员工ID/姓名和至少一个接收部门明细。', '用户填写的Portal流程表单', { type: 'object', required: true, constraints: ['接收部门不能等于分配部门，且不能重复；金额空值按0提交。'] }) }
  if (suffix === 'create') return {
    draft: param('prepareCreate返回的完整草稿；确认后原样交给create。', 'reportUnitInterferenceCostAllocation.prepareCreate.result.draft', { type: 'object', required: true }),
    'draft.allocateDeptId': param('草稿分配部门ID。', 'reportUnitInterferenceCostAllocation.prepareCreate.result.draft.allocateDeptId', { type: 'string | number', required: true }),
    'draft.useYearMonth': param('草稿年月，格式YYYY-MM。', 'reportUnitInterferenceCostAllocation.prepareCreate.result.draft.useYearMonth', { type: 'string', required: true, format: 'YYYY-MM' }),
    'draft.staffId': param('草稿员工ID。', 'reportUnitInterferenceCostAllocation.prepareCreate.result.draft.staffId', { type: 'string | number', required: true }),
    'draft.name': param('草稿员工姓名快照。', 'reportUnitInterferenceCostAllocation.prepareCreate.result.draft.name', { type: 'string', required: true }),
    'draft.onlySave': param('草稿固定提交标记，必须为0。', 'reportUnitInterferenceCostAllocation.prepareCreate.result.draft.onlySave', { type: '0', required: true }),
    'draft.items': param('草稿接收部门明细数组，至少一条。', 'reportUnitInterferenceCostAllocation.prepareCreate.result.draft.items', { type: 'object[]', required: true }),
    'draft.items[].receiveDeptId': param('每条明细的接收部门ID。', 'reportUnitInterferenceCostAllocation.prepareCreate.result.draft.items[].receiveDeptId', { type: 'string | number', required: true }),
  }
  if (suffix === 'prepare-recreate') return {
    id: param('列表行后端明细ID。', 'list.result.list[].id', { type: 'string | number', required: true }),
    currentStatus: param('当前列表行流程状态；必须为3已驳回。', 'list.result.list[].status', { type: '0 | 1 | 2 | 3 | 4', required: true, options: Object.entries(statusValues).map(([value, label]) => ({ value: Number(value), label })) }),
    processInstanceId: param('当前列表行流程实例ID；不能用明细id替代。', 'list.result.list[].processInstanceId', { type: 'string | number', required: true }),
  }
  if (suffix === 'prepare-submit') return {
    id: param('待提交分摊单的明细记录ID。', 'list.result.list[].id', { type: 'string | number', required: true }),
    currentStatus: param('当前列表行流程状态；必须为0待提交。', 'list.result.list[].status', { type: '0', required: true, options: [{ value: 0, label: '待提交' }] }),
  }
  if (suffix === 'submit') return {
    draft: param('prepareSubmit返回的草稿；包含id和currentStatus=0。', 'reportUnitInterferenceCostAllocation.prepareSubmit.result', { type: 'object', required: true }),
  }
  if (suffix === 'prepare-cancel') return {
    id: param('审批中分摊单的明细记录ID。', 'list.result.list[].id', { type: 'string | number', required: true }),
    currentStatus: param('当前列表行流程状态；必须为1审批中。', 'list.result.list[].status', { type: '1', required: true, options: [{ value: 1, label: '审批中' }] }),
  }
  if (suffix === 'cancel') return {
    draft: param('prepareCancel返回的草稿；包含id和currentStatus=1。', 'reportUnitInterferenceCostAllocation.prepareCancel.result', { type: 'object', required: true }),
  }
  return {}
}

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`单元间人员混用费用分摊契约缺少能力定义：${id}`)
  return {
    purpose,
    whenToUse: purpose,
    boundaries,
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用当前用户、当前租户会话token，并确认用户拥有该页面菜单权限；记录ID、流程实例ID、组织ID和员工ID必须来自当前会话可见数据。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: definition.write ? '返回结构校验通过后，还必须按年月、部门、员工和返回ID回查列表确认业务记录落库及流程状态。' : '响应结构校验通过；空结果按契约解释，不将权限或网络错误当作空结果。',
    failures: ['非法ID、月份、状态、金额、分页、空关键字、重复/同部门、权限、网络或Java业务错误会抛出；列表失败不会降级为空列表。', '提交请求会启动Portal审批流程，响应不确定时必须先回查，不得盲目重试。'],
    idempotency: definition.write ? '后端create没有requestId幂等协议，且onlySave=0会启动审批流程；超时或响应不确定时先按年月、员工、分配部门和接收部门回查，确认没有重复流程后再决定是否重试。' : null,
    evidence: [
      { source: 'app/portal/menus/hr.js、app/portal/views/dashboard/hr/report/unit-interference-cost-allocation/list.vue', kind: 'reference', note: '逐页核对菜单权限、筛选字段、分页、当前页合计、查看详情、驳回后重新发起和分摊单入口。' },
      { source: 'app/portal/views/simple/hr/form/014/index.vue、app/portal/views/simple/hr/form/014/page/pc/edit/index.vue、app/portal/views/simple/hr/form/014/page/pc/detail/index.vue、app/portal/components/portal/hxr/select/staff/index.vue', kind: 'reference', note: '核对流程key、表单必填项、组织禁用/重复规则、金额归一化、实际提交体、详情回查和员工候选请求。' },
      { source: 'UnitStaffSalaryExpenseController.java、UnitStaffSalaryExpenseSaveReqVO.java、UnitStaffSalaryExpenseRespVO.java、UnitStaffSalaryExpenseServiceImpl.java、UnitStaffSalaryExpenseMapper.java', kind: 'reference', note: '核对create/get/page端点、按接收部门拆行、onlySave状态、流程状态、module-type角色组织范围和后端同/重复部门校验。' },
      { source: 'src/capabilities/report-unit-interference-cost-allocation.ts、test/report-unit-interference-cost-allocation.test.ts', kind: 'implementation', note: '锁定页面请求、候选分页、提交体、状态门禁、摘要格式和坏输入反证；未替代真实环境闭环。' },
      { source: 'docs/pages/单元间人员混用费用分摊表.md', kind: 'reference', note: '记录页面能力、参数、字段基准、流程步骤和验证边界。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'report-unit-interference-cost-allocation-list': base('report-unit-interference-cost-allocation-list', '按姓名、分配部门、接收部门、月份和流程状态分页查询单元间人员混用费用分摊表，并返回Portal当前页金额合计。', listOutput, ['用list展示明细行；用summary展示当前页五项金额合计；用total翻页；把list[].processInstanceId传给详情或重新发起流程动作，不能把list[].id当流程实例ID。']),
  'report-unit-interference-cost-allocation-detail': base('report-unit-interference-cost-allocation-detail', '按列表明细ID读取Portal查看详情所需的单条分摊记录。', { shape: 'object | null', fields: detailFields, empty: '后端返回null表示该ID没有详情；响应结构、权限或网络错误会抛出。' }, ['按allocateDeptName、useYearMonth、name、staffId和该接收部门金额展示；Java get只返回一条明细，不能据此伪造整张多接收部门分摊单。']),
  'report-unit-interference-cost-allocation-organization-tree': base('report-unit-interference-cost-allocation-organization-tree', '读取Portal分配部门和接收部门选择器使用的角色组织树。', { shape: 'object[]', fields: treeFields, empty: '[]表示当前会话没有可见组织节点；权限或响应结构错误会抛出。' }, ['分配部门和接收部门候选都来自这棵树；接收部门选择时继续禁用标准化单元、分配部门和已被其他明细选中的节点。']),
  'report-unit-interference-cost-allocation-staff-search': base('report-unit-interference-cost-allocation-staff-search', '按员工姓名关键字分页查询分摊单员工候选。', { shape: '{ list: object[], total: integer }', fields: staffFields, empty: 'list=[]且total=0表示当前关键字没有候选；不会把空关键字转换为全量拉取。' }, ['用list[].id作为staffId、list[].name作为name快照；需要下一页时沿用同一keyword并递增pageNo。']),
  'report-unit-interference-cost-allocation-prepare-create': { ...base('report-unit-interference-cost-allocation-prepare-create', '按Portal分摊单表单规则校验并生成无副作用的新建草稿。', { shape: '{ draft: object }', fields: draftFields, empty: '缺少分配部门、年月、员工、接收部门，接收部门同/重复，或金额非法时抛出且不发请求。' }, ['向用户展示draft；用户取消时只丢弃草稿。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户明确确认提交', capabilityId: 'report-unit-interference-cost-allocation-create', mapping: { draft: 'result.draft' }, instruction: '将同一份draft原样交给create；不要增加status、totalAmount、名称字段或流程字段。' }, { role: 'cancel', when: '用户取消提交', instruction: '只丢弃draft，不发送POST。' }] }) },
  'report-unit-interference-cost-allocation-create': { ...base('report-unit-interference-cost-allocation-create', '提交一张单元间人员混用费用分摊单并启动Portal审批流程。', { shape: 'string | number', fields: [field('$', 'string | number', 'Java create接口返回的首条明细记录ID；不是流程实例ID。', { optional: false, nullable: false })], empty: '后端未返回正整数ID或业务/权限/网络失败时抛出。' }, ['返回ID只证明请求获得后端回执；按draft年月、员工、分配部门和接收部门回查list，核对明细、五项金额和status。'], { effect: 'write', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-unit-interference-cost-allocation-list', mapping: { name: 'args.draft.name', allocateDeptId: 'args.draft.allocateDeptId', useYearMonth: 'args.draft.useYearMonth' }, instruction: '重新分页查询并按返回ID及所有接收部门明细核对；不要只凭Long ID或成功响应宣布流程已生效。' }] }) },
  'report-unit-interference-cost-allocation-prepare-submit': { ...base('report-unit-interference-cost-allocation-prepare-submit', '确认分摊单仍为待提交状态并生成提交草稿，不发请求。', { shape: '{ id: string | number, currentStatus: 0 }', fields: actionDraftFields.map(item => item.path === 'currentStatus' ? { ...item, type: '0', meaning: '状态门禁已确认：待提交。' } : item), empty: '缺少ID或当前状态不是0时抛出；不发请求。' }, ['用户确认后将草稿交给submit；取消时直接丢弃草稿。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认提交', capabilityId: 'report-unit-interference-cost-allocation-submit', mapping: { draft: 'result.$' }, instruction: '将同一份草稿交给submit；不要重新读取或伪造状态。' }, { role: 'cancel', when: '用户取消提交', instruction: '只丢弃草稿，不发POST。' }] }) },
  'report-unit-interference-cost-allocation-submit': { ...base('report-unit-interference-cost-allocation-submit', '调用Portal/历史动作定义的提交端点，将待提交分摊单送入流程。', { shape: 'true', fields: [field('$', 'boolean', '后端成功标志，必须严格为true。', { optional: false, nullable: false })], empty: '响应不是true、权限/网络失败时抛出；当前测试Java controller未声明此端点，实际部署需先确认后端版本。' }, ['成功或响应不确定时回查列表确认状态变化；不要只依据HTTP成功。'], { effect: 'write', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-unit-interference-cost-allocation-list', mapping: { status: '0' }, instruction: '回查同一ID，确认status由0变为Portal实际流程状态；当前Java源码没有对应submit映射时应把缺口报告为外部阻塞。' }] }) },
  'report-unit-interference-cost-allocation-prepare-cancel': { ...base('report-unit-interference-cost-allocation-prepare-cancel', '确认分摊单仍为审批中状态并生成撤销草稿，不发请求。', { shape: '{ id: string | number, currentStatus: 1 }', fields: actionDraftFields.map(item => item.path === 'currentStatus' ? { ...item, type: '1', meaning: '状态门禁已确认：审批中。' } : item), empty: '缺少ID或当前状态不是1时抛出；不发请求。' }, ['用户确认后将草稿交给cancel；取消时直接丢弃草稿。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认撤销', capabilityId: 'report-unit-interference-cost-allocation-cancel', mapping: { draft: 'result.$' }, instruction: '将同一份草稿交给cancel；不要重新读取或伪造状态。' }, { role: 'cancel', when: '用户取消撤销', instruction: '只丢弃草稿，不发POST。' }] }) },
  'report-unit-interference-cost-allocation-cancel': { ...base('report-unit-interference-cost-allocation-cancel', '调用Portal/历史动作定义的撤销端点，撤销审批中的分摊单。', { shape: 'true', fields: [field('$', 'boolean', '后端成功标志，必须严格为true。', { optional: false, nullable: false })], empty: '响应不是true、权限/网络失败时抛出；当前测试Java controller未声明此端点，实际部署需先确认后端版本。' }, ['成功或响应不确定时回查列表确认状态变化；不要只依据HTTP成功。'], { effect: 'write', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-unit-interference-cost-allocation-list', mapping: { status: '1' }, instruction: '回查同一ID，确认status进入Portal实际取消状态；当前Java源码没有对应cancel映射时应把缺口报告为外部阻塞。' }] }) },
  'report-unit-interference-cost-allocation-prepare-recreate': { ...base('report-unit-interference-cost-allocation-prepare-recreate', '检查当前列表行是否为已驳回，并准备Portal重新发起前置草稿。', { shape: '{ id: string | number, processInstanceId: string | number, currentStatus: 3 }', fields: statusDraftFields, empty: '缺少ID、流程实例ID或当前状态不是3已驳回时抛出；不发请求。' }, ['把同一份草稿用于流程实例和流程定义前置检查，再打开编辑表单；编辑表单会按businessKey调用/get并重新提交create。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认重新发起', capabilityId: 'task-action-instance', mapping: { processInstanceId: 'args.processInstanceId' }, instruction: '先查询该流程实例并确认它属于当前行；不要把明细id当processInstanceId。' }, { role: 'required', when: '流程实例有效后', capabilityId: 'report-unit-interference-cost-allocation-detail', mapping: { id: 'args.id' }, instruction: '读取Portal编辑表单需要的单条业务详情；Java get按明细返回，不扩展为未返回的其他接收部门。' }, { role: 'cancel', when: '用户取消重新发起', instruction: '只丢弃草稿，不启动流程或提交create。' }] }) },
}

export const REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.keys(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS).map(id => [id, contracts[id]!]),
)
export const REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS).map(([id, method]) => [
    `reportUnitInterferenceCostAllocation.${method}`,
    { ...REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_AI_CONTRACTS[id]!, boundaries: [...REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_AI_CONTRACTS[id]!.boundaries, `直接方法路径为reportUnitInterferenceCostAllocation.${method}；写操作遵循prepare→submit→回查。`] },
  ]),
)
