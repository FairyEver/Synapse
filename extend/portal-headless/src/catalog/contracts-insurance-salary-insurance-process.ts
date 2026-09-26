import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INSURANCE_SALARY_INSURANCE_PROCESS_METHODS } from '../capabilities/insurance-salary-insurance-process.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用姓名、行号或组织名称代替ID']

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '员工社保记录ID；当前页批量调整使用staffCode', { optional: true, nullable: true, nullMeaning: '后端未返回记录ID' }),
  field('list[].staffCode', 'string | number', '员工工号；社保缴存单位/成本中心调整使用', { constraints: idRules }),
  field('list[].name', 'string', '员工姓名', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('list[].organizationPath', 'string', '组织全路径', { nullable: true, nullMeaning: '后端未返回组织路径' }),
  field('list[].postName', 'string', '岗位名称', { nullable: true, nullMeaning: '后端未返回岗位' }),
  field('list[].idCard', 'string', '身份证文本，按原值返回', { nullable: true, nullMeaning: '后端未返回身份证' }),
  field('list[].householdType', 'integer', '户口性质字典值：1农业、2非农业', { nullable: true, nullMeaning: '后端未返回字典值' }),
  field('list[].employmentType', 'integer', '用工类型字典值：1全日制、2非全日制', { nullable: true, nullMeaning: '后端未返回字典值' }),
  field('list[].entryTime', 'string', '入职时间，完整日期时间', { nullable: true, nullMeaning: '后端未返回入职时间', format: 'YYYY-MM-DD HH:mm:ss' }),
  field('list[].depositUnitName', 'string', '缴存单位名称', { nullable: true, nullMeaning: '后端未返回缴存单位' }),
  field('list[].depositUnitId', 'string | number', '缴存单位ID', { optional: true, nullable: true, nullMeaning: '未设置缴存单位', constraints: idRules }),
  field('list[].costCenterName', 'string', '成本中心名称', { nullable: true, nullMeaning: '后端未返回成本中心' }),
  field('list[].costCenterId', 'string | number', '成本中心ID', { optional: true, nullable: true, nullMeaning: '未设置成本中心', constraints: idRules }),
  field('list[].costCenter', 'string', '成本中心展示文本', { nullable: true, nullMeaning: '后端未返回成本中心文本' }),
  field('list[].organizationId', 'string | number', '组织ID', { optional: true, nullable: true, nullMeaning: '后端未返回组织ID', constraints: idRules }),
  field('list[].postId', 'string | number', '岗位ID', { optional: true, nullable: true, nullMeaning: '后端未返回岗位ID', constraints: idRules }),
  field('list[].insuredArea', 'string', '投保地编码或文本', { nullable: true, nullMeaning: '后端未返回投保地' }),
  field('list[].insuranceStatus', 'integer', '投保状态：1未参保、2参保中、3已停保', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('list[].insuranceStatusName', 'string', '投保状态显示名', { nullable: true, nullMeaning: '后端未返回状态名' }),
  field('list[].staffStatus', 'integer', '员工在职状态：1在职、2离职', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('list[].staffStatusName', 'string', '员工在职状态显示名', { nullable: true, nullMeaning: '后端未返回状态名' }),
  field('list[].insuranceStartDate', 'string', '参保日期', { nullable: true, nullMeaning: '未参保或后端未返回', format: 'YYYY-MM-DD' }),
  field('list[].insuranceStopDate', 'string', '停保日期', { nullable: true, nullMeaning: '未停保或后端未返回', format: 'YYYY-MM-DD' }),
  field('list[].depositBase', 'number | string', '缴存/参保基数；不换算单位', { nullable: true, nullMeaning: '后端未返回基数' }),
  field('list[].reductionReason', 'string', '减员原因字典值', { nullable: true, nullMeaning: '未停保或后端未返回' }),
  field('total', 'integer', '符合筛选的总记录数，不是当前页长度'),
]
const pageOutput: AiContract['output'] = { shape: '{ list: array, total: integer }', fields: [field('$', 'object', '社保办理分页结果'), field('list', 'array', '当前页记录，不是全部数据'), field('list[]', 'object', '一条社保办理记录'), ...rowFields], empty: 'list=[]且total=0表示筛选无记录；权限或响应形状错误会抛出。' }
const queryInputs: Record<string, AiParameter> = {
  name: optional('员工姓名筛选', '页面姓名输入框', 'SDK发送空字符串，不限制姓名', { type: 'string', nullable: true }),
  orgIds: optional('角色组织ID数组', '页面角色组织树多选', 'SDK发送空字符串，不限制组织', { type: 'array<string | number> | string', nullable: true, constraints: ['数组ID按Portal转换为逗号字符串'] }),
  staffStatus: optional('在职状态字典值', '页面在职状态下拉框', 'SDK发送null，不限制状态', { type: 'integer', nullable: true }),
  insuranceStatus: optional('参保状态字典值', '页面参保状态下拉框', 'SDK发送null，不限制状态', { type: 'integer', nullable: true }),
  entryTime: optional('入职日期范围', '页面日期范围选择器', 'SDK发送entryTimeStart和entryTimeEnd为null；结束日按Portal转成次日排他', { type: 'array<string | null>', format: 'YYYY-MM-DD' }),
  businessDate: optional('办理业务日期', 'Portal formatDay()；省略时SDK使用当天', 'SDK使用当天', { type: 'string', format: 'YYYY-MM-DD' }),
  pageNo: optional('页码', '页面分页状态', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('页大小', '页面分页状态', 'SDK默认20', { type: 'integer', constraints: ['10、20、50、100、200、500'] }),
}
const depositInputs: Record<string, AiParameter> = { staffCodes: input('员工工号数组', '当前列表选中行staffCode', { type: 'array<string | number>', constraints: ['非空', ...idRules] }), depositUnitId: input('缴存单位ID', '调整弹窗选择', { type: 'string | number', constraints: idRules }) }
const costInputs: Record<string, AiParameter> = { staffCodes: input('员工工号数组', '当前列表选中行staffCode', { type: 'array<string | number>', constraints: ['非空', ...idRules] }), costCenterId: input('成本中心ID', '调整弹窗选择', { type: 'string | number', constraints: idRules }) }
const yearBaseInputs: Record<string, AiParameter> = {
  orgIds: input('年度基数所属组织ID数组', '年度基数弹窗角色组织树多选', { type: 'array<string | number> | string', constraints: ['非空；后端单次最多500个组织'] }),
  startDate: input('年度基数起始月份', '年度基数弹窗月份范围起点', { type: 'string', format: 'YYYY-MM' }),
  endDate: input('年度基数结束月份', '年度基数弹窗月份范围终点', { type: 'string', format: 'YYYY-MM' }),
}
const fileOutput: AiContract['output'] = { shape: '{ fileName, contentType, base64, byteLength }', fields: [field('$', 'object', '二进制文件内存表示'), field('fileName', 'string', '响应文件名；年度基数由后端带时间戳'), field('contentType', 'string | null', '响应Content-Type', { nullable: true }), field('base64', 'string', '文件内容Base64'), field('byteLength', 'integer', '原始字节数')], empty: '空文件响应失败。' }
const voidOutput: AiContract['output'] = { shape: 'void', fields: [field('$', 'void', 'Portal成功响应无业务data；未抛错只表示请求完成')], empty: '请求失败时抛错。' }
const treeOutput: AiContract['output'] = { shape: 'array', fields: [field('$', 'array', '当前会话可见组织或地区树根节点'), field('[].id', 'string | number', '节点ID', { constraints: idRules }), field('[].name', 'string', '节点名称'), field('[].children', 'array', '子节点')], empty: '[]表示当前会话没有可见节点。' }
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:acab69acc7 app/portal/views/dashboard/hr/insurance/process/{list.vue,increase/list.vue,reduce/list.vue}', kind: 'reference', note: '证明主页面菜单可达的增员/减员子页、bridge行数据、完整请求body、POST /salary/salaryinsurance/insure、PUT /salary/salaryinsurance/terminate、年度基数下载和列表导出。固定检出未pull。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:0f1a55718e SalaryInsuranceController、SalaryFundSelectDTO、SalaryInsuranceDTO、SalaryYearBaseSelectDTO、SalaryInsuranceServiceImpl、HrStaffSalaryEligibilityResultDTO、HrStaffSalaryExcludedDTO', kind: 'reference', note: '证明增员/减员端点的List DTO body、资格结果字段、分页和导出端点、年度基数组织上限及后端权限范围。固定检出未pull。' },
  { source: 'src/capabilities/insurance-salary-insurance-process.ts', kind: 'implementation', note: '证明SDK的查询转换、批量更新、二进制导出和动态Content-Disposition文件名处理。' },
  { source: 'test/insurance-salary-insurance-process.test.ts', kind: 'test', note: '离线锁定页面筛选、请求体、两个导出端点、权限和坏响应。' },
]
const gaps = ['未启动浏览器、未取得独立网络基准、未在真实测试环境执行读请求或prepare→submit→cancel写闭环；本契约来自固定源码、Java源码和离线测试。', 'Portal/Java固定检出未按任务约束pull到远端最新，部署版本差异未验证。']
function base (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“社保办理”列表页的筛选、缴存单位/成本中心调整、从菜单可达的增员/减员子页动作、年度基数生成和列表导出。',
    boundaries: ['能力对应页面路径为/dashboard/insurance/process/list，权限为/dashboard/insurance/process，moduleType固定为14，HTTP实例为platform；列表页的增员、减员按钮实际路由到./increase/list?bridge=和./reduce/list?bridge=。', '增员/减员只实现上述菜单可达子页的活动动作；prepare和cancel不发HTTP，submit只按Portal原始行数组调用对应端点。', '年度基数是浏览器打开的二进制下载，SDK以同一GET请求返回文件；后端对组织数量最多500个的规则仍生效。组织树使用页面实际的getRoleOrganizationTree，不能扩大为全量组织。'],
    prerequisites: ['已建立带有效会话token、tenantId和platform页面上下文的SDK。'],
    failures: ['非法ID、日期、月份、分页或空批量输入在发请求前失败；分页/文件响应形状错误时抛错。', '401/403、网络错误和后端业务错误原样抛出；写请求完成或超时后按同一员工回查。'],
    evidence,
    gaps,
    ...value,
  }
}
const prepareOutput = (description: string, target: string): AiContract['output'] => ({ shape: '{ draft: array }', fields: [field('$', 'object', description), field('draft', 'array', '可供确认或提交的批量草稿'), field('draft[].staffCode', 'string | number', '员工工号', { constraints: idRules }), field(`draft[].${target}`, 'string | number', '目标ID', { constraints: idRules })], empty: '非法输入不返回草稿。' })
const insuranceActionRowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '后端记录ID；保留Portal原值', { optional: true, nullable: true, nullMeaning: '后端未返回记录ID' }),
  field(`${prefix}.staffCode`, 'string | number', '员工工号；增员/减员资格和列表回查的人员键', { constraints: idRules }),
  field(`${prefix}.name`, 'string', '员工姓名；保留Portal原值', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field(`${prefix}.organizationPath`, 'string', '组织全路径；保留Portal原值', { nullable: true, nullMeaning: '后端未返回组织路径' }),
  field(`${prefix}.postName`, 'string', '岗位名称；保留Portal原值', { nullable: true, nullMeaning: '后端未返回岗位' }),
  field(`${prefix}.idCard`, 'string', '身份证文本；保留Portal原值', { nullable: true, nullMeaning: '后端未返回身份证' }),
  field(`${prefix}.householdType`, 'integer', '户口性质字典值：1农业、2非农业', { nullable: true, nullMeaning: '后端未返回字典值' }),
  field(`${prefix}.employmentType`, 'integer', '用工类型字典值：1全日制、2非全日制', { nullable: true, nullMeaning: '后端未返回字典值' }),
  field(`${prefix}.entryTime`, 'string', '入职时间，完整日期时间', { nullable: true, nullMeaning: '后端未返回入职时间', format: 'YYYY-MM-DD HH:mm:ss' }),
  field(`${prefix}.depositUnitName`, 'string', '缴存单位名称；保留Portal原值', { nullable: true, nullMeaning: '后端未返回缴存单位名称' }),
  field(`${prefix}.depositUnitId`, 'string | number', '缴存单位ID；保留Portal原值', { optional: true, nullable: true, nullMeaning: '未设置缴存单位', constraints: idRules }),
  field(`${prefix}.costCenterName`, 'string', '成本中心名称；保留Portal原值', { nullable: true, nullMeaning: '后端未返回成本中心名称' }),
  field(`${prefix}.costCenterId`, 'string | number', '成本中心ID；保留Portal原值', { optional: true, nullable: true, nullMeaning: '未设置成本中心', constraints: idRules }),
  field(`${prefix}.costCenter`, 'string', '成本中心展示文本；保留Portal原值', { optional: true, nullable: true, nullMeaning: 'Portal行未返回成本中心文本' }),
  field(`${prefix}.organizationId`, 'string | number', '组织ID；保留Portal原值', { optional: true, nullable: true, nullMeaning: '后端未返回组织ID', constraints: idRules }),
  field(`${prefix}.postId`, 'string | number', '岗位ID；保留Portal原值', { optional: true, nullable: true, nullMeaning: '后端未返回岗位ID', constraints: idRules }),
  field(`${prefix}.insuredArea`, 'string', '投保地编码或文本；保留Portal原值', { nullable: true, nullMeaning: '后端未返回投保地' }),
  field(`${prefix}.insuranceStatus`, 'integer', '投保状态字典值：1未参保、2参保中、3已停保', { nullable: true, nullMeaning: '后端未返回状态' }),
  field(`${prefix}.insuranceStatusName`, 'string', '投保状态显示名；保留Portal原值', { optional: true, nullable: true, nullMeaning: '后端未返回状态名' }),
  field(`${prefix}.staffStatus`, 'integer', '员工在职状态字典值：1在职、2离职', { nullable: true, nullMeaning: '后端未返回状态' }),
  field(`${prefix}.staffStatusName`, 'string', '员工在职状态显示名；保留Portal原值', { optional: true, nullable: true, nullMeaning: '后端未返回状态名' }),
  field(`${prefix}.insuranceStartDate`, 'string', '增员参保日期；submit时按Portal截取为YYYY-MM-DD', { nullable: true, nullMeaning: '未参保或未填写', format: 'YYYY-MM-DD' }),
  field(`${prefix}.insuranceStopDate`, 'string', '减员停保日期；submit时按Portal截取为YYYY-MM-DD', { nullable: true, nullMeaning: '增员草稿通常为空', format: 'YYYY-MM-DD' }),
  field(`${prefix}.depositBase`, 'number | string', '社保缴存基数；不换算单位', { nullable: true, nullMeaning: '后端未返回基数' }),
  field(`${prefix}.reductionReason`, 'string', '减员原因字典值；减员submit必需', { nullable: true, nullMeaning: '增员草稿通常为空' }),
]
const insurancePrepareOutput = (description: string): AiContract['output'] => ({ shape: '{ draft: object[] }', fields: [field('$', 'object', description), field('draft', 'array', '由Portal完整行转换出的待确认批量草稿；不是只含staffCode的摘要'), field('draft[]', 'object', '一条完整Portal办理行；未列出的Portal行属性也原样保留'), ...insuranceActionRowFields('draft[]')], empty: '非法输入不返回草稿。' })
const insuranceRowsInput = (action: string, editable: string): Record<string, AiParameter> => ({ rows: input(`社保${action}子页的完整列表行数组`, `主菜单社保办理页选择员工后路由到./${action === '增员' ? 'increase' : 'reduce'}/list?bridge=；提交前保留Portal行字段`, { type: 'array<object>', constraints: [`非空数组；每项至少包含staffCode并保留完整Portal行对象`, `${editable}`, 'ID使用安全正整数或其十进制字符串；日期按YYYY-MM-DD或Portal行的完整日期时间'] }) })
const insuranceDraftInput = (action: string, endpoint: string, editable: string): Record<string, AiParameter> => ({ draft: input(`prepare${action === '增员' ? 'Insure' : 'Terminate'}返回的完整${action}草稿数组`, `prepare${action === '增员' ? 'Insure' : 'Terminate'}的result.draft；submit会把它作为${endpoint}的HTTP data数组`, { type: 'array<object>', constraints: [`非空数组；不要改成只含staffCode的对象或包成{draft:...}`, editable, '除Portal规定的日期截取外保留每行全部字段'] }) })
const insuranceEligibilityOutput: AiContract['output'] = { shape: '{ processedIds: array, processedStaffCodes: array, processedCount: integer, eligibleStaffIds: array, eligibleStaffCodes: array, excludedStaffList: object[] }', fields: [field('$', 'object', 'Portal增员接口返回的员工薪资业务资格结果'), field('processedIds', 'array', '本次实际处理成功的业务或员工ID'), field('processedIds[]', 'string | number', '已处理记录ID', { constraints: idRules }), field('processedStaffCodes', 'array', '本次实际处理成功的员工工号'), field('processedStaffCodes[]', 'string | number', '已处理员工工号', { constraints: idRules }), field('processedCount', 'integer', '本次实际处理成功数量；以安全整数返回'), field('eligibleStaffIds', 'array', '符合资格的员工ID'), field('eligibleStaffIds[]', 'string | number', '符合资格的员工ID', { constraints: idRules }), field('eligibleStaffCodes', 'array', '符合资格的员工工号'), field('eligibleStaffCodes[]', 'string | number', '符合资格的员工工号', { constraints: idRules }), field('excludedStaffList', 'array', '因状态、日期或其他业务规则被排除的员工及原因'), field('excludedStaffList[]', 'object', '一条被排除员工记录'), field('excludedStaffList[].staffId', 'string | number', '被排除员工ID', { optional: true, nullable: true, nullMeaning: '后端未提供员工ID', constraints: idRules }), field('excludedStaffList[].staffCode', 'string | number', '被排除员工工号', { optional: true, nullable: true, nullMeaning: '后端未提供员工工号', constraints: idRules }), field('excludedStaffList[].staffName', 'string', '被排除员工姓名', { optional: true, nullable: true, nullMeaning: '后端未提供姓名' }), field('excludedStaffList[].status', 'integer', '被排除员工状态字典值', { optional: true, nullable: true, nullMeaning: '后端未提供状态' }), field('excludedStaffList[].downtimePay', 'string', '停薪日期', { optional: true, nullable: true, nullMeaning: '后端未提供停薪日期', format: 'YYYY-MM-DD' }), field('excludedStaffList[].businessDate', 'string', '业务日期', { optional: true, nullable: true, nullMeaning: '后端未提供业务日期', format: 'YYYY-MM-DD' }), field('excludedStaffList[].reasonCode', 'string', '排除原因编码', { optional: true, nullable: true, nullMeaning: '后端未提供原因编码' }), field('excludedStaffList[].reason', 'string', '排除原因文本', { optional: true, nullable: true, nullMeaning: '后端未提供原因文本' })], empty: '资格结果数组为空表示没有对应类别记录；请求失败或响应缺字段时抛错。' }
const insuranceActionCompletedOutput = (action: string): AiContract['output'] => ({ shape: '{ completed: boolean }', fields: [field('$', 'object', `社保${action}请求完成确认对象`), field('completed', 'boolean', '请求Promise正常完成；不等于后端业务状态已独立确认，必须继续列表回查')], empty: '请求失败或超时抛错，不返回完成确认。' })
const insuranceCancelOutput: AiContract['output'] = { shape: '{ cancelled: boolean }', fields: [field('$', 'object', '本地取消确认对象'), field('cancelled', 'boolean', 'true表示丢弃当前草稿；不发Portal请求')], empty: '本地取消始终返回cancelled=true。' }

