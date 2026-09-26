import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_QUERY_PERMISSION,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_QUERY_PERMISSION,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHODS,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PERMISSION,
  productBusinessSetupMaterialCodeCapabilities,
  PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIALS,
} from '../capabilities/product-business-setup-material-code.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => param(meaning, source, { required: false, omitted, ...extra })
const definitions = new Map(productBusinessSetupMaterialCodeCapabilities.map(definition => [definition.id, definition]))
const idRules = ['安全正整数或非空业务ID字符串；长ID保留字符串', '不能用展示名称、行号或materialDescription代替ID']

const materialFields = (prefix: string): AiField[] => PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIALS.flatMap(item => [
  field(`${prefix}${item.prop}Name`, 'string', `${item.label}展示名称；由Portal提交时固定写入字段名。`, { nullable: true, nullMeaning: '后端没有返回该物料展示名称。' }),
  field(`${prefix}${item.prop}MaterialId`, 'string | number', `${item.label}物料主键；编辑回填和提交使用。`, { nullable: true, nullMeaning: '当前配置没有选择该物料。', constraints: idRules }),
  field(`${prefix}${item.prop}RowId`, 'string | number', `${item.label}配置行ID；更新已有配置时用于定位行。`, { nullable: true, nullMeaning: '当前配置尚未生成该类别的物料配置行。', constraints: idRules }),
])

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '物料配置记录ID；仅作为编辑回填上下文，页面没有删除动作。', { optional: true, nullable: true, nullMeaning: '列表分组结果没有配置主记录ID。', constraints: idRules }),
  field('list[].farm', 'string | number', '蛋鸡场筛选值。', { optional: true, nullable: true, nullMeaning: '后端未返回蛋鸡场筛选值。', constraints: idRules }),
  field('list[].farmId', 'string | number', '蛋鸡场ID；批量设置提交的上下文。', { optional: true, nullable: true, nullMeaning: '后端未返回蛋鸡场ID。', constraints: idRules }),
  field('list[].farmName', 'string', '蛋鸡场展示名称。', { optional: true, nullable: true, nullMeaning: '后端未返回蛋鸡场名称。' }),
  field('list[].building', 'string | number', '栋号；批次设置页面回填上下文。', { optional: true, nullable: true, nullMeaning: '批量设置结果不承载栋号。', constraints: idRules }),
  field('list[].batch', 'string', '批次号；批次设置列表显示和编辑回填。', { optional: true, nullable: true, nullMeaning: '后端未返回批次号。' }),
  field('list[].startDate', 'string', '批次筛选开始日期，原值字符串。', { optional: true, nullable: true, nullMeaning: '批量设置结果不承载日期。', format: 'YYYY-MM-DD' }),
  field('list[].endDate', 'string', '批次筛选结束日期，原值字符串。', { optional: true, nullable: true, nullMeaning: '批量设置结果不承载日期。', format: 'YYYY-MM-DD' }),
  field('list[].variety', 'string | number', '品种编码。', { optional: true, nullable: true, nullMeaning: '后端未返回品种编码。', constraints: idRules }),
  field('list[].varietyName', 'string', '品种展示名称。', { optional: true, nullable: true, nullMeaning: '后端未返回品种名称。' }),
  field('list[].line', 'string | number', '品系编码。', { optional: true, nullable: true, nullMeaning: '后端未返回品系编码。', constraints: idRules }),
  field('list[].lineName', 'string', '品系展示名称。', { optional: true, nullable: true, nullMeaning: '后端未返回品系名称。' }),
  field('list[].gen', 'string | number', '代次编码。', { optional: true, nullable: true, nullMeaning: '后端未返回代次编码。', constraints: idRules }),
  field('list[].genName', 'string', '代次展示名称。', { optional: true, nullable: true, nullMeaning: '后端未返回代次名称。' }),
  ...materialFields('list[].'),
]

