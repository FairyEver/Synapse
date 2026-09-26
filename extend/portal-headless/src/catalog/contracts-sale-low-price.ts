import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_LOW_PRICE_METHODS } from '../capabilities/sale-low-price.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pagePath = '/dashboard/sale/setting/price-control/low-price/list'
const pagePermission = '/dashboard/sale/setting/price-control/low-price'
const createPermission = 'setting:price-control:low-price:create'
const editPermission = 'setting:price-control:low-price:edit'
const deletePermission = 'setting:price-control:low-price:delete'

const configFields: AiField[] = [
  field('list[].id', 'string | number', '低价管控标准配置ID；详情、编辑和删除都使用它。'),
  field('list[].parentCategoryId', 'integer | null', '一级品类ID；提交时必须和categoryId一起来自当前品类候选。', { nullable: true }),
  field('list[].parentCategoryName', 'string | null', '一级品类名称；只读展示。', { nullable: true }),
  field('list[].categoryId', 'integer | null', '二级管控品类ID；列表筛选使用它。', { nullable: true }),
  field('list[].categoryName', 'string | null', '二级管控品类名称；只读展示。', { nullable: true }),
  field('list[].categoryFullName', 'string | null', '一级>>二级品类展示文本。', { nullable: true }),
  field('list[].skuSpecsText', 'string | null', '列表拼接展示的规格文本；不能反向当作skuId。', { nullable: true }),
  field('list[].skus', 'object[]', '当前配置的商品规格；编辑提交时从当前可选规格重建。'),
  field('list[].skus[].id', 'string | number | null', 'SKU关联明细ID；仅回显，提交时由Portal当前页不发送。', { optional: true, nullable: true }),
  field('list[].skus[].itemId', 'integer', '商品ID；提交sku明细必填。'),
  field('list[].skus[].skuId', 'integer', '商品规格ID；提交sku明细必填且同一配置不能重复。'),
  field('list[].skus[].itemName', 'string | null', '商品名称回显。', { nullable: true }),
  field('list[].skus[].specInfo', 'string | null', '规格名称回显。', { nullable: true }),
  field('list[].rules', 'object[]', '低价管控规则列表，按标准1、标准2顺序展示。'),
  field('list[].rules[].id', 'string | number | null', '已有规则ID；编辑时保留以便Java按ID更新，新增规则不传。', { optional: true, nullable: true }),
  field('list[].rules[].sortNo', 'integer | null', '后端保存的标准序号；Portal提交时删除，由后端按数组顺序补齐。', { nullable: true }),
  field('list[].rules[].qtyLowerOp', 'string | null', '管控数量下限运算符。', { nullable: true, values: { '>': '大于', '>=': '大于等于', '=': '等于', '<': '小于', '<=': '小于等于' } }),
  field('list[].rules[].qtyLowerValue', 'number | null', '管控数量下限值，非负；与下限运算符成对。', { nullable: true }),
  field('list[].rules[].qtyUpperOp', 'string | null', '管控数量上限运算符。', { nullable: true, values: { '<': '小于', '<=': '小于等于' } }),
  field('list[].rules[].qtyUpperValue', 'number | null', '管控数量上限值，非负；与上限运算符成对。', { nullable: true }),
  field('list[].rules[].priceLowerOp', 'string | null', '低于指导价下限运算符；Portal输入项支持>、>=、=。', { nullable: true, values: { '>': '大于', '>=': '大于等于', '=': '等于' } }),
  field('list[].rules[].priceLowerValue', 'number | null', '低于指导价下限值，非负且最多2位小数。', { nullable: true, unit: '元' }),
  field('list[].rules[].priceUpperOp', 'string | null', '低于指导价上限运算符；Portal输入项支持<、<=。', { nullable: true, values: { '<': '小于', '<=': '小于等于' } }),
  field('list[].rules[].priceUpperValue', 'number | null', '低于指导价上限值，非负且最多2位小数。', { nullable: true, unit: '元' }),
  field('list[].rules[].approvalTag', 'string | null', '审批标识字典值；原样提交给后端流程规则。', { nullable: true }),
  field('list[].updaterId', 'string | number | null', '最后操作人ID；只读。', { nullable: true }),
  field('list[].updaterName', 'string | null', '最后操作人姓名；只读。', { nullable: true }),
  field('list[].updateTime', 'string | null', '最后更新时间原值。', { nullable: true }),
  field('list[].createTime', 'string | null', '创建时间原值。', { nullable: true }),
]

