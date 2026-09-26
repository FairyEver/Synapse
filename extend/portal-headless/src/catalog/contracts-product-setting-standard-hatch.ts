import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_STANDARD_HATCH_METHODS,
  PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH,
  PRODUCT_SETTING_STANDARD_HATCH_PERMISSION,
  PRODUCT_SETTING_STANDARD_HATCH_QUERY_PERMISSION,
  PRODUCT_SETTING_STANDARD_HATCH_SUBMIT_PERMISSION,
  productSettingStandardHatchCapabilities,
} from '../capabilities/product-setting-standard-hatch.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingStandardHatchCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const rowFields: AiField[] = [
  field('$', 'object', '孵化健母率标准分页结果；list是当前页，total是筛选条件下的总记录数。'),
  field('list', 'array', '当前页的孵化健母率标准记录。'),
  field('list[]', 'object', '孵化健母率标准列表行；SDK保留Java实体返回的其他扩展字段。'),
  field('list[].id', 'string | number | null', '记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回可用ID，不能安全编辑或删除。' }),
  field('list[].year', 'number | null', '年度。', { nullable: true, nullMeaning: '后端没有返回年度。' }),
  field('list[].ageStage', 'string | null', '日龄段ID；页面通过ageStageOptions把它映射为日龄段名称。', { nullable: true, nullMeaning: '后端没有返回日龄段ID。' }),
  field('list[].gen', 'string | null', '代次字典值；页面展示和筛选使用。', { nullable: true, nullMeaning: '后端没有返回代次。' }),
  field('list[].hall', 'string | null', '孵化厅/场区ID；页面通过场区选项映射名称。', { nullable: true, nullMeaning: '后端没有返回孵化厅ID。' }),
  field('list[].hallName', 'string | null', '后端可选的孵化厅名称扩展字段；StandardHatch实体当前未声明该业务字段，通常为空。', { nullable: true, nullMeaning: '后端未返回孵化厅名称，调用方应使用场区选项映射。' }),
  field('list[].variety', 'string | null', '品种字典值；页面展示和筛选使用。', { nullable: true, nullMeaning: '后端没有返回品种。' }),
  field('list[].genDown', 'integer | null', '是否降代：0否、1是。', { nullable: true, values: { '0': '否', '1': '是' }, nullMeaning: '后端没有返回是否降代。' }),
  field('list[].healthyFemaleRate', 'number | null', '健母率标准；StandardHatchServiceImpl分页响应已把数据库比例小数乘以100，SDK保持服务端响应值。', { nullable: true, unit: '百分数值', nullMeaning: '后端没有返回健母率标准。' }),
  field('list[].abnormalFemaleRate', 'number | null', '残母雏率标准；Java分页响应按比例小数乘100，Portal表单未配置required。', { nullable: true, unit: '百分数值', nullMeaning: '后端没有返回残母雏率标准。' }),
  field('list[].eggChickRatio', 'number | null', '蛋雏比标准；服务端原始数值。', { nullable: true, nullMeaning: '后端没有返回蛋雏比标准。' }),
  field('list[].chickWeight', 'number | null', '雏鸡体重标准，单位克；服务端原始数值。', { nullable: true, unit: '克', nullMeaning: '后端没有返回雏鸡体重标准。' }),
  field('list[].fertilizedHatchingRate', 'number | null', '受精卵孵化率标准；Java分页响应按比例小数乘100。', { nullable: true, unit: '百分数值', nullMeaning: '后端没有返回受精卵孵化率标准。' }),
  field('list[].excludedBloodFertilityRate', 'number | null', '不含血受精率标准；Java分页响应按比例小数乘100。', { nullable: true, unit: '百分数值', nullMeaning: '后端没有返回不含血受精率标准。' }),
  field('list[].satisfaction', 'number | null', '满意度标准；服务端原始数值。', { nullable: true, nullMeaning: '后端没有返回满意度标准。' }),
  field('total', 'integer', '筛选条件下的记录总数，不是当前页长度。'),
]

const optionFields: AiField[] = [
  field('$', 'array', 'Portal单独读取的日龄段选项数组。'),
  field('[]', 'object', '一个日龄段选项。'),
  field('[].id', 'string | number', '日龄段ID；填入标准健母率保存表单的ageStage。'),
  field('[].stage', 'string | null', '日龄段展示名称；空值时Portal会以空标签或原值处理。', { nullable: true, nullMeaning: '后端没有返回名称。' }),
]

