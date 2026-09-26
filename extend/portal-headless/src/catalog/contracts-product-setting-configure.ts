import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_CONFIGURE_METHODS,
  PRODUCT_SETTING_CONFIGURE_PAGE_PATH,
  productSettingConfigureCapabilities,
} from '../capabilities/product-setting-configure.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingConfigureCapabilities.map(definition => [definition.id, definition]))

const rowFields: AiField[] = [
  field('id', 'string | number | null', '配置指标ID；编辑详情和提交目标。', { nullable: true, nullMeaning: '后端没有返回可用ID，不能编辑。' }),
  field('code', 'string | null', '字段编码。', { nullable: true, nullMeaning: '后端没有返回编码。' }),
  field('name', 'string | null', '指标名称。', { nullable: true, nullMeaning: '后端没有返回名称。' }),
  field('fieldType', 'integer | null', '字段类型原始值；页面1文本、2数字、3日期、4下拉框、5单选、6多选。', { nullable: true, nullMeaning: '后端没有返回字段类型。' }),
  field('multipleAttribute', 'integer | null', '字段属性原始字典值。', { nullable: true, nullMeaning: '后端没有返回字段属性。' }),
  field('decimalPlace', 'integer | null', '数字字段的小数位数。', { nullable: true, nullMeaning: '后端没有返回小数位数。' }),
  field('unit', 'string | null', '字段单位。', { nullable: true, nullMeaning: '没有配置单位。' }),
  field('general', 'integer | null', '通用标识；Java实体字段。', { nullable: true, nullMeaning: '后端没有返回通用标识。' }),
  field('defaultValue', 'string | null', '默认值。', { nullable: true, nullMeaning: '没有配置默认值。' }),
  field('required', 'integer | null', '是否必须；Java实体语义为1必须、2不必须。', { nullable: true, nullMeaning: '后端没有返回是否必须。' }),
  field('maxValue', 'integer | null', '允许的最大值。', { nullable: true, nullMeaning: '没有配置最大值。' }),
  field('minValue', 'integer | null', '允许的最小值。', { nullable: true, nullMeaning: '没有配置最小值。' }),
  field('dateType', 'string | null', '日期字段的日/周/月/年类型。', { nullable: true, nullMeaning: '非日期字段或未配置。' }),
  field('dicts', 'string | null', '多属性字段对应的字典类型。', { nullable: true, nullMeaning: '未配置字典类型。' }),
  field('createDate', 'string | null', '创建时间；后端字段。', { nullable: true, nullMeaning: '后端没有返回创建时间。' }),
  field('updateDate', 'string | null', '修改时间；后端字段。', { nullable: true, nullMeaning: '后端没有返回修改时间。' }),
  field('remarks', 'string | null', '备注；后端字段。', { nullable: true, nullMeaning: '没有备注。' }),
  field('delFlag', 'integer | null', '删除标记；正常值为0。', { nullable: true, nullMeaning: '后端没有返回删除标记。' }),
  field('type', 'integer | null', '后端类型；编辑提交固定为1。', { nullable: true, nullMeaning: '后端没有返回类型。' }),
]

