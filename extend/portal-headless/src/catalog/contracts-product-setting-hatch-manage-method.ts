import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_METHODS,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_METHOD_SUBMIT_PERMISSION,
  productSettingHatchManageMethodCapabilities,
} from '../capabilities/product-setting-hatch-manage-method.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingHatchManageMethodCapabilities.map(definition => [definition.id, definition]))

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '方法设置分页结果；Portal product响应解包后的page对象。'),
    field('list', 'array', '当前页的方法设置记录数组；不是全部记录。'),
    field('list[]', 'object', 'ProgramUnit列表行；SDK保留后端原始扩展字段，页面实际消费下面列出的字段。'),
    field('list[].id', 'string | number | null', '方法设置列表行的ProgramUnit记录ID；Portal编辑和删除都从该字段取值。', { nullable: true, nullMeaning: '后端没有返回记录ID，不能安全执行页面写操作。' }),
    field('list[].classification', 'string | number | null', '方法归类的原始字典值；编辑弹窗在traitType缺失时用它回填。', { nullable: true, nullMeaning: '列表行没有归类值。' }),
    field('list[].traitTypeName', 'string | null', '方法归类展示文本；方法设置表格第一列。', { nullable: true, nullMeaning: '后端没有返回归类名称。' }),
    field('list[].name', 'string | null', '方法名称；列表列和编辑弹窗名称字段。', { nullable: true, nullMeaning: '后端没有返回name；编辑弹窗会尝试使用traitName回填。' }),
    field('list[].traitName', 'string | null', '后端或兼容响应中的方法名称字段；Portal仅在name为空时用于编辑回填。', { nullable: true, nullMeaning: '响应没有备用名称字段。' }),
    field('list[].title1', 'string | null', '一级标题；编辑弹窗必填字段。', { nullable: true, nullMeaning: '响应没有一级标题。' }),
    field('list[].title2', 'string | null', '二级标题；编辑弹窗必填字段。', { nullable: true, nullMeaning: '响应没有二级标题。' }),
    field('list[].title3', 'string | null', '三级标题；编辑弹窗必填字段。', { nullable: true, nullMeaning: '响应没有三级标题。' }),
    field('total', 'integer', '当前classification、search和固定scope=1条件下的记录总数；不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录。权限、网络或响应结构错误会抛出，不降级为空列表。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的方法设置记录。')],
  empty: 'Portal/Java返回业务错误、权限错误、网络错误或响应无法解包时抛出；true不等于已经回查确认。',
}

const createDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal新建弹窗五项必填校验后、尚未发送请求的草稿。'),
    field('draft.id', 'undefined', 'Portal构造对象时显式写入的undefined；JSON序列化时不会发送id。', { optional: true, nullMeaning: '不适用；该字段不是null。' }),
    field('draft.traitType', 'string', '方法归类字典值；Portal把数字字典值转为字符串后发送。'),
    field('draft.name', 'string', '方法名称；必填。'),
    field('draft.title1', 'string', '一级标题；必填。'),
    field('draft.title2', 'string', '二级标题；必填。'),
    field('draft.title3', 'string', '三级标题；必填。'),
  ],
  empty: '任一表单字段为空或类型不符合Portal输入模型时抛错，且不发送POST。',
}

const updateDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal编辑弹窗校验后的提交对象；保留当前行raw对象中的扩展字段。'),
    field('draft.id', 'string | number | null | undefined', '当前列表行的ProgramUnit ID；Portal显式覆盖raw.id后发送。', { optional: true, nullable: true, nullMeaning: '当前行没有ID；Portal仍会尝试发送该值，后端是否能定位由服务端决定。' }),
    field('draft.traitType', 'string', '编辑后的方法归类；若输入只有classification，SDK按Portal弹窗回填逻辑转为该字段。'),
    field('draft.name', 'string', '编辑后的方法名称；若输入只有traitName，SDK按Portal弹窗回填逻辑转为该字段。'),
    field('draft.title1', 'string', '编辑后的一级标题；必填。'),
    field('draft.title2', 'string', '编辑后的二级标题；必填。'),
    field('draft.title3', 'string', '编辑后的三级标题；必填。'),
  ],
  empty: '任一编辑字段为空时抛错，且不发送POST；扩展字段不作为本页展示契约。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_HATCH_MANAGE_METHOD_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_HATCH_MANAGE_METHOD_PERMISSION}；页面声明查询权限${PRODUCT_SETTING_HATCH_MANAGE_METHOD_QUERY_PERMISSION}、写权限${PRODUCT_SETTING_HATCH_MANAGE_METHOD_SUBMIT_PERMISSION}和删除权限${PRODUCT_SETTING_HATCH_MANAGE_METHOD_DELETE_PERMISSION}。SDK不绕过页面或服务端权限。`,
  '请求使用Portal product HTTP实例并补devicetype=PC；当前页面没有module-type匹配规则，因此不发送module-type。',
  '方法归类选项来自Portal全局平台字典store的method_class，不是本页单独发出的请求；需要候选时使用已有base-dict-get并传dictType=method_class，不能猜测字典值。',
  '列表请求固定发送scope=1，并由公共列表模块加入order、orderField、pageNo和pageSize；Java ProgramUnit查询实际使用classification和search，scope目前不是SQL过滤条件，但SDK仍复刻Portal请求。',
  'Portal列表筛选表单声明classification必填，但页面首次自动logicFetch的formState仍为空；SDK允许省略classification以复刻首次请求，不能把这个页面现有前端校验缺陷改写成后端必填规则。',
  '新建和编辑严格使用Portal当前源码的/programNew/methodLib/createTrait与editTrait；不因Java中存在相似的/programUnit/add、update接口而替换请求。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/hatch-manage/method.vue 与 list.vue', kind: 'reference', note: '核对菜单路径、路由权限、product实例、列表筛选、固定scope、分页、按钮权限、列表接口和删除接口。' },
  { source: 'app/portal/views/dashboard/product/setting/hatch-manage/method/modal-form-content.vue、common/libs/renren/list.js、app/portal/utils/http/product.js', kind: 'reference', note: '核对五项表单必填、traitType/name回填优先级、raw扩展字段透传、请求体字段覆盖、分页默认值和响应解包。' },
  { source: 'erp-module-fm/.../ProgramUnitLayController.java、ProgramUnitServiceImpl.java、ProgramUnitMapper.xml', kind: 'reference', note: '核对GET /programUnit/getList的分页、classification/search条件、ProgramUnit列表字段和Java分页page包络。' },
  { source: 'erp-module-fm/.../programNew/MethodLibController.java、ProgramNewStandardLibTraitDTO.java、ProgramNewServiceImpl.java', kind: 'reference', note: '核对Portal实际createTrait/editTrait/deleteTrait路径，并记录当前Java DTO/服务仍按age、traitCode和fm_simu_program_lib处理的协议差异。' },
  { source: 'src/capabilities/product-setting-hatch-manage-method.ts 与 test/product-setting-hatch-manage-method.test.ts', kind: 'implementation', note: '锁定页面请求、表单回填/透传、权限上下文、删除ID和离线反证；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置方法设置.md', kind: 'reference', note: '记录逐页四件套、字段含义、权限、请求顺序和已知前后端冲突。' },
]

const gaps = [
  '尚未在真实测试环境通过浏览器会话执行方法设置列表、新建、编辑、回查和删除闭环；当前证据为Portal/Java源码与离线请求形状测试。',
  'Portal方法设置表单发送traitType、name、title1、title2、title3，但当前programNew/MethodLibController接收ProgramNewStandardLibTraitDTO并在createTrait中要求age且服务按traitCode、age写入fm_simu_program_lib；当前源码未证明该页面写操作能成功落到ProgramUnit。SDK保留Portal请求以实现页面对齐，不伪造成功。',
  '列表来自/programUnit/getList的ProgramUnit.id，而programNew的editTrait/deleteTrait服务按fm_simu_program_lib.id更新或删除；两条链路的ID实体不一致，真实环境需确认Portal后端是否有额外兼容映射。',
]

