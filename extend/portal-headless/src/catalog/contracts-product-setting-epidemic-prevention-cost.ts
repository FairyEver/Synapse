import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHODS,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PERMISSION,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_QUERY_PERMISSION,
  PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_SUBMIT_PERMISSION,
  productSettingEpidemicPreventionCostCapabilities,
} from '../capabilities/product-setting-epidemic-prevention-cost.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingEpidemicPreventionCostCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const rowFields: AiField[] = [
  field('$', 'object', '只鸡防疫成本标准分页结果；list是当前页，total是筛选条件下的总记录数。'),
  field('list', 'array', '当前页的只鸡防疫成本标准记录。'),
  field('list[]', 'object', '只鸡防疫成本标准列表行；SDK保留Java DTO返回的其他扩展字段。'),
  field('list[].id', 'string | number | null', '记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回可用ID。' }),
  field('list[].year', 'number | null', '年度。', { nullable: true, nullMeaning: '后端没有返回年度。' }),
  field('list[].moulting', 'integer | null', '是否换羽：0否、1是。', { nullable: true, values: { '0': '否', '1': '是' }, nullMeaning: '后端没有返回是否换羽。' }),
  field('list[].weekAgeBegin', 'number | null', '周龄起始。', { nullable: true, nullMeaning: '后端没有返回周龄起始。' }),
  field('list[].weekAgeEnd', 'number | null', '周龄终止。', { nullable: true, nullMeaning: '后端没有返回周龄终止。' }),
  field('list[].farm', 'string | null', '场区ID；保存和筛选使用。', { nullable: true, nullMeaning: '后端没有返回场区ID。' }),
  field('list[].farmName', 'string | null', '场区名称；Java Controller通过HROrgService补充，页面展示优先使用下拉映射，回退此字段。', { nullable: true, nullMeaning: '没有场区名称。' }),
  field('list[].gen', 'string | null', '代次ID/字典值；保存和筛选使用。', { nullable: true, nullMeaning: '后端没有返回代次。' }),
  field('list[].genName', 'string | null', '代次名称；Java Controller从本地字典缓存补充。', { nullable: true, nullMeaning: '没有代次名称。' }),
  field('list[].vaccineUnitCost', 'number | null', '只鸡疫苗成本标准。', { nullable: true, nullMeaning: '后端没有返回疫苗成本。' }),
  field('list[].veterinaryDrugUnitCost', 'number | null', '只鸡兽药成本标准。', { nullable: true, nullMeaning: '后端没有返回兽药成本。' }),
  field('list[].disinfectantUnitCost', 'number | null', '只鸡消毒药成本标准。', { nullable: true, nullMeaning: '后端没有返回消毒药成本。' }),
  field('list[].satisfaction', 'number | null', '服务端实体中的满意度字段；页面不编辑该字段。', { nullable: true, nullMeaning: '后端没有返回满意度。' }),
  field('total', 'integer', '筛选条件下的记录总数，不是当前页长度。'),
]

const draftFields: AiField[] = [
  field('$', 'object', '通过Portal编辑弹窗必填项和数值范围校验、尚未发送请求的保存草稿。'),
  field('draft', 'object', '只鸡防疫成本标准保存请求草稿。'),
  field('draft.year', 'number', '年度；必填，范围-10000000至10000000。'),
  field('draft.weekAgeBegin', 'number', '周龄起始；必填，范围-10000000至10000000。'),
  field('draft.weekAgeEnd', 'number', '周龄终止；必填，范围-10000000至10000000。'),
  field('draft.gen', 'number', '代次；Portal提交时使用Number(formState.gen)。'),
  field('draft.farm', 'string | number', '场区ID；Portal场区选择值原样提交。'),
  field('draft.vaccineUnitCost', 'number', '只鸡疫苗成本标准；必填。'),
  field('draft.veterinaryDrugUnitCost', 'number', '只鸡兽药成本标准；必填。'),
  field('draft.disinfectantUnitCost', 'number', '只鸡消毒药成本标准；必填。'),
  field('draft.moulting', 'integer', '是否换羽：0否、1是。'),
]