const updateFields: AiField[] = [
  field('$', 'object', 'Portal编辑提交体；不是数组。'),
  field('draft', 'object', '已经通过Portal编辑表单规则、尚未发送的提交体。'),
  field('draft.id', 'string | number', '当前详情的配置指标ID。'),
  field('draft.type', '1', 'Portal固定发送的类型值。'),
  field('draft.code', 'string', '字段编码，非空。'),
  field('draft.name', 'string', '字段名称，非空。'),
  field('draft.fieldType', 'string', '字段类型；Portal字典表单输出字符串。'),
  field('draft.multipleAttribute', 'string | number', '字段属性；非空。'),
  field('draft.defaultValue', 'string', '默认数值；无值时为空字符串。'),
  field('draft.minValue', 'string | number', '最小数值；Portal自定义校验允许空字符串。'),
  field('draft.maxValue', 'string | number', '最大数值；Portal自定义校验允许空字符串。'),
  field('draft.decimalPlace', 'integer', '小数位数；页面输入控件要求非负整数。'),
  field('draft.required', 'string | number', '默认展开/是否必须的字典值；Portal没有为该表单项配置required规则。'),
  field('draft.unit', 'string', '字段单位；无值时为空字符串。'),
]

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求完成后的本地成功确认；没有包含更新后的指标对象。')],
  empty: '请求抛错时没有成功结果；true不等于列表已回查确认。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_CONFIGURE_PAGE_PATH}，菜单权限是/dashboard/frame/business/configure；列表查询受broiler:configtest:query控制，编辑受broiler:configtest:edit控制，页面还声明了broiler:configtest:delete。SDK不绕过页面或服务端权限。`,
  '所有请求使用Portal product实例并补devicetype=PC；该页面module-type推导结果为null，因此不发送module-type。',
  '列表customLoad收到useListPageModule的order、orderField、name后再追加type=1；页面getDataListIsPage=false，所以不发送pageNo/pageSize，最终返回数组而不是分页对象。',
  '详情使用GET /config/traitIndex/{id}；product响应拦截器会把只有traitIndex字段的data解包成指标对象。',
  '编辑弹窗只在编辑入口可达；提交body固定为type、code、name、fieldType、multipleAttribute、defaultValue、minValue、maxValue、decimalPlace、required、unit，并在有ID时追加id。',
  'Portal的删除按钮调用rrList.actionDelete，但该页没有配置deleteURL或customDelete，Java TraitController也没有DELETE映射；SDK不注册一个不可达或猜测的删除能力。',
  'Portal提交体是对象而不是数组，与当前Java TraitController的@RequestBody List<Trait>签名存在形状差异；SDK保持Portal实际发送的对象形状，并在真实环境闭环前将其视为未解决证据缺口，不把离线请求成功当作后端落库。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/setting/business-manage/configure/list.vue', kind: 'reference', note: '逐页核对菜单路径、product实例、query/edit/delete权限、name筛选、type=1、非分页数组、详情读取、编辑和删除入口。' },
  { source: 'app/portal/views/dashboard/product/setting/business-manage/configure/modal-form-content.vue 与 common/libs/renren/list.js', kind: 'reference', note: '逐字段核对默认值、必填规则、自定义数字校验、提交字段、ID追加规则以及actionDelete未配置删除处理器的行为。' },
  { source: 'TraitController、Trait、TraitDao.xml、TraitService', kind: 'reference', note: '核对列表/详情/POST映射、响应字段、软删除SQL、保存循环和POST要求List<Trait>的服务端形状。' },
  { source: 'src/capabilities/product-setting-configure.ts 与 test/product-setting-configure.test.ts', kind: 'implementation', note: '锁定Portal请求、表单规则、对象提交体、非分页响应、权限边界和离线反证；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置配置指标.md', kind: 'reference', note: '记录页面四件套、可达能力、删除缺口和后端请求形状差异。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行查询、GET详情、prepare → POST编辑 → 回查闭环；尤其未确认Portal对象提交是否会被当前Java List<Trait>接口接受。',
  '删除按钮的Portal通用调用没有URL处理器且Java没有DELETE映射；在Portal修复前无法提供真实删除能力。',
]

const listInputs: Record<string, AiParameter> = {
  name: param('指标名或编码前缀筛选；省略时发送空字符串。', '用户筛选或页面默认值', { type: 'string', required: false, default: '' }),
}

const formInput = param('Portal编辑弹窗表单；code、name、fieldType、multipleAttribute必填，minValue/maxValue按Portal自定义数字校验，其他字段按页面默认值保持。', '用户在详情弹窗确认的表单', { type: 'object', required: true, constraints: ['编辑入口必须保留当前详情id', 'minValue/maxValue允许空字符串', '提交体type固定为1'] })
const draftInput = param('prepareUpdate返回的完整对象草稿；不要改成数组或删除空字符串字段。', 'productSettingConfigure.prepareUpdate.result.draft', { type: 'object', required: true })

function outputFields (prefix: string): AiField[] {
  return rowFields.map(item => ({ ...item, path: `${prefix}${item.path}` }))
}

function inputFor (id: string): Record<string, AiParameter> {
  if (id === 'product-setting-configure-list') return listInputs
  if (id === 'product-setting-configure-get') return { id: param('当前列表行配置指标ID。', 'productSettingConfigure.list.result[].id', { type: 'string | number', required: true }) }
  if (id === 'product-setting-configure-prepare-update') return { form: formInput }
  return {
    draft: draftInput,
    'draft.id': param('编辑草稿中的配置指标ID；从同一份draft取出作为详情回查定位。', 'productSettingConfigure.prepareUpdate.result.draft.id', { type: 'string | number', required: true }),
  }
}