const categoryOptionFields: AiField[] = [
  field('[]', 'object', '已有配置汇总出的品类筛选项。'),
  field('[].parentCategoryId', 'integer | null', '一级品类ID。', { nullable: true }),
  field('[].parentCategoryName', 'string | null', '一级品类名称。', { nullable: true }),
  field('[].categoryId', 'integer', '二级品类ID；填入list.categoryId。'),
  field('[].categoryName', 'string', '二级品类名称。'),
  field('[].categoryFullName', 'string | null', '一级>>二级品类展示文本。', { nullable: true }),
]

const categoryNodeFields: AiField[] = [
  field('[]', 'object', '新增/编辑表单的二级品类候选。'),
  field('[].parentCategoryId', 'integer | null', '一级品类ID；提交parentCategoryId使用它。', { nullable: true }),
  field('[].categoryId', 'integer', '二级品类ID；提交categoryId使用它。'),
  field('[].categoryName', 'string', '二级品类名称。'),
  field('[].disabled', 'boolean', 'true表示该品类下所有可见SKU已被其它配置占用，Portal置灰不可选。'),
]

const skuFields: AiField[] = [
  field('[]', 'object', '当前二级品类下的商品规格候选。'),
  field('[].nodeType', 'string | null', '后端节点类型；Portal提交时不使用。', { optional: true, nullable: true }),
  field('[].parentCategoryId', 'integer | null', '一级品类ID。', { nullable: true }),
  field('[].categoryId', 'integer', '二级品类ID。'),
  field('[].itemId', 'integer', '商品ID；提交skus[].itemId。'),
  field('[].itemName', 'string | null', '商品名称；提交skus[].itemName。', { nullable: true }),
  field('[].skuId', 'integer', '规格ID；提交skus[].skuId。'),
  field('[].specInfo', 'string | null', '规格名称；提交skus[].specInfo。', { nullable: true }),
  field('[].disabled', 'boolean', 'true表示SKU已被其它配置占用，不能选择。'),
]

const configDetailFields = configFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\.?(?=.)/, '') }))
const draftFields: AiField[] = [
  field('draft', 'object', 'prepareCreate或prepareUpdate返回的最终业务请求草稿。'),
  field('draft.id', 'string | number', '编辑配置ID；新增草稿不包含。', { optional: true }),
  field('draft.parentCategoryId', 'integer', '一级品类ID。'),
  field('draft.categoryId', 'integer', '二级管控品类ID。'),
  field('draft.skus', 'object[]', '实际请求的商品规格数组；至少一项且skuId不能重复。'),
  field('draft.skus[].id', 'string | number', '编辑时已有SKU明细ID如被传入的原值；当前Portal页面不从选项中带回，通常不存在。', { optional: true }),
  field('draft.skus[].itemId', 'integer', '商品ID。'),
  field('draft.skus[].skuId', 'integer', '商品规格ID。'),
  field('draft.skus[].itemName', 'string | null', '商品名称；来自当前sku候选。', { nullable: true }),
  field('draft.skus[].specInfo', 'string | null', '规格名称；来自当前sku候选。', { nullable: true }),
  field('draft.rules', 'object[]', '实际请求的标准规则数组；Portal不提交uid和sortNo。'),
  field('draft.rules[].id', 'string | number', '编辑时已有规则ID；用于Java按ID同步更新，新增规则不传。', { optional: true }),
  field('draft.rules[].qtyLowerOp', 'string | null', '数量下限运算符；与qtyLowerValue成对，Portal下限支持>、>=、=。', { nullable: true }),
  field('draft.rules[].qtyLowerValue', 'number | null', '数量下限值，非负。', { nullable: true }),
  field('draft.rules[].qtyUpperOp', 'string | null', '数量上限运算符；与qtyUpperValue成对，Portal上限支持<、<=。', { nullable: true }),
  field('draft.rules[].qtyUpperValue', 'number | null', '数量上限值，非负。', { nullable: true }),
  field('draft.rules[].priceLowerOp', 'string | null', '低于指导价下限运算符；Portal下限支持>、>=、=。', { nullable: true }),
  field('draft.rules[].priceLowerValue', 'number | null', '低于指导价下限值，非负且最多2位小数。', { nullable: true, unit: '元' }),
  field('draft.rules[].priceUpperOp', 'string | null', '低于指导价上限运算符；Portal上限支持<、<=。', { nullable: true }),
  field('draft.rules[].priceUpperValue', 'number | null', '低于指导价上限值，非负且最多2位小数。', { nullable: true, unit: '元' }),
  field('draft.rules[].approvalTag', 'string | null', '审批标识字典值。', { nullable: true }),
]

