import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHODS,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PERMISSION,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_SUBMIT_PERMISSION,
  productSettingHatchAnnualMonthlyCapabilities,
} from '../capabilities/product-setting-hatch-annual-monthly.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingHatchAnnualMonthlyCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const rowFields: AiField[] = [
  field('$', 'object', '年月指标目标标准分页结果；list是当前页，total是筛选条件下的总记录数。'),
  field('list', 'array', '当前页的年月指标目标标准记录。'),
  field('list[]', 'object', '年月指标目标标准列表行；SDK保留Java返回的其他扩展字段。'),
  field('list[].id', 'string | number | null', '记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回可用ID，不能安全编辑或删除。' }),
  field('list[].type', 'number | null', 'Java实体类型字段；Portal实际单选值为3年度、1月度，Java实体注释中的1年度、2月度与Portal页面不一致。', { nullable: true, values: { '3': '年度（Portal）', '1': '月度（Portal）' }, nullMeaning: '后端没有返回年月类型。' }),
  field('list[].year', 'number | null', '年度。', { nullable: true, nullMeaning: '后端没有返回年度。' }),
  field('list[].month', 'number | null', '月份。', { nullable: true, nullMeaning: '后端没有返回月份。' }),
  field('list[].hall', 'string | null', '孵化厅ID；保存和筛选使用。', { nullable: true, nullMeaning: '后端没有返回孵化厅ID。' }),
  field('list[].hallName', 'string | null', 'Java实体中的孵化厅名称扩展字段；Portal列表实际优先使用选项ID映射。', { nullable: true, nullMeaning: '没有孵化厅名称。' }),
  field('list[].healthyFemaleRate', 'number | null', '健母雏率；HatchAnnualMonthlyController分页响应已把数据库比例小数乘以100，SDK保持该服务端响应值。', { nullable: true, unit: '百分数值', nullMeaning: '后端没有返回健母雏率。' }),
  field('list[].eggChickRatio', 'number | null', '蛋雏比；服务端原始数值，不做百分比换算。', { nullable: true, nullMeaning: '后端没有返回蛋雏比。' }),
  field('total', 'integer', '筛选条件下的记录总数，不是当前页长度。'),
]

const draftFields: AiField[] = [
  field('$', 'object', '通过Portal弹窗必填项和输入范围校验、尚未发送请求的保存草稿。'),
  field('draft', 'object', '保存请求体；健母雏率已经从页面百分数除以100，变成Java数据库比例小数。'),
  field('draft.year', 'number', '年度；Portal必填，范围1970至10000000。'),
  field('draft.month', 'number', '月度；Portal必填，范围1至12。'),
  field('draft.hall', 'string | number', '孵化厅ID；Portal值原样提交，必填。'),
  field('draft.healthyFemaleRate', 'number', '健母雏率；页面按百分数填写，提交草稿除以100后的比例小数。'),
  field('draft.eggChickRatio', 'number', '蛋雏比；Portal必填，范围-10000000至10000000，不做百分比换算。'),
  field('draft.type', 'integer', '年月类型；Portal实际为3年度、1月度，必填。', { values: { '3': '年度', '1': '月度' } }),
]

const updateDraftFields: AiField[] = [...draftFields, field('draft.id', 'string | number', '当前列表行的年月指标目标标准ID；Java根据ID是否存在选择更新或新建。')]
const listOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: rowFields, empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录；权限、网络或响应结构错误会抛出，不降级为空列表。' }
const createOutput: AiContract['output'] = { shape: '{ draft: object }', fields: draftFields, empty: '年度、月度、孵化厅、健母雏率、蛋雏比或年月类型缺失，或数值超出页面范围时抛错且不发送POST。' }
const updateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: updateDraftFields, empty: '缺少当前行ID、必填字段或数值超出页面范围时抛错且不发送POST。' }

