import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_SETTLEMENT_SETTING_METHODS } from '../capabilities/finance-setting-settlement-setting.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const statusOptions = [{ value: 0, label: '停用' }, { value: 1, label: '启用' }]
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用组织名称、行号或租户ID代替']

const boundaries = [
  '覆盖Portal页面实际可达的列表、详情、组织树、新建、编辑和启停；页面没有删除按钮，不发布删除能力。',
  '表单按Portal展开提交字段：组织范围先从树节点/节点对象value提取ID；long_term会把effectiveEnd发送为空字符串；更新保留id与全部页面字段。',
  '页面状态按钮源码把{ params: { id, status } }作为PUT第二参数，因此SDK保留实际body形状并在契约中标记该前端/Java @RequestParam冲突；不能把它当作真实写入已验证。',
  '使用platform实例、moduleType=null；组织树请求使用页面组件默认excludePost=false。',
]
const failures = [
  '状态、枚举、组织ID、月份范围或分页非法时不发请求；range要求结束月份存在且不早于开始月份，long_term强制空结束月。',
  '列表/详情/组织树响应形状错误或写接口非true回执时抛错，不改写为空列表或成功。',
  '401/403、网络错误和后端业务错误原样抛出；页面feature flag关闭时不能据SDK描述推断部署可用。',
  '写入超时先按同一ID回查；更新/启停可用previous恢复，创建没有页面取消/删除动作，不能伪造回滚。',
]
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/menus/finance.js 与 app/portal/views/dashboard/finance/setting/settlement-setting.vue', kind: 'reference', note: '证明菜单、页面权限和路径；固定检出未pull。' },
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 settlement-setting/list.vue、[mode]/[id].vue、config.js、tree-select/post-tree/index.vue', kind: 'reference', note: '证明列表/表单默认值、字段校验、请求体、按钮权限、组织树默认请求和状态PUT调用形状。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 SettlementSettingController、SaveReqVO、PageReqVO、RespVO、ServiceImpl', kind: 'reference', note: '证明Java端点、字段、范围规则、状态RequestParam和true回执；固定检出未pull。' },
  { source: 'src/capabilities/finance-setting-settlement-setting.ts', kind: 'implementation', note: '证明SDK请求体/字段校验/模块上下文及previous快照；不替代真实部署验证。' },
  { source: 'test/finance-setting-settlement-setting.test.ts', kind: 'test', note: '离线锁定请求、表单规则、状态body冲突、组织树、坏响应和AI映射反证。' },
]
function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“财务设置→结转单设置”页面，读取列表/详情/组织树或提交新建、编辑、启停。',
    boundaries,
    prerequisites: ['已建立带有效会话token和tenantId的platform SDK；页面受feature flag和菜单/按钮权限共同控制。', '写入前获取同一ID的最新详情或列表行，并保存prepare返回的previous。'],
    failures, evidence,
    gaps: ['未启动浏览器、未取得独立网络基准、未在真实测试环境执行读或写；prepare→submit→cancel闭环未实测。', 'Portal/Java固定检出未按任务约束pull；状态按钮的前端body与Java RequestParam是否由部署网关兼容尚未验证。'],
    ...value,
  }
}

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '结转单设置主记录ID；详情、编辑、启停使用它', { constraints: idRules }),
  field('list[].accountingEntityType', 'string', '核算主体类型：standard_unit或corporation', { nullable: true, nullMeaning: '后端未返回类型' }),
  field('list[].accountingScopeOrgIds', 'array<string | number>', '核算范围组织ID数组；不是组织名称数组', { constraints: ['ID来自组织树命名空间'] }),
  field('list[].externalSalesBelongType', 'string', '外销归属：sales_org或delivery_org', { nullable: true, nullMeaning: '后端未返回归属方式' }),
  field('list[].validType', 'string', '有效期类型：range或long_term', { nullable: true, nullMeaning: '后端未返回有效期类型' }),
  field('list[].effectiveStart', 'string', '生效开始月份，YYYY-MM', { nullable: true, nullMeaning: '后端未返回开始月份', format: 'YYYY-MM' }),
  field('list[].effectiveEnd', 'string', 'range结束月份；long_term通常为空', { nullable: true, nullMeaning: '长期有效或后端未返回结束月份', format: 'YYYY-MM' }),
  field('list[].status', 'integer', '绝对状态：0停用、1启用', { values: { '0': '停用', '1': '启用' } }),
  field('list[].creatorName', 'string', '创建人名称；页面为空时显示短横线', { nullable: true, nullMeaning: '后端未返回创建人' }),
  field('list[].createTime', 'string | number', '创建时间原值；页面格式化显示', { nullable: true, nullMeaning: '后端未返回创建时间' }),
]
const saveInputs: Record<string, AiParameter> = {
  accountingEntityType: input('核算主体类型', '页面下拉选择', { type: 'string', options: [{ value: 'standard_unit', label: '标准化单元' }, { value: 'corporation', label: '法人主体' }] }),
  accountingScopeOrgIds: input('核算范围组织ID数组', '页面组织树多选；节点对象取value', { type: 'array<string | number>', constraints: ['至少一项', 'ID不能重复'] }),
  externalSalesBelongType: input('外销归属主体类型', '页面下拉选择', { type: 'string', options: [{ value: 'sales_org', label: '销售组织' }, { value: 'delivery_org', label: '发货组织' }] }),
  validType: input('有效期类型', '页面单选', { type: 'string', options: [{ value: 'range', label: '时间范围' }, { value: 'long_term', label: '长期有效' }] }),
  effectiveStart: input('生效开始月份', '页面month picker value-format=YYYY-MM', { type: 'string', format: 'YYYY-MM' }),
  effectiveEnd: optional('生效结束月份', 'range页面结束月份；long_term不使用', 'long_term时SDK发送空字符串', { type: 'string', nullable: true, format: 'YYYY-MM' }),
  status: optional('绝对状态：0停用、1启用', '页面状态单选或默认1', 'SDK默认发送1', { type: 'integer', options: statusOptions }),
}
const pageOutput: AiContract['output'] = { shape: '{ list: array, total: integer }', fields: [field('$', 'object', '结转单设置分页结果'), field('list', 'array', '当前页记录'), field('list[]', 'object', '列表行'), ...rowFields, field('total', 'integer', '匹配总数，不是当前页长度')], empty: 'list=[]且total=0表示无匹配记录；权限或响应校验失败抛错。' }
const detailOutput: AiContract['output'] = {
  shape: 'object | null',
  fields: [
    field('$', 'object | null', '详情对象或null', { nullable: true, nullMeaning: 'ID不可见/不存在' }),
    field('id', 'string | number', '结转单设置主记录ID', { constraints: idRules }),
    field('accountingEntityType', 'string', '核算主体类型：standard_unit或corporation', { nullable: true }),
    field('accountingScopeOrgIds', 'array<string | number>', '核算范围组织ID数组'),
    field('externalSalesBelongType', 'string', '外销归属主体类型：sales_org或delivery_org', { nullable: true }),
    field('validType', 'string', '有效期类型：range或long_term', { nullable: true }),
    field('effectiveStart', 'string', '生效开始月份，YYYY-MM', { nullable: true, format: 'YYYY-MM' }),
    field('effectiveEnd', 'string', 'range结束月份；long_term通常为空', { nullable: true, format: 'YYYY-MM' }),
    field('status', 'integer', '绝对状态：0停用、1启用', { values: { '0': '停用', '1': '启用' } }),
  ],
  empty: 'null不能作为更新草稿。',
}
const statusOutput: AiContract['output'] = { shape: '{ draft: { id, status }, previous: { id, status } }', fields: [field('$', 'object', '启停目标和恢复快照'), field('draft', 'object', '目标状态载荷'), field('draft.id', 'string | number', '记录ID'), field('draft.status', 'integer', '目标状态', { values: { '0': '停用', '1': '启用' } }), field('previous', 'object', '操作前状态快照')], empty: '目标与当前相同则准备阶段失败。' }
const saveOutput: AiContract['output'] = { shape: '{ draft: object, previous?: object }', fields: [field('$', 'object', '带页面字段的保存草稿'), field('draft.id', 'string | number', '更新记录ID或创建时空字符串'), field('draft.accountingEntityType', 'string', '核算主体类型'), field('draft.accountingScopeOrgIds', 'array<string | number>', '组织ID数组'), field('draft.externalSalesBelongType', 'string', '外销归属方式'), field('draft.validType', 'string', '有效期类型'), field('draft.effectiveStart', 'string', '开始月份'), field('draft.effectiveEnd', 'string', '结束月份或long_term空字符串'), field('draft.status', 'integer', '绝对状态：0停用、1启用')], empty: '非法枚举、组织或月份时不返回草稿。' }

