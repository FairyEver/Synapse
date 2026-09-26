import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INVENTORY_ASSET_DEPRECIATION_CONFIG_METHODS } from '../capabilities/inventory-asset-depreciation-config.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用名称、树层级或列表行号代替ID']

const rowFields = (prefix: string): AiField[] => {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number', '资产折旧配置主键', { optional: true, nullable: true, nullMeaning: '后端未返回主键', constraints: idRules }),
    field(at('assetCategory'), 'integer', '资产类别ID', { nullable: true, nullMeaning: '后端未返回资产类别' }),
    field(at('depreciationMethod'), 'string | number', '折旧方法字典值；编辑表单按Portal转为字符串', { nullable: true, nullMeaning: '后端未返回折旧方法' }),
    field(at('depreciationYear'), 'integer', '折旧年限，单位年', { nullable: true, nullMeaning: '后端未返回折旧年限' }),
    field(at('depreciationLifeMonth'), 'integer', '列表筛选/显示使用的折旧年限月数', { optional: true, nullable: true, nullMeaning: '后端未返回月数' }),
    field(at('depreciationDate'), 'integer', '折旧日，页面限制1至25', { nullable: true, nullMeaning: '后端未返回折旧日' }),
    field(at('netSalvageValueRate'), 'number', '净残值率，单位百分比，0至100', { nullable: true, nullMeaning: '后端未返回净残值率' }),
    field(at('materialCategory'), 'string | number', '物料分类ID', { nullable: true, nullMeaning: '未选择物料分类；提交时为null', constraints: idRules }),
    field(at('materialCategoryPath'), 'string', '物料分类路径，仅展示', { nullable: true, nullMeaning: '后端未返回路径' }),
    field(at('isCurrMonthDep'), 'integer', '新增资产是否当月折旧：0下月、1当月', { nullable: true, nullMeaning: '后端未返回规则' }),
    field(at('isDepreciationReduction'), 'integer', '资产减少当月是否继续折旧：0不折旧、1折旧', { nullable: true, nullMeaning: '后端未返回规则' }),
    field(at('createTime'), 'string', '创建时间原值', { optional: true, nullable: true, nullMeaning: '后端未返回创建时间' }),
  ]
}

