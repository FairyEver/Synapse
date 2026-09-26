import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_ANTIBODY_METHODS,
  PRODUCT_SETTING_ANTIBODY_PAGE_PATH,
  PRODUCT_SETTING_ANTIBODY_PERMISSION,
  productSettingAntibodyCapabilities,
} from '../capabilities/product-setting-antibody.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingAntibodyCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const rowFields: AiField[] = [
  field('$', 'object', '抗体监测标准分页结果；list是当前页，total是筛选条件下的总记录数。'),
  field('list', 'array', '当前页的抗体监测标准记录。'),
  field('list[]', 'object', '抗体监测标准列表行；SDK保留Portal原始扩展字段，但扩展字段不属于页面业务契约。'),
  field('list[].id', 'string | number | null', '抗体监测标准记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回可用ID，不能安全执行编辑或删除。' }),
  field('list[].type', 'integer | null', '类型：1育成鸡，2产蛋鸡。', { nullable: true, values: { '1': '育成鸡', '2': '产蛋鸡' }, nullMeaning: '后端没有返回类型。' }),
  field('list[].antibody', 'string | null', '抗体监测项目名称；服务端实体setter会去除首尾空白。', { nullable: true, nullMeaning: '后端没有返回项目名称。' }),
  field('list[].upLimit', 'number | null', '均值起；后端原始数值，不做百分比换算。', { nullable: true, nullMeaning: '后端没有返回均值起。' }),
  field('list[].downLimit', 'number | null', '均值止；后端原始数值，不做百分比换算。', { nullable: true, nullMeaning: '后端没有返回均值止。' }),
  field('list[].upProtectionRate', 'number | null', '保护率起；服务端比例小数，例如0.75在Portal表格显示75.00%。', { nullable: true, unit: '比例小数', nullMeaning: '后端没有返回保护率起。' }),
  field('list[].downProtectionRate', 'number | null', '保护率止；服务端比例小数，例如0.25在Portal表格显示25.00%。', { nullable: true, unit: '比例小数', nullMeaning: '后端没有返回保护率止。' }),
  field('list[].protectionValue', 'number | null', '个体保护值；服务端比例小数，例如0.5在Portal表格显示50.00%。', { nullable: true, unit: '比例小数', nullMeaning: '后端没有返回个体保护值。' }),
  field('list[].evaluation', 'integer | null', '评价：-1差、0中、1优。', { nullable: true, values: { '-1': '差', '0': '中', '1': '优' }, nullMeaning: '后端没有返回评价。' }),
  field('total', 'integer', '当前抗体项目和评价筛选条件下的总记录数，不是当前页长度。'),
]

const createDraftFields: AiField[] = [
  field('$', 'object', '通过Portal新建弹窗校验、尚未发送请求的POST请求体。'),
  field('draft', 'object', '新建抗体监测标准请求草稿；保护字段已经从页面百分数转换为比例小数。'),
  field('draft.type', 'integer', '类型：1育成鸡，2产蛋鸡。', { values: { '1': '育成鸡', '2': '产蛋鸡' } }),
  field('draft.antibody', 'string', '抗体监测项目名称；非空，保留输入字符串交由Java实体setter去除首尾空白。'),
  field('draft.upLimit', 'number', '均值起；空输入按0提交。'),
  field('draft.downLimit', 'number', '均值止；空输入按0提交。'),
  field('draft.upProtectionRate', 'number', '保护率起的服务端比例小数；页面输入百分数除以100，例如75变成0.75。', { unit: '比例小数' }),
  field('draft.downProtectionRate', 'number', '保护率止的服务端比例小数；页面输入百分数除以100。', { unit: '比例小数' }),
  field('draft.protectionValue', 'number', '个体保护值的服务端比例小数；页面输入百分数除以100。', { unit: '比例小数' }),
  field('draft.evaluation', 'integer', '评价：-1差、0中、1优。', { values: { '-1': '差', '0': '中', '1': '优' } }),
]

const updateDraftFields: AiField[] = [
  ...createDraftFields,
  field('draft.id', 'string | number', '当前列表行的抗体监测标准ID；Java以有无ID区分更新和新建。'),
]

const listOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: rowFields, empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录；权限、网络或响应结构错误会抛出，不降级为空列表。' }
const createOutput: AiContract['output'] = { shape: '{ draft: object }', fields: createDraftFields, empty: '类型、抗体监测项目名或评价不满足Portal校验，或数值超出页面输入范围时抛错且不发送POST。' }
const updateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: updateDraftFields, empty: '缺少当前行ID、类型、抗体监测项目名或评价，或数值超出页面输入范围时抛错且不发送POST。' }

const boundaries = [
  `页面范围是${PRODUCT_SETTING_ANTIBODY_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_ANTIBODY_PERMISSION}；它属于门户系统设置→生产设置，不是独立生产系统。`,
  'Portal页面的query和submit权限码在源码中均为注释，没有启用独立的base:antibody:query和base:antibody:submit，不会传入permissionCheck；当前permissionCheck(undefined)按Portal实现返回true。服务端仍会执行当前会话的实际权限校验，SDK不绕过服务端。',
  '所有请求使用Portal product HTTP实例，路径以/base/antibody开头，固定追加devicetype=PC；本页module-type明确不发送。',
  '列表固定发送order=""、orderField=""、antibody、evaluation、pageNo和pageSize；styleV2默认pageSize=20，页面支持10、20、50、100。',
  '页面三个保护字段按百分数显示和输入，prepare阶段按Portal提交规则除以100；list返回的是Java服务端比例小数，SDK不把它改成百分数。',
  '新建和编辑都POST /base/antibody/save；编辑严格保留Portal raw对象的扩展字段并覆盖已编辑字段，Java根据ID是否存在选择insert或update。',
  '删除使用DELETE /base/antibody/{id}；prepare阶段只准备ID，用户取消时不得发送请求。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/standard-manage/antibody/list.vue', kind: 'reference', note: '逐页核对菜单路径、页面权限、product实例、筛选、分页、新建、编辑和删除动作，以及注释掉的query/submit权限。' },
  { source: 'app/portal/views/dashboard/product/setting/standard-manage/antibody/modal-form-content.vue、app/portal/utils/http/product.js、app/portal/utils/system.js:710-730', kind: 'reference', note: '核对表单必填项、类型枚举、数值默认值、百分数除以100、raw透传、product请求头和permissionCheck(undefined)语义。' },
  { source: 'AntibodyController.java、Antibody.java、AntibodyServiceImpl.java、AntibodyMapperExt.xml、AntibodyMapper.xml', kind: 'reference', note: '核对Java端点、ID区分新建/更新、字段类型、软删除、筛选条件和分页响应。' },
  { source: 'src/capabilities/product-setting-antibody.ts、test/product-setting-antibody.test.ts', kind: 'implementation', note: '锁定请求形状、字段转换、ID、权限上下文、AI说明注册和坏输入反证；未替代真实测试环境写入闭环。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐项执行列表、新建、编辑、删除并回查记录；当前证据为Portal/Java源码和离线请求形状测试。',
  'evaluation_level字典的线上租户快照未抓取；Java实体明确-1/0/1，契约按该后端枚举实现。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-antibody-', '')
  if (suffix === 'list') return {
    antibody: param('个体抗体项目筛选文本；省略或null时按Portal发送空字符串。', '用户在列表筛选表单输入的个体抗体项目', { type: 'string', required: false, nullable: true, nullMeaning: '不按抗体项目筛选。' }),
    evaluation: param('评价筛选值：-1差、0中、1优；省略或空字符串时不筛选。', 'evaluation_level字典选择值', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按评价筛选。', options: [{ value: -1, label: '差' }, { value: 0, label: '中' }, { value: 1, label: '优' }] }),
    pageNo: param('从1开始的页码；默认1。', 'Portal列表分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal styleV2列表分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-create') return { form: param('抗体监测标准新建表单；类型、抗体监测项目名和评价必填，保护字段用页面百分数填写。', '用户填写的Portal新建弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'create') return { draft: param('prepareCreate返回的请求草稿；保护字段已经是比例小数，确认后原样交给create。', 'productSettingAntibody.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-update') return { form: param('抗体监测标准编辑表单；必须带当前列表行ID，保护字段用页面百分数填写，其他raw字段可保留。', '当前列表行与用户编辑后的Portal弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'update') return { draft: param('prepareUpdate返回的含ID请求草稿；保护字段已经是比例小数，确认后原样交给update。', 'productSettingAntibody.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-remove') return { id: param('当前列表行的抗体监测标准ID；用户确认前只准备，不发送DELETE。', 'productSettingAntibody.list.result.list[].id', { type: 'string | number', required: true }) }
  if (suffix === 'remove') return { id: param('prepareRemove返回的抗体监测标准ID；用户确认后执行DELETE。', 'productSettingAntibody.prepareRemove.result.id', { type: 'string | number', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-antibody-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认新建草稿', capabilityId: 'product-setting-antibody-create', mapping: { draft: 'result.draft' }, instruction: '把prepareCreate.result.draft原样交给create；不要再次把比例小数乘回百分数。' })
    steps.push({ role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-antibody-list', mapping: {}, instruction: '重新调用list，按抗体项目、类型、评价和数值字段回查新增记录；true只表示请求未抛错。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认编辑草稿', capabilityId: 'product-setting-antibody-update', mapping: { draft: 'result.draft' }, instruction: '把prepareUpdate.result.draft原样交给update，保留列表行ID和Portal raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-antibody-list', mapping: {}, instruction: '重新调用list，按ID和编辑后的字段回查；不能只依据true宣布更新已落库。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前列表行', capabilityId: 'product-setting-antibody-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove.result.id交给remove；确认前不发送DELETE。' })
    steps.push({ role: 'cancel', when: '用户取消删除', instruction: '只丢弃id，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: 'DELETE请求成功或响应不确定', capabilityId: 'product-setting-antibody-list', mapping: {}, instruction: '重新调用list确认同一ID不再出现；true只表示请求未抛错。' })

  let output: AiContract['output'] = trueOutput
  if (isList) output = listOutput
  else if (isPrepareCreate) output = createOutput
  else if (isPrepareUpdate) output = updateOutput
  else if (isPrepareRemove) output = { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的抗体监测标准ID。')], empty: 'ID为空或不是字符串/安全整数时抛错，且不发送DELETE。' }

  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'
  return {
    purpose: isList ? '按抗体监测项目和评价筛选分页读取抗体监测标准。' : isPrepareCreate ? '按Portal新建弹窗规则准备抗体监测标准请求草稿。' : isCreate ? '按Portal保存端点新建一条抗体监测标准。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备含原始扩展字段的抗体监测标准草稿。' : isUpdate ? '按Portal保存端点编辑一条已有抗体监测标准。' : isPrepareRemove ? '准备一个经过用户确认的抗体监测标准ID。' : '按Portal删除端点删除一条抗体监测标准。',
    whenToUse: `需要在${PRODUCT_SETTING_ANTIBODY_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用；不要把比例小数误当作页面百分数再次换算。`,
    boundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有抗体监测标准菜单权限；写操作目标应来自当前列表行或同一次prepare结果。', ...(isCreate || isUpdate || isRemove ? ['请求成功或响应不确定后必须list回查业务终态。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isList ? ['用list[].id进入编辑或删除确认；按list[].type和list[].evaluation解释枚举；展示保护率和保护值时乘以100并格式化为Portal百分比。'] : isPrepareCreate || isPrepareUpdate ? ['把draft展示给用户确认；draft中的保护字段已经是服务端比例小数，确认后原样提交。'] : isPrepareRemove ? ['向用户展示待删除ID对应的当前列表行，确认前不发请求。'] : ['请求成功或不确定后按steps回查list；不要把true当作记录已经创建、更新或删除的证据。'],
    steps,
    completion: isList ? '获得当前筛选和分页下的抗体监测标准记录及总数。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal URL、HTTP方法、请求体和页面字段规则完成；记录最终状态仍需list回查。',
    failures: ['类型、抗体监测项目名、评价、数值范围、ID、分页、菜单权限、服务端业务校验、网络错误或响应结构错误均应抛出；列表失败不得降级为空列表，写入不确定时先回查再决定是否重试。'],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；新建或编辑请求超时/响应不确定时先list回查，删除同样先list确认ID是否仍存在，避免重复副作用。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingAntibodyCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置抗体监测标准契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_ANTIBODY_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_ANTIBODY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_ANTIBODY_METHODS).map(([id, method]) => [
    `productSettingAntibody.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingAntibody.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
