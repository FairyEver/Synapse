import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INVENTORY_STOCK_LOCATION_METHODS } from '../capabilities/inventory-stock-location.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用组织/分类名称或列表行号代替ID']

const rowFields = (prefix: string): AiField[] => {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number', '库存地点主键', { optional: true, nullable: true, nullMeaning: '后端未返回主键', constraints: idRules }),
    field(at('unitId'), 'string | number', '所属标准化单元ID', { nullable: true, nullMeaning: '后端未返回单元ID', constraints: idRules }),
    field(at('unitName'), 'string', '所属组织名称', { nullable: true, nullMeaning: '后端未返回组织名称' }),
    field(at('materielCategoryId'), 'string | number', '物料分类ID', { nullable: true, nullMeaning: '后端未返回分类ID', constraints: idRules }),
    field(at('materielCategoryName'), 'string', '物料分类名称', { nullable: true, nullMeaning: '后端未返回分类名称' }),
    field(at('name'), 'string', '库存地点名称', { nullable: true, nullMeaning: '后端未返回地点名称' }),
    field(at('creator'), 'string | number', '创建人ID', { optional: true, nullable: true, nullMeaning: '后端未返回创建人ID', constraints: idRules }),
    field(at('creatorName'), 'string', '创建人名称', { nullable: true, nullMeaning: '后端未返回创建人名称' }),
    field(at('createTime'), 'string', '创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
    field(at('minQuantity'), 'number', '安全库存，非负，最多2位小数', { nullable: true, nullMeaning: '未设置安全库存' }),
    field(at('maxQuantity'), 'number', '库存最大容量，非负，最多2位小数', { nullable: true, nullMeaning: '未设置最大容量' }),
    field(at('status'), 'boolean', '是否启用；true显示停用，false显示启用'),
  ]
}

