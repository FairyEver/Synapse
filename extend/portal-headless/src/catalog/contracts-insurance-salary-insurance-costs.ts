import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INSURANCE_SALARY_INSURANCE_COST_METHODS } from '../capabilities/insurance-salary-insurance-costs.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用姓名、行号或组织名称代替记录ID']

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '社保费用记录ID；归档、删除、调整和导出选择使用', { constraints: idRules }),
  field('list[].staffCode', 'string | number', '员工工号', { nullable: true, nullMeaning: '后端未返回工号' }),
  field('list[].name', 'string', '员工姓名', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('list[].organizationPath', 'string', '组织全路径', { nullable: true, nullMeaning: '后端未返回组织路径' }),
  field('list[].postName', 'string', '岗位名称', { nullable: true, nullMeaning: '后端未返回岗位' }),
  field('list[].idCard', 'string', '身份证文本，按原值返回', { nullable: true, nullMeaning: '后端未返回身份证' }),
  field('list[].insuredArea', 'string', '投保地', { nullable: true, nullMeaning: '后端未返回投保地' }),
  field('list[].depositUnitName', 'string', '缴存单位名称', { nullable: true, nullMeaning: '后端未返回缴存单位' }),
  field('list[].depositUnitId', 'string | number', '缴存单位ID', { optional: true, nullable: true, nullMeaning: '未设置缴存单位', constraints: idRules }),
  field('list[].costMonth', 'string', '费用归属月份，按原值返回', { nullable: true, nullMeaning: '后端未返回月份', format: 'YYYY-MM' }),
  field('list[].occurredMonth', 'string', '费用发生月份，归档时作为提交目标月份', { nullable: true, nullMeaning: '后端未返回月份', format: 'YYYY-MM' }),
  field('list[].totalInsuranceCost', 'number | string', '社保费用合计；不换算单位', { nullable: true, nullMeaning: '后端未返回金额' }),
  field('list[].totalUnitCost', 'number | string', '单位费用合计；不换算单位', { nullable: true, nullMeaning: '后端未返回金额' }),
  field('list[].totalPersonalCost', 'number | string', '个人费用合计；不换算单位', { nullable: true, nullMeaning: '后端未返回金额' }),
  field('list[].costType', 'integer', '费用类型：1正常、2补缴', { nullable: true, nullMeaning: '后端未返回费用类型' }),
  field('list[].operatorName', 'string', '操作人名称', { nullable: true, nullMeaning: '后端未返回操作人' }),
  field('list[].operateTime', 'string | number', '操作时间原值', { nullable: true, nullMeaning: '后端未返回操作时间' }),
  field('list[].costCenterName', 'string', '成本中心名称', { nullable: true, nullMeaning: '后端未返回成本中心' }),
  field('list[].costCenterId', 'string | number', '成本中心ID', { optional: true, nullable: true, nullMeaning: '未设置成本中心', constraints: idRules }),
  ...['pension', 'unemployment', 'workInjury', 'maternity', 'basicMedical', 'majorMedical'].flatMap(kind => [
    field(`list[].${kind}UnitCost`, 'number | string', `${kind}单位费用；原值保留`, { nullable: true, nullMeaning: '后端未返回金额' }),
    field(`list[].${kind}PersonalCost`, 'number | string', `${kind}个人费用；原值保留`, { nullable: true, nullMeaning: '后端未返回金额' }),
    field(`list[].${kind}TotalCost`, 'number | string', `${kind}合计费用；原值保留`, { nullable: true, nullMeaning: '后端未返回金额' }),
  ]),
  field('list[].salaryDocumentIds', 'string', '关联薪资单据ID串', { nullable: true, nullMeaning: '未被薪资核算使用或后端未返回' }),
  field('list[].salaryDocumentIdNames', 'string', '关联薪资单据名称', { nullable: true, nullMeaning: '未被薪资核算使用或后端未返回' }),
  field('list[].archiveStatus', 'integer', '归档状态：1未归档、2已归档', { values: { '1': '未归档', '2': '已归档' } }),
  field('list[].isDel', 'integer', '删除标志：0否、1是', { nullable: true, nullMeaning: '后端未返回删除标志' }),
  field('list[].creator', 'string | number', '创建人ID', { optional: true, nullable: true, nullMeaning: '后端未返回创建人', constraints: idRules }),
  field('list[].createTime', 'string | number', '创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('list[].updater', 'string | number', '修改人ID', { optional: true, nullable: true, nullMeaning: '后端未返回修改人', constraints: idRules }),
  field('list[].updateTime', 'string | number', '修改时间原值', { nullable: true, nullMeaning: '后端未返回修改时间' }),
  field('list[].isSalaryUsed', 'number | string', '是否被薪资核算使用；保留后端原值', { nullable: true, nullMeaning: '后端未返回使用状态' }),
  field('total', 'integer', '符合筛选的总记录数，不是当前页长度'),
]
const pageOutput: AiContract['output'] = { shape: '{ list: array, total: integer }', fields: [field('$', 'object', '社保费用分页结果'), field('list', 'array', '当前页记录，不是全部数据'), field('list[]', 'object', '一条社保费用记录'), ...rowFields], empty: 'list=[]且total=0表示筛选无记录；权限或响应形状错误会抛出。' }
const commonInputs: Record<string, AiParameter> = {
  name: optional('员工姓名筛选', '页面姓名输入框', 'SDK发送null，不限制姓名', { type: 'string', nullable: true }),
  orgIds: optional('角色组织ID数组', '页面角色组织树多选', 'SDK发送空字符串，不限制组织', { type: 'array<string | number> | string', nullable: true, constraints: ['数组ID按Portal转换为逗号字符串'] }),
  archiveStatus: optional('归档状态：1未归档、2已归档', '页面状态或页面默认值', '费用页默认1，归档页默认2', { type: 'integer' }),
  belongMonth: optional('费用归属月份范围', '页面月份范围选择器', 'SDK发送costDateStart/costDateEnd为null', { type: 'array<string | null>', format: 'YYYY-MM' }),
  pageNo: optional('页码', '页面分页状态', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('页大小', '页面分页状态', 'SDK默认20', { type: 'integer', constraints: ['10、20、50、100、200、500'] }),
}
const costInputs = commonInputs
const archiveInputs: Record<string, AiParameter> = {
  ...commonInputs,
  isSalaryUsed: optional('是否被薪资核算使用：0未使用、1使用过', '归档页使用状态下拉框', 'SDK发送null，不限制使用状态', { type: 'integer', nullable: true }),
  occurMonth: optional('费用发生月份范围', '归档页月份范围选择器', 'SDK发送occurredDateStart/occurredDateEnd为null', { type: 'array<string | null>', format: 'YYYY-MM' }),
}
const idsInput: Record<string, AiParameter> = { ids: input('记录ID数组', '当前页面勾选记录', { type: 'array<string | number>', constraints: ['非空', ...idRules] }) }
const optionalIdsInput: Record<string, AiParameter> = { ids: optional('可选勾选记录ID数组', '当前页面跨页选择状态', 'SDK发送空字符串，导出当前筛选结果', { type: 'array<string | number> | string', nullable: true, constraints: idRules }) }
const itemsInput: Record<string, AiParameter> = { items: input('记录操作数组', '页面选中行与弹窗目标月份/目标ID', { type: 'array<object>', constraints: ['非空；每项至少包含id', '归档每项包含occurredMonth=YYYY-MM'] }) }
const fileInputs: Record<string, AiParameter> = {
  fileName: input('上传文件名', '文件选择器原名', { type: 'string' }),
  base64: input('文件内容Base64', '文件读取结果', { type: 'string' }),
  contentType: optional('文件MIME类型', '文件选择器类型', 'SDK使用application/octet-stream', { type: 'string' }),
}
const fileOutput: AiContract['output'] = { shape: '{ fileName, contentType, base64, byteLength }', fields: [field('$', 'object', '二进制文件内存表示'), field('fileName', 'string', '建议保存的文件名'), field('contentType', 'string | null', '响应Content-Type', { nullable: true }), field('base64', 'string', '文件内容Base64'), field('byteLength', 'integer', '原始字节数')], empty: '空文件响应失败。' }
const voidOutput: AiContract['output'] = { shape: 'void', fields: [field('$', 'void', 'Portal成功响应无业务data；未抛错只表示请求完成')], empty: '请求失败时抛错。' }
const treeOutput: AiContract['output'] = { shape: 'array', fields: [field('$', 'array', '当前会话可见角色组织树根节点'), field('[].id', 'string | number', '组织ID', { constraints: idRules }), field('[].name', 'string', '组织名称'), field('[].children', 'array', '子组织节点')], empty: '[]表示当前会话没有可见组织。' }
const prepareOutput = (description: string, fields: AiField[]): AiContract['output'] => ({ shape: '{ draft: array | object }', fields: [field('$', 'object', description), ...fields], empty: '非法输入不返回草稿。' })
const copyOutput: AiContract['output'] = { shape: '{ draft: { oldDate, newDate } }', fields: [field('$', 'object', '历史归档月份草稿'), field('draft', 'object', '可供确认的月份载荷'), field('draft.oldDate', 'string', '来源归档月份', { format: 'YYYY-MM' }), field('draft.newDate', 'string', '目标归属月份', { format: 'YYYY-MM' })], empty: '非法月份不返回草稿。' }
const writeIdempotency = 'Portal写端点没有requestId，SDK不添加服务端幂等键；请求完成或超时后按同一记录ID、目标月份或文件指纹回查，未确认前不得盲目重试。'
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/hr/insurance/cost/list.vue 与 archive/list.vue', kind: 'reference', note: '证明两个页面的默认筛选、月份转换、旧版角色组织树、导出、导入、归档、删除、取消归档、调整和历史费用动作。固定检出未pull。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 SalaryInsuranceCostsController、SalaryInsuranceCostsSelectDTO、SalaryInsuranceCostsDTO、SalaryInsuranceCostsServiceImpl', kind: 'reference', note: '证明分页字段、完整费用DTO投影、type=1/2导出、multipart导入和各批量写端点；固定检出未pull。' },
  { source: 'src/capabilities/insurance-salary-insurance-costs.ts', kind: 'implementation', note: '证明SDK的页面分片、表单参数、原始金额字段、multipart文件和批量请求实现。' },
  { source: 'test/insurance-salary-insurance-costs.test.ts', kind: 'test', note: '离线锁定两个页面筛选、导出参数、请求体、文件输入、权限和坏响应。' },
]
const gaps = ['未启动浏览器、未取得独立网络基准、未在真实测试环境执行读请求或prepare→submit→cancel写闭环；本契约来自固定源码、Java源码和离线测试。', 'Portal/Java固定检出未按任务约束pull到远端最新，部署版本差异未验证。']
function base (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“社保费用”或“社保归档查询”页面的查询、批量维护和文件动作。',
    boundaries: ['费用页默认archiveStatus=1；归档页默认archiveStatus=2；月份和orgIds按页面真实转换，不将两页筛选字段混发。', '归档/删除/调整/导入等后端业务规则仍由后端裁决；SDK不把请求未抛错当成落库证据。', 'moduleType固定为14；旧版角色组织树使用getRoleOrganizationTree，不能替换成全量树或TreeNew。'],
    prerequisites: ['已建立带有效会话token、tenantId和platform页面上下文的SDK。', '写操作先保存用户确认的draft；完成或超时后按ID、月份或文件指纹回查。'],
    failures: ['非法ID、月份、状态、页码、空批量操作或空文件在发请求前失败。', '分页响应缺少list/total、行ID或archiveStatus时抛错；401/403和后端业务错误原样抛出。'],
    evidence,
    gaps,
    ...value,
  }
}
const commonList = (id: string, purpose: string, inputs: Record<string, AiParameter>): AiContract => base({ purpose, effect: 'read', inputs, output: pageOutput, consume: ['展示当前页全部字段并按total分页；金额、比例、月份和审计时间按原值解释。', '保留list[].id与archiveStatus用于后续操作；不能用员工姓名代替记录ID。'], steps: [{ role: 'optional', when: '需要组织筛选候选', capabilityId: `${id}-organization-tree`, mapping: {}, instruction: '读取树后只提交节点ID到args.orgIds。' }], completion: '返回当前页面筛选结果和total。', idempotency: null })