const pageOutput = (name: string): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', `${name}分页结果。`), field('list', 'object[]', '当前页数据，不是全量结果。'), field('total', 'number', '符合筛选条件的总数。'), ...configFields],
  empty: 'list=[]表示当前页没有记录；total=0才表示筛选无匹配，权限、租户或网络错误会抛错。',
})

const trueOutput: AiContract['output'] = {
  shape: 'boolean',
  fields: [field('$', 'boolean', '后端业务成功回执；SDK只接受true。', { values: { true: '后端接受请求' } })],
  empty: '返回false、缺失或其它值时抛错；true不等于已完成独立回查。',
}

const idOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', '新建配置ID；用于详情/列表回查。')],
  empty: '返回ID非法或后端失败时抛错。',
}

const draftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: draftFields,
  empty: '表单、品类、SKU或规则不符合Portal/Java校验时抛错且不发送写请求。',
}

const removeOutput: AiContract['output'] = {
  shape: '{ id: string | number }',
  fields: [field('id', 'string | number', '待用户确认删除的配置ID。')],
  empty: 'ID非法时准备阶段抛错，不发送DELETE。',
}

const listInput = {
  pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
  pageSize: param('每页条数。', 'Portal分页控件；SDK默认20，支持10/20/50/100。', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['仅接受10、20、50或100。'] }),
  categoryId: param('二级管控品类ID。', 'sale-low-price-category-options.result[].categoryId或用户选择', { type: 'integer | null', required: false, nullable: true }),
  updateTimeRange: param('更新时间日期范围；SDK按Portal拆成updateTimeStart/updateTimeEnd。', '用户在更新时间RangePicker中的选择', { type: '[string, string] | [] | null', required: false, nullable: true, format: 'YYYY-MM-DD' }),
  operatorKeyword: param('操作人姓名或用户名关键字。', '用户输入', { type: 'string | null', required: false, nullable: true }),
}