const RAW: Record<string, AiContract> = {
  'insurance-process-list': base({ purpose: '按Portal“社保办理”筛选员工及参保状态。', effect: 'read', inputs: queryInputs, output: pageOutput, consume: ['按total分页；保留staffCode用于后续调整；按insuranceStatus解释停保/参保显示。'], steps: [{ role: 'optional', when: '需要组织筛选候选', capabilityId: 'insurance-process-organization-tree', mapping: {}, instruction: '读取树后只提交节点ID到args.orgIds。' }, { role: 'optional', when: '需要投保地区名称', capabilityId: 'insurance-process-area-tree', mapping: {}, instruction: '按insuredArea映射展示，不改写原字段。' }], completion: '返回当前筛选页和total。', idempotency: null }),
  'insurance-process-organization-tree': base({ purpose: '读取社保办理页面使用的角色组织树。', effect: 'read', inputs: {}, output: treeOutput, consume: ['选择节点ID填入insurance-process-list的orgIds。'], steps: [], completion: '获得当前会话可见组织树。', idempotency: null }),
  'insurance-process-area-tree': base({ purpose: '读取社保办理页面展示投保地名称所用的地区树。', effect: 'read', inputs: {}, output: treeOutput, consume: ['将insuredArea作为地区节点ID映射名称。'], steps: [], completion: '获得地区树。', idempotency: null }),
  'insurance-process-prepare-insure': base({ purpose: '准备社保增员草稿；对应权限/dashboard/insurance/process下由列表页菜单进入的增员子页，prepare只转换本地rows，不发HTTP。', effect: 'prepare', inputs: insuranceRowsInput('增员', 'insuranceStartDate是必需的增员日期；insuredArea、depositUnitId、costCenterId和depositBase按Portal行原值保留'), output: insurancePrepareOutput('社保增员待确认草稿'), consume: ['展示result.draft完整数组，确认staffCode、insuranceStartDate、投保地、缴存单位、成本中心和缴存基数。', '确认后把result.draft原样映射给insurance-process-insure；取消时调用本地insurance-process-cancel-insure。'], steps: [{ role: 'required', when: '用户确认社保增员草稿', capabilityId: 'insurance-process-insure', mapping: { draft: 'result.draft' }, instruction: '把完整result.draft数组作为submit的draft；不要重新拼成staffCode数组。' }, { role: 'cancel', when: '用户取消社保增员草稿', capabilityId: 'insurance-process-cancel-insure', mapping: {}, instruction: '调用本地cancel能力；不调用Portal端点、不发送HTTP。' }], completion: '返回可供确认的完整增员draft且没有副作用。', idempotency: null }),
  'insurance-process-insure': base({ purpose: '办理社保增员；按Portal使用POST /salary/salaryinsurance/insure，权限/dashboard/insurance/process，HTTP data是完整draft数组。', effect: 'write', inputs: insuranceDraftInput('增员', '/salary/salaryinsurance/insure', '增员字段insuranceStartDate按Portal发送YYYY-MM-DD；其余行字段原样保留'), output: insuranceEligibilityOutput, consume: ['请求为POST /salary/salaryinsurance/insure，body是完整draft数组本身，不使用query参数、form-data或{draft:...}外壳；SDK只按Portal把insuranceStartDate截成YYYY-MM-DD。', '读取processedCount、processedStaffCodes、eligibleStaffCodes和excludedStaffList判断资格结果；成功或超时后用insurance-process-list请求GET /salary/salaryinsurance/page并按原筛选及draft[].staffCode回查insuranceStatus/insuranceStartDate。'], steps: [{ role: 'required', when: '请求成功或超时后需要确认落库', capabilityId: 'insurance-process-list', mapping: {}, instruction: '按原筛选条件重新查询GET /salary/salaryinsurance/page，逐一比较draft[].staffCode对应行的insuranceStatus和insuranceStartDate；HTTP完成不替代回查证据。' }], completion: '返回资格结果，并在列表回查确认实际状态。', idempotency: 'Portal写端点没有requestId，SDK不添加服务端幂等键；完成或超时后按同一staffCode和目标ID回查，未确认前不得盲目重试。' }),
  'insurance-process-cancel-insure': base({ purpose: '取消尚未提交的社保增员草稿；这是本地动作，不对应Portal HTTP端点。', effect: 'local', inputs: {}, output: insuranceCancelOutput, consume: ['丢弃prepare-insure返回的draft，返回cancelled=true；不发送请求，也不改变Portal数据。'], steps: [], completion: '本地返回cancelled=true。', idempotency: null }),
  'insurance-process-prepare-terminate': base({ purpose: '准备社保减员草稿；对应权限/dashboard/insurance/process下由列表页菜单进入的减员子页，prepare只转换本地rows，不发HTTP。', effect: 'prepare', inputs: insuranceRowsInput('减员', 'insuranceStopDate和reductionReason是必需的减员字段；其余Portal行字段原样保留'), output: insurancePrepareOutput('社保减员待确认草稿'), consume: ['展示result.draft完整数组，确认staffCode、insuranceStopDate和reductionReason。', '确认后把result.draft原样映射给insurance-process-terminate；取消时调用本地insurance-process-cancel-terminate。'], steps: [{ role: 'required', when: '用户确认社保减员草稿', capabilityId: 'insurance-process-terminate', mapping: { draft: 'result.draft' }, instruction: '把完整result.draft数组作为submit的draft；不要重新拼成staffCode数组。' }, { role: 'cancel', when: '用户取消社保减员草稿', capabilityId: 'insurance-process-cancel-terminate', mapping: {}, instruction: '调用本地cancel能力；不调用Portal端点、不发送HTTP。' }], completion: '返回可供确认的完整减员draft且没有副作用。', idempotency: null }),
  'insurance-process-terminate': base({ purpose: '办理社保减员；按Portal使用PUT /salary/salaryinsurance/terminate，权限/dashboard/insurance/process，HTTP data是完整draft数组。', effect: 'write', inputs: insuranceDraftInput('减员', '/salary/salaryinsurance/terminate', '减员字段insuranceStopDate按Portal发送YYYY-MM-DD，reductionReason必需；其余行字段原样保留'), output: insuranceActionCompletedOutput('减员'), consume: ['请求为PUT /salary/salaryinsurance/terminate，body是完整draft数组本身，不使用query参数、form-data或{draft:...}外壳；SDK只按Portal把insuranceStopDate截成YYYY-MM-DD。', '成功或超时后用insurance-process-list请求GET /salary/salaryinsurance/page并按原筛选及draft[].staffCode回查insuranceStatus、insuranceStopDate和reductionReason。'], steps: [{ role: 'required', when: '请求成功或超时后需要确认落库', capabilityId: 'insurance-process-list', mapping: {}, instruction: '按原筛选条件重新查询GET /salary/salaryinsurance/page，逐一比较draft[].staffCode对应行的停保状态、停保日期和减员原因；HTTP完成不替代回查证据。' }], completion: '返回请求完成确认，并在列表回查确认实际停保状态。', idempotency: 'Portal写端点没有requestId，SDK不添加服务端幂等键；完成或超时后按同一staffCode和目标ID回查，未确认前不得盲目重试。' }),
  'insurance-process-cancel-terminate': base({ purpose: '取消尚未提交的社保减员草稿；这是本地动作，不对应Portal HTTP端点。', effect: 'local', inputs: {}, output: insuranceCancelOutput, consume: ['丢弃prepare-terminate返回的draft，返回cancelled=true；不发送请求，也不改变Portal数据。'], steps: [], completion: '本地返回cancelled=true。', idempotency: null }),
  'insurance-process-prepare-update-deposit-unit': base({ purpose: '准备社保缴存单位调整草稿。', effect: 'prepare', inputs: depositInputs, output: prepareOutput('缴存单位调整草稿', 'depositUnitId'), consume: ['确认后交给insurance-process-update-deposit-unit；取消时不发请求。'], steps: [{ role: 'required', when: '用户确认调整', capabilityId: 'insurance-process-update-deposit-unit', mapping: { staffCodes: 'result.draft[].staffCode', depositUnitId: 'result.draft[].depositUnitId' }, instruction: '提交员工工号和单位ID。' }, { role: 'cancel', when: '用户取消调整弹窗', instruction: '丢弃草稿，不调用写端点。' }], completion: '获得无副作用草稿。', idempotency: null }),
  'insurance-process-update-deposit-unit': base({ purpose: '批量调整选中员工的社保缴存单位。', effect: 'write', inputs: depositInputs, output: voidOutput, consume: ['按staffCode回查depositUnitId/depositUnitName。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'insurance-process-list', mapping: {}, instruction: '使用原筛选条件重新查询，并按args.staffCodes逐一核对目标单位；列表能力没有staffCodes参数，不能把员工工号伪装成筛选字段。' }], completion: '请求未抛错且回查确认目标单位。', idempotency: 'Portal写端点没有requestId，SDK不添加服务端幂等键；完成或超时后按同一staffCode和目标ID回查，未确认前不得盲目重试。' }),
  'insurance-process-prepare-update-cost-center': base({ purpose: '准备社保成本中心调整草稿。', effect: 'prepare', inputs: costInputs, output: prepareOutput('成本中心调整草稿', 'costCenterId'), consume: ['确认后交给insurance-process-update-cost-center；取消时不发请求。'], steps: [{ role: 'required', when: '用户确认调整', capabilityId: 'insurance-process-update-cost-center', mapping: { staffCodes: 'result.draft[].staffCode', costCenterId: 'result.draft[].costCenterId' }, instruction: '提交员工工号和成本中心ID。' }, { role: 'cancel', when: '用户取消调整弹窗', instruction: '丢弃草稿，不调用写端点。' }], completion: '获得无副作用草稿。', idempotency: null }),
  'insurance-process-update-cost-center': base({ purpose: '批量调整选中员工的社保成本中心。', effect: 'write', inputs: costInputs, output: voidOutput, consume: ['按staffCode回查costCenterId/costCenterName。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'insurance-process-list', mapping: {}, instruction: '使用原筛选条件重新查询，并按args.staffCodes逐一核对目标成本中心；列表能力没有staffCodes参数，不能把员工工号伪装成筛选字段。' }], completion: '请求未抛错且回查确认目标成本中心。', idempotency: 'Portal写端点没有requestId，SDK不添加服务端幂等键；完成或超时后按同一staffCode和目标ID回查，未确认前不得盲目重试。' }),
  'insurance-process-export': base({ purpose: '按社保办理筛选条件导出列表。', effect: 'read', inputs: queryInputs, output: fileOutput, consume: ['调用exportList；保存为社保办理.xlsx；limit使用页面pageSize，pageNo使用页面页码。'], steps: [], completion: '获得非空Excel文件。', idempotency: null }),
  'insurance-process-export-year-base': base({ purpose: '生成选定组织和月份范围的社保年度基数文件。', effect: 'read', inputs: yearBaseInputs, output: fileOutput, consume: ['调用salaryinsurance/export；文件名以响应Content-Disposition为准，后端通常是年度基数加时间戳。', 'orgIds必须来自角色组织树；超过500个组织由后端拒绝。'], steps: [], completion: '获得非空年度基数文件。', idempotency: null }),
}

export const INSURANCE_SALARY_INSURANCE_PROCESS_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(INSURANCE_SALARY_INSURANCE_PROCESS_METHODS).map(id => [id, RAW[id]!]))
export const INSURANCE_SALARY_INSURANCE_PROCESS_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INSURANCE_SALARY_INSURANCE_PROCESS_METHODS).map(([id, method]) => [`insuranceSalaryInsuranceProcess.${method}`, INSURANCE_SALARY_INSURANCE_PROCESS_AI_CONTRACTS[id]!]))