const boundaries = [
  `页面范围是${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PERMISSION}；它属于门户系统设置→生产设置，不是独立生产系统。`,
  `Portal页面声明了query权限${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_QUERY_PERMISSION}和submit权限${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_SUBMIT_PERMISSION}；查询没有单独调用query，新增、编辑和删除由permissionCheck(permissions.submit)控制。SDK不绕过服务端当前会话的实际权限校验。`,
  '所有请求使用Portal product HTTP实例，路径以/base/hatchAnnualMonthly开头，固定追加devicetype=PC；本页不发送module-type。',
  '列表固定发送order=""、orderField=""、hall、year、month、pageNo和pageSize；styleV2默认pageSize=20，页面支持10、20、50、100，初始hall/year为空字符串、month为1；月份清空时不按月份筛选。',
  '年月类型在Portal单选框中实际是3=年度、1=月度；Java实体注释写成1年度、2月度，不能用注释覆盖页面实际请求。',
  'HatchAnnualMonthlyController分页调用multiplyNumHandle(dto,100)，服务端响应中的healthyFemaleRate已经是数据库比例小数乘100后的值；Portal编辑弹窗又把列表值乘100回显，提交时再除以100。直接调用prepareUpdate时应传入Portal弹窗formState值，不能把列表返回值未经页面回显转换直接当作弹窗百分数。',
  'Portal编辑提交展开...props.raw，SDK保留列表行扩展字段并覆盖编辑字段和ID；删除使用DELETE /base/hatchAnnualMonthly/{id}，prepare阶段只准备ID，取消时不得发送请求。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/standard-manage/hatch-annual-monthly.vue、app/portal/views/dashboard/product/setting/standard-manage/hatch-annual-monthly/list.vue', kind: 'reference', note: '逐页核对菜单/路由、权限、product实例、孵化厅映射、查询默认值、分页和CRUD端点。' },
  { source: 'app/portal/views/dashboard/product/setting/standard-manage/hatch-annual-monthly/modal-form-content.vue、app/portal/utils/http/product.js', kind: 'reference', note: '逐字段核对年度/月度/孵化厅/健母雏率/蛋雏比/年月类型必填、范围、百分数换算、raw透传和请求头。' },
  { source: 'HatchAnnualMonthlyController.java、HatchAnnualMonthly.java、HatchAnnualMonthlyServiceImpl.java、HatchAnnualMonthlyMapperExt.xml、PageParam.java', kind: 'reference', note: '核对Java端点、分页层级、健母雏率乘100、ID区分新建/更新、软删除和筛选条件；同时记录hallName补充代码与Portal映射之间的边界。' },
  { source: 'src/capabilities/product-setting-hatch-annual-monthly.ts、test/product-setting-hatch-annual-monthly.test.ts', kind: 'implementation', note: '锁定请求形状、健母雏率转换、年月类型、raw扩展字段、权限上下文、AI说明注册和坏输入反证；未替代真实测试环境写入闭环。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐项执行列表、新建、编辑、删除并回查记录；当前证据为Portal/Java源码和离线请求形状测试。',
  '尚未在真实租户确认健母雏率数据库比例、Java分页响应、Portal编辑二次乘100和回查显示之间的实际数值；SDK已如实保留源码中的换算边界。',
  'Java服务代码按dto.getHallName()查询组织名称而不是按dto.getHall()查询；Portal列表实际使用孵化厅选项映射，因此hallName不作为编辑或显示的唯一依据。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-hatch-annual-monthly-', '')
  if (suffix === 'list') return {
    hall: param('孵化厅ID；省略时发送空字符串。', '年月指标目标标准列表筛选表单', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按孵化厅筛选。' }),
    year: param('年度；省略时发送空字符串。', '年月指标目标标准列表筛选表单', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按年度筛选。' }),
    month: param('月份；省略时按Portal默认发送1，传null表示清空月份筛选。', '年月指标目标标准列表筛选表单', { type: '1..12 | null', required: false, default: '1', nullable: true, nullMeaning: '不按月份筛选。' }),
    pageNo: param('从1开始的页码；默认1。', 'Portal列表分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal styleV2列表分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-create') return { form: param('年月指标目标标准新建弹窗表单；年度、月度、孵化厅、健母雏率、蛋雏比和年月类型均必填，健母雏率按百分数填写。', '用户填写的Portal新建弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'create') return { draft: param('prepareCreate返回的请求草稿；健母雏率已经是比例小数，确认后原样交给create。', 'productSettingHatchAnnualMonthly.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-update') return { form: param('年月指标目标标准编辑弹窗表单；必须带当前行ID，健母雏率按弹窗百分数填写，并保留raw扩展字段。', '当前列表行经过Portal编辑弹窗回显和用户修改后的表单', { type: 'object', required: true }) }
  if (suffix === 'update') return { draft: param('prepareUpdate返回的含ID请求草稿；健母雏率已经是比例小数，确认后原样交给update。', 'productSettingHatchAnnualMonthly.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-remove') return { id: param('当前列表行的年月指标目标标准ID；用户确认前只准备，不发送DELETE。', 'productSettingHatchAnnualMonthly.list.result.list[].id', { type: 'string | number', required: true }) }
  if (suffix === 'remove') return { id: param('prepareRemove返回的ID；用户确认后执行DELETE。', 'productSettingHatchAnnualMonthly.prepareRemove.result.id', { type: 'string | number', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-hatch-annual-monthly-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认新建草稿', capabilityId: 'product-setting-hatch-annual-monthly-create', mapping: { draft: 'result.draft' }, instruction: '把prepareCreate.result.draft原样交给create；不要再次把健母雏率乘回百分数。' })
    steps.push({ role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-hatch-annual-monthly-list', mapping: {}, instruction: '重新调用list，按ID、孵化厅、年度、月份和健母雏率回查；true只表示请求未抛错。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认编辑草稿', capabilityId: 'product-setting-hatch-annual-monthly-update', mapping: { draft: 'result.draft' }, instruction: '把prepareUpdate.result.draft原样交给update，保留当前行ID和Portal raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-hatch-annual-monthly-list', mapping: {}, instruction: '重新调用list按ID和编辑后的字段回查；不能只依据true宣布更新已落库。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前列表行', capabilityId: 'product-setting-hatch-annual-monthly-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove.result.id交给remove；确认前不发送DELETE。' })
    steps.push({ role: 'cancel', when: '用户取消删除', instruction: '只丢弃id，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: 'DELETE请求成功或响应不确定', capabilityId: 'product-setting-hatch-annual-monthly-list', mapping: {}, instruction: '重新调用list确认同一ID不再出现；true只表示请求未抛错。' })

  let output: AiContract['output'] = trueOutput
  if (isList) output = listOutput
  else if (isPrepareCreate) output = createOutput
  else if (isPrepareUpdate) output = updateOutput
  else if (isPrepareRemove) output = { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的年月指标目标标准ID。')], empty: 'ID为空或不是字符串/安全整数时抛错，且不发送DELETE。' }
  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'
  return {
    purpose: isList ? '按孵化厅、年度和月份筛选分页读取年月指标目标标准。' : isPrepareCreate ? '按Portal新建弹窗规则准备年月指标目标标准请求草稿。' : isCreate ? '按Portal保存端点新建一条年月指标目标标准。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备含原始扩展字段的年月指标目标标准草稿。' : isUpdate ? '按Portal保存端点编辑一条已有年月指标目标标准。' : isPrepareRemove ? '准备一个经过用户确认的年月指标目标标准ID。' : '按Portal删除端点删除一条年月指标目标标准。',
    whenToUse: `需要在${PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用；列表healthyFemaleRate已经是服务端乘100后的响应值，提交草稿才是除以100后的比例小数。`,
    boundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面菜单权限；写操作目标应来自当前列表行或同一次prepare结果。', ...(isCreate || isUpdate || isRemove ? ['请求成功或响应不确定后必须list回查业务终态。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isList ? ['用list[].id进入编辑或删除确认；直接展示列表healthyFemaleRate时按服务端乘100后的响应值解释。若要复刻Portal编辑弹窗，先按源码的回显规则再次处理健母雏率，再把form交给prepareUpdate。'] : isPrepareCreate || isPrepareUpdate ? ['把draft展示给用户确认；draft中的healthyFemaleRate已经是比例小数，确认后原样提交。'] : isPrepareRemove ? ['向用户展示待删除ID对应的当前列表行，确认前不发请求。'] : ['请求成功或不确定后按steps回查list；不要把true当作记录已经创建、更新或删除的证据。'],
    steps,
    completion: isList ? '获得当前筛选和分页下的年月指标目标标准记录及总数。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal URL、HTTP方法、请求体和页面字段规则完成；记录最终状态仍需list回查。',
    failures: ['年度、月度、孵化厅、健母雏率、蛋雏比、年月类型、ID、分页、菜单权限、服务端业务校验、网络错误或响应结构错误均应抛出；列表失败不得降级为空列表，写入不确定时先回查再决定是否重试。'],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；新建或编辑请求超时/响应不确定时先list回查，删除同样先list确认ID是否仍存在，避免重复副作用。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingHatchAnnualMonthlyCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`年月指标目标标准契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHODS).map(([id, method]) => [
    `productSettingHatchAnnualMonthly.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingHatchAnnualMonthly.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
