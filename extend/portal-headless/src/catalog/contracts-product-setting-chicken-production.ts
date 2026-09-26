import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_CHICKEN_PRODUCTION_METHODS,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_PERMISSION,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_QUERY_PERMISSION,
  PRODUCT_SETTING_CHICKEN_PRODUCTION_SUBMIT_PERMISSION,
  productSettingChickenProductionCapabilities,
} from '../capabilities/product-setting-chicken-production.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingChickenProductionCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const rowFields: AiField[] = [
  field('$', 'object', '种鸡生产指标标准分页结果；list是当前页，total是筛选条件下的总记录数。'),
  field('list', 'array', '当前页的种鸡生产指标标准记录。'),
  field('list[]', 'object', '种鸡生产指标标准列表行；SDK保留Java返回的其他扩展字段。'),
  field('list[].id', 'string | number | null', '记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回可用ID，不能安全编辑或删除。' }),
  field('list[].year', 'number | null', '年度。', { nullable: true, nullMeaning: '后端没有返回年度。' }),
  field('list[].moulting', 'integer | null', '是否换羽：0非换羽，1换羽。', { nullable: true, values: { '0': '非换羽', '1': '换羽' }, nullMeaning: '后端没有返回换羽标志。' }),
  field('list[].weekAge', 'number | null', '周龄。', { nullable: true, nullMeaning: '后端没有返回周龄。' }),
  field('list[].gen', 'string | null', '代次字典值。', { nullable: true, nullMeaning: '后端没有返回代次。' }),
  field('list[].variety', 'string | null', '品种字典值。', { nullable: true, nullMeaning: '后端没有返回品种。' }),
  field('list[].line', 'string | null', '品系字典值。', { nullable: true, nullMeaning: '后端没有返回品系。' }),
  field('list[].lineVer', 'string | null', '品系版本；Java实体字段是字符串。', { nullable: true, nullMeaning: '后端没有返回品系版本。' }),
  ...[
    ['layingRate', '产蛋率'],
    ['passRate', '合格率'],
    ['fertilityRate', '受精率'],
    ['maleDeathsRate', '公鸡死亡率'],
    ['femaleDeathsRate', '母鸡死亡率'],
    ['maleDeathEliminationRate', '公鸡死淘率'],
    ['femaleDeathEliminationRate', '母鸡死淘率'],
    ['maleEliminationRate', '公鸡淘汰率'],
    ['femaleEliminationRate', '母鸡淘汰率'],
  ].map(([name, label]) => field(`list[].${name}`, 'number | null', `${label}；ChickenProductionController列表响应已把数据库比例小数乘以100，SDK返回服务端响应值，例如82表示82个百分点。`, { nullable: true, unit: '百分数值', nullMeaning: `后端没有返回${label}。` })),
  field('list[].femaleWeight', 'number | null', '母鸡体重；服务端原始数值，不做百分比换算。', { nullable: true, nullMeaning: '后端没有返回母鸡体重。' }),
  field('list[].evennessDegree', 'number | null', '均匀度；服务端原始数值。', { nullable: true, nullMeaning: '后端没有返回均匀度。' }),
  field('list[].femaleTibiaLength', 'number | null', '母鸡体尺；服务端原始数值。', { nullable: true, nullMeaning: '后端没有返回母鸡体尺。' }),
  field('list[].dailyConsumption', 'number | null', '日耗料；服务端原始数值。', { nullable: true, nullMeaning: '后端没有返回日耗料。' }),
  field('list[].maleWeight', 'number | null', '公鸡体重；服务端原始数值。', { nullable: true, nullMeaning: '后端没有返回公鸡体重。' }),
  field('list[].maleTibiaLength', 'number | null', '公鸡体尺；服务端原始数值。', { nullable: true, nullMeaning: '后端没有返回公鸡体尺。' }),
  field('list[].eggWeight', 'number | null', '蛋重；服务端原始数值。', { nullable: true, nullMeaning: '后端没有返回蛋重。' }),
  field('total', 'integer', '筛选条件下的记录总数，不是当前页长度。'),
]

