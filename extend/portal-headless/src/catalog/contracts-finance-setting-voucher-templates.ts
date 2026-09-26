import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS } from '../capabilities/finance-setting-voucher-templates.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })

const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用名称、行号或租户ID代替凭证模板或会计科目ID']
const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const status = input('凭证模板绝对状态：0启用、1停用', '页面状态单选或当前列表行', { type: 'integer', options: statusOptions, constraints: ['只能是数值0或1，不是toggle命令'] })
const createStatus = { ...status, required: false, omitted: 'SDK默认发送0（启用）' }
const pageInputs: Record<string, AiParameter> = {
  name: optional('集成逻辑名称筛选', '页面名称输入框', '发送空字符串，不限制名称', { type: 'string' }),
  businessType: optional('业务类型字典值', '页面voucher_business_type选择值', '发送空字符串，不限制业务类型', { type: 'string' }),
  businessDetail: optional('业务场景字典值', '页面按业务类型联动的字典选择值', '发送空字符串，不限制业务场景', { type: 'string' }),
  orgAttributes: optional('Portal列表保留的旧组织财务属性筛选键', '页面旧表单状态', '发送空字符串；当前可见表单没有该控件', { type: 'string' }),
  cashItem: optional('Portal列表保留的旧现金流量项目筛选键', '页面旧表单状态', '发送空字符串；当前可见表单没有该控件', { type: 'string' }),
  status: { ...status, required: false, omitted: 'SDK默认发送0，只查启用模板' },
  pageNo: optional('从1开始的列表页码', '页面分页状态', 'SDK默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('列表每页条数', '页面分页器', 'SDK默认20；页面支持10、20、50、100', { type: 'integer', constraints: ['只能是10、20、50或100'] }),
}

const entryLine = input('一条借方或贷方会计科目配置', '凭证模板表单的借方/贷方列表项', { type: 'object', constraints: ['subjectId为会计科目ID', 'subjectAmount为非空数组，发送前按Portal join为逗号字符串', 'type=1表示借方、type=2表示贷方'] })
const entryInput = input('凭证分录组数组', '页面初始化和用户填写的entry数组', { type: 'array<object>', constraints: ['至少一组', '每组至少一条borrowList和一条lendList', 'summary、accountingSetType必填'] })
const createInputs: Record<string, AiParameter> = {
  name: input('集成逻辑名称', '用户填写新增表单', { type: 'string', constraints: ['非空', '最多100个字符'] }),
  businessType: input('业务类型字典值', '用户在voucher_business_type字典中选择', { type: 'string', constraints: ['非空；不能传业务类型标签'] }),
  businessDetail: input('业务场景字典值', '用户在业务类型对应的字典中选择', { type: 'string', constraints: ['非空；不能传场景标签'] }),
  outlay: optional('支出详情对象', '页面outlay表单对象', '按Portal表单默认空字段发送', { type: 'object' }),
  income: optional('收入详情对象', '页面income表单对象', '按Portal表单默认空字段发送', { type: 'object' }),
  allocate: optional('分配详情对象', '页面allocate表单对象', '按Portal表单默认空字段发送', { type: 'object' }),
  inventory: optional('库存变动详情对象', '页面inventory表单对象', '按Portal表单默认空字段发送', { type: 'object' }),
  transfer: optional('转款详情对象', '页面transfer表单对象', '按Portal表单默认空字段发送', { type: 'object' }),
  entry: entryInput,
  'entry[]': input('一组凭证摘要、账套和借贷分录', 'args.entry中的一项', { type: 'object' }),
  'entry[].summary': input('凭证摘要', '用户填写摘要或选择摘要弹窗结果', { type: 'string', constraints: ['非空'] }),
  'entry[].summaryId': optional('摘要主键', '摘要弹窗返回的ID', '发送null', { type: 'string | number | null', nullable: true, nullMeaning: '用户未从摘要弹窗选择既有摘要' }),
  'entry[].accountingSetType': input('凭证所属账套字典值', '用户在voucher_accounting_set_type选择', { type: 'integer' }),
  'entry[].borrowList': input('借方列表', '页面借方科目列表', { type: 'array<object>', constraints: ['至少一项'] }),
  'entry[].lendList': input('贷方列表', '页面贷方科目列表', { type: 'array<object>', constraints: ['至少一项'] }),
  'entry[].borrowList[]': entryLine,
  'entry[].lendList[]': entryLine,
  status: createStatus,
}

const rowFields = (prefix: string): AiField[] => {
  const at = (name: string) => prefix ? `${prefix}.${name}` : name
  return [
  field(at('id'), 'string | number', '凭证模板主记录ID；详情和状态更新使用', { constraints: idRules }),
  field(at('name'), 'string', '集成逻辑名称', { nullable: true, nullMeaning: '后端未返回名称；不能用ID反推' }),
  field(at('businessType'), 'string', '业务类型字典值；页面按voucher_business_type显示标签', { nullable: true, nullMeaning: '后端未返回业务类型' }),
  field(at('businessDetail'), 'string', '业务场景字典值；页面按businessType对应字典显示标签', { nullable: true, nullMeaning: '后端未返回业务场景' }),
  field(at('createTime'), 'string | number', '录入时间原值；页面格式化显示', { nullable: true, nullMeaning: '后端未返回录入时间' }),
  field(at('updateTime'), 'string | number', '更新时间原值；页面格式化显示', { nullable: true, nullMeaning: '后端未返回更新时间' }),
  field(at('status'), 'integer', '绝对状态：0启用、1停用', { values: { '0': '启用', '1': '停用' } }),
  ]
}

const pageOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [field('$', 'object', '当前筛选条件下的凭证模板分页结果'), field('list', 'array', '当前页记录，不是全部匹配记录'), field('list[]', 'object', '一条列表记录'), ...rowFields('list[]'), field('total', 'integer', '匹配总记录数，不是当前页长度')],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、网络或响应形状错误会抛错，不改写为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object | null',
  fields: [field('$', 'object', 'Java VoucherTemplateSaveReqVO详情；包含基础字段、业务详情对象和entry分录组', { nullable: true, nullMeaning: '后端返回null；不能当作可提交草稿' }), ...rowFields(''), field('outlay', 'object', '支出业务详情；字段由所选businessType/businessDetail决定', { optional: true, nullable: true, nullMeaning: '该模板不是支出类型或后端未返回' }), field('income', 'object', '收入业务详情', { optional: true, nullable: true, nullMeaning: '该模板不是收入类型或后端未返回' }), field('allocate', 'object', '分配业务详情', { optional: true, nullable: true, nullMeaning: '该模板不是分配类型或后端未返回' }), field('inventory', 'object', '库存变动业务详情', { optional: true, nullable: true, nullMeaning: '该模板不是库存类型或后端未返回' }), field('transfer', 'object', '转款业务详情', { optional: true, nullable: true, nullMeaning: '该模板不是转款类型或后端未返回' }), field('entry', 'array', '凭证摘要、账套和entrySaveReqVOList分录组', { optional: true, nullable: true, nullMeaning: '后端未返回分录' }), field('entry[].entrySaveReqVOList', 'array', '一组借贷分录；type=1借方、type=2贷方', { optional: true, nullable: true, nullMeaning: '后端未返回分录明细' }), field('entry[].entrySaveReqVOList[].subjectId', 'string | number', '会计科目ID；属于会计科目命名空间', { optional: true }), field('entry[].entrySaveReqVOList[].subjectAmount', 'string', '逗号分隔的金额代码原值；不是金额数值', { optional: true }), field('entry[].entrySaveReqVOList[].addInfo', 'string', '逗号分隔的附加信息字典值', { optional: true, nullable: true, nullMeaning: '没有附加信息' }), field('entry[].entrySaveReqVOList[].cashItemList', 'array<integer>', '现金流量项目字典值数组', { optional: true, nullable: true, nullMeaning: '没有现金流量项目' }), field('entry[].entrySaveReqVOList[].type', 'integer', '借贷方向：1借方、2贷方', { optional: true, values: { '1': '借方', '2': '贷方' } })],
  empty: '不存在的ID应按后端错误或null处理；不能用列表行拼造完整可编辑详情。',
}

const preparedCreateOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [field('$', 'object', '本地表单准备结果'), field('draft', 'object', '可直接交给create的Portal保存载荷'), field('draft.name', 'string', '名称；最多100字符'), field('draft.businessType', 'string', '业务类型字典值'), field('draft.businessDetail', 'string', '业务场景字典值'), field('draft.status', 'integer', 'Portal默认状态0启用', { values: { '0': '启用', '1': '停用' } }), field('draft.entry', 'array', '转换后的凭证分录组'), field('draft.entry[].entrySaveReqVOList', 'array', '按borrowList.concat(lendList)顺序排列的后端分录'), field('draft.entry[].entrySaveReqVOList[].subjectAmount', 'string', '由subjectAmount数组用逗号join得到'), field('draft.entry[].entrySaveReqVOList[].addInfo', 'string', '由addInfo数组用逗号join得到'), field('draft.entry[].entrySaveReqVOList[].cashItemList', 'array<integer>', '原样保留的现金流量项目ID数组')],
  empty: '非法表单、空借方/贷方、空金额数组、错误借贷type或超长名称会在发请求前抛错。',
}

const preparedStatusOutput: AiContract['output'] = {
  shape: '{ draft: row, previous: row }',
  fields: [field('$', 'object', '整行状态更新草稿和恢复快照'), field('draft', 'object', '提交给setStatus的完整列表行，只有status被替换为目标值'), ...rowFields('draft'), field('previous', 'object', '操作前完整列表行，用于用户明确要求时的补偿写'), ...rowFields('previous')],
  empty: '当前行非法或targetStatus与当前status相同会在发请求前抛错。',
}