const listOutput: AiContract['output'] = { shape: '{ list: array, total: integer }', fields: [field('$', 'object', '资产折旧配置分页'), field('list', 'array', '当前页记录'), field('list[]', 'object', '一条资产折旧配置'), ...rowFields('list[]'), field('total', 'integer', '筛选总数')], empty: 'list=[]且total=0表示当前筛选无记录；权限、网络或响应形状错误会抛出。' }
const detailOutput: AiContract['output'] = { shape: 'object', fields: [field('$', 'object', '资产折旧配置编辑表单快照'), ...rowFields('')], empty: '没有详情时失败，不能拿空对象当作新增表单。' }
const assetCategoryOutput: AiContract['output'] = { shape: 'array', fields: [field('$', 'array', '资产类别候选'), field('[]', 'object', '一个资产类别候选'), field('[].id', 'string | number', '资产类别ID', { constraints: idRules }), field('[].categoryName', 'string', '资产类别名称'), field('[].label', 'string', 'Portal下拉标签'), field('[].value', 'string | number', 'Portal下拉值', { constraints: idRules })], empty: '[]表示当前会话没有资产类别候选。' }
const treeOutput: AiContract['output'] = { shape: 'array', fields: [field('$', 'array', '物料分类树'), field('[]', 'object', '根分类节点'), field('[].id', 'string | number', '分类ID', { constraints: idRules }), field('[].name', 'string', '分类名称'), field('[].children', 'array', '子分类节点')], empty: '[]表示当前会话没有可见分类；level=5时是Portal列表筛选使用的层级参数。' }
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [field('$', 'undefined', '请求成功无业务返回值；失败抛错')], empty: 'Promise完成只表示服务端接受请求，不等于配置已回查。' }
const prepareOutput = (label: string): AiContract['output'] => ({ shape: '{ draft: object }', fields: [field('$', 'object', `${label}前的本地草稿`), field('draft', 'object', '可确认后提交的完整草稿'), ...rowFields('draft')], empty: '字段非法时抛错；取消时不发请求。' })
const inputs: Record<string, AiParameter> = {
  depreciationLifeMonth: optional('折旧年限月数筛选', 'Portal折旧年限(月)输入框', 'SDK发送null，不限制年限', { type: 'integer', nullable: true, constraints: ['非负整数'] }),
  materialCategory: optional('物料分类ID筛选', 'Portal物料分类树', 'SDK发送null，不限制分类', { type: 'string | number', nullable: true, constraints: idRules }),
  pageNo: optional('页码，从1开始', 'Portal分页状态', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('每页条数', 'Portal分页状态', 'SDK默认20', { type: 'integer', constraints: ['10、20、50、100、200、500'] }),
}
const draftInputs: Record<string, AiParameter> = {
  assetCategory: input('资产类别ID', 'assetCategories[].id', { type: 'integer', constraints: ['正整数'] }),
  depreciationMethod: input('折旧方法字典值', 'Portal折旧方法字典下拉框', { type: 'string | number', constraints: ['非空正整数枚举；编辑页按Portal发送字符串'] }),
  depreciationYear: input('折旧年限，单位年', 'Portal数字输入框', { type: 'integer', constraints: ['非负整数'] }),
  depreciationDate: input('折旧时间(日)', 'Portal数字输入框', { type: 'integer', constraints: ['1至25整数'] }),
  netSalvageValueRate: input('净残值率', 'Portal数字输入框', { type: 'number', unit: '%', constraints: ['0至100'] }),
  materialCategory: optional('物料分类ID', 'Portal物料分类树', 'SDK发送null；Portal提交前把空值改为null', { type: 'string | number', nullable: true, constraints: idRules }),
  isCurrMonthDep: optional('新增资产计提折旧规则：0下月、1当月', 'Portal单选', 'SDK按Portal默认0', { type: 'integer', constraints: ['只能是0或1'] }),
  isDepreciationReduction: optional('资产减少计提规则：0当月不折旧、1当月折旧', 'Portal单选', 'SDK按Portal默认0', { type: 'integer', constraints: ['只能是0或1'] }),
}
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:8b9a5554d4 app/portal/views/dashboard/material/assets/setting/list.vue 与 [mode]/[id].vue、material/tree-select/materiel-category/index.vue', kind: 'reference', note: '证明列表筛选、资产类别候选的loopFetch分页、物料树、表单默认值、条件请求和POST/PUT/DELETE请求。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:d83e4086fd5 AssetDepreciationConfigController、PageReqVO、SaveReqVO、RespVO', kind: 'reference', note: '证明page/get/create/update/delete字段和按钮权限。' },
  { source: 'src/capabilities/inventory-asset-depreciation-config.ts', kind: 'implementation', note: '证明SDK把折旧年限月数筛选与折旧年限年提交分开，并复刻Portal空分类转null。' },
  { source: 'test/inventory-asset-depreciation-config.test.ts', kind: 'test', note: '离线锁定候选树、表单条件校验、请求载荷、端点和坏响应。' },
]
const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  whenToUse: '操作Portal“折旧配置”列表及其创建/编辑表单。',
  boundaries: ['能力归属于Portal系统设置下的折旧配置菜单；不扩展资产折旧分析、计提或导入页面。', '列表的depreciationLifeMonth是筛选字段，保存表单使用depreciationYear（单位年），两者不能互换。', '页面创建/编辑/删除按钮分别需要material:assets:setting:create/edit/delete；SDK不把页面permission检查当作后端按钮授权，403原样返回。'],
  prerequisites: ['已创建带有效会话token、tenantId和折旧配置页面上下文的SDK。', 'assetCategory、depreciationMethod等候选值来自页面候选接口，不用名称代替ID。'],
  failures: ['字段、权限、网络或响应形状错误原样抛出；不会吞掉Portal表单组件中的异常。', '写请求超时先get/list核对，不自动重复写入。'],
  evidence,
  gaps: ['未启动浏览器、未在真实测试环境执行读请求或prepare→submit→cancel写闭环；本契约来自最新固定源码和离线测试。', '真实测试环境部署版本与源码固定分支的运行时差异尚未验证。'],
  ...value,
})

