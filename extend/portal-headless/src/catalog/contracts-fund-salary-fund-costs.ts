import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FUND_SALARY_FUND_COST_METHODS } from '../capabilities/fund-salary-fund-costs.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })

const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用姓名、行号或组织名称代替记录ID']
const rowFields: AiField[] = [
  field('list[].id', 'string | number', '公积金费用记录ID；归档、删除和导出选择使用', { constraints: idRules }),
  field('list[].staffCode', 'string | number', '员工工号', { nullable: true, nullMeaning: '后端未返回工号' }),
  field('list[].name', 'string', '员工姓名', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('list[].organizationPath', 'string', '组织全路径', { nullable: true, nullMeaning: '后端未返回组织路径' }),
  field('list[].postName', 'string', '岗位名称', { nullable: true, nullMeaning: '后端未返回岗位' }),
  field('list[].idCard', 'string', '身份证文本；按原值返回', { nullable: true, nullMeaning: '后端未返回身份证' }),
  field('list[].insuredArea', 'string', '投保地；页面会按地区树显示名称', { nullable: true, nullMeaning: '后端未返回投保地' }),
  field('list[].depositUnitName', 'string', '缴存单位名称', { nullable: true, nullMeaning: '后端未返回缴存单位' }),
  field('list[].costDate', 'string', '费用归属月份', { nullable: true, nullMeaning: '后端未返回费用归属月份', format: 'YYYY-MM' }),
  field('list[].occurredDate', 'string', '费用发生月份', { nullable: true, nullMeaning: '后端未返回费用发生月份', format: 'YYYY-MM' }),
  field('list[].totalCost', 'number | string', '费用合计；Java按单位费用与个人费用计算', { nullable: true, nullMeaning: '后端未返回金额' }),
  field('list[].costType', 'integer', '费用类型：1正常，2补缴', { nullable: true, nullMeaning: '后端未返回费用类型' }),
  field('list[].operatorName', 'string', '操作人名称', { nullable: true, nullMeaning: '后端未返回操作人' }),
  field('list[].operateTime', 'string | number', '操作时间原值', { nullable: true, nullMeaning: '后端未返回操作时间' }),
  field('list[].costCenterName', 'string', '成本中心名称', { nullable: true, nullMeaning: '后端未返回成本中心' }),
  field('list[].companyBase', 'number | string', '单位缴存基数', { nullable: true, nullMeaning: '后端未返回单位基数' }),
  field('list[].individualBase', 'number | string', '个人缴存基数', { nullable: true, nullMeaning: '后端未返回个人基数' }),
  field('list[].companyRatio', 'number | string', '单位比例，页面按百分比显示', { nullable: true, nullMeaning: '后端未返回单位比例' }),
  field('list[].individualRatio', 'number | string', '个人比例，页面按百分比显示', { nullable: true, nullMeaning: '后端未返回个人比例' }),
  field('list[].companyCost', 'number | string', '单位费用', { nullable: true, nullMeaning: '后端未返回单位费用' }),
  field('list[].individualCost', 'number | string', '个人费用', { nullable: true, nullMeaning: '后端未返回个人费用' }),
  field('list[].archiveStatus', 'integer', '归档状态：1未归档，2已归档', { values: { '1': '未归档', '2': '已归档' } }),
  field('list[].salaryDocumentIdNames', 'string', '使用该费用的工资单据名称', { nullable: true, nullMeaning: '未被工资核算使用或后端未返回' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [field('$', 'object', '公积金费用分页结果'), field('list', 'array', '当前页记录，不是全部数据'), field('list[]', 'object', '一条公积金费用记录'), ...rowFields, field('total', 'integer', '匹配总数，不是当前页长度')],
  empty: 'list=[]且total=0表示当前筛选无记录；权限或响应形状错误会抛出。',
}

const pageInputs: Record<string, AiParameter> = {
  name: optional('员工姓名筛选', '页面姓名输入框', 'SDK发送null，不限制姓名', { type: 'string', nullable: true }),
  orgIds: optional('所属组织ID', '页面角色组织树多选', 'SDK发送空字符串，不限制组织', { type: 'array<string | number> | string', nullable: true, constraints: ['数组ID会按Portal转成逗号字符串'] }),
  archiveStatus: optional('归档状态：1未归档、2已归档', '页面状态或页面隐藏默认值', '费用页默认1，归档页默认2', { type: 'integer' }),
  isSalaryUsed: optional('是否被薪资核算使用：0未使用、1使用过', '归档页筛选下拉', '费用页不发送该键；归档页默认null', { type: 'integer', nullable: true }),
  belongMonth: optional('费用归属月份范围', '页面month range picker', 'SDK发送costDateStart/costDateEnd为null', { type: 'array<string | null>', format: 'YYYY-MM' }),
  occurMonth: optional('费用发生月份范围', '归档页month range picker', 'SDK发送occurredDateStart/occurredDateEnd为null', { type: 'array<string | null>', format: 'YYYY-MM' }),
  pageNo: optional('页码', '页面分页状态', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('页大小', '页面分页状态', 'SDK默认20；页面额外显示200和500', { type: 'integer', constraints: ['10、20、50、100、200、500'] }),
}

const mutationInputs: Record<string, AiParameter> = {
  items: input('操作记录数组', '用户选中的列表行和归档弹窗费用发生月份', { type: 'array<object>', constraints: ['每项id为安全正整数', '归档每项occurredDate为YYYY-MM'] }),
}
const idsInputs: Record<string, AiParameter> = { ids: input('记录ID数组', '用户在列表勾选的记录ID', { type: 'array<string | number>', constraints: ['非空', ...idRules] }) }
const writeIdempotency = 'Portal后端写端点没有requestId，SDK不添加服务端幂等键；请求完成或超时后先按同一ID、月份或文件指纹回查，未确认前不得盲目重试；批量导入和复制可能产生重复副作用，需用户确认后再处理。'
const fileInputs: Record<string, AiParameter> = {
  fileName: input('上传文件名', '文件选择器名称', { type: 'string' }),
  base64: input('文件内容Base64', '文件读取结果', { type: 'string' }),
  contentType: optional('文件MIME类型', '文件选择器类型', 'SDK使用application/octet-stream', { type: 'string' }),
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/hr/fund/cost/list.vue 与 archive/list.vue', kind: 'reference', note: '证明两个菜单页的筛选默认值、月份转换、列表动作、导出/导入/归档请求和组织树组件；固定检出未pull。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 SalaryFundCostsController、SalaryFundCostsSelectDTO、SalaryFundCostsDTO、SalaryFundCostsServiceImpl', kind: 'reference', note: '证明分页字段、DTO字段、归档/取消归档/删除/导出/导入/缴存单位/成本中心/历史归档端点；固定检出未pull。' },
  { source: 'src/capabilities/fund-salary-fund-costs.ts', kind: 'implementation', note: '证明SDK对Portal查询转换、moduleType=14、表单月份、批量写请求和文件内容的实现；不替代真实环境证据。' },
  { source: 'test/fund-salary-fund-costs.test.ts', kind: 'test', note: '离线锁定两个页面默认查询、请求体、权限/端点、文件预览、坏响应和AI映射反证。' },
]

const boundaries = [
  '费用页默认archiveStatus=1，归档查询页默认archiveStatus=2；月份控件按Portal分别转换为costDateStart/costDateEnd和occurredDateStart/occurredDateEnd，orgIds数组按Portal转为逗号字符串。',
  '费用页的归档、删除、导入、导出、下载模板、调整缴存单位、调整成本中心和调用历史归档数据都可达；归档查询页提供取消归档和导出。',
  'moduleType固定为14；请求原始路径保留Portal的/salary和/org前缀，由platform实例补/admin-api；不能把页面数据权限扩大为其它模块。',
  'Java删除只对未归档记录生效，取消归档受工资使用状态约束；SDK不绕过后端业务校验，返回无data的成功响应只表示请求完成，不等于独立落库证据。',
]
const failures = [
  '非法ID、月份、归档状态、使用状态、页码、文件内容或空批量操作在发请求前失败。',
  '列表响应缺少list/total、行ID或归档状态时抛错；不能把权限不足变成空列表。',
  '401/403、网络错误和后端业务错误原样抛出；归档/删除/导入等写操作超时先按ID或筛选回查。',
]
function base (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“公积金费用”或“公积金归档查询”页面的查询、批量维护、归档和文件动作。',
    boundaries,
    prerequisites: ['已建立带有效会话token、tenantId和模块上下文的platform SDK；页面路由权限与后端业务权限由Portal裁决。', '写操作先保存用户确认的draft，并在请求完成或超时后按同一ID回查。'],
    failures,
    evidence,
    gaps: ['未启动浏览器、未取得独立网络基准、未在真实测试环境执行读请求或prepare→submit→cancel写闭环；本页契约来自固定源码、Java源码和离线测试。', 'Portal/Java固定检出未按任务约束pull到远端最新，部署版本差异未验证。'],
    ...value,
  }
}

const prepareOutput = (description: string, fields: AiField[]): AiContract['output'] => ({ shape: '{ draft: array | object }', fields: [field('$', 'object', description), ...fields], empty: '非法输入不返回草稿。' })
const voidOutput: AiContract['output'] = { shape: 'void', fields: [field('$', 'void', 'Portal成功响应没有业务data；请求未抛错表示传输完成')], empty: '请求失败时抛错。' }
const fileOutput: AiContract['output'] = { shape: '{ fileName, contentType, base64, byteLength }', fields: [field('$', 'object', '二进制文件的安全内存表示'), field('fileName', 'string', '建议保存的文件名'), field('contentType', 'string | null', '响应Content-Type', { nullable: true }), field('base64', 'string', '文件内容Base64'), field('byteLength', 'integer', '原始字节数')], empty: '空文件响应失败。' }

const commonList = (page: string, purpose: string): AiContract => base({ purpose, effect: 'read', inputs: pageInputs, output: pageOutput, consume: ['展示页面字段；按total继续分页，不把当前页当全集。', '保留list[].id、list[].archiveStatus用于后续批量操作。'], steps: [{ role: 'optional', when: '需要组织筛选候选', capabilityId: `${page}-organization-tree`, mapping: {}, instruction: '用组织节点id填充orgIds，不用组织名称代替ID。' }], completion: '返回当前页面筛选结果和total。', idempotency: null })

const RAW_FUND_SALARY_FUND_COST_AI_CONTRACTS: Record<string, AiContract> = {
  'fund-cost-list': commonList('fund-cost', '按Portal“公积金费用”页面的姓名、组织、归档状态和归属月份筛选费用记录。'),
  'fund-archive-list': commonList('fund-archive', '按Portal“公积金归档查询”页面的姓名、组织、是否被薪资使用和归属/发生月份筛选已归档记录。'),
  'fund-cost-organization-tree': base({ purpose: '读取公积金费用筛选和批量操作使用的角色组织树。', effect: 'read', inputs: {}, output: { shape: 'array', fields: [field('$', 'array', '组织树根节点数组'), field('[].id', 'string | number', '组织ID', { constraints: idRules }), field('[].name', 'string', '组织名称'), field('[].children', 'array', '子组织节点')], empty: '[]表示当前会话没有可见组织。' }, consume: ['选择节点ID后填入orgIds；名称仅用于展示。'], steps: [], completion: '获得可供页面选择的组织树。', idempotency: null }),
  'fund-archive-organization-tree': base({ purpose: '读取公积金归档查询使用的角色组织树。', effect: 'read', inputs: {}, output: { shape: 'array', fields: [field('$', 'array', '组织树根节点数组'), field('[].id', 'string | number', '组织ID', { constraints: idRules }), field('[].name', 'string', '组织名称'), field('[].children', 'array', '子组织节点')], empty: '[]表示当前会话没有可见组织。' }, consume: ['选择节点ID后填入orgIds；名称仅用于展示。'], steps: [], completion: '获得可供页面选择的组织树。', idempotency: null }),
  'fund-cost-prepare-archive': base({ purpose: '准备费用归档请求。', effect: 'prepare', inputs: mutationInputs, output: prepareOutput('待归档记录和费用发生月份', [field('draft[]', 'object', '一条归档项'), field('draft[].id', 'string | number', '费用记录ID', { constraints: idRules }), field('draft[].occurredDate', 'string', '费用发生月份，YYYY-MM', { format: 'YYYY-MM' })]), consume: ['确认后将draft交给fund-cost-archive。'], steps: [{ role: 'required', when: '用户确认归档', capabilityId: 'fund-cost-archive', mapping: { items: 'result.draft' }, instruction: '按原数组提交，不改成单个ID。' }], completion: '获得无副作用归档草稿。', idempotency: null }),
  'fund-cost-archive': base({ purpose: '按费用发生月份归档一批公积金费用。', effect: 'write', inputs: mutationInputs, output: voidOutput, consume: ['成功或超时后用fund-archive-list按同一ID/月份回查archiveStatus=2。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'fund-archive-list', mapping: {}, instruction: '独立核对归档状态；HTTP完成不等于落库证据。' }], completion: '请求未抛错且回查确认记录已归档。', idempotency: writeIdempotency }),
  'fund-cost-prepare-remove': base({ purpose: '准备删除公积金费用记录。', effect: 'prepare', inputs: idsInputs, output: prepareOutput('待删除ID数组', [field('draft[]', 'object', '删除项'), field('draft[].id', 'string | number', '费用记录ID', { constraints: idRules })]), consume: ['确认后将draft中的ID交给fund-cost-remove；后端只实际删除未归档记录。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'fund-cost-remove', mapping: { ids: 'result.draft[].id' }, instruction: '不把归档记录伪装成可删除。' }], completion: '获得无副作用删除草稿。', idempotency: null }),
  'fund-cost-remove': base({ purpose: '删除选中的未归档公积金费用。', effect: 'write', inputs: idsInputs, output: voidOutput, consume: ['按同一ID重新查询确认删除；归档记录由后端保护。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'fund-cost-list', mapping: {}, instruction: '回查确认记录状态，不以空响应推断删除成功。' }], completion: '请求未抛错并完成回查。', idempotency: writeIdempotency }),
  'fund-cost-export': base({ purpose: '导出当前公积金费用筛选结果或勾选记录。', effect: 'read', inputs: { ...pageInputs, ids: optional('勾选记录ID', '列表跨页选中ID', 'SDK发送空字符串', { type: 'array<string | number> | string', nullable: true }) }, output: fileOutput, consume: ['保存返回文件；type=1，文件名为公积金费用.xlsx。'], steps: [], completion: '获得非空导出文件。', idempotency: null }),
  'fund-archive-export': base({ purpose: '导出当前公积金归档查询筛选结果或勾选记录。', effect: 'read', inputs: { ...pageInputs, ids: optional('勾选记录ID', '列表跨页选中ID', 'SDK发送空字符串', { type: 'array<string | number> | string', nullable: true }) }, output: fileOutput, consume: ['保存返回文件；type=2，文件名为公积金归档查询.xlsx。'], steps: [], completion: '获得非空导出文件。', idempotency: null }),
  'fund-cost-download-template': base({ purpose: '下载公积金费用导入模板。', effect: 'read', inputs: {}, output: fileOutput, consume: ['按fileName保存为公积金费用模板。'], steps: [], completion: '获得非空模板文件。', idempotency: null }),
  'fund-cost-prepare-import': base({ purpose: '在上传前解码并校验公积金费用文件。', effect: 'prepare', inputs: fileInputs, output: { shape: '{ fileName, contentType, byteLength }', fields: [field('$', 'object', '上传文件预览'), field('fileName', 'string', '原文件名'), field('contentType', 'string', 'MIME类型'), field('byteLength', 'integer', '字节数')], empty: '空文件或非法Base64失败。' }, consume: ['确认预览后把同一文件交给fund-cost-import。'], steps: [{ role: 'required', when: '用户确认导入', capabilityId: 'fund-cost-import', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '导入请求使用multipart字段file。' }], completion: '获得非空文件预览。', idempotency: null }),
  'fund-cost-import': base({ purpose: '导入公积金费用Excel文件。', effect: 'write', inputs: fileInputs, output: voidOutput, consume: ['完成后重新调用fund-cost-list核对导入记录；没有可伪造的导入条数。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'fund-cost-list', mapping: {}, instruction: '重新查询并检查导入数据。' }], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
  'fund-cost-prepare-update-deposit-unit': base({ purpose: '准备调整公积金缴存单位。', effect: 'prepare', inputs: { items: input('记录与缴存单位ID数组', '页面勾选与缴存单位选择', { type: 'array<object>' }) }, output: prepareOutput('缴存单位调整草稿', [field('draft[]', 'object', '调整项'), field('draft[].id', 'string | number', '费用记录ID', { constraints: idRules }), field('draft[].targetId', 'string | number', '缴存单位ID', { constraints: idRules })]), consume: ['把每项targetId映射为updateDepositUnit的depositUnitId。'], steps: [{ role: 'required', when: '用户确认调整', capabilityId: 'fund-cost-update-deposit-unit', mapping: { items: 'result.draft' }, instruction: '不要把组织名称代替缴存单位ID。' }], completion: '获得调整草稿。', idempotency: null }),
  'fund-cost-update-deposit-unit': base({ purpose: '批量调整公积金缴存单位。', effect: 'write', inputs: { items: input('记录与缴存单位ID数组', 'prepare结果或用户确认', { type: 'array<object>' }) }, output: voidOutput, consume: ['按同一ID回查depositUnitName和操作时间。'], steps: [], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
  'fund-cost-prepare-update-cost-center': base({ purpose: '准备调整公积金成本中心。', effect: 'prepare', inputs: { items: input('记录与成本中心ID数组', '页面勾选与成本中心选择', { type: 'array<object>' }) }, output: prepareOutput('成本中心调整草稿', [field('draft[]', 'object', '调整项'), field('draft[].id', 'string | number', '费用记录ID', { constraints: idRules }), field('draft[].targetId', 'string | number', '成本中心ID', { constraints: idRules })]), consume: ['把每项targetId映射为updateCostCenter的costCenterId。'], steps: [{ role: 'required', when: '用户确认调整', capabilityId: 'fund-cost-update-cost-center', mapping: { items: 'result.draft' }, instruction: '不要把成本中心名称代替ID。' }], completion: '获得调整草稿。', idempotency: null }),
  'fund-cost-update-cost-center': base({ purpose: '批量调整公积金成本中心。', effect: 'write', inputs: { items: input('记录与成本中心ID数组', 'prepare结果或用户确认', { type: 'array<object>' }) }, output: voidOutput, consume: ['按同一ID回查costCenterName和操作时间。'], steps: [], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
  'fund-cost-prepare-copy-archived-data': base({ purpose: '准备调用历史归档公积金费用。', effect: 'prepare', inputs: { oldDate: input('来源归档月份', '页面旧月份选择', { type: 'string', format: 'YYYY-MM' }), newDate: input('目标归属月份', '页面新月份选择', { type: 'string', format: 'YYYY-MM' }) }, output: prepareOutput('历史归档月份调用草稿', [field('draft.oldDate', 'string', '来源月份', { format: 'YYYY-MM' }), field('draft.newDate', 'string', '目标月份', { format: 'YYYY-MM' })]), consume: ['确认后交给fund-cost-copy-archived-data；页面只允许oldDate不晚于今天。'], steps: [{ role: 'required', when: '用户确认调用', capabilityId: 'fund-cost-copy-archived-data', mapping: { oldDate: 'result.draft.oldDate', newDate: 'result.draft.newDate' }, instruction: '按月份提交。' }], completion: '获得月份草稿。', idempotency: null }),
  'fund-cost-copy-archived-data': base({ purpose: '按月份复制历史归档公积金费用。', effect: 'write', inputs: { oldDate: input('来源归档月份', 'prepare结果', { type: 'string', format: 'YYYY-MM' }), newDate: input('目标归属月份', 'prepare结果', { type: 'string', format: 'YYYY-MM' }) }, output: voidOutput, consume: ['完成后按目标月份查询并核对数据；后端会处理已有未归档数据。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'fund-cost-list', mapping: { belongMonth: 'args.newDate' }, instruction: '回查目标月份。' }], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
  'fund-archive-prepare-unarchive': base({ purpose: '准备取消公积金归档。', effect: 'prepare', inputs: idsInputs, output: prepareOutput('待取消归档ID数组', [field('draft[]', 'object', '取消归档项'), field('draft[].id', 'string | number', '费用记录ID', { constraints: idRules })]), consume: ['确认后交给fund-archive-unarchive。'], steps: [{ role: 'required', when: '用户确认取消归档', capabilityId: 'fund-archive-unarchive', mapping: { ids: 'result.draft[].id' }, instruction: '只提交用户选中的ID。' }], completion: '获得取消归档草稿。', idempotency: null }),
  'fund-archive-unarchive': base({ purpose: '取消选中的公积金费用归档。', effect: 'write', inputs: idsInputs, output: voidOutput, consume: ['后端会阻止已被工资核算使用的数据；完成后重新查询确认archiveStatus。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'fund-archive-list', mapping: {}, instruction: '回查同一ID。' }], completion: '请求未抛错且回查确认。', idempotency: writeIdempotency }),
}

export const FUND_SALARY_FUND_COST_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(FUND_SALARY_FUND_COST_METHODS).map(id => [id, RAW_FUND_SALARY_FUND_COST_AI_CONTRACTS[id]!]))
export const FUND_SALARY_FUND_COST_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(FUND_SALARY_FUND_COST_METHODS).map(([id, method]) => [`fundSalaryFundCosts.${method}`, FUND_SALARY_FUND_COST_AI_CONTRACTS[id]!]))