const draftFields: AiField[] = [
  field('draft', 'object', '经过Portal物料号弹窗整理、尚未发送POST的提交草稿。'),
  field('draft.id', 'string | number', '已有配置行或分组记录ID；新建时省略。', { optional: true, nullable: true, nullMeaning: '新建或当前弹窗没有主记录ID。', constraints: idRules }),
  field('draft.farmId', 'string | number', '批量设置的蛋鸡场ID；批量模式发送，批次模式不发送。', { optional: true, nullable: true, nullMeaning: '批次模式不包含该字段。', constraints: idRules }),
  field('draft.flockGroupId', 'string | number', '批次所属鸡群组ID；批次模式发送，批量模式不发送。', { optional: true, nullable: true, nullMeaning: '批量模式不包含该字段。', constraints: idRules }),
  field('draft.gen', 'string | number', '批量设置的代次编码。', { optional: true, nullable: true, nullMeaning: '批次模式不包含该字段。', constraints: idRules }),
  field('draft.variety', 'string | number', '批量设置的品种编码。', { optional: true, nullable: true, nullMeaning: '批次模式不包含该字段。', constraints: idRules }),
  field('draft.line', 'string | number', '批量设置的品系编码。', { optional: true, nullable: true, nullMeaning: '批次模式不包含该字段。', constraints: idRules }),
  ...PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_MATERIALS.flatMap(item => [
    field(`draft.${item.prop}Name`, 'string', `${item.label}名称；Portal固定为该标签。`),
    field(`draft.${item.prop}RowId`, 'string | number', `${item.label}已有配置行ID；有值时后端更新该行。`, { nullable: true, nullMeaning: '没有已有配置行。', constraints: idRules }),
    field(`draft.${item.prop}MaterialId`, 'string | number', `${item.label}物料ID；空字符串表示Portal没有选择物料。`, { nullable: true, nullMeaning: '没有选择物料；提交值是空字符串。', constraints: idRules }),
  ]),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [field('$', 'object', '批量设置物料号分页结果。'), field('list', 'array', '当前页配置分组记录。'), field('list[]', 'object', '一条配置分组记录。'), ...rowFields, field('total', 'integer', '符合蛋鸡场、品种、品系、代次筛选的总数。')],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、网络或响应结构错误会抛出，不降级为空页。',
}

const batchListOutput: AiContract['output'] = {
  shape: 'array',
  fields: [field('$', 'array', '批次物料配置列表。'), field('[]', 'object', '一条批次物料配置记录。'), ...rowFields.map(item => ({ ...item, path: item.path.replace('list[]', '[]') }))],
  empty: '[]表示该flockGroupId和batch没有配置记录；请求或响应结构错误会抛出。',
}

const optionsOutput = (name: string, fields: AiField[]): AiContract['output'] => ({ shape: 'array', fields: [field('$', 'array', name), field('[]', 'object', `一个${name}候选。`), ...fields], empty: `[]表示Portal当前没有可见${name}；权限、网络或坏响应会抛出。` })
const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'true', '请求未抛错后的本地成功确认。')], empty: 'true不代表页面已回查确认配置；请求、权限或后端业务错误会抛出。' }