const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'boolean', 'Java update成功回执；只表示接口返回true，不含更新后详情', { values: { true: '后端接受请求' } })], empty: '非true响应抛错。' }
const amountOutput: AiContract['output'] = { shape: 'array', fields: [field('$', 'array', '按业务类型和场景返回的金额选项'), field('[]', 'object', '一个金额选项'), field('[].amountCode', 'string', '表单提交的金额代码'), field('[].amountLabel', 'string', '页面显示的金额标签'), field('[].sort', 'integer', '后端排序值', { optional: true, nullable: true, nullMeaning: '后端未返回排序值' })], empty: '[]表示没有可用金额选项；错误响应抛错。' }
const exportOutput: AiContract['output'] = { shape: '{ fileName, contentType, base64, byteLength }', fields: [field('$', 'object', '导出文件安全内存表示'), field('fileName', 'string', '建议保存名；固定为凭证模版基础信息.xls'), field('contentType', 'string', '响应Content-Type', { nullable: true, nullMeaning: '响应未提供Content-Type' }), field('base64', 'string', '原始二进制Base64'), field('byteLength', 'integer', '原始字节数')], empty: '空文件响应失败。' }

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/menus/finance.js、voucher-templates.vue、list.vue、[mode]/[id].vue、template/[id].vue', kind: 'reference', note: '证明菜单路径、页面权限、默认表单、按钮权限、金额选项请求、创建customSubmit、状态整行PUT和本地预览桥接；固定检出未pull。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 VoucherTemplateController、VoucherTemplateSaveReqVO、PageReqVO、RespVO、VoucherTemplateEntrySaveGenrateVO/SaveReqVO、VoucherAmountOptionConfigController', kind: 'reference', note: '证明CRUD、分页、导出、详情/分录字段、金额选项端点和Java文件名；固定检出未pull。' },
  { source: 'src/capabilities/finance-setting-voucher-templates.ts', kind: 'implementation', note: '证明SDK对页面默认字段、分录join、整行状态PUT、导出二进制和platform/moduleType上下文的实现；不替代真实环境证据。' },
  { source: 'test/finance-setting-voucher-templates.test.ts', kind: 'test', note: '离线锁定页面源码锚点、请求参数、表单边界、借贷转换、状态body、导出、坏响应和AI映射反证。' },
]

