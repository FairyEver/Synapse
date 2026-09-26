import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHODS,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_QUERY_PERMISSION,
  PRODUCT_SETTING_STANDARD_FLOCK_WEEK_SUBMIT_PERMISSION,
  productSettingStandardFlockWeekCapabilities,
} from '../capabilities/product-setting-standard-flock-week.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingStandardFlockWeekCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const rowFields: AiField[] = [
  field('$', 'object', '种鸡标准(BI)分页结果；list是当前页，total是筛选条件下的总记录数。'),
  field('list', 'array', '当前页的种鸡标准(BI)记录。'),
  field('list[]', 'object', '种鸡标准(BI)列表行；SDK保留Java实体返回的其他扩展字段。'),
  field('list[].id', 'string | number | null', '记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回可用ID，不能安全编辑或删除。' }),
  field('list[].year', 'number | null', '年度。', { nullable: true, nullMeaning: '后端没有返回年度。' }),
  field('list[].weekAge', 'number | null', '周龄。', { nullable: true, nullMeaning: '后端没有返回周龄。' }),
  field('list[].variety', 'string | null', '品种字典值；页面展示时由Portal字典标签解释。', { nullable: true, nullMeaning: '后端没有返回品种。' }),
  field('list[].line', 'string | null', '品系字典值；页面展示时由Portal字典标签解释。', { nullable: true, nullMeaning: '后端没有返回品系。' }),
  field('list[].gen', 'string | null', '代次字典值；页面展示时由Portal字典标签解释。', { nullable: true, nullMeaning: '后端没有返回代次。' }),
  field('list[].housed', 'number | null', '入舍只鸡单产标准；服务端原始数值。', { nullable: true, nullMeaning: '后端没有返回入舍只鸡单产标准。' }),
  field('list[].hatchingEggLayingRate', 'number | null', '合格种蛋产蛋率标准；StandardFlockWeekController分页响应已把数据库比例小数乘以100，SDK保持服务端响应值。', { nullable: true, unit: '百分数值', nullMeaning: '后端没有返回合格种蛋产蛋率标准。' }),
  field('total', 'integer', '筛选条件下的记录总数，不是当前页长度。'),
]

const draftFields: AiField[] = [
  field('$', 'object', '通过Portal弹窗七项必填和输入范围校验、尚未发送请求的保存草稿。'),
  field('draft', 'object', '保存请求体；合格种蛋产蛋率已经从页面百分数除以100，变成Java数据库比例小数。'),
  field('draft.year', 'number', '年度；Portal必填，范围-10000000至10000000。'),
  field('draft.weekAge', 'number', '周龄；Portal必填，范围-10000000至10000000。'),
  field('draft.variety', 'string', '品种字典值；Portal必填。'),
  field('draft.line', 'string', '品系字典值；Portal必填。'),
  field('draft.gen', 'string', '代次字典值；Portal必填。'),
  field('draft.housed', 'number', '入舍只鸡单产标准；Portal必填，范围-10000000至10000000。'),
  field('draft.hatchingEggLayingRate', 'number', '合格种蛋产蛋率标准；页面按百分数填写，提交草稿为除以100后的比例小数。'),
]

const updateDraftFields: AiField[] = [...draftFields, field('draft.id', 'string | number', '当前列表行的种鸡标准(BI)ID；Java根据ID是否存在选择更新或新建。')]
const listOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: rowFields, empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录；权限、网络或响应结构错误会抛出，不降级为空列表。' }
const createOutput: AiContract['output'] = { shape: '{ draft: object }', fields: draftFields, empty: '七项必填字段缺失或数值超出页面范围时抛错且不发送POST。' }
const updateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: updateDraftFields, empty: '缺少当前行ID、七项必填字段或数值超出页面范围时抛错且不发送POST。' }