function inputFor (id: string): Record<string, AiParameter> {
  if (id.endsWith('-list')) return {
    classification: param('方法归类字典值；来自method_class平台字典，省略时按Portal首次加载发送空字符串。', 'base-dict-get(dictType=method_class).result[].value', { type: 'string | number', required: false, default: '空字符串' }),
    search: param('方法名称或编码前缀；Portal后端按name或code前缀匹配，省略时发送空字符串。', '用户输入的列表筛选表单', { type: 'string', required: false, default: '空字符串' }),
    pageNo: param('从1开始的页码。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (id.endsWith('-prepare-create')) return { form: param('Portal新建弹窗表单；方法归类、名称和三级标题字段全部必填。', '用户填写的方法设置新建表单', { type: 'object', required: true }) }
  if (id.endsWith('-create')) return { draft: param('prepareCreate返回的五字段新建草稿；确认后原样交给create。', 'productSettingHatchManageMethod.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (id.endsWith('-prepare-update')) return { form: param('当前列表行raw对象与编辑后的五个表单字段；Portal会保留raw扩展字段并覆盖这五个字段。', '当前方法设置列表行和用户编辑结果', { type: 'object', required: true }) }
  if (id.endsWith('-update')) return { draft: param('prepareUpdate返回的编辑草稿；确认后原样交给update。', 'productSettingHatchManageMethod.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (id.endsWith('-prepare-remove') || id.endsWith('-remove')) return { id: param('当前列表行的ProgramUnit方法记录ID；不能用名称或classification代替。', 'productSettingHatchManageMethod.list.result.list[].id', { type: 'string | number', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-hatch-manage-method-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认提交新建表单', capabilityId: 'product-setting-hatch-manage-method-create', mapping: { draft: 'result.draft' }, instruction: '把result.draft交给create；不要自行补age、traitCode或其他标准指标字段。' })
    steps.push({ role: 'cancel', when: '用户取消新建弹窗', instruction: '丢弃draft，不发送create请求。' })
  }
  if (isCreate) {
    steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-method-list', mapping: {}, instruction: '重新调用list，按方法ID或名称与五个标题回查；true只表示请求未抛错。' })
  }
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认提交编辑草稿', capabilityId: 'product-setting-hatch-manage-method-update', mapping: { draft: 'result.draft' }, instruction: '把result.draft原样交给update，保留当前行raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不发送update请求。' })
  }
  if (isUpdate) {
    steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-method-list', mapping: {}, instruction: '重新调用list确认方法记录的名称和标题；不能只依据true宣布已落库。' })
  }
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前方法设置行', capabilityId: 'product-setting-hatch-manage-method-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove返回的id交给remove；确认前不发送GET。' })
    steps.push({ role: 'cancel', when: '用户取消删除确认', instruction: '丢弃id，不调用remove。' })
  }
  if (isRemove) {
    steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-method-list', mapping: {}, instruction: '重新调用list确认同一id不再出现；不要把GET改成DELETE。' })
  }

  const output = isList
    ? listOutput
    : isPrepareCreate
      ? createDraftOutput
      : isPrepareUpdate
        ? updateDraftOutput
        : isPrepareRemove
          ? { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的方法设置记录ID。')], empty: 'id为空或不是字符串/整数时抛错，且不发请求。' }
          : trueOutput

  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'
  return {
    purpose: isList ? '按Portal筛选条件分页读取方法设置。' : isPrepareCreate ? '按Portal新建弹窗规则准备方法设置提交草稿。' : isCreate ? '按Portal当前页面请求创建方法设置。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备方法设置提交草稿。' : isUpdate ? '按Portal当前页面请求编辑方法设置。' : isPrepareRemove ? '准备一个经过用户确认的方法设置记录ID。' : '按Portal当前页面GET接口删除方法设置。',
    whenToUse: `需要在${PRODUCT_SETTING_HATCH_MANAGE_METHOD_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用；不要把它与方法库页面混用。`,
    boundaries: commonBoundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户会话token，并确认用户拥有页面菜单权限；新建/编辑需要program:method:submit，删除需要program:method:delete。', ...(isCreate || isPrepareCreate || isUpdate || isPrepareUpdate || isRemove || isPrepareRemove ? ['写操作目标应来自当前页面最近一次list结果或同一次prepare结果。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isList
      ? ['用list[].id作为编辑/删除的页面记录目标，用list[].traitTypeName、name、title1、title2、title3展示表格；total用于分页终止判断。']
      : isPrepareCreate
        ? ['把draft展示给用户；确认后交给create，不添加Java标准指标接口所需但Portal没有的字段。']
        : isCreate
          ? ['true只表示请求未抛错；必须list回查实际记录。']
          : isPrepareUpdate
            ? ['把draft展示给用户；确认后原样交给update，扩展字段只用于复刻Portal raw透传，不作为页面业务字段。']
            : isUpdate
              ? ['true只表示请求未抛错；必须list回查名称和标题。']
              : isPrepareRemove
                ? ['用户确认前只保存id；取消只丢弃本地草稿。']
                : ['请求成功或响应不确定后调用list回查，不把删除接口返回消息当作记录已消失的证据。'],
    steps,
    completion: isList ? '获得与Portal列表customLoad消费形状一致的list和total。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal页面的URL、HTTP方法、参数和表单字段完成；业务终态仍需list回查。',
    failures: ['表单必填、ID、字典值、分页、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功。', ...(isCreate || isUpdate ? ['当前Java programNew接口与Portal方法表单字段存在协议差异；若服务端拒绝age/traitCode缺失，应记录为真实后端错误，不自动改发另一个接口。'] : [])],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；写请求超时或响应不确定时先list回查，确认目标记录后再决定是否重试，避免重复写入或重复删除。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingHatchManageMethodCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置方法设置契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_HATCH_MANAGE_METHOD_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_HATCH_MANAGE_METHOD_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_HATCH_MANAGE_METHOD_METHODS).map(([id, method]) => [
    `productSettingHatchManageMethod.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingHatchManageMethod.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
