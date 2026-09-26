import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  REPORT_LEADERSHIP_PROFIT_SALARY_METHODS,
  REPORT_LEADERSHIP_PROFIT_SALARY_MODULE_TYPE,
  REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH,
  REPORT_LEADERSHIP_PROFIT_SALARY_PERMISSION,
  reportLeadershipProfitSalaryCapabilities,
} from '../capabilities/report-leadership-profit-salary.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(reportLeadershipProfitSalaryCapabilities.map(definition => [definition.id, definition]))

const rowFields: AiField[] = [
  field('list', 'object[]', '当前筛选和分页下的领导利润工资计提记录。', { optional: false, nullable: false }),
  field('list[].id', 'string | number | null', '记录ID；编辑和删除目标。', { source: 'Java响应VO的主键ID。' }),
  field('list[].useYearMonth', 'string | null', '计提年月；Portal月份选择器使用YYYY-MM。', { format: 'YYYY-MM' }),
  field('list[].standardUnitId', 'string | number | null', '组织ID；编辑提交时必须使用该ID而不是名称。'),
  field('list[].standardUnitName', 'string | null', '组织名称或路径快照；页面表格展示该字段。'),
  field('list[].provisionAmount', 'number | string | null', '利润计提金额；Java BigDecimal原值，页面按金额列展示。', { unit: '后端原始金额单位；页面未声明换算' }),
  field('list[].status', 'integer | null', '月结状态：0待月结、1已月结；状态为1时Portal隐藏编辑和删除。', { values: { '0': '待月结', '1': '已月结' } }),
  field('list[].costCenterId', 'string | number | null', '后端响应中的成本中心ID；当前Portal页面不展示、不作为编辑表单输入。'),
  field('list[].costCenterName', 'string | null', '后端响应中的成本中心名称；当前Portal页面不展示。'),
  field('list[].name', 'string | null', '后端响应中的姓名字段；当前Portal页面不展示。'),
  field('list[].provisionMonthLowLine', 'number | string | null', '后端响应中的计提月度低线；当前Portal页面不展示。'),
  field('list[].provisionMonthMidLine', 'number | string | null', '后端响应中的计提月度中线；当前Portal页面不展示。'),
  field('list[].provisionMonthHighLine', 'number | string | null', '后端响应中的计提月度高线；当前Portal页面不展示。'),
  field('list[].createTime', 'string | null', '记录创建时间；当前Portal页面不展示。'),
  field('total', 'integer', '当前用户角色组织权限范围内、当前筛选条件下的记录总数，用于翻页。', { optional: false, nullable: false }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: rowFields,
  empty: 'list=[]且total=0表示当前筛选无记录；权限、网络或响应结构错误会抛出，不会静默返回空列表。',
}

const createDraftFields: AiField[] = [
  field('draft', 'object', '无副作用的新建请求草稿。', { optional: false, nullable: false }),
  field('draft.useYearMonth', 'string', '利润工资计提年月。', { optional: false, nullable: false, format: 'YYYY-MM' }),
  field('draft.standardUnitId', 'string | number', '角色组织树选中的组织ID。', { optional: false, nullable: false }),
  field('draft.standardUnitName', 'string | null', 'Portal组织树返回的名称快照；缺省时不放入请求体。'),
  field('draft.provisionAmount', 'number', '利润计提金额；范围0至9999999999.99，按两位小数提交。', { optional: false, nullable: false, unit: '后端原始金额单位' }),
]

const updateDraftFields: AiField[] = [
  ...createDraftFields,
  field('draft.id', 'string | number', '当前列表行记录ID。', { optional: false, nullable: false }),
  field('draft.status', '0', '准备编辑时从当前列表行读取并通过状态门禁；不会发送到Java保存请求体。', { optional: false, nullable: false, values: { '0': '待月结' } }),
]

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', 'Java后端返回的成功回执；不包含写入后的记录内容。', { optional: false, nullable: false })],
  empty: '后端业务错误、权限错误、网络错误或响应不是true时抛出。',
}
const idOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', '新建记录ID。', { optional: false, nullable: false })],
  empty: '后端没有返回正整数ID时抛出。',
}
const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('fileName', 'string', '响应Content-Disposition中的文件名；缺失时使用领导利润工资计提模板.xlsx。', { optional: false, nullable: false }),
    field('contentType', 'string | null', '响应Content-Type；服务端缺失时为null。'),
    field('base64', 'string', '模板二进制内容的标准Base64。', { optional: false, nullable: false }),
    field('byteLength', 'integer', '模板原始字节数；必须大于0。', { optional: false, nullable: false }),
  ],
  empty: '空文件或非二进制响应会抛错。',
}
const previewOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, byteLength }',
  fields: [
    field('fileName', 'string', '原上传文件名。', { optional: false, nullable: false }),
    field('contentType', 'string', '上传MIME类型；未提供时按扩展名推断。', { optional: false, nullable: false }),
    field('byteLength', 'integer', '文件字节数；必须大于0。', { optional: false, nullable: false }),
  ],
  empty: '扩展名、Base64或文件内容非法时抛错，且不发请求。',
}
const importOutput: AiContract['output'] = {
  shape: 'string | null',
  fields: [field('$', 'string | null', 'Java导入接口的成功文案；响应为空时为null。', { optional: false })],
  empty: '文件校验、权限、网络或后端组织匹配错误会抛出。',
}

