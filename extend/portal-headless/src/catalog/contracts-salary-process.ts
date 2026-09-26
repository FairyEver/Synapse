import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALARY_PROCESS_METHODS, salaryProcessCapabilities } from '../capabilities/salary-process.js'

const definitions = new Map(salaryProcessCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })
const idValues = { '-1': '已停薪', '0': '未起薪', '1': '已起薪' }
const staffStatusValues = { '1': '在职', '2': '离职', '3': '退休', '4': '返聘', '5': '在编不在岗' }

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '薪资办理记录ID；编辑、停薪和批量调整使用；未起薪员工可能为空'),
  field('list[].transactTime', 'string | null', '起薪日期，YYYY-MM-DD'),
  field('list[].staffId', 'string | number | null', '员工主键ID；不是薪资办理记录ID'),
  field('list[].staffCode', 'string | number | null', '员工工号；导出选中行使用此字段'),
  field('list[].staffName', 'string | null', '员工姓名'),
  field('list[].idCard', 'string | null', '身份证号；敏感字段，按原值消费且不写日志'),
  field('list[].organization', 'string | number | null', '起薪组织ID'),
  field('list[].organizationName', 'string | null', '员工当前所属组织全路径'),
  field('list[].startOrganizationName', 'string | null', '本条薪资记录的起薪组织名称'),
  field('list[].postName', 'string | null', '岗位名称'),
  field('list[].employmentType', 'number | null', '用工类型：1全日制、2非全日制', { values: { '1': '全日制用工', '2': '非全日制用工' } }),
  field('list[].ledgerId', 'string | number | null', '薪资账套ID'),
  field('list[].salaryLevel', 'string | number | null', '薪资等级ID'),
  field('list[].salaryLevelName', 'string | null', '薪资等级名称'),
  field('list[].salaryLevelStandard', 'number | string | null', '薪资等级标准；按服务端原值消费，不擅自换算'),
  field('list[].ledgerName', 'string | null', '薪资账套名称'),
  field('list[].cardIssuingBank', 'string | null', '开户行；敏感关联字段'),
  field('list[].bankAccount', 'string | null', '银行账号；敏感字段，按原值消费且不写日志'),
  field('list[].status', 'number | null', '薪资办理状态', { values: idValues }),
  field('list[].legalPersonId', 'string | number | null', '纳税单位法人ID'),
  field('list[].legalPersonName', 'string | null', '纳税单位名称'),
  field('list[].costCenterId', 'string | number | null', '成本中心ID'),
  field('list[].costCenterName', 'string | null', '成本中心名称'),
  field('list[].staffStatus', 'number | null', '员工在职状态字典值', { values: staffStatusValues }),
  field('list[].entryTime', 'string | null', '入职时间；服务端日期时间原值'),
  field('list[].salaryCategory', 'string | number | null', '薪制类别：1时薪、2日薪、3月薪、4年薪', { values: { '1': '时薪', '2': '日薪', '3': '月薪', '4': '年薪' } }),
  field('list[].wage', 'number | string | null', '基本工资标准；服务端BigDecimal原值'),
  field('list[].description', 'string | null', '起薪情况说明'),
  field('list[].isDel', 'number | null', '逻辑删除标记：0未删除、1已删除', { values: { '0': '未删除', '1': '已删除' } }),
  field('list[].creator', 'string | number | null', '创建人ID'),
  field('list[].createTime', 'string | null', '创建时间；服务端日期时间原值'),
  field('list[].updater', 'string | number | null', '修改人ID'),
  field('list[].updateTime', 'string | null', '操作时间；服务端日期时间原值'),
  field('list[].updaterName', 'string | null', '操作人姓名'),
  field('list[].stopTime', 'string | null', '停薪时间；服务端日期时间原值'),
  field('list[].stopDescription', 'string | null', '停薪情况说明'),
  field('list[].emptyDate', 'string | null', '清纳税开始时间；后端存储原值'),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页薪资办理记录'), field('total', 'number', '符合筛选条件的总记录数，用于翻页'), ...rowFields],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
}
const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, '') })),
  empty: '详情响应缺少对象时抛错，不用空对象代替。',
}
const optionOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '页面下拉候选'), field('[].id', 'string | number', '候选ID；提交时使用此值'), field('[].name', 'string', '候选名称；仅用于展示'), field('[].code', 'string | null', '成本中心编码；候选可能没有此字段')],
  empty: '[]表示当前会话没有可用候选；不能用名称代替ID。',
}
const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [field('fileName', 'string', '响应文件名；缺少Content-Disposition时使用页面默认名'), field('contentType', 'string | null', '响应Content-Type'), field('base64', 'string', '文件内容Base64'), field('byteLength', 'number', '原始文件字节数；必须大于0')],
  empty: '空文件响应会抛错。',
}
const voidOutput: AiContract['output'] = { shape: 'null | undefined', fields: [field('$', 'null | undefined', 'Portal CommonResult成功回执没有可消费业务数据')], empty: '请求失败时抛错。' }
const clearOutput: AiContract['output'] = { shape: 'string | null', fields: [field('$', 'string | null', '批量清空纳税时间成功回执；后端成功时通常为空字符串或null')], empty: '请求失败时抛错。' }
const checkOutput: AiContract['output'] = { shape: 'number', fields: [field('$', 'number', '起薪校验码：0可继续、1本记录已起薪、2其他组织已起薪', { values: { '0': '可继续', '1': '本记录已起薪', '2': '其他组织已起薪' } })], empty: '响应不是0、1、2时抛错。' }
const previewOutput: AiContract['output'] = { shape: '{ fileName, contentType, byteLength }', fields: [field('fileName', 'string', '原文件名'), field('contentType', 'string', '上传MIME类型'), field('byteLength', 'number', '文件字节数；必须大于0')], empty: '非法扩展名、Base64或空文件失败。' }
const eligibilityOutput: AiContract['output'] = {
  shape: '{ processedIds, processedStaffCodes, processedCount, eligibleStaffIds, eligibleStaffCodes, excludedStaffList }',
  fields: [
    field('processedIds', '(string | number)[]', '本次批量起薪实际处理的业务ID；当前服务端可能为空数组'),
    field('processedStaffCodes', '(string | number)[]', '本次实际起薪成功的员工工号'),
    field('processedCount', 'number', '本次实际处理成功数量'),
    field('eligibleStaffIds', '(string | number)[]', '通过资格检查的员工ID'),
    field('eligibleStaffCodes', '(string | number)[]', '通过资格检查的员工工号'),
    field('excludedStaffList', 'object[]', '被排除的员工及原因'),
    field('excludedStaffList[].staffId', 'string | number | null', '被排除员工ID'),
    field('excludedStaffList[].staffCode', 'string | number | null', '被排除员工工号'),
    field('excludedStaffList[].staffName', 'string | null', '被排除员工姓名'),
    field('excludedStaffList[].status', 'number | null', '员工状态'),
    field('excludedStaffList[].downtimePay', 'string | null', '停薪日期'),
    field('excludedStaffList[].businessDate', 'string | null', '资格判断业务日期'),
    field('excludedStaffList[].reasonCode', 'string | null', '排除原因编码'),
    field('excludedStaffList[].reason', 'string | null', '排除原因文本'),
  ],
  empty: '没有被排除人员时excludedStaffList=[]；不能只看processedCount判断每行结果。',
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`薪资办理契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'enum' ? 'number' : parameter.kind === 'number' ? 'number' : parameter.kind === 'tree' ? 'string | number' : parameter.kind === 'date' ? 'string' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal薪资办理列表、编辑/起薪页、停薪弹窗或批量弹窗；参数投影按页面真实提交规则执行。',
    ...(parameter.options ? { options: parameter.options } : {}),
  }]))
}

function formInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  for (const name of ['id', 'organization', 'ledgerId', 'legalPersonId', 'costCenterId', 'salaryLevel', 'creator', 'updater']) {
    if (inputs[name]) inputs[name] = { ...inputs[name], type: 'string | number', nullable: true }
  }
  if (inputs.staffCode) inputs.staffCode = { ...inputs.staffCode, type: 'string | number', nullable: true }
  if (inputs.status) inputs.status = { ...inputs.status, type: 'number | null', nullable: true }
  if (inputs.salaryCategory) inputs.salaryCategory = { ...inputs.salaryCategory, type: 'string | number | null', nullable: true }
  if (inputs.wage) inputs.wage = { ...inputs.wage, type: 'number | string | null', nullable: true }
  if (inputs.description) inputs.description = { ...inputs.description, constraints: ['必填', '最多200字'] }
  if (inputs.transactTime) inputs.transactTime = { ...inputs.transactTime, format: 'YYYY-MM-DD', constraints: ['后端起薪接口强制非空'] }
  return inputs
}

function updateFormInputsOf (id: string): Record<string, AiParameter> {
  const inputs = formInputsOf(id)
  if (inputs.id) inputs.id = { ...inputs.id, required: true, nullable: false }
  if (inputs.status) inputs.status = { ...inputs.status, type: 'number', required: true, nullable: false, constraints: ['必须为1（已起薪）'] }
  if (inputs.staffCode) inputs.staffCode = { ...inputs.staffCode, required: false }
  return inputs
}

function activeSelectionInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  if (inputs.idList) inputs.idList = { ...inputs.idList, type: '(string | number)[]', constraints: ['非空', '不能重复', '必须来自当前列表选中行'] }
  if (inputs.currentStatuses) inputs.currentStatuses = { ...inputs.currentStatuses, type: 'number[]', constraints: ['与idList等长', '每项必须为1'] }
  for (const name of ['legalPersonId', 'costCenterId']) if (inputs[name]) inputs[name] = { ...inputs[name], type: 'string | number' }
  if (inputs.emptyDate) inputs.emptyDate = { ...inputs.emptyDate, type: 'string', format: 'YYYY-MM' }
  return inputs
}

function fileInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  if (inputs.base64) inputs.base64 = { ...inputs.base64, constraints: ['必须是非空标准Base64'] }
  return inputs
}

const formPayloadNames = ['id', 'transactTime', 'staffCode', 'organization', 'ledgerId', 'status', 'legalPersonId', 'costCenterId', 'salaryCategory', 'wage', 'salaryLevel', 'description', 'isDel', 'creator', 'createTime', 'updater', 'updateTime', 'stopTime', 'stopDescription', 'emptyDate']
const baseBoundaries = [
  '只操作当前用户在 /dashboard/salary/process 权限范围内的薪资办理页面；所有能力使用platform实例并发送module-type=14。',
  '列表查询先由Java通过getRoleOrganizationTree得到角色可见组织：未选择orgIds时服务端替换为全部角色组织，已选择时与角色组织取交集；空交集直接返回空页，不是权限绕过。',
  '页面批量调整按钮只在选中行全部为status=1时打开；SDK的prepare和submit都要求currentStatuses与idList等长且全部为1，不能把未起薪或已停薪行提交给批量调整。',
  'Java写接口没有在源码中显式复用列表的角色组织交集；SDK只允许使用当前列表/详情已核实的ID，最终写权限、员工资格和数据范围仍由服务端裁决。',
  '没有安全的服务端cancel端点：用户取消prepare草稿或文件确认时只丢弃本地结果，不发写请求；批量起薪/停薪和起薪/停薪没有本页回滚能力。',
]
const writeIdempotency = 'Portal写接口没有requestId，SDK不添加伪造幂等键；请求完成或超时后必须按记录ID/工号、原筛选条件或文件指纹回查，未确认前不得盲目重试。'
const gaps = [
  '尚未在真实测试环境执行本页列表、候选、起薪、编辑、停薪、批量调整、导出、模板和Excel导入的完整浏览器回查；当前证据来自固定Portal源码、Java源码、Mapper与离线请求断言。',
  '批量起薪服务会返回部分成功/排除结果，批量停薪成功时没有逐行结果；调用方必须重新查询页面核对，不能只把HTTP成功当作业务证据。',
]

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: baseBoundaries,
    effect: 'read',
    prerequisites: ['使用会话token和tenantId创建SDK；组织、账套、法人、成本中心、薪资等级和记录ID必须来自当前用户可见且已核实的Portal候选或列表结果。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: '响应结构校验通过；写操作还必须按契约步骤独立回查。',
    failures: [
      '非法ID、状态、日期、月份、必填文本、分页、批量选择或文件在发请求前失败；401/403、网络和后端业务错误原样抛出。',
      '空分页不是权限判定；写请求没有抛错不等于数据已按预期落库。',
      '身份证号、银行账号等敏感字段不写入日志或无关输出。',
    ],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/salary-process.ts', kind: 'implementation', note: '锁定薪资办理页面请求、候选、表单投影、状态门禁、文件处理和响应校验。' },
      { source: 'test/salary-process.test.ts', kind: 'test', note: '逐页锁定Portal列表/编辑/弹窗源码、Java Controller/DTO/Service/Mapper和坏输入反例。' },
      { source: 'docs/pages/薪资办理.md', kind: 'reference', note: '记录页面四件套、表单提交规则、权限范围、取消边界和证据状态。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'salary-process-list': base('salary-process-list', '查询薪资办理列表。', pageOutput, ['按list逐行消费员工、组织、账套、纳税单位、成本中心、起薪/停薪状态和时间；total只用于分页。', 'status=0的Java查询还会结合businessDate和员工在职/停薪日期计算“未起薪”范围；不要把status=0简单理解为数据库status固定为0。']),
  'salary-process-get': base('salary-process-get', '读取一条薪资办理的起薪或编辑表单详情。', detailOutput, ['列表行有id时按id读取；未起薪行id为空时按staffCode读取。', '把详情结果作为prepareStart或prepareUpdate的表单来源；不要用展示名称替代账套、法人、成本中心和薪资等级ID。']),
  'salary-process-ledger-options': base('salary-process-ledger-options', '读取薪资办理编辑页的薪资账套候选。', optionOutput, ['把候选id填入ledgerId；候选来自getWebLedgerList，服务端按管理员/角色授权账套返回。']),
  'salary-process-legal-person-options': base('salary-process-legal-person-options', '读取薪资办理表单的纳税单位候选。', optionOutput, ['把候选id填入legalPersonId；不要用法人名称或superOrganizationId代替id。']),
  'salary-process-cost-center-options': base('salary-process-cost-center-options', '读取薪资办理表单的成本中心候选。', optionOutput, ['把候选id填入costCenterId；code只用于展示，不能替代id。']),
  'salary-process-salary-level-options': base('salary-process-salary-level-options', '读取薪资办理表单的薪资等级候选。', optionOutput, ['把候选id填入salaryLevel；页面允许清空该字段。']),
  'salary-process-check-start': { ...base('salary-process-check-start', '在打开起薪表单前检查员工是否可以起薪。', checkOutput, ['只有返回0才继续读取详情并让用户确认起薪；返回1表示本记录已起薪，返回2表示其他组织已有起薪记录。'], { inputs: inputsOf('salary-process-check-start'), completion: '得到0、1或2并按含义决定是否继续；非0不能绕过直接起薪。' }), steps: [{ role: 'optional', when: '返回0且需要打开表单', capabilityId: 'salary-process-get', mapping: { id: 'args.id' }, instruction: '有id按id读取；无id时用列表staffCode调用get。' }] },
  'salary-process-prepare-start': {
    ...base('salary-process-prepare-start', '准备起薪表单草稿，不发起薪请求。', { shape: '{ draft: object }', fields: [field('draft', 'object', '按Portal表单与Java SalaryTransactDTO生成的起薪请求体'), ...rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, 'draft.') }))], empty: '非法字段、缺少账套/法人/成本中心/起薪日期/工号或说明时失败。' }, ['先调用checkStart；展示draft供用户确认，取消时丢弃draft，不发POST。'], { effect: 'prepare', inputs: formInputsOf('salary-process-prepare-start'), steps: [{ role: 'required', when: '用户确认起薪', capabilityId: 'salary-process-start', mapping: Object.fromEntries(formPayloadNames.map(name => [name, `result.draft.${name}`])), instruction: '把同一份draft提交给start；不要跳过checkStart或用名称替代ID。' }, { role: 'cancel', when: '用户取消起薪', instruction: '丢弃draft，不调用写接口。' }], completion: '获得无副作用起薪请求体。' }) },
  'salary-process-start': { ...base('salary-process-start', '提交一条薪资办理起薪。', voidOutput, ['成功或超时后按id或staffCode重新get/list，确认status=1、organization为员工当前组织且起薪字段落库。'], { effect: 'write', inputs: formInputsOf('salary-process-start'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-process-get', mapping: { id: 'args.id', staffCode: 'args.staffCode' }, instruction: '优先按记录ID回查；新建记录没有id时按staffCode查询列表/详情确认status=1。' }] }) },
  'salary-process-prepare-update': {
    ...base('salary-process-prepare-update', '准备编辑已起薪记录的表单草稿，不发更新请求。', { shape: '{ draft: object }', fields: [field('draft', 'object', '按Portal详情回显并校验的更新请求体'), ...rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, 'draft.') }))], empty: '缺少id、status不是1、必填候选或说明时失败。' }, ['先get确认最新详情且status=1；取消时丢弃draft，不发PUT。'], { effect: 'prepare', inputs: updateFormInputsOf('salary-process-prepare-update'), steps: [{ role: 'required', when: '用户确认编辑', capabilityId: 'salary-process-update', mapping: Object.fromEntries(formPayloadNames.map(name => [name, `result.draft.${name}`])), instruction: '只提交同一条且status=1的详情草稿；服务端会忽略organization和staffCode的修改。' }, { role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不调用写接口。' }], completion: '获得无副作用编辑请求体。' }) },
  'salary-process-update': { ...base('salary-process-update', '更新一条已起薪的薪资办理记录。', voidOutput, ['成功或超时后按id回查账套、纳税单位、成本中心、薪制类别、薪资等级、起薪日期和说明。', '后端edit会把organization和staffCode置空后再更新，调用方不要把这次请求理解成可修改员工归属。'], { effect: 'write', inputs: updateFormInputsOf('salary-process-update'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-process-get', mapping: { id: 'args.id' }, instruction: '回查同一id确认修改结果；status不是1时不重试。' }] }) },
  'salary-process-prepare-stop': {
    ...base('salary-process-prepare-stop', '准备单条停薪草稿，不发停薪请求。', { shape: '{ draft: { idList, stopTime, stopDescription } }', fields: [field('draft.idList', '(string | number)[]', '只含待停薪记录ID'), field('draft.stopTime', 'string', '停薪日期，YYYY-MM-DD'), field('draft.stopDescription', 'string', '停薪说明')], empty: '缺少ID、停薪日期或说明时失败。' }, ['只对列表最新status=1的记录准备；取消时丢弃draft，不发PUT。'], { effect: 'prepare', inputs: inputsOf('salary-process-prepare-stop'), steps: [{ role: 'required', when: '用户确认停薪', capabilityId: 'salary-process-stop', mapping: { id: 'args.id', stopTime: 'result.draft.stopTime', stopDescription: 'result.draft.stopDescription' }, instruction: '使用同一记录ID提交；停薪日期早于当前北京时间日期会立即变为-1，未来日期仍保持1并由服务端排程。' }, { role: 'cancel', when: '用户取消停薪', instruction: '丢弃draft，不调用写接口。' }], completion: '获得无副作用停薪请求体。' }) },
  'salary-process-stop': { ...base('salary-process-stop', '停薪一条已起薪的薪资办理记录。', voidOutput, ['成功或超时后按id回查status、stopTime和stopDescription；未来停薪日期的记录在到期前仍可能是status=1。'], { effect: 'write', inputs: inputsOf('salary-process-stop'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-process-get', mapping: { id: 'args.id' }, instruction: '回查同一id；若停薪日期为未来，核对stopTime而不是要求status立即变为-1。' }] }) },
  'salary-process-prepare-edit-legal-person': {
    ...base('salary-process-prepare-edit-legal-person', '准备批量调整纳税单位草稿。', { shape: '{ draft: { legalPersonId, idList } }', fields: [field('draft.legalPersonId', 'string | number', '目标纳税单位ID'), field('draft.idList', '(string | number)[]', '选中已起薪记录ID')], empty: '选中为空、状态不是全部1、ID重复或法人ID非法时失败。' }, ['currentStatuses必须来自最新列表行且全部为1；取消时不发请求。'], { effect: 'prepare', inputs: activeSelectionInputsOf('salary-process-prepare-edit-legal-person'), steps: [{ role: 'required', when: '用户确认批量调整', capabilityId: 'salary-process-edit-legal-person', mapping: { idList: 'result.draft.idList', currentStatuses: 'args.currentStatuses', legalPersonId: 'result.draft.legalPersonId' }, instruction: '提交前再次核对选中行仍为status=1。' }, { role: 'cancel', when: '用户取消调整', instruction: '丢弃draft，不调用写接口。' }], completion: '获得无副作用批量调整请求体。' }) },
  'salary-process-edit-legal-person': { ...base('salary-process-edit-legal-person', '批量调整已起薪记录的纳税单位。', voidOutput, ['成功或超时后按idList逐条get/list回查legalPersonId和legalPersonName；后端还会同步员工纳税单位关联。'], { effect: 'write', inputs: activeSelectionInputsOf('salary-process-edit-legal-person'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-process-list', mapping: {}, instruction: '用原筛选条件重新查询并逐条核对idList；不能只看成功回执。' }] }) },
  'salary-process-prepare-edit-cost-center': {
    ...base('salary-process-prepare-edit-cost-center', '准备批量调整成本中心草稿。', { shape: '{ draft: { costCenterId, idList } }', fields: [field('draft.costCenterId', 'string | number', '目标成本中心ID'), field('draft.idList', '(string | number)[]', '选中已起薪记录ID')], empty: '选中为空、状态不是全部1、ID重复或成本中心ID非法时失败。' }, ['currentStatuses必须来自最新列表行且全部为1；取消时不发请求。'], { effect: 'prepare', inputs: activeSelectionInputsOf('salary-process-prepare-edit-cost-center'), steps: [{ role: 'required', when: '用户确认批量调整', capabilityId: 'salary-process-edit-cost-center', mapping: { idList: 'result.draft.idList', currentStatuses: 'args.currentStatuses', costCenterId: 'result.draft.costCenterId' }, instruction: '提交前再次核对选中行仍为status=1。' }, { role: 'cancel', when: '用户取消调整', instruction: '丢弃draft，不调用写接口。' }], completion: '获得无副作用批量调整请求体。' }) },
  'salary-process-edit-cost-center': { ...base('salary-process-edit-cost-center', '批量调整已起薪记录的成本中心。', voidOutput, ['成功或超时后按idList逐条get/list回查costCenterId和costCenterName；后端还会同步员工成本信息。'], { effect: 'write', inputs: activeSelectionInputsOf('salary-process-edit-cost-center'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-process-list', mapping: {}, instruction: '用原筛选条件重新查询并逐条核对idList；不能只看成功回执。' }] }) },
  'salary-process-prepare-clear-tax-date': {
    ...base('salary-process-prepare-clear-tax-date', '准备批量清空纳税开始时间草稿。', { shape: '{ draft: { emptyDate, ids } }', fields: [field('draft.emptyDate', 'string', '月份YYYY-MM；服务端会拼接-01保存'), field('draft.ids', '(string | number)[]', '选中已起薪记录ID')], empty: '选中为空、状态不是全部1、ID重复或月份非法时失败。' }, ['currentStatuses必须来自最新列表行且全部为1；取消时不发请求。'], { effect: 'prepare', inputs: activeSelectionInputsOf('salary-process-prepare-clear-tax-date'), steps: [{ role: 'required', when: '用户确认清空', capabilityId: 'salary-process-clear-tax-date', mapping: { idList: 'args.idList', currentStatuses: 'args.currentStatuses', emptyDate: 'result.draft.emptyDate' }, instruction: '提交同一批ID；后端字段名是ids，不是idList。' }, { role: 'cancel', when: '用户取消清空', instruction: '丢弃draft，不调用写接口。' }], completion: '获得无副作用清空请求体。' }) },
  'salary-process-clear-tax-date': { ...base('salary-process-clear-tax-date', '批量清空已起薪记录的纳税开始时间。', clearOutput, ['成功或超时后按idList逐条get/list回查emptyDate；后端会把输入月份拼接为YYYY-MM-01。'], { effect: 'write', inputs: activeSelectionInputsOf('salary-process-clear-tax-date'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-process-list', mapping: {}, instruction: '按idList回查emptyDate，不把空字符串回执当作落库证据。' }] }) },
  'salary-process-export': base('salary-process-export', '按薪资办理筛选条件或跨页选中员工导出Excel。', fileOutput, ['没有选中行时发送orgIds、staffCode、staffStatus、status、staffName和businessDate；有选中行时只发送去重后的staffCodeList与businessDate，和Portal的导出分支一致。', '保存返回的薪资办理.xls或响应Content-Disposition文件名。']),
  'salary-process-download-batch-start-template': base('salary-process-download-batch-start-template', '下载批量起薪模板。', fileOutput, ['先请求Portal返回的OSS URL，再用同一会话下载非空文件；保存为响应文件名或批量起薪模板.xlsx。']),
  'salary-process-prepare-batch-start': {
    ...base('salary-process-prepare-batch-start', '在批量起薪前校验Excel文件，不发上传请求。', previewOutput, ['确认文件名和大小后再提交同一份Base64；取消时只丢弃预览。'], { effect: 'prepare', inputs: fileInputsOf('salary-process-prepare-batch-start'), steps: [{ role: 'required', when: '用户确认上传', capabilityId: 'salary-process-batch-start', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '使用同一份文件作为multipart字段file。' }, { role: 'cancel', when: '用户取消上传', instruction: '丢弃文件预览，不调用写接口。' }], completion: '得到非空.xlsx/.xls文件预览。' }) },
  'salary-process-batch-start': { ...base('salary-process-batch-start', '上传Excel批量起薪。', eligibilityOutput, ['逐项消费processedStaffCodes、processedCount和excludedStaffList；有排除项时展示原因。成功或超时后重新list核对每个已处理工号的status=1。'], { effect: 'write', inputs: fileInputsOf('salary-process-batch-start'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-process-list', mapping: {}, instruction: '按文件指纹和processedStaffCodes回查；部分成功时只对未确认行处理，不能盲目整文件重传。' }] }) },
  'salary-process-download-batch-stop-template': base('salary-process-download-batch-stop-template', '下载批量停薪模板。', fileOutput, ['先请求Portal返回的OSS URL，再用同一会话下载非空文件；保存为响应文件名或批量停薪模板.xlsx。']),
  'salary-process-prepare-batch-stop': {
    ...base('salary-process-prepare-batch-stop', '在批量停薪前校验Excel文件，不发上传请求。', previewOutput, ['确认文件名和大小后再提交同一份Base64；取消时只丢弃预览。'], { effect: 'prepare', inputs: fileInputsOf('salary-process-prepare-batch-stop'), steps: [{ role: 'required', when: '用户确认上传', capabilityId: 'salary-process-batch-stop', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '使用同一份文件作为multipart字段file。' }, { role: 'cancel', when: '用户取消上传', instruction: '丢弃文件预览，不调用写接口。' }], completion: '得到非空.xlsx/.xls文件预览。' }) },
  'salary-process-batch-stop': { ...base('salary-process-batch-stop', '上传Excel批量停薪。', { shape: 'string | null', fields: [field('$', 'string | null', '后端成功时为空；失败会作为业务错误抛出')], empty: '成功空回执用null表示；请求失败时抛错。' }, ['成功或超时后按导入身份证号重新list/get核对stopTime、stopDescription和status；未来停薪日期在到期前仍可能保持1。'], { effect: 'write', inputs: fileInputsOf('salary-process-batch-stop'), idempotency: writeIdempotency, steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-process-list', mapping: {}, instruction: '按文件中的身份证号对应工号逐条回查；不能只看空回执。' }] }) },
}

export const SALARY_PROCESS_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALARY_PROCESS_METHODS).map(id => [id, contracts[id]!]))
export const SALARY_PROCESS_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALARY_PROCESS_METHODS).map(([id, method]) => [`salaryProcess.${method}`, SALARY_PROCESS_AI_CONTRACTS[id]!]))
