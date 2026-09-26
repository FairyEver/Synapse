import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_CUSTOM_QR_METHODS } from '../capabilities/sale-custom-qr.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const pagePath = '/dashboard/sale/custom/qr/list'
const pagePermission = '/dashboard/sale/frame/custom/qr'

const supplierFields: AiField[] = [
  field('list[].tenantId', 'string | null', '供应商对应的CRM组织ID；页面不展示，但可作为供应商组织来源标识', { nullable: true, nullMeaning: 'CRM未返回组织ID；不能用店铺名称代替' }),
  field('list[].tenantName', 'string | null', '供应商名称；进入店铺后的页面标题使用该值', { nullable: true }),
  field('list[].shopId', 'integer', '店铺ID；进入商品分类页面和字段页面时的上下文ID，不能用tenantId或店铺名称代替', { source: 'CRM ShopSumDTO.shopId' }),
  field('list[].shopName', 'string | null', '店铺名称；页面列表展示及下一级页面标题使用', { nullable: true }),
  field('list[].itemKindNum', 'integer | null', '该店铺已配置的商品分类数量；页面展示为品类数量，不是字段总数', { nullable: true, nullMeaning: '该店铺没有汇总值或CRM未返回；不能当作0以外的状态' }),
  field('list[].updateTime', 'string | null', '该店铺配置汇总的更新时间原值；页面按原值展示', { nullable: true, nullMeaning: '尚无配置更新时间' }),
]

const supplierListOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', 'CRM供应商店铺分页结果；接口count已映射为total'),
    field('list', 'object[]', '当前页供应商店铺记录；不是全量结果'),
    field('total', 'integer', '符合供应商名称筛选的记录总数，用于分页，不是当前页长度'),
    ...supplierFields,
  ],
  empty: 'list=[]且total=0表示当前筛选无供应商店铺；权限、租户、网络或响应形状错误会抛出，不伪造成空列表。',
}

const itemKindFields: AiField[] = [
  field('[].itemKind', 'string', '商品分类字典值；进入字段列表时作为itemKind参数，不能用itemKindName代替'),
  field('[].itemKindName', 'string', '商品分类名称；页面显示的“平台-商品分类”文本'),
  field('[].num', 'integer', '该店铺和商品分类已配置的引种证明字段数量；没有配置时Java返回0'),
  field('[].updateTime', 'string | null', '该店铺和商品分类配置的最后更新时间原值', { nullable: true, nullMeaning: '该分类没有字段配置或没有更新时间' }),
]

const itemKindListOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'object[]', '当前店铺可见的商品分类配置汇总数组'), ...itemKindFields],
  empty: '[]表示CRM没有返回当前用户/店铺可见的商品分类；权限或响应形状错误会抛出。',
}

const fieldFields: AiField[] = [
  field('[].id', 'string | number', '二维码字段配置记录ID；编辑和删除使用，来自当前字段列表行', { source: 'ConfigCodeOrderDTO.id' }),
  field('[].shopId', 'integer', '字段所属店铺ID；与当前进入页面的shopId对应'),
  field('[].itemKind', 'string', '字段所属商品分类字典值；与当前进入页面的itemKind对应'),
  field('[].field', 'string', 'order_field字典值；新增/编辑保存时提交，编辑页控件不可修改'),
  field('[].fieldName', 'string | null', 'order_field字典label；字段名称列展示', { nullable: true, nullMeaning: '字典中没有该field值的label' }),
  field('[].fieldType', 'string | null', 'order_field字典remarks原值；order表示订单信息，item表示商品信息', { nullable: true, values: { order: '订单信息', item: '商品信息' }, nullMeaning: 'Java没有找到该字段的字典remarks' }),
  field('[].fieldTypeName', 'string | null', '页面展示的字段类型名称；由remarks映射order→订单信息、item→商品信息，未知值显示空白', { nullable: true, values: { 订单信息: 'remarks=order', 商品信息: 'remarks=item' }, nullMeaning: 'Java映射结果为空，页面不展示类型名称' }),
  field('[].sort', 'integer', '字段显示顺序；页面表格按该值展示，新增/编辑必须为正整数且不能与当前列表其他行重复'),
]

const fieldListOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'object[]', '按sort升序的当前店铺/商品分类字段配置数组'), ...fieldFields],
  empty: '[]表示当前shopId+itemKind尚未配置字段；请求参数缺失、权限、网络或响应形状错误会抛出。',
}

const orderFieldOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('$', 'object[]', 'order_field字典候选数组；只返回Portal弹窗实际消费的候选字段'),
    field('[].value', 'string', '新增字段时提交的field字典值'),
    field('[].label', 'string', '新增字段下拉展示名称'),
    field('[].remarks', 'string | null', 'CRM字典备注类型原值；由后端提供，不能用label推断', { nullable: true, values: { order: '订单信息', item: '商品信息' }, nullMeaning: '字典项没有备注类型' }),
    field('[].fieldTypeName', 'string', 'SDK按Portal ModalFormContent映射的显示类型名称；remarks=order为订单信息、remarks=item为商品信息、其它值为空字符串'),
  ],
  empty: '[]表示当前CRM没有order_field候选；不能自行猜测field值或类型。',
}

const draftFields: AiField[] = [
  field('draft.shopId', 'integer', '要保存的店铺ID；来自供应商列表行'),
  field('draft.itemKind', 'string', '要保存的商品分类字典值；来自商品分类列表行'),
  field('draft.field', 'string', '要保存的order_field字典值；创建来自候选，编辑保留当前行原值'),
  field('draft.sort', 'integer', '要保存的正整数显示顺序；已按usedSort做本地冲突校验'),
  field('draft.id', 'string | number | null', '配置记录ID；创建按Portal表单初始值发送null，编辑发送当前行ID', { nullable: true, nullMeaning: '创建草稿没有既有记录ID' }),
]

const updateDraftFields: AiField[] = [
  ...draftFields,
  field('draft.currentField', 'string', '编辑本地锁中的当前行原始field；用于阻止绕过Portal禁用控件修改字段，不发送给CRM'),
]

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'CRM保存或删除成功回执没有业务数据；不能把成功文案当成新ID或最终业务状态')],
  empty: 'Promise完成只代表CRM请求成功；写操作必须按同一店铺和商品分类重新查询核实。',
}

const prepareOutput = (fields: AiField[]): AiContract['output'] => ({
  shape: '{ draft: object }',
  fields: [field('$', 'object', '本地准备结果；不发业务请求'), ...fields],
  empty: '表单、ID、排序或字段锁校验失败时在请求前抛错；准备成功不等于CRM已写入。',
})

const formInputs: Record<string, AiParameter> = {
  form: param('Portal字段弹窗的表单对象。', '用户输入；编辑时来自当前字段列表行并只允许修改sort', { type: 'object', required: true }),
  'form.shopId': param('字段所属店铺ID。', 'sale-custom-qr-supplier-list.list[].shopId', { type: 'integer', required: true, constraints: ['必须来自当前供应商列表行；不能用tenantId或店铺名称代替。'] }),
  'form.itemKind': param('字段所属商品分类字典值。', 'sale-custom-qr-item-kind-list[].itemKind', { type: 'string', required: true }),
  'form.field': param('引种证明字段字典值。', 'sale-custom-qr-order-field-list[].value；编辑时来自当前字段列表行且不可修改', { type: 'string', required: true }),
  'form.sort': param('字段显示顺序。', '用户输入；Portal新建省略时由usedSort计算最大值+1，空列表为1', { type: 'integer', required: false, constraints: ['必须是正整数；不能出现在当前usedSort中。'] }),
  'form.id': param('编辑时的字段配置记录ID。', 'sale-custom-qr-field-list[].id', { type: 'string | number', required: false, nullable: true, nullMeaning: '创建表单为null；编辑必须使用当前行ID' }),
  usedSort: param('当前字段列表已占用的排序集合。', 'sale-custom-qr-field-list[].sort；编辑时先排除当前行sort', { type: 'integer[]', required: false, omitted: '省略表示当前没有已占用排序；新建默认sort=1' }),
}

