import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INVENTORY_VALUATION_METHODS, inventoryValuationCapabilities, PRICING_METHOD_DICT_TYPE } from '../capabilities/inventory-valuation.js'

const definitions = new Map(inventoryValuationCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用名称、编码、树层级或列表位置代替ID']
const pricingRules = ['取值1至6；候选标签和值以base-dict-get(dictType=inventory_pricing_method_type)为准', '4表示标准价法，4时price必填；5表示采购单价，出库类型下Portal禁用']

const rowFields: AiField[] = [
  field('list[]', 'object', '一条计价配置或详情对象'),
  field('list[].id', 'string | number', '计价配置ID；编辑、变动详情和删除使用此ID', { constraints: idRules }),
  field('list[].typeName', 'string | null', '出入库类型显示名；来自typeList的value映射', { nullable: true, nullMeaning: '后端未匹配类型' }),
  field('list[].companyName', 'string | null', '公司/组织名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].factoryId', 'string | number | null', '标准化单元/工厂ID；写入时来自unitTree可选节点', { nullable: true, nullMeaning: '后端未返回', constraints: idRules }),
  field('list[].factoryName', 'string | null', '标准化单元名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].materielId', 'string | number | null', '物料ID；单价历史页使用列表桥接值', { nullable: true, nullMeaning: '该配置按分类或后端未返回', constraints: idRules }),
  field('list[].materielCategoryId', 'string | number | null', '物料分类ID', { nullable: true, nullMeaning: '后端未返回', constraints: idRules }),
  field('list[].materielCategoryName', 'string | null', '物料分类显示名', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].materielName', 'string | null', '物料名称；列表价格历史链接的展示字段', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].pricingMethod', 'integer | null', '计价方式值；需要标签时查inventory_pricing_method_type字典', { nullable: true, nullMeaning: '后端未返回', constraints: pricingRules }),
  field('list[].type', 'string | null', '出入库字典类型代码，例如inventory_inbound_type', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].subtype', 'integer | null', '出入库字典子类型值；与type组成type-subtype', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].price', 'number | string | null', '配置单价；标准价法使用，保留后端数值形态', { nullable: true, nullMeaning: '未配置或后端未返回', unit: '元' }),
  field('list[].inAvgPrice', 'number | string | null', '上一月/当前记录的入库平均单价，列表价格单元展示值', { nullable: true, nullMeaning: '后端未返回', unit: '元' }),
  field('list[].outAvgPrice', 'number | string | null', '上一月/当前记录的出库平均单价，列表价格单元展示值', { nullable: true, nullMeaning: '后端未返回', unit: '元' }),
  field('list[].updateTime', 'string | null', '最后修改时间原文', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].updaterName', 'string | null', '最后修改人名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].updater', 'string | number | null', '最后修改人ID', { nullable: true, nullMeaning: '后端未返回', constraints: idRules }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [field('$', 'object', '计价配置分页结果；SDK保留list和total'), field('list', 'object[]', '当前页计价配置'), ...rowFields, field('total', 'integer', '符合工厂、分类、计价方式和出入库类型筛选的总条数')],
  empty: 'list=[]且total=0表示当前筛选无配置；权限、会话、网络或响应形状错误会抛出，不降级为空成功。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\.?/, '') || '$' })),
  empty: '不存在的ID、无权限、网络或响应形状错误会抛出；不会把不存在伪装成空详情。',
}

const typeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '出入库类型候选；value用于提交moveType'),
    field('[].label', 'string', '出入库类型显示名'),
    field('[].value', 'string', 'type-subtype组合值，例如inventory_inbound_type-1；创建/编辑的moveType原样取此值'),
    field('[].dictType', 'string | null', '出入库字典类型', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].remark', 'string | null', '候选备注', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].status', 'integer | null', '候选状态原值', { nullable: true, nullMeaning: '后端未返回' }),
  ],
  empty: '[]表示当前用户可见的出入库类型为空；不要自行拼接未返回的type-subtype。',
}

const categoryOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '五级物料分类树节点'),
    field('[].id', 'string | number', '物料分类ID；创建和筛选使用此ID', { constraints: idRules }),
    field('[].name', 'string', 'Portal选择器显示名，优先后端name，否则catName'),
    field('[].catName', 'string | null', '后端分类名称', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].level', 'integer', '按树位置重算的层级，根为1'),
    field('[].children', 'object[]', '子节点，结构相同'),
  ],
  empty: '[]表示没有可选分类；不能把名称或层级当作ID。',
}

const unitOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '工厂组织树节点'),
    field('[].id', 'string | number', '标准化单元/工厂ID；提交使用此ID', { constraints: idRules }),
    field('[].name', 'string', '组织名称'),
    field('[].isFactory', 'integer | null', 'Portal选择器原始工厂标记', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].disabled', 'boolean', '按Portal组件派生；isFactory!==1时为true'),
    field('[].children', 'object[]', '子组织节点，结构相同'),
  ],
  empty: '[]表示没有可见组织；不能用组织名称代替ID。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', 'Java CommonResult<Boolean>解包后的true；仍需按ID或组合字段回查终态')],
  empty: 'false、空响应或其它响应形状会抛出；不能只用HTTP成功判断写入完成。',
}

const changeLogOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '变动详情页使用的所有已拉取记录'),
    field('[].id', 'string | number', '变更记录ID', { constraints: idRules }),
    field('[].factoryId', 'string | number', '工厂ID', { constraints: idRules }),
    field('[].materielId', 'string | number', '物料ID；Portal详情页可能实际返回与路由配置ID不一致的记录'),
    field('[].oldPricingMethod', 'integer | null', '变更前计价方式；首次创建或删除场景可能为空', { nullable: true, nullMeaning: '该日志没有旧值', constraints: pricingRules }),
    field('[].newPricingMethod', 'integer | null', '变更后计价方式；删除场景可能为空', { nullable: true, nullMeaning: '删除导致没有新值', constraints: pricingRules }),
    field('[].createTime', 'string | null', '变更时间原文', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].creator', 'string | number | null', '变更人ID', { nullable: true, nullMeaning: '后端未返回', constraints: idRules }),
    field('[].creatorName', 'string | null', '变更人名称', { nullable: true, nullMeaning: '后端未补齐' }),
  ],
  empty: '[]表示指定factoryId与materielId没有变动记录；Portal按500条/页最多读取100页。',
}

const priceHistoryOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '出入库单价历史分页结果'),
    field('list', 'object[]', '当前页月度单价记录'),
    field('list[].id', 'string | number', '库存历史记录ID', { constraints: idRules }),
    field('list[].materielId', 'string | number | null', '物料ID', { nullable: true, nullMeaning: '后端未返回', constraints: idRules }),
    field('list[].factoryId', 'string | number', '工厂ID', { constraints: idRules }),
    field('list[].year', 'integer', '年份'),
    field('list[].month', 'integer', '月份1至12'),
    field('list[].inAvgPrice', 'number | string | null', '入库平均单价', { nullable: true, nullMeaning: '该月没有入库均价', unit: '元' }),
    field('list[].outAvgPrice', 'number | string | null', '出库平均单价', { nullable: true, nullMeaning: '该月没有出库均价', unit: '元' }),
    field('list[].createTime', 'string | null', '记录创建时间原文', { nullable: true, nullMeaning: '后端未返回' }),
    field('total', 'integer', '符合工厂和物料筛选的历史记录总数'),
  ],
  empty: 'list=[]且total=0表示没有历史单价；不能把空历史解释为0元。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/material.js、views/dashboard/material/store/valuation.vue、valuation/list.vue、valuation/components/create-valuation.vue、valuation/[mode]/[id].vue、valuation/detail/[id].vue、valuation/actions/view-price.vue', kind: 'reference', note: '逐页核对菜单权限、列表customLoad、多分类join、候选加载、创建/编辑表单规则、详情循环分页和单价历史参数。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test: PricingMethodConfigController、PricingMethodConfigSaveReqVO、PricingMethodConfigRespVO、PricingMethodChangeLogController/VO/Mapper、StockHistoryController/VO/Mapper、StockController', kind: 'reference', note: '核对实际端点、Boolean回执、计价更新/删除业务校验、出入库类型候选、历史分页与权限注解。' },
  { source: 'src/capabilities/inventory-valuation.ts、test/inventory-valuation.test.ts', kind: 'implementation', note: '锁定请求参数顺序语义、create/update subtype类型差异、标准价单价门禁、树映射、详情循环分页和坏响应反证；不替代真实环境回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作Portal「物料 → 库存管理 → 计价配置」列表、计价方式新建/修改、变动详情或出入库单价历史。',
  boundaries: [
    '页面路径是/dashboard/material/store/valuation/list，页面权限是/dashboard/material/store/valuation；页面请求使用platform实例并发送module-type=34。',
    `计价方式候选不是页面独立接口，而是Portal全局平台字典${PRICING_METHOD_DICT_TYPE}；调用方应使用base-dict-get读取当前候选，不要凭印象猜标签。`,
    '列表实际GET /admin-api/inventory/pricing-method-config/page，materielCategoryIds由页面数组直接join(",")，空数组也发送空字符串；不要把数组直接交给query序列化器。',
    '出入库类型实际GET /admin-api/inventory/stock/typeList；分类树实际GET /admin-api/inventory/asset-depreciation-config/get-materiel-category-tree?level=5；所属单元实际GET /admin-api/supply/organization/tree?isFactory=1&includeParents=1。',
    '创建实际POST /admin-api/inventory/pricing-method-config/create，body是数组；Portal创建payload的subtype是moveType拆分后的字符串。编辑实际PUT /admin-api/inventory/pricing-method-config/update，body是单对象且subtype经Number转换为数字。',
    'Portal在pricingMethod=4时要求price存在且非负、最多3位精度；出库类型下禁用计价方式5。修改/删除是否可执行还由后端检查当月入出库单和未定价单据，SDK不把按钮点击当成业务成功。',
    '变动详情页实际把路由计价配置ID放进pricing-method-change-log的materielId参数，并按500条/页最多100页循环；单价历史页使用列表行的materielId分页。',
  ],
  prerequisites: ['使用当前用户会话、tenant-id、module-type=34和页面权限创建SDK；所有ID来自当前可见列表、树或详情。', '写操作先调用prepare并保留返回draft；用户取消只丢弃draft，不调用对应submit。'],
  failures: ['ID、分页、moveType、计价方式、标准价单价、坏树/坏分页、权限、后端业务校验、网络或响应形状错误会抛出；不把空响应或HTTP成功降级为业务成功。'],
  evidence,
  gaps: ['已完成Portal/Java逐页静态核对与离线请求断言；尚未在真实测试环境执行本页create/update/delete的prepare→submit→cancel、权限拒绝和写后列表回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Inventory valuation contract has no definition: ${id}`)
  contracts[id] = value
}

const listInputs = {
  factoryId: param('所属单元/工厂ID；省略时按Portal发送null。', 'Portal所属单元树', { type: 'string | number', required: false, nullable: true, constraints: idRules }),
  pricingMethod: param('计价方式值；先用base-dict-get取inventory_pricing_method_type。', 'Portal平台字典下拉框', { type: 'integer', required: false, nullable: true, constraints: pricingRules }),
  materielCategoryIds: param('物料分类ID数组；SDK会严格按Portal join为逗号字符串。', 'Portal多选严格分类树', { type: 'array', required: false, nullable: true, constraints: idRules }),
  moveType: param('出入库类型的type-subtype组合值；来自typeList。', 'Portal出入库类型下拉框', { type: 'string', required: false, nullable: true }),
  pageNo: param('页码，从1开始，默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
  pageSize: param('每页条数，页面支持10、20、50、100，默认20。', 'Portal分页状态', { type: 'integer', required: false, default: '20' }),
}

const createInputs = { rows: param('创建行数组；每行factoryId、materielCategoryId、pricingMethod、moveType、price，Portal允许删空后提交空数组。', '分类树、单元树、typeList和用户填写的创建表格', { type: 'object[]', required: true }) }
const createDraftInputs = { draft: param('prepareCreate返回的draft；原样提交，不要把subtype字符串改成数字。', 'inventory-valuation-prepare-create.result.draft', { type: 'object[]', required: true }) }
const updateInputs = { id: param('计价配置ID。', '列表行或get结果', { type: 'string | number', required: true, constraints: idRules }), factoryId: param('详情中的工厂ID，Portal编辑请求会原样带回。', 'inventory-valuation-get结果', { type: 'string | number', required: true, constraints: idRules }), materielCategoryId: param('详情中的物料分类ID，Portal编辑请求会原样带回。', 'inventory-valuation-get结果', { type: 'string | number', required: true, constraints: idRules }), pricingMethod: param('新的计价方式值；4时price必填。', 'Portal计价方式下拉框', { type: 'integer', required: true, constraints: pricingRules }), moveType: param('新的type-subtype组合值；来自typeList。', 'Portal出入库类型下拉框', { type: 'string', required: true }), price: param('标准价法单价；非4时页面通常清为空，单位元，非负且最多3位小数。', 'Portal单价输入框', { type: 'number', required: false, nullable: true, unit: '元' }) }
const updateDraftInputs = {
  draft: param('prepareUpdate返回的draft；提交时SDK按Portal把moveType拆为type和数字subtype。', 'inventory-valuation-prepare-update.result.draft', { type: 'object', required: true }),
  'draft.id': param('草稿内的计价配置ID；后续get回查使用它。', 'inventory-valuation-prepare-update.result.draft.id', { type: 'string | number', required: false, constraints: idRules }),
}
const idDraftInputs = { id: param('计价配置ID。', '列表行', { type: 'string | number', required: true, constraints: idRules }) }

add('inventory-valuation-list', base({ purpose: '读取当前用户可见的计价配置分页。', effect: 'read', inputs: listInputs, output: listOutput, consume: ['展示list；编辑/变动详情/删除使用list[].id；价格历史使用list[].factoryId和list[].materielId。'], steps: [], completion: '得到符合当前筛选的计价配置分页。', idempotency: null }))
add('inventory-valuation-type-list', base({ purpose: '读取页面出入库类型下拉候选。', effect: 'read', inputs: {}, output: typeOutput, consume: ['把value原样作为moveType；不要只提交label。'], steps: [], completion: '得到type-subtype候选。', idempotency: null }))
add('inventory-valuation-material-category-tree', base({ purpose: '读取新增/筛选使用的五级物料分类树。', effect: 'read', inputs: {}, output: categoryOutput, consume: ['把节点id作为materielCategoryId或筛选ID；name仅展示。'], steps: [], completion: '得到分类树。', idempotency: null }))
add('inventory-valuation-unit-tree', base({ purpose: '读取新增和筛选使用的所属单元树。', effect: 'read', inputs: {}, output: unitOutput, consume: ['只把disabled=false的节点id作为factoryId；name仅作展示。'], steps: [], completion: '得到组织树及可选标记。', idempotency: null }))
add('inventory-valuation-get', base({ purpose: '读取编辑表单和变动详情页所需的计价配置详情。', effect: 'read', inputs: idDraftInputs, output: detailOutput, consume: ['保留factoryId、materielCategoryId、pricingMethod、type、subtype和price；编辑时用它们构造完整更新草稿。'], steps: [], completion: '得到指定配置详情。', idempotency: null }))
add('inventory-valuation-prepare-create', base({ purpose: '按Portal创建表格规则校验并准备计价配置数组。', effect: 'prepare', inputs: createInputs, output: { shape: '{ draft: object[] }', fields: [field('draft', 'object[]', '尚未提交的创建payload'), field('draft[].factoryId', 'string | number', '所属工厂ID', { constraints: idRules }), field('draft[].materielCategoryId', 'string | number', '物料分类ID', { constraints: idRules }), field('draft[].pricingMethod', 'integer', '计价方式值', { constraints: pricingRules }), field('draft[].type', 'string', '从moveType拆出的出入库字典类型'), field('draft[].subtype', 'string', '从moveType拆出的字符串子类型；创建请求保持字符串'), field('draft[].price', 'number | null', '单价；4时必填，单位元', { nullable: true, nullMeaning: '未配置' })], empty: '非法ID、moveType、计价方式、负单价、超过3位精度或4缺单价会抛错；取消不发POST。' }, consume: ['用户确认后把result.draft原样交给create；取消只丢弃draft。'], steps: [{ role: 'required', when: '用户确认创建', capabilityId: 'inventory-valuation-create', mapping: { draft: 'result.draft' }, instruction: '提交同一draft；成功或超时后按factoryId、materielCategoryId、type、subtype回查列表。' }, { role: 'cancel', when: '用户取消', instruction: '丢弃draft，不调用create。' }], completion: '得到Portal创建接口会接受的数组草稿。', idempotency: null }))
add('inventory-valuation-create', base({ purpose: '提交Portal新增计价配置数组。', effect: 'write', inputs: createDraftInputs, output: trueOutput, consume: ['返回true只表示后端回执；按每个草稿组合回查list确认记录。'], steps: [{ role: 'required', when: '请求返回true或超时', capabilityId: 'inventory-valuation-list', mapping: {}, instruction: '按factoryId、materielCategoryId、type、subtype逐条核对；超时先回查，不盲目重发。' }], completion: '返回true并在列表回查中确认创建结果。', idempotency: '没有requestId；重复配置由后端拒绝，超时先回查。' }))
add('inventory-valuation-prepare-update', base({ purpose: '按Portal编辑表单规则校验并准备修改草稿。', effect: 'prepare', inputs: updateInputs, output: { shape: '{ draft: object }', fields: [field('draft', 'object', '尚未提交的更新payload'), field('draft.id', 'string | number', '配置ID', { constraints: idRules }), field('draft.factoryId', 'string | number', '详情中的工厂ID', { constraints: idRules }), field('draft.materielCategoryId', 'string | number', '详情中的分类ID', { constraints: idRules }), field('draft.pricingMethod', 'integer', '新的计价方式', { constraints: pricingRules }), field('draft.type', 'string', '从moveType拆出的类型'), field('draft.subtype', 'integer', '从moveType拆出的数字子类型'), field('draft.price', 'number | null', '单价；4时必填', { nullable: true, nullMeaning: '非4或未配置', unit: '元' })], empty: '缺ID、固定字段、moveType、计价方式或4缺单价会抛错；取消不发PUT。' }, consume: ['用户确认后把result.draft交给update；取消只丢弃draft。'], steps: [{ role: 'required', when: '用户确认修改', capabilityId: 'inventory-valuation-update', mapping: { draft: 'result.draft' }, instruction: '提交同一draft；成功或超时后调用get和list核对。' }, { role: 'cancel', when: '用户取消', instruction: '丢弃draft，不调用update。' }], completion: '得到Portal更新接口会接受的单对象草稿。', idempotency: null }))
add('inventory-valuation-update', base({ purpose: '提交Portal修改计价方式。', effect: 'write', inputs: updateDraftInputs, output: trueOutput, consume: ['返回true后调用get回查type、subtype、pricingMethod、price；同时按列表核对updateTime。'], steps: [{ role: 'required', when: '请求返回true或超时', capabilityId: 'inventory-valuation-get', mapping: { id: 'args.draft.id' }, instruction: '读取详情确认更新后的字段；超时先回查，不盲目覆盖重试。' }], completion: '返回true且详情回查确认新值。', idempotency: '没有requestId；后端可能因当月单据或未定价单据拒绝，超时必须回查。' }))
add('inventory-valuation-prepare-remove', base({ purpose: '准备删除计价配置并校验ID。', effect: 'prepare', inputs: idDraftInputs, output: { shape: '{ draft: { id: string | number } }', fields: [field('draft', 'object', '尚未提交的删除草稿'), field('draft.id', 'string | number', '配置ID', { constraints: idRules })], empty: 'ID非法会抛错；Portal无前端状态门禁，后端仍可能因当月单据或未定价单据拒绝；取消不发DELETE。' }, consume: ['确认后把result.draft交给remove；取消只丢弃draft。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'inventory-valuation-remove', mapping: { draft: 'result.draft' }, instruction: '提交删除并回查列表中目标ID消失。' }, { role: 'cancel', when: '用户取消', instruction: '丢弃draft，不调用remove。' }], completion: '得到合法删除ID草稿。', idempotency: null }))
add('inventory-valuation-remove', base({ purpose: '删除一条计价配置。', effect: 'write', inputs: { draft: param('prepareRemove返回的draft。', 'inventory-valuation-prepare-remove.result.draft', { type: 'object', required: true }) }, output: trueOutput, consume: ['返回true后调用list确认目标ID不再出现；后端业务拒绝必须作为失败处理。'], steps: [{ role: 'required', when: '请求返回true或超时', capabilityId: 'inventory-valuation-list', mapping: {}, instruction: '按删除前ID回查；超时先回查，不盲目重删。' }], completion: '返回true且列表回查确认删除。', idempotency: '没有requestId；重复删除可能得到不存在错误，超时先回查。' }))
add('inventory-valuation-change-logs', base({ purpose: '读取变动详情页的计价方式变更记录。', effect: 'read', inputs: { factoryId: param('工厂ID。', '详情页bridge.factoryId', { type: 'string | number', required: true, constraints: idRules }), materielId: param('Portal详情页实际传入路由计价配置ID，虽然请求参数名为materielId。', '详情页route.params.id', { type: 'string | number', required: true, constraints: idRules }), pageSize: param('每页条数，默认500；对齐loopFetch。', 'Portal loopFetch固定值', { type: 'integer', required: false, default: '500' }), maxPages: param('最多读取页数，默认100。', 'Portal loopFetch固定值', { type: 'integer', required: false, default: '100' }) }, output: changeLogOutput, consume: ['展示oldPricingMethod、newPricingMethod、createTime、creatorName；需要解释标签时查计价方式字典。'], steps: [], completion: '得到最多100页的变更记录数组。', idempotency: null }))
add('inventory-valuation-price-history-list', base({ purpose: '读取列表价格单元打开的出入库单价历史分页。', effect: 'read', inputs: { factoryId: param('工厂ID。', '列表行bridge.factoryId', { type: 'string | number', required: true, constraints: idRules }), materielId: param('物料ID。', '列表行bridge.materielId', { type: 'string | number', required: true, constraints: idRules }), pageNo: param('页码，从1开始，默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }), pageSize: param('每页条数，页面支持10、20、50、100，默认20。', 'Portal分页状态', { type: 'integer', required: false, default: '20' }) }, output: priceHistoryOutput, consume: ['按year-month展示；inAvgPrice/outAvgPrice为空时保持空，不改成0。'], steps: [], completion: '得到指定工厂和物料的月度单价历史分页。', idempotency: null }))

export const INVENTORY_VALUATION_AI_CONTRACTS = contracts
export const INVENTORY_VALUATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INVENTORY_VALUATION_METHODS).map(([id, method]) => [`inventoryValuation.${method}`, contracts[id]!]))
