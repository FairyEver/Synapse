import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  REPORT_LABOR_COST_ALLOCATION_METHODS,
  REPORT_LABOR_COST_ALLOCATION_MODULE_TYPE,
  REPORT_LABOR_COST_ALLOCATION_PAGE_PATH,
  REPORT_LABOR_COST_ALLOCATION_PERMISSION,
  reportLaborCostAllocationCapabilities,
} from '../capabilities/report-labor-cost-allocation.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(reportLaborCostAllocationCapabilities.map(definition => [definition.id, definition]))

const amountFields = [
  ['predictedPayableAmount', '工资Tab预测应发总额'],
  ['predictedUnitPension', '预测单位_养老'],
  ['predictedUnitMedical', '预测单位_医疗'],
  ['predictedUnitUnemployment', '预测单位_失业'],
  ['predictedUnitCriticalIllness', '预测单位_大病医疗'],
  ['predictedUnitMaternity', '预测单位_生育'],
  ['predictedUnitWorkInjury', '预测单位_工伤'],
  ['predictedUnitSocialSecurityTotal', '预测单位_社保总额'],
  ['predictedUnitProvidentFundTotal', '预测单位_公积金总额'],
] as const

const rowFields: AiField[] = [
  field('list', 'object[]', '当前Tab当前页的人工成本计提分配记录。'),
  field('list[].id', 'string | number | null', '记录ID；编辑和删除目标。'),
  field('list[].useYearMonth', 'string | null', '年月，页面按YYYY-MM显示。'),
  field('list[].standardUnitId', 'string | number | null', '标准化单元组织ID；提交时不能用名称代替。'),
  field('list[].standardUnitName', 'string | null', '标准化单元名称路径快照。'),
  field('list[].departmentId', 'string | number | null', '部门组织ID；提交时不能用名称代替。'),
  field('list[].departmentName', 'string | null', '部门名称路径快照。'),
  ...amountFields.map(([name, label]) => field(`list[].${name}`, 'number | string | null', `${label}；Java BigDecimal原值，页面按两位小数显示。`)),
  field('list[].status', 'integer | null', '状态：0待计提、1待月结、2已月结。', { values: { '0': '待计提', '1': '待月结', '2': '已月结' } }),
  field('list[].statusName', 'string | null', '后端按状态枚举生成的状态名称。'),
  field('total', 'integer', '当前Tab和筛选条件下的记录总数，用于翻页。'),
  field('summary', 'object', 'Portal列表底部合计；工资Tab来自后端/sum，社保公积金Tab按当前页列表计算。'),
  ...amountFields.map(([name, label]) => field(`summary.${name}`, 'number | string | null', `${label}合计；无该Tab字段时不返回或为null。`)),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer, summary: object }',
  fields: rowFields,
  empty: 'list=[]且total=0表示当前Tab筛选无记录；summary为0或null不代表没有权限；权限、网络或响应结构错误会抛出。',
}

const draftFields: AiField[] = [
  field('draft.allocationType', '"salary" | "socialFund"', '当前Tab；salary为工资成本，socialFund为社保公积金。'),
  field('draft.useYearMonth', 'string', '月份，YYYY-MM。'),
  field('draft.standardUnitId', 'string | number', '标准化单元ID。'),
  field('draft.standardUnitName', 'string | null', 'Portal组织树计算出的标准化单元路径快照。'),
  field('draft.departmentId', 'string | number', '部门ID。'),
  field('draft.departmentName', 'string | null', 'Portal组织树计算出的部门路径快照。'),
  ...amountFields.map(([name, label]) => field(`draft.${name}`, 'number', `${label}；仅当前Tab对应字段必须填写，页面InputNumber precision=2。`)),
]