const draftFields: AiField[] = [
  field('$', 'object', '通过Portal弹窗必填项和输入范围校验、尚未发送请求的保存草稿。'),
  field('draft', 'object', '保存请求体；率字段已从弹窗百分数除以100，变成Java数据库比例小数。'),
  field('draft.year', 'number', '年度；Portal必填，范围-10000000至10000000。'),
  field('draft.moulting', 'integer', '是否换羽：0非换羽，1换羽。'),
  field('draft.weekAge', 'number', '周龄；Portal必填，范围-10000000至10000000。'),
  field('draft.gen', 'string | null', '代次字典值；可为空。', { nullable: true, nullMeaning: '未选择代次。' }),
  field('draft.variety', 'string | null', '品种字典值；可为空。', { nullable: true, nullMeaning: '未选择品种。' }),
  field('draft.line', 'string | null', '品系字典值；可为空。', { nullable: true, nullMeaning: '未选择品系。' }),
  field('draft.lineVer', 'number | null', '品系版本；Portal输入限制为1至10000000的整数，可为空。', { nullable: true, nullMeaning: '未填写品系版本。' }),
  ...[
    ['layingRate', '产蛋率'],
    ['passRate', '合格率'],
    ['fertilityRate', '受精率'],
    ['maleDeathsRate', '公鸡死亡率'],
    ['femaleDeathsRate', '母鸡死亡率'],
    ['maleDeathEliminationRate', '公鸡死淘率'],
    ['femaleDeathEliminationRate', '母鸡死淘率'],
    ['maleEliminationRate', '公鸡淘汰率'],
    ['femaleEliminationRate', '母鸡淘汰率'],
  ].map(([name, label]) => field(`draft.${name}`, 'number | null', `${label}；弹窗按百分数输入，提交草稿按Portal规则除以100，例如82变为0.82。`, { nullable: true, unit: '比例小数', nullMeaning: `未填写${label}。` })),
  field('draft.femaleWeight', 'number | null', '母鸡体重；服务端原始数值。', { nullable: true, nullMeaning: '未填写母鸡体重。' }),
  field('draft.evennessDegree', 'number | null', '均匀度；服务端原始数值。', { nullable: true, nullMeaning: '未填写均匀度。' }),
  field('draft.femaleTibiaLength', 'number | null', '母鸡体尺；服务端原始数值。', { nullable: true, nullMeaning: '未填写母鸡体尺。' }),
  field('draft.dailyConsumption', 'number | null', '日耗料；服务端原始数值。', { nullable: true, nullMeaning: '未填写日耗料。' }),
  field('draft.maleWeight', 'number | null', '公鸡体重；服务端原始数值。', { nullable: true, nullMeaning: '未填写公鸡体重。' }),
  field('draft.maleTibiaLength', 'number | null', '公鸡体尺；服务端原始数值。', { nullable: true, nullMeaning: '未填写公鸡体尺。' }),
  field('draft.eggWeight', 'number | null', '蛋重；服务端原始数值。', { nullable: true, nullMeaning: '未填写蛋重。' }),
]

const updateDraftFields: AiField[] = [
  ...draftFields,
  field('draft.id', 'string | number', '当前列表行的种鸡生产指标标准ID；Java根据ID是否存在选择更新或新建。'),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: rowFields,
  empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录；权限、网络或响应结构错误会抛出，不降级为空列表。',
}
const createOutput: AiContract['output'] = { shape: '{ draft: object }', fields: draftFields, empty: '年度、是否换羽或周龄缺失，或数值超出Portal输入范围时抛错且不发送POST。' }
const updateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: updateDraftFields, empty: '缺少当前行ID、年度、是否换羽或周龄，或数值超出Portal输入范围时抛错且不发送POST。' }

