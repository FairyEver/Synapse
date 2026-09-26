import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_COST_CENTER_METHODS } from '../capabilities/finance-setting-cost-center.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })

const idRules = ['安全正整数或无前导零的正整数字符串', '长ID保留字符串，不能用名称、行号或租户ID代替']
const statusOptions = [{ value: 0, label: '停用' }, { value: 1, label: '启用' }]
const attributeOptions = [
  { value: 1, label: '生产成本' },
  { value: 2, label: '辅助生产成本' },
  { value: 3, label: '制造费用' },
  { value: 4, label: '研发费用' },
  { value: 5, label: '销售费用' },
  { value: 6, label: '管理费用' },
]

const orgFields = (prefix: string): AiField[] => [
  field(`${prefix}.orgId`, 'string | number', '关联组织主键；页面提交orgIds使用，不是成本中心ID', { constraints: idRules }),
  field(`${prefix}.orgName`, 'string', '关联组织名称展示值', { nullable: true, nullMeaning: '后端未返回组织名称' }),
  field(`${prefix}.fullPath`, 'string', '组织完整路径展示值', { nullable: true, nullMeaning: '后端未返回完整路径' }),
]

const rowFields = (prefix: string): AiField[] => {
  const base = prefix ? `${prefix}.` : ''
  return [
    field(`${base}id`, 'string | number', '成本中心主键；详情、编辑和启停使用', { constraints: idRules }),
    field(`${base}name`, 'string', '成本中心名称；新建和编辑页面字段，最多500字符', { nullable: true, nullMeaning: '后端未返回名称' }),
    field(`${base}code`, 'string', '成本中心编码；页面展示和提交快照，服务端按账套覆盖', { nullable: true, nullMeaning: '后端未返回编码' }),
    field(`${base}unitId`, 'string | number', '所属组织ID；字段历史名称为unitId，编辑页面禁用', { nullable: true, nullMeaning: '后端未返回所属组织' }),
    field(`${base}unitName`, 'string', '所属组织名称展示值；不能代替unitId', { nullable: true, nullMeaning: '后端未返回所属组织名称' }),
    field(`${base}companyId`, 'string | number', '已废弃的公司ID响应字段；页面不消费', { optional: true, nullable: true, nullMeaning: '后端固定为空或未返回' }),
    field(`${base}companyName`, 'string', '已废弃的公司名称响应字段；页面不消费', { optional: true, nullable: true, nullMeaning: '后端固定为空或未返回' }),
    field(`${base}companyOrgName`, 'string', '已废弃的公司组织名称响应字段；页面不消费', { optional: true, nullable: true, nullMeaning: '后端固定为空或未返回' }),
    field(`${base}legalPersonId`, 'string | number', '账套所属法人ID；页面详情可展示，不能代替accountingSetId', { nullable: true, nullMeaning: '后端未解析法人' }),
    field(`${base}legalPersonName`, 'string', '账套所属法人名称展示值', { nullable: true, nullMeaning: '后端未解析法人名称' }),
    field(`${base}accountingSetId`, 'string | number', '所属账套ID；页面由resolve-org-scope预填，服务端最终解析和覆盖', { nullable: true, nullMeaning: '尚未解析或后端未返回账套' }),
    field(`${base}accountingSetName`, 'string', '所属账套名称展示值；禁止作为保存字段', { nullable: true, nullMeaning: '后端未返回账套名称' }),
    field(`${base}status`, 'integer', '成本中心绝对状态；0停用、1启用，列表筛选和启停都使用数值', { values: { '0': '停用', '1': '启用' } }),
    field(`${base}orgList`, 'array<object>', '成本中心包含的组织响应列表；编辑时转换为orgIds，允许空数组'),
    field(`${base}orgList[]`, 'object', '一个关联组织'),
    ...orgFields(`${base}orgList[]`),
    field(`${base}updateTime`, 'string', '更新时间原值；SDK不擅自转换时区', { nullable: true, nullMeaning: '后端未返回更新时间' }),
    field(`${base}orgAttribute`, 'integer', '组织财务属性：1生产成本、2辅助生产成本、3制造费用、4研发费用、5销售费用、6管理费用', { nullable: true, values: { '1': '生产成本', '2': '辅助生产成本', '3': '制造费用', '4': '研发费用', '5': '销售费用', '6': '管理费用' }, nullMeaning: '后端未返回组织财务属性' }),
    field(`${base}subjectCodePrefix`, 'string', '该财务组织属性对应的科目编码前缀；页面不编辑', { nullable: true, nullMeaning: '后端未返回科目编码前缀' }),
    field(`${base}editable`, 'boolean', '后端判定当前成本中心是否可编辑', { nullable: true, nullMeaning: '后端未返回可编辑标志' }),
    field(`${base}deletable`, 'boolean', '后端判定当前成本中心是否可删除；页面没有删除按钮', { nullable: true, nullMeaning: '后端未返回可删除标志' }),
    field(`${base}disableReason`, 'string', '后端拒绝编辑/删除的原因；不是保存成功标志', { nullable: true, nullMeaning: '没有禁用原因' }),
  ]
}

