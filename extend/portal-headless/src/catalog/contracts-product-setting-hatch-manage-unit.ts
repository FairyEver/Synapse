import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_METHODS,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_UNIT_SUBMIT_PERMISSION,
  productSettingHatchManageUnitCapabilities,
} from '../capabilities/product-setting-hatch-manage-unit.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingHatchManageUnitCapabilities.map(definition => [definition.id, definition]))

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '标准设置分页结果；Portal product响应解包后的page对象，后端偶尔也可能直接返回数组。'),
    field('list', 'array', '当前筛选和分页下的指标记录；直接数组响应会按数组长度补total。'),
    field('list[]', 'object', 'ProgramUnit列表行；SDK保留后端原始扩展字段，并规范页面实际消费字段。'),
    field('list[].id', 'string | number | null', 'ProgramUnit记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回记录ID，不能安全执行页面写操作。' }),
    field('list[].classification', 'string | number | null', '指标归类原始字典值；编辑弹窗回填归类。', { nullable: true, nullMeaning: '后端没有返回归类值。' }),
    field('list[].traitTypeName', 'string | null', '指标归类展示名称；表格第一列。', { nullable: true, nullMeaning: '后端没有补归类展示名称。' }),
    field('list[].name', 'string | null', '指标名称；表格和编辑字段。', { nullable: true, nullMeaning: '后端没有返回名称。' }),
    field('list[].unit', 'string | null', '指标单位；只有数值类型页面表单要求它。', { nullable: true, nullMeaning: '非数值指标或后端没有单位。' }),
    field('list[].code', 'string | null', '指标编码；新建和编辑必填，后端按它检查重复。', { nullable: true, nullMeaning: '后端没有返回指标编码。' }),
    field('list[].contentType', 'number | null', '文本类型：1纯文本、2富文本、3数值；页面把它映射为显示文本。', { nullable: true, nullMeaning: '后端没有返回文本类型。' }),
    field('list[].contentTypeName', 'string | null', '后端可能提供的文本类型展示名称；页面当前按contentType本地映射。', { nullable: true, nullMeaning: '后端没有该扩展字段。' }),
    field('list[].scale', 'number | null', '数值类型的小数位数；非数值类型页面不提交。', { nullable: true, nullMeaning: '非数值指标或后端没有小数位数。' }),
    field('total', 'integer', '当前classification、search和固定scope=1条件下的总数；直接数组响应时等于数组长度。'),
  ],
  empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录。权限、网络或响应结构错误会抛出，不降级为空列表。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的标准设置记录。')],
  empty: 'Portal/Java返回业务错误、权限错误、网络错误或响应无法解包时抛出；true不等于已经回查确认。',
}

const createDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal新建弹窗校验后、尚未发送请求的ProgramUnit对象。'),
    field('draft.id', 'undefined', 'Portal新建表单状态中的id；JSON序列化时不会发送。', { optional: true, nullMeaning: '不适用；该字段不是null。' }),
    field('draft.classification', 'string | number', '指标归类字典值；必填。'),
    field('draft.contentType', '1 | 2 | 3', '文本类型；1纯文本、2富文本、3数值。'),
    field('draft.name', 'string', '指标名称；必填。'),
    field('draft.code', 'string', '指标编码；必填且服务端不能与已有编码重复。'),
    field('draft.unit', 'string', '数值类型必填单位；非数值类型固定提交空字符串。'),
    field('draft.scale', 'number | ""', '数值类型必填小数位数；非数值类型固定提交空字符串。'),
  ],
  empty: '归类、文本类型、名称或编码为空时抛错；contentType=3时单位或小数位数为空也抛错，且不发送POST。',
}

const updateDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal编辑弹窗校验后的提交对象；保留当前行raw对象中的扩展字段。'),
    field('draft.id', 'string | number | null | undefined', 'ProgramUnit记录ID；Portal显式覆盖raw.id后发送。', { optional: true, nullable: true, nullMeaning: '当前行没有ID；服务端可能拒绝更新。' }),
    field('draft.classification', 'string | number', '编辑后的指标归类；必填。'),
    field('draft.contentType', '1 | 2 | 3', '编辑后的文本类型。'),
    field('draft.name', 'string', '编辑后的指标名称；必填。'),
    field('draft.code', 'string', '编辑后的指标编码；必填。'),
    field('draft.unit', 'string', '数值类型的编辑单位；非数值类型固定为空字符串。'),
    field('draft.scale', 'number | ""', '数值类型的小数位数；非数值类型固定为空字符串。'),
  ],
  empty: '编辑字段不满足Portal规则时抛错，且不发送POST；扩展字段不作为本页展示契约。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_HATCH_MANAGE_UNIT_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_HATCH_MANAGE_UNIT_PERMISSION}；页面声明查询权限${PRODUCT_SETTING_HATCH_MANAGE_UNIT_QUERY_PERMISSION}、写权限${PRODUCT_SETTING_HATCH_MANAGE_UNIT_SUBMIT_PERMISSION}和删除权限${PRODUCT_SETTING_HATCH_MANAGE_UNIT_DELETE_PERMISSION}。SDK不绕过页面或服务端权限。`,
  '请求使用Portal product HTTP实例并补devicetype=PC；当前页面没有module-type匹配规则，因此不发送module-type。',
  '指标归类候选来自Portal全局平台字典standard_class，不是本页单独请求；需要候选时使用已有base-dict-get并传dictType=standard_class，不能猜测字典值。',
  '列表请求固定发送scope=1，并由公共列表模块加入order、orderField、pageNo和pageSize；Java ProgramUnit查询实际使用classification和search，scope目前不是SQL过滤条件，但SDK仍复刻Portal请求。',
  'Portal列表筛选表单声明classification必填，但首次自动加载可能发送空字符串；SDK允许省略classification以复刻页面首次请求。',
  'contentType=1/2时Portal把unit和scale都变成空字符串；contentType=3时unit和scale由自定义校验要求非空，Java add/update也要求数值类型scale存在。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/hatch-manage/unit.vue 与 list.vue', kind: 'reference', note: '核对菜单路径、路由权限、product实例、standard_class筛选、固定scope、分页、按钮权限和ProgramUnit接口。' },
  { source: 'app/portal/views/dashboard/product/setting/hatch-manage/unit/modal-form-content.vue、common/libs/renren/list.js、app/portal/utils/http/product.js', kind: 'reference', note: '核对三种文本类型、数值类型条件表单规则、raw透传、unit/scale空字符串转换、分页默认值和响应解包。' },
  { source: 'erp-module-fm/.../ProgramUnitLayController.java、ProgramUnit.java、ProgramUnitMapper.xml', kind: 'reference', note: '核对GET列表、POST新增/更新、GET软删、code重复检查、数值scale服务端校验和classification/search查询字段。' },
  { source: 'src/capabilities/product-setting-hatch-manage-unit.ts 与 test/product-setting-hatch-manage-unit.test.ts', kind: 'implementation', note: '锁定页面请求、条件表单、raw扩展字段、数组/分页响应、权限上下文、删除ID和离线反证；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置标准设置.md', kind: 'reference', note: '记录逐页四件套、字段含义、权限、条件表单规则和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境通过浏览器会话执行标准设置列表、新建、编辑、回查和删除闭环；当前证据为Portal/Java源码与离线请求形状测试。',
  'Portal列表可能收到直接数组或分页对象，SDK同时兼容两种页面实际消费分支；Java当前getList按分页page返回，直接数组是前端保留的兼容分支。',
]