const boundaries = [
  '只覆盖财务设置→凭证模板列表及其新建、详情、状态和预览动作；页面没有删除按钮，控制器的导入、导入模板和生成凭证端点不因存在于Java控制器就发布到本页。',
  '列表默认发送order、orderField、name、businessType、businessDetail、orgAttributes、cashItem、status=0、pageNo=1、pageSize=20；orgAttributes/cashItem是页面保留的旧请求键，不解释为当前可见筛选控件。',
  '创建严格复现Portal customSubmit：表单五个业务详情对象随顶层一起发送；每组分录按borrowList.concat(lendList)，subjectAmount和addInfo数组分别join为逗号字符串，cashItemList和type原样按Java字段发送。',
  '状态按钮不是独立status接口，而是把列表整行展开后把status改成相反值，再PUT /update；SDK保留这个实际body形状并保存previous。预览是本地bridge行为，不读取后端详情。',
  '所有网络请求使用platform实例，moduleType=null；页面按钮权限分别为create、export、status、detail、preview，SDK不把菜单可见或描述登记当作权限授予。',
]
const failures = [
  '名称为空或超过100字符、业务类型/场景为空、分录为空、借贷任一侧为空、摘要/账套缺失、科目ID/金额/type/现金流量项目非法时不发请求。',
  '列表、金额选项、详情、导出或写接口响应形状不符合契约时抛错；不把权限不足或空二进制改写为空成功。',
  '401/403、网络错误和后端业务错误原样抛出；创建或状态更新超时先按ID/字段回查，不能盲目重复创建或把true当独立落库证明。',
]

function base (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“财务设置→凭证模板”页面的查询、金额选项、创建、状态、详情或预览动作。',
    boundaries,
    prerequisites: ['已建立带有效会话token和tenantId的platform SDK；账号需同时通过菜单及对应按钮权限。', '写操作前使用最新列表行或用户确认的创建草稿；请求完成或超时后按同一ID/字段回查。'],
    failures,
    evidence,
    gaps: ['未启动浏览器，未取得独立网络基准，未在真实测试环境执行读请求或写入；本页证据来自固定Portal/Java检出和离线测试。', 'Portal/Java固定检出未按任务约束pull到远端最新；部署版本差异和真实账号权限未验证。', '未执行真实prepare→submit→cancel闭环；页面创建没有取消/删除接口，状态恢复只能以保存的previous再次PUT。'],
    ...value,
  }
}

const listContract = base({
  purpose: '按页面名称、业务类型、业务场景和状态分页查询凭证模板，返回详情、状态和预览所需的列表行。',
  effect: 'read', inputs: pageInputs, output: pageOutput,
  consume: ['展示list[]的名称、业务类型/场景标签、创建/更新时间和状态；0是启用，1是停用。', '保留list[].id和完整行给get、prepareSetStatus和preview；按total继续分页，不能把当前页当全集。'],
  steps: [
    { role: 'optional', when: '用户查看某条详情', capabilityId: 'finance-setting-voucher-templates-get', mapping: { id: 'result.list[].id' }, instruction: '传同一行id读取完整业务详情和entry，不能用列表行拼造详情。' },
    { role: 'optional', when: '用户确认启用或停用某条模板', capabilityId: 'finance-setting-voucher-templates-prepare-set-status', mapping: { current: 'result.list[]', targetStatus: 'user.targetStatus' }, instruction: '目标状态必须与当前status相反，先保存previous。' },
    { role: 'optional', when: '用户点击预览', capabilityId: 'finance-setting-voucher-templates-preview', mapping: { record: 'result.list[]' }, instruction: '这是Portal的本地bridge预览，不代表已读取完整entry。' },
  ],
  completion: '返回当前筛选页和total；不代表用户具有任一按钮写权限。', idempotency: null,
})