const listOutput: AiContract['output'] = { shape: '{ list: array, total: integer }', fields: [field('$', 'object', '库存地点分页'), field('list', 'array', '当前页记录'), field('list[]', 'object', '一条库存地点'), ...rowFields('list[]'), field('total', 'integer', '筛选总数')], empty: 'list=[]且total=0表示当前筛选无记录；权限、网络或响应形状错误会抛出。' }
const treeOutput = (label: string): AiContract['output'] => ({ shape: 'array', fields: [field('$', 'array', label), field('[]', 'object', '根节点'), field('[].id', 'string | number', '节点ID', { constraints: idRules }), field('[].name', 'string', '节点名称'), field('[].children', 'array', '子节点')], empty: '[]表示当前会话没有可见候选。' })
const createOutput: AiContract['output'] = { shape: '{ rows: array }', fields: [field('$', 'object', '创建前本地草稿'), field('rows', 'array', '按Portal弹窗顺序的创建行'), field('rows[]', 'object', '一条创建行'), field('rows[].unitId', 'string | number', '所属单元ID', { constraints: idRules }), field('rows[].materielCategoryId', 'string | number', '物料分类ID', { constraints: idRules }), field('rows[].name', 'string', '库存地点名称，最多20字符'), field('rows[].status', 'boolean', 'Portal创建固定true'), field('rows[].minQuantity', 'number', '安全库存，非负且最多2位小数', { nullable: true, nullMeaning: '未设置' }), field('rows[].maxQuantity', 'number', '最大容量，非负且最多2位小数', { nullable: true, nullMeaning: '未设置' })], empty: '没有创建行或字段非法时抛错；取消时不调用create。' }
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [field('$', 'undefined', '创建请求成功无业务返回值；失败抛错')], empty: 'Promise完成只表示服务端接受请求，不等于列表已回查。' }
const trueOutput: AiContract['output'] = { shape: 'boolean', fields: [field('$', 'boolean', '后端CommonResult.data；SDK只接受true', { values: { true: '启停请求成功' } })], empty: 'false或其它响应形状会抛错。' }
const cancelOutput: AiContract['output'] = { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true，表示本地草稿已放弃', { values: { true: '未发送网络请求' } })], empty: '取消只影响本地草稿，不改变服务端数据。' }
const inputs: Record<string, AiParameter> = {
  unitId: optional('所属标准化单元ID筛选', 'Portal所属单元树', 'SDK发送null，不限制单元', { type: 'string | number', nullable: true, constraints: idRules }),
  name: optional('库存地点名称筛选', 'Portal名称输入框', 'SDK发送null，不限制名称', { type: 'string', nullable: true }),
  pageNo: optional('页码，从1开始', 'Portal分页状态', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('每页条数', 'Portal分页状态', 'SDK默认20', { type: 'integer', constraints: ['10、20、50、100、200、500'] }),
}
const rowsInput: Record<string, AiParameter> = { rows: input('库存地点创建行数组', 'Portal“新增库存地点”弹窗', { type: 'array', constraints: ['至少一行；unitId和materielCategoryId必填；name最多20字符；数量非负且最多2位小数'] }) }
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/material/store/point-setting/list.vue 与 components/create-point.vue、material/tree-select/unit/index.vue、materiel-category/index.vue', kind: 'reference', note: '证明列表筛选、所属单元/物料分类候选、数组创建、status固定true及open/close请求；固定检出未pull。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 StockLocationController、StockLocationPageReqVO、StockLocationSaveReqVO、RespVO', kind: 'reference', note: '证明create接收数组、open/close接收JSON id、按钮权限和列表字段；固定检出未pull。' },
  { source: 'src/capabilities/inventory-stock-location.ts', kind: 'implementation', note: '证明SDK保留创建数组、启停目标状态校验和数量精度规则。' },
  { source: 'test/inventory-stock-location.test.ts', kind: 'test', note: '离线锁定树候选、创建数组、启停端点、状态反转和坏响应。' },
]
const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  whenToUse: '操作Portal“库存配置”列表、新增库存地点弹窗或启停动作。',
  boundaries: ['能力归属于Portal系统设置下的库存配置菜单；不扩展库存规则、库存出入库或其它物料页面。', '创建是数组提交，每行必须同时提交标准化单元ID、物料分类ID和地点名称；Portal把status固定为true。', '列表页没有编辑或删除按钮；Java虽有update/get/delete端点，但它们不是本页面可达动作，SDK不伪造这些入口。'],
  prerequisites: ['已创建带有效会话token、tenantId和库存配置页面上下文的SDK。', '启停的id、currentStatus和目标status必须来自同一次最新列表读取及用户明确选择。'],
  failures: ['字段、权限、网络或响应形状错误原样抛出；不吞掉Portal页面原本空catch隐藏的错误。', '写请求超时先list核对，不自动重复创建或启停。'],
  evidence,
  gaps: ['未启动浏览器、未在真实测试环境执行读请求或prepare→submit→cancel写闭环；本契约来自固定源码和离线测试。', 'Portal/Java固定检出未按任务约束pull到远端最新，部署版本差异未验证。'],
  ...value,
})