const RAW: Record<string, AiContract> = {
  'insurance-cost-list': commonList('insurance-cost', '按Portal“社保费用”筛选未归档费用记录。', costInputs),
  'insurance-archive-list': commonList('insurance-archive', '按Portal“社保归档查询”筛选已归档费用记录。', archiveInputs),
  'insurance-cost-organization-tree': base({ purpose: '读取社保费用页面使用的角色组织树。', effect: 'read', inputs: {}, output: treeOutput, consume: ['将节点ID填入costList的orgIds。'], steps: [], completion: '获得当前会话可见组织树。', idempotency: null }),
  'insurance-archive-organization-tree': base({ purpose: '读取社保归档查询页面使用的角色组织树。', effect: 'read', inputs: {}, output: treeOutput, consume: ['将节点ID填入archiveList的orgIds。'], steps: [], completion: '获得当前会话可见组织树。', idempotency: null }),
  'insurance-cost-prepare-archive': base({ purpose: '准备把社保费用记录归档到用户指定的发生月份。', effect: 'prepare', inputs: itemsInput, output: prepareOutput('归档草稿', [field('draft[]', 'object', '一条归档项'), field('draft[].id', 'string | number', '费用记录ID', { constraints: idRules }), field('draft[].occurredMonth', 'string', '费用发生月份', { format: 'YYYY-MM' })]), consume: ['确认后将draft交给insurance-cost-archive；取消时丢弃draft。'], steps: [{ role: 'required', when: '用户确认归档', capabilityId: 'insurance-cost-archive', mapping: { items: 'result.draft' }, instruction: '按原数组提交，不用名称代替ID。' }, { role: 'cancel', when: '用户取消归档弹窗', instruction: '丢弃草稿，不调用写端点。' }], completion: '获得无副作用归档草稿。', idempotency: null }),
  'insurance-cost-archive': base({ purpose: '归档一批社保费用记录。', effect: 'write', inputs: itemsInput, output: voidOutput, consume: ['完成或超时后按同一ID和occurredMonth查询archiveStatus=2。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'insurance-archive-list', mapping: {}, instruction: '独立回查归档状态。' }], completion: '请求未抛错且回查确认记录已归档。', idempotency: writeIdempotency }),
  'insurance-cost-prepare-remove': base({ purpose: '准备删除未归档社保费用记录。', effect: 'prepare', inputs: idsInput, output: prepareOutput('删除草稿', [field('draft[]', 'object', '一条删除项'), field('draft[].id', 'string | number', '记录ID', { constraints: idRules })]), consume: ['确认后将draft[].id交给insurance-cost-remove；后端会保护已归档或被使用数据。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'insurance-cost-remove', mapping: { ids: 'result.draft[].id' }, instruction: '只提交用户确认的记录ID。' }, { role: 'cancel', when: '用户取消删除确认框', instruction: '丢弃草稿，不调用写端点。' }], completion: '获得无副作用删除草稿。', idempotency: null }),
  'insurance-cost-remove': base({ purpose: '删除选中的未归档社保费用记录。', effect: 'write', inputs: idsInput, output: voidOutput, consume: ['按同一ID重新查询确认；不能把空响应当作删除证据。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'insurance-cost-list', mapping: {}, instruction: '回查同一记录ID及其状态。' }], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
  'insurance-cost-export': base({ purpose: '按社保费用筛选条件导出当前结果或勾选记录。', effect: 'read', inputs: { ...costInputs, ...optionalIdsInput }, output: fileOutput, consume: ['type=1；保存为社保费用.xlsx；省略ids时导出筛选结果。'], steps: [], completion: '获得非空Excel文件。', idempotency: null }),
  'insurance-archive-export': base({ purpose: '按社保归档查询筛选条件导出当前结果或勾选记录。', effect: 'read', inputs: { ...archiveInputs, ...optionalIdsInput }, output: fileOutput, consume: ['type=2；保存为社保归档查询.xlsx；省略ids时导出筛选结果。'], steps: [], completion: '获得非空Excel文件。', idempotency: null }),
  'insurance-cost-download-template': base({ purpose: '下载社保费用导入模板。', effect: 'read', inputs: {}, output: fileOutput, consume: ['保存为社保费用模板；模板接口不提交业务记录。'], steps: [], completion: '获得非空模板文件。', idempotency: null }),
  'insurance-cost-prepare-import': base({ purpose: '在导入前校验并预览社保费用文件。', effect: 'prepare', inputs: fileInputs, output: { shape: '{ fileName, contentType, byteLength }', fields: [field('$', 'object', '文件预览'), field('fileName', 'string', '原文件名'), field('contentType', 'string', 'MIME类型'), field('byteLength', 'integer', '文件字节数')], empty: '空文件或非法Base64失败。' }, consume: ['确认预览后将同一文件交给insurance-cost-import；取消时不上传。'], steps: [{ role: 'required', when: '用户确认导入', capabilityId: 'insurance-cost-import', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: 'SDK使用multipart字段file，不把Base64当JSON字段。' }, { role: 'cancel', when: '用户取消导入弹窗', instruction: '丢弃文件预览，不发请求。' }], completion: '获得非空文件预览。', idempotency: null }),
  'insurance-cost-import': base({ purpose: '以multipart文件导入社保费用。', effect: 'write', inputs: fileInputs, output: voidOutput, consume: ['完成或超时后重新查询insurance-cost-list核对记录；接口没有导入条数回执。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'insurance-cost-list', mapping: {}, instruction: '回查导入结果，不以HTTP完成推断业务落库。' }], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
  'insurance-cost-prepare-update-deposit-unit': base({ purpose: '准备调整未归档社保费用的缴存单位。', effect: 'prepare', inputs: itemsInput, output: prepareOutput('缴存单位调整草稿', [field('draft[]', 'object', '调整项'), field('draft[].id', 'string | number', '记录ID', { constraints: idRules }), field('draft[].depositUnitId', 'string | number', '目标缴存单位ID', { constraints: idRules })]), consume: ['确认后交给insurance-cost-update-deposit-unit；页面会阻止已归档行调整。'], steps: [{ role: 'required', when: '用户确认调整', capabilityId: 'insurance-cost-update-deposit-unit', mapping: { items: 'result.draft' }, instruction: '提交ID和目标ID。' }, { role: 'cancel', when: '用户取消调整弹窗', instruction: '丢弃草稿，不发请求。' }], completion: '获得无副作用调整草稿。', idempotency: null }),
  'insurance-cost-update-deposit-unit': base({ purpose: '批量调整社保费用缴存单位。', effect: 'write', inputs: itemsInput, output: voidOutput, consume: ['按记录ID回查depositUnitName；已归档数据由页面和后端共同限制。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'insurance-cost-list', mapping: {}, instruction: '回查同一记录ID。' }], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
  'insurance-cost-prepare-update-cost-center': base({ purpose: '准备调整未归档社保费用的成本中心。', effect: 'prepare', inputs: itemsInput, output: prepareOutput('成本中心调整草稿', [field('draft[]', 'object', '调整项'), field('draft[].id', 'string | number', '记录ID', { constraints: idRules }), field('draft[].costCenterId', 'string | number', '目标成本中心ID', { constraints: idRules })]), consume: ['确认后交给insurance-cost-update-cost-center；取消时不发请求。'], steps: [{ role: 'required', when: '用户确认调整', capabilityId: 'insurance-cost-update-cost-center', mapping: { items: 'result.draft' }, instruction: '提交ID和目标ID。' }, { role: 'cancel', when: '用户取消调整弹窗', instruction: '丢弃草稿，不发请求。' }], completion: '获得无副作用调整草稿。', idempotency: null }),
  'insurance-cost-update-cost-center': base({ purpose: '批量调整社保费用成本中心。', effect: 'write', inputs: itemsInput, output: voidOutput, consume: ['按记录ID回查costCenterName；已归档数据由页面和后端共同限制。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'insurance-cost-list', mapping: {}, instruction: '回查同一记录ID。' }], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
  'insurance-cost-prepare-copy-archived-data': base({ purpose: '准备按月份调用历史归档社保费用。', effect: 'prepare', inputs: { oldDate: input('来源归档月份', '历史归档弹窗旧月份', { type: 'string', format: 'YYYY-MM' }), newDate: input('目标归属月份', '历史归档弹窗新月份', { type: 'string', format: 'YYYY-MM' }) }, output: copyOutput, consume: ['确认后交给insurance-cost-copy-archived-data；取消时不发请求。'], steps: [{ role: 'required', when: '用户确认调用', capabilityId: 'insurance-cost-copy-archived-data', mapping: { oldDate: 'result.draft.oldDate', newDate: 'result.draft.newDate' }, instruction: '按月份提交。' }, { role: 'cancel', when: '用户取消调用历史费用', instruction: '丢弃草稿，不发请求。' }], completion: '获得月份草稿。', idempotency: null }),
  'insurance-cost-copy-archived-data': base({ purpose: '按月份调用历史归档社保费用。', effect: 'write', inputs: { oldDate: input('来源归档月份', 'prepare结果', { type: 'string', format: 'YYYY-MM' }), newDate: input('目标归属月份', 'prepare结果', { type: 'string', format: 'YYYY-MM' }) }, output: voidOutput, consume: ['完成或超时后按目标月份查询确认；不以空响应推断复制条数。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'insurance-cost-list', mapping: { belongMonth: 'args.newDate' }, instruction: '回查目标归属月份。' }], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
  'insurance-archive-prepare-unarchive': base({ purpose: '准备取消社保费用归档。', effect: 'prepare', inputs: idsInput, output: prepareOutput('取消归档草稿', [field('draft[]', 'object', '取消归档项'), field('draft[].id', 'string | number', '记录ID', { constraints: idRules })]), consume: ['确认后交给insurance-archive-unarchive；后端会处理被薪资使用记录的限制。'], steps: [{ role: 'required', when: '用户确认取消归档', capabilityId: 'insurance-archive-unarchive', mapping: { ids: 'result.draft[].id' }, instruction: '只提交确认的记录ID。' }, { role: 'cancel', when: '用户取消取消归档确认框', instruction: '丢弃草稿，不发请求。' }], completion: '获得无副作用草稿。', idempotency: null }),
  'insurance-archive-unarchive': base({ purpose: '取消选中的社保费用归档。', effect: 'write', inputs: idsInput, output: voidOutput, consume: ['完成或超时后重新查询同一ID确认archiveStatus=1；被薪资使用时按后端错误处理。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'insurance-archive-list', mapping: {}, instruction: '回查同一ID和归档状态。' }], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
}

export const INSURANCE_SALARY_INSURANCE_COST_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(INSURANCE_SALARY_INSURANCE_COST_METHODS).map(id => [id, RAW[id]!]))
export const INSURANCE_SALARY_INSURANCE_COST_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INSURANCE_SALARY_INSURANCE_COST_METHODS).map(([id, method]) => [`insuranceSalaryInsuranceCosts.${method}`, INSURANCE_SALARY_INSURANCE_COST_AI_CONTRACTS[id]!]))
