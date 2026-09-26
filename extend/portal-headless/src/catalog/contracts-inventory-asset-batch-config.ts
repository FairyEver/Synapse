import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INVENTORY_ASSET_BATCH_CONFIG_METHODS, inventoryAssetBatchConfigCapabilities } from '../capabilities/inventory-asset-batch-config.js'

const definitions = new Map(inventoryAssetBatchConfigCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用名称、编码、树层级或列表位置代替ID']

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '批次配置分页结果；SDK保留list和total，不把分页包装误报为数组'),
    field('list', 'object[]', '当前页批次配置'),
    field('list[]', 'object', '一条批次配置'),
    field('list[].id', 'string | number', '批次配置业务ID；启停和删除必须使用此ID', { constraints: idRules }),
    field('list[].configType', '1 | 2', '后端配置类型；1物料、2物料分类'),
    field('list[].categoryId', 'string | number | null', '分类配置的分类ID；物料配置时为空', { nullable: true, nullMeaning: '该行是物料配置或后端未返回' }),
    field('list[].categoryName', 'string | null', '分类配置名称', { nullable: true, nullMeaning: '该行不是分类配置或后端未返回' }),
    field('list[].categoryPathName', 'string | null', '页面展示的分类全路径；物料行使用物料所属分类路径', { nullable: true, nullMeaning: '后端未补齐路径' }),
    field('list[].materielId', 'string | number | null', '物料配置的物料ID；分类配置时为空', { nullable: true, nullMeaning: '该行是分类配置或后端未返回', constraints: idRules }),
    field('list[].materielName', 'string | null', '物料名称', { nullable: true, nullMeaning: '分类配置或后端未补齐名称' }),
    field('list[].materielCategoryId', 'string | number | null', '物料所属分类ID', { nullable: true, nullMeaning: '后端未返回' }),
    field('list[].materielCode', 'string | null', '物料编码；物料批量创建时作为展示快照提交', { nullable: true, nullMeaning: '分类配置或后端未返回' }),
    field('list[].standardUnitId', 'string | number | null', '涉及所在单元/组织ID', { nullable: true, nullMeaning: '后端未返回', constraints: idRules }),
    field('list[].standardUnitName', 'string | null', '涉及所在单元名称', { nullable: true, nullMeaning: '后端未补齐名称' }),
    field('list[].unit', 'string | null', '物料基本单位；分类配置时可能为空', { nullable: true, nullMeaning: '分类配置或后端未返回' }),
    field('list[].materielStatus', 'integer | null', '物料状态；页面只把1展示为正常', { nullable: true, nullMeaning: '分类配置或后端未返回' }),
    field('list[].batchEnabled', 'boolean', '是否开启批次管理；false时Portal才显示删除按钮'),
    field('list[].shelfLifeDays', 'integer | null', '保质期/临期天数；列表SQL当前不一定返回该列', { nullable: true, nullMeaning: '列表接口未返回' }),
    field('list[].updater', 'string | number | null', '最后修改人ID', { nullable: true, nullMeaning: '后端未返回', constraints: idRules }),
    field('list[].updaterName', 'string | null', '最后修改人名称', { nullable: true, nullMeaning: '后端未补齐名称' }),
    field('list[].updateTime', 'string | null', '最后修改时间原文', { nullable: true, nullMeaning: '后端未返回' }),
    field('total', 'integer', '符合物料名称和分类筛选的总条数'),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；权限、会话、网络或响应形状错误会抛出，不降级为空成功。',
}

const materialOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('list', 'object[]', '关键字命中的启用物料候选'),
    field('list[].id', 'string | number', '物料ID；按物料创建时作为materielId', { constraints: idRules }),
    field('list[].matCode', 'string | null', '物料编码；页面物料池使用它作为选择值', { nullable: true, nullMeaning: '后端未返回编码' }),
    field('list[].matName', 'string | null', '物料名称；页面选择器展示字段', { nullable: true, nullMeaning: '后端未返回名称' }),
    field('list[].unit', 'string | null', '物料基本单位；按物料创建时作为unit快照', { nullable: true, nullMeaning: '后端未返回单位' }),
    field('list[].categoryId', 'string | number | null', '物料分类ID；用于理解物料所属分类', { nullable: true, nullMeaning: '后端未返回分类', constraints: idRules }),
    field('list[].catNameCombination', 'string | null', '物料分类路径文本', { nullable: true, nullMeaning: '后端未返回分类路径' }),
    field('list[].label', 'string', 'SDK按Portal候选展示习惯生成的matName优先、matCode兜底文本'),
    field('total', 'integer', '关键字命中的候选总数'),
  ],
  empty: 'list=[]且total=0表示没有命中启用物料；不能把空候选当作物料ID缺省。',
}

const categoryOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', 'Portal批次配置分类选择器的五级物料分类树节点'),
    field('[].id', 'string | number', '物料分类ID；按分类创建时作为categoryId', { constraints: idRules }),
    field('[].catName', 'string | null', '后端分类名称', { nullable: true, nullMeaning: '后端未返回名称' }),
    field('[].name', 'string', '选择器使用的分类显示名称，优先取catName'),
    field('[].level', 'integer', '树层级；Portal组件按根节点为1重新计算'),
    field('[].children', 'object[]', '子分类节点，结构与根节点相同'),
  ],
  empty: '[]表示没有可选分类；不能自行拼接分类ID或把名称当ID。',
}

const unitOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', 'Portal涉及组织选择器的工厂组织树节点'),
    field('[].id', 'string | number', '组织/标准单元ID；提交时作为standardUnitId', { constraints: idRules }),
    field('[].name', 'string', '组织名称'),
    field('[].isFactory', 'integer | null', '后端工厂标记；Portal只允许数值1节点选择', { nullable: true, nullMeaning: '后端未返回标记' }),
    field('[].disabled', 'boolean', '按Portal规则派生；isFactory!==1时为true，不能提交disabled节点'),
    field('[].children', 'object[]', '子组织节点'),
  ],
  empty: '[]表示没有可见组织；不能用组织名称替代standardUnitId。',
}

const rowsOutput = (label: string, fields: AiField[]): AiContract['output'] => ({
  shape: '{ draft: object[] }',
  fields: [field('draft', 'object[]', label), ...fields.map(item => ({ ...item, path: `draft[].${item.path}` }))],
  empty: '行、ID、保质期或重复组合非法时抛错；用户取消时只丢弃draft，不发POST。',
})