const updateFormInputs: Record<string, AiParameter> = {
  ...formInputs,
  'form.id': param('待编辑的字段配置记录ID。', 'sale-custom-qr-field-list[].id', { type: 'string | number', required: true, constraints: ['必须来自当前字段列表行，不能替换为field或itemKind。'] }),
  'form.sort': param('编辑后的字段显示顺序。', '用户明确修改；Portal输入控件最小值为1', { type: 'integer', required: true, constraints: ['必须是正整数；不能出现在Portal传入的、已排除当前行的usedSort中。'] }),
  currentField: param('当前列表行原始field，用于锁定编辑时不可修改的字段。', 'sale-custom-qr-field-list[].field', { type: 'string', required: true, constraints: ['必须与form.field完全相同；不一致时SDK在发请求前拒绝。'] }),
}

const draftInputs: Record<string, AiParameter> = {
  draft: param('prepareCreate返回的新建草稿。', 'sale-custom-qr-prepare-create.draft', { type: 'object', required: true }),
  'draft.shopId': param('草稿店铺ID。', 'prepare结果中的form.shopId', { type: 'integer', required: true }),
  'draft.itemKind': param('草稿商品分类字典值。', 'prepare结果中的form.itemKind', { type: 'string', required: true }),
  'draft.field': param('草稿order_field字典值。', 'prepare结果中的form.field', { type: 'string', required: true }),
  'draft.sort': param('草稿正整数显示顺序。', 'prepare结果中的form.sort', { type: 'integer', required: true }),
  'draft.id': param('草稿记录ID。', 'prepare结果；创建为null、编辑为当前列表行ID', { type: 'string | number', required: false, nullable: true, nullMeaning: '创建请求按Portal初始表单发送null' }),
}

const updateDraftInputs: Record<string, AiParameter> = {
  ...draftInputs,
  draft: param('prepareUpdate返回的编辑草稿。', 'sale-custom-qr-prepare-update.draft', { type: 'object', required: true }),
  'draft.id': param('草稿中的字段配置ID。', 'sale-custom-qr-field-list[].id', { type: 'string | number', required: true }),
  'draft.currentField': param('编辑草稿中的字段锁值。', 'sale-custom-qr-prepare-update.currentField', { type: 'string', required: true, constraints: ['必须与draft.field相同；该字段只作本地防篡改校验，不会放入HTTP body。'] }),
}

const idInput = param('当前字段配置记录ID。', 'sale-custom-qr-field-list[].id；由用户选择一行得到', { type: 'string | number', required: true, constraints: ['必须是当前列表行ID；不能用店铺ID、商品分类值或字段字典值代替。'] })

