import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_TEMPORARY_SALARY_METHODS, reportTemporarySalaryCapabilities } from '../capabilities/report-temporary-salary.js'

const definitions = new Map(reportTemporarySalaryCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })
const amountNames = [
  ['attendanceDays', '出勤天数'],
  ['dailyValue', '日值'],
  ['attendanceSalary', '出勤工资'],
  ['otherSalary', '其他工资'],
  ['grossSalary', '应发工资'],
  ['individualIncomeTax', '个税'],
  ['netSalary', '实发工资'],
] as const

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '临时工工资发放记录ID；编辑、删除时使用'),
  field('list[].useYearMonth', 'string | null', '工资月份，YYYY-MM'),
  field('list[].name', 'string | null', '临时工姓名'),
  field('list[].idCard', 'string | null', '身份证号；敏感字段，按原值处理且不写日志'),
  field('list[].organizationId', 'string | number | null', '末级组织ID'),
  field('list[].organizationName', 'string | null', '组织全路径名称快照'),
  field('list[].entryDate', 'string | null', '入场日期，YYYY-MM-DD'),
  field('list[].bankAccount', 'string | null', '银行卡号；敏感字段，按原值处理且不写日志'),
  field('list[].openingBank', 'string | null', '开户行'),
  ...amountNames.map(([name, label]) => field(`list[].${name}`, 'number | string | null', `${label}；服务端BigDecimal按原值返回`)),
  field('list[].status', 'number | null', '明细状态：0未使用、1已使用', { values: { '0': '未使用', '1': '已使用' } }),
  field('list[].createTime', 'string | null', '创建时间；列表不展示，后端详情可能返回'),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页临时工工资发放记录'), field('total', 'number', '符合筛选条件的总记录数，用于翻页'), ...rowFields],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
}
const objectOutput: AiContract['output'] = { shape: 'object', fields: rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, '') })), empty: '后端没有返回详情对象时抛错，不用空对象代替。' }
const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [field('fileName', 'string', '响应文件名；缺少文件名时使用页面默认名'), field('contentType', 'string | null', '响应Content-Type'), field('base64', 'string', '文件内容Base64'), field('byteLength', 'number', '原始文件字节数；必须大于0')],
  empty: '空文件响应会抛错。',
}
const idOutput: AiContract['output'] = { shape: 'string | number', fields: [field('$', 'string | number', '新建临时工工资记录ID')], empty: '不会返回空业务ID。' }
const boolOutput: AiContract['output'] = { shape: 'boolean', fields: [field('$', 'boolean', '后端成功回执，必须为true')], empty: '不是true时抛错。' }
const voidOutput: AiContract['output'] = { shape: 'string | null', fields: [field('$', 'string | null', '导入接口成功文案；无data时为null')], empty: '请求失败时抛错。' }
const idListOutput: AiContract['output'] = { shape: '(string | number)[]', fields: [field('$', '(string | number)[]', '本次按组织/月份分组创建的汇总表ID数组')], empty: '返回空ID数组时抛错。' }

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`临时工工资发放契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'enum' ? 'number' : parameter.kind === 'number' ? 'number' : parameter.kind === 'tree' ? 'string | number' : parameter.kind === 'date' ? 'string' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal临时工工资发放列表、编辑弹窗、导入或创建汇总弹窗；参数投影按页面提交规则执行。',
    ...(parameter.options ? { options: parameter.options } : {}),
  }]))
}

const salaryPayloadFields = ['useYearMonth', 'name', 'idCard', 'organizationId', 'organizationName', 'entryDate', 'bankAccount', 'openingBank', ...amountNames.map(([name]) => name), 'status']

function salaryInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  for (const [name, label] of amountNames) {
    const parameter = inputs[name]
    if (parameter) inputs[name] = { ...parameter, type: 'number | string | null', nullable: true, meaning: `${label}；可选字段按Portal空输入提交null，必填金额不能省略`, constraints: ['非负数字或十进制字符串', '最多2位小数'] }
  }
  if (inputs.entryDate) inputs.entryDate = { ...inputs.entryDate, type: 'string | null', nullable: true, format: 'YYYY-MM-DD', omitted: '发送null' }
  if (inputs.status) inputs.status = { ...inputs.status, type: 'number | null', nullable: true, meaning: '编辑详情回显的明细状态；新建时后端强制为0，编辑必须为0', constraints: ['只能是0或1', 'update只能提交0'] }
  return inputs
}

function fileInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  if (inputs.base64) inputs.base64 = { ...inputs.base64, constraints: ['必须是非空标准Base64'] }
  return inputs
}

function summaryInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  if (inputs.staffIdList) inputs.staffIdList = { ...inputs.staffIdList, type: '(string | number)[]', meaning: '选中的未使用临时工明细ID数组；服务端会按年月和组织分组创建汇总', constraints: ['至少一项', '不允许重复', 'ID必须来自当前status=0的列表记录'] }
  return inputs
}

const writeIdempotency = '后端写接口没有requestId，SDK不添加服务端幂等键；请求完成或超时必须先按ID、筛选条件或文件指纹回查，未确认前不得盲目重试。创建汇总会把选中的明细状态改为1，不能重复提交同一批明细。'
const gaps = [
  '尚未在真实测试环境执行本页列表、详情、模板、导入、创建、编辑、删除和创建汇总的浏览器/后端完整回查；当前证据来自Portal页面与弹窗源码、Java Controller/VO/Service/Mapper和离线请求断言。',
  '列表查询使用getOrgIdListByModuleType并叠加roleOrganizationIdList；Java创建、编辑、删除和导入源码只校验组织存在/末级或Excel全路径，不独立复用同一模块组织权限。SDK要求调用方使用当前角色组织树候选，但不能把它说成服务端写权限证明。',
  '创建汇总接口按年月/组织分组返回多个汇总ID，并将明细status改为1；本页没有安全的撤销/回滚端点，提交前必须确认ID列表。',
]

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前用户在 /dashboard/report/temporary-salary 权限范围内的临时工工资数据；使用platform实例并发送module-type=14。',
      '列表查询的组织范围来自getOrgIdListByModuleType并写入roleOrganizationIdList；空列表不是权限绕过。创建、编辑、删除和导入的Java源码没有同样的模块组织范围校验，必须使用当前角色组织树/列表中已核实的组织和记录ID。',
      'Portal隐藏status=1记录的编辑、删除按钮；SDK的update/remove也必须以最新status为依据，status=1在请求前失败。',
      '没有安全的服务端cancel端点：用户取消prepare草稿、文件预览或确认框时只丢弃本地结果，不发写请求；创建汇总成功后不能用本页撤销。',
    ],
    effect: 'read',
    prerequisites: ['使用会话token和租户创建SDK；组织ID、明细ID和组织名称必须来自当前用户可见且已核实的页面候选。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: '返回结构校验通过；只读结果按list/total翻页，写入成功后按契约要求独立回查。',
    failures: ['非法ID、月份、日期、必填文本、金额、状态、页码、页大小或文件在发请求前失败；401/403、网络和后端业务错误原样抛出。', '空分页不是权限判定；写请求成功或超时不等于独立落库证据。', 'idCard和bankAccount属于敏感字段，不应写入日志或无关输出。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-temporary-salary.ts', kind: 'implementation', note: '锁定Portal列表/编辑/导入/汇总表单、写入载荷、状态门禁、文件处理和分页响应。' },
      { source: 'test/report-temporary-salary.test.ts', kind: 'test', note: '逐项锁定Portal页面/弹窗、Java端点/校验/组织范围和坏输入反例。' },
      { source: 'docs/pages/临时工工资发放表.md', kind: 'reference', note: '记录字段、表单规则、写入副作用、取消边界、权限差异和真实环境证据边界。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'report-temporary-salary-list': base('report-temporary-salary-list', '查询临时工工资发放表。', pageOutput, ['按list展示年月、姓名、身份证号、组织、入场日期、银行卡号、开户行、出勤与工资金额和status；total用于翻页。', '底部合计只针对当前页，不把分页结果当全量合计。']),
  'report-temporary-salary-get': base('report-temporary-salary-get', '读取临时工工资编辑弹窗详情。', objectOutput, ['先用列表list[].id或已知记录ID调用get；结果用于编辑前核对，不把空响应当作存在。', '身份证号和银行卡号只在确有业务需要时展示，不写日志。']),
  'report-temporary-salary-prepare-create': {
    ...base('report-temporary-salary-prepare-create', '准备新建临时工工资发放草稿。', { shape: '{ draft: object }', fields: [field('draft', 'object', '按Portal字段生成的创建请求体'), ...rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, 'draft.') }))], empty: '非法输入不返回草稿。' }, ['检查年月、身份、末级组织快照、银行卡和必填金额后再向用户确认；用户取消时丢弃draft，不发请求。'], { effect: 'prepare', inputs: salaryInputsOf('report-temporary-salary-prepare-create'), steps: [{ role: 'required', when: '用户确认创建草稿', capabilityId: 'report-temporary-salary-create', mapping: Object.fromEntries(salaryPayloadFields.map(name => [name, `result.draft.${name}`])), instruction: '逐字段把同一份draft交给create；不要省略必填金额字段。' }], completion: '得到无副作用创建草稿。' }),
  },
  'report-temporary-salary-create': {
    ...base('report-temporary-salary-create', '创建一条临时工工资发放记录。', idOutput, ['保存返回的id；立即用get按id回查年月、姓名、末级组织、金额和status=0。'], { effect: 'write', inputs: salaryInputsOf('report-temporary-salary-create'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'report-temporary-salary-get', mapping: { id: 'result.$' }, instruction: '回查保存的字段；超时先回查再决定是否重试。' }] }),
  },
  'report-temporary-salary-prepare-update': {
    ...base('report-temporary-salary-prepare-update', '准备编辑临时工工资发放草稿。', { shape: '{ draft: object }', fields: [field('draft', 'object', '按Portal字段生成的更新请求体'), ...rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, 'draft.') }))], empty: '缺少id、status不是0或其他非法输入时失败。' }, ['先get确认当前记录和status；只有status=0才可编辑；用户取消时丢弃draft，不发请求。'], { effect: 'prepare', inputs: salaryInputsOf('report-temporary-salary-prepare-update'), steps: [{ role: 'required', when: '用户确认编辑草稿', capabilityId: 'report-temporary-salary-update', mapping: { id: 'result.draft.id', ...Object.fromEntries(salaryPayloadFields.map(name => [name, `result.draft.${name}`])) }, instruction: '把同一份、且status=0的完整draft交给update；不要用姓名代替id。' }], completion: '得到无副作用更新草稿。' }),
  },
  'report-temporary-salary-update': {
    ...base('report-temporary-salary-update', '更新一条未使用的临时工工资发放记录。', boolOutput, ['成功或超时后用get核对id对应的年月、姓名、组织和金额；status=1在请求前必须拒绝，不能以true回执替代回查。'], { effect: 'write', inputs: salaryInputsOf('report-temporary-salary-update'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'report-temporary-salary-get', mapping: { id: 'args.id' }, instruction: '回查确认更新结果。' }] }),
  },
  'report-temporary-salary-prepare-remove': {
    ...base('report-temporary-salary-prepare-remove', '检查临时工工资记录是否仍可删除。', { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待删除记录ID')], empty: 'status=1或缺少当前状态时失败。' }, ['currentStatus必须来自最新列表行；只有0才可继续；用户取消时不发DELETE。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认删除草稿', capabilityId: 'report-temporary-salary-remove', mapping: { id: 'result.id', currentStatus: 'literal:0' }, instruction: '只提交prepare已验证为未使用的同一ID。' }], completion: '得到可供用户确认的删除ID。' }),
  },
  'report-temporary-salary-remove': {
    ...base('report-temporary-salary-remove', '删除一条未使用的临时工工资发放记录。', boolOutput, ['删除成功或超时后用list或get回查记录变化；status=1必须在请求前拒绝。'], { effect: 'write', idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'report-temporary-salary-list', mapping: {}, instruction: '重新查询确认删除效果；不要只看true回执。' }] }),
  },
  'report-temporary-salary-download-template': base('report-temporary-salary-download-template', '下载临时工工资导入模板。', fileOutput, ['保存非空文件；Portal固定请求fileName=临时工工资模板。']),
  'report-temporary-salary-prepare-import': {
    ...base('report-temporary-salary-prepare-import', '在导入前校验临时工工资文件。', { shape: '{ fileName, contentType, byteLength }', fields: [field('fileName', 'string', '原文件名'), field('contentType', 'string', '上传MIME类型'), field('byteLength', 'number', '文件字节数')], empty: '非法扩展名、Base64或空文件失败。' }, ['确认文件预览后把同一文件交给importExcel；用户取消时只丢弃预览，不发multipart请求。'], { effect: 'prepare', inputs: fileInputsOf('report-temporary-salary-prepare-import'), steps: [{ role: 'required', when: '用户确认导入文件', capabilityId: 'report-temporary-salary-import', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '使用同一份原始Base64文件提交multipart字段file。' }], completion: '得到非空文件预览。' }),
  },
  'report-temporary-salary-import': {
    ...base('report-temporary-salary-import', '导入临时工工资明细文件。', voidOutput, ['请求成功后重新list核对导入行；后端按Excel的部门全路径匹配租户组织，未知组织或非末级组织会整体失败。'], { effect: 'write', inputs: fileInputsOf('report-temporary-salary-import'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'report-temporary-salary-list', mapping: {}, instruction: '重新查询并核对导入结果；文件指纹未核实前不要盲目重试。' }] }),
  },
  'report-temporary-salary-prepare-create-summary': {
    ...base('report-temporary-salary-prepare-create-summary', '准备创建临时工工资汇总表草稿。', { shape: '{ draft: object }', fields: [field('draft.organizationId', 'string | number', '组织ID'), field('draft.organizationName', 'string', '组织名称'), field('draft.useYearMonth', 'string', '汇总工资月份'), field('draft.staffIdList', '(string | number)[]', '选中的未使用临时工明细ID')], empty: '组织、月份或人员为空时失败。' }, ['逐项核对staffIdList均来自当前status=0列表；用户取消时只丢弃draft，服务端没有创建前占用动作。'], { effect: 'prepare', inputs: summaryInputsOf('report-temporary-salary-prepare-create-summary'), steps: [{ role: 'required', when: '用户确认创建汇总草稿', capabilityId: 'report-temporary-salary-create-summary', mapping: { organizationId: 'result.draft.organizationId', organizationName: 'result.draft.organizationName', useYearMonth: 'result.draft.useYearMonth', staffIdList: 'result.draft.staffIdList' }, instruction: '只提交确认过的组织、月份和未使用明细ID数组。' }], completion: '得到无副作用汇总草稿。' }),
  },
  'report-temporary-salary-create-summary': {
    ...base('report-temporary-salary-create-summary', '按选择的临时工明细创建临时工工资汇总表。', idListOutput, ['返回一个或多个汇总表ID，因为服务端会按年月/组织分组；逐个用reportTemporarySalarySummary.detail回查明细，确认选中人员已关联且status=1。没有安全撤销，不能盲目重试。'], { effect: 'write', inputs: summaryInputsOf('report-temporary-salary-create-summary'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '返回汇总表ID数组', capabilityId: 'report-temporary-salary-summary-detail', mapping: { summaryId: 'result.$' }, instruction: '遍历result.$中的每个汇总表ID逐个回查详情，确认明细关联和已使用状态。' }] }),
  },
}

export const REPORT_TEMPORARY_SALARY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_TEMPORARY_SALARY_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_TEMPORARY_SALARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_TEMPORARY_SALARY_METHODS).map(([id, method]) => [`reportTemporarySalary.${method}`, REPORT_TEMPORARY_SALARY_AI_CONTRACTS[id]!]))