const scopeFields: AiField[] = [
  field('$', 'object', '按组织解析的账套和法人范围'),
  field('orgId', 'string | number', '输入组织ID的后端回显', { nullable: true, nullMeaning: '后端未返回组织ID', constraints: idRules }),
  field('orgName', 'string', '组织名称', { nullable: true, nullMeaning: '后端未返回组织名称' }),
  field('accountingSetId', 'string | number', '解析得到的账套ID；创建表单保存时服务端仍会最终校验', { nullable: true, nullMeaning: '组织没有可解析账套', constraints: idRules }),
  field('accountingSetName', 'string', '解析得到的账套名称；只用于展示，不传给保存接口', { nullable: true, nullMeaning: '组织没有可解析账套名称' }),
  field('companyId', 'string | number', '已废弃公司ID', { nullable: true, nullMeaning: '后端固定为空或未返回' }),
  field('companyOrgName', 'string', '已废弃公司组织名称', { nullable: true, nullMeaning: '后端固定为空或未返回' }),
  field('legalPersonId', 'string | number', '向上解析得到的法人ID', { nullable: true, nullMeaning: '未解析法人', constraints: idRules }),
  field('legalPersonName', 'string', '向上解析得到的法人名称', { nullable: true, nullMeaning: '未解析法人名称' }),
  field('companyName', 'string', '已废弃公司全称', { nullable: true, nullMeaning: '后端固定为空或未返回' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [field('$', 'object', '成本中心分页结果'), field('list', 'array', '当前页列表；不是全部匹配记录'), field('list[]', 'object', '一条成本中心列表行'), ...rowFields('list[]'), field('total', 'integer', '筛选后的总记录数；不是当前页长度', { constraints: ['非负整数'] })],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、网络或响应形状失败会抛错，不改写为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [field('$', 'object', '成本中心详情'), ...rowFields('')],
  empty: '详情必须包含合法id、status和页面消费字段；后端找不到记录时请求失败，不返回null冒充不存在。',
}

const draftFields: AiField[] = [
  field('$', 'object', '尚未写入的成本中心保存草稿'),
  field('draft', 'object', '提交给create或update的CostCenterSaveReqVO业务字段'),
  field('draft.id', 'string | number', '编辑时的成本中心ID；新建按Portal保留空字符串占位', { optional: true, constraints: idRules }),
  field('draft.name', 'string', '成本中心名称；去首尾空白后不能为空，最多500字符'),
  field('draft.unitId', 'string | number', '所属组织ID；不是组织名称', { constraints: idRules }),
  field('draft.code', 'string', '页面生成/回填的编码快照；服务端按账套重新生成或覆盖', { nullable: true, nullMeaning: '未完成页面编码预填时发送null' }),
  field('draft.orgAttribute', 'integer', '组织财务属性1至6', { values: { '1': '生产成本', '2': '辅助生产成本', '3': '制造费用', '4': '研发费用', '5': '销售费用', '6': '管理费用' } }),
  field('draft.orgIds', 'array<string | number>', '成本中心包含的组织ID数组；页面没有必填规则，空数组保持后端虚拟组织/既有关联处理', { constraints: idRules }),
  field('draft.accountingSetId', 'string | number', '页面解析得到的账套ID快照；服务端按组织最终解析和覆盖', { nullable: true, nullMeaning: '未完成页面账套预填时发送null', constraints: idRules }),
  field('draft.status', 'integer', '保存时的绝对状态；新建固定为1，编辑沿用current.status', { values: { '0': '停用', '1': '启用' } }),
]

const statusOutput: AiContract['output'] = {
  shape: '{ draft: { id, status }, previous: { id, status } }',
  fields: [
    field('$', 'object', '启停目标草稿和操作前快照'),
    field('draft', 'object', '提交给setStatus的绝对状态'),
    field('draft.id', 'string | number', '成本中心主键', { constraints: idRules }),
    field('draft.status', 'integer', '目标绝对状态：0停用、1启用', { values: { '0': '停用', '1': '启用' } }),
    field('previous', 'object', '操作前状态快照；可用于显式恢复'),
    field('previous.status', 'integer', '操作前绝对状态', { values: { '0': '停用', '1': '启用' } }),
  ],
  empty: 'targetStatus与current.status相同或字段非法时抛错，不产生草稿。',
}

const listInputs: Record<string, AiParameter> = {
  name: optional('成本中心名称筛选文本', '页面名称输入框', '发送null，不按名称筛选', { type: 'string', nullable: true, nullMeaning: '不按名称筛选' }),
  code: optional('成本中心编码筛选文本', '页面编码输入框', '发送null，不按编码筛选', { type: 'string', nullable: true, nullMeaning: '不按编码筛选' }),
  unitName: optional('所属组织名称筛选文本', '页面所属组织名称输入框', '发送null，不按组织名称筛选', { type: 'string', nullable: true, nullMeaning: '不按组织名称筛选' }),
  accountingSetId: optional('账套ID筛选', '页面账套选择器', '发送null，不按账套筛选', { type: 'string | number', nullable: true, constraints: idRules }),
  orgId: optional('组织ID筛选', '页面组织树选择器', '发送null，不按组织及其下级筛选', { type: 'string | number', nullable: true, constraints: idRules }),
  orgAttribute: optional('组织财务属性筛选', '页面org_attributes字典选择器', '发送null，不按组织财务属性筛选', { type: 'integer', nullable: true, options: attributeOptions }),
  status: optional('列表绝对状态：0停用、1启用', '页面状态单选', '默认发送数值1启用', { type: 'integer', options: statusOptions }),
  pageNo: optional('从1开始的页码', '调用方分页状态', '默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('当前页条数', '调用方分页状态', '默认20；页面支持10、20、50、100', { type: 'integer', constraints: ['只能取10、20、50、100'] }),
}

const createInputs: Record<string, AiParameter> = {
  name: input('成本中心名称', '用户在新增表单名称输入框填写', { type: 'string', constraints: ['去首尾空白后不能为空', '最多500个字符'] }),
  unitId: input('所属组织ID；字段历史名称为unitId', '用户在新增表单所属组织树选择器选中的节点ID', { type: 'string | number', constraints: idRules }),
  orgAttribute: input('成本中心组织财务属性字典值', '用户在新增表单org_attributes选择器的数值', { type: 'integer', options: attributeOptions }),
  orgIds: optional('成本中心包含的组织ID数组', '新增表单组织树多选结果；带前缀的树节点ID会按Portal取下划线后的原始ID', '发送空数组；页面没有required规则，后端创建时可能建立虚拟组织', { type: 'array<string | number>', constraints: idRules }),
  code: optional('页面自动生成的成本中心编码快照', 'unitId变化后generate-code结果或用户已确认的表单code', '发送null；服务端按账套生成并覆盖', { type: 'string', nullable: true }),
  accountingSetId: optional('页面按所属组织解析的账套ID快照', 'unitId变化后resolve-org-scope结果.accountingSetId', '发送null；服务端按组织所属法人解析并覆盖', { type: 'string | number', nullable: true, constraints: idRules }),
}

const updateInputs: Record<string, AiParameter> = {
  current: input('最新完整成本中心行或详情', 'finance-setting-cost-center-get结果或list.list[]', { type: 'object', constraints: ['必须包含id、name、unitId、orgAttribute、status和orgList/组织ID'] }),
  changes: optional('页面明确修改的字段', '用户在编辑表单中修改的名称或组织财务属性', '沿用current；禁止修改页面禁用的unitId、code、orgIds、accountingSetId和隐藏status', { type: 'object', nullable: true }),
}

const draftInput = (source: string): AiParameter => input('prepare返回的完整保存草稿；不要手写或删除字段', source, { type: 'object' })

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:f61fdca151 app/portal/menus/finance.js 与 app/portal/views/dashboard/finance/setting/cost-center.vue', kind: 'reference', note: '证明菜单路径、路由权限和页面入口；不是浏览器网络实测。' },
  { source: 'CodeReview_Projects_Js@test/portal/main:f61fdca151 app/portal/views/dashboard/finance/setting/cost-center/list.vue、[mode]/[id].vue', kind: 'reference', note: '证明列表默认筛选、数值状态、按钮权限、详情加载、联动预填、必填规则、提交载荷和页面不可达动作。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:7aeaca409d5 CostCenterController、PageReqVO、SaveReqVO、RespVO、CostCenterOrgScopeRespVO、CostCenterServiceImpl', kind: 'reference', note: '证明端点、Long ID、响应字段、服务端覆盖编码/账套、空orgIds处理和状态校验；不是部署环境实测。' },
  { source: 'src/capabilities/finance-setting-cost-center.ts', kind: 'implementation', note: '证明SDK页面上下文、默认请求、表单校验、保存载荷、响应投影和绝对状态启停。' },
  { source: 'test/finance-setting-cost-center.test.ts', kind: 'test', note: '离线夹具逐页锁定Portal/Java静态证据、默认参数、表单提交规则、权限端点、坏响应和AI关键字段反证；测试不发真实网络。' },
]

const boundaries = [
  '能力只覆盖Portal“财务设置→成本中心管理”列表、详情、新建/编辑表单、所属组织联动预填和行内启停；moduleType按页面推导为null，不发送module-type头。',
  '列表状态筛选严格发送数值0/1；响应status也是数值0/1；setStatus使用同样的绝对数值，不把成本中心状态改成Boolean。',
  'Portal表单只要求name、unitId、orgAttribute；orgIds允许为空，accountingSetName是展示字段，提交时必须删除，code/accountingSetId由服务端最终覆盖。',
  '长ID保留字符串；Portal树节点可能带前缀，提交前只取下划线后的原始组织ID，但不把长数字转成不安全JavaScript number。',
  '页面没有删除、导入、初始化或可达取消按钮；后端存在的不可达端点不登记为本页能力。',
]

const failures = [
  'ID、名称、组织、财务属性、状态或分页参数非法时在发请求前失败；不要用名称代替ID，也不要把状态布尔值发给列表/启停接口。',
  '列表缺少list/total、详情缺少页面消费字段、联动响应形状错误或写入回执不是true/合法ID时抛错；不能把HTTP成功或空对象改写成业务成功。',
  '权限不足、组织不属于当前租户、账套/法人不一致、编码或组织唯一性校验失败由后端暴露；SDK不通过删除或放宽断言掩盖失败。',
  '写请求超时结果不确定：创建按返回ID回查，编辑/启停按同一ID回查；页面没有安全的删除/取消补偿接口。',
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“财务设置→成本中心管理”页面的查询、详情、表单联动、新建、编辑和启停动作。',
    boundaries,
    prerequisites: ['已建立带有效会话token与tenantId的platform SDK；页面菜单和按钮权限由Portal/后端裁决。', '写入前保留prepare返回的draft/previous，并确认当前成本中心没有被其他人修改。'],
    failures,
    evidence,
    gaps: ['未启动浏览器，未取得真实网络基准，也未在测试环境执行逐页读请求或prepare→submit→cancel写闭环；本契约基于固定Portal/Java源码和离线测试。', '页面没有可达删除/取消接口，新建成功后的清理不能由SDK安全代办；实际权限、字典和响应变体仍需真实环境验证。'],
    ...value,
  }
}

export const FINANCE_SETTING_COST_CENTER_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-cost-center-list': contract({
    purpose: '按成本中心管理页面的筛选和分页读取列表，保留详情、编辑和启停所需完整行字段。',
    effect: 'read',
    inputs: listInputs,
    output: pageOutput,
    consume: ['用list和total渲染当前页；status按数值0/1解释为停用/启用。', '保留同一行完整id、status和orgList；写入前优先get刷新详情，不能用名称或行号定位。'],
    steps: [
      { role: 'optional', when: '用户查看或编辑某条成本中心', capabilityId: 'finance-setting-cost-center-get', mapping: { id: 'result.list[].id' }, instruction: '使用列表行id读取最新详情。' },
      { role: 'optional', when: '用户新建成本中心', capabilityId: 'finance-setting-cost-center-prepare-create', mapping: {}, instruction: '先收集新增表单字段并准备草稿。' },
      { role: 'optional', when: '用户编辑成本中心', capabilityId: 'finance-setting-cost-center-prepare-update', mapping: { current: 'result.list[]' }, instruction: '使用完整列表行，不只传展示名称。' },
    ],
    completion: '返回当前筛选条件下的严格分页结果；list为空是业务空结果，不是权限或网络错误。',
    idempotency: null,
  }),
  'finance-setting-cost-center-get': contract({
    purpose: '读取成本中心详情页和编辑表单所需的完整响应字段。',
    effect: 'read',
    inputs: { id: input('成本中心主键ID', 'list.list[].id或用户已确认的详情ID', { type: 'string | number', constraints: idRules }) },
    output: detailOutput,
    consume: ['展示名称、编码、所属组织、账套、法人、组织财务属性和后端可编辑标志。', '编辑时将orgList[].orgId转换为保存草稿的orgIds；accountingSetName只展示，不提交。'],
    steps: [],
    completion: '获得可用于展示或prepareUpdate的最新完整成本中心详情。',
    idempotency: null,
  }),
  'finance-setting-cost-center-resolve-org-scope': contract({
    purpose: '复现新增表单选择所属组织后按组织解析账套和法人展示信息的联动请求。',
    effect: 'read',
    inputs: { orgId: input('所属组织ID', '新增表单unitId选择结果', { type: 'string | number', constraints: idRules }) },
    output: { shape: 'object', fields: scopeFields, empty: '组织不存在、无权限或响应形状错误时抛错；不把空对象当作没有账套。' },
    consume: ['将accountingSetId/accountingSetName回填到表单展示；提交时只使用accountingSetId，绝不把accountingSetName当保存字段。'],
    steps: [],
    completion: '返回该组织当前会话可见的账套/法人解析结果；不代表成本中心已创建。',
    idempotency: null,
  }),
  'finance-setting-cost-center-generate-code': contract({
    purpose: '复现新增表单选择所属组织后自动生成成本中心编码的联动请求。',
    effect: 'read',
    inputs: { unitId: input('所属组织ID', '新增表单unitId选择结果', { type: 'string | number', constraints: idRules }) },
    output: { shape: 'string', fields: [field('$', 'string', '页面回填的成本中心编码；服务端保存时仍会按账套最终覆盖')], empty: '后端返回null/undefined时SDK按Portal回填空字符串；请求失败抛错。' },
    consume: ['将返回字符串回填到code；不要把code当作成本中心主键，也不要在调用方手工拼接编码。'],
    steps: [],
    completion: '获得页面可展示的编码预填值；不代表成本中心已写入。',
    idempotency: null,
  }),
  'finance-setting-cost-center-prepare-create': contract({
    purpose: '按Portal新增表单必填规则和保存字段生成无副作用的成本中心创建草稿。',
    effect: 'prepare',
    inputs: createInputs,
    output: { shape: '{ draft: FinanceSettingCostCenterSaveDraft & { id: "" } }', fields: draftFields, empty: 'name、unitId、orgAttribute或ID非法时抛错，不返回半成品草稿。' },
    consume: ['先使用resolve-org-scope和generate-code补齐账套/编码快照；orgIds可为空，accountingSetName不得传入。', '检查draft.status=1且只保留SaveReqVO业务字段，再交给create。'],
    steps: [{ role: 'required', when: '用户确认新建成本中心', capabilityId: 'finance-setting-cost-center-create', mapping: { draft: 'result.draft' }, instruction: 'create接口接收表单字段并重新生成同一草稿；不要自行加入accountingSetName。' }],
    completion: '生成符合Portal提交规则、尚未发网络请求的创建草稿。',
    idempotency: null,
  }),
  'finance-setting-cost-center-create': contract({
    purpose: '创建一个成本中心并返回后端分配的主键。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-cost-center-prepare-create.result.draft') },
    output: { shape: 'string | number', fields: [field('$', 'string | number', '新创建成本中心主键；不是unitId、orgId或accountingSetId', { constraints: idRules })], empty: '后端未返回合法主键时抛错。' },
    consume: ['保存返回的成本中心ID；随后get同一ID核对名称、组织、属性和status，不能只凭HTTP成功。'],
    steps: [
      { role: 'required', when: '创建返回ID后确认落库', capabilityId: 'finance-setting-cost-center-get', mapping: { id: 'result.$' }, instruction: '用返回ID回查详情，核对服务端最终生成的code/accountingSetId和用户确认的业务字段。' },
      { role: 'cancel', when: '创建失败、超时或用户要求撤销', instruction: '页面和SDK没有删除/取消接口；先按返回ID或唯一字段回查确认是否已写入，不能伪造cancel或盲目重复创建。' },
    ],
    completion: '后端返回合法ID且回查确认成本中心已按预期落库。',
    idempotency: '没有requestId或SDK幂等包装；超时先回查，未确认前不要重发。',
  }),
  'finance-setting-cost-center-prepare-update': contract({
    purpose: '基于最新成本中心行合并Portal编辑页允许修改的name/orgAttribute，生成完整保存草稿和操作前快照。',
    effect: 'prepare',
    inputs: updateInputs,
    output: { shape: '{ draft: FinanceSettingCostCenterSaveDraft & { id }, previous: FinanceSettingCostCenterSaveDraft & { id } }', fields: [...draftFields, field('previous', 'object', '编辑前完整保存快照；用于显式补偿而非事务回滚'), field('previous.id', 'string | number', '编辑前同一成本中心ID', { constraints: idRules })], empty: 'current缺少页面保存字段或changes包含unitId/code/orgIds/accountingSetId/status等禁改字段时抛错。' },
    consume: ['changes只填写name或orgAttribute；unitId、code、orgIds、accountingSetId和status沿用current。', '保留previous；编辑超时先get同一ID判断终态，不要直接把previous当作已回滚。'],
    steps: [{ role: 'required', when: '用户确认保存编辑', capabilityId: 'finance-setting-cost-center-update', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的draft；update会按同一页面规则重新校验并发送完整SaveReqVO字段。' }],
    completion: '生成带同一成本中心ID的可提交draft和操作前快照，未发网络请求。',
    idempotency: null,
  }),
  'finance-setting-cost-center-update': contract({
    purpose: '更新一个已有成本中心；只开放Portal编辑页实际可修改的名称和组织财务属性。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-cost-center-prepare-update.result.draft') },
    output: { shape: 'boolean', fields: [field('$', 'boolean', '后端更新成功标志；只接受true', { values: { true: '更新成功' } })], empty: 'false或其它回执抛错。' },
    consume: ['返回true后用current.id重新get，核对name、orgAttribute、code、accountingSetId和关联组织；不要把true当作字段已落库的唯一证据。'],
    steps: [
      { role: 'required', when: '更新返回true或超时后确认终态', capabilityId: 'finance-setting-cost-center-get', mapping: { id: 'context.draft.id' }, instruction: '回查同一成本中心ID并核对最终字段。' },
      { role: 'recovery', when: '用户明确要恢复且previous来自同一成本中心ID', capabilityId: 'finance-setting-cost-center-update', mapping: { draft: 'context.previous' }, instruction: '把previous作为新的编辑草稿提交；这是显式补偿，不是事务回滚。' },
    ],
    completion: '后端返回true且回查确认同一ID达到预期字段。',
    idempotency: '没有requestId或SDK幂等包装；超时先回查同一ID，不能盲目重复更新。',
  }),
  'finance-setting-cost-center-prepare-set-status': contract({
    purpose: '根据最新成本中心行和用户明确的绝对目标状态生成启停草稿及恢复快照。',
    effect: 'prepare',
    inputs: { current: input('最新完整成本中心列表行或详情行', 'finance-setting-cost-center-list.list[]或get结果', { type: 'object' }), targetStatus: input('绝对目标状态：0停用或1启用；必须与current.status相反', '用户明确的启用/停用意图', { type: 'integer', options: statusOptions, constraints: ['不能传toggle或与current.status相同'] }) },
    output: statusOutput,
    consume: ['确认draft.status是用户明确的目标后交给setStatus；previous只用于需要恢复时的显式输入。'],
    steps: [{ role: 'required', when: '用户确认启停', capabilityId: 'finance-setting-cost-center-set-status', mapping: { draft: 'result.draft' }, instruction: '提交绝对draft，不要在调用方根据旧值再次toggle。' }],
    completion: '产生无副作用的绝对数值状态载荷和操作前快照。',
    idempotency: null,
  }),
  'finance-setting-cost-center-set-status': contract({
    purpose: '把成本中心设置为绝对启用或停用状态。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-cost-center-prepare-set-status.result.draft') },
    output: { shape: 'boolean', fields: [field('$', 'boolean', '后端状态更新成功标志；只接受true', { values: { true: '更新成功' } })], empty: 'false或其它回执抛错。' },
    consume: ['成功后按draft.id重新get核对status；启用时后端仍会执行编码和组织唯一性校验。'],
    steps: [
      { role: 'required', when: '启停返回true或超时后确认终态', capabilityId: 'finance-setting-cost-center-get', mapping: { id: 'context.draft.id' }, instruction: '回查同一ID，不要按列表位置认领结果。' },
      { role: 'recovery', when: '用户明确恢复操作前状态且previous来自同一记录', capabilityId: 'finance-setting-cost-center-set-status', mapping: { draft: 'context.previous' }, instruction: '把previous作为绝对状态再次提交；这不是事务回滚。' },
    ],
    completion: '后端返回true且回查确认同一ID达到目标status。',
    idempotency: '绝对状态重复提交通常收敛，但没有requestId；超时仍须先按同一ID回查。',
  }),
}

export const FINANCE_SETTING_COST_CENTER_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_COST_CENTER_METHODS).map(([id, method]) => [`financeSettingCostCenter.${method}`, FINANCE_SETTING_COST_CENTER_AI_CONTRACTS[id]!]),
)