function contractFor (id: string): AiContract {
  const isList = id === 'product-setting-configure-list'
  const isGet = id === 'product-setting-configure-get'
  const isPrepare = id === 'product-setting-configure-prepare-update'
  const steps: AiContract['steps'] = []
  if (isPrepare) {
    steps.push({ role: 'required', when: '用户确认编辑当前指标', capabilityId: 'product-setting-configure-update', mapping: { draft: 'result.draft' }, instruction: '只把同一份draft交给update；用户取消时不发POST。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不调用更新接口。' })
  }
  if (!isList && !isGet && !isPrepare) {
    steps.push({ role: 'required', when: '用户确认保存编辑表单', capabilityId: 'product-setting-configure-prepare-update', mapping: { form: 'args.draft' }, instruction: '先用同一表单执行prepareUpdate；通过后才提交。' })
    steps.push({ role: 'required', when: '更新成功或响应超时需要确认最终状态', capabilityId: 'product-setting-configure-get', mapping: { id: 'args.draft.id' }, instruction: '按同一ID读取详情逐字段核对，不要只把true回执当作已落库。' })
    steps.push({ role: 'cancel', when: '用户拒绝提交', instruction: '丢弃draft，不发送POST。' })
  }
  return {
    purpose: isList ? '读取配置指标数组。' : isGet ? '读取一个配置指标的编辑详情。' : isPrepare ? '按Portal配置指标编辑弹窗规则准备尚未写入的对象草稿。' : '按Portal编辑入口提交一个配置指标。',
    whenToUse: `需要在${PRODUCT_SETTING_CONFIGURE_PAGE_PATH}页面执行${isList ? '查询' : isGet ? '读取详情' : isPrepare ? '准备编辑' : '提交编辑'}时使用。`,
    effect: isPrepare ? 'prepare' : isList || isGet ? 'read' : 'write',
    inputs: inputFor(id),
    output: isList
      ? { shape: 'object[]', fields: [field('$', 'object[]', '非分页配置指标数组。'), ...outputFields('[].')], empty: '[]表示当前Portal列表没有记录；权限、网络或后端错误会抛出。' }
      : isGet
        ? { shape: 'object', fields: [field('$', 'object', '当前配置指标详情。'), ...outputFields('')], empty: 'ID无效或后端没有详情时抛错。' }
        : isPrepare
          ? { shape: '{ draft: object }', fields: updateFields, empty: '字段必填、数字校验、ID或小数位数不满足Portal规则时抛错，不发送网络请求。' }
          : trueOutput,
    consume: isList
      ? ['使用list[].id进入get和编辑流程；页面没有分页，不能把数组长度当作total。']
      : isGet
        ? ['把详情完整交给prepareUpdate，保留id和页面未编辑字段。']
        : isPrepare
          ? ['用户取消时只丢弃draft；确认时把同一draft交给update。']
          : ['true只表示POST没有抛错；必须按同一ID调用get逐字段回查。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认拥有页面及query/edit权限。', ...(isPrepare || (!isList && !isGet) ? ['编辑草稿来自当前详情，不能把不可达的新建或删除动作当作本页能力。'] : [])],
    steps,
    completion: isList ? '获得Portal customLoad消费的配置指标数组。' : isGet ? '获得当前ID的完整详情。' : isPrepare ? '获得尚未写入的Portal对象草稿。' : 'POST完成且详情回查确认目标字段一致。',
    failures: ['字段、ID、权限、网络或Java业务错误均抛出，不能降级为空数组或假成功。', ...(!isList && !isGet && !isPrepare ? ['当前Java接口声明接收List<Trait>而Portal发送对象；如果服务端拒绝，必须如实报告，不自动改变请求形状。'] : [])],
    idempotency: isList || isGet || isPrepare ? null : '后端没有requestId；POST结果不确定时先按ID回查，再决定是否重试，避免覆盖并发编辑。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingConfigureCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`配置指标契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_CONFIGURE_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_CONFIGURE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_CONFIGURE_METHODS).map(([id, method]) => [
    `productSettingConfigure.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingConfigure.${method}；编辑写操作遵循prepare→submit→get回查步骤。`] },
  ]),
)
