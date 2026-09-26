import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHODS,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PERMISSION,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_QUERY_PERMISSION,
  PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_SUBMIT_PERMISSION,
  productSettingEggStandardAgeStageCapabilities,
} from '../capabilities/product-setting-egg-standard-age-stage.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingEggStandardAgeStageCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const rowFields: AiField[] = [
  field('$', 'object', '孵化日龄段标准分页结果；list是当前页，total是筛选条件下的总记录数。'),
  field('list', 'array', '当前页的孵化日龄段标准记录。'),
  field('list[]', 'object', '孵化日龄段标准列表行；SDK保留Java返回的其他扩展字段。'),
  field('list[].id', 'string | number | null', '记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回可用ID，不能安全编辑或删除。' }),
  field('list[].moulting', 'integer | null', '是否换羽：0否、1是。', { nullable: true, values: { '0': '否', '1': '是' }, nullMeaning: '后端没有返回是否换羽。' }),
  field('list[].stage', 'string | null', '日龄段名称；Java setter会去除首尾空白。', { nullable: true, nullMeaning: '后端没有返回日龄段。' }),
  field('list[].begin', 'number | null', '母鸡起始日龄。', { nullable: true, nullMeaning: '后端没有返回起始日龄。' }),
  field('list[].end', 'number | null', '母鸡终止日龄。', { nullable: true, nullMeaning: '后端没有返回终止日龄。' }),
  field('list[].updateByName', 'string | null', '最后修改人；服务层根据updateBy.id补充。', { nullable: true, nullMeaning: '没有修改人或服务层没有解析到用户。' }),
  field('list[].updateDate', 'string | null', '最后修改时间；来自Java DataEntity。', { nullable: true, nullMeaning: '后端没有返回修改时间。' }),
  field('total', 'integer', '筛选条件下的记录总数，不是当前页长度。'),
]

const draftFields: AiField[] = [
  field('$', 'object', '通过Portal新建/编辑弹窗必填项和日龄范围校验、尚未发送请求的保存草稿。'),
  field('draft', 'object', '孵化日龄段标准保存请求草稿。'),
  field('draft.moulting', 'integer', '是否换羽：0否、1是。'),
  field('draft.stage', 'string', '日龄段名称；非空，服务端会去除首尾空白。'),
  field('draft.begin', 'number', '母鸡起始日龄；范围0至10000000。'),
  field('draft.end', 'number', '母鸡终止日龄；范围0至10000000。'),
]

const updateDraftFields: AiField[] = [
  ...draftFields,
  field('draft.id', 'string | number', '当前列表行的孵化日龄段标准ID；Java根据ID是否存在选择更新或新建。'),
]

const listOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: rowFields, empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录；权限、网络或响应结构错误会抛出，不降级为空列表。' }
const createOutput: AiContract['output'] = { shape: '{ draft: object }', fields: draftFields, empty: '缺少是否换羽、日龄段、起始日龄或终止日龄，或日龄超出页面范围时抛错且不发送POST。' }
const updateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: updateDraftFields, empty: '缺少当前行ID、必填字段或日龄超出页面范围时抛错且不发送POST。' }

