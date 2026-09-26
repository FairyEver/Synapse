import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_RETIREMENT_SALARY_METHODS, reportRetirementSalaryCapabilities } from '../capabilities/report-retirement-salary.js'

const definitions = new Map(reportRetirementSalaryCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })
const amountNames = [
  ['enterpriseSalary', '企业工资'],
  ['heatingFee', '取暖费'],
  ['holidayAllowance', '节日补贴'],
  ['additionalInsurance', '附加保险'],
  ['subsidy', '补助'],
  ['transportFee', '交通费'],
  ['bookFee', '书报费'],
  ['laborFee', '工龄'],
  ['laundryFee', '洗理费'],
  ['medicineFee', '药费'],
  ['otherFee', '其他扣款'],
  ['actualAmount', '实发金额'],
] as const

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '退休人员工资记录ID；编辑、删除和创建汇总使用'),
  field('list[].useYearMonth', 'string | null', '工资月份，YYYY-MM'),
  field('list[].name', 'string | null', '退休人员姓名'),
  field('list[].idCard', 'string | null', '身份证号；敏感字段，按原值处理'),
  field('list[].organizationId', 'string | number | null', '组织ID'),
  field('list[].organizationName', 'string | null', '组织全路径快照'),
  ...amountNames.map(([name, label]) => field(`list[].${name}`, 'number | string | null', label)),
  field('list[].status', 'number | null', '明细状态：0未使用、1已使用'),
  field('list[].remark', 'string | null', '备注；页面编辑回显时可能带回'),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页退休人员工资记录'), field('total', 'number', '符合筛选条件的总记录数，用于翻页'), ...rowFields],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
}
const objectOutput: AiContract['output'] = { shape: 'object', fields: rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, '') })), empty: '后端没有返回详情对象时抛错，不用空对象代替。' }
const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [field('fileName', 'string', '服务端文件名；缺少响应文件名时使用页面默认名'), field('contentType', 'string | null', '响应Content-Type'), field('base64', 'string', '文件内容Base64'), field('byteLength', 'number', '原始文件字节数')],
  empty: '空文件响应会抛错。',
}
const idOutput: AiContract['output'] = { shape: 'string | number', fields: [field('$', 'string | number', '新建业务记录ID')], empty: '不会返回空业务ID。' }
const boolOutput: AiContract['output'] = { shape: 'boolean', fields: [field('$', 'boolean', '后端成功回执，必须为true')], empty: '不是true时抛错。' }
const voidOutput: AiContract['output'] = { shape: 'string | null', fields: [field('$', 'string | null', '导入接口返回的成功文案；无data时为null')], empty: '请求失败时抛错。' }

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`退休人员工资契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'enum' ? 'number' : parameter.kind === 'number' ? 'number' : parameter.kind === 'tree' ? 'string | number' : parameter.kind === 'text' ? 'string' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal 退休人员工资发放表页面、编辑弹窗或导入/创建汇总弹窗。',
    ...(parameter.options ? { options: parameter.options } : {}),
  }]))
}

const salaryPayloadFields = ['useYearMonth', 'name', 'idCard', 'organizationId', 'organizationName', ...amountNames.map(([name]) => name), 'status', 'remark']

function salaryInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  for (const [name, label] of amountNames) {
    const parameter = inputs[name]
    if (parameter) inputs[name] = { ...parameter, type: 'number | string | null', nullable: true, meaning: `${label}；Portal空输入按null提交`, constraints: ['数字、十进制字符串或null'] }
  }
  if (inputs.status) inputs.status = { ...inputs.status, type: 'number | null', nullable: true, meaning: '编辑详情回显的明细状态；通常原样透传，不要手工改写' }
  if (inputs.remark) inputs.remark = { ...inputs.remark, type: 'string | null', nullable: true, meaning: '编辑详情回显的备注；页面表单不单独编辑' }
  return inputs
}

function fileInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  if (inputs.base64) inputs.base64 = { ...inputs.base64, constraints: ['必须是非空标准Base64'] }
  return inputs
}

function summaryInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  if (inputs.staffIdList) inputs.staffIdList = { ...inputs.staffIdList, type: '(string | number)[]', meaning: '选中的未使用退休人员明细ID数组', constraints: ['至少一项', '不允许重复', 'ID必须来自当前status=0的列表记录'] }
  return inputs
}

function draftMapping (source = 'result.draft', fields = salaryPayloadFields): Record<string, string> {
  return Object.fromEntries(fields.map(name => [name, `${source}.${name}`]))
}

const writeIdempotency = '后端写接口没有requestId，SDK不添加服务端幂等键；请求完成或超时必须先按ID/月份/文件指纹回查，未确认前不得盲目重试。创建汇总还会把选中的明细状态改为1，不能重复提交同一批明细。'
const gaps = [
  '尚未在真实测试环境执行本页列表、详情、导入和写操作的浏览器/后端完整回查；当前证据来自Portal页面与弹窗源码、Java Controller/VO/Service/Mapper和离线请求断言。',
  '创建汇总接口没有本页可用的撤销/回滚端点；成功后会把明细标记为已使用，调用方必须先确认明细ID和月份。',
  '组织树、可用退休人员列表由Portal按当前用户权限加载；SDK不复制全量候选，ID和组织名称必须来自已核实的当前会话数据。',
]

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前用户在 /dashboard/report/retirement-salary 权限范围内的退休人员工资数据；使用platform实例并发送module-type=14。',
      '删除只允许当前列表行status=0；status=1表示已被汇总使用，Portal隐藏删除按钮且后端也拒绝。',
      '创建汇总是业务写入：后端创建汇总表、建立明细关系并将staffIdList对应明细改为status=1；没有安全的本页撤销动作。',
    ],
    effect: 'read',
    prerequisites: ['使用会话token和租户创建SDK；组织ID、明细ID和组织名称必须来自当前用户可见的页面数据。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: '返回结构校验通过；写入成功后按契约要求重新查询核对。',
    failures: ['非法ID、月份、必填文本、金额、状态、页码、页大小或文件在发请求前失败；401/403、网络和后端业务错误原样抛出。', '空分页不是权限判定；写请求成功或超时不等于独立落库证据。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-retirement-salary.ts', kind: 'implementation', note: '锁定Portal表单转换、删除状态门禁、multipart导入、模板下载和创建汇总载荷。' },
      { source: 'test/report-retirement-salary.test.ts', kind: 'test', note: '离线锁定Portal页面/弹窗、Java端点、请求体、状态权限和文件规则。' },
      { source: 'docs/pages/退休人员工资发放表.md', kind: 'reference', note: '记录字段、写入副作用、回查顺序和真实环境证据边界。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'report-retirement-salary-list': base('report-retirement-salary-list', '查询退休人员工资发放表。', pageOutput, ['按list展示年月、姓名、身份证号、组织、金额和status；total用于翻页。', '底部合计只针对当前页，不把分页结果当全量合计。']),
  'report-retirement-salary-get': base('report-retirement-salary-get', '读取退休人员工资编辑弹窗详情。', objectOutput, ['先用列表list[].id或已知记录ID调用get；结果用于编辑前核对，不把空响应当作存在。']),
  'report-retirement-salary-prepare-create': {
    ...base('report-retirement-salary-prepare-create', '准备新建退休人员工资发放草稿。', { shape: '{ draft: object }', fields: [field('draft', 'object', '按Portal字段生成的创建请求体'), ...rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, 'draft.') }))], empty: '非法输入不返回草稿。' }, ['检查draft中的年月、身份和组织快照后再向用户确认；用户取消时直接丢弃draft，不发请求。'], { effect: 'prepare', inputs: salaryInputsOf('report-retirement-salary-prepare-create'), steps: [{ role: 'required', when: '用户确认创建草稿', capabilityId: 'report-retirement-salary-create', mapping: draftMapping(), instruction: '逐字段把同一份draft交给create；不要省略金额字段。' }], completion: '得到无副作用创建草稿。' }),
  },
  'report-retirement-salary-create': {
    ...base('report-retirement-salary-create', '创建一条退休人员工资发放记录。', idOutput, ['保存返回的id；立即用get按id回查，确认组织、金额和status。'], { effect: 'write', inputs: salaryInputsOf('report-retirement-salary-create'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '返回新记录ID', capabilityId: 'report-retirement-salary-get', mapping: { id: 'result.$' }, instruction: '回查保存的字段；超时先回查再决定是否重试。' }] }),
  },
  'report-retirement-salary-prepare-update': {
    ...base('report-retirement-salary-prepare-update', '准备编辑退休人员工资发放草稿。', { shape: '{ draft: object }', fields: [field('draft', 'object', '按Portal字段生成的更新请求体'), ...rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, 'draft.') }))], empty: '非法输入不返回草稿。' }, ['先get确认当前记录和id，再修改字段；用户取消时丢弃draft。'], { effect: 'prepare', inputs: salaryInputsOf('report-retirement-salary-prepare-update'), steps: [{ role: 'required', when: '用户确认编辑草稿', capabilityId: 'report-retirement-salary-update', mapping: { id: 'result.draft.id', ...draftMapping() }, instruction: '逐字段把同一份完整draft交给update；不要用姓名代替id。' }], completion: '得到无副作用更新草稿。' }),
  },
  'report-retirement-salary-update': {
    ...base('report-retirement-salary-update', '更新一条退休人员工资发放记录。', boolOutput, ['成功或超时后用get核对id对应的年月、姓名、组织和金额；后端状态字段按传入值更新，不能用更新成功回执替代回查。'], { effect: 'write', inputs: salaryInputsOf('report-retirement-salary-update'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'report-retirement-salary-get', mapping: { id: 'args.id' }, instruction: '回查确认更新结果。' }] }),
  },
  'report-retirement-salary-prepare-remove': {
    ...base('report-retirement-salary-prepare-remove', '检查退休人员工资记录是否仍可删除。', { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待删除ID')], empty: 'status=1或缺少当前状态时失败。' }, ['currentStatus必须来自最新列表行；0才可继续，1表示记录已使用。用户取消时不发DELETE。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认删除草稿', capabilityId: 'report-retirement-salary-remove', mapping: { id: 'result.id', currentStatus: 'literal:0' }, instruction: '只提交prepare已验证为未使用的同一ID。' }], completion: '得到可供用户确认的删除ID。' }),
  },
  'report-retirement-salary-remove': {
    ...base('report-retirement-salary-remove', '删除一条未使用的退休人员工资发放记录。', boolOutput, ['删除成功或超时后用list按同一筛选回查记录变化；status=1必须在请求前拒绝。'], { effect: 'write', idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'report-retirement-salary-list', mapping: {}, instruction: '重新查询确认删除效果。' }] }),
  },
  'report-retirement-salary-download-template': base('report-retirement-salary-download-template', '下载退休人员工资导入模板。', fileOutput, ['保存非空文件；Portal固定请求fileName=退休人员工资模板。']),
  'report-retirement-salary-prepare-import': {
    ...base('report-retirement-salary-prepare-import', '在导入前校验退休人员工资文件。', { shape: '{ fileName, contentType, byteLength }', fields: [field('fileName', 'string', '原文件名'), field('contentType', 'string', '上传MIME类型'), field('byteLength', 'number', '文件字节数')], empty: '非法扩展名、Base64或空文件失败。' }, ['确认文件预览后把同一文件交给importExcel；取消时不发multipart请求。'], { effect: 'prepare', inputs: fileInputsOf('report-retirement-salary-prepare-import'), steps: [{ role: 'required', when: '用户确认导入文件', capabilityId: 'report-retirement-salary-import', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '使用同一份原始Base64文件提交multipart字段file。' }], completion: '得到非空文件预览。' }),
  },
  'report-retirement-salary-import': {
    ...base('report-retirement-salary-import', '导入退休人员工资明细文件。', voidOutput, ['请求成功后重新list核对导入行；后端按Excel的部门名称全路径匹配组织，未知组织会整体失败。'], { effect: 'write', inputs: fileInputsOf('report-retirement-salary-import'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'report-retirement-salary-list', mapping: {}, instruction: '重新查询并核对导入结果。' }] }),
  },
  'report-retirement-salary-prepare-create-summary': {
    ...base('report-retirement-salary-prepare-create-summary', '准备创建退休人员工资汇总表草稿。', { shape: '{ draft: object }', fields: [field('draft.organizationId', 'string | number', '组织ID'), field('draft.organizationName', 'string', '组织全路径快照'), field('draft.useYearMonth', 'string', '汇总工资月份'), field('draft.staffIdList', '(string | number)[]', '选中的未使用明细ID')], empty: '组织、月份或人员为空时失败。' }, ['逐项核对staffIdList；用户取消时只丢弃draft，因为服务端没有创建汇总前的占用动作。'], { effect: 'prepare', inputs: summaryInputsOf('report-retirement-salary-prepare-create-summary'), steps: [{ role: 'required', when: '用户确认创建汇总草稿', capabilityId: 'report-retirement-salary-create-summary', mapping: { organizationId: 'result.draft.organizationId', organizationName: 'result.draft.organizationName', useYearMonth: 'result.draft.useYearMonth', staffIdList: 'result.draft.staffIdList' }, instruction: '只提交确认过的组织、月份和未使用明细ID数组。' }], completion: '得到无副作用汇总草稿。' }),
  },
  'report-retirement-salary-create-summary': {
    ...base('report-retirement-salary-create-summary', '创建退休人员工资汇总表并占用选中的明细。', idOutput, ['保存返回的汇总表ID；用reportRetirementSalarySummary.detail核对汇总人员和明细status=1。该动作没有安全的本页撤销接口，不能盲目重试。'], { effect: 'write', inputs: summaryInputsOf('report-retirement-salary-create-summary'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '返回汇总表ID', capabilityId: 'report-retirement-salary-summary-detail', mapping: { summaryId: 'result.$' }, instruction: '回查汇总明细，确认汇总人员与明细状态。' }] }),
  },
}

export const REPORT_RETIREMENT_SALARY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_RETIREMENT_SALARY_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_RETIREMENT_SALARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_RETIREMENT_SALARY_METHODS).map(([id, method]) => [`reportRetirementSalary.${method}`, REPORT_RETIREMENT_SALARY_AI_CONTRACTS[id]!]))