const queryInputs: Record<string, AiParameter> = {
  accountingEntityType: optional('核算主体类型筛选', '页面筛选下拉', 'SDK发送undefined，不限制类型', { type: 'string', nullable: true }),
  status: optional('状态筛选：0停用、1启用', '页面状态单选', 'SDK默认1', { type: 'integer', options: statusOptions }),
  pageNo: optional('页码', '调用方分页', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('页大小', '调用方分页', 'SDK默认20', { type: 'integer', constraints: ['10、20、50、100'] }),
}

export const FINANCE_SETTING_SETTLEMENT_SETTING_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-settlement-setting-list': contract({ purpose: '分页查询结转单设置列表。', effect: 'read', inputs: queryInputs, output: pageOutput, consume: ['展示主体、核算范围数量、归属方式、有效期和状态；按total分页。', '保留list[].id/status供详情、编辑和启停。'], steps: [{ role: 'optional', when: '需要表单组织选择或范围展示', capabilityId: 'finance-setting-settlement-setting-organization-tree', mapping: {}, instruction: '读取组织树并按节点ID关联列表范围；不以名称代替ID。' }], completion: '返回当前筛选页和total。', idempotency: null }),
  'finance-setting-settlement-setting-get': contract({ purpose: '读取结转单设置详情作为编辑/详情快照。', effect: 'read', inputs: { id: input('结转单设置ID', '列表行id', { type: 'string | number', constraints: idRules }) }, output: detailOutput, consume: ['用详情中的全部页面字段构造编辑草稿；组织树加载后按ID显示名称。'], steps: [{ role: 'optional', when: '详情需要展开组织名称', capabilityId: 'finance-setting-settlement-setting-organization-tree', mapping: {}, instruction: '按accountingScopeOrgIds关联树节点。' }], completion: '获得详情或明确null。', idempotency: null }),
  'finance-setting-settlement-setting-organization-tree': contract({ purpose: '读取结转单表单使用的角色组织树。', effect: 'read', inputs: {}, output: { shape: 'array', fields: [field('$', 'array', '组织树根节点数组'), field('[].id', 'string | number', '组织ID'), field('[].name', 'string', '组织名称'), field('[].pid', 'string | number', '父组织ID', { nullable: true }), field('[].children', 'array', '子节点')], empty: '[]表示当前会话没有可见组织；请求失败抛错。' }, consume: ['用节点id填充accountingScopeOrgIds；用isCorporation/isStandardUnit决定范围清单展示。'], steps: [], completion: '获得可供页面选择的组织树。', idempotency: null }),
  'finance-setting-settlement-setting-prepare-create': contract({ purpose: '按页面表单规则生成新建草稿。', effect: 'prepare', inputs: saveInputs, output: saveOutput, consume: ['确认草稿后交给create；long_term的effectiveEnd已经是空字符串。'], steps: [{ role: 'required', when: '用户确认新建', capabilityId: 'finance-setting-settlement-setting-create', mapping: { accountingEntityType: 'result.draft.accountingEntityType', accountingScopeOrgIds: 'result.draft.accountingScopeOrgIds', externalSalesBelongType: 'result.draft.externalSalesBelongType', validType: 'result.draft.validType', effectiveStart: 'result.draft.effectiveStart', effectiveEnd: 'result.draft.effectiveEnd', status: 'result.draft.status' }, instruction: '只提交草稿；创建没有页面取消接口。' }], completion: '获得无副作用创建草稿。', idempotency: null }),
  'finance-setting-settlement-setting-create': contract({ purpose: '创建结转单设置。', effect: 'write', inputs: saveInputs, output: { shape: 'string | number', fields: [field('$', 'string | number', '新建记录ID', { constraints: idRules })], empty: '没有合法ID时失败。' }, consume: ['保存ID后list/get回查字段和状态；HTTP成功不等于落库证据。'], steps: [{ role: 'required', when: '返回ID后回查', capabilityId: 'finance-setting-settlement-setting-get', mapping: { id: 'result.$' }, instruction: '按同一ID读取并核对有效期、组织范围和状态。' }, { role: 'cancel', when: '创建需清理', instruction: '页面无删除/取消动作，停止并报告需受控运维清理。' }], completion: '返回合法ID且回查确认。', idempotency: '后端没有requestId或SDK幂等包装；请求超时先按返回ID或创建字段回查，未确认前不要重复创建；页面没有可达删除/取消动作。' }),
  'finance-setting-settlement-setting-prepare-update': contract({ purpose: '合并当前详情与页面字段变更，生成完整更新载荷和previous。', effect: 'prepare', inputs: { current: input('最新详情/列表完整值', 'finance-setting-settlement-setting-get.$', { type: 'object' }), changes: optional('页面字段变更', '用户编辑意图', '省略表示不变', { type: 'object | null', nullable: true }) }, output: saveOutput, consume: ['确认draft后交给update；previous用于恢复。'], steps: [{ role: 'required', when: '用户确认更新', capabilityId: 'finance-setting-settlement-setting-update', mapping: { current: 'result.draft' }, instruction: '提交完整draft，不要只发变更字段。' }], completion: '获得完整更新草稿。', idempotency: null }),
  'finance-setting-settlement-setting-update': contract({ purpose: '更新结转单设置表单字段。', effect: 'write', inputs: { current: input('当前完整值', '最新get结果', { type: 'object' }), 'current.id': input('当前结转单设置ID', 'current详情中的id', { type: 'string | number', constraints: idRules }), changes: optional('页面字段变更', '用户编辑意图', '省略表示不变', { type: 'object | null', nullable: true }) }, output: { shape: 'boolean', fields: [field('$', 'boolean', 'Java update成功标志；只接受true', { values: { true: '更新成功' } })], empty: '非true回执失败。' }, consume: ['成功后按id回查；需要恢复时把prepare.previous重新作为current交给update。'], steps: [{ role: 'required', when: '更新成功或超时后', capabilityId: 'finance-setting-settlement-setting-get', mapping: { id: 'args.current.id' }, instruction: '回查同一ID的完整值。' }, { role: 'cancel', when: '用户明确恢复且previous仍有效', capabilityId: 'finance-setting-settlement-setting-update', mapping: { current: 'context.previous' }, instruction: '用previous恢复；不是事务回滚。' }], completion: '返回true且回查确认。', idempotency: '后端没有requestId或SDK幂等包装；更新是整条记录覆盖，超时先按同一ID读取确认，恢复也是一次新的PUT，不能盲目重试以免覆盖并发修改。' }),
  'finance-setting-settlement-setting-prepare-set-status': contract({ purpose: '生成绝对启停目标和previous快照。', effect: 'prepare', inputs: { current: input('最新列表行', 'list[].id/status', { type: 'object' }), targetStatus: input('目标状态', '用户明确意图', { type: 'integer', options: statusOptions }) }, output: statusOutput, consume: ['把draft交给setStatus；previous仅用于恢复。'], steps: [{ role: 'required', when: '用户确认启停', capabilityId: 'finance-setting-settlement-setting-set-status', mapping: { draft: 'result.draft' }, instruction: '提交绝对状态，不使用toggle。' }], completion: '获得无副作用启停草稿。', idempotency: null }),
  'finance-setting-settlement-setting-set-status': contract({ purpose: '按Portal实际请求形状启停结转单设置。', effect: 'write', inputs: { draft: input('prepareSetStatus返回的{ id, status }', 'prepare结果', { type: 'object' }), 'draft.id': input('目标记录ID', 'draft中的id', { type: 'string | number', constraints: idRules }), 'draft.status': input('目标绝对状态', 'draft中的status', { type: 'integer', options: statusOptions }) }, output: { shape: 'boolean', fields: [field('$', 'boolean', 'Java成功标志；只接受true', { values: { true: '成功' } })], empty: '非true失败。' }, consume: ['回查同一ID确认终态；页面源码body/query冲突未在真实环境验证。'], steps: [{ role: 'required', when: '写入返回true或超时后', capabilityId: 'finance-setting-settlement-setting-list', mapping: {}, instruction: '按同一ID回查，不以HTTP成功代替证据。' }, { role: 'cancel', when: '明确恢复且previous有效', capabilityId: 'finance-setting-settlement-setting-set-status', mapping: { draft: 'context.previous' }, instruction: '重新提交previous；仍保留Portal body形状。' }], completion: '返回true且回查确认目标状态。', idempotency: '后端没有requestId或SDK幂等包装；这是绝对状态写入，重复同一目标不会切换到相反状态，但前端body/query冲突仍需部署验证，超时必须先按同一ID回查。' }),
}

export const FINANCE_SETTING_SETTLEMENT_SETTING_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(FINANCE_SETTING_SETTLEMENT_SETTING_METHODS).map(([id, method]) => [`financeSettingSettlementSetting.${method}`, FINANCE_SETTING_SETTLEMENT_SETTING_AI_CONTRACTS[id]!]))