const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'true', '后端返回的成功回执；不包含更新或删除后的记录。')], empty: '后端业务错误、权限错误或响应不是true时抛出。' }
const idOutput: AiContract['output'] = { shape: 'string | number', fields: [field('$', 'string | number', '新建记录ID。')], empty: '后端没有返回正整数ID时抛出。' }
const fileOutput: AiContract['output'] = {
  shape: '{ allocationType, fileName, contentType, base64, byteLength }',
  fields: [field('allocationType', '"salary" | "socialFund"', '下载模板对应的Tab。'), field('fileName', 'string', 'Portal保存文件使用的模板文件名。'), field('contentType', 'string | null', '响应Content-Type。'), field('base64', 'string', '非空模板文件的Base64内容。'), field('byteLength', 'integer', '模板原始字节数；必须大于0。')],
  empty: '空文件响应会抛出。',
}
const importOutput: AiContract['output'] = { shape: 'string | null', fields: [field('$', 'string | null', '导入接口成功文案；后端没有data时为null。')], empty: '文件校验、网络或后端业务错误会抛出。' }
const previewOutput: AiContract['output'] = { shape: '{ allocationType, fileName, contentType, byteLength }', fields: [field('allocationType', '"salary" | "socialFund"', '导入目标Tab。'), field('fileName', 'string', '原文件名。'), field('contentType', 'string', '上传MIME类型。'), field('byteLength', 'integer', '文件字节数；必须大于0。')], empty: '扩展名、Base64或空文件不合法时抛出，不发请求。' }

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`人工成本计提分配契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.name === 'allocationType' ? '"salary" | "socialFund"' : parameter.kind === 'enum' ? 'number | string' : parameter.kind === 'number' ? 'number' : parameter.kind === 'tree' ? 'string | number' : parameter.kind === 'date' ? 'string' : 'object',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal人工成本计提分配表列表、Tab、编辑页、下载模板弹窗或导入文件动作；参数按当前Tab投影。',
    ...(parameter.options ? { options: parameter.options } : {}),
  }]))
}

const boundaries = [
  `页面范围是${REPORT_LABOR_COST_ALLOCATION_PAGE_PATH}，菜单权限是${REPORT_LABOR_COST_ALLOCATION_PERMISSION}，使用platform实例并发送module-type=${REPORT_LABOR_COST_ALLOCATION_MODULE_TYPE}。`,
  '同一页面有两个Tab：salary请求/hr/salary-cost-accrual-allocation，socialFund请求/hr/social-fund-cost-accrual-allocation；缺省Tab为salary，allocationType不会放入后端查询或保存载荷。',
  'list固定发送order=""、orderField=""、useYearMonth、organizationId、standardUnitId、status、pageNo和pageSize；页面分页选项为10/20/50/100，月份由日期选择器转换为YYYY-MM。salary会并行读取/page和/sum，socialFund没有/sum而按当前页计算summary。',
  '新建/编辑表单的月份、标准化单元ID、部门ID必填；salary只要求predictedPayableAmount，socialFund要求8个预测单位金额字段；金额使用页面InputNumber precision=2，不额外做未声明的正负范围限制。',
  'Portal在列表行status为1待月结或2已月结时阻止编辑和删除，并提示“财务已计提/已封账无法编辑/删除”；SDK的prepareUpdate、update、prepareRemove、remove均要求当前状态为0，不能绕过该门禁。',
  '组织树由Portal共享组件读取/org/organization/getRoleOrganizationTree；SDK不伪造选项，调用方必须提供当前会话可见的组织/标准化单元/部门ID以及页面生成的名称路径快照。',
  '下载模板必须提交organizationId和useYearMonth；导入只接受.xml/.xlsx/.xls并以multipart字段file提交，用户取消prepare结果时不发写请求。',
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐Tab执行分页、合计、模板下载、导入、新建、编辑、删除和回查；当前证据为Portal/Java源码与离线请求形状测试。',
  '尚未在真实租户确认组织树ID与路径快照的实际类型，以及Java BigDecimal返回值在当前网关中的JSON形态；SDK同时兼容数字和数字字符串。',
]

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries,
    effect: 'read',
    prerequisites: ['使用当前用户、当前租户的会话token；Tab、组织ID、部门ID和记录ID必须来自当前用户可见且已核实的Portal数据。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: '响应结构校验通过；写操作成功或超时后按契约回查，不把成功回执当作业务终态证据。',
    failures: ['非法Tab、ID、月份、状态、金额、分页、文件、权限、网络或Java业务错误会抛出；列表失败不得降级为空列表。', '状态为1或2的记录不能编辑或删除；用户取消prepare结果不发送请求。'],
    idempotency: null,
    evidence: [
      { source: 'app/portal/menus/hr.js、app/portal/views/dashboard/hr/report/labor-cost-allocation/list.vue、app/portal/views/dashboard/hr/report/labor-cost-allocation/[mode]/[id].vue、app/portal/views/dashboard/hr/report/labor-cost-allocation/ModalContentForDownloadTemplate.vue', kind: 'reference', note: '逐页核对两个Tab、筛选/分页、合计、表单required、状态锁定、模板下载、导入和写入载荷。' },
      { source: 'LaborCostAccrualAllocationController.java、SocialFundCostAccrualAllocationController.java及对应VO/Service/DO', kind: 'reference', note: '核对两个后端前缀、CRUD、sum、import、download-template、字段、状态门禁和组织范围。' },
      { source: 'src/capabilities/report-labor-cost-allocation.ts、test/report-labor-cost-allocation.test.ts', kind: 'implementation', note: '锁定Tab路由、查询并发、summary、表单字段、状态反证、文件载荷和坏响应；未替代真实环境闭环。' },
      { source: 'docs/pages/人工成本计提分配表.md', kind: 'reference', note: '记录字段、权限、两个Tab、表单提交和证据边界。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'report-labor-cost-allocation-list': base('report-labor-cost-allocation-list', '按工资成本或社保公积金Tab查询人工成本计提分配表。', pageOutput, ['按list和total翻页；按allocationType只展示对应金额字段；使用summary显示工资/sum或社保公积金当前页合计。']),
  'report-labor-cost-allocation-prepare-create': {
    ...base('report-labor-cost-allocation-prepare-create', '准备人工成本计提分配新建草稿。', { shape: '{ draft: object }', fields: [field('draft', 'object', '按当前Tab表单生成的无副作用保存草稿'), ...draftFields], empty: '月份、组织ID、部门ID或当前Tab必填金额缺失时抛出。' }, ['把draft展示给用户确认；取消时只丢弃draft。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认新建草稿', capabilityId: 'report-labor-cost-allocation-create', mapping: { draft: 'result.draft' }, instruction: '将同一份draft交给create，不要把allocationType写入后端data。' }, { role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不发送POST。' }] }),
  },
  'report-labor-cost-allocation-create': {
    ...base('report-labor-cost-allocation-create', '按当前Tab新建一条人工成本计提分配记录。', idOutput, ['保存返回ID；按同一allocationType和筛选条件list回查记录、金额和status=0。'], { effect: 'write', idempotency: '后端按月份+部门防重复，但没有requestId；请求超时必须先list回查，不能盲目重试。', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-labor-cost-allocation-list', mapping: { allocationType: 'args.allocationType' }, instruction: '重新查询并按返回ID、月份、标准化单元、部门和金额核对。' }] }),
  },
  'report-labor-cost-allocation-prepare-update': {
    ...base('report-labor-cost-allocation-prepare-update', '准备编辑一条待计提的人工成本计提分配记录。', { shape: '{ draft: object }', fields: [field('draft', 'object', '带ID、allocationType和status=0的无副作用编辑草稿'), ...draftFields, field('draft.id', 'string | number', '当前列表行ID。'), field('draft.status', '0', '已通过Portal状态门禁。')], empty: '缺少ID、当前状态不是0或表单必填字段缺失时抛出。' }, ['仅对当前列表行status=0调用；取消时只丢弃draft。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认编辑草稿', capabilityId: 'report-labor-cost-allocation-update', mapping: { draft: 'result.draft' }, instruction: '将同一份draft交给update，保留ID和allocationType；不要将status写入后端data。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送PUT。' }] }),
  },
  'report-labor-cost-allocation-update': {
    ...base('report-labor-cost-allocation-update', '编辑一条状态为待计提的人工成本计提分配记录。', trueOutput, ['请求成功或不确定后按同一Tab和ID回查字段；true不是业务终态证明。'], { effect: 'write', idempotency: '没有requestId；超时必须先list回查，确认仍为待计提且字段已更新后再决定是否重试。', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-labor-cost-allocation-list', mapping: { allocationType: 'args.allocationType' }, instruction: '按ID回查月份、组织、部门和当前Tab金额。' }] }),
  },
  'report-labor-cost-allocation-prepare-remove': {
    ...base('report-labor-cost-allocation-prepare-remove', '检查一条人工成本计提分配记录是否仍可删除。', { shape: '{ allocationType, id, currentStatus: 0 }', fields: [field('allocationType', '"salary" | "socialFund"', '删除目标Tab。'), field('id', 'string | number', '当前列表行ID。'), field('currentStatus', '0', '已通过可编辑状态门禁。')], empty: '缺少当前状态或状态为1/2时抛出。' }, ['将待删除行展示给用户确认；取消时不发DELETE。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'report-labor-cost-allocation-remove', mapping: { allocationType: 'result.allocationType', id: 'result.id', currentStatus: 'result.currentStatus' }, instruction: '只提交同一份已确认草稿。' }, { role: 'cancel', when: '用户取消删除', instruction: '只丢弃删除草稿，不调用remove。' }] }),
  },
  'report-labor-cost-allocation-remove': {
    ...base('report-labor-cost-allocation-remove', '删除一条状态为待计提的人工成本计提分配记录。', trueOutput, ['删除成功或不确定后按同一Tab和ID回查，确认记录不再出现。'], { effect: 'write', idempotency: '没有requestId；超时先list回查是否已删除，禁止盲目重试。', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-labor-cost-allocation-list', mapping: { allocationType: 'args.allocationType' }, instruction: '重新查询确认目标ID不再出现。' }] }),
  },
  'report-labor-cost-allocation-download-template': base('report-labor-cost-allocation-download-template', '按当前Tab、组织和月份下载人工成本计提分配导入模板。', fileOutput, ['保存非空文件；organizationId和useYearMonth来自下载模板弹窗，不能省略。']),
  'report-labor-cost-allocation-prepare-import': {
    ...base('report-labor-cost-allocation-prepare-import', '校验人工成本计提分配导入文件并准备提交。', previewOutput, ['确认Tab和文件预览后再调用importExcel；取消时只丢弃预览。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认导入', capabilityId: 'report-labor-cost-allocation-import', mapping: { allocationType: 'args.allocationType', fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '使用同一份原始文件提交multipart字段file。' }, { role: 'cancel', when: '用户取消导入', instruction: '只丢弃本地预览，不发送POST。' }] }),
  },
  'report-labor-cost-allocation-import': {
    ...base('report-labor-cost-allocation-import', '导入当前Tab的人工成本计提分配文件。', importOutput, ['导入成功或响应不确定后按同一Tab、月份、组织和部门回查；不能只凭成功文案宣布所有Excel行已落库。'], { effect: 'write', idempotency: '后端导入没有requestId；响应不确定时先list核对文件涉及月份/部门，再决定是否重试。', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-labor-cost-allocation-list', mapping: { allocationType: 'args.allocationType' }, instruction: '重新查询核对导入记录和状态=0，避免重复导入。' }] }),
  },
}

export const REPORT_LABOR_COST_ALLOCATION_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.keys(REPORT_LABOR_COST_ALLOCATION_METHODS).map(id => [id, contracts[id]!]),
)
export const REPORT_LABOR_COST_ALLOCATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(REPORT_LABOR_COST_ALLOCATION_METHODS).map(([id, method]) => [
    `reportLaborCostAllocation.${method}`,
    { ...REPORT_LABOR_COST_ALLOCATION_AI_CONTRACTS[id]!, boundaries: [...REPORT_LABOR_COST_ALLOCATION_AI_CONTRACTS[id]!.boundaries, `直接方法路径为reportLaborCostAllocation.${method}；写操作遵循prepare→submit→回查。`] },
  ]),
)