function inputFor (id: string): Record<string, AiParameter> {
  if (id.endsWith('-list')) return {
    classification: param('指标归类字典值；来自standard_class平台字典，省略时按Portal首次加载发送空字符串。', 'base-dict-get(dictType=standard_class).result[].value', { type: 'string | number', required: false, default: '空字符串' }),
    search: param('指标名称或编码前缀；Portal后端按name或code前缀匹配，省略时发送空字符串。', '用户输入的列表筛选表单', { type: 'string', required: false, default: '空字符串' }),
    pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (id.endsWith('-prepare-create')) return { form: param('Portal新建弹窗表单；classification、contentType、name、code必填，contentType=3时unit和scale也必填。', '用户填写的标准设置新建表单', { type: 'object', required: true }) }
  if (id.endsWith('-create')) return { draft: param('prepareCreate返回的标准设置新建草稿；确认后原样交给create。', 'productSettingHatchManageUnit.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (id.endsWith('-prepare-update')) return { form: param('当前列表行raw对象与编辑后的表单字段；Portal保留raw扩展字段并覆盖标准设置字段。', '当前标准设置列表行和用户编辑结果', { type: 'object', required: true }) }
  if (id.endsWith('-update')) return { draft: param('prepareUpdate返回的编辑草稿；确认后原样交给update。', 'productSettingHatchManageUnit.prepareUpdate.result.draft', { type: 'object', required: true }) }
  return { id: param('当前列表行的ProgramUnit记录ID；必须来自最近一次list结果。', 'productSettingHatchManageUnit.list.result.list[].id', { type: 'string | number', required: true }) }
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-hatch-manage-unit-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认提交新建表单', capabilityId: 'product-setting-hatch-manage-unit-create', mapping: { draft: 'result.draft' }, instruction: '把result.draft原样交给create；不要为非数值类型补unit或scale。' })
    steps.push({ role: 'cancel', when: '用户取消新建弹窗', instruction: '丢弃draft，不发送create请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-unit-list', mapping: {}, instruction: '重新调用list，按code、name和contentType回查；true只表示请求未抛错。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认提交编辑草稿', capabilityId: 'product-setting-hatch-manage-unit-update', mapping: { draft: 'result.draft' }, instruction: '把result.draft原样交给update，保留ProgramUnit id和raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不发送update请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-unit-list', mapping: {}, instruction: '重新调用list确认code、name、classification、contentType、unit和scale；不能只依据true宣布已落库。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前标准设置行', capabilityId: 'product-setting-hatch-manage-unit-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove返回的id交给remove；确认前不发送GET。' })
    steps.push({ role: 'cancel', when: '用户取消删除确认', instruction: '丢弃id，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-unit-list', mapping: {}, instruction: '重新调用list确认同一ProgramUnit id不再出现；不要把GET改成DELETE。' })

  const output = isList
    ? listOutput
    : isPrepareCreate
      ? createDraftOutput
      : isPrepareUpdate
        ? updateDraftOutput
        : isPrepareRemove
          ? { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的ProgramUnit记录ID。')], empty: 'id为空或不是字符串/整数时抛错，且不发请求。' }
          : trueOutput
  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'

  return {
    purpose: isList ? '按Portal筛选条件分页读取养殖预案标准设置。' : isPrepareCreate ? '按Portal新建弹窗规则准备ProgramUnit标准设置草稿。' : isCreate ? '按Portal当前页面请求新增ProgramUnit标准设置。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备标准设置草稿。' : isUpdate ? '按Portal当前页面请求更新ProgramUnit标准设置。' : isPrepareRemove ? '准备一个经过用户确认的ProgramUnit记录ID。' : '按Portal当前页面GET接口软删ProgramUnit标准设置。',
    whenToUse: `需要在${PRODUCT_SETTING_HATCH_MANAGE_UNIT_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用；不要把它与方法设置或方法库页面混用。`,
    effect,
    inputs: inputFor(id),
    output,
    consume: isList
      ? ['用list[].id进入编辑/删除流程；用list[].contentType映射文本类型显示，total用于分页终止判断。']
      : isPrepareCreate
        ? ['把draft展示给用户；确认后交给create，contentType=1/2时保留unit和scale为空字符串。']
        : isCreate
          ? ['true只表示请求未抛错；必须list回查实际ProgramUnit记录。']
          : isPrepareUpdate
            ? ['把draft展示给用户；确认后原样交给update，contentType=3时保留单位和小数位数。']
            : isUpdate
              ? ['true只表示请求未抛错；必须list回查指标编码和完整条件字段。']
              : isPrepareRemove
                ? ['用户确认前只保存id；取消只丢弃本地草稿。']
                : ['请求成功或响应不确定后调用list回查，不把删除接口返回消息当作记录已消失的证据。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户会话token，并确认用户拥有页面菜单权限；新建/编辑需要program:unit:submit，删除需要program:unit:delete。', ...(isCreate || isPrepareCreate || isUpdate || isPrepareUpdate || isRemove || isPrepareRemove ? ['写操作目标应来自当前页面最近一次list结果或同一次prepare结果。'] : [])],
    steps,
    completion: isList ? '获得与Portal列表customLoad消费形状一致的list和total。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal页面的URL、HTTP方法、参数和条件表单字段完成；业务终态仍需list回查。',
    failures: ['表单必填、contentType条件字段、指标编码重复、数值类型scale、ID、分页、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功。'],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；写请求超时或响应不确定时先list回查，确认目标记录后再决定是否重试，避免重复新增或重复删除。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingHatchManageUnitCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置标准设置契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_HATCH_MANAGE_UNIT_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_HATCH_MANAGE_UNIT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_HATCH_MANAGE_UNIT_METHODS).map(([id, method]) => [
    `productSettingHatchManageUnit.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingHatchManageUnit.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
