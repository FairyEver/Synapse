import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INVENTORY_ASSET_STOCKTAKING_CONFIG_METHODS, inventoryAssetStocktakingConfigCapabilities } from '../capabilities/inventory-asset-stocktaking-config.js'

const definitions = new Map(inventoryAssetStocktakingConfigCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用组织名称、人员姓名或列表位置代替ID']

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '资产盘点配置分页结果；SDK保留list和total，不把分页包装误报为数组'),
    field('list', 'object[]', '当前页盘点配置'),
    field('list[]', 'object', '一条盘点配置'),
    field('list[].id', 'string | number', '配置业务ID；编辑和删除时必须使用此ID', { constraints: idRules }),
    field('list[].type', '2 | 3', '盘点类型；2抽盘、3清盘'),
    field('list[].typeName', 'string | null', '盘点类型名称', { nullable: true, nullMeaning: '后端未返回字典名称' }),
    field('list[].orgId', 'string | number', '适用法人组织ID', { constraints: idRules }),
    field('list[].orgName', 'string | null', '适用法人组织名称', { nullable: true, nullMeaning: '后端未补齐组织名称' }),
    field('list[].stocktakerUserId', 'string | number', '盘点人用户ID', { constraints: idRules }),
    field('list[].stocktakerUserName', 'string | null', '盘点人显示名称', { nullable: true, nullMeaning: '后端未补齐人员名称' }),
    field('list[].triggerMonth', 'integer | null', '清盘触发月1至12；抽盘时为null', { nullable: true, nullMeaning: '抽盘配置不使用触发月' }),
    field('list[].triggerDay', 'integer | null', '清盘触发日1至31；抽盘时为null', { nullable: true, nullMeaning: '抽盘配置不使用触发日' }),
    field('list[].creator', 'string | number | null', '创建人ID', { nullable: true, nullMeaning: '后端未返回创建人ID', constraints: idRules }),
    field('list[].creatorName', 'string | null', '创建人名称', { nullable: true, nullMeaning: '后端未补齐创建人名称' }),
    field('list[].createTime', 'string | null', '创建时间原文', { nullable: true, nullMeaning: '后端未返回创建时间' }),
    field('list[].updater', 'string | number | null', '更新人ID', { nullable: true, nullMeaning: '后端未返回更新人ID', constraints: idRules }),
    field('list[].updaterName', 'string | null', '更新人名称', { nullable: true, nullMeaning: '后端未补齐更新人名称' }),
    field('list[].updateTime', 'string | null', '更新时间原文', { nullable: true, nullMeaning: '后端未返回更新时间' }),
    field('total', 'integer', '符合筛选条件的总条数'),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；权限、会话、网络或响应形状错误会抛出，不降级为空成功。',
}

const usersOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('list', 'object[]', '关键字命中的盘点人候选'),
    field('list[].id', 'string | number', '用户ID；提交配置时作为stocktakerUserId', { constraints: idRules }),
    field('list[].label', 'string', 'Portal显示文本：realName/nickname/name优先，并在有code时追加(code)'),
    field('list[].code', 'string | null', '用户编码', { nullable: true, nullMeaning: '后端未返回编码' }),
    field('list[].realName', 'string | null', '真实姓名', { nullable: true, nullMeaning: '后端未返回真实姓名' }),
    field('list[].nickname', 'string | null', '昵称', { nullable: true, nullMeaning: '后端未返回昵称' }),
    field('list[].name', 'string | null', '兼容名称字段', { nullable: true, nullMeaning: '后端未返回name' }),
    field('total', 'integer', '关键字和组织筛选命中的总人数'),
  ],
  empty: 'list=[]且total=0表示当前关键字下没有候选；不能把空候选当成用户ID缺省。',
}

const draftOutput = (label: string, includeId: boolean): AiContract['output'] => ({
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', label),
    ...(includeId ? [field('draft.id', 'string | number', '资产盘点配置业务ID', { constraints: idRules })] : []),
    field('draft.type', '2 | 3', '2抽盘、3清盘；后端不允许编辑时改变已有类型'),
    field('draft.orgId', 'string | number', '适用法人组织ID', { constraints: idRules }),
    field('draft.stocktakerUserId', 'string | number', '盘点人用户ID', { constraints: idRules }),
    field('draft.triggerMonth', 'integer | null', '清盘月1至12；抽盘被Portal规则强制为null', { nullable: true, nullMeaning: '抽盘配置不提交触发月' }),
    field('draft.triggerDay', 'integer | null', '清盘日1至31；抽盘被Portal规则强制为null', { nullable: true, nullMeaning: '抽盘配置不提交触发日' }),
  ],
  empty: '字段、ID或清盘月日非法时抛错；用户取消时只丢弃draft，不发写请求。',
})

const idOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', 'Java Long新建记录ID；必须用此ID回查列表', { constraints: idRules })],
  empty: '没有有效ID或请求抛错不能报告创建完成。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', 'Java CommonResult<Boolean>解包后的成功值true；仍需回查目标记录')],
  empty: 'false或其它响应形状会抛错；不能把HTTP成功当作业务终态。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ test/portal/main: app/portal/menus/material.js、views/dashboard/material/assets/stocktaking-config.vue、list.vue、components/form-modal.vue、common/libs/renren/list.js、common/utils/fetch.js', kind: 'reference', note: '逐页核对资产管理模块、列表分页/日期范围repeat序列化、用户候选、按钮权限、清盘月日校验及create/update/delete请求。' },
  { source: 'CodeReview_Mall_Platform_Java @ test/test: AssetStocktakingConfigController、PageReqVO、SaveReqVO、RespVO、AssetStocktakingConfigServiceImpl、AssetStocktakingConfigMapper、AssetStocktakingConfigDO', kind: 'reference', note: '核对Long/Integer字段、按钮与页面权限、类型不可变、重复校验、抽盘清空月日、删除引用保护和分页排序。' },
  { source: 'src/capabilities/inventory-asset-stocktaking-config.ts、src/http/client.ts 与 test/inventory-asset-stocktaking-config.test.ts', kind: 'implementation', note: '锁定分页参数、日期转换、repeat数组编码、人员关键字保护、表单联动、prepare→submit→cancel和坏输入/坏响应反证；不替代真实环境回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作Portal「物料 → 资产 → 盘点配置」的分页列表、盘点人候选、新建、编辑或删除。',
  boundaries: [
    '页面路径是/dashboard/material/assets/stocktaking-config/list，权限是/dashboard/material/assets/stocktaking-config；请求使用platform实例并发送module-type=31。',
    '列表customLoad实际GET /admin-api/inventory/asset-stocktaking-config/page，带order=""、orderField、type、stocktakerUserId、orgId、pageNo、pageSize；日期选择器的createTime转换为[起始日 00:00:00, 结束日 23:59:59]，且Portal用paramsArrayFormat=repeat，SDK复刻该配置。',
    '盘点类型只允许2抽盘或3清盘；抽盘保存时无论表单残留什么月日都提交null，清盘必须提交1至12月和1至31日。后端还拒绝编辑时改变既有类型，并按组织/类型及盘点人组合做重复校验。',
    '新建实际POST /admin-api/inventory/asset-stocktaking-config/create并返回Long ID；编辑实际PUT /admin-api/inventory/asset-stocktaking-config/update；删除实际DELETE /admin-api/inventory/asset-stocktaking-config/delete?id=...，三类写操作分别受create/edit/delete按钮权限保护。',
    'Portal挂载时会无关键字全量拉取simple-page人员；这是长选项高风险行为，SDK不把4500人倒入调用上下文，searchStocktakerUsers要求keyword，可额外按companyUnitId组织筛选。',
  ],
  prerequisites: ['使用当前用户会话、tenant-id、module-type=31和页面权限创建SDK；组织ID、人员ID和类型值必须来自当前可见列表/候选。', '所有写操作先prepare并保留用户确认的draft；取消只丢弃draft，不发请求。'],
  failures: ['ID、类型、日期、分页、关键字、权限、重复配置、已被盘点记录引用、网络或响应形状错误会抛出；不把空候选、空分页或HTTP成功降级为业务成功。'],
  evidence,
  gaps: ['已完成Portal/Java逐页静态核对与离线请求断言；尚未在真实测试环境执行本页create/update/delete的prepare→submit→cancel及逐条列表回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Inventory asset stocktaking config contract has no definition: ${id}`)
  contracts[id] = value
}

const listInputs: Record<string, AiParameter> = {
  type: param('盘点类型筛选；2抽盘、3清盘，省略或null表示不筛选。', 'Portal盘点类型下拉', { type: 'integer', required: false, nullable: true, default: 'null' }),
  stocktakerUserId: param('盘点人用户ID筛选。', 'Portal盘点人下拉选中值', { type: 'string | number', required: false, nullable: true, default: 'null', constraints: idRules }),
  orgId: param('适用法人组织ID筛选。', 'Portal所属组织树选中值', { type: 'string | number', required: false, nullable: true, default: 'null', constraints: idRules }),
  createTime: param('创建日期范围两个YYYY-MM-DD值；SDK按页面补成当天起止时间。', 'Portal日期范围选择器', { type: 'string[]', required: false, nullable: true, default: '不发送' }),
  pageNo: param('页码，从1开始，默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
  pageSize: param('每页条数，页面支持10、20、50、100，默认20。', 'Portal分页状态', { type: 'integer', required: false, default: '20' }),
}
const draftInput = (meaning: string, source: string): AiParameter => param(meaning, source, { type: 'object', required: true })

add('inventory-asset-stocktaking-config-list', base({ purpose: '读取当前用户可见的资产盘点配置分页。', effect: 'read', inputs: listInputs, output: listOutput, consume: ['展示list；编辑/删除只使用list[].id，类型和组织/人员显示字段只作展示。'], steps: [], completion: '得到符合筛选条件的分页和总数。', idempotency: null }))
add('inventory-asset-stocktaking-config-search-users', base({ purpose: '按关键字搜索盘点人候选，供新建/编辑表单选择。', effect: 'read', inputs: { keyword: param('人员关键字，不能为空。', '调用方明确输入的搜索词', { type: 'string', required: true }), orgId: param('法人组织ID，映射为companyUnitId。', 'Portal组织选择结果', { type: 'string | number', required: false, nullable: true, constraints: idRules }), pageNo: param('页码，默认1。', '调用方分页状态', { type: 'integer', required: false, default: '1' }), pageSize: param('每页条数，默认20。', '调用方分页状态', { type: 'integer', required: false, default: '20' }) }, output: usersOutput, consume: ['把list[].id作为stocktakerUserId；不要把label或code当ID。'], steps: [], completion: '得到关键字和组织范围内的盘点人分页。', idempotency: null }))
add('inventory-asset-stocktaking-config-prepare-create', base({ purpose: '按Portal新建表单规则校验并准备一份尚未写入的盘点配置。', effect: 'prepare', inputs: { type: param('2抽盘或3清盘。', 'Portal盘点类型下拉', { type: 'integer', required: true }), orgId: param('适用法人组织ID。', 'Portal组织树', { type: 'string | number', required: true, constraints: idRules }), stocktakerUserId: param('盘点人用户ID。', 'searchStocktakerUsers.list[].id', { type: 'string | number', required: true, constraints: idRules }), triggerMonth: param('清盘触发月；抽盘即使传值也会按Portal清为null。', '用户选择的月日', { type: 'integer', required: false, nullable: true }), triggerDay: param('清盘触发日；抽盘即使传值也会按Portal清为null。', '用户选择的月日', { type: 'integer', required: false, nullable: true }) }, output: draftOutput('已按页面类型联动整理的新建草稿。', false), consume: ['用户确认后只把result.draft交给create；用户取消只丢弃草稿。'], steps: [{ role: 'required', when: '用户确认新建', capabilityId: 'inventory-asset-stocktaking-config-create', mapping: { draft: 'result.draft' }, instruction: '提交同一draft；成功或超时后按返回ID回查列表。' }, { role: 'cancel', when: '用户取消新建', instruction: '丢弃draft，不调用create。' }], completion: '得到尚未写入的完整创建草稿。', idempotency: null }))
add('inventory-asset-stocktaking-config-create', base({ purpose: '创建一条资产盘点配置。', effect: 'write', inputs: { draft: draftInput('prepareCreate返回的创建草稿。', 'inventory-asset-stocktaking-config-prepare-create.result.draft'), 'draft.orgId': param('创建草稿中的法人组织ID，用于回查范围。', 'inventory-asset-stocktaking-config-prepare-create.result.draft.orgId', { type: 'string | number', required: true, constraints: idRules }), 'draft.type': param('创建草稿中的盘点类型，用于回查范围。', 'inventory-asset-stocktaking-config-prepare-create.result.draft.type', { type: 'integer', required: true }) }, output: idOutput, consume: ['严格POST /admin-api/inventory/asset-stocktaking-config/create；返回ID后必须list回查类型、组织、盘点人和清盘月日。'], steps: [{ role: 'required', when: '请求返回ID或超时', capabilityId: 'inventory-asset-stocktaking-config-list', mapping: { orgId: 'args.draft.orgId', type: 'args.draft.type' }, instruction: '按同一组织和类型重新分页，定位返回ID并逐字段核对；超时先回查，不盲目重建。' }], completion: '返回ID且列表回查确认记录字段一致。', idempotency: '后端没有requestId；重复配置会被拒绝，超时先按ID或组织+类型回查。' }))
add('inventory-asset-stocktaking-config-prepare-update', base({ purpose: '按Portal编辑表单规则校验并准备一份含ID的盘点配置修改草稿。', effect: 'prepare', inputs: { id: param('待编辑配置ID。', 'inventory-asset-stocktaking-config-list.list[].id', { type: 'string | number', required: true, constraints: idRules }), type: param('盘点类型；后端不允许改变已有记录类型。', '原列表行或用户确认值', { type: 'integer', required: true }), orgId: param('适用法人组织ID。', 'Portal组织树', { type: 'string | number', required: true, constraints: idRules }), stocktakerUserId: param('盘点人用户ID。', 'searchStocktakerUsers.list[].id', { type: 'string | number', required: true, constraints: idRules }), triggerMonth: param('清盘月；抽盘强制null。', '用户选择的月日', { type: 'integer', required: false, nullable: true }), triggerDay: param('清盘日；抽盘强制null。', '用户选择的月日', { type: 'integer', required: false, nullable: true }) }, output: draftOutput('已按页面类型联动整理的编辑草稿。', true), consume: ['用户确认后只把result.draft交给update；取消只丢弃草稿。'], steps: [{ role: 'required', when: '用户确认编辑', capabilityId: 'inventory-asset-stocktaking-config-update', mapping: { draft: 'result.draft' }, instruction: '提交同一ID和完整draft；成功或超时后按ID回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不调用update。' }], completion: '得到尚未写入的完整编辑草稿。', idempotency: null }))
add('inventory-asset-stocktaking-config-update', base({ purpose: '保存一条资产盘点配置编辑。', effect: 'write', inputs: { draft: draftInput('prepareUpdate返回的含ID完整草稿。', 'inventory-asset-stocktaking-config-prepare-update.result.draft'), 'draft.orgId': param('编辑草稿中的法人组织ID，用于回查范围。', 'inventory-asset-stocktaking-config-prepare-update.result.draft.orgId', { type: 'string | number', required: true, constraints: idRules }), 'draft.type': param('编辑草稿中的盘点类型，用于回查范围。', 'inventory-asset-stocktaking-config-prepare-update.result.draft.type', { type: 'integer', required: true }) }, output: trueOutput, consume: ['严格PUT /admin-api/inventory/asset-stocktaking-config/update；后端会拒绝类型变化、重复组合和清盘缺月日。'], steps: [{ role: 'required', when: '请求返回true或超时', capabilityId: 'inventory-asset-stocktaking-config-list', mapping: { orgId: 'args.draft.orgId', type: 'args.draft.type' }, instruction: '按同一组织/类型分页定位draft.id，逐字段核对；未回查前不要重复PUT。' }], completion: '返回true且按ID回查确认编辑终态。', idempotency: 'PUT是覆盖式更新且无requestId；超时先按ID回查。' }))
add('inventory-asset-stocktaking-config-prepare-remove', base({ purpose: '准备删除一条资产盘点配置。', effect: 'prepare', inputs: { id: param('待删除配置ID。', 'inventory-asset-stocktaking-config-list.list[].id', { type: 'string | number', required: true, constraints: idRules }) }, output: { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待删除配置业务ID', { constraints: idRules })], empty: 'ID非法时抛错；取消时不发DELETE。' }, consume: ['用户确认后把result.id交给remove；取消只丢弃ID。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'inventory-asset-stocktaking-config-remove', mapping: { id: 'result.id' }, instruction: '提交同一ID；删除成功或超时后list确认该ID不再出现。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用remove。' }], completion: '得到尚未执行的删除ID。', idempotency: null }))
add('inventory-asset-stocktaking-config-remove', base({ purpose: '删除一条没有被资产盘点记录引用的配置。', effect: 'write', inputs: { id: param('prepareRemove返回的配置ID。', 'inventory-asset-stocktaking-config-prepare-remove.result.id', { type: 'string | number', required: true, constraints: idRules }) }, output: trueOutput, consume: ['严格DELETE /admin-api/inventory/asset-stocktaking-config/delete?id=...；若后端提示已被盘点记录引用，不能绕过保护删除。'], steps: [{ role: 'required', when: '请求返回true或超时', capabilityId: 'inventory-asset-stocktaking-config-list', mapping: {}, instruction: '刷新列表并确认同一ID不再出现；权限或引用错误应报告失败。' }], completion: '返回true且列表回查确认目标ID已消失。', idempotency: '后端无requestId且删除不可恢复；超时先list确认，不盲目重试。' }))

export const INVENTORY_ASSET_STOCKTAKING_CONFIG_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(INVENTORY_ASSET_STOCKTAKING_CONFIG_METHODS).map(id => [id, contracts[id]!]))
export const INVENTORY_ASSET_STOCKTAKING_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INVENTORY_ASSET_STOCKTAKING_CONFIG_METHODS).map(([id, method]) => [`inventoryAssetStocktakingConfig.${method}`, INVENTORY_ASSET_STOCKTAKING_CONFIG_AI_CONTRACTS[id]!]))