const idDraftOutput: AiContract['output'] = {
  shape: '{ draft: { id: string | number } }',
  fields: [field('draft', 'object', '尚未执行的批次配置动作草稿'), field('draft.id', 'string | number', '批次配置业务ID；由列表行取得', { constraints: idRules })],
  empty: 'ID或当前状态非法时抛错；用户取消时不发写请求。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', 'Java CommonResult<Boolean>解包后的成功值true；仍需按ID回查列表确认终态')],
  empty: 'false或其它响应形状会抛错；不能把HTTP成功当作业务终态。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ test/portal/main: app/portal/menus/material.js、views/dashboard/material/store/batch-setting.vue、list.vue、[mode]/[id].vue、components/SelectMaterialCategory.vue、components/portal/material/material-select-table/table-dialog.vue、components/portal/material/tree-select/materiel-category/index.vue、components/portal/material/tree-select/unit/index.vue', kind: 'reference', note: '逐页核对菜单路径与权限、分页筛选、长物料池、五级分类树、工厂组织树、两种批量提交、启停请求体和仅关闭状态可删除规则。' },
  { source: 'CodeReview_Mall_Platform_Java @ test/test: AssetBatchConfigController、PageReqVO、SaveReqVO、RespVO、AssetBatchConfigServiceImpl、AssetBatchConfigMapper.xml、MaterielController、AssetDepreciationConfigController', kind: 'reference', note: '核对页面实际调用的批量端点、PUT query id + null body、DELETE query id、类型/重复校验、分类后代筛选、物料候选和分类树端点。' },
  { source: 'src/capabilities/inventory-asset-batch-config.ts、src/capabilities/invoke.ts 与 test/inventory-asset-batch-config.test.ts', kind: 'implementation', note: '锁定页面参数、长选项关键字保护、payload字段、启停/删除状态门禁、prepare→submit→cancel和坏输入/坏响应反证；不替代真实环境回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作Portal「物料 → 库存管理 → 批次配置」的分页列表、候选选择、按物料/分类新建、批次启停或删除。',
  boundaries: [
    '页面路径是/dashboard/material/store/batch-setting/list，页面权限是/dashboard/material/store/batch-setting；请求使用platform实例并发送module-type=34。',
    '列表实际GET /admin-api/inventory/asset-batch-config/page，公共列表参数为order=""、orderField=""、materielName、categoryId、pageNo、pageSize；categoryId由后端扩展自身及子分类，不要在调用方把名称或树位置当ID。',
    '物料池组件实际首次无关键字拉取全部status=1物料后本地筛选；这是长选项行为，SDK的searchMaterials要求keyword，并以matNameOrCoder交给同一分页接口，避免把全量候选加载进上下文。分类候选实际GET /admin-api/inventory/asset-depreciation-config/get-materiel-category-tree?level=5；涉及组织实际GET /admin-api/supply/organization/tree?isFactory=1&includeParents=1。',
    '按物料实际POST /admin-api/inventory/asset-batch-config/batch-create-materiel，按分类实际POST /admin-api/inventory/asset-batch-config/batch-create-materiel-category；端点在服务层分别补configType=1/2，页面payload不应自行添加configType。物料+组织或分类+组织重复行先在SDK拒绝。',
    '开启/关闭实际PUT对应enable-batch或disable-batch，body为null、id在query；删除实际DELETE /delete?id=...，且Portal只对batchEnabled=false显示删除。Java虽有通用create/update/get/export端点，但当前页面没有可达入口，不注册为本页面能力。',
  ],
  prerequisites: ['使用当前用户会话、tenant-id、module-type=34和页面权限创建SDK；物料ID、分类ID和组织ID必须来自当前可见候选/列表。', '所有写操作先prepare并保留用户确认的draft；用户取消只丢弃draft，不调用对应submit。'],
  failures: ['ID、分页、关键字、保质期、重复组合、状态门禁、权限、后端重复配置、网络或响应形状错误会抛出；不把空候选或HTTP成功降级为业务成功。'],
  evidence,
  gaps: ['已完成Portal/Java逐页静态核对与离线请求断言；尚未在真实测试环境执行本页两种create、启停、delete的prepare→submit→cancel、权限拒绝及逐条列表回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Inventory asset batch config contract has no definition: ${id}`)
  contracts[id] = value
}

const listInputs = {
  materielName: param('物料名称前缀筛选；省略时按Portal初始值发送null。', 'Portal列表物料名称输入框', { type: 'string', required: false, nullable: true, default: 'null' }),
  categoryId: param('物料分类ID；后端会匹配该分类及其子分类。', 'Portal五级物料分类树选中值', { type: 'string | number', required: false, nullable: true, constraints: idRules }),
  pageNo: param('页码，从1开始，默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
  pageSize: param('每页条数，页面支持10、20、50、100，默认20。', 'Portal分页状态', { type: 'integer', required: false, default: '20' }),
}

const materialRowFields = [
  field('materielId', 'string | number', '物料ID；来自searchMaterials.list[].id', { constraints: idRules }),
  field('materielCode', 'string', '物料编码快照；Portal从候选行的matCode填入，缺省按空字符串提交'),
  field('standardUnitId', 'string | number', '涉及组织/标准单元ID；来自unitTree中disabled=false的节点', { constraints: idRules }),
  field('standardUnitName', 'string', '涉及组织名称快照；Portal从组织选择器取label，缺省按空字符串提交'),
  field('unit', 'string', '物料基本单位快照；Portal从候选行的unit填入，缺省按空字符串提交'),
  field('shelfLifeDays', 'integer', '临期/保质期天数；Portal输入框允许0，SDK限制为大于等于0的整数', { unit: '天' }),
]
const categoryRowFields = [
  field('categoryId', 'string | number', '物料分类ID；来自materialCategoryTree中的节点', { constraints: idRules }),
  field('categoryName', 'string', '分类名称快照；Portal从分类节点name填入，缺省按空字符串提交'),
  field('standardUnitId', 'string | number', '涉及组织/标准单元ID；来自unitTree中disabled=false的节点', { constraints: idRules }),
  field('standardUnitName', 'string', '涉及组织名称快照；Portal从组织选择器取label，缺省按空字符串提交'),
  field('shelfLifeDays', 'integer', '临期/保质期天数；Portal输入框允许0，SDK限制为大于等于0的整数', { unit: '天' }),
]

add('inventory-asset-batch-config-list', base({ purpose: '读取当前用户可见的批次配置分页。', effect: 'read', inputs: listInputs, output: listOutput, consume: ['展示list；启停和删除只使用list[].id与list[].batchEnabled；物料/分类名称仅作展示。'], steps: [], completion: '得到符合物料名称和分类筛选的分页与总数。', idempotency: null }))
add('inventory-asset-batch-config-search-materials', base({ purpose: '按关键字搜索可用于按物料设置批次的启用物料候选。', effect: 'read', inputs: { keyword: param('物料名称或编码关键字，不能为空。', '调用方明确输入的搜索词', { type: 'string', required: true }), pageNo: param('页码，默认1。', '调用方分页状态', { type: 'integer', required: false, default: '1' }), pageSize: param('每页条数，默认20，最大500。', '调用方分页状态', { type: 'integer', required: false, default: '20' }) }, output: materialOutput, consume: ['把list[].id作为materielId；matCode、matName、unit是展示/快照字段，不能把label当ID。'], steps: [], completion: '得到关键字命中的启用物料候选分页。', idempotency: null }))
add('inventory-asset-batch-config-material-category-tree', base({ purpose: '读取批次配置分类选择器使用的五级物料分类树。', effect: 'read', inputs: {}, output: categoryOutput, consume: ['选中的节点id作为categoryId；name只作为categoryName快照。'], steps: [], completion: '得到分类树或明确的空树。', idempotency: null }))
add('inventory-asset-batch-config-unit-tree', base({ purpose: '读取批次配置涉及组织选择器的工厂组织树。', effect: 'read', inputs: {}, output: unitOutput, consume: ['只使用disabled=false（Portal即isFactory===1）的节点id作为standardUnitId，并使用name作为名称快照。'], steps: [], completion: '得到组织树及与Portal一致的disabled结果。', idempotency: null }))

add('inventory-asset-batch-config-prepare-create-materiel', base({ purpose: '按Portal单物料模式校验并准备批量创建草稿。', effect: 'prepare', inputs: { rows: param('一行一个物料+组织组合；每行必须有物料ID、组织ID和非负整数天数。', 'searchMaterials、unitTree和用户填写的表格行', { type: 'object[]', required: true }) }, output: rowsOutput('按Portal batch-create-materiel payload整理的物料草稿。', materialRowFields), consume: ['用户确认后把result.draft原样交给createMateriel；取消只丢弃草稿。'], steps: [{ role: 'required', when: '用户确认按物料新建', capabilityId: 'inventory-asset-batch-config-create-materiel', mapping: { draft: 'result.draft' }, instruction: '提交同一draft；成功或超时后按物料ID+组织ID回查列表。' }, { role: 'cancel', when: '用户取消', instruction: '丢弃draft，不调用createMateriel。' }], completion: '得到至少一行、无重复物料+组织组合的尚未写入草稿。', idempotency: null }))
add('inventory-asset-batch-config-create-materiel', base({ purpose: '按物料批量创建批次配置。', effect: 'write', inputs: { draft: param('prepareCreateMateriel返回的draft。', 'inventory-asset-batch-config-prepare-create-materiel.result.draft', { type: 'object[]', required: true }), 'draft[].materielId': param('草稿中的物料ID，用于逐行回查。', 'inventory-asset-batch-config-prepare-create-materiel.result.draft[].materielId', { type: 'string | number', required: true, constraints: idRules }), 'draft[].standardUnitId': param('草稿中的组织ID，用于逐行回查。', 'inventory-asset-batch-config-prepare-create-materiel.result.draft[].standardUnitId', { type: 'string | number', required: true, constraints: idRules }) }, output: trueOutput, consume: ['严格POST /admin-api/inventory/asset-batch-config/batch-create-materiel；返回true后按每个materielId+standardUnitId回查，不能只依据HTTP成功。'], steps: [{ role: 'required', when: '请求返回true或超时', capabilityId: 'inventory-asset-batch-config-list', mapping: {}, instruction: '按返回草稿中的物料和组织逐条定位并核对batchEnabled、materielCode、unit、shelfLifeDays（若列表返回）。超时先回查，不盲目重建。' }], completion: '返回true且每个草稿组合都在列表回查中确认。', idempotency: '后端没有requestId；重复组合会被拒绝，超时先回查。' }))
add('inventory-asset-batch-config-prepare-create-category', base({ purpose: '按Portal分类模式校验并准备批量创建草稿。', effect: 'prepare', inputs: { rows: param('一行一个分类+组织组合；每行必须有分类ID、组织ID和非负整数天数。', 'materialCategoryTree、unitTree和用户填写的表格行', { type: 'object[]', required: true }) }, output: rowsOutput('按Portal batch-create-materiel-category payload整理的分类草稿。', categoryRowFields), consume: ['用户确认后把result.draft原样交给createCategory；取消只丢弃草稿。'], steps: [{ role: 'required', when: '用户确认按分类新建', capabilityId: 'inventory-asset-batch-config-create-category', mapping: { draft: 'result.draft' }, instruction: '提交同一draft；成功或超时后按分类ID+组织ID回查列表。' }, { role: 'cancel', when: '用户取消', instruction: '丢弃draft，不调用createCategory。' }], completion: '得到至少一行、无重复分类+组织组合的尚未写入草稿。', idempotency: null }))
add('inventory-asset-batch-config-create-category', base({ purpose: '按物料分类批量创建批次配置。', effect: 'write', inputs: { draft: param('prepareCreateCategory返回的draft。', 'inventory-asset-batch-config-prepare-create-category.result.draft', { type: 'object[]', required: true }), 'draft[].categoryId': param('草稿中的分类ID，用于逐行回查。', 'inventory-asset-batch-config-prepare-create-category.result.draft[].categoryId', { type: 'string | number', required: true, constraints: idRules }), 'draft[].standardUnitId': param('草稿中的组织ID，用于逐行回查。', 'inventory-asset-batch-config-prepare-create-category.result.draft[].standardUnitId', { type: 'string | number', required: true, constraints: idRules }) }, output: trueOutput, consume: ['严格POST /admin-api/inventory/asset-batch-config/batch-create-materiel-category；端点由服务层补configType=2。返回true后按每个categoryId+standardUnitId回查。'], steps: [{ role: 'required', when: '请求返回true或超时', capabilityId: 'inventory-asset-batch-config-list', mapping: {}, instruction: '按每个分类和组织逐条定位并核对batchEnabled及名称快照；超时先回查，不盲目重建。' }], completion: '返回true且每个分类+组织组合都在列表回查中确认。', idempotency: '后端没有requestId；重复组合会被拒绝，超时先回查。' }))

const toggleInput = (target: string) => ({ id: param('批次配置业务ID。', 'inventory-asset-batch-config-list.list[].id', { type: 'string | number', required: true, constraints: idRules }), currentBatchEnabled: param(`列表当前batchEnabled必须为${target === '开启' ? 'false' : 'true'}；这是Portal按钮的当前状态，不是目标状态。`, 'inventory-asset-batch-config-list.list[].batchEnabled', { type: 'boolean', required: true }) })
const toggleContract = (name: string, target: boolean, prepareId: string, submitId: string): void => {
  const action = target ? '开启' : '关闭'
  add(prepareId, base({ purpose: `准备${action}一条批次配置的批次管理。`, effect: 'prepare', inputs: toggleInput(action), output: idDraftOutput, consume: [`用户确认后把result.draft交给${target ? 'enableBatch' : 'disableBatch'}；取消只丢弃草稿。`], steps: [{ role: 'required', when: `用户确认${action}`, capabilityId: submitId, mapping: { draft: 'result.draft' }, instruction: `提交同一ID；成功或超时后list回查batchEnabled=${String(target)}。` }, { role: 'cancel', when: '用户取消', instruction: `丢弃draft，不调用${target ? 'enableBatch' : 'disableBatch'}。` }], completion: `得到尚未执行的${action}草稿。`, idempotency: null }))
  add(submitId, base({ purpose: `${action}一条批次配置的批次管理。`, effect: 'write', inputs: { draft: param(`${name}返回的ID草稿。`, `${prepareId}.result`, { type: 'object', required: true }) }, output: trueOutput, consume: [`严格PUT /admin-api/inventory/asset-batch-config/${target ? 'enable-batch' : 'disable-batch'}，body为null、id在query；返回true或超时后按ID回查。`], steps: [{ role: 'required', when: '请求返回true或超时', capabilityId: 'inventory-asset-batch-config-list', mapping: {}, instruction: `刷新列表并按同一ID确认batchEnabled=${String(target)}；不要把接口回执直接当作终态。` }], completion: `返回true且列表确认目标ID的batchEnabled=${String(target)}。`, idempotency: '启停写绝对目标状态；超时先按ID回查，不盲目重放。' }))
}
toggleContract('prepareEnableBatch', true, 'inventory-asset-batch-config-prepare-enable-batch', 'inventory-asset-batch-config-enable-batch')
toggleContract('prepareDisableBatch', false, 'inventory-asset-batch-config-prepare-disable-batch', 'inventory-asset-batch-config-disable-batch')

add('inventory-asset-batch-config-prepare-remove', base({ purpose: '准备删除一条已关闭批次管理的配置。', effect: 'prepare', inputs: { id: param('批次配置业务ID。', 'inventory-asset-batch-config-list.list[].id', { type: 'string | number', required: true, constraints: idRules }), batchEnabled: param('列表当前状态；必须为false，因为Portal开启状态不显示删除按钮。', 'inventory-asset-batch-config-list.list[].batchEnabled', { type: 'boolean', required: true }) }, output: idDraftOutput, consume: ['用户确认后把result.draft交给remove；取消只丢弃草稿。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'inventory-asset-batch-config-remove', mapping: { draft: 'result.draft' }, instruction: '提交同一ID；成功或超时后list确认该ID消失。' }, { role: 'cancel', when: '用户取消', instruction: '不调用remove。' }], completion: '得到尚未执行的删除草稿。', idempotency: null }))
add('inventory-asset-batch-config-remove', base({ purpose: '删除一条Portal允许删除的批次配置。', effect: 'write', inputs: { draft: param('prepareRemove返回的ID草稿。', 'inventory-asset-batch-config-prepare-remove.result', { type: 'object', required: true }) }, output: trueOutput, consume: ['严格DELETE /admin-api/inventory/asset-batch-config/delete?id=...；返回true或超时后确认目标ID不再出现。'], steps: [{ role: 'required', when: '请求返回true或超时', capabilityId: 'inventory-asset-batch-config-list', mapping: {}, instruction: '刷新列表并确认同一ID已消失；若后端报错，报告失败，不绕过批次状态规则。' }], completion: '返回true且列表回查确认目标ID已删除。', idempotency: '删除不可恢复；超时先回查，不盲目重试。' }))

export const INVENTORY_ASSET_BATCH_CONFIG_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(INVENTORY_ASSET_BATCH_CONFIG_METHODS).map(id => [id, contracts[id]!]))
export const INVENTORY_ASSET_BATCH_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INVENTORY_ASSET_BATCH_CONFIG_METHODS).map(([id, method]) => [`inventoryAssetBatchConfig.${method}`, INVENTORY_ASSET_BATCH_CONFIG_AI_CONTRACTS[id]!]))
