import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INVENTORY_STOCK_RULE_METHODS } from '../capabilities/inventory-stock-rule.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用分类名称或列表行号代替ID']

const rowFields = (prefix: string): AiField[] => {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number', '库存规则主键；用于读取、修改和删除', { optional: true, nullable: true, nullMeaning: '后端未返回主键', constraints: idRules }),
    field(at('materielCategoryId'), 'string | number', '物料分类ID', { nullable: true, nullMeaning: '未关联分类', constraints: idRules }),
    field(at('materielCategoryName'), 'string', '物料分类名称', { nullable: true, nullMeaning: '后端未返回名称' }),
    field(at('minPrice'), 'number', '最小价格，非负', { nullable: true, nullMeaning: '未设置最小价格' }),
    field(at('maxPrice'), 'number', '最大价格，非负', { nullable: true, nullMeaning: '未设置最大价格' }),
    field(at('type'), 'string', '库存规则类型值，来自typeList.value', { nullable: true, nullMeaning: '未设置类型' }),
    field(at('typeName'), 'string', '库存规则类型显示名称', { nullable: true, nullMeaning: '后端未返回类型名称' }),
    field(at('subtype'), 'integer', '规则子类型', { optional: true, nullable: true, nullMeaning: '后端未返回子类型' }),
    field(at('isUpdate'), 'integer', '是否更新库存：0否、1是', { nullable: true, nullMeaning: '后端未返回标志' }),
    field(at('createTime'), 'string', '创建时间原值', { optional: true, nullable: true, nullMeaning: '后端未返回创建时间' }),
  ]
}

const listOutput: AiContract['output'] = { shape: '{ list: array, total: integer }', fields: [field('$', 'object', '库存规则分页'), field('list', 'array', '当前页记录'), field('list[]', 'object', '一条库存规则'), ...rowFields('list[]'), field('total', 'integer', '筛选总数')], empty: 'list=[]且total=0表示当前筛选无记录；权限、网络或响应形状错误会抛出。' }
const detailOutput: AiContract['output'] = { shape: 'object', fields: [field('$', 'object', '库存规则编辑表单快照'), ...rowFields('')], empty: '没有详情时失败，不能拿空对象当新增表单。' }
const typeOutput: AiContract['output'] = { shape: 'array', fields: [field('$', 'array', '库存规则类型候选'), field('[]', 'object', '一条类型候选'), field('[].label', 'string', '类型显示名'), field('[].value', 'string', '提交给type的类型值'), field('[].dictType', 'string', '字典类型', { nullable: true, nullMeaning: '后端未返回字典类型' }), field('[].remark', 'string', '类型备注', { nullable: true, nullMeaning: '后端未返回备注' }), field('[].status', 'integer', '候选状态', { nullable: true, nullMeaning: '后端未返回状态' })], empty: '[]表示没有可选类型。' }
const treeOutput: AiContract['output'] = { shape: 'array', fields: [field('$', 'array', '物料分类树'), field('[]', 'object', '根分类节点'), field('[].id', 'string | number', '分类ID', { constraints: idRules }), field('[].name', 'string', '分类名称'), field('[].children', 'array', '子分类节点')], empty: '[]表示当前会话没有可见分类。' }
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [field('$', 'undefined', '请求成功无业务返回值；失败抛错')], empty: 'Promise完成只表示服务端接受请求，不等于列表已回查。' }
const prepareOutput = (label: string): AiContract['output'] => ({ shape: '{ draft: object }', fields: [field('$', 'object', `${label}前的本地草稿`), field('draft', 'object', '可确认后提交的完整表单草稿'), ...rowFields('draft')], empty: '字段非法时抛错；取消时不发请求。' })
const inputs: Record<string, AiParameter> = {
  materielCategoryId: optional('物料分类ID筛选', 'Portal物料分类树', 'SDK发送null，不限制分类', { type: 'string | number', nullable: true, constraints: idRules }),
  type: optional('库存规则类型值筛选', 'Portal类型下拉框', 'SDK发送null，不限制类型', { type: 'string', nullable: true }),
  pageNo: optional('页码，从1开始', 'Portal分页状态', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('每页条数', 'Portal分页状态', 'SDK默认20', { type: 'integer', constraints: ['10、20、50、100、200、500'] }),
}
const draftInputs: Record<string, AiParameter> = {
  materielCategoryId: optional('物料分类ID', 'Portal物料分类树', 'SDK发送null', { type: 'string | number', nullable: true, constraints: idRules }),
  minPrice: optional('最小价格', 'Portal数字输入框', 'SDK发送null', { type: 'number', nullable: true, constraints: ['非负数；页面没有强制小于maxPrice'] }),
  maxPrice: optional('最大价格', 'Portal数字输入框', 'SDK发送null', { type: 'number', nullable: true, constraints: ['非负数；页面没有强制大于minPrice'] }),
  type: optional('库存规则类型值', 'inventory-stock-rule-type-list.value', 'SDK发送null', { type: 'string', nullable: true }),
  isUpdate: optional('是否更新库存：0否、1是', 'Portal单选', 'SDK按Portal默认1', { type: 'integer', constraints: ['只能是0或1'] }),
}
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/material/store/material-rule/list.vue 与 [mode]/[id].vue、material/tree-select/materiel-category-new/index.vue', kind: 'reference', note: '证明筛选、类型候选、表单默认值、无前端rules、POST/PUT请求和通用删除URL拼接规则；固定检出未pull。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 StockRuleController、StockRulePageReqVO、StockRuleSaveReqVO、StockRuleRespVO', kind: 'reference', note: '证明page/get/typeList/create/update及Java静态DELETE query id映射；固定检出未pull。' },
  { source: 'src/capabilities/inventory-stock-rule.ts', kind: 'implementation', note: '证明SDK复刻Portal通用删除的/delete/{id}路径，并保留Java静态映射冲突作为未实测缺口。' },
  { source: 'test/inventory-stock-rule.test.ts', kind: 'test', note: '离线锁定类型/分类候选、表单默认值、增改删请求和删除路径冲突。' },
]
const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  whenToUse: '操作Portal“库存规则”列表及其创建/编辑表单。',
  boundaries: ['能力归属于Portal系统设置下的库存规则菜单；不扩展库存出入库或价格计算页面。', 'type必须使用typeList返回的value；物料分类使用ID；页面前端没有minPrice与maxPrice的相对大小校验，SDK不擅自增加。', '页面通用删除实际把deleteURL拼成DELETE /admin-api/inventory/stock-rule/delete/{id}，而固定Java Controller声明的是DELETE /delete?id=；该静态冲突未在真实环境验证，SDK按Web端实际调用保持路径。'],
  prerequisites: ['已创建带有效会话token、tenantId和库存规则页面上下文的SDK。', '写入前保留用户确认的完整表单或列表行ID。'],
  failures: ['字段、权限、网络或响应形状错误原样抛出；不把无rules当作无需校验。', '删除路径若在部署环境按Java query映射裁决可能返回404；不得自动切换到另一条路径，先报告并核对部署版本。'],
  evidence,
  gaps: ['未启动浏览器、未在真实测试环境执行读请求或prepare→submit→cancel写闭环；本契约来自固定源码和离线测试。', 'Portal/Java固定检出未按任务约束pull到远端最新，部署版本差异及删除路径冲突未取得真实回执。'],
  ...value,
})

