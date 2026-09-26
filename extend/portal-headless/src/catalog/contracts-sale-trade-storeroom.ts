import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_TRADE_STOREROOM_METHODS } from '../capabilities/sale-trade-storeroom.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pagePath = '/dashboard/sale/order/trade-storeroom/list'
const pagePermission = '/dashboard/sale/frame/order/trade-storeroom'
const actionPermission = 'order:tradeStoreroom:edit'

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '工厂、基地、库房或装运点记录主键；编辑和删除必须使用当前列表行值。'),
  field('list[].parentId', 'string | number | null', '父级记录ID；页面按类型展示所属基地/工厂候选，但没有required规则。', { nullable: true }),
  field('list[].name', 'string | null', '基地、工厂、库房或装运点名称；列表展示和编辑表单名称。', { nullable: true }),
  field('list[].type', 'string | null', 'trade_storeroom_type字典值；0基地、1工厂、2库房、3装运点的标签应通过base-dict-get读取。', { nullable: true }),
  field('list[].code', 'string | null', '记录编码；type=0的新建/编辑表单受最多30位数字和字母规则约束。', { nullable: true }),
  field('list[].shopId', 'number | null', '供应商店铺ID；编辑时回填shopId，不能用shopName代替。', { nullable: true }),
  field('list[].factoryKind', 'string | number | null', 'item_kind字典值；列表筛选和编辑表单使用原值。', { nullable: true }),
  field('list[].belongFactory', 'string | null', '库房/装运点列表查询时后端补出的所属工厂名称；只读展示。', { nullable: true }),
  field('list[].shopName', 'string | null', '供应商店铺名称；只读展示和筛选快照。', { nullable: true }),
  field('list[].companyOfficeId', 'string | number | null', '发货工厂所属公司的机构ID；type=1时表单必填。', { nullable: true }),
  field('list[].companyName', 'string | null', '所属公司名称；只读展示。', { nullable: true }),
  field('list[].companyCode', 'string | null', '所属公司编码；只读展示。', { nullable: true }),
  field('list[].companyValid', 'boolean | null', '所属公司是否仍是有效工厂公司；后端可能以0/1返回，SDK归一化为布尔值。', { nullable: true }),
  field('list[].createDate', 'string | number | null', '创建时间原值；页面编辑时明确不提交。', { nullable: true }),
  field('list[].updateDate', 'string | number | null', '更新时间原值；页面编辑时明确omit。', { nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', '工厂管理分页结果；Portal把旧CRM count映射为total。'), field('list', 'object[]', '当前筛选页记录，不是全量结果。'), ...rowFields, field('total', 'number', '符合当前类型、名称、店铺名称和类别筛选的记录总数。')],
  empty: 'list=[]表示当前页没有记录；total=0才表示当前筛选无记录，权限或网络失败会抛错。',
}

const supplierOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '当前租户已关联的供应商店铺候选。'), field('[].shopId', 'number', '店铺ID；表单shopId和列表过滤使用。'), field('[].shopName', 'string | null', '店铺展示名称。', { nullable: true })],
  empty: '空数组表示当前租户没有已关联供应商；请求错误不会伪造成空数组。',
}

const companyOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '当前数据权限范围内的发货工厂所属公司候选。'), field('[].id', 'string | number', '公司机构ID；type=1时提交companyOfficeId。'), field('[].name', 'string', '公司展示名称。'), field('[].code', 'string | null', '公司编码；页面展示在名称后，不能替代id。', { nullable: true }), field('[].type', 'string | null', '机构类型原值。', { nullable: true }), field('[].valid', 'number | null', '机构有效标记原值。', { nullable: true })],
  empty: '空数组表示当前会话没有可用公司；不能自行提交公司名称。',
}

const candidateOutput = (kind: 'factory' | 'base'): AiContract['output'] => ({
  shape: 'object[]',
  fields: [field('[]', 'object', `${kind === 'factory' ? '所属工厂' : '所属基地'}候选。`), field('[].id', 'string | number', '候选记录ID；填入编辑表单parentId。'), field('[].name', 'string', '候选名称。'), ...(kind === 'base' ? [field('[].code', 'string | null', '基地编码；只读候选字段。', { nullable: true })] : [])],
  empty: '缺少factoryKind或supplier时Portal事件不发请求并返回空数组；有前置值但后端无候选时也是空数组。',
})

const organizationOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '平台销售组织树根节点。'), field('[].id', 'string | number', '组织节点ID；同步基地时提交该值。'), field('[].name', 'string', '组织节点名称。'), field('[].children', 'object[]', '子组织节点，结构同当前节点。')],
  empty: '空数组表示当前会话没有可见组织；请求失败抛错。',
}

const selectedBaseOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', 'crm_shipping_base中的已同步基地记录。'), field('[].id', 'string | number | null', '同步关系记录ID；不是组织ID。', { nullable: true }), field('[].hrOrgId', 'string | number', '已同步的HR组织ID；用于勾选组织树。'), field('[].hrOrgName', 'string | null', '组织展示名称。', { nullable: true })],
  empty: '空数组表示当前没有已同步基地；不能把它解释成组织树为空。',
}

const formFields: AiField[] = [
  field('form', 'object', 'Portal ModalFormContent产生的完整表单；只包含页面绑定的字段。'),
  field('form.id', 'string | number | null', '编辑时当前列表记录ID；新建为空。', { optional: true, nullable: true }),
  field('form.shopId', 'string | number', '供应商店铺ID；必填，来自supplier-list。'),
  field('form.code', 'string', '编码；必填；type=0时只能是最多30位数字和字母。'),
  field('form.factoryKind', 'string | number', 'item_kind字典值；必填。'),
  field('form.name', 'string', '基地/工厂/库房/装运点名称；必填。'),
  field('form.type', 'string | number', 'trade_storeroom_type字典值；必填。'),
  field('form.parentId', 'string | number | null', '父级ID；页面控件存在但required规则被注释，不由SDK新增必填限制。', { optional: true, nullable: true }),
  field('form.companyOfficeId', 'string | number | null', '所属公司ID；仅type=1时页面required。', { optional: true, nullable: true }),
]

const draftFields: AiField[] = [
  field('draft', 'object', '页面保存接口的提交草稿；不含createDate/updateDate/companyName等列表扩展字段。'),
  field('draft.id', 'string | number', '编辑记录ID；新建按Portal表单发送空值。'),
  field('draft.shopId', 'string | number', '供应商店铺ID。'),
  field('draft.code', 'string', '编码。'),
  field('draft.factoryKind', 'string | number', '类别字典值。'),
  field('draft.name', 'string', '记录名称。'),
  field('draft.type', 'string | number', '记录类型字典值。'),
  field('draft.parentId', 'string | number | null', '父级ID；可为空字符串。', { nullable: true }),
  field('draft.companyOfficeId', 'string | number | null', '公司ID；非type=1时按页面状态发送空值。', { nullable: true }),
]

const removeOutput: AiContract['output'] = {
  shape: '{ id: string | number, type: string }',
  fields: [field('id', 'string | number', '待用户确认删除的当前列表行ID。'), field('type', 'string', '当前列表行类型；删除请求必须携带。')],
  empty: 'ID或type非法时准备阶段抛错且不发送DELETE。',
}

const syncOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [field('draft', 'object', '无副作用的基地同步草稿。'), field('draft.list', 'string', '所选组织ID按Portal FormData.append后的逗号分隔字符串；空字符串表示清空同步基地。')],
  empty: 'ids不是数组或含非法组织ID时准备阶段抛错；成功不代表已写入。',
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', '保存、删除或同步接口没有页面消费的业务回执；Promise完成只代表请求未抛错。')],
  empty: 'CRM返回业务错误或请求失败时抛错；不能把空回执当作已落库证据。',
}

const formInput = param('Portal工厂管理弹窗表单。', '用户输入、当前列表行和本页供应商/公司/基地/工厂候选；字典值来自base-dict-get。', {
  type: 'object',
  required: true,
  constraints: [
    'shopId、code、factoryKind、name、type为页面required字段；type=1时companyOfficeId也必填。',
    'type=0时code匹配^[a-zA-Z0-9]{0,30}$；parentId的页面required规则被注释，SDK不新增限制。',
    '编辑使用当前列表行id；createDate、updateDate、companyName、companyCode、companyValid等列表字段不能拼回save请求。',
  ],
})