const boundaries = [
  `页面范围是${REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH}，菜单权限是${REPORT_LEADERSHIP_PROFIT_SALARY_PERMISSION}；请求使用platform实例并发送module-type=${REPORT_LEADERSHIP_PROFIT_SALARY_MODULE_TYPE}。`,
  '列表只发送Portal实际表单字段standardUnitId和useYearMonth，以及order、orderField、pageNo、pageSize；后端虽支持更多PageReqVO过滤字段，但页面没有暴露，SDK不扩展这些筛选。',
  '组织候选由Portal角色组织树通过/org/organization/getRoleOrganizationTree提供；Java服务端再次按module-type组织范围收敛，传入组织ID不能绕过权限范围。',
  '月份必须是YYYY-MM；新建和编辑表单的月份、组织、利润计提金额均为Portal必填。金额由a-input-number precision=2、min=0、max=9999999999.99约束，SDK提交两位小数数值。',
  'Portal状态0为待月结、1为已月结；状态1的行不显示编辑/删除。SDK的prepareUpdate、update、prepareRemove、remove都要求当前状态为0，不能绕过页面门禁；状态只用于本地门禁，不写入保存请求体。',
  '模板下载是Portal通过平台鉴权打开/sys/oss/download并固定传fileName=领导利润工资计提模板，不是本页面Controller中的独立download-template端点；SDK复现该平台请求并返回二进制。',
  '导入文件接受.xml、.xlsx、.xls，multipart字段名为file；页面没有导入预览或撤销接口，prepareImport只做本地校验。',
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐项执行列表、模板下载、导入及prepare→submit→回查闭环；当前证据为Portal/Java源码和离线请求形状测试。',
  '尚未确认当前测试租户的组织树ID、名称快照和OSS响应Content-Disposition；SDK兼容数字/数字字符串ID，并以响应文件名优先。',
]

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`领导利润工资计提契约缺少能力：${id}`)
  const suffix = id.replace('report-leadership-profit-salary-', '')
  if (suffix === 'list') return {
    standardUnitId: param('列表组织筛选ID；省略或传null表示不增加该项筛选，但仍受服务端角色组织范围限制。', '用户从Portal角色组织树选择的组织节点', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按组织筛选。', omitted: 'SDK发送null。' }),
    useYearMonth: param('列表月份筛选，格式YYYY-MM。', 'Portal月份选择器', { type: 'string', required: false, nullable: true, nullMeaning: '不按月份筛选。', omitted: 'SDK发送null。', format: 'YYYY-MM' }),
    pageNo: param('从1开始的页码。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数，仅支持10、20、50、100。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-create') return { form: param('新建页面表单；月份、组织和利润计提金额均需填写。', '用户填写的Portal新建表单', { type: 'object', required: true, constraints: ['standardUnitName由组织树提供；没有名称快照时可省略，Java会按standardUnitId补全组织全路径。'] }) }
  if (suffix === 'create') return {
    draft: param('prepareCreate返回的完整新建草稿；确认后原样提交。', 'reportLeadershipProfitSalary.prepareCreate.result.draft', { type: 'object', required: true }),
    'draft.useYearMonth': param('新建草稿中的计提年月，格式YYYY-MM。', 'reportLeadershipProfitSalary.prepareCreate.result.draft.useYearMonth', { type: 'string', required: true, format: 'YYYY-MM' }),
    'draft.standardUnitId': param('新建草稿中的角色组织ID。', 'reportLeadershipProfitSalary.prepareCreate.result.draft.standardUnitId', { type: 'string | number', required: true }),
    'draft.provisionAmount': param('新建草稿中的利润计提金额，按两位小数提交。', 'reportLeadershipProfitSalary.prepareCreate.result.draft.provisionAmount', { type: 'number', required: true }),
  }
  if (suffix === 'prepare-update') return { form: param('编辑页面表单与当前列表行；必须包含id和status，且status必须为0。', '当前列表行加上用户修改后的Portal编辑表单', { type: 'object', required: true, constraints: ['status只用于复现Portal状态门禁，不会进入Java保存请求体。'] }) }
  if (suffix === 'update') return {
    draft: param('prepareUpdate返回的含ID编辑草稿；确认后原样提交。', 'reportLeadershipProfitSalary.prepareUpdate.result.draft', { type: 'object', required: true }),
    'draft.id': param('编辑草稿中的记录ID。', 'reportLeadershipProfitSalary.prepareUpdate.result.draft.id', { type: 'string | number', required: true }),
    'draft.status': param('编辑草稿中的月结状态；必须为0。', 'reportLeadershipProfitSalary.prepareUpdate.result.draft.status', { type: '0', required: true, options: [{ value: 0, label: '待月结' }] }),
    'draft.useYearMonth': param('编辑草稿中的计提年月，格式YYYY-MM。', 'reportLeadershipProfitSalary.prepareUpdate.result.draft.useYearMonth', { type: 'string', required: true, format: 'YYYY-MM' }),
    'draft.standardUnitId': param('编辑草稿中的角色组织ID。', 'reportLeadershipProfitSalary.prepareUpdate.result.draft.standardUnitId', { type: 'string | number', required: true }),
    'draft.provisionAmount': param('编辑草稿中的利润计提金额，按两位小数提交。', 'reportLeadershipProfitSalary.prepareUpdate.result.draft.provisionAmount', { type: 'number', required: true }),
  }
  if (suffix === 'prepare-remove') return {
    id: param('当前列表行的领导利润工资计提ID。', 'reportLeadershipProfitSalary.list.result.list[].id', { type: 'string | number', required: true }),
    currentStatus: param('当前列表行状态；只有0待月结允许删除。', 'reportLeadershipProfitSalary.list.result.list[].status', { type: '0 | 1', required: true, options: [{ value: 0, label: '待月结' }, { value: 1, label: '已月结' }] }),
  }
  if (suffix === 'remove') return {
    id: param('prepareRemove返回的删除目标ID。', 'reportLeadershipProfitSalary.prepareRemove.result.id', { type: 'string | number', required: true }),
    currentStatus: param('prepareRemove确认的状态；必须保持0。', 'reportLeadershipProfitSalary.prepareRemove.result.currentStatus', { type: '0', required: true, options: [{ value: 0, label: '待月结' }] }),
  }
  if (suffix === 'prepare-import' || suffix === 'import') return {
    fileName: param('上传文件名；Portal file input接受.xml、.xlsx、.xls。', '用户选择的本地文件名', { type: 'string', required: true, constraints: ['扩展名必须是.xml、.xlsx或.xls。'] }),
    base64: param('文件二进制的标准Base64内容。', '用户选择文件后由调用方读取的文件内容', { type: 'string', required: true, constraints: ['必须是合法Base64且解码后非空。'] }),
    contentType: param('上传MIME类型。', '本地文件类型或调用方提供的MIME类型', { type: 'string', required: false, nullable: true, nullMeaning: 'SDK按文件扩展名推断。', omitted: 'SDK按文件扩展名推断。' }),
  }
  return {}
}

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`领导利润工资计提契约缺少能力定义：${id}`)
  return {
    purpose,
    whenToUse: purpose,
    boundaries,
    effect: 'read',
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面菜单权限；组织ID和记录ID必须来自当前可见列表或当前会话组织树。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: '响应结构校验通过；写操作还必须按契约回查列表确认业务记录状态。',
    failures: ['非法ID、月份、状态、金额、分页、文件、权限、网络或Java业务错误会抛出；列表失败不会降级为空列表。', '已月结记录的编辑/删除在发请求前失败；用户取消prepare结果时不发送业务请求。'],
    idempotency: null,
    evidence: [
      { source: 'app/portal/menus/hr.js、app/portal/views/dashboard/hr/report/leadership-profit-salary/list.vue、app/portal/views/dashboard/hr/report/leadership-profit-salary/[mode]/[id].vue', kind: 'reference', note: '逐页核对菜单权限、筛选/分页、列表字段、状态动作、表单回填、提交体、模板下载和导入文件规则。' },
      { source: 'LeaderProfitSalaryProvisionController.java、LeaderProfitSalaryProvisionPageReqVO.java、LeaderProfitSalaryProvisionSaveReqVO.java、LeaderProfitSalaryProvisionRespVO.java、LeaderProfitSalaryProvisionImportVO.java、LeaderProfitSalaryProvisionServiceImpl.java、LeaderProfitSalaryProvisionMapper.java', kind: 'reference', note: '核对CRUD/分页/导入端点、字段、组织范围、已月结删除门禁、导入组织匹配和后端返回形状。' },
      { source: 'src/capabilities/report-leadership-profit-salary.ts、test/report-leadership-profit-salary.test.ts', kind: 'implementation', note: '锁定请求路径、platform上下文、表单校验、状态门禁、OSS文件、multipart载荷和坏输入反证；未替代真实环境闭环。' },
      { source: 'docs/pages/领导利润工资计提表.md', kind: 'reference', note: '记录页面动作、字段、权限、组织范围和真实验证边界。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'report-leadership-profit-salary-list': base('report-leadership-profit-salary-list', '按月份和组织筛选分页查询领导利润工资计提表。', listOutput, ['按list展示月份、组织、利润计提金额和状态；用list[].id及原始组织/月份字段进入后续编辑或删除确认，total仅用于翻页。']),
  'report-leadership-profit-salary-prepare-create': {
    ...base('report-leadership-profit-salary-prepare-create', '按Portal新建表单规则准备一条领导利润工资计提草稿。', { shape: '{ draft: object }', fields: createDraftFields, empty: '月份、组织ID、利润计提金额缺失或金额超出Portal范围时抛错。' }, ['把draft展示给用户确认；取消时只丢弃本地草稿。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认新建草稿', capabilityId: 'report-leadership-profit-salary-create', mapping: { draft: 'result.draft' }, instruction: '把同一份draft原样交给create；不要额外加入status或后端未展示字段。' }, { role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不发送POST。' }] }),
  },
  'report-leadership-profit-salary-create': {
    ...base('report-leadership-profit-salary-create', '创建一条领导利润工资计提记录。', idOutput, ['返回ID只证明创建请求获得后端回执；按draft中的月份和组织重新list，并按返回ID、金额和status核对落库结果。'], { effect: 'write', idempotency: '页面没有requestId幂等协议；新建请求超时或响应不确定时先按月份和组织list回查，确认没有重复记录后再决定是否重试。', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-leadership-profit-salary-list', mapping: { useYearMonth: 'args.draft.useYearMonth', standardUnitId: 'args.draft.standardUnitId' }, instruction: '重新查询并核对返回ID、月份、组织、利润计提金额和状态；不要只凭ID宣布业务已生效。' }] }),
  },
  'report-leadership-profit-salary-prepare-update': {
    ...base('report-leadership-profit-salary-prepare-update', '检查当前待月结记录并准备领导利润工资计提编辑草稿。', { shape: '{ draft: object }', fields: updateDraftFields, empty: '缺少记录ID、status不是0、月份/组织/金额缺失或金额超出Portal范围时抛错。' }, ['只对当前列表行status=0调用；把draft展示给用户确认，取消时只丢弃草稿。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认编辑草稿', capabilityId: 'report-leadership-profit-salary-update', mapping: { draft: 'result.draft' }, instruction: '把同一份draft原样交给update；status仅作为SDK门禁，不写入请求体。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送PUT。' }] }),
  },
  'report-leadership-profit-salary-update': {
    ...base('report-leadership-profit-salary-update', '编辑一条仍处于待月结状态的领导利润工资计提记录。', trueOutput, ['请求成功或响应不确定后，按编辑后的月份和组织list回查同一ID及金额；true不是业务终态证明。'], { effect: 'write', idempotency: '页面没有requestId幂等协议；编辑请求超时或响应不确定时先list回查，确认字段是否已更新后再决定是否重试。', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-leadership-profit-salary-list', mapping: { useYearMonth: 'args.draft.useYearMonth', standardUnitId: 'args.draft.standardUnitId' }, instruction: '按ID核对月份、组织、利润计提金额和状态。' }] }),
  },
  'report-leadership-profit-salary-prepare-remove': {
    ...base('report-leadership-profit-salary-prepare-remove', '检查一条领导利润工资计提记录是否仍可删除。', { shape: '{ id: string | number, currentStatus: 0 }', fields: [field('id', 'string | number', '待用户确认的记录ID.', { optional: false, nullable: false }), field('currentStatus', '0', '已通过Portal状态门禁的当前状态。', { optional: false, nullable: false })], empty: '缺少ID、缺少当前状态或状态为1时抛错。' }, ['向用户展示待删除记录的当前列表信息；确认前不发DELETE。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'report-leadership-profit-salary-remove', mapping: { id: 'result.id', currentStatus: 'result.currentStatus' }, instruction: '只把同一份prepare结果交给remove。' }, { role: 'cancel', when: '用户取消删除', instruction: '只丢弃删除草稿，不调用remove。' }] }),
  },
  'report-leadership-profit-salary-remove': {
    ...base('report-leadership-profit-salary-remove', '删除一条待月结状态的领导利润工资计提记录。', trueOutput, ['删除成功或响应不确定后重新list，按同一ID确认记录已消失；后端若已月结会拒绝删除。'], { effect: 'write', idempotency: '页面没有requestId幂等协议；删除请求超时或响应不确定时先list确认ID是否仍存在，再决定是否重试。', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-leadership-profit-salary-list', mapping: {}, instruction: '重新查询并核对目标ID不再出现。' }] }),
  },
  'report-leadership-profit-salary-download-template': base('report-leadership-profit-salary-download-template', '下载Portal固定的领导利润工资计提导入模板。', fileOutput, ['保存非空文件；Portal固定向平台OSS请求fileName=领导利润工资计提模板，返回文件名优先使用响应Content-Disposition。']),
  'report-leadership-profit-salary-prepare-import': {
    ...base('report-leadership-profit-salary-prepare-import', '在提交前校验领导利润工资计提导入文件。', previewOutput, ['向用户展示文件名、MIME类型和字节数；确认后把同一份文件交给importExcel，取消时不发请求。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户确认导入文件', capabilityId: 'report-leadership-profit-salary-import', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '使用同一份原始Base64文件提交multipart字段file。' }, { role: 'cancel', when: '用户取消导入', instruction: '只丢弃本地预览，不发送POST。' }] }),
  },
  'report-leadership-profit-salary-import': {
    ...base('report-leadership-profit-salary-import', '导入领导利润工资计提Excel或XML文件。', importOutput, ['导入成功或响应不确定后按文件中的月份和组织重新list核对记录；不能只凭“导入成功”文案确认每一行都已落库。'], { effect: 'write', idempotency: '后端导入没有requestId；响应不确定时先按文件可识别的月份/组织回查，确认没有重复导入后再决定是否重试。', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'report-leadership-profit-salary-list', mapping: {}, instruction: '按导入文件中的月份和组织筛选并核对新增记录及金额；若文件内容无法确定筛选条件，先读取文件或向用户补齐条件。' }] }),
  },
}

export const REPORT_LEADERSHIP_PROFIT_SALARY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.keys(REPORT_LEADERSHIP_PROFIT_SALARY_METHODS).map(id => [id, contracts[id]!]),
)
export const REPORT_LEADERSHIP_PROFIT_SALARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(REPORT_LEADERSHIP_PROFIT_SALARY_METHODS).map(([id, method]) => [
    `reportLeadershipProfitSalary.${method}`,
    { ...REPORT_LEADERSHIP_PROFIT_SALARY_AI_CONTRACTS[id]!, boundaries: [...REPORT_LEADERSHIP_PROFIT_SALARY_AI_CONTRACTS[id]!.boundaries, `直接方法路径为reportLeadershipProfitSalary.${method}；写操作遵循prepare→submit→回查。`] },
  ]),
)