const draftFields: AiField[] = [
  field('$', 'object', '通过Portal新建/编辑弹窗必填项和数值范围校验、尚未发送请求的保存草稿。'),
  field('draft', 'object', '保存请求体；healthyFemaleRate、fertilizedHatchingRate、excludedBloodFertilityRate和abnormalFemaleRate按页面百分数除以100，后三者中abnormalFemaleRate可为null。'),
  field('draft.year', 'number', '年度；Portal必填，范围1970至10000000。'),
  field('draft.ageStage', 'string | number', '日龄段ID；Portal必填，来自ageStageOptions。'),
  field('draft.gen', 'string', '代次字典值；Portal必填。'),
  field('draft.hall', 'string | number', '孵化厅/场区ID；Portal必填。'),
  field('draft.variety', 'string', '品种字典值；Portal必填。'),
  field('draft.genDown', 'integer', '是否降代：0否、1是；Portal必填。', { values: { '0': '否', '1': '是' } }),
  field('draft.healthyFemaleRate', 'number', '健母率标准；页面按百分数填写，保存草稿为除以100后的比例小数。'),
  field('draft.abnormalFemaleRate', 'number | null', '残母雏率标准；页面未配置required，空值在请求载荷中为null；非空时按百分数除以100。', { nullable: true, nullMeaning: 'Portal表单未填写残母雏率。' }),
  field('draft.eggChickRatio', 'number', '蛋雏比标准；页面原值提交。'),
  field('draft.chickWeight', 'number', '雏鸡体重标准，单位克；页面原值提交。'),
  field('draft.fertilizedHatchingRate', 'number', '受精卵孵化率标准；页面按百分数填写，保存草稿为除以100后的比例小数。'),
  field('draft.excludedBloodFertilityRate', 'number', '不含血受精率标准；页面按百分数填写，保存草稿为除以100后的比例小数。'),
  field('draft.satisfaction', 'number', '满意度标准；页面原值提交。'),
]

const updateDraftFields: AiField[] = [...draftFields, field('draft.id', 'string | number', '当前列表行的孵化健母率标准ID；Java根据ID是否存在选择更新或新建。')]
const listOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: rowFields, empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录；权限、网络或响应结构错误会抛出，不降级为空列表。' }
const ageStageOptionsOutput: AiContract['output'] = { shape: 'array<object>', fields: optionFields, empty: '[]表示没有可选日龄段；权限、网络或响应结构错误会抛出。' }
const createOutput: AiContract['output'] = { shape: '{ draft: object }', fields: draftFields, empty: '年度、日龄段、代次、孵化厅、品种、是否降代、健母率、蛋雏比、雏鸡体重、受精卵孵化率、不含血受精率或满意度缺失，或数值超出页面范围时抛错且不发送POST；残母雏率可为空。' }
const updateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: updateDraftFields, empty: '缺少当前行ID、必填字段或数值超出页面范围时抛错且不发送POST。' }