const RAW_FINANCE_SETTING_VOUCHER_TEMPLATES_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-voucher-templates-list': listContract,
  'finance-setting-voucher-templates-get': base({
    purpose: '按凭证模板ID读取详情，取得业务详情对象和借贷分录组。', effect: 'read', inputs: { id: input('凭证模板主记录ID', '列表行id或用户明确提供的同一记录ID', { type: 'string | number', constraints: idRules }) }, output: detailOutput,
    consume: ['按businessType/businessDetail解释对应详情对象；entry[].entrySaveReqVOList[].subjectAmount是逗号字符串代码，不是金额数值。', '编辑页面源码没有保存编辑动作，不能把详情直接当作update输入。'], steps: [], completion: '返回该ID的Java详情对象或明确的null；不改变模板。', idempotency: null,
  }),
  'finance-setting-voucher-templates-amount-options': base({
    purpose: '按业务类型和可选业务场景读取创建表单金额代码选项，供借贷分录的多选金额字段使用。', effect: 'read', inputs: { businessType: input('业务类型字典值', '创建表单当前businessType', { type: 'string' }), businessDetail: optional('业务场景字典值', '创建表单当前businessDetail', '按后端公共选项查询', { type: 'string', nullable: true }) }, output: amountOutput,
    consume: ['把amountCode放入entry借/贷行的subjectAmount数组，把amountLabel仅用于展示；不要把label提交给Java。'], steps: [], completion: '返回当前业务上下文的金额选项数组；不创建模板。', idempotency: null,
  }),
  'finance-setting-voucher-templates-prepare-create': base({
    purpose: '在本地复刻新增凭证模板表单规则，并生成Java VoucherTemplateSaveReqVO兼容载荷。', effect: 'prepare', inputs: createInputs, output: preparedCreateOutput,
    consume: ['确认draft中的业务详情对象和借贷分录；entrySaveReqVOList已经按Portal顺序和join规则转换，不能再次join。', '确认后把result.draft原样交给create。'], steps: [{ role: 'required', when: '用户确认创建草稿', capabilityId: 'finance-setting-voucher-templates-create', mapping: { name: 'result.draft.name', businessType: 'result.draft.businessType', businessDetail: 'result.draft.businessDetail', entry: 'result.draft.entry' }, instruction: '提交完整draft，不删除Portal默认详情对象。' }], completion: '仅生成本地创建载荷，尚未产生凭证模板记录。', idempotency: null,
  }),
  'finance-setting-voucher-templates-create': base({
    purpose: '提交Portal新增凭证模板表单，创建一条带业务详情和借贷分录的凭证模板。', effect: 'write', inputs: createInputs, output: { shape: 'string | number', fields: [field('$', 'string | number', '新建凭证模板主记录ID；不是会计科目ID或账套ID', { constraints: idRules })], empty: '缺少合法ID或请求失败时抛错。' },
    consume: ['返回值是主记录ID；创建成功或超时必须按同一ID调用get/list回查基础字段和entry。', '没有页面删除或撤销接口，不能向AI承诺自动cancel。'], steps: [{ role: 'required', when: '返回ID或请求超时，需要确认创建终态', capabilityId: 'finance-setting-voucher-templates-get', mapping: { id: 'result.$' }, instruction: '读取同一ID并核对名称、业务类型/场景、entry；只凭HTTP成功不报告落库已核实。' }, { role: 'cancel', when: '用户要求撤销已创建模板', instruction: '页面没有删除或取消创建的可达接口；转交受控运维处理，不伪造cancel能力。' }], completion: '只有返回合法ID并回查同一ID字段一致，才能报告创建已核实。', idempotency: '后端创建没有requestId或SDK幂等键；超时先回查，未确认前不要重复create。',
  }),
  'finance-setting-voucher-templates-prepare-set-status': base({
    purpose: '根据最新列表完整行生成Portal状态按钮需要的整行PUT草稿，并保留previous。', effect: 'prepare', inputs: { current: input('最新凭证模板完整列表行', '同一次list结果中的list[]', { type: 'object' }), targetStatus: input('与current.status相反的绝对状态', '用户明确的启用/停用意图', { type: 'integer', options: statusOptions }) }, output: preparedStatusOutput,
    consume: ['把draft原样交给setStatus；不要缩减成{ id, status }，因为Portal实际把整行展开后PUT。', '保存previous；只有用户明确要求恢复且已确认当前状态未被并发修改时才再次提交previous。'], steps: [{ role: 'required', when: '用户确认状态变更', capabilityId: 'finance-setting-voucher-templates-set-status', mapping: { draft: 'result.draft' }, instruction: '提交完整整行draft。' }], completion: '仅生成本地状态载荷，尚未改变模板状态。', idempotency: null,
  }),
  'finance-setting-voucher-templates-set-status': base({
    purpose: '复现Portal列表状态按钮，用完整列表行PUT /update把凭证模板设置为绝对启用或停用状态。', effect: 'write', inputs: { draft: input('prepareSetStatus返回的完整列表行草稿', 'finance-setting-voucher-templates-prepare-set-status.result.draft或previous', { type: 'object' }), 'draft.id': input('目标凭证模板ID', 'draft.id', { type: 'string | number', constraints: idRules }), 'draft.status': input('目标绝对状态', 'draft.status', { type: 'integer', options: statusOptions }) }, output: trueOutput,
    consume: ['返回true只表示Java update接口回执；成功或超时按draft.id回查list/get的status。', '恢复时提交previous整行，但必须先核对没有覆盖其他管理员的并发修改。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'finance-setting-voucher-templates-get', mapping: { id: 'args.draft.id' }, instruction: '回查同一ID的status和基础字段。' }, { role: 'cancel', when: '用户明确要求恢复且previous仍对应未变更的整行', capabilityId: 'finance-setting-voucher-templates-set-status', mapping: { draft: 'context.previous' }, instruction: '把previous作为补偿写；不是事务回滚。' }], completion: 'GET回执为true且回查status等于目标值后，才能报告状态已核实。', idempotency: '后端没有requestId或幂等键；绝对状态重复提交也可能覆盖并发修改，超时先回查。',
  }),
  'finance-setting-voucher-templates-export': base({
    purpose: '按当前列表筛选条件导出凭证模板基础信息Excel。', effect: 'read', inputs: pageInputs, output: exportOutput,
    consume: ['保存base64文件；导出请求只发送name、businessType、businessDetail、orgAttributes、cashItem、status，不发送order/page分页键。', 'Java文件名是“凭证模版基础信息.xls”，保留SDK返回的contentType和byteLength。'], steps: [], completion: '获得非空二进制导出文件；不代表列表写入状态。', idempotency: null,
  }),
  'finance-setting-voucher-templates-preview': base({
    purpose: '复现列表页预览按钮的本地bridge行为，保留传入记录字段供预览组件消费。', effect: 'local', inputs: { record: input('来自列表的凭证模板记录或bridge记录', 'finance-setting-voucher-templates-list结果中的一行', { type: 'object' }), 'record.id': input('预览记录的凭证模板ID', 'record.id', { type: 'string | number', constraints: idRules }) }, output: { shape: 'object', fields: [field('$', 'object', '本地预览桥接记录'), ...rowFields(''), field('entrySaveReqVOList', 'array', '若调用方提供则原样保留的预览分录；列表行通常不含完整分录', { optional: true, nullable: true, nullMeaning: '列表响应没有完整分录，预览组件显示空白分录' })], empty: '非法记录抛错；不会发请求或虚构详情分录。' }, consume: ['预览只是列表行的本地路由桥接；需要完整分录先调用get，不能把预览结果当落库详情。'], steps: [{ role: 'optional', when: '用户需要完整会计分录预览', capabilityId: 'finance-setting-voucher-templates-get', mapping: { id: 'args.record.id' }, instruction: '先get详情，再把真实entry数据作为bridge记录。' }], completion: '返回可传给本地预览路由的记录，不改变服务器数据。', idempotency: null,
  }),
}

export const FINANCE_SETTING_VOUCHER_TEMPLATES_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS).map(id => [id, RAW_FINANCE_SETTING_VOUCHER_TEMPLATES_AI_CONTRACTS[id]!]))
export const FINANCE_SETTING_VOUCHER_TEMPLATES_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS).map(id => {
  const method = FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS[id as keyof typeof FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS]
  const source = FINANCE_SETTING_VOUCHER_TEMPLATES_AI_CONTRACTS[id]!
  return ['financeSettingVoucherTemplates.' + method, { ...source, boundaries: [...source.boundaries, `公开方法 financeSettingVoucherTemplates.${method} 接受单个对象参数；list、exportExcel可省略对象并使用页面默认筛选。`] }]
}))