const boundaries = [
  `页面范围是${PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_CHICKEN_PRODUCTION_PERMISSION}；它属于门户系统设置→生产设置，不是独立生产系统。`,
  `Portal页面声明了query权限${PRODUCT_SETTING_CHICKEN_PRODUCTION_QUERY_PERMISSION}，但源码没有调用permissionCheck(permissions.query)；新增、编辑和删除由permissionCheck(permissions.submit)控制，对应声明值为${PRODUCT_SETTING_CHICKEN_PRODUCTION_SUBMIT_PERMISSION}，菜单权限仍是页面入口前置条件。SDK不绕过服务端当前会话的实际权限校验。`,
  `Portal product HTTP实例使用${PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH}页面上下文，所有请求路径以/base/chickenProduction开头并固定追加devicetype=PC；本页不发送module-type。`,
  '列表固定发送order=""、orderField=""、year、weekAge、gen、line、variety、moulting、pageNo和pageSize；styleV2默认pageSize=20，页面分页支持10、20、50、100，页面初始weekAge和moulting均为0。',
  'ChickenProductionController的分页响应会把layingRate、passRate、fertilityRate、maleDeathsRate、femaleDeathsRate、maleDeathEliminationRate、femaleDeathEliminationRate、maleEliminationRate、femaleEliminationRate乘以100后返回；SDK列表值保持该服务端响应值，不再换算。',
  '新建和编辑弹窗把率字段按页面百分数输入并在提交时除以100；Portal编辑弹窗源码又会把列表返回值乘以100后回显，存在页面自身的二次换算行为。直接调用prepareUpdate时应传入弹窗formState值，不应把list行的率字段未经页面回显转换直接当作弹窗百分数。',
  '编辑保存严格保留Portal raw对象扩展字段并覆盖表单字段；Java根据ID是否存在选择insert或update。删除使用DELETE /base/chickenProduction/{id}，prepare阶段只准备ID，取消时不得发送请求。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/standard-manage/chicken-production/list.vue', kind: 'reference', note: '逐页核对菜单路径、页面权限、product实例、筛选默认值、分页、submit权限控制和CRUD端点。' },
  { source: 'app/portal/views/dashboard/product/setting/standard-manage/chicken-production/modal-form-content.vue、app/portal/utils/http/product.js', kind: 'reference', note: '逐字段核对三项必填、数值边界、率字段百分数除以100、raw透传和product请求头。' },
  { source: 'ChickenProductionController.java、ChickenProduction.java、ChickenProductionServiceImpl.java、ChickenProductionMapperExt.xml', kind: 'reference', note: '核对Java端点、分页响应、列表率字段乘100、ID区分新建/更新、软删除、筛选字段和实体类型。' },
  { source: 'src/capabilities/product-setting-chicken-production.ts、test/product-setting-chicken-production.test.ts', kind: 'implementation', note: '锁定请求形状、率字段转换、raw扩展字段、权限上下文、AI说明注册和坏输入反证；未替代真实测试环境写入闭环。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐项执行列表、新建、编辑、删除并回查记录；当前证据为Portal/Java源码和离线请求形状测试。',
  '页面源码存在列表率值与编辑回显的二次乘100路径，未在真实租户确认后端数据库比例值、页面实际显示值和回查终态；SDK已如实保留该行为边界。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-chicken-production-', '')
  if (suffix === 'list') return {
    year: param('年度筛选；省略或null时按Portal发送空字符串。', '种鸡生产指标标准列表筛选表单', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按年度筛选。' }),
    weekAge: param('周龄筛选；省略时按Portal默认发送0。', '种鸡生产指标标准列表筛选表单', { type: 'number', required: false, default: '0' }),
    gen: param('代次字典值；省略时发送空字符串。', '种鸡生产指标标准列表筛选表单', { type: 'string', required: false, nullable: true }),
    line: param('品系字典值；省略时发送空字符串。', '种鸡生产指标标准列表筛选表单', { type: 'string', required: false, nullable: true }),
    variety: param('品种字典值；省略时发送空字符串。', '种鸡生产指标标准列表筛选表单', { type: 'string', required: false, nullable: true }),
    moulting: param('是否换羽：0非换羽、1换羽；省略时按Portal默认发送0。', '种鸡生产指标标准列表筛选表单', { type: '0 | 1', required: false, default: '0', options: [{ value: 0, label: '非换羽' }, { value: 1, label: '换羽' }] }),
    pageNo: param('从1开始的页码；默认1。', 'Portal列表分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal styleV2列表分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-create') return { form: param('种鸡生产指标标准新建弹窗表单；年度、是否换羽和周龄必填，率字段按弹窗百分数填写。', '用户填写的Portal新建弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'create') return { draft: param('prepareCreate返回的请求草稿；率字段已经是比例小数，确认后原样交给create。', 'productSettingChickenProduction.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-update') return { form: param('种鸡生产指标标准编辑弹窗表单；必须带当前行ID，率字段按弹窗百分数填写，并保留raw扩展字段。', '当前列表行经过Portal编辑弹窗回显和用户修改后的表单', { type: 'object', required: true }) }
  if (suffix === 'update') return { draft: param('prepareUpdate返回的含ID请求草稿；率字段已经是比例小数，确认后原样交给update。', 'productSettingChickenProduction.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-remove') return { id: param('当前列表行的种鸡生产指标标准ID；用户确认前只准备，不发送DELETE。', 'productSettingChickenProduction.list.result.list[].id', { type: 'string | number', required: true }) }
  if (suffix === 'remove') return { id: param('prepareRemove返回的ID；用户确认后执行DELETE。', 'productSettingChickenProduction.prepareRemove.result.id', { type: 'string | number', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-chicken-production-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认新建草稿', capabilityId: 'product-setting-chicken-production-create', mapping: { draft: 'result.draft' }, instruction: '把prepareCreate.result.draft原样交给create；不要再次把率字段乘回百分数。' })
    steps.push({ role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-chicken-production-list', mapping: {}, instruction: '重新调用list，按ID、年度、周龄、类型和率字段回查；true只表示请求未抛错。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认编辑草稿', capabilityId: 'product-setting-chicken-production-update', mapping: { draft: 'result.draft' }, instruction: '把prepareUpdate.result.draft原样交给update，保留当前行ID和Portal raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-chicken-production-list', mapping: {}, instruction: '重新调用list按ID和编辑后的字段回查；不能只依据true宣布更新已落库。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前列表行', capabilityId: 'product-setting-chicken-production-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove.result.id交给remove；确认前不发送DELETE。' })
    steps.push({ role: 'cancel', when: '用户取消删除', instruction: '只丢弃id，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: 'DELETE请求成功或响应不确定', capabilityId: 'product-setting-chicken-production-list', mapping: {}, instruction: '重新调用list确认同一ID不再出现；true只表示请求未抛错。' })

  let output: AiContract['output'] = trueOutput
  if (isList) output = listOutput
  else if (isPrepareCreate) output = createOutput
  else if (isPrepareUpdate) output = updateOutput
  else if (isPrepareRemove) output = { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的种鸡生产指标标准ID。')], empty: 'ID为空或不是字符串/安全整数时抛错，且不发送DELETE。' }

  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'
  return {
    purpose: isList ? '按年度、周龄、代次、品系、品种和换羽标志筛选分页读取种鸡生产指标标准。' : isPrepareCreate ? '按Portal新建弹窗规则准备种鸡生产指标标准请求草稿。' : isCreate ? '按Portal保存端点新建一条种鸡生产指标标准。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备含原始扩展字段的种鸡生产指标标准草稿。' : isUpdate ? '按Portal保存端点编辑一条已有种鸡生产指标标准。' : isPrepareRemove ? '准备一个经过用户确认的种鸡生产指标标准ID。' : '按Portal删除端点删除一条种鸡生产指标标准。',
    whenToUse: `需要在${PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用；列表率字段已经是服务端乘100后的值，提交草稿的率字段才是比例小数。`,
    boundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面菜单权限；写操作目标应来自当前列表行或同一次prepare结果。', ...(isCreate || isUpdate || isRemove ? ['请求成功或响应不确定后必须list回查业务终态。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isList ? ['用list[].id进入编辑或删除确认；直接展示列表率值时按服务端返回的百分数值解释。若要复刻Portal编辑弹窗，先按源码的回显规则处理率字段，再把form交给prepareUpdate。'] : isPrepareCreate || isPrepareUpdate ? ['把draft展示给用户确认；draft中的率字段已经是服务端比例小数，确认后原样提交。'] : isPrepareRemove ? ['向用户展示待删除ID对应的当前列表行，确认前不发请求。'] : ['请求成功或不确定后按steps回查list；不要把true当作记录已经创建、更新或删除的证据。'],
    steps,
    completion: isList ? '获得当前筛选和分页下的种鸡生产指标标准记录及总数。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal URL、HTTP方法、请求体和页面字段规则完成；记录最终状态仍需list回查。',
    failures: ['年度、是否换羽、周龄、数值范围、ID、分页、菜单权限、服务端业务校验、网络错误或响应结构错误均应抛出；列表失败不得降级为空列表，写入不确定时先回查再决定是否重试。'],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；新建或编辑请求超时/响应不确定时先list回查，删除同样先list确认ID是否仍存在，避免重复副作用。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingChickenProductionCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`种鸡生产指标标准契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_CHICKEN_PRODUCTION_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_CHICKEN_PRODUCTION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_CHICKEN_PRODUCTION_METHODS).map(([id, method]) => [
    `productSettingChickenProduction.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingChickenProduction.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