const RAW: Record<string, AiContract> = {
  'inventory-stock-location-list': base({ purpose: '按所属单元和库存地点名称查询库存地点分页。', effect: 'read', inputs, output: listOutput, consume: ['按total分页；展示unitName、materielCategoryName、name、creatorName、createTime、minQuantity、maxQuantity、status；保留id和status用于启停。'], steps: [{ role: 'optional', when: '需要所属单元或物料分类候选', capabilityId: 'inventory-stock-location-unit-tree', mapping: {}, instruction: '所属单元筛选提交节点ID。' }], completion: '返回当前筛选页和total。', idempotency: null }),
  'inventory-stock-location-unit-tree': base({ purpose: '读取库存配置页面所属单元树。', effect: 'read', inputs: {}, output: treeOutput('所属单元树'), consume: ['提交可选择标准化单元节点的id；树中的父节点可能只用于展示。'], steps: [], completion: '获得当前会话可见所属单元候选。', idempotency: null }),
  'inventory-stock-location-material-category-tree': base({ purpose: '读取新增库存地点使用的物料分类树。', effect: 'read', inputs: {}, output: treeOutput('物料分类树'), consume: ['提交选中节点id；节点名称只用于展示。'], steps: [], completion: '获得当前会话可见物料分类候选。', idempotency: null }),
  'inventory-stock-location-prepare-create': base({ purpose: '按新增库存地点弹窗规则准备多行创建草稿。', effect: 'prepare', inputs: rowsInput, output: createOutput, consume: ['展示每行的单元、分类、地点和数量；status由SDK固定true；取消时不发POST。'], steps: [{ role: 'required', when: '用户确认生成', capabilityId: 'inventory-stock-location-create', mapping: { rows: 'result.rows' }, instruction: '按原数组顺序提交。' }, { role: 'cancel', when: '用户取消新增弹窗', instruction: '丢弃草稿，不调用create。' }], completion: '获得无副作用创建草稿。', idempotency: null }),
  'inventory-stock-location-create': base({ purpose: '批量创建库存地点。', effect: 'write', inputs: rowsInput, output: voidOutput, consume: ['成功后按unitId、materielCategoryId和name逐行查询确认；创建接口无新ID回执。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-stock-location-list', mapping: { unitId: 'args.rows' }, instruction: '按创建前条件查询并逐行核对；映射中的数量和分类组合由instruction解释，不把数组元素当作单个unitId。' }], completion: '请求未抛错且列表回查确认。', idempotency: '无requestId；重复POST可能创建重复地点或业务冲突，超时先查询。' }),
  'inventory-stock-location-prepare-set-status': base({ purpose: '按Portal列表行当前状态准备库存地点启停草稿，不发送open或close请求。', effect: 'prepare', inputs: { id: input('库存地点主键', 'inventory-stock-location-list.list[].id', { type: 'string | number', constraints: idRules }), currentStatus: input('列表行当前status', '同一次list返回的status', { type: 'boolean' }), status: input('目标status；必须与currentStatus相反', '用户明确确认的启用或停用动作', { type: 'boolean' }) }, output: { shape: '{ draft: { id: string, status: boolean }, previous: { id: string, status: boolean } }', fields: [field('draft', 'object', '供setStatus提交的目标草稿'), field('draft.id', 'string', '库存地点ID'), field('draft.status', 'boolean', '目标绝对启用状态'), field('previous', 'object', '保存的原状态快照；仅用于调用方审计'), field('previous.status', 'boolean', '提交前列表状态')], empty: '目标状态与当前状态相同或ID/状态非法时抛错；不发送请求。' }, consume: ['向用户展示目标启停和previous；确认后原样把draft交给setStatus；取消调用cancel-set-status。'], steps: [{ role: 'required', when: '用户明确确认启停', capabilityId: 'inventory-stock-location-set-status', mapping: { draft: 'result.draft' }, instruction: '按status=true调用open，false调用close；不要用列表行名称代替ID。' }, { role: 'cancel', when: '用户取消启停', capabilityId: 'inventory-stock-location-cancel-set-status', mapping: {}, instruction: '丢弃本地draft，不发送请求。' }], completion: '得到带目标和原状态的无副作用草稿。', idempotency: null }),
  'inventory-stock-location-set-status': base({ purpose: '按prepareSetStatus生成的绝对目标状态启用或停用一个库存地点。', effect: 'write', inputs: { draft: input('启停目标草稿', 'inventory-stock-location-prepare-set-status.result.draft', { type: 'object', constraints: ['必须同时包含id和status；只能提交同一份prepare结果。'] }) }, output: trueOutput, consume: ['draft.status=true调用open，false调用close；完成后list回查同一ID和status。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-stock-location-list', mapping: {}, instruction: '回查同一库存地点ID的status；响应丢失时不要盲目重复启停。' }], completion: '后端返回true且列表回查确认目标status。', idempotency: '无requestId；这是绝对状态写入，超时先list核实再决定是否重试。' }),
  'inventory-stock-location-cancel-set-status': base({ purpose: '取消库存地点启停的本地草稿，不发送open或close请求。', effect: 'local', inputs: {}, output: cancelOutput, consume: ['只表示提交前草稿已放弃；不能撤销已经发送的启停请求。'], steps: [], completion: '返回cancelled=true且没有网络副作用。', idempotency: null }),
}

export const INVENTORY_STOCK_LOCATION_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(INVENTORY_STOCK_LOCATION_METHODS).map(id => [id, RAW[id]!]))
export const INVENTORY_STOCK_LOCATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INVENTORY_STOCK_LOCATION_METHODS).map(([id, method]) => [`inventoryStockLocation.${method}`, INVENTORY_STOCK_LOCATION_AI_CONTRACTS[id]!]))
