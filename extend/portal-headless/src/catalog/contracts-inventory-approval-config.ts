import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INVENTORY_APPROVAL_CONFIG_METHODS, inventoryApprovalConfigCapabilities } from '../capabilities/inventory-approval-config.js'

const definitions = new Map(inventoryApprovalConfigCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用组织名称、类型名称或列表位置代替ID']

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '按标准单元和物料操作类型分组的审批配置树节点；Portal为无业务ID的分组节点生成随机表格key，SDK不把该UI key当业务ID'),
    field('[].name', 'string', '操作类型名称，例如物料入库或物料出库'),
    field('[].unitId', 'string | number | null', '标准单元ID；来自组织范围，子项继承该值', { nullable: true, nullMeaning: '后端分组缺少标准单元' }),
    field('[].unitName', 'string | null', '标准单元名称', { nullable: true, nullMeaning: '后端未返回名称' }),
    field('[].children', 'object[]', '该操作类型下的具体子类型配置'),
    field('[].children[].id', 'string | number', '审批配置业务ID；更新审批开关时必须原样提交', { constraints: idRules }),
    field('[].children[].name', 'string', '操作子类型名称'),
    field('[].children[].isRequiresApproval', 'boolean', '是否需要审批；true需要，false不需要'),
    field('[].children[].createTime', 'string | null', '后端格式化后的创建时间原文', { nullable: true, nullMeaning: '后端未返回创建时间' }),
    field('[].children[].unitId', 'string | number | null', '子项所属标准单元ID，Portal从父节点补齐', { nullable: true, nullMeaning: '父节点也未返回标准单元' }),
    field('[].children[].unitName', 'string | null', '子项所属标准单元名称，Portal从父节点补齐', { nullable: true, nullMeaning: '父节点也未返回名称' }),
  ],
  empty: '[]表示当前组织筛选下没有审批配置；权限、会话、网络或响应形状错误会抛出，不降级为空成功。',
}

const typeOptionsOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '库存操作类型候选'),
    field('[].value', 'string', '表格选择值，格式为type-subtype，必须原样交给prepareCreate'),
    field('[].label', 'string', '操作类型显示名称，提交时作为subtypeName'),
  ],
  empty: '[]表示没有可选物料操作类型；不能自行猜测type或subtype。',
}

const createPreparationOutput: AiContract['output'] = {
  shape: '{ draft: object[] }',
  fields: [
    field('draft', 'object[]', '按Portal批量创建请求转换后的尚未写入草稿'),
    field('draft[].unitId', 'string | number', '标准单元ID', { constraints: idRules }),
    field('draft[].typeList', 'object[]', 'Java批量创建DTO中的操作类型数组'),
    field('draft[].typeList[].type', 'string', '物料操作大类编码'),
    field('draft[].typeList[].subtype', 'string', '物料操作子类型编码'),
    field('draft[].typeList[].subtypeName', 'string', '由type-list候选value匹配出的子类型名称'),
    field('draft[].isRequiresApproval', 'boolean', '是否需要审批；Portal把1转换为true、0转换为false'),
  ],
  empty: '字段、ID、type-subtype值或枚举非法时抛错；用户取消时只丢弃draft，不发POST。',
}

const setApprovalPreparationOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '待用户确认的审批开关草稿'),
    field('draft.id', 'string | number', '审批配置业务ID', { constraints: idRules }),
    field('draft.isRequiresApproval', 'boolean', '目标审批状态'),
  ],
  empty: 'ID或审批状态非法时抛错；用户取消时不发PUT。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', 'Java CommonResult<Boolean>解包后的成功值true；仍需回查列表确认最终状态')],
  empty: '请求抛错或不是true时不能报告写入完成。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ test/portal/main: app/portal/menus/material.js、views/dashboard/material/approval-configuration/list.vue、components/create-configuration.vue、common/libs/renren/list.js', kind: 'reference', note: '逐页核对菜单权限、platform实例、module-type无法推导、order/orderField/orgId查询、树形响应加工、typeList候选、批量创建和行内审批开关更新。' },
  { source: 'CodeReview_Mall_Platform_Java @ test/test: ApprovalConfigController、ApprovalConfigPageReqVO、ApprovalConfigSaveReqVO、ApprovalConfigTypeSaveReqVO、ApprovalConfigDO、ApprovalConfigServiceImpl、ApprovalConfigMapper.xml', kind: 'reference', note: '核对GET列表/typeList、POST batch-create、PUT update、组织后代范围、重复类型校验、Boolean字段、创建时间倒序和页面权限。' },
  { source: 'src/capabilities/inventory-approval-config.ts 与 test/inventory-approval-config.test.ts', kind: 'implementation', note: '锁定Portal请求键序、批量payload、Boolean转换、树节点字段、prepare→submit→cancel以及坏输入/坏响应反证；不替代真实环境回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作Portal「物料 → 审批配置」列表、类型候选、批量新增弹窗或行内审批开关。',
  boundaries: [
    '页面路径是/dashboard/material/approval-configuration/list，权限是/dashboard/material/approval-configuration；请求使用platform实例。页面路径未命中module-type规则，SDK与浏览器一样不发送module-type头。',
    '列表customLoad实际发送GET /admin-api/inventory/approval-config/list，并带order=""、orderField=""、orgId；返回的是后端树数组，不是分页对象。Portal为无id的分组节点生成随机UI key，SDK只把后端业务ID用于后续写操作。',
    '类型候选实际来自GET /admin-api/inventory/stock/typeList；批量创建把页面typeIds的type-subtype字符串转换为typeList，并把isRequiresApproval的1/0转换为Boolean。空筛选和组织ID不能混成名称。',
    '新增实际POST /admin-api/inventory/approval-config/batch-create；行内添加/取消审批实际PUT /admin-api/inventory/approval-config/update，载荷只有id和Boolean isRequiresApproval。删除端点虽存在于Java但Portal当前页面没有可达删除入口，不注册为页面能力。',
    '写操作成功或超时都必须重新读取列表逐个ID核对；HTTP true不等于业务终态，不能盲目重放批量创建或状态覆盖。',
  ],
  prerequisites: ['使用当前用户会话、tenant-id和页面权限创建SDK；组织ID和类型value必须来自页面候选或已核实的当前数据。', '写操作先prepare并保留用户确认的draft；取消只丢弃draft，不发请求。'],
  failures: ['ID、type-subtype、候选、Boolean、权限、组织范围、重复配置、网络或响应形状错误会抛出；不把空数组、空树或HTTP成功降级成业务成功。'],
  evidence,
  gaps: ['已完成Portal/Java逐页静态核对与离线请求断言；尚未在真实测试环境执行审批配置的prepare→submit→cancel、批量创建及逐个开关回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Inventory approval config contract has no definition: ${id}`)
  contracts[id] = value
}

const listInput: Record<string, AiParameter> = {
  orgId: param('所属组织筛选ID；省略或清空时按Portal发送null。', 'Portal组织树选择结果', { type: 'string | number', required: false, nullable: true, default: 'null', constraints: idRules }),
}
const rowsInput = param('页面表格行数组：每行包含unitId、typeIds和isRequiresApproval。', '用户明确填写的新增表格', { type: 'object[]', required: true })
const typeOptionsInput = param('inventory-approval-config-type-list返回的value/label候选数组。', 'inventory-approval-config-type-list', { type: 'object[]', required: true })
const draftInput = (meaning: string, source: string): AiParameter => param(meaning, source, { type: 'object | object[]', required: true })

add('inventory-approval-config-list', base({ purpose: '读取当前用户在审批配置页面可见的树形配置。', effect: 'read', inputs: listInput, output: treeOutput, consume: ['展示分组和children；后续切换审批只使用children[].id，不使用随机分组key。'], steps: [], completion: '得到当前组织筛选下的审批配置树。', idempotency: null }))
add('inventory-approval-config-type-list', base({ purpose: '读取批量新增弹窗的物料操作类型候选。', effect: 'read', inputs: {}, output: typeOptionsOutput, consume: ['把value作为typeIds候选，把label用于prepareCreate生成subtypeName。'], steps: [], completion: '得到当前可选的type-subtype候选。', idempotency: null }))
add('inventory-approval-config-prepare-create', base({ purpose: '将新增弹窗的行数据转换为Java批量创建请求草稿。', effect: 'prepare', inputs: { rows: rowsInput, typeOptions: typeOptionsInput }, output: createPreparationOutput, consume: ['确认后只把draft交给inventory-approval-config-create；取消只丢弃草稿。'], steps: [{ role: 'required', when: '用户确认批量生成', capabilityId: 'inventory-approval-config-create', mapping: { draft: 'result.draft' }, instruction: '提交同一批draft；成功或超时后重新list并按unitId/type/subtype逐个核对。' }, { role: 'cancel', when: '用户取消新增弹窗', instruction: '丢弃draft，不调用create。' }], completion: '获得尚未写入的批量审批配置草稿。', idempotency: null }))
add('inventory-approval-config-create', base({ purpose: '批量生成标准单元的物料审批配置。', effect: 'write', inputs: { draft: draftInput('prepareCreate返回的批量typeList/isRequiresApproval草稿。', 'inventory-approval-config-prepare-create.draft') }, output: trueOutput, consume: ['严格POST /admin-api/inventory/approval-config/batch-create；重复的unitId/type/subtype由Java拒绝，不能把true回执当作每条记录都已落库。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'inventory-approval-config-list', mapping: {}, instruction: '按同一组织筛选重新读取树，逐个核对本批type/subtype和Boolean状态。' }], completion: '列表回查确认每个目标配置存在且状态一致后报告完成。', idempotency: '后端没有requestId；超时先list核实，不盲目重复批量创建。' }))
add('inventory-approval-config-prepare-set-approval', base({ purpose: '准备一条物料审批配置的审批开关变更。', effect: 'prepare', inputs: { id: param('审批配置children[].id。', 'inventory-approval-config-list.[].children[].id', { type: 'string | number', required: true, constraints: idRules }), isRequiresApproval: param('目标状态；true需要审批，false不需要。', '用户明确点击添加审批或取消审批', { type: 'boolean', required: true }) }, output: setApprovalPreparationOutput, consume: ['确认后把draft传给setApproval；取消不发PUT。'], steps: [{ role: 'required', when: '用户确认切换审批开关', capabilityId: 'inventory-approval-config-set-approval', mapping: { draft: 'result.draft' }, instruction: '提交同一ID和目标Boolean；完成后list回查该ID。' }, { role: 'cancel', when: '用户取消状态变更', instruction: '丢弃draft，不调用setApproval。' }], completion: '得到尚未写入的单条审批状态草稿。', idempotency: null }))
add('inventory-approval-config-set-approval', base({ purpose: '切换一条审批配置是否需要审批。', effect: 'write', inputs: { draft: draftInput('prepareSetApproval返回的id和isRequiresApproval草稿。', 'inventory-approval-config-prepare-set-approval.draft') }, output: trueOutput, consume: ['严格PUT /admin-api/inventory/approval-config/update，data只有id和Boolean isRequiresApproval；成功或超时后按同一ID回查。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'inventory-approval-config-list', mapping: {}, instruction: '重新读取同一组织范围，定位children[].id并核对isRequiresApproval。' }], completion: '列表回查确认同一ID状态已变更后报告完成。', idempotency: 'PUT为覆盖写且无requestId；超时先list确认，不盲目重复切换。' }))

export const INVENTORY_APPROVAL_CONFIG_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(INVENTORY_APPROVAL_CONFIG_METHODS).map(id => [id, contracts[id]!]))
export const INVENTORY_APPROVAL_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INVENTORY_APPROVAL_CONFIG_METHODS).map(([id, method]) => [`inventoryApprovalConfig.${method}`, INVENTORY_APPROVAL_CONFIG_AI_CONTRACTS[id]!]))