const updateDraftFields: AiField[] = [...draftFields, field('draft.id', 'string | number', '当前列表行的只鸡防疫成本标准ID；Java根据ID是否存在选择更新或新建。')]
const listOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: rowFields, empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录；权限、网络或响应结构错误会抛出，不降级为空列表。' }
const createOutput: AiContract['output'] = { shape: '{ draft: object }', fields: draftFields, empty: '缺少任一必填字段、代次不能转换为数字或数值超出页面范围时抛错且不发送POST。' }
const updateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: updateDraftFields, empty: '缺少当前行ID、必填字段或数值超出页面范围时抛错且不发送POST。' }

const boundaries = [
  `页面范围是${PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PERMISSION}；它属于门户系统设置→生产设置，不是独立生产系统。`,
  `Portal页面声明了query权限${PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_QUERY_PERMISSION}和submit权限${PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_SUBMIT_PERMISSION}；查询没有单独调用query，新增、编辑和删除由permissionCheck(permissions.submit)控制。SDK不绕过服务端当前会话的实际权限校验。`,
  '所有请求使用Portal product HTTP实例，路径以/base/epidemicPreventionCost开头，固定追加devicetype=PC；本页不发送module-type。',
  '列表固定发送order=""、orderField=""、farm、year、moulting、gen、pageNo和pageSize；styleV2默认pageSize=20，页面支持10、20、50、100，初始farm/year/gen为空字符串、moulting为0。',
  '查询表单要求场区、年度、是否换羽、代次；新建/编辑弹窗还要求周龄起止和三项成本标准。所有数值控件范围为-10000000至10000000；提交时year、周龄、成本和moulting使用Number，gen也使用Number，farm原样提交。',
  '列表DTO由Java Controller补充farmName和genName；Portal场区展示优先使用组件after-load构建的ID→名称映射，再回退record.farmName。编辑提交展开Portal raw对象，因此SDK保留扩展字段。',
  '删除使用DELETE /base/epidemicPreventionCost/{id}；prepare阶段只准备ID，用户取消时不得发送请求。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/standard-manage/epidemic-prevention-cost/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、product实例、场区映射、筛选、分页和CRUD端点。' },
  { source: 'app/portal/views/dashboard/product/setting/standard-manage/epidemic-prevention-cost/modal-form-content.vue、app/portal/utils/http/product.js', kind: 'reference', note: '逐字段核对九项必填、数值边界、gen/farm/moulting转换、raw透传和请求头。' },
  { source: 'EpidemicPreventionCostController.java、EpidemicPreventionCost.java、EpidemicPreventionCostDTO.java、EpidemicPreventionCostServiceImpl.java、EpidemicPreventionCostMapperExt.xml', kind: 'reference', note: '核对Java端点、分页DTO、farmName/genName补充、ID区分新建/更新、软删除和筛选条件。' },
  { source: 'src/capabilities/product-setting-epidemic-prevention-cost.ts、test/product-setting-epidemic-prevention-cost.test.ts', kind: 'implementation', note: '锁定查询、场区/代次映射字段、表单提交体、raw扩展字段、权限上下文、AI说明注册和坏输入反证；未替代真实测试环境写入闭环。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐项执行列表、新建、编辑、删除并回查记录；当前证据为Portal/Java源码和离线请求形状测试。',
  '尚未抓取真实租户场区选项和代次字典快照；farmName/genName的线上显示值仍以Java DTO和Portal回退逻辑为准。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-epidemic-prevention-cost-', '')
  if (suffix === 'list') return {
    farm: param('场区ID；省略时发送空字符串。', '只鸡防疫成本标准列表筛选表单', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按场区筛选。' }),
    year: param('年度；省略时发送空字符串。', '只鸡防疫成本标准列表筛选表单', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按年度筛选。' }),
    moulting: param('是否换羽：0否、1是；省略时按Portal默认发送0。', '只鸡防疫成本标准列表筛选表单', { type: '0 | 1', required: false, default: '0', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] }),
    gen: param('代次筛选值；省略时发送空字符串。', '只鸡防疫成本标准列表筛选表单', { type: 'string | number', required: false, nullable: true }),
    pageNo: param('从1开始的页码；默认1。', 'Portal列表分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal styleV2列表分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-create') return { form: param('只鸡防疫成本标准新建弹窗表单；年度、周龄起止、代次、场区、三项成本和是否换羽均必填。', '用户填写的Portal新建弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'create') return { draft: param('prepareCreate返回的请求草稿；确认后原样提交。', 'productSettingEpidemicPreventionCost.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-update') return { form: param('只鸡防疫成本标准编辑弹窗表单；必须带当前行ID并保留raw扩展字段。', '当前列表行与用户编辑后的Portal弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'update') return { draft: param('prepareUpdate返回的含ID编辑草稿；确认后原样提交。', 'productSettingEpidemicPreventionCost.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-remove') return { id: param('当前列表行的只鸡防疫成本标准ID；用户确认前只准备，不发送DELETE。', 'productSettingEpidemicPreventionCost.list.result.list[].id', { type: 'string | number', required: true }) }
  if (suffix === 'remove') return { id: param('prepareRemove返回的ID；用户确认后执行DELETE。', 'productSettingEpidemicPreventionCost.prepareRemove.result.id', { type: 'string | number', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-epidemic-prevention-cost-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []
  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认新建草稿', capabilityId: 'product-setting-epidemic-prevention-cost-create', mapping: { draft: 'result.draft' }, instruction: '把prepareCreate.result.draft原样交给create。' })
    steps.push({ role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-epidemic-prevention-cost-list', mapping: {}, instruction: '重新调用list按ID、场区、年度、代次和成本字段回查。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认编辑草稿', capabilityId: 'product-setting-epidemic-prevention-cost-update', mapping: { draft: 'result.draft' }, instruction: '把prepareUpdate.result.draft原样交给update，保留当前行ID和raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-epidemic-prevention-cost-list', mapping: {}, instruction: '重新调用list按ID和编辑后的字段回查。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前列表行', capabilityId: 'product-setting-epidemic-prevention-cost-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove.result.id交给remove；确认前不发送DELETE。' })
    steps.push({ role: 'cancel', when: '用户取消删除', instruction: '只丢弃id，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: 'DELETE请求成功或响应不确定', capabilityId: 'product-setting-epidemic-prevention-cost-list', mapping: {}, instruction: '重新调用list确认同一ID不再出现。' })

  let output: AiContract['output'] = trueOutput
  if (isList) output = listOutput
  else if (isPrepareCreate) output = createOutput
  else if (isPrepareUpdate) output = updateOutput
  else if (isPrepareRemove) output = { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的只鸡防疫成本标准ID。')], empty: 'ID为空或不是字符串/安全整数时抛错，且不发送DELETE。' }
  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'
  return {
    purpose: isList ? '按场区、年度、换羽标志和代次筛选分页读取只鸡防疫成本标准。' : isPrepareCreate ? '按Portal新建弹窗规则准备只鸡防疫成本标准请求草稿。' : isCreate ? '按Portal保存端点新建一条只鸡防疫成本标准。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备含原始扩展字段的只鸡防疫成本标准草稿。' : isUpdate ? '按Portal保存端点编辑一条已有只鸡防疫成本标准。' : isPrepareRemove ? '准备一个经过用户确认的只鸡防疫成本标准ID。' : '按Portal删除端点删除一条只鸡防疫成本标准。',
    whenToUse: `需要在${PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用。`,
    boundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面菜单权限；写操作目标应来自当前列表行或同一次prepare结果。', ...(isCreate || isUpdate || isRemove ? ['请求成功或响应不确定后必须list回查业务终态。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isList ? ['用list[].id进入编辑或删除确认；用farmName/genName解释场区和代次名称，必要时用当前选择器映射回显。'] : isPrepareCreate || isPrepareUpdate ? ['把draft展示给用户确认；draft中的gen已经按Portal转换为数字，确认后原样提交。'] : isPrepareRemove ? ['向用户展示待删除ID对应的当前列表行，确认前不发请求。'] : ['请求成功或不确定后按steps回查list；不要把true当作记录已经创建、更新或删除的证据。'],
    steps,
    completion: isList ? '获得当前筛选和分页下的只鸡防疫成本标准记录及总数。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal URL、HTTP方法、请求体和页面字段规则完成；记录最终状态仍需list回查。',
    failures: ['必填字段、代次转换、数值范围、ID、分页、菜单权限、服务端业务校验、网络错误或响应结构错误均应抛出；列表失败不得降级为空列表，写入不确定时先回查再决定是否重试。'],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；新建或编辑请求超时/响应不确定时先list回查，删除同样先list确认ID是否仍存在，避免重复副作用。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingEpidemicPreventionCostCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`只鸡防疫成本标准契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHODS).map(([id, method]) => [
    `productSettingEpidemicPreventionCost.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingEpidemicPreventionCost.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