const boundaries = [
  `页面范围是${PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_STANDARD_HATCH_PERMISSION}；它属于门户系统设置→生产设置，不是独立生产系统。`,
  `Portal页面声明了query权限${PRODUCT_SETTING_STANDARD_HATCH_QUERY_PERMISSION}和submit权限${PRODUCT_SETTING_STANDARD_HATCH_SUBMIT_PERMISSION}；查询没有单独调用query，新增、编辑和删除由permissionCheck(permissions.submit)控制。SDK不绕过服务端当前会话的实际权限校验。`,
  '主列表、日龄段选项和CRUD请求都使用Portal product HTTP实例，路径分别以/base/standardHatch或/egg/standardAgeStage开头，固定追加devicetype=PC；本页不发送module-type。',
  '列表固定发送order=""、orderField=""、ageStage、hall、gen、variety、year、genDown、pageNo和pageSize；页面默认ageStage/hall/gen/variety/year为空字符串、genDown=0，分页支持10/20/50/100。列表表单的hall、gen、year、genDown有required规则，但首次logicFetch仍使用这些默认值。',
  '新建和编辑弹窗的year、ageStage、gen、hall、variety、genDown、healthyFemaleRate、eggChickRatio、chickWeight、fertilizedHatchingRate、excludedBloodFertilityRate、satisfaction有required规则；abnormalFemaleRate明确没有required规则。year范围为1970至10000000，其余数字输入范围为-10000000至10000000。',
  'StandardHatchServiceImpl详情/分页响应会把abnormalFemaleRate、excludedBloodFertilityRate、healthyFemaleRate和fertilizedHatchingRate从数据库比例小数乘100；Portal编辑弹窗直接使用接口原值回显，提交时四个率再除以100。eggChickRatio、chickWeight和satisfaction不做百分比换算。',
  'Portal编辑提交展开...props.raw，SDK保留列表行扩展字段并覆盖编辑字段和ID；Java根据ID是否存在选择更新或新建。删除使用DELETE /base/standardHatch/{id}，prepare阶段只准备ID，取消时不得发送请求。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/standard-manage/standard-hatch.vue、app/portal/views/dashboard/product/setting/standard-manage/standard-hatch/list.vue', kind: 'reference', note: '逐页核对菜单/路由、权限、product实例、默认筛选、列表required规则、日龄段选项请求、submit权限控制和CRUD端点。' },
  { source: 'app/portal/views/dashboard/product/setting/standard-manage/standard-hatch/modal-form-content.vue、app/portal/components/portal/product/select/farm/index.vue、app/portal/utils/http/product.js', kind: 'reference', note: '逐字段核对弹窗required差异、Number转换、四个率除100、raw透传、日龄段/场区选项依赖和product请求头。' },
  { source: 'StandardHatchController.java、StandardHatch.java、StandardHatchServiceImpl.java、StandardHatchMapperExt.xml、StandardHatchMapper.xml', kind: 'reference', note: '核对Java端点、四个率乘100、ID区分新建/更新、软删除、筛选条件和实体字段。' },
  { source: 'src/capabilities/product-setting-standard-hatch.ts、test/product-setting-standard-hatch.test.ts', kind: 'implementation', note: '锁定默认genDown、选项读取、表单required差异、四个率转换、raw扩展字段、权限上下文、AI说明注册和坏输入反证；未替代真实测试环境写入闭环。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐项执行列表、日龄段选项、新建、编辑、删除并回查记录；当前证据为Portal/Java源码和离线请求形状测试。',
  '尚未在真实租户确认场区选择器返回的ID类型和四个比例字段的实际数据库值；SDK按Portal/Java源码保留字符串/数字和乘100/除100边界。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-standard-hatch-', '')
  if (suffix === 'list') return {
    ageStage: param('日龄段ID；省略时发送空字符串。', '孵化健母率标准列表筛选表单', { type: 'string | number', required: false, nullable: true }),
    hall: param('孵化厅/场区ID；省略时发送空字符串。', 'Portal场区选择器', { type: 'string | number', required: false, nullable: true }),
    gen: param('代次字典值；省略时发送空字符串。', '孵化健母率标准列表筛选表单', { type: 'string', required: false, nullable: true }),
    variety: param('品种字典值；省略时发送空字符串。', '孵化健母率标准列表筛选表单', { type: 'string', required: false, nullable: true }),
    year: param('年度；省略时发送空字符串。', 'Portal年选择器', { type: 'string | number', required: false, nullable: true }),
    genDown: param('是否降代：0否、1是；默认0。', '孵化健母率标准列表单选', { type: '0 | 1', required: false, default: '0', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] }),
    pageNo: param('从1开始的页码；默认1。', 'Portal列表分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal styleV2列表分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'age-stage-options') return {}
  if (suffix === 'prepare-create') return { form: param('孵化健母率标准新建弹窗表单；除残母雏率外的12项页面required字段均必填，四个率按百分数填写。', '用户填写的Portal新建弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'create') return { draft: param('prepareCreate返回的请求草稿；四个率已经是比例小数，确认后原样交给create。', 'productSettingStandardHatch.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-update') return { form: param('孵化健母率标准编辑弹窗表单；必须带当前行ID，残母雏率可为空，四个率按弹窗百分数填写，并保留raw扩展字段。', '当前列表行与用户编辑后的Portal弹窗表单', { type: 'object', required: true }) }
  if (suffix === 'update') return { draft: param('prepareUpdate返回的含ID请求草稿；四个率已经是比例小数，确认后原样交给update。', 'productSettingStandardHatch.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-remove') return { id: param('当前列表行的孵化健母率标准ID；用户确认前只准备，不发送DELETE。', 'productSettingStandardHatch.list.result.list[].id', { type: 'string | number', required: true }) }
  if (suffix === 'remove') return { id: param('prepareRemove返回的ID；用户确认后执行DELETE。', 'productSettingStandardHatch.prepareRemove.result.id', { type: 'string | number', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-standard-hatch-', '')
  const isList = suffix === 'list'
  const isAgeStageOptions = suffix === 'age-stage-options'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认新建草稿', capabilityId: 'product-setting-standard-hatch-create', mapping: { draft: 'result.draft' }, instruction: '把prepareCreate.result.draft原样交给create；不要再次把四个率乘回百分数。' })
    steps.push({ role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-standard-hatch-list', mapping: {}, instruction: '重新调用list，按ID、年度、日龄段、孵化厅、代次、品种、是否降代和指标字段回查；true只表示请求未抛错。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认编辑草稿', capabilityId: 'product-setting-standard-hatch-update', mapping: { draft: 'result.draft' }, instruction: '把prepareUpdate.result.draft原样交给update，保留当前行ID和Portal raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送保存请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: 'POST请求成功或响应不确定', capabilityId: 'product-setting-standard-hatch-list', mapping: {}, instruction: '重新调用list按ID和编辑后的字段回查；不能只依据true宣布更新已落库。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前列表行', capabilityId: 'product-setting-standard-hatch-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove.result.id交给remove；确认前不发送DELETE。' })
    steps.push({ role: 'cancel', when: '用户取消删除', instruction: '只丢弃id，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: 'DELETE请求成功或响应不确定', capabilityId: 'product-setting-standard-hatch-list', mapping: {}, instruction: '重新调用list确认同一ID不再出现；true只表示请求未抛错。' })

  let output: AiContract['output'] = trueOutput
  if (isList) output = listOutput
  else if (isAgeStageOptions) output = ageStageOptionsOutput
  else if (isPrepareCreate) output = createOutput
  else if (isPrepareUpdate) output = updateOutput
  else if (isPrepareRemove) output = { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的孵化健母率标准ID。')], empty: 'ID为空或不是字符串/安全整数时抛错，且不发送DELETE。' }
  const effect: AiContract['effect'] = isList || isAgeStageOptions ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'
  return {
    purpose: isList ? '按日龄段、孵化厅、代次、品种、年度和是否降代筛选分页读取孵化健母率标准。' : isAgeStageOptions ? '读取Portal孵化健母率标准页使用的日龄段ID与名称选项。' : isPrepareCreate ? '按Portal新建弹窗规则准备孵化健母率标准请求草稿。' : isCreate ? '按Portal保存端点新建一条孵化健母率标准。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备含原始扩展字段的孵化健母率标准草稿。' : isUpdate ? '按Portal保存端点编辑一条已有孵化健母率标准。' : isPrepareRemove ? '准备一个经过用户确认的孵化健母率标准ID。' : '按Portal删除端点删除一条孵化健母率标准。',
    whenToUse: `需要在${PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH}页面执行对应${isList ? '查询' : isAgeStageOptions ? '日龄段选项读取' : '操作'}时使用；列表四个率已经是服务端乘100后的值，提交草稿才是除以100后的比例小数。`,
    boundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面菜单权限；写操作目标应来自当前列表行或同一次prepare结果。', ...(isCreate || isUpdate || isRemove ? ['请求成功或响应不确定后必须list回查业务终态。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isList ? ['用list[].id进入编辑或删除确认；用ageStageOptions按list[].ageStage显示日龄段名称，用场区选项按list[].hall显示孵化厅名称；展示四个率时按服务端乘100后的百分数值解释。'] : isAgeStageOptions ? ['用[].id填入prepareCreate/prepareUpdate的ageStage；用[].stage作为页面展示名称，不把名称代替ID提交。'] : isPrepareCreate || isPrepareUpdate ? ['把draft展示给用户确认；draft中的四个率已经是比例小数，确认后原样提交。'] : isPrepareRemove ? ['向用户展示待删除ID对应的当前列表行，确认前不发请求。'] : ['请求成功或不确定后按steps回查list；不要把true当作记录已经创建、更新或删除的证据。'],
    steps,
    completion: isList ? '获得当前筛选和分页下的孵化健母率标准记录及总数。' : isAgeStageOptions ? '获得Portal日龄段选择器使用的ID与名称选项。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal URL、HTTP方法、请求体和页面字段规则完成；记录最终状态仍需list回查。',
    failures: ['年度、日龄段、代次、孵化厅、品种、是否降代、页面required指标、数值范围、ID、分页、菜单权限、服务端业务校验、网络错误或响应结构错误均应抛出；abnormalFemaleRate可为空；列表失败不得降级为空列表。', ...(isAgeStageOptions ? ['日龄段选项响应不是数组或缺少有效id时抛出。'] : [])],
    idempotency: isList || isAgeStageOptions || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；新建或编辑请求超时/响应不确定时先list回查，删除同样先list确认ID是否仍存在，避免重复副作用。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingStandardHatchCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`孵化健母率标准契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_STANDARD_HATCH_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_STANDARD_HATCH_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_STANDARD_HATCH_METHODS).map(([id, method]) => [
    `productSettingStandardHatch.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingStandardHatch.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