const formInput = param('Portal低价设置新增/编辑表单。', '用户输入、sale-low-price-sku-tree-categories和sale-low-price-sku-tree-skus返回的当前可选数据', {
  type: 'object',
  required: true,
  constraints: [
    `页面入口受${pagePermission}控制；新增还需要${createPermission}，编辑还需要${editPermission}。`,
    'parentCategoryId、categoryId/controlCategoryId、skus、standards必填；skus至少一项且skuId不能重复。',
    '每个数量和价格条件必须运算符+数值成对；低于指导价至少完整填写下限或上限一侧；数值非负，价格最多2位小数。',
    'Portal下限选=时会清空对应上限；SDK也会清空并发送null；规则范围下限不能大于上限。',
  ],
})
const draftInput = param('prepareCreate或prepareUpdate返回的最终草稿。', 'sale-low-price-prepare-create.result.draft或sale-low-price-prepare-update.result.draft', { type: 'object', required: true, constraints: ['确认后原样交给对应create/update；不要补回uid或sortNo。'] })
const idInput = param('当前列表/详情明确选定的低价管控标准配置ID。', 'sale-low-price-list.list[].id或sale-low-price-get.result.id', { type: 'string | number', required: true })
const gaps = ['尚未在真实测试环境逐项执行本页列表、候选加载、详情、新增、编辑、删除及写入后的独立回查；当前证据来自Portal源码、销售Java源码和离线请求断言。']

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖“系统设置→销售设置→价格管控→低价设置”页面${pagePath}及其可达的priceControlStandardConfig接口；不覆盖独立生产根菜单。`,
      `页面入口受${pagePermission}控制；新增、编辑、删除分别受${createPermission}、${editPermission}、${deletePermission}控制；候选、详情和列表跟随页面权限与服务端授权。`,
      '所有请求绑定Portal platform实例并使用销售页面module-type=60；源码中的相对URL保持不变。',
      '规则提交遵循Portal前端字段构造和Java PriceControlStandardConfigSaveReqVO/Service校验；uid是前端本地行键，sortNo由后端按数组顺序补齐，二者都不进入实际草稿。',
    ],
    effect,
    prerequisites: ['SDK已绑定当前用户、租户、会话token和platform base URL；品类、商品和规格均来自当前用户可见候选。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示后端true/ID回执通过校验；成功或超时后必须按配置ID刷新列表或详情。' : effect === 'prepare' ? '得到无副作用的确认草稿；取消只丢弃草稿。' : '返回通过结构校验的当前页面数据。',
    failures: ['非法分页、ID、日期、候选、规则、SKU占用或响应形状在请求前/响应后失败；权限、租户、网络和后端业务错误原样抛出。', 'SDK不把页面成功提示或true回执当作写入后的独立证据。'],
    idempotency: effect === 'write' ? '后端没有requestId；create/update/delete超时先按同一配置ID回查，再决定是否重试。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:191-194、app/portal/views/dashboard/sale/setting/price-control/low-price/list.vue、low-price/[mode]/[id].vue', kind: 'reference', note: '证明菜单归属、按钮权限、列表筛选、候选请求、详情加载、表单校验和提交字段。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-sales/.../pricecontrolstandardconfig/PriceControlStandardConfigController.java、PriceControlStandardConfigSaveReqVO.java、PriceControlStandardConfigRuleVO.java、PriceControlStandardConfigServiceImpl.java', kind: 'reference', note: '证明接口、权限、请求字段、SKU占用、条件成对和规则范围重叠校验。' },
      { source: 'src/capabilities/sale-low-price.ts 与 test/sale-low-price.test.ts', kind: 'test', note: '锁定请求方法/URL/参数、表单净载荷、权限条件和坏输入；不替代真实环境验证。' },
      { source: 'docs/pages/低价设置.md', kind: 'reference', note: '记录本页能力定义、参数契约、逐字段基准、操作步骤和实测缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-low-price-category-options': {
    ...base('查询低价设置列表的已有管控品类筛选项。', { shape: 'object[]', fields: categoryOptionFields, empty: '没有已有配置时返回[]。' }, ['把categoryId用于list筛选；不要把categoryFullName当成ID。']),
  },
  'sale-low-price-list': {
    ...base('按品类、更新时间和操作人关键字查询低价管控标准列表。', pageOutput('低价管控标准'), ['保留list[].id和完整rules/skus；编辑前重新读取候选，删除前向用户展示同一配置ID。']),
    inputs: listInput,
  },
  'sale-low-price-sku-tree-categories': {
    ...base('查询新增/编辑低价标准可选的二级品类。', { shape: 'object[]', fields: categoryNodeFields, empty: '没有可见品类时返回[]；disabled=true的品类不能选择。' }, ['只选择disabled=false的categoryId，并把同一节点parentCategoryId带入表单。']),
    inputs: { excludeConfigId: param('编辑时排除当前配置的ID；新增时不传。', 'sale-low-price-list.list[].id或sale-low-price-get.result.id', { type: 'string | number', required: false, nullable: true }) },
  },
  'sale-low-price-sku-tree-skus': {
    ...base('按二级品类查询新增/编辑低价标准可选的商品规格。', { shape: 'object[]', fields: skuFields, empty: '该品类没有可见规格时返回[]；disabled=true的SKU不能选择。' }, ['只选择disabled=false的规格；把选中的完整候选对象组成prepareCreate/prepareUpdate.form.skus。']),
    inputs: {
      categoryId: param('二级品类ID。', 'sale-low-price-sku-tree-categories.result[].categoryId', { type: 'integer', required: true }),
      excludeConfigId: param('编辑时排除当前配置的ID；新增时不传。', 'sale-low-price-list.list[].id或sale-low-price-get.result.id', { type: 'string | number', required: false, nullable: true }),
    },
  },
  'sale-low-price-get': {
    ...base('查询一条低价管控标准配置详情。', { shape: 'object', fields: configDetailFields, empty: '配置不存在或响应不合法时抛错，不伪造空详情。' }, ['详情用于展示和编辑回填；编辑提交时保留已有rules[].id以便后端同步规则。']),
    inputs: { id: idInput },
  },
  'sale-low-price-prepare-create': {
    ...base('按Portal低价设置新增页和Java请求VO准备新增草稿，不发送POST。', draftOutput, ['先读取品类与规格候选；只选择未置灰品类和SKU；向用户展示规则与范围并取得明确确认。', '确认后把同一draft交给create；取消只丢弃draft。'], 'prepare'),
    inputs: { form: formInput },
    steps: [
      { role: 'required', when: '需要选择管控品类', capabilityId: 'sale-low-price-sku-tree-categories', mapping: {}, instruction: '只从disabled=false的节点选择categoryId和parentCategoryId。' },
      { role: 'required', when: '需要选择管控商品', capabilityId: 'sale-low-price-sku-tree-skus', mapping: { categoryId: 'user.form.categoryId' }, instruction: '只把disabled=false的完整SKU候选放入form.skus。' },
      { role: 'required', when: '用户明确确认新增', capabilityId: 'sale-low-price-create', mapping: { draft: 'result.draft' }, instruction: '提交同一份draft；后端会再次校验SKU占用和规则范围。' },
      { role: 'cancel', when: '用户取消新增', instruction: '只丢弃draft，不调用create。' },
    ],
  },
  'sale-low-price-create': {
    ...base('新增一条用户确认的低价管控标准配置。', idOutput, ['返回配置ID后调用get或list逐字段回查；true/ID回执不等于候选占用和列表刷新已经可见。'], 'write'),
    inputs: { draft: draftInput },
    steps: [{ role: 'recovery', when: '新增成功、超时或响应丢失后核实', capabilityId: 'sale-low-price-get', mapping: { id: 'result.$' }, instruction: '读取同一配置ID，核对品类、SKU和每条规则；无法定位时不要盲目重复新增。' }],
  },
  'sale-low-price-prepare-update': {
    ...base('按Portal低价设置编辑页和Java请求VO准备编辑草稿，不发送PUT。', draftOutput, ['先用get取得当前配置，再按当前excludeConfigId读取候选；向用户展示变更前后规则和SKU并取得明确确认。', '确认后把同一draft交给update；取消只丢弃draft。'], 'prepare'),
    inputs: { form: formInput },
    steps: [
      { role: 'required', when: '开始编辑已有配置', capabilityId: 'sale-low-price-get', mapping: { id: 'user.form.id' }, instruction: '以当前详情为基线，保留需要继续编辑的rules[].id。' },
      { role: 'required', when: '需要重建候选', capabilityId: 'sale-low-price-sku-tree-categories', mapping: { excludeConfigId: 'user.form.id' }, instruction: '编辑时排除自身配置，避免自身SKU被置灰。' },
      { role: 'required', when: '用户明确确认编辑', capabilityId: 'sale-low-price-update', mapping: { draft: 'result.draft' }, instruction: '提交同一份draft；后端按已有规则ID更新、无ID规则新增并删除被移除规则。' },
      { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用update。' },
    ],
  },
  'sale-low-price-update': {
    ...base('编辑一条用户确认的低价管控标准配置。', trueOutput, ['返回true后调用get或list逐字段回查；编辑可能因SKU已被占用、规则重叠或配置不存在而失败。'], 'write'),
    inputs: { draft: draftInput },
    steps: [{ role: 'recovery', when: '编辑成功、超时或响应丢失后核实', capabilityId: 'sale-low-price-get', mapping: {}, instruction: '使用提交草稿中的同一配置ID读取详情，核对SKU和规则终态；超时先回查，不盲目重发。' }],
  },
  'sale-low-price-prepare-remove': {
    ...base('准备删除一条低价管控标准配置，不发送DELETE。', removeOutput, [`仅当用户拥有${deletePermission}且确认目标配置后准备；Java删除前还会检查订单引用的低价规则和最新审批状态。`], 'prepare'),
    inputs: { id: idInput },
    steps: [{ role: 'required', when: '用户明确确认删除', capabilityId: 'sale-low-price-remove', mapping: { id: 'result.id' }, instruction: '提交同一配置ID；后端仍可能因订单引用阻断。' }, { role: 'cancel', when: '用户取消删除', instruction: '只丢弃id，不发送请求。' }],
  },
  'sale-low-price-remove': {
    ...base('删除一条用户确认的低价管控标准配置。', trueOutput, ['返回true后刷新list确认目标ID消失；如果Java检测到未通过低价审批的订单引用，后端会拒绝删除。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: '删除成功、超时或响应丢失后核实', capabilityId: 'sale-low-price-list', mapping: {}, instruction: '刷新列表确认同一配置ID不再出现；超时先回查，不盲目重删。' }],
  },
}

export const SALE_LOW_PRICE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_LOW_PRICE_METHODS).map(id => [id, contracts[id]!]))
export const SALE_LOW_PRICE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_LOW_PRICE_METHODS).map(([id, method]) => [`saleLowPrice.${method}`, SALE_LOW_PRICE_AI_CONTRACTS[id]!]))