const commonBoundaries = [
  `页面路径是${PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH}，路由权限是${PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PERMISSION}；批量查询按钮权限是${PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_QUERY_PERMISSION}，批次查询按钮权限是${PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_QUERY_PERMISSION}。Portal把创建按钮权限代码注释掉，因此页面实际始终显示创建/修改入口；SDK不臆造创建按钮权限。`,
  '所有请求使用Portal product HTTP实例并补devicetype=PC；页面没有可推导的module-type，因此不发送module-type。',
  '批量页和批次页共享一个farmMaterialSubmit接口，但提交体不同：批量模式发送farmId、gen、variety、line；批次模式只发送flockGroupId；两种模式都发送14类物料的Name、RowId和MaterialId键。',
  '物料候选由弹窗mounted时按14个固定description逐个GET /consumeMaterial/getMaterialList；SDK只提供单个description查询，不把14个请求伪装成一个页面不存在的批量接口。',
  '后端存在/base/setupMaterialCode/delete，但两个Portal子页没有删除按钮或调用；SDK不登记删除能力。',
]

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:82651c98c5 app/portal/views/dashboard/product/setting/business-manage/setup-material-code/list.vue、setup-material-code-farm.vue、setup-material-code-batch.vue、modal-form-content.vue', kind: 'reference', note: '证明两个Tab、筛选必填规则、14类物料、候选联动、列表、表单提交键和按钮可见性；未启动浏览器。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:998ce8223fa SetupMaterialCodeController、SetupMaterialCodeListVO、SetupMaterialCodeListDTO、SetupMaterialCodeServiceImpl', kind: 'reference', note: '证明flockSimu/base/setupMaterialCode下的列表、联动查询、物料提交和服务端默认代次/品种/品系规则。' },
  { source: 'src/capabilities/product-business-setup-material-code.ts', kind: 'implementation', note: '锁定页面请求、14类物料提交、响应解包、product上下文和不登记删除的边界。' },
  { source: 'test/product-business-setup-material-code.test.ts', kind: 'test', note: '离线锁定页面源码、Java端点、参数、提交体、坏输入和AI契约结构；不替代真实冒烟。' },
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-business-setup-material-code-', '')
  if (suffix === 'farm-list') return {
    farm: optional('蛋鸡场筛选值', '页面批量设置表单', 'SDK发送空字符串，不限制蛋鸡场', { type: 'string | number', nullable: true, constraints: idRules }),
    variety: optional('品种筛选值', '页面品种字典选择器', 'SDK发送空字符串', { type: 'string | number', nullable: true, constraints: idRules }),
    line: optional('品系筛选值', '页面品系字典选择器', 'SDK发送空字符串', { type: 'string | number', nullable: true, constraints: idRules }),
    gen: optional('代次筛选值', '页面代次字典选择器', 'SDK发送空字符串', { type: 'string | number', nullable: true, constraints: idRules }),
    pageNo: optional('从1开始的页码', 'Portal分页状态', 'SDK默认1', { type: 'integer' }),
    pageSize: optional('每页条数', 'Portal分页状态', 'SDK默认20；只支持10、20、50、100', { type: '10 | 20 | 50 | 100' }),
  }
  if (suffix === 'batch-list' || suffix === 'batch-material') return {
    flockGroupId: param('批次所属鸡群组ID，不是批次显示文本', 'batch-options.result[].groupId', { type: 'string | number', constraints: idRules }),
    batch: param('批次号；用于后端筛选', 'batch-options.result[].batch', { type: 'string' }),
  }
  if (suffix === 'building-options') return { farmId: param('蛋鸡场ID', '用户选择的蛋鸡场', { type: 'string | number', constraints: idRules }) }
  if (suffix === 'batch-options') return {
    farm: optional('蛋鸡场筛选值', '批次设置表单', 'SDK发送空字符串', { type: 'string | number', nullable: true, constraints: idRules }),
    building: optional('栋号筛选值', '蛋鸡场联动栋号选择器', 'SDK发送空字符串', { type: 'string | number', nullable: true, constraints: idRules }),
    startDate: optional('批次开始日期', '页面日期选择器', 'SDK发送空字符串', { type: 'string', format: 'YYYY-MM-DD' }),
    endDate: optional('批次结束日期', '页面日期选择器', 'SDK发送空字符串', { type: 'string', format: 'YYYY-MM-DD' }),
  }
  if (suffix === 'material-options') return { description: param('物料类别描述', '页面固定的14个material.description值', { type: 'string', constraints: ['不能为空；不要传展示标签替代固定description'] }) }
  if (suffix === 'farm-material') return {
    farm: optional('蛋鸡场筛选值', '批量设置物料号弹窗', 'SDK发送空字符串', { type: 'string | number', nullable: true, constraints: idRules }),
    variety: optional('品种筛选值', '批量设置物料号弹窗', 'SDK发送空字符串', { type: 'string | number', nullable: true, constraints: idRules }),
    line: optional('品系筛选值', '批量设置物料号弹窗', 'SDK发送空字符串', { type: 'string | number', nullable: true, constraints: idRules }),
    gen: optional('代次筛选值', '批量设置物料号弹窗', 'SDK发送空字符串', { type: 'string | number', nullable: true, constraints: idRules }),
  }
  if (suffix === 'prepare-farm-submit' || suffix === 'prepare-batch-submit') return {
    form: param('Portal物料号弹窗表单；包含14类物料的MaterialId/RowId，批量模式还包含farmId、gen、variety、line，批次模式包含flockGroupId', '用户确认的页面表单', { type: 'object', constraints: ['取消时只丢弃草稿，不调用submit'] }),
  }
  if (suffix === 'farm-submit' || suffix === 'batch-submit') return {
    draft: param('对应prepare能力返回的完整draft；不要自行补充另一种模式的上下文字段', `productBusinessSetupMaterialCode.${suffix.startsWith('farm') ? 'prepareFarmSubmit' : 'prepareBatchSubmit'}.result.draft`, { type: 'object' }),
  }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-business-setup-material-code-', '')
  const isFarmList = suffix === 'farm-list'
  const isBatchList = suffix === 'batch-list'
  const isBuilding = suffix === 'building-options'
  const isBatchOptions = suffix === 'batch-options'
  const isMaterialOptions = suffix === 'material-options'
  const isFarmMaterial = suffix === 'farm-material'
  const isBatchMaterial = suffix === 'batch-material'
  const isPrepareFarm = suffix === 'prepare-farm-submit'
  const isPrepareBatch = suffix === 'prepare-batch-submit'
  const isFarmSubmit = suffix === 'farm-submit'
  const isBatchSubmit = suffix === 'batch-submit'
  const isRead = isFarmList || isBatchList || isBuilding || isBatchOptions || isMaterialOptions || isFarmMaterial || isBatchMaterial
  const steps: AiContract['steps'] = []
  if (isPrepareFarm || isPrepareBatch) {
    steps.push({ role: 'required', when: '用户确认提交物料号草稿', capabilityId: isPrepareFarm ? 'product-business-setup-material-code-farm-submit' : 'product-business-setup-material-code-batch-submit', mapping: { draft: 'result.draft' }, instruction: '把result.draft原样交给对应submit；不要跨模式改写或混入另一种页面上下文。' })
    steps.push({ role: 'cancel', when: '用户取消物料号弹窗', instruction: '丢弃本地draft，不发POST；Portal没有取消接口。' })
  }
  if (isFarmSubmit || isBatchSubmit) {
    steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: isFarmSubmit ? 'product-business-setup-material-code-farm-list' : 'product-business-setup-material-code-batch-list', mapping: {}, instruction: '按draft中的蛋鸡场筛选值或flockGroupId与batch重新查询，核对14类物料MaterialId；true只表示请求未抛错。' })
  }
  let output: AiContract['output']
  if (isFarmList) output = listOutput
  else if (isBatchList) output = batchListOutput
  else if (isBuilding) output = optionsOutput('栋号', [field('[].id', 'string | number', '栋号ID', { constraints: idRules }), field('[].shortName', 'string | null', '栋号短名称', { nullable: true, nullMeaning: '后端未返回短名称。' }), field('[].label', 'string | null', 'SDK映射的下拉展示值，等于shortName。', { nullable: true, nullMeaning: 'shortName为空。' }), field('[].value', 'string | number', 'SDK映射的下拉提交值，等于id。', { constraints: idRules })])
  else if (isBatchOptions) output = optionsOutput('批次', [field('[].groupId', 'string | number', '批次所属鸡群组ID', { nullable: true, nullMeaning: '后端没有鸡群组ID。', constraints: idRules }), field('[].batch', 'string | null', '批次号', { nullable: true, nullMeaning: '后端没有批次号。' }), field('[].label', 'string | null', 'SDK映射的下拉展示值，等于batch。', { nullable: true, nullMeaning: 'batch为空。' }), field('[].value', 'string | null', 'SDK映射的下拉提交值，等于batch。', { nullable: true, nullMeaning: 'batch为空。' })])
  else if (isMaterialOptions) output = optionsOutput('物料', [field('[].id', 'string | number', '物料ID；提交MaterialId使用。', { constraints: idRules }), field('[].materialDescription', 'string | null', '物料描述。', { nullable: true, nullMeaning: '后端没有物料描述。' }), field('[].label', 'string | null', 'SDK映射的下拉展示值，等于materialDescription。', { nullable: true, nullMeaning: 'materialDescription为空。' }), field('[].value', 'string | number', 'SDK映射的下拉提交值，等于id。', { constraints: idRules })])
  else if (isFarmMaterial || isBatchMaterial) output = { shape: 'object | null', fields: [field('$', 'object | null', '当前筛选条件对应的物料配置；null表示没有已保存配置。', { nullable: true, nullMeaning: 'Portal后端返回SetupMaterialCodeListDTO=null。' }), ...rowFields.map(item => ({ ...item, path: item.path.replace('list[].', '') }))], empty: 'null表示没有已保存配置，不是请求失败；请求或响应结构错误会抛出。' }
  else if (isPrepareFarm || isPrepareBatch) output = { shape: '{ draft: object }', fields: draftFields, empty: '字段类型非法时抛出且不发请求；取消只丢弃draft。' }
  else output = trueOutput

  return {
    purpose: isFarmList ? '按蛋鸡场、品种、品系、代次分页查询批量设置物料号。' : isBatchList ? '按鸡群组和批次查询批次设置物料号。' : isBuilding ? '查询所选蛋鸡场的栋号候选。' : isBatchOptions ? '按蛋鸡场、栋号和日期范围查询可选批次。' : isMaterialOptions ? '查询一个物料类别的下拉候选。' : isFarmMaterial ? '查询批量设置物料号弹窗的既有配置。' : isBatchMaterial ? '查询批次设置物料号弹窗的既有配置。' : isPrepareFarm ? '准备批量设置物料号的本地提交草稿。' : isPrepareBatch ? '准备批次设置物料号的本地提交草稿。' : isFarmSubmit ? '提交批量设置物料号表单。' : '提交批次设置物料号表单。',
    whenToUse: `需要在${PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_PAGE_PATH}页面执行${isRead ? '查询或加载候选' : '物料号提交'}时使用；批量模式和批次模式不可混用。`,
    boundaries: commonBoundaries,
    effect: isRead ? 'read' : isPrepareFarm || isPrepareBatch ? 'prepare' : 'write',
    prerequisites: ['使用当前用户、当前租户的会话token，并在对应页面上下文中调用product实例。', ...(isFarmSubmit || isPrepareFarm ? [`批量查询权限由Portal代码使用${PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_FARM_QUERY_PERMISSION}控制。`] : []), ...(isBatchSubmit || isPrepareBatch ? [`批次查询权限由Portal代码使用${PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_BATCH_QUERY_PERMISSION}控制。`] : [])],
    inputs: inputFor(id),
    output,
    consume: isFarmList ? ['按total分页；编辑时保留行中的14类MaterialId/RowId和farmId、variety、line、gen。'] : isBatchList ? ['列表无独立分页；保留每行的flockGroupId、batch和14类MaterialId/RowId用于编辑。'] : isBuilding ? ['用value填充栋号选择器；不要把shortName提交成building ID。'] : isBatchOptions ? ['用value填充批次选择器，用groupId作为batchList和batchMaterial的flockGroupId。'] : isMaterialOptions ? ['用value提交对应MaterialId，用label展示；14个固定description需分别查询。'] : isFarmMaterial || isBatchMaterial ? ['把非空MaterialId回填到弹窗；把RowId保留到提交草稿，不能用MaterialId替代RowId。'] : isPrepareFarm || isPrepareBatch ? ['展示draft供用户确认；取消只丢弃draft。'] : ['提交成功后按页面筛选重新查询，逐项核对14类MaterialId；不要把true解释为业务已回查确认。'],
    steps,
    completion: isRead ? '返回页面实际消费的列表、配置或候选数据。' : isPrepareFarm || isPrepareBatch ? '得到未产生服务端副作用的本地草稿。' : 'POST未抛错且后续查询核对到物料配置；POST成功本身不证明每类物料已落库。',
    failures: ['表单类型、ID、分页、权限、网络或Java业务错误会抛出；不把错误响应降级为空列表或假成功。', ...(isFarmSubmit || isBatchSubmit ? ['响应不确定时先重新查询，不自动重放POST；后端没有requestId幂等包装。'] : [])],
    idempotency: isRead || isPrepareFarm || isPrepareBatch ? null : '后端提交没有requestId；重复POST可能更新或新增14类配置行。超时先按原上下文回查，再决定是否重试。',
    evidence,
  }
}

const contracts = Object.fromEntries(productBusinessSetupMaterialCodeCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`设置蛋鸡场物料号契约没有对应能力定义：${id}`)

export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_BUSINESS_SETUP_MATERIAL_CODE_METHODS).map(([id, method]) => [
    `productBusinessSetupMaterialCode.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productBusinessSetupMaterialCode.${method}；写操作遵循prepare→submit→回查，取消不发请求。`] },
  ]),
)