const gaps = [
  '尚未在真实测试环境执行供应商分页、店铺下钻、商品分类、order_field候选、新建、编辑、删除及写后回查；当前证据来自Portal test/portal/main源码、Java test/test源码和离线请求/契约测试。',
  'Portal与CRM旧接口没有通用cancel HTTP端点；页面取消只关闭弹窗并丢弃本地表单，SDK没有伪造cancel能力。',
]

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户系统设置/销售设置下的二维码管理页面${pagePath}，不扩展到其它二维码或订单配置页面。`,
      `页面入口受${pagePermission}控制；Portal子页面没有独立permissionCheck或另行声明的按钮权限，SDK不虚构动作权限码，最终授权由CRM后端裁决。`,
      '所有业务请求使用Portal crm.js实例（VITE_CRM_API），页面对应销售module-type=60；调用方必须配置crm base URL和会话租户上下文。',
      '页面是供应商→商品分类→字段的三层本地下钻；点击设置/返回只改变Vue视图状态，不是额外HTTP能力。',
      '保存请求只发送shopId、itemKind、field、sort、id五个字段；编辑页面field控件禁用，currentField仅是SDK本地锁，不会发送给CRM。',
    ],
    effect,
    prerequisites: ['使用当前用户、当前租户的CRM会话；shopId、itemKind、field和记录ID必须从当前页面结果或order_field候选取得。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只代表CRM请求已成功返回；必须按同一shopId+itemKind重新读取并逐字段核对，不能把空回执解释为最终生效。' : effect === 'prepare' ? '得到不产生外部副作用的本地草稿；用户取消时只丢弃草稿。' : '返回通过结构校验的当前页面数据或字典候选。',
    failures: ['非法ID、分页、表单、排序冲突、field锁冲突或响应形状错误在请求前失败；权限、租户、网络和Java业务错误原样抛出。', '保存或删除超时/响应丢失时结果不确定，先按店铺和商品分类回查再决定是否重试；不能盲目重复写入。'],
    idempotency: effect === 'write' ? 'CRM旧接口没有requestId幂等协议；保存重复可能触发字段重复或产生重复配置，删除超时也可能已完成，必须先回查。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:204；app/portal/views/dashboard/sale/custom/qr/list.vue、ViewSupplierList.vue、ViewQrList.vue、ViewKeyList.vue、ModalFormContent.vue、api/qr.js', kind: 'reference', note: '证明页面路径/权限、crm实例、三层下钻、分页筛选、字段禁用、排序冲突、字典候选和五字段表单编码保存请求。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-crm/.../ConfigCodeOrderController.java、ConfigCodeOrderService.java、ConfigCodeOrder.java、ConfigCodeOrderDTO.java、ConfigCodeOrderDao.xml、DictVueController.java、DictService.java', kind: 'reference', note: '证明CRM路由、租户/店铺回退、字段/排序持久化、重复字段错误、sort排序及order_field字典返回与remarks映射。' },
      { source: 'src/capabilities/sale-custom-qr.ts 与 test/sale-custom-qr.test.ts', kind: 'test', note: '锁定SDK请求方法/URL/参数/表单编码头、ID来源、页面元数据、输入校验、响应映射、字段锁和契约反证；不替代真实环境写入验证。' },
      { source: 'docs/pages/二维码管理.md', kind: 'reference', note: '记录三层页面基准、字段/排序/权限边界、写后回查和未执行的真实环境验证。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-custom-qr-supplier-list': {
    ...base('分页查询二维码管理的供应商店铺，按供应商名称筛选并取得进入下一层所需的shopId。', supplierListOutput, ['展示当前页tenantName、shopName、itemKindNum和updateTime；保留用户选择行的shopId、shopName和tenantName。', 'total只用于分页；不能把一页结果当成全量供应商。']),
    inputs: {
      tenantName: param('供应商名称模糊筛选片段。', '用户输入；Portal表单默认空字符串', { type: 'string', required: false, omitted: '空字符串表示不筛选' }),
      pageNo: param('供应商列表页码，从1开始。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('供应商列表每页记录数。', 'Portal styleV2分页状态', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100；请求字段保持pageSize，不改为limit。'] }),
    },
    steps: [{ role: 'required', when: '用户选择一行供应商/店铺并点击页面“设置”', capabilityId: 'sale-custom-qr-item-kind-list', mapping: { shopId: 'result.list[].shopId' }, instruction: '只选择一条当前页记录；将该行shopId作为下一层上下文，tenantName和shopName只用于展示标题。' }],
  },
  'sale-custom-qr-item-kind-list': {
    ...base('查询选定店铺可配置的全部商品分类及其引种证明字段数量。', itemKindListOutput, ['展示itemKindName和num；保留用户选择行的itemKind字典值。', 'num=0表示该分类目前没有配置字段，不代表分类不可用。']),
    inputs: { shopId: param('店铺ID。', 'sale-custom-qr-supplier-list.list[].shopId；管理员从供应商行取得，非管理员可省略或传null让Java按当前用户租户回退', { type: 'integer | null', required: false, nullable: true, omitted: '省略按Portal默认props.shopId=null发送；Java会尝试按当前用户租户取得首个关联店铺', nullMeaning: '不显式指定店铺，由CRM ConfigCodeOrderController按当前用户租户回退' }) },
    steps: [{ role: 'required', when: '用户选择一条商品分类并进入“设置引种证明”', capabilityId: 'sale-custom-qr-field-list', mapping: { shopId: 'args.shopId', itemKind: 'result.[].itemKind' }, instruction: '选择一条分类；shopId继续沿用当前店铺上下文，itemKind必须使用该行字典值而不是显示名称。' }],
  },
  'sale-custom-qr-field-list': {
    ...base('查询指定店铺和商品分类下已配置的引种证明显示字段。', fieldListOutput, ['按sort升序展示fieldName、fieldTypeName和sort；保留每行id用于编辑/删除，field用于编辑时的不可变值。', '需要新建字段时先读取order_field候选；需要编辑时只能修改sort。']),
    inputs: {
      shopId: param('店铺ID。', '当前供应商列表行.shopId；随页面下钻保留', { type: 'integer', required: true }),
      itemKind: param('商品分类字典值。', '当前商品分类列表行.itemKind', { type: 'string', required: true }),
    },
    steps: [
      { role: 'optional', when: '用户要新建字段', capabilityId: 'sale-custom-qr-order-field-list', mapping: {}, instruction: '先取得页面下拉候选，选择候选value作为form.field；不要根据label自行拼接field。' },
      { role: 'optional', when: '用户选择当前字段行编辑', capabilityId: 'sale-custom-qr-prepare-update', mapping: { form: 'user.selectedFieldRow', currentField: 'user.selectedFieldRow.field' }, instruction: 'selectedFieldRow必须是当前result中的完整行；field控件在Portal编辑弹窗中禁用，只提交sort变化。' },
      { role: 'optional', when: '用户确认删除当前字段行', capabilityId: 'sale-custom-qr-prepare-remove', mapping: { id: 'user.selectedFieldRow.id' }, instruction: 'selectedFieldRow必须是当前result中的一行；取得其id，不能用字段名称或数组下标删除。' },
    ],
  },
  'sale-custom-qr-order-field-list': {
    ...base('读取新建引种证明字段下拉框使用的order_field字典候选及其字段类型。', orderFieldOutput, ['用value作为保存请求field，用label展示名称。', '用remarks区分类型：order→订单信息、item→商品信息；未知remarks对应空fieldTypeName，不要猜测。']),
    inputs: {},
  },
  'sale-custom-qr-prepare-create': {
    ...base('按Portal新建字段弹窗规则整理字段草稿并执行排序冲突校验，不发送保存请求。', prepareOutput(draftFields), ['field必须来自order_field候选的value；sort省略时按当前usedSort最大值+1计算，空集合默认1。', '展示draft并等待明确确认；取消只丢弃本地草稿，不调用伪造的cancel接口。'], 'prepare'),
    inputs: formInputs,
    steps: [
      { role: 'required', when: '用户明确确认新建字段', capabilityId: 'sale-custom-qr-create', mapping: { draft: 'result.draft' }, instruction: '把prepare返回的同一份draft交给create；不要重新生成id、field或sort。' },
      { role: 'cancel', when: '用户取消新建弹窗', mapping: {}, instruction: '只丢弃draft；Portal没有对应的取消HTTP请求，不能调用不存在的cancel能力。' },
    ],
  },
  'sale-custom-qr-create': {
    ...base('保存用户确认的新建引种证明字段配置。', voidOutput, ['请求成功后按draft.shopId和draft.itemKind重新调用fieldList，逐字段核对field、fieldName、fieldTypeName和sort；空回执不包含新记录ID。'], 'write'),
    inputs: draftInputs,
    steps: [{ role: 'recovery', when: '保存成功、超时或响应丢失后核实写入', capabilityId: 'sale-custom-qr-field-list', mapping: { shopId: 'args.draft.shopId', itemKind: 'args.draft.itemKind' }, instruction: '回查同一店铺和商品分类，按field和sort匹配；匹配不唯一或未出现时报告不确定，不盲目重试。' }],
  },
  'sale-custom-qr-prepare-update': {
    ...base('按Portal编辑字段弹窗规则整理排序更新草稿，不发送保存请求。', prepareOutput(updateDraftFields), ['form必须来自当前字段列表行；currentField必须与form.field相同，field不可编辑，只允许用户修改正整数sort。', 'usedSort必须按Portal逻辑排除当前行sort；重复排序在请求前拒绝。', '用户取消只丢弃draft，不调用伪造的cancel接口。'], 'prepare'),
    inputs: updateFormInputs,
    steps: [
      { role: 'required', when: '用户明确确认编辑字段排序', capabilityId: 'sale-custom-qr-update', mapping: { draft: 'result.draft' }, instruction: '把同一份带currentField锁的draft交给update；SDK会从HTTP body移除currentField。' },
      { role: 'cancel', when: '用户取消编辑弹窗', mapping: {}, instruction: '只丢弃draft；Portal没有取消HTTP端点。' },
    ],
  },
  'sale-custom-qr-update': {
    ...base('保存用户确认的引种证明字段排序编辑。', voidOutput, ['请求只允许修改shopId、itemKind、field、sort、id中的后端可更新字段；currentField是本地锁且不发送。', '成功或超时后按draft.id回查同一字段记录，并确认field未改变、sort为目标值。'], 'write'),
    inputs: updateDraftInputs,
    steps: [{ role: 'recovery', when: '编辑成功、超时或响应丢失后核实写入', capabilityId: 'sale-custom-qr-field-list', mapping: { shopId: 'args.draft.shopId', itemKind: 'args.draft.itemKind' }, instruction: '回查同一店铺和商品分类，按draft.id核对field和sort；找不到或字段不一致不能报告已更新。' }],
  },
  'sale-custom-qr-prepare-remove': {
    ...base('准备删除当前字段列表中用户选定的一条引种证明字段，不发送DELETE。', { shape: '{ id: string | number }', fields: [field('$', 'object', '删除准备结果'), field('id', 'string | number', '待删除的当前字段配置记录ID')], empty: 'ID非法时准备阶段抛错；不发送请求。' }, ['向用户展示目标字段后等待确认；取消只丢弃id。'], 'prepare'),
    inputs: { id: idInput },
    steps: [
      { role: 'required', when: '用户明确确认删除', capabilityId: 'sale-custom-qr-remove', mapping: { id: 'result.id' }, instruction: '提交同一个字段记录ID；成功或超时后回查字段列表。' },
      { role: 'cancel', when: '用户取消删除确认', mapping: {}, instruction: '只丢弃id，不发送DELETE。' },
    ],
  },
  'sale-custom-qr-remove': {
    ...base('删除当前店铺和商品分类下用户确认的一条引种证明字段配置。', voidOutput, ['页面只支持单条删除；请求成功或超时后按同一shopId+itemKind回查，确认目标id不再出现。', 'Java删除没有额外业务回执；不能把空回执当成独立删除证据。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: 'DELETE成功、超时或响应丢失后核实结果', capabilityId: 'sale-custom-qr-field-list', mapping: { shopId: 'context.currentShopId', itemKind: 'context.currentItemKind' }, instruction: '使用发起删除时保存的当前店铺和商品分类上下文，逐页检查目标id是否消失；超时先回查，不自动重删。' }],
  },
}

export const SALE_CUSTOM_QR_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_CUSTOM_QR_METHODS).map(id => [id, contracts[id]!]))
export const SALE_CUSTOM_QR_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_CUSTOM_QR_METHODS).map(([id, method]) => [`saleCustomQr.${method}`, SALE_CUSTOM_QR_AI_CONTRACTS[id]!]))