const draftInput = param('prepareCreate/prepareUpdate返回的完整工厂管理草稿。', 'sale-trade-storeroom-prepare-create.result.draft 或 sale-trade-storeroom-prepare-update.result.draft', { type: 'object', required: true, constraints: ['同一份草稿确认后交给create/update，不重新猜测parentId、shopId或companyOfficeId。'] })
const idTypeInput = {
  id: param('当前列表行ID。', '用户明确选择的sale-trade-storeroom-list.list[].id', { type: 'string | number', required: true }),
  type: param('当前列表行type。', '同一列表行的type', { type: 'string', required: true }),
}
const idsInput = param('同步基地时用户在组织树中勾选的组织ID数组。', '用户明确勾选的sale-trade-storeroom-organization-tree节点id', { type: 'array', required: true, constraints: ['数组元素必须是非空ID；空数组表示用户确认清空同步基地。'] })
const gaps = ['尚未在真实测试环境执行本页列表、供应商/公司/候选加载、组织树、同步基地、新建、编辑、删除及写入后的回查；当前证据来自Portal源码、CRM/销售Java源码与离线请求断言。']

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户系统设置/销售设置下的“工厂管理”页面${pagePath}；不是独立生产根菜单，也不是生产模块页面。`,
      `页面权限是${pagePermission}；新建、编辑、删除和同步基地均受${actionPermission}按钮权限控制，SDK不绕过前端或后端授权。`,
      '列表和CRM旧接口使用crm实例；同步基地弹窗的组织树使用platform实例。页面字典候选是全局trade_storeroom_type和item_kind，不重复伪造字典接口。',
      '页面没有详情路由；编辑直接从当前列表行构造弹窗表单，不能凭空暴露后端getByFactoryId、findStoreroomByIds等本页未调用的接口。',
      '同步基地是覆盖式保存：后端先清空crm_shipping_base，再写入本次组织ID列表；必须把它当作需要明确确认的写操作。',
    ],
    effect,
    prerequisites: ['使用带会话token、tenantId、crm和platform base URL的SDK；写操作的表单、记录ID或组织勾选结果必须来自用户明确输入。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示请求未抛错；新建、编辑、删除或同步后必须重新list/selectedBaseList核对，不能只看成功提示。' : effect === 'prepare' ? '只得到无副作用草稿，尚未发送写请求。' : '返回通过结构校验的页面数据。',
    failures: ['非法表单、ID、分页或响应形状在本地失败；权限、租户、网络和CRM业务错误原样抛出。', '候选前置值缺失时按Portal交互返回空数组且不发候选请求；不能用猜测的店铺、基地或公司ID替代候选。'],
    idempotency: effect === 'write' ? '旧CRM接口没有requestId；保存、删除或同步超时先回查，不盲目重发。同步基地尤其可能覆盖前一次选择。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:200、app/portal/views/dashboard/sale/order/trade-storeroom/list.vue、ModalFormContent.vue、ModalBaseContent.vue', kind: 'reference', note: '证明页面路径、权限、列表筛选、弹窗校验、候选请求、写请求和同步基地交互。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-crm/.../TradeStoreroomVueController.java、TradeStoreroomService.java、TradeStoreroom.java、TradeStoreroomDao.xml', kind: 'reference', note: '证明CRM旧接口、分页count、字段、重复检查、父级删除保护、公司校验和覆盖式同步。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-sales/.../SalesOrganizationRespVO.java、销售组织Controller', kind: 'reference', note: '证明同步基地组织树的id/name/children来源。' },
      { source: 'src/capabilities/sale-trade-storeroom.ts 与 test/sale-trade-storeroom.test.ts', kind: 'test', note: '锁定列表、CRM表单请求、platform组织树、候选短路、表单规则、prepare→submit→cancel和坏回执；不替代真实环境验证。' },
      { source: 'docs/pages/工厂管理.md', kind: 'reference', note: '记录本页四件套、同步覆盖语义和真实环境缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-trade-storeroom-list': {
    ...base('按类型、名称、店铺名称和类别分页查询工厂管理列表。', listOutput, ['展示name、code、type、companyName/shopName、belongFactory、factoryKind和updateDate；total用于翻页。', '保留当前选中行的id和type供编辑/删除；字典原码用base-dict-get解释，不把标签当提交值。']),
    inputs: {
      type: param('工厂管理类型筛选值。', '用户筛选意图；Portal首次默认0', { type: 'string', required: false, default: '0', lookup: { capabilityId: 'base-dict-get', args: { dictType: 'trade_storeroom_type' }, valueField: 'entries[].value', labelField: 'entries[].label' } }),
      name: param('基地/工厂/库房名称片段。', '用户筛选输入', { type: 'string', required: false, default: '空字符串' }),
      shopName: param('店铺名称片段。', '用户筛选输入', { type: 'string', required: false, default: '空字符串' }),
      factoryKind: param('类别字典值。', '用户筛选输入；Portal使用item_kind', { type: 'string | number', required: false, default: '空值', lookup: { capabilityId: 'base-dict-get', args: { dictType: 'item_kind' }, valueField: 'entries[].value', labelField: 'entries[].label' } }),
      pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页条数。', '调用方分页状态；Portal全局选项', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100。'] }),
    },
  },
  'sale-trade-storeroom-supplier-list': { ...base('读取当前租户已关联的供应商店铺候选，用于工厂管理弹窗shopId。', supplierOutput, ['把用户选定项的shopId填入form.shopId；shopName只展示。']) },
  'sale-trade-storeroom-company-list': { ...base('读取当前数据权限范围内的发货工厂所属公司候选。', companyOutput, ['仅type=1时把用户选定的id填入form.companyOfficeId；code/name不能替代id。']) },
  'sale-trade-storeroom-factory-list': {
    ...base('按类别和供应商读取库房/装运点所属工厂候选。', candidateOutput('factory'), ['只有factoryKind和supplier都有值时请求；将候选id填入type=2/3表单的parentId。']),
    inputs: { factoryKind: param('item_kind类别值。', 'sale-trade-storeroom-form.factoryKind 或用户选择', { type: 'string | number', required: false }), supplier: param('供应商店铺ID。', 'sale-trade-storeroom-supplier-list[].shopId', { type: 'string | number', required: false }) },
  },
  'sale-trade-storeroom-base-list': {
    ...base('按类别和供应商读取工厂所属基地候选。', candidateOutput('base'), ['只有factoryKind和supplier都有值时请求；将候选id填入type=1表单的parentId，code仅展示。']),
    inputs: { factoryKind: param('item_kind类别值。', 'sale-trade-storeroom-form.factoryKind 或用户选择', { type: 'string | number', required: false }), supplier: param('供应商店铺ID。', 'sale-trade-storeroom-supplier-list[].shopId', { type: 'string | number', required: false }) },
  },
  'sale-trade-storeroom-organization-tree': { ...base('读取同步基地弹窗使用的平台组织树。', organizationOutput, ['用户在树中勾选组织节点id；节点name只用于确认展示。', 'Portal源码把isAll/isSalesTree放在Axios配置而不是params，实际请求不额外伪造查询字段。']) },
  'sale-trade-storeroom-selected-base-list': { ...base('读取当前已同步到发货基地范围的组织列表。', selectedBaseOutput, ['用hrOrgId预勾选organization-tree；id是同步关系记录ID，不要交给save/delete。']) },
  'sale-trade-storeroom-prepare-create': {
    ...base('按工厂管理弹窗规则整理新建草稿，不发送CRM save。', { shape: '{ draft: object }', fields: draftFields, empty: '页面必填项、type=0编码规则或type=1公司缺失时抛错；不返回空草稿。' }, ['确认shopId来自供应商候选、factoryKind/type来自字典、type=1的companyOfficeId来自公司候选；取消只丢弃draft。'], 'prepare'),
    inputs: { form: formInput },
    steps: [{ role: 'required', when: '用户明确确认新建', capabilityId: 'sale-trade-storeroom-create', mapping: { draft: 'result.draft' }, instruction: '把同一份草稿交给create；不要把列表扩展字段拼回请求。' }, { role: 'cancel', when: '用户取消新建', instruction: '只丢弃草稿，不发送save。' }],
  },
  'sale-trade-storeroom-create': {
    ...base('保存一条用户确认的基地、工厂、库房或装运点记录。', voidOutput, ['旧CRM保存没有页面消费的新ID；保存成功或超时后用list按type、name、code、shopId等字段回查，匹配不唯一时不能猜测。'], 'write'),
    inputs: { draft: draftInput },
    steps: [{ role: 'recovery', when: '保存成功、超时或响应丢失后核实结果', capabilityId: 'sale-trade-storeroom-list', mapping: {}, instruction: '重新分页查询并逐字段核对本次草稿；不能只看保存提示。' }],
  },
  'sale-trade-storeroom-prepare-update': {
    ...base('按当前列表行和工厂管理弹窗规则整理编辑草稿，不发送CRM save。', { shape: '{ draft: object }', fields: draftFields, empty: '缺少当前行id、必填字段、type=0编码规则或type=1公司时抛错。' }, ['页面没有详情GET；编辑前必须保留当前列表行的id和可编辑字段，日期和公司展示快照不提交。', '取消只丢弃draft。'], 'prepare'),
    inputs: { form: formInput },
    steps: [{ role: 'required', when: '用户明确确认编辑', capabilityId: 'sale-trade-storeroom-update', mapping: { draft: 'result.draft' }, instruction: '把同一份含当前id的草稿交给update。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃草稿，不发送save。' }],
  },
  'sale-trade-storeroom-update': {
    ...base('保存一条用户确认的工厂管理编辑草稿。', voidOutput, ['保存成功或超时后按draft.id重新list核对；后端还会在工厂所属公司变化时同步子级供应商和类别，必须以回查为准。'], 'write'),
    inputs: { draft: draftInput },
    steps: [{ role: 'recovery', when: '编辑成功、超时或响应丢失后核实结果', capabilityId: 'sale-trade-storeroom-list', mapping: {}, instruction: '重新查询同一type和筛选范围，核对id及全部可见字段。' }],
  },
  'sale-trade-storeroom-prepare-remove': {
    ...base('准备删除当前列表选定的工厂管理记录，不发送DELETE。', removeOutput, ['向用户展示当前行name、type、code和所属层级并等待确认；删除基地或工厂时后端若存在子级会拒绝。'], 'prepare'),
    inputs: idTypeInput,
    steps: [{ role: 'required', when: '用户明确确认删除', capabilityId: 'sale-trade-storeroom-remove', mapping: { id: 'result.id', type: 'result.type' }, instruction: '提交同一列表行的id和type。' }, { role: 'cancel', when: '用户取消删除', instruction: '只丢弃删除草稿，不发送DELETE。' }],
  },
  'sale-trade-storeroom-remove': {
    ...base('删除当前列表选定的工厂管理记录。', voidOutput, ['删除成功或超时后重新list确认目标ID消失；后端对有子级的基地/工厂会拒绝删除，不能绕过保护。'], 'write'),
    inputs: { id: param('待删除记录ID。', 'sale-trade-storeroom-prepare-remove.result.id', { type: 'string | number', required: true }), type: param('待删除记录类型。', 'sale-trade-storeroom-prepare-remove.result.type', { type: 'string', required: true }) },
    steps: [{ role: 'recovery', when: '删除成功、超时或响应丢失后核实结果', capabilityId: 'sale-trade-storeroom-list', mapping: {}, instruction: '按原type重新查询并确认目标ID不再出现。' }],
  },
  'sale-trade-storeroom-prepare-sync-base': {
    ...base('整理同步基地弹窗勾选的组织ID，不发送覆盖式保存请求。', syncOutput, ['先用selected-base-list取得旧勾选，再用organization-tree让用户调整；空数组代表用户明确要清空同步基地。', '用户取消时丢弃draft，不能把prepare当作已同步。'], 'prepare'),
    inputs: { ids: idsInput },
    steps: [{ role: 'required', when: '用户明确确认覆盖同步基地范围', capabilityId: 'sale-trade-storeroom-sync-base', mapping: { draft: 'result.draft' }, instruction: '提交同一份draft；list是逗号分隔组织ID。' }, { role: 'cancel', when: '用户取消同步', instruction: '只丢弃草稿，不调用syncBase。' }],
  },
  'sale-trade-storeroom-sync-base': {
    ...base('覆盖保存用户确认的同步基地组织范围。', voidOutput, ['后端先清空旧同步关系再批量插入本次list；成功或超时后调用selected-base-list并逐项核对hrOrgId。'], 'write'),
    inputs: { draft: param('prepareSyncBase返回的同步草稿。', 'sale-trade-storeroom-prepare-sync-base.result.draft', { type: 'object', required: true }) },
    steps: [{ role: 'recovery', when: '同步成功、超时或响应丢失后核实结果', capabilityId: 'sale-trade-storeroom-selected-base-list', mapping: {}, instruction: '重新读取已同步基地并核对本次组织ID集合；不以“操作成功”文案替代回查。' }],
  },
}

export const SALE_TRADE_STOREROOM_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_TRADE_STOREROOM_METHODS).map(id => [id, contracts[id]!]))
export const SALE_TRADE_STOREROOM_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_TRADE_STOREROOM_METHODS).map(([id, method]) => [`saleTradeStoreroom.${method}`, SALE_TRADE_STOREROOM_AI_CONTRACTS[id]!]))