const RAW: Record<string, AiContract> = {
  'inventory-stock-rule-list': base({ purpose: '按物料分类和规则类型查询库存规则分页。', effect: 'read', inputs, output: listOutput, consume: ['展示materielCategoryName、minPrice/maxPrice、typeName和isUpdate；保留id用于详情、编辑和删除。'], steps: [{ role: 'optional', when: '需要类型或分类筛选候选', capabilityId: 'inventory-stock-rule-type-list', mapping: {}, instruction: '先读取候选，再提交value。' }, { role: 'optional', when: '需要物料分类筛选候选', capabilityId: 'inventory-stock-rule-material-category-tree', mapping: {}, instruction: '提交节点ID，不用分类名称。' }], completion: '返回当前筛选页和total。', idempotency: null }),
  'inventory-stock-rule-get': base({ purpose: '读取一条库存规则编辑表单的当前值。', effect: 'read', inputs: { id: input('库存规则主键', 'inventory-stock-rule-list.list[].id', { type: 'string | number', constraints: idRules }) }, output: detailOutput, consume: ['以完整详情作为修改基线；页面默认isUpdate=1只适用于新增，不覆盖已有值。'], steps: [{ role: 'optional', when: '用户确认修改', capabilityId: 'inventory-stock-rule-update', mapping: { id: 'result.id', materielCategoryId: 'result.materielCategoryId', minPrice: 'result.minPrice', maxPrice: 'result.maxPrice', type: 'result.type', isUpdate: 'result.isUpdate' }, instruction: '完整提交表单字段。' }], completion: '获得与Portal编辑表单一致的快照。', idempotency: null }),
  'inventory-stock-rule-type-list': base({ purpose: '读取库存规则表单的类型候选。', effect: 'read', inputs: {}, output: typeOutput, consume: ['使用value提交type，使用label展示；不能把label代替value。'], steps: [], completion: '获得当前可用规则类型。', idempotency: null }),
  'inventory-stock-rule-material-category-tree': base({ purpose: '读取库存规则列表与编辑表单使用的物料分类树。', effect: 'read', inputs: {}, output: treeOutput, consume: ['提交选中节点id。'], steps: [], completion: '获得分类树。', idempotency: null }),
  'inventory-stock-rule-prepare-create': base({ purpose: '准备创建库存规则的完整表单草稿。', effect: 'prepare', inputs: draftInputs, output: prepareOutput('库存规则创建'), consume: ['确认后交给create；取消时不发POST。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'inventory-stock-rule-create', mapping: { materielCategoryId: 'result.draft.materielCategoryId', minPrice: 'result.draft.minPrice', maxPrice: 'result.draft.maxPrice', type: 'result.draft.type', isUpdate: 'result.draft.isUpdate' }, instruction: '按草稿逐字段提交。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃草稿，不调用create。' }], completion: '获得无副作用创建草稿。', idempotency: null }),
  'inventory-stock-rule-create': base({ purpose: '创建库存规则。', effect: 'write', inputs: draftInputs, output: voidOutput, consume: ['成功后按分类、价格、类型和isUpdate回查；不把HTTP完成当作落库证据。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-stock-rule-list', mapping: {}, instruction: '使用创建前筛选条件回查并核对字段。' }], completion: '请求未抛错且列表回查确认。', idempotency: '没有requestId；重复POST可能产生重复或业务冲突，超时先查询。' }),
  'inventory-stock-rule-prepare-update': base({ purpose: '准备修改库存规则的完整表单草稿。', effect: 'prepare', inputs: { id: input('库存规则主键', 'get.id', { type: 'string | number', constraints: idRules }), ...draftInputs }, output: prepareOutput('库存规则修改'), consume: ['确认后交给update；取消时不发PUT。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'inventory-stock-rule-update', mapping: { id: 'result.draft.id', materielCategoryId: 'result.draft.materielCategoryId', minPrice: 'result.draft.minPrice', maxPrice: 'result.draft.maxPrice', type: 'result.draft.type', isUpdate: 'result.draft.isUpdate' }, instruction: '按完整草稿提交。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃草稿，不调用update。' }], completion: '获得无副作用修改草稿。', idempotency: null }),
  'inventory-stock-rule-update': base({ purpose: '修改一条库存规则。', effect: 'write', inputs: { id: input('库存规则主键', 'get.id', { type: 'string | number', constraints: idRules }), ...draftInputs }, output: voidOutput, consume: ['完成后用get同一ID逐字段核对。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-stock-rule-get', mapping: { id: 'args.id' }, instruction: '核对完整表单字段。' }], completion: '请求未抛错且get回查确认。', idempotency: '没有requestId；PUT是覆盖式更新，超时先get核实。' }),
  'inventory-stock-rule-prepare-remove': base({ purpose: '准备删除库存规则并等待用户确认。', effect: 'prepare', inputs: { id: input('库存规则主键', 'list[].id', { type: 'string | number', constraints: idRules }) }, output: { shape: '{ id: string | number }', fields: [field('$', 'object', '删除前草稿'), field('id', 'string | number', '待删除库存规则ID', { constraints: idRules })], empty: 'id非法时抛错；取消时不发DELETE。' }, consume: ['展示所选行并等待确认。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'inventory-stock-rule-remove', mapping: { id: 'result.id' }, instruction: '提交同一ID。' }, { role: 'cancel', when: '用户取消删除', instruction: '丢弃草稿，不调用remove。' }], completion: '获得无副作用删除草稿。', idempotency: null }),
  'inventory-stock-rule-remove': base({ purpose: '按Portal通用列表删除路径删除一条库存规则。', effect: 'write', inputs: { id: input('库存规则主键', 'prepareRemove.id', { type: 'string | number', constraints: idRules }) }, output: voidOutput, consume: ['实际请求路径是DELETE /delete/{id}；请求完成后用list或get确认，若部署按Java query映射返回404应报告路径冲突。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-stock-rule-list', mapping: {}, instruction: '回查同一ID；不存在才报告已删除。' }], completion: '请求未抛错且回查确认，或明确报告静态路由冲突。', idempotency: '删除无requestId且不可逆；超时先查询，不自动重放。' }),
}

export const INVENTORY_STOCK_RULE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(INVENTORY_STOCK_RULE_METHODS).map(id => [id, RAW[id]!]))
export const INVENTORY_STOCK_RULE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INVENTORY_STOCK_RULE_METHODS).map(([id, method]) => [`inventoryStockRule.${method}`, INVENTORY_STOCK_RULE_AI_CONTRACTS[id]!]))