const boundaries = [
  `页面范围是${PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PERMISSION}；它属于门户系统设置→生产设置，不是独立生产系统。`,
  `Portal页面声明了query权限${PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_QUERY_PERMISSION}和submit权限${PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_SUBMIT_PERMISSION}；查询代码没有单独调用query，新增、编辑和删除由permissionCheck(permissions.submit)控制。SDK不绕过服务端当前会话的实际权限校验。`,
  '所有请求使用Portal product HTTP实例，路径以/egg/standardAgeStage开头，固定追加devicetype=PC；本页不发送module-type。',
  '列表固定发送order=""、orderField=""、moulting、stage、pageNo和pageSize；styleV2默认pageSize=20，页面支持10、20、50、100，初始moulting=0；stage在Java Mapper中按前缀匹配。',
  '新建和编辑表单的moulting、stage、begin、end均必填；日龄输入范围为0至10000000，提交时begin/end使用Number转换；编辑保留Portal raw扩展字段。',
  '后端列表服务层会根据updateBy.id调用HRUserUtils补充updateByName；SDK不把该展示字段误当作保存输入。删除使用DELETE /egg/standardAgeStage/{id}，prepare阶段只准备ID。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/standard-manage/egg-standard-age-stage/list.vue', kind: 'reference', note: '逐页核对菜单路径、页面权限、product实例、筛选默认值、分页、submit权限控制和CRUD端点。' },
  { source: 'app/portal/views/dashboard/product/setting/standard-manage/egg-standard-age-stage/modal-form-content.vue、app/portal/utils/http/product.js', kind: 'reference', note: '逐字段核对四项必填、日龄范围、Number转换、raw透传和product请求头。' },
  { source: 'StandardAgeStageController.java、StandardAgeStage.java、StandardAgeStageServiceImpl.java、StandardAgeStageMapperExt.xml', kind: 'reference', note: '核对Java端点、分页响应、updateByName补充、ID区分新建/更新、软删除、前缀筛选和排序。' },
  { source: 'src/capabilities/product-setting-egg-standard-age-stage.ts、test/product-setting-egg-standard-age-stage.test.ts', kind: 'implementation', note: '锁定请求形状、表单规则、raw扩展字段、权限上下文、AI说明注册和坏输入反证；未替代真实测试环境写入闭环。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐项执行列表、新建、编辑、删除并回查记录；当前证据为Portal/Java源码和离线请求形状测试。',
  '尚未抓取真实租户的HR用户名称补充结果；updateByName按Java服务层的可空行为记录。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-egg-standard-age-stage-', '')
  if (suffix === 'list') return {
    moulting: param('是否换羽：0否、1是；省略时按Portal默认发送0。', '孵化日龄段标准列表筛选表单', { type: '0 | 1', required: false, default: '0', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] }),
    stage: param('日龄段前缀筛选；省略时发送空字符串。', '孵化日龄段标准列表筛选表单', { type: 'string', required: false, nullable: true, nullMeaning: '不按日龄段筛选。' }),
    pageNo: param('从1开始的页码；默认1。', 'Portal列表分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal styleV2列表分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-create') return { form: param('孵化日龄段标准新建弹窗表单；是否换羽、日龄段和起止日龄均必填。', '用户填写的Portal新建弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'create') return { draft: param('prepareCreate返回的完整请求草稿；确认后原样交给create。', 'productSettingEggStandardAgeStage.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-update') return { form: param('孵化日龄段标准编辑弹窗表单；必须带当前列表行ID并保留raw扩展字段。', '当前列表行与用户编辑后的Portal弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'update') return { draft: param('prepareUpdate返回的含ID编辑草稿；确认后原样交给update。', 'productSettingEggStandardAgeStage.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-remove') return { id: param('当前列表行的孵化日龄段标准ID；用户确认前只准备，不发送DELETE。', 'productSettingEggStandardAgeStage.list.result.list[].id', { type: 'string | number', required: true }) }
  if (suffix === 'remove') return { id: param('prepareRemove返回的ID；用户确认后执行DELETE。', 'productSettingEggStandardAgeStage.prepareRemove.result.id', { type: 'string | number', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-egg-standard-age-stage-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []
  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认新建草稿', capabilityId: 'product-setting-egg-standard-age-stage-create', mapping: { draft: 'result.draft' }, instruction: '把prepareCreate.result.draft原样交给create。' })
    steps.push({ role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-egg-standard-age-stage-list', mapping: {}, instruction: '重新调用list按ID、日龄段和起止日龄回查；true只表示请求未抛错。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认编辑草稿', capabilityId: 'product-setting-egg-standard-age-stage-update', mapping: { draft: 'result.draft' }, instruction: '把prepareUpdate.result.draft原样交给update，保留当前行ID和raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-egg-standard-age-stage-list', mapping: {}, instruction: '重新调用list按ID和编辑后的字段回查。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前列表行', capabilityId: 'product-setting-egg-standard-age-stage-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove.result.id交给remove；确认前不发送DELETE。' })
    steps.push({ role: 'cancel', when: '用户取消删除', instruction: '只丢弃id，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: 'DELETE请求成功或响应不确定', capabilityId: 'product-setting-egg-standard-age-stage-list', mapping: {}, instruction: '重新调用list确认同一ID不再出现。' })

  let output: AiContract['output'] = trueOutput
  if (isList) output = listOutput
  else if (isPrepareCreate) output = createOutput
  else if (isPrepareUpdate) output = updateOutput
  else if (isPrepareRemove) output = { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的孵化日龄段标准ID。')], empty: 'ID为空或不是字符串/安全整数时抛错，且不发送DELETE。' }

  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'
  return {
    purpose: isList ? '按是否换羽和日龄段前缀筛选分页读取孵化日龄段标准。' : isPrepareCreate ? '按Portal新建弹窗规则准备孵化日龄段标准请求草稿。' : isCreate ? '按Portal保存端点新建一条孵化日龄段标准。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备含原始扩展字段的孵化日龄段标准草稿。' : isUpdate ? '按Portal保存端点编辑一条已有孵化日龄段标准。' : isPrepareRemove ? '准备一个经过用户确认的孵化日龄段标准ID。' : '按Portal删除端点删除一条孵化日龄段标准。',
    whenToUse: `需要在${PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用。`,
    boundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面菜单权限；写操作目标应来自当前列表行或同一次prepare结果。', ...(isCreate || isUpdate || isRemove ? ['请求成功或响应不确定后必须list回查业务终态。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isList ? ['用list[].id进入编辑或删除确认；用list[].updateByName和list[].updateDate解释最后修改信息。'] : isPrepareCreate || isPrepareUpdate ? ['把draft展示给用户确认，确认后原样提交。'] : isPrepareRemove ? ['向用户展示待删除ID对应的当前列表行，确认前不发请求。'] : ['请求成功或不确定后按steps回查list；不要把true当作记录已经创建、更新或删除的证据。'],
    steps,
    completion: isList ? '获得当前筛选和分页下的孵化日龄段标准记录及总数。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal URL、HTTP方法、请求体和页面字段规则完成；记录最终状态仍需list回查。',
    failures: ['是否换羽、日龄段、起止日龄、ID、分页、菜单权限、服务端业务校验、网络错误或响应结构错误均应抛出；列表失败不得降级为空列表，写入不确定时先回查再决定是否重试。'],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；新建或编辑请求超时/响应不确定时先list回查，删除同样先list确认ID是否仍存在，避免重复副作用。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingEggStandardAgeStageCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`孵化日龄段标准契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHODS).map(([id, method]) => [
    `productSettingEggStandardAgeStage.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingEggStandardAgeStage.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