const RAW: Record<string, AiContract> = {
  'inventory-asset-depreciation-config-list': base({ purpose: '按折旧年限月数和物料分类查询资产折旧配置分页。', effect: 'read', inputs, output: listOutput, consume: ['按total分页；展示资产类别、折旧方法、折旧年限、折旧日、净残值率、分类路径和两个计提规则。'], steps: [{ role: 'optional', when: '需要物料分类筛选候选', capabilityId: 'inventory-asset-depreciation-config-material-category-tree', mapping: { level: 'literal:5' }, instruction: '按level=5读取Portal列表使用的树，提交节点ID。' }], completion: '返回当前筛选页和total。', idempotency: null }),
  'inventory-asset-depreciation-config-get': base({ purpose: '读取一条资产折旧配置编辑表单的当前值。', effect: 'read', inputs: { id: input('资产折旧配置主键', 'inventory-asset-depreciation-config-list.list[].id', { type: 'string | number', constraints: idRules }) }, output: detailOutput, consume: ['以完整快照为基础修改；编辑页折旧方法以字符串回显，提交时可保留该值。'], steps: [{ role: 'optional', when: '用户确认修改', capabilityId: 'inventory-asset-depreciation-config-update', mapping: { id: 'result.id', assetCategory: 'result.assetCategory', depreciationMethod: 'result.depreciationMethod', depreciationYear: 'result.depreciationYear', depreciationDate: 'result.depreciationDate', netSalvageValueRate: 'result.netSalvageValueRate', materialCategory: 'result.materialCategory', isCurrMonthDep: 'result.isCurrMonthDep', isDepreciationReduction: 'result.isDepreciationReduction' }, instruction: '完整提交未修改字段；不要把depreciationLifeMonth回写成depreciationYear。' }], completion: '获得与Portal编辑表单一致的快照。', idempotency: null }),
  'inventory-asset-depreciation-config-asset-categories': base({ purpose: '读取折旧配置编辑页资产类别下拉候选。', effect: 'read', inputs: {}, output: assetCategoryOutput, consume: ['把value提交为assetCategory；label/categoryName只用于展示。'], steps: [], completion: '获得当前会话可见资产类别候选。', idempotency: null }),
  'inventory-asset-depreciation-config-material-category-tree': base({ purpose: '读取折旧配置列表或编辑页使用的物料分类树。', effect: 'read', inputs: { level: optional('物料分类树层级参数', 'Portal列表物料分类组件', '省略时按后端默认树返回；列表筛选使用5', { type: 'integer', nullable: true, constraints: ['正整数'] }) }, output: treeOutput, consume: ['提交选中节点的id；节点名称和路径只用于展示。'], steps: [], completion: '获得分类树。', idempotency: null }),
  'inventory-asset-depreciation-config-prepare-create': base({ purpose: '按折旧配置表单校验并准备创建草稿。', effect: 'prepare', inputs: draftInputs, output: prepareOutput('资产折旧配置创建'), consume: ['确认后交给create；取消时不发POST。', 'materialCategory空值已经固定为null；不把月数筛选字段放进草稿。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'inventory-asset-depreciation-config-create', mapping: { assetCategory: 'result.draft.assetCategory', depreciationMethod: 'result.draft.depreciationMethod', depreciationYear: 'result.draft.depreciationYear', depreciationDate: 'result.draft.depreciationDate', netSalvageValueRate: 'result.draft.netSalvageValueRate', materialCategory: 'result.draft.materialCategory', isCurrMonthDep: 'result.draft.isCurrMonthDep', isDepreciationReduction: 'result.draft.isDepreciationReduction' }, instruction: '按草稿逐字段提交。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃草稿，不调用create。' }], completion: '获得无副作用创建草稿。', idempotency: null }),
  'inventory-asset-depreciation-config-create': base({ purpose: '创建资产折旧配置。', effect: 'write', inputs: draftInputs, output: voidOutput, consume: ['成功后用list按资产类别/物料分类核对新记录；服务端返回ID时SDK当前不把它作为业务回执暴露。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-asset-depreciation-config-list', mapping: {}, instruction: '使用创建前的筛选条件回查字段；不要把HTTP完成当作落库证据。' }], completion: '请求未抛错且列表回查确认。', idempotency: '没有requestId；重复POST可能创建冲突或重复配置，超时先查询，不能自动重发。' }),
  'inventory-asset-depreciation-config-prepare-update': base({ purpose: '按现有详情准备一份完整资产折旧配置修改草稿。', effect: 'prepare', inputs: { id: input('资产折旧配置主键', 'get.id', { type: 'string | number', constraints: idRules }), ...draftInputs }, output: prepareOutput('资产折旧配置修改'), consume: ['确认后交给update；取消时不发PUT。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'inventory-asset-depreciation-config-update', mapping: { id: 'result.draft.id', assetCategory: 'result.draft.assetCategory', depreciationMethod: 'result.draft.depreciationMethod', depreciationYear: 'result.draft.depreciationYear', depreciationDate: 'result.draft.depreciationDate', netSalvageValueRate: 'result.draft.netSalvageValueRate', materialCategory: 'result.draft.materialCategory', isCurrMonthDep: 'result.draft.isCurrMonthDep', isDepreciationReduction: 'result.draft.isDepreciationReduction' }, instruction: '提交完整草稿。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃草稿，不调用update。' }], completion: '获得无副作用修改草稿。', idempotency: null }),
  'inventory-asset-depreciation-config-update': base({ purpose: '修改一条资产折旧配置。', effect: 'write', inputs: { id: input('资产折旧配置主键', 'get.id', { type: 'string | number', constraints: idRules }), ...draftInputs }, output: voidOutput, consume: ['完成后用get同一ID逐字段核对。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-asset-depreciation-config-get', mapping: { id: 'args.id' }, instruction: '核对完整保存字段，尤其区分depreciationYear与depreciationLifeMonth。' }], completion: '请求未抛错且get回查确认。', idempotency: '没有requestId；PUT是覆盖式更新，超时先get核实，不自动盲重试。' }),
  'inventory-asset-depreciation-config-prepare-remove': base({ purpose: '准备删除资产折旧配置并等待用户确认。', effect: 'prepare', inputs: { id: input('资产折旧配置主键', 'list[].id', { type: 'string | number', constraints: idRules }) }, output: { shape: '{ id: string | number }', fields: [field('$', 'object', '删除前草稿'), field('id', 'string | number', '待删除配置ID', { constraints: idRules })], empty: 'id非法时抛错；取消时不发DELETE。' }, consume: ['展示所选行并等待用户确认。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'inventory-asset-depreciation-config-remove', mapping: { id: 'result.id' }, instruction: '提交同一ID。' }, { role: 'cancel', when: '用户取消删除', instruction: '丢弃草稿，不调用remove。' }], completion: '获得无副作用删除草稿。', idempotency: null }),
  'inventory-asset-depreciation-config-remove': base({ purpose: '删除一条资产折旧配置。', effect: 'write', inputs: { id: input('资产折旧配置主键', 'prepareRemove.id', { type: 'string | number', constraints: idRules }) }, output: voidOutput, consume: ['按同一配置ID重新查询确认记录不再出现。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-asset-depreciation-config-list', mapping: {}, instruction: '回查同一ID；找不到才报告删除已确认。' }], completion: '请求未抛错且列表回查确认。', idempotency: '删除不可恢复且无requestId；超时先查询，不自动重放。' }),
}

export const INVENTORY_ASSET_DEPRECIATION_CONFIG_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(INVENTORY_ASSET_DEPRECIATION_CONFIG_METHODS).map(id => [id, RAW[id]!]))
export const INVENTORY_ASSET_DEPRECIATION_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INVENTORY_ASSET_DEPRECIATION_CONFIG_METHODS).map(([id, method]) => [`inventoryAssetDepreciationConfig.${method}`, INVENTORY_ASSET_DEPRECIATION_CONFIG_AI_CONTRACTS[id]!]))