const boundaries = [
  `页面范围是${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PERMISSION}；它属于门户系统设置→生产设置，不是独立生产系统。`,
  `Portal页面声明了query权限${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_QUERY_PERMISSION}和submit权限${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_SUBMIT_PERMISSION}；查询没有单独调用query，新增、编辑和删除由permissionCheck(permissions.submit)控制。SDK不绕过服务端当前会话的实际权限校验。`,
  '所有请求使用Portal product HTTP实例，路径以/base/standardFlockWeek开头，固定追加devicetype=PC；本页不发送module-type。',
  '列表固定发送order=""、orderField=""、year、gen、variety、line、pageNo和pageSize；页面通过convertFetchForm只在开始/结束周龄有非空值时追加startWeekAge/endWeekAge，空值、空字符串或0时删除这两个参数。styleV2默认pageSize=20，页面分页支持10、20、50、100。',
  '查询表单year有required规则；开始/结束周龄控件范围1至200，但页面未为它们配置required规则。新建/编辑弹窗year、weekAge、variety、line、gen、housed、hatchingEggLayingRate七项均required，数值控件范围-10000000至10000000。',
  'StandardFlockWeekController分页循环调用multiplyNumHandle，服务端响应中的hatchingEggLayingRate已经是数据库比例小数乘100后的值；Portal编辑弹窗不再乘100回显，但提交时仍按页面百分数除以100。',
  'Portal编辑提交展开...props.raw，SDK保留列表行扩展字段并覆盖编辑字段和ID；Java根据ID是否存在选择更新或新建。删除使用DELETE /base/standardFlockWeek/{id}，prepare阶段只准备ID，取消时不得发送请求。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/standard-manage/standard-flock-week.vue、app/portal/views/dashboard/product/setting/standard-manage/standard-flock-week/list.vue', kind: 'reference', note: '逐页核对菜单/路由、权限、product实例、convertFetchForm删参规则、分页、submit权限控制和CRUD端点。' },
  { source: 'app/portal/views/dashboard/product/setting/standard-manage/standard-flock-week/modal-form-content.vue、app/portal/utils/http/product.js', kind: 'reference', note: '逐字段核对七项必填、数值边界、产蛋率百分数换算、raw透传和请求头。' },
  { source: 'StandardFlockWeekController.java、StandardFlockWeek.java、StandardFlockWeekVO.java、StandardFlockWeekServiceImpl.java、StandardFlockWeekMapperExt.xml', kind: 'reference', note: '核对Java端点、范围VO查询、列表产蛋率乘100、ID区分新建/更新、软删除和筛选条件。' },
  { source: 'src/capabilities/product-setting-standard-flock-week.ts、test/product-setting-standard-flock-week.test.ts', kind: 'implementation', note: '锁定空范围删参、请求形状、产蛋率转换、raw扩展字段、权限上下文、AI说明注册和坏输入反证；未替代真实测试环境写入闭环。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐项执行列表、新建、编辑、删除并回查记录；当前证据为Portal/Java源码和离线请求形状测试。',
  '尚未在真实租户确认合格种蛋产蛋率数据库比例、Java分页响应与列表显示之间的实际数值；SDK已如实保留源码中的乘100/除100边界。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-standard-flock-week-', '')
  if (suffix === 'list') return {
    year: param('年度；省略时发送空字符串。', '种鸡标准(BI)列表筛选表单', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按年度筛选。' }),
    gen: param('代次字典值；省略时发送空字符串。', '种鸡标准(BI)列表筛选表单', { type: 'string', required: false, nullable: true }),
    variety: param('品种字典值；省略时发送空字符串。', '种鸡标准(BI)列表筛选表单', { type: 'string', required: false, nullable: true }),
    line: param('品系字典值；省略时发送空字符串。', '种鸡标准(BI)列表筛选表单', { type: 'string', required: false, nullable: true }),
    startWeekAge: param('开始周龄；仅在提供1至200的非空值时发送，空值不发送。', 'Portal convertFetchForm后的列表筛选参数', { type: '1..200', required: false, nullable: true, nullMeaning: '不设置下界。' }),
    endWeekAge: param('结束周龄；仅在提供1至200的非空值时发送，空值不发送。', 'Portal convertFetchForm后的列表筛选参数', { type: '1..200', required: false, nullable: true, nullMeaning: '不设置上界。' }),
    pageNo: param('从1开始的页码；默认1。', 'Portal列表分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal styleV2列表分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-create') return { form: param('种鸡标准(BI)新建弹窗表单；年度、周龄、品种、品系、代次、入舍只鸡单产和合格种蛋产蛋率均必填，产蛋率按百分数填写。', '用户填写的Portal新建弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'create') return { draft: param('prepareCreate返回的请求草稿；合格种蛋产蛋率已经是比例小数，确认后原样交给create。', 'productSettingStandardFlockWeek.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-update') return { form: param('种鸡标准(BI)编辑弹窗表单；必须带当前行ID，产蛋率按弹窗百分数填写，并保留raw扩展字段。', '当前列表行与用户编辑后的Portal弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'update') return { draft: param('prepareUpdate返回的含ID请求草稿；合格种蛋产蛋率已经是比例小数，确认后原样交给update。', 'productSettingStandardFlockWeek.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-remove') return { id: param('当前列表行的种鸡标准(BI)ID；用户确认前只准备，不发送DELETE。', 'productSettingStandardFlockWeek.list.result.list[].id', { type: 'string | number', required: true }) }
  if (suffix === 'remove') return { id: param('prepareRemove返回的ID；用户确认后执行DELETE。', 'productSettingStandardFlockWeek.prepareRemove.result.id', { type: 'string | number', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-standard-flock-week-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认新建草稿', capabilityId: 'product-setting-standard-flock-week-create', mapping: { draft: 'result.draft' }, instruction: '把prepareCreate.result.draft原样交给create；不要再次把合格种蛋产蛋率乘回百分数。' })
    steps.push({ role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-standard-flock-week-list', mapping: {}, instruction: '重新调用list，按ID、年度、周龄、品种、品系、代次和指标字段回查；true只表示请求未抛错。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认编辑草稿', capabilityId: 'product-setting-standard-flock-week-update', mapping: { draft: 'result.draft' }, instruction: '把prepareUpdate.result.draft原样交给update，保留当前行ID和Portal raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-standard-flock-week-list', mapping: {}, instruction: '重新调用list按ID和编辑后的字段回查；不能只依据true宣布更新已落库。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前列表行', capabilityId: 'product-setting-standard-flock-week-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove.result.id交给remove；确认前不发送DELETE。' })
    steps.push({ role: 'cancel', when: '用户取消删除', instruction: '只丢弃id，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: 'DELETE请求成功或响应不确定', capabilityId: 'product-setting-standard-flock-week-list', mapping: {}, instruction: '重新调用list确认同一ID不再出现；true只表示请求未抛错。' })

  let output: AiContract['output'] = trueOutput
  if (isList) output = listOutput
  else if (isPrepareCreate) output = createOutput
  else if (isPrepareUpdate) output = updateOutput
  else if (isPrepareRemove) output = { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的种鸡标准(BI)ID。')], empty: 'ID为空或不是字符串/安全整数时抛错，且不发送DELETE。' }
  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'
  return {
    purpose: isList ? '按年度、代次、品种、品系和可选周龄范围筛选分页读取种鸡标准(BI)。' : isPrepareCreate ? '按Portal新建弹窗规则准备种鸡标准(BI)请求草稿。' : isCreate ? '按Portal保存端点新建一条种鸡标准(BI)。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备含原始扩展字段的种鸡标准(BI)草稿。' : isUpdate ? '按Portal保存端点编辑一条已有种鸡标准(BI)。' : isPrepareRemove ? '准备一个经过用户确认的种鸡标准(BI)ID。' : '按Portal删除端点删除一条种鸡标准(BI)。',
    whenToUse: `需要在${PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用；列表hatchingEggLayingRate已经是服务端乘100后的值，提交草稿才是除以100后的比例小数。`,
    boundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面菜单权限；写操作目标应来自当前列表行或同一次prepare结果。', ...(isCreate || isUpdate || isRemove ? ['请求成功或响应不确定后必须list回查业务终态。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isList ? ['用list[].id进入编辑或删除确认；直接展示列表hatchingEggLayingRate时按服务端乘100后的数值解释。用户填写周龄范围时才传startWeekAge/endWeekAge，空值不要手工补成空字符串。'] : isPrepareCreate || isPrepareUpdate ? ['把draft展示给用户确认；draft中的hatchingEggLayingRate已经是比例小数，确认后原样提交。'] : isPrepareRemove ? ['向用户展示待删除ID对应的当前列表行，确认前不发请求。'] : ['请求成功或不确定后按steps回查list；不要把true当作记录已经创建、更新或删除的证据。'],
    steps,
    completion: isList ? '获得当前筛选和分页下的种鸡标准(BI)记录及总数。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal URL、HTTP方法、请求体和页面字段规则完成；记录最终状态仍需list回查。',
    failures: ['年度、七项表单字段、周龄范围、数值范围、ID、分页、菜单权限、服务端业务校验、网络错误或响应结构错误均应抛出；列表失败不得降级为空列表，写入不确定时先回查再决定是否重试。'],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；新建或编辑请求超时/响应不确定时先list回查，删除同样先list确认ID是否仍存在，避免重复副作用。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingStandardFlockWeekCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`种鸡标准(BI)契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_STANDARD_FLOCK_WEEK_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHODS).map(([id, method]) => [
    `productSettingStandardFlockWeek.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingStandardFlockWeek.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
