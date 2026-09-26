import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALARY_ACCOUNTING_METHODS, salaryAccountingCapabilities } from '../capabilities/salary-accounting.js'

const definitions = new Map(salaryAccountingCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })

const documentFields: AiField[] = [
  field('list[].id', 'string | number | null', '薪资核算单据ID；详情、步骤、删除、结账、拆分和发放回查使用；保留原始字符串避免长整数精度损失'),
  field('list[].name', 'string | null', '薪资单据名称；第一步自动由年月、组织和账套组合，页面允许手工保留或修改'),
  field('list[].organizationId', 'string | number | null', '单据所属组织ID；查询和服务端组织范围使用'),
  field('list[].organizationName', 'string | null', '单据所属组织名称或路径；只展示，不作为写入ID'),
  field('list[].ledgerId', 'string | number | null', '薪资账套ID；核算范围和薪资项目来源'),
  field('list[].documentName', 'string | null', '页面“账套”列使用的账套名称'),
  field('list[].salaryMonth', 'string | null', '工资月份，YYYY-MM；核算业务月份'),
  field('list[].costMonth', 'string | null', '成本归属月份，YYYY-MM；第一步页面默认与salaryMonth相同'),
  field('list[].personCount', 'number | null', '单据总人数'),
  field('list[].unissuedCount', 'number | null', '尚未发放工资的人数'),
  field('list[].payableTotal', 'number | string | null', '应发合计；服务端金额原值，单位元'),
  field('list[].deductionTotal', 'number | string | null', '扣税合计；服务端金额原值，单位元'),
  field('list[].actualTotal', 'number | string | null', '实发合计；服务端金额原值，单位元'),
  field('list[].status', 'number | null', '单据结账状态：0未结账、1已结账', { values: { '0': '未结账', '1': '已结账' } }),
  field('list[].step', 'number | null', '核算步骤：1账套和月份、2人员、3外部数据、4核算结果', { values: { '1': '第一步', '2': '第二步', '3': '第三步', '4': '已完成' } }),
  field('list[].salaryTaxBand', 'number | string | null', '薪资计税区间；由账套配置带出，保留服务端原值'),
  field('list[].creator', 'string | number | null', '创建人ID'),
  field('list[].creatorName', 'string | null', '创建人姓名'),
  field('list[].operator', 'string | number | null', '核算操作人ID'),
  field('list[].operatorName', 'string | null', '核算操作人姓名'),
  field('list[].createTime', 'string | null', '创建时间；服务端日期时间原值'),
  field('list[].operateTime', 'string | null', '核算时间；服务端日期时间原值'),
]

const documentPageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前筛选页的薪资核算单据'), field('total', 'number', '符合筛选条件的总记录数，用于翻页'), ...documentFields],
  empty: 'list=[]且total=0表示当前筛选无记录；不能把空页当作没有权限。',
}
const documentOutput: AiContract['output'] = {
  shape: 'object',
  fields: documentFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, '') })),
  empty: '缺少详情对象时抛错，不用空对象代替真实单据。',
}
const stepOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('organizationId', 'string | number | null', '第一步回显的角色组织ID；提交时使用'),
    field('ledgerId', 'string | number | null', '第一步回显的账套ID；提交时使用'),
    field('salaryMonth', 'string | null', '第一步回显工资月份，YYYY-MM'),
    field('costMonth', 'string | null', '第一步回显成本归属月份，YYYY-MM'),
    field('name', 'string | null', '第一步回显单据名称'),
    field('orgId', 'string | number | null', '第二步员工选择组件使用的组织ID'),
    field('salaryDocumentUserInformationEntityList', 'object[]', '第二步已保存或重新核算时回显的员工名单'),
    field('salaryDocumentUserInformationEntityList[].id', 'string | number | null', '单据员工记录ID'),
    field('salaryDocumentUserInformationEntityList[].name', 'string | null', '员工姓名'),
    field('salaryDocumentUserInformationEntityList[].staffCode', 'string | number | null', '员工工号；第二步表格行主键'),
    field('salaryDocumentUserInformationEntityList[].status', 'number | null', '员工在职状态或后端原始状态；按原值解释'),
    field('salaryDocumentUserInformationEntityList[].fullPath', 'string | null', '员工所属组织全路径'),
    field('salaryDocumentUserInformationEntityList[].salaryCost', 'string | null', '员工成本中心名称'),
    field('salaryDocumentUserInformationEntityList[].legalPerson', 'string | null', '员工纳税单位名称'),
    field('salaryDocumentUserInformationEntityList[].isCalculate', 'number | null', '使用账套和月份的核算标记；按Portal字典展示'),
  ],
  empty: '步骤数据缺少对象时抛错；不同step返回不同字段，调用方按步骤字段消费。',
}
const salaryItemPageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前账套薪资项目页'),
    field('total', 'number', '符合名称和属性筛选的薪资项目总数'),
    field('list[].id', 'string | number | null', '薪资项目ID'),
    field('list[].name', 'string | null', '薪资项目名称'),
    field('list[].attribute', 'number | null', '薪资项目属性：1固定项、2计算项、3外部数据、4系统参数', { values: { '1': '固定项', '2': '计算项', '3': '外部数据', '4': '系统参数' } }),
    field('list[].type', 'number | null', '薪资项目类型；页面通过salary_item_type字典展示'),
    field('list[].parameterName', 'string | null', '系统参数名称'),
    field('list[].formula', 'string | null', '计算公式'),
    field('list[].remark', 'string | null', '备注'),
  ],
  empty: 'list=[]且total=0表示该账套或筛选条件没有薪资项目。',
}
const eligibilityOutput: AiContract['output'] = {
  shape: '{ processedIds, processedStaffCodes, processedCount, eligibleStaffIds, eligibleStaffCodes, excludedStaffList }',
  fields: [
    field('processedIds', '(string | number)[]', '本次服务端实际处理的业务记录ID；不是请求提交数量'),
    field('processedStaffCodes', '(string | number)[]', '本次实际通过资格检查并处理的员工工号'),
    field('processedCount', 'number', '本次实际处理人数；为0时Portal不进入下一步'),
    field('eligibleStaffIds', '(string | number)[]', '资格检查通过的员工ID'),
    field('eligibleStaffCodes', '(string | number)[]', '资格检查通过的员工工号'),
    field('excludedStaffList', 'object[]', '被资格检查排除的员工及原因；不能只看processedCount'),
    field('excludedStaffList[].staffId', 'string | number | null', '被排除员工ID'),
    field('excludedStaffList[].staffCode', 'string | number | null', '被排除员工工号'),
    field('excludedStaffList[].staffName', 'string | null', '被排除员工姓名'),
    field('excludedStaffList[].status', 'number | null', '被排除员工状态'),
    field('excludedStaffList[].downtimePay', 'string | null', '停薪日期或资格判断停薪信息'),
    field('excludedStaffList[].businessDate', 'string | null', '资格判断业务日期'),
    field('excludedStaffList[].reasonCode', 'string | null', '排除原因编码'),
    field('excludedStaffList[].reason', 'string | null', '排除原因文本'),
  ],
  empty: 'excludedStaffList=[]表示没有排除项；不代表没有人员或没有权限。',
}
const staffOutput: AiContract['output'] = {
  shape: '{ staffPage: { list: object[], total: number }, eligibilityResult: object }',
  fields: [
    field('staffPage', 'object', '员工候选分页和总数'),
    field('staffPage.list', 'object[]', '当前页员工候选；页面另外按eligibilityResult标记不可选项'),
    field('staffPage.total', 'number', '符合筛选的候选总数'),
    field('staffPage.list[].id', 'string | number | null', '员工ID'),
    field('staffPage.list[].name', 'string | null', '员工姓名'),
    field('staffPage.list[].staffCode', 'string | number | null', '员工工号；选择和保存使用此字段'),
    field('staffPage.list[].postName', 'string | null', '岗位名称'),
    field('staffPage.list[].fullPath', 'string | null', '部门全路径'),
    field('staffPage.list[].salaryEligibilityExcluded', 'boolean | null', '页面本地标记：当前员工不符合薪资资格时禁止选择'),
    field('staffPage.list[].salaryEligibilityReason', 'string | null', '页面本地标记的资格原因'),
    field('eligibilityResult', 'object', '当前查询返回的薪资资格结果'),
    ...eligibilityOutput.fields.filter(item => item.path !== 'excludedStaffList' && item.path !== 'processedIds' && item.path !== 'processedStaffCodes' && item.path !== 'processedCount' && item.path !== 'eligibleStaffIds' && item.path !== 'eligibleStaffCodes').map(item => ({ ...item, path: item.path.replace(/^/, 'eligibilityResult.') })),
    field('eligibilityResult.processedIds', '(string | number)[]', '当前资格计算实际处理的员工/记录ID'),
    field('eligibilityResult.processedStaffCodes', '(string | number)[]', '当前资格计算实际处理的员工工号'),
    field('eligibilityResult.processedCount', 'number', '当前资格计算实际处理人数'),
    field('eligibilityResult.eligibleStaffIds', '(string | number)[]', '当前资格计算通过的员工ID'),
    field('eligibilityResult.eligibleStaffCodes', '(string | number)[]', '当前资格计算通过的员工工号'),
    field('eligibilityResult.excludedStaffList', 'object[]', '当前资格计算排除的员工及原因'),
  ],
  empty: 'staffPage.list=[]且total=0表示当前员工筛选无候选；仍应读取eligibilityResult确认是否存在排除项。',
}
const historyOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '历史核算人员记录'), field('[].staffCode', 'string | number | null', '历史员工工号'), field('[].name', 'string | null', '历史员工姓名'), field('[].id', 'string | number | null', '历史员工ID')],
  empty: '[]表示没有可复用的历史核算人员。',
}
const arrayOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '页面候选或拆分员工记录'), field('[].id', 'string | number | null', '业务记录ID'), field('[].name', 'string | null', '名称或员工姓名'), field('[].staffCode', 'string | number | null', '员工工号；员工相关数组按此字段消费')],
  empty: '[]表示当前查询没有条目；这是数组，不读取list/total。',
}
const stringArrayOutput: AiContract['output'] = {
  shape: 'string[]',
  fields: [field('[]', 'string', '外部薪资文件中识别出的列名或已导入项目名称；按原文匹配'),],
  empty: '[]表示没有识别到可匹配的外部薪资项目。',
}
const detailUsersOutput: AiContract['output'] = {
  shape: '{ summary: object, pageData: { list: object[], total: number } }',
  fields: [
    field('summary', 'object', '当前单据员工明细汇总；金额字段按服务端原值消费，单位元'),
    field('summary.totalNeedPaySalary', 'number | string | null', '应发工资合计'),
    field('summary.totalActualSalary', 'number | string | null', '实发工资合计'),
    field('pageData', 'object', '员工明细分页'),
    field('pageData.list', 'object[]', '当前页员工工资明细'),
    field('pageData.total', 'number', '员工明细总数'),
    field('pageData.list[].id', 'string | number | null', '单据员工明细ID；发放工资使用'),
    field('pageData.list[].name', 'string | null', '员工姓名'),
    field('pageData.list[].staffCode', 'string | number | null', '员工工号'),
    field('pageData.list[].status', 'number | null', '工资发放状态：0未发放、1已发放；状态1行不可再次选择', { values: { '0': '未发放', '1': '已发放' } }),
    field('pageData.list[].grantTime', 'string | null', '工资发放日期，YYYY-MM-DD或服务端原值'),
    field('pageData.list[].costCenter', 'string | null', '成本中心名称；页面当前不展示但服务端可能返回'),
    field('pageData.list[].legalPerson', 'string | null', '纳税单位名称'),
    field('pageData.list[].needPaySalary', 'number | string | null', '应发工资；单位元'),
    field('pageData.list[].realPaySalary', 'number | string | null', '实发工资；单位元'),
  ],
  empty: 'pageData.list=[]且pageData.total=0表示当前筛选无明细；summary仍按服务端原值读取。',
}
const temporaryPageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '外部薪资项目临时明细页'), field('total', 'number', '当前项目下临时明细总数'), field('list[].id', 'string | number | null', '临时明细ID；批量修改使用'), field('list[].documentId', 'string | number | null', '所属薪资单据ID'), field('list[].itemId', 'string | number | null', '外部薪资项目ID'), field('list[].itemName', 'string | null', '外部薪资项目名称'), field('list[].staffCode', 'string | number | null', '员工工号'), field('list[].staffName', 'string | null', '员工姓名'), field('list[].value', 'number | string | null', '当前临时导入值；保存时按原类型提交')],
  empty: 'list=[]且total=0表示当前项目没有临时明细。',
}
const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [field('fileName', 'string', '响应文件名；没有Content-Disposition时使用页面默认名'), field('contentType', 'string | null', '响应Content-Type'), field('base64', 'string', '非空文件内容Base64；调用方可落盘为模板或导出文件'), field('byteLength', 'number', '原始文件字节数；必须大于0')],
  empty: '空文件响应会抛错。',
}
const previewOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, byteLength }',
  fields: [field('fileName', 'string', '待上传的原文件名；必须是.xlsx或.xls'), field('contentType', 'string', '实际multipart文件MIME类型'), field('byteLength', 'number', '待上传文件字节数；必须大于0')],
  empty: '非法扩展名、非法Base64或空文件不能生成预览。',
}
const idOutput: AiContract['output'] = { shape: 'string | number', fields: [field('$', 'string | number', '新建薪资核算单据ID；保留原始字符串')], empty: '正常创建必须返回新单据ID；超时先按表单条件查询核实。' }
const boolOutput: AiContract['output'] = { shape: 'boolean', fields: [field('$', 'boolean', 'SDK将Portal成功空回执归一为true；不代表已读回最新数据')], empty: '请求失败时抛错。' }
const textOutput: AiContract['output'] = { shape: 'string | null', fields: [field('$', 'string | null', '结账接口成功回执；Portal通常为空，SDK将空回执归一为null')], empty: '请求失败时抛错。' }
const draftOutput = (fields: AiField[], empty = '非法参数不返回草稿；用户取消时只丢弃本地草稿，不发请求。'): AiContract['output'] => ({ shape: '{ draft: object }', fields: [field('draft', 'object', '按Portal请求字段生成的无副作用草稿'), ...fields], empty })

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`薪资核算契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'enum' ? 'number' : parameter.kind === 'number' ? 'number' : parameter.kind === 'tree' ? 'string | number' : parameter.kind === 'date' ? 'string' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal薪资核算列表、第一至第三步向导、员工选择/导入弹窗或核算详情；按页面真实字段和提交顺序使用。',
    ...(parameter.options ? { options: parameter.options } : {}),
  }]))
}

function typedInputsOf (id: string): Record<string, AiParameter> {
  const inputs = inputsOf(id)
  for (const name of ['id', 'documentId', 'ledgerId', 'organizationId', 'orgId', 'itemId']) if (inputs[name]) inputs[name] = { ...inputs[name], type: 'string | number', nullable: true }
  for (const name of ['ids', 'documentIds', 'idList', 'staffCodeList', 'currentStatuses', 'currentSteps', 'updates', 'staffList']) if (inputs[name]) inputs[name] = { ...inputs[name], type: name === 'staffList' || name === 'updates' ? 'object[]' : '(string | number)[]', nullable: false, constraints: ['非空', '不重复', '必须来自当前页面最新结果'] }
  for (const name of ['salaryMonth', 'costMonth', 'startYearMonth', 'endYearMonth']) if (inputs[name]) inputs[name] = { ...inputs[name], type: 'string', format: 'YYYY-MM', constraints: inputs[name].required ? ['YYYY-MM'] : ['空值表示不筛选；非空时必须为YYYY-MM'] }
  for (const name of ['createDate', 'operateDate', 'grantTime']) if (inputs[name]) inputs[name] = { ...inputs[name], type: 'string', format: 'YYYY-MM-DD' }
  if (inputs.name) inputs.name = { ...inputs.name, type: 'string', constraints: ['单据名称可空（Portal名称校验已注释）'] }
  if (inputs.staffCode) inputs.staffCode = { ...inputs.staffCode, type: 'string | number | null', nullable: true }
  if (inputs.fileName) inputs.fileName = { ...inputs.fileName, type: 'string', constraints: ['扩展名必须为.xlsx或.xls'] }
  if (inputs.base64) inputs.base64 = { ...inputs.base64, type: 'string', constraints: ['必须是非空标准Base64'] }
  if (inputs.documentStatus) inputs.documentStatus = { ...inputs.documentStatus, type: 'number', constraints: ['必须为1；只有已结账单据可以发放'] }
  if (inputs.status && inputs.status.options) inputs.status = { ...inputs.status, type: 'number | null', nullable: true }
  return inputs
}

const writeIdempotency = 'Portal/Java写接口没有统一requestId持久幂等键；请求完成或超时必须按单据ID、员工明细ID、文件列名或列表条件回查，未确认前不得换请求重试。取消prepare草稿不产生服务端副作用。'
const evidence = [
  { source: 'src/capabilities/salary-accounting.ts', kind: 'implementation' as const, note: '锁定页面实际调用的列表、三步核算、资格结果、状态门禁、multipart文件、详情发放和临时明细请求。' },
  { source: 'Portal test/portal/main: app/portal/views/dashboard/hr/salary/salary-accounting/{list.vue,step1,step2,step3,detail} 与 components', kind: 'reference' as const, note: '逐页核对表单字段、请求端点、路由步骤、按钮状态和取消边界。' },
  { source: 'Java test/test: SalaryDocumentController/Service、StaffController、SalaryDocumentDetailTemporaryController/Service', kind: 'reference' as const, note: '核对DTO、数据范围、资格判断、结账/发放/拆分状态规则和临时明细更新。' },
  { source: 'test/salary-accounting.test.ts', kind: 'test' as const, note: '离线断言页面与Java源码、请求载荷、反例及契约注册；真实环境写入证据需另行记录。' },
]
const gaps = ['尚未在真实测试环境逐步执行本页列表、三步向导、导入、核算、结账、发放、拆分和回查；当前证据是固定分支源码、Java源码与离线请求断言，不能将离线通过说成线上写入已验证。']

function outputFor (id: string, method: string): AiContract['output'] {
  if (method.startsWith('prepare')) return { shape: '{ draft: object }', fields: [field('draft', 'object', '经本地校验的Portal请求草稿或文件预览')], empty: '非法参数不返回草稿。' }
  if (method === 'list') return documentPageOutput
  if (method === 'get' || method === 'detail') return documentOutput
  if (method === 'stepInfo') return stepOutput
  if (method === 'ledgerItemList') return salaryItemPageOutput
  if (method === 'saveStaff' || method === 'calculate' || method === 'importExternalResult') return eligibilityOutput
  if (method === 'staffList') return staffOutput
  if (method === 'lastStaff') return { shape: '{ staffList: object[], eligibilityResult: object }', fields: [field('staffList', 'object[]', '上次核算人员；合并前按staffCode去重'), field('staffList[].staffCode', 'string | number', '员工工号'), field('staffList[].name', 'string | null', '员工姓名'), field('eligibilityResult', 'object', '上次人员的资格结果'), ...eligibilityOutput.fields.map(item => ({ ...item, path: item.path.replace(/^/, 'eligibilityResult.') }))], empty: 'staffList=[]时没有可复用人员；仍需解释eligibilityResult。' }
  if (method === 'historyUsers' || method === 'organizationTree' || method === 'documentUsers') return method === 'historyUsers' ? historyOutput : arrayOutput
  if (method === 'secondTemplate' || method === 'externalTemplate' || method === 'detailExport') return fileOutput
  if (method === 'prepareStaffImport' || method === 'prepareExternalImport') return previewOutput
  if (method === 'existingExternalItems' || method === 'externalAccountResult') return stringArrayOutput
  if (method === 'externalItems') return { shape: 'object[]', fields: [field('[]', 'object', '账套外部薪资项目'), field('[].id', 'string | number | null', '外部薪资项目ID'), field('[].name', 'string | null', '外部薪资项目名称')], empty: '[]表示账套没有外部薪资项目，第三步无需导入。' }
  if (method === 'detailUsers') return detailUsersOutput
  if (method === 'temporaryDetailList') return temporaryPageOutput
  if (method === 'checkout') return textOutput
  return boolOutput
}

function base (id: string, purpose: string, consume: string[], extra: Partial<AiContract> = {}): AiContract {
  const method = SALARY_ACCOUNTING_METHODS[id as keyof typeof SALARY_ACCOUNTING_METHODS]
  if (!method) throw new Error(`薪资核算契约没有方法映射：${id}`)
  const definition = definitions.get(id)!
  const effect: AiContract['effect'] = method.startsWith('prepare') ? 'prepare' : definition.write ? 'write' : 'read'
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作 Portal /dashboard/salary/salary-accounting 权限下的薪资核算单据；页面使用platform实例并由页面上下文推导module-type=14。',
      '列表服务端按当前角色可见账套和组织数据范围过滤；空分页不是权限绕过。写入时仍必须使用当前页面最新单据、员工资格结果和状态，服务端会再次校验。',
      '所有写入按 prepare → submit；用户取消只丢弃本地草稿/文件预览。Portal没有通用安全撤销端点，提交成功或超时都要回查。',
    ],
    effect,
    prerequisites: ['使用同一用户、租户和会话token创建SDK；ID、账套、组织和员工工号必须来自当前用户已核实的页面结果。'],
    inputs: typedInputsOf(id),
    output: outputFor(id, method),
    consume,
    steps: [],
    completion: '按返回契约消费结果；涉及写入时完成独立回查后再报告完成。',
    failures: ['非法ID、月份、日期、状态、重复数组项、必填项、分页值或文件在发请求前失败；401/403、网络和Java业务错误原样抛出。', '资格结果中的排除人员必须逐项展示原因；不能用请求数量代替processedCount。', '身份证号、银行卡号和工资金额属于敏感业务数据，不写入无关日志。'],
    idempotency: effect === 'write' ? writeIdempotency : null,
    evidence,
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {}
for (const [id, method] of Object.entries(SALARY_ACCOUNTING_METHODS)) {
  contracts[id] = base(id, `调用薪资核算页面的${method}能力。`, ['按返回shape读取页面需要的数据；写入方法必须在结果不确定时重新查询核实。'])
}

const prepare = (id: string, purpose: string, output: AiContract['output'], capabilityId: string, mapping: Record<string, string>, consume: string[]): void => {
  const current = contracts[id]!
  contracts[id] = { ...current, purpose, whenToUse: purpose, effect: 'prepare', output, idempotency: null, steps: [{ role: 'required', when: '用户确认提交草稿', capabilityId, mapping, instruction: '将同一份经过确认的草稿交给对应submit能力；不要重新拼接或替换ID。' }, { role: 'cancel', when: '用户取消确认', instruction: '丢弃本地草稿或文件预览，不调用写接口。' }], consume, completion: '得到无副作用的提交草稿，等待用户确认。' }
}

prepare('salary-accounting-prepare-create', '准备第一步薪资核算单据草稿；组织、账套、工资月份和成本月份必须齐全，单据名称沿用Portal自动生成值也可为空。', draftOutput([
  field('draft.organizationId', 'string | number', '角色组织ID；提交使用此ID'), field('draft.ledgerId', 'string | number', '账套ID'), field('draft.salaryMonth', 'string', '工资月份，YYYY-MM'), field('draft.costMonth', 'string', '成本归属月份，YYYY-MM'), field('draft.name', 'string', '单据名称；Portal该字段校验已注释，允许空字符串'),
]), 'salary-accounting-create', { organizationId: 'result.draft.organizationId', ledgerId: 'result.draft.ledgerId', salaryMonth: 'result.draft.salaryMonth', costMonth: 'result.draft.costMonth', name: 'result.draft.name' }, ['取消时不创建单据；确认后调用create，再用list/detail按返回ID核实。'])
prepare('salary-accounting-prepare-save-staff', '准备第二步核算人员名单；先把页面候选按staffCode去重，再确认资格结果和排除原因。', draftOutput([field('draft.documentId', 'string | number', '薪资单据ID'), field('draft.staffList', 'object[]', '提交的员工对象数组'), field('draft.staffList[].id', 'string | number | null', '员工/单据员工ID'), field('draft.staffList[].name', 'string | null', '员工姓名'), field('draft.staffList[].staffCode', 'string | number', '员工工号；服务端按此字段识别'), field('draft.staffList[].status', 'number | null', '页面回显状态')]), 'salary-accounting-save-staff', { documentId: 'result.draft.documentId', staffList: 'result.draft.staffList' }, ['保存后按eligibilityResult.processedStaffCodes和excludedStaffList逐项消费；processedCount=0时Portal不进入第三步。'])
prepare('salary-accounting-prepare-calculate', '准备执行薪资核算；重新核算只允许当前单据未结账（status=0），新建流程可不传当前状态。', draftOutput([field('draft.documentId', 'string | number', '待核算单据ID')]), 'salary-accounting-calculate', { documentId: 'result.draft.documentId' }, ['确认单据仍未结账后提交；核算结果必须按资格结果和detail回查。'])
prepare('salary-accounting-prepare-remove', '准备删除未结账薪资单据；必须逐个提供最新status=0。', { shape: '{ ids: (string | number)[] }', fields: [field('ids', '(string | number)[]', '经状态校验的单据ID数组')], empty: '空数组、重复ID或任一status不是0时失败。' }, 'salary-accounting-remove', { ids: 'result.ids', currentStatuses: 'args.currentStatuses' }, ['删除不可用单据后仍应list回查目标ID已消失；不把成功空回执当作证据。'])
prepare('salary-accounting-prepare-checkout', '准备结账或取消结账；结账要求当前全部status=0，取消结账要求当前全部status=1。', { shape: '{ ids: (string | number)[], status: number }', fields: [field('ids', '(string | number)[]', '经状态校验的单据ID数组'), field('status', 'number', '1结账、0取消结账')], empty: '空数组、重复ID或状态与动作不匹配时失败。' }, 'salary-accounting-checkout', { ids: 'result.ids', status: 'result.status', currentStatuses: 'args.currentStatuses' }, ['取消结账仍可能被Java因员工已发放而拒绝；成功或超时后按ID重新list/detail核对status。'])
prepare('salary-accounting-prepare-staff-import', '准备第二步核算人员Excel预览；只校验文件，不发上传请求。', previewOutput, 'salary-accounting-staff-import', { documentId: 'context.documentId', orgId: 'context.orgId', fileName: 'result.fileName', base64: 'args.base64', contentType: 'result.contentType' }, ['Portal只接受xlsx MIME；确认后由staffImport上传同一文件并消费资格结果；取消不发multipart请求。'])
prepare('salary-accounting-prepare-external-import', '准备第三步外部薪资项目Excel预览；只校验文件，不发上传请求。', previewOutput, 'salary-accounting-external-account-result', { documentId: 'context.documentId', type: 'context.type', fileName: 'result.fileName', base64: 'args.base64', contentType: 'result.contentType' }, ['匹配类型1=身份证号、2=员工号；确认后上传同一文件，之后仍须调用importResult才会提交临时结果并继续核算。'])
prepare('salary-accounting-prepare-pay', '准备发放工资草稿；单据必须最新status=1且每个员工明细最新status=0，发放时间必须是有效日期。', draftOutput([field('draft.documentId', 'string | number', '已结账单据ID'), field('draft.idList', '(string | number)[]', '待发放的员工明细ID'), field('draft.grantTime', 'string', '发放日期，YYYY-MM-DD')]), 'salary-accounting-pay', { documentId: 'result.draft.documentId', idList: 'result.draft.idList', grantTime: 'result.draft.grantTime', documentStatus: 'args.documentStatus', currentStatuses: 'args.currentStatuses' }, ['发放成功或超时后调用detailUsers回查每个idList的status=1和grantTime。'])
prepare('salary-accounting-prepare-rename', '准备修改薪资单据名称；名称不能为空，Portal详情页当前入口被注释但Controller仍提供该能力。', draftOutput([field('draft.id', 'string | number', '单据ID'), field('draft.name', 'string', '新单据名称')]), 'salary-accounting-rename', { id: 'result.draft.id', name: 'result.draft.name' }, ['确认该ID仍属于当前用户可见单据后提交；用detail回查完整新名称。'])
prepare('salary-accounting-prepare-split', '准备拆分已完成且未结账单据；每个单据必须最新status=0、step=4，员工工号不能重复。', draftOutput([field('draft.ids', '(string | number)[]', '待拆分单据ID数组'), field('draft.name', 'string', '新单据名称，最多30字且不能全空格'), field('draft.staffCodeList', '(string | number)[]', '从源单据员工中选择的工号数组')]), 'salary-accounting-split', { documentIds: 'result.draft.ids', name: 'result.draft.name', staffCodeList: 'result.draft.staffCodeList', currentStatuses: 'args.currentStatuses', currentSteps: 'args.currentSteps' }, ['Java还会校验相同账套、工资月份、组织、成本月份以及员工归属；成功后重新list并读取新单据。'])
prepare('salary-accounting-prepare-temporary-detail-update', '准备保存外部薪资项目临时明细的局部值修改；只提交实际修改的临时明细ID和值。', { shape: '{ updates: object[] }', fields: [field('updates', 'object[]', '待保存的临时明细变化'), field('updates[].id', 'string | number', '临时明细ID'), field('updates[].value', 'number | string | null', '新值')], empty: 'updates为空或ID非法时失败。' }, 'salary-accounting-temporary-detail-update', { updates: 'result.updates' }, ['保存后重新temporaryDetailList按项目和员工核对value；取消不发请求。'])

contracts['salary-accounting-create'] = { ...contracts['salary-accounting-create']!, purpose: '创建第一步薪资核算单据。', whenToUse: '已确认组织、账套、工资月份和成本月份后创建新单据。', output: idOutput, consume: ['保存返回的单据ID；随后读取stepInfo(step=2)或list确认组织、账套、月份和名称均正确。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-accounting-get', mapping: { id: 'result.$' }, instruction: '按返回ID读取单据，核对本次表单字段；超时先回查再决定是否重试。' }] }
contracts['salary-accounting-save-staff'] = { ...contracts['salary-accounting-save-staff']!, purpose: '保存第二步薪资核算人员名单并执行服务端资格检查。', whenToUse: '已通过员工选择、上次人员或Excel预览得到名单后提交。', consume: ['逐项读取processedStaffCodes、processedCount和excludedStaffList；Java还会检查工资办理资格、员工已入职和有效薪资事务。'], steps: [{ role: 'required', when: '返回资格结果', capabilityId: 'salary-accounting-step-info', mapping: { id: 'args.documentId', step: 'literal:2' }, instruction: 'processedCount大于0后读取第二步结果，确认页面名单与实际处理员工一致。' }] }
contracts['salary-accounting-calculate'] = { ...contracts['salary-accounting-calculate']!, purpose: '执行第三步后的薪资核算。', whenToUse: '没有外部项目或已完成importResult后，对未结账单据执行计算。', output: eligibilityOutput, consume: ['processedCount=0时不要直接报告完成；按excludedStaffList解释资格失败。成功后调用detail和detailUsers独立核对核算结果。'], steps: [{ role: 'required', when: '返回资格结果', capabilityId: 'salary-accounting-detail', mapping: { id: 'args.documentId' }, instruction: '读取结果单据，再按detailUsers逐页核对明细和summary。' }] }
contracts['salary-accounting-remove'] = { ...contracts['salary-accounting-remove']!, purpose: '删除未结账薪资核算单据。', whenToUse: '仅对最新列表中全部status=0的单据执行。', consume: ['服务端软删除单据及明细；成功或超时后重新list确认这些ID不再出现。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-accounting-list', instruction: '使用原筛选条件和ids回查，不能只看空回执。' }] }
contracts['salary-accounting-checkout'] = { ...contracts['salary-accounting-checkout']!, purpose: '批量结账或取消结账薪资单据。', whenToUse: '结账前全部单据为status=0；取消结账前全部单据为status=1。', consume: ['取消结账若任一员工已发放会被Java拒绝；成功后回查单据status。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-accounting-list', instruction: '按ids重新查询并逐个核对status与操作目标一致。' }] }
contracts['salary-accounting-cancel-checkout'] = { ...contracts['salary-accounting-cancel-checkout']!, purpose: '取消已结账薪资单据。', whenToUse: '只对最新status=1的单据调用；若员工已发放，服务端会拒绝。', consume: ['回查单据status=0；不得把成功回执理解为员工发放状态回滚。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-accounting-list', instruction: '逐个回查目标单据status。' }] }
contracts['salary-accounting-staff-import'] = { ...contracts['salary-accounting-staff-import']!, purpose: '上传第二步核算人员Excel并返回候选人员和资格结果。', whenToUse: '先prepareStaffImport确认同一文件，再在第二步导入弹窗提交。', consume: ['读取staffList并按staffCode去重合并；逐项展示eligibilityResult排除原因，之后仍需saveStaff才能写入单据人员名单。'], steps: [{ role: 'required', when: '上传返回', capabilityId: 'salary-accounting-prepare-save-staff', instruction: '将合并后的staffList交给第二步prepare/save，而不是把文件上传成功当作已保存。' }] }
contracts['salary-accounting-second-template'] = { ...contracts['salary-accounting-second-template']!, purpose: '下载第二步核算人员Excel模板。', whenToUse: '用户要按Portal模板准备核算人员导入文件。', consume: ['SDK先读取Portal返回的URL，再用同一会话下载非空二进制；保存返回fileName和Base64。'] }
contracts['salary-accounting-external-account-result'] = { ...contracts['salary-accounting-external-account-result']!, purpose: '上传并校验第三步外部薪资项目文件。', whenToUse: '第三步存在外部薪资项目且用户确认了匹配类型和文件。', consume: ['返回列名数组仅表示临时校验结果；随后必须调用importResult提交临时结果并继续核算。'], steps: [{ role: 'required', when: '文件校验成功', capabilityId: 'salary-accounting-import-result', mapping: { documentId: 'args.documentId' }, instruction: '确认列名匹配后提交临时导入结果；取消则不调用importResult。' }] }
contracts['salary-accounting-import-result'] = { ...contracts['salary-accounting-import-result']!, purpose: '提交第三步外部薪资项目临时结果并继续核算。', whenToUse: 'externalAccountResult已校验出导入列名且用户确认继续。', consume: ['读取资格结果；processedCount大于0后进入detail，否则逐项处理排除原因。'], steps: [{ role: 'required', when: '返回资格结果', capabilityId: 'salary-accounting-detail', mapping: { id: 'args.documentId' }, instruction: '按单据ID读取详情和员工明细核实核算结果。' }] }
contracts['salary-accounting-external-template'] = { ...contracts['salary-accounting-external-template']!, purpose: '下载第三步外部薪资项目导入模板。', whenToUse: '用户已选择按身份证号或员工号匹配，且页面存在外部薪资项目。', consume: ['type=1对应身份证号，type=2对应员工号；保存非空文件，不把URL当文件内容。'] }
contracts['salary-accounting-pay'] = { ...contracts['salary-accounting-pay']!, purpose: '向已结账单据发放选中员工工资。', whenToUse: '单据status=1且选择的员工明细status全部为0。', consume: ['成功或超时后detailUsers逐页核对每个idList的status=1和grantTime；已发放行不能重复选择。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-accounting-detail-users', mapping: { documentId: 'args.documentId' }, instruction: '重新查询明细并核对本次员工ID。' }] }
contracts['salary-accounting-rename'] = { ...contracts['salary-accounting-rename']!, purpose: '修改薪资核算单据名称。', whenToUse: '已确认单据ID和非空新名称后调用；Portal详情页当前入口注释但Java Controller仍可处理。', consume: ['成功或超时后detail回查完整name。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-accounting-detail', mapping: { id: 'args.id' }, instruction: '读取并比较完整单据名称。' }] }
contracts['salary-accounting-split'] = { ...contracts['salary-accounting-split']!, purpose: '从已完成核算且未结账单据中拆出选定员工。', whenToUse: '当前单据全部status=0、step=4，且员工工号来自getDocumentUsers结果。', consume: ['Java还会校验单据账套、工资月份、组织、成本月份一致和员工归属；成功后用list/detail确认新单据及员工分配。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-accounting-list', instruction: '重新查询源单据和新单据，逐项核对名称、人员数和员工工号。' }] }
contracts['salary-accounting-temporary-detail-update'] = { ...contracts['salary-accounting-temporary-detail-update']!, purpose: '保存第三步外部薪资项目临时明细的批量值修改。', whenToUse: '只提交edit弹窗中用户实际修改的临时明细。', consume: ['保存成功后按documentId、itemId和staffName重新temporaryDetailList核对每个value；这是临时数据写入，不等于已完成核算。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'salary-accounting-temporary-detail-list', instruction: '重新读取相同项目并核对被修改的临时明细ID和值。' }] }

export const SALARY_ACCOUNTING_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALARY_ACCOUNTING_METHODS).map(id => [id, contracts[id]!]))
export const SALARY_ACCOUNTING_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALARY_ACCOUNTING_METHODS).map(([id, method]) => [`salaryAccounting.${method}`, SALARY_ACCOUNTING_AI_CONTRACTS[id]!]))
