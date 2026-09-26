import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_VARIETY_SUBMIT_PERMISSION,
  productSettingHatchManageVarietyCapabilities,
} from '../capabilities/product-setting-hatch-manage-variety.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingHatchManageVarietyCapabilities.map(definition => [definition.id, definition]))

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '预案品种分页结果；Portal product响应解包后的page对象。'),
    field('list', 'array', '当前页的Parameter预案品种记录。'),
    field('list[]', 'object', '预案品种列表行；SDK保留后端原始扩展字段，并规范页面实际消费字段。'),
    field('list[].id', 'string | number | null', 'Parameter记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回记录ID，不能安全执行页面写操作。' }),
    field('list[].name', 'string | null', '品种英文名；列表和编辑字段。', { nullable: true, nullMeaning: '后端没有返回名字。' }),
    field('list[].code', 'string | null', '品种编码；编辑字段，页面新建/编辑必填。', { nullable: true, nullMeaning: '后端没有返回编码。' }),
    field('list[].caption', 'string | null', '品种说明；列表和编辑字段，页面新建/编辑必填。', { nullable: true, nullMeaning: '后端没有返回说明。' }),
    field('list[].icon', 'string | null', '品种图标地址；页面以图片展示，可为空。', { nullable: true, nullMeaning: '未上传图标。' }),
    field('list[].variety', 'string | null', '品种字典值；编辑弹窗回填，可为空。', { nullable: true, nullMeaning: '未选择品种字典项。' }),
    field('list[].varietyName', 'string | null', '品种字典展示名称；表格列使用。', { nullable: true, nullMeaning: '后端没有通过缓存补展示名称。' }),
    field('list[].gen', 'string | null', '代次字典值；编辑弹窗回填，可为空。', { nullable: true, nullMeaning: '未选择代次字典项。' }),
    field('list[].genName', 'string | null', '代次字典展示名称；表格列使用。', { nullable: true, nullMeaning: '后端没有通过缓存补展示名称。' }),
    field('total', 'integer', '当前页面分页条件下的记录总数；不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页没有记录；total=0表示没有记录。权限、网络或响应结构错误会抛出，不降级为空列表。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含保存后的预案品种记录。')],
  empty: 'Portal/Java返回业务错误、权限错误、网络错误或响应无法解包时抛出；true不等于已经回查确认。',
}

const createDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal新建弹窗校验后、尚未发送请求的Parameter对象。'),
    field('draft.id', 'string', 'Portal新建表单的空ID；固定为""，Java以空ID判断新增。'),
    field('draft.name', 'string', '名字；必填。'),
    field('draft.code', 'string', '编码；必填。'),
    field('draft.caption', 'string', '说明；必填。'),
    field('draft.icon', 'string', '图标地址；没有上传时为空字符串。'),
    field('draft.variety', 'string', '品种字典值；未选择时为空字符串。'),
    field('draft.gen', 'string', '代次字典值；未选择时为空字符串。'),
  ],
  empty: '名字、编码或说明为空时抛错，且不发送POST；图标、品种和代次没有Portal必填规则，缺失会整理为空字符串。',
}

const updateDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal编辑弹窗校验后的七字段提交对象；不透传列表行的其它扩展字段。'),
    field('draft.id', 'string | number', '当前Parameter记录ID；缺失时按Portal表单状态提交空字符串，Java会按新增分支处理，调用方应优先使用list返回的有效ID。'),
    field('draft.name', 'string', '编辑后的名字；必填。'),
    field('draft.code', 'string', '编辑后的编码；必填。'),
    field('draft.caption', 'string', '编辑后的说明；必填。'),
    field('draft.icon', 'string', '编辑后的图标地址；未上传时为空字符串。'),
    field('draft.variety', 'string', '编辑后的品种字典值；未选择时为空字符串。'),
    field('draft.gen', 'string', '编辑后的代次字典值；未选择时为空字符串。'),
  ],
  empty: '名字、编码或说明为空时抛错，且不发送POST；编辑对象只按Portal弹窗的七个状态字段组装。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PERMISSION}；页面声明查询权限${PRODUCT_SETTING_HATCH_MANAGE_VARIETY_QUERY_PERMISSION}、写权限${PRODUCT_SETTING_HATCH_MANAGE_VARIETY_SUBMIT_PERMISSION}和删除权限${PRODUCT_SETTING_HATCH_MANAGE_VARIETY_DELETE_PERMISSION}。SDK不绕过页面或服务端权限。`,
  '请求使用Portal product HTTP实例并补devicetype=PC；当前页面没有页面推导出的module-type，因此不发送module-type。',
  '列表customLoad把公共列表参数order、orderField、pageNo、pageSize原样交给/sys/parameter/page；页面路由存在suiteId时才额外发送suiteId。当前Java分页Controller只显式接收pageNo/pageSize，因此suiteId是Portal实际请求上下文，不能被当作后端已实现的数据隔离保证。',
  '保存请求在Portal页面处理器中把suiteId追加到POST body；SDK通过create/update的可选suiteId复刻该请求形状。Java Parameter实体没有suiteId字段，当前后端是否使用该扩展字段不能由源码证明。',
  '品种和代次候选由Portal的portal-product-dict-select组件加载；本页不额外发候选请求。调用方需要字典值，不要把展示名称代替value提交。',
  '名字、编码、说明是唯一必填表单规则；icon、variety、gen没有Portal表单校验，undefined/null/空值按表单初始化的||空字符串提交。编辑弹窗只发id、name、code、caption、icon、variety、gen，不透传列表行其它字段。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/hatch-manage/variety.vue 与 list.vue', kind: 'reference', note: '核对菜单归属、路由权限、product实例、suiteId路由上下文、列表接口、公共分页、按钮权限和删除接口。' },
  { source: 'app/portal/views/dashboard/product/setting/hatch-manage/variety/modal-form-content.vue、common/libs/renren/list.js、app/portal/utils/http/product.js', kind: 'reference', note: '核对七个表单状态字段、三项必填规则、可选字典/图标字段、编辑字段裁剪、分页默认值和响应解包。' },
  { source: 'erp-module-fm/.../ParameterController.java、Parameter.java、ParameterDTO.java、ParameterServiceImpl.java、ParameterMapper.xml', kind: 'reference', note: '核对/sys/parameter/page、save、delete的参数、空ID新增/非空ID更新、字典展示字段和软删除。' },
  { source: 'src/capabilities/product-setting-hatch-manage-variety.ts 与 test/product-setting-hatch-manage-variety.test.ts', kind: 'implementation', note: '锁定页面请求、suiteId条件发送、表单字段、权限上下文、ID和分页响应边界；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置预案品种.md', kind: 'reference', note: '记录逐页四件套、字段含义、权限、提交规则和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境通过浏览器会话执行预案品种列表、新建、编辑、回查和删除闭环；当前证据为Portal/Java源码与离线请求形状测试。',
  'Java /sys/parameter/page 当前只接收pageNo/pageSize，Portal仍会在路由存在suiteId时发送suiteId；SDK保留这个实际请求字段，但未把它描述成后端过滤保证。',
]

function inputFor (id: string): Record<string, AiParameter> {
  if (id.endsWith('-list')) return {
    suiteId: param('Portal路由中的可选suiteId；有值时原样加入列表请求，不能据此推断后端一定按suiteId过滤。', '页面路由query.suiteId', { type: 'string', required: false, omitted: '未提供或为空时不发送' }),
    pageNo: param('从1开始的页码；默认1。', 'Portal公共列表分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal公共列表分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (id.endsWith('-prepare-create')) return { form: param('Portal新建弹窗表单；名字、编码、说明必填，图标、品种、代次可为空。', '用户填写的预案品种新建表单', { type: 'object', required: true }) }
  if (id.endsWith('-create')) return {
    draft: param('prepareCreate返回的七字段新建草稿；确认后原样交给create。', 'productSettingHatchManageVariety.prepareCreate.result.draft', { type: 'object', required: true }),
    suiteId: param('当前Portal路由的可选suiteId；有值时追加到保存请求体。', '页面路由query.suiteId', { type: 'string', required: false, omitted: '未提供或为空时不发送' }),
  }
  if (id.endsWith('-prepare-update')) return { form: param('当前列表行与用户编辑结果；SDK只取Portal弹窗的id、名字、编码、说明、图标、品种和代次字段。', '当前预案品种列表行和用户编辑结果', { type: 'object', required: true }) }
  if (id.endsWith('-update')) return {
    draft: param('prepareUpdate返回的七字段编辑草稿；确认后原样交给update。', 'productSettingHatchManageVariety.prepareUpdate.result.draft', { type: 'object', required: true }),
    suiteId: param('当前Portal路由的可选suiteId；有值时追加到保存请求体。', '页面路由query.suiteId', { type: 'string', required: false, omitted: '未提供或为空时不发送' }),
  }
  return { id: param('当前列表行的Parameter记录ID；必须来自最近一次list结果。', 'productSettingHatchManageVariety.list.result.list[].id', { type: 'string | number', required: true }) }
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-hatch-manage-variety-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认提交新建表单', capabilityId: 'product-setting-hatch-manage-variety-create', mapping: { draft: 'result.draft' }, instruction: '把result.draft交给create；如果当前页面路由有suiteId，再把同一个suiteId作为create的可选上下文传入。' })
    steps.push({ role: 'cancel', when: '用户取消新建弹窗', instruction: '丢弃draft，不发送create请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-variety-list', mapping: {}, instruction: '重新调用list，按code、name和id回查；true只表示请求未抛错。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认提交编辑草稿', capabilityId: 'product-setting-hatch-manage-variety-update', mapping: { draft: 'result.draft' }, instruction: '把result.draft原样交给update，并按需传递当前路由suiteId。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不发送update请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-variety-list', mapping: {}, instruction: '重新调用list确认id对应的名字、编码、说明、品种和代次；不能只依据true宣布已落库。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前预案品种行', capabilityId: 'product-setting-hatch-manage-variety-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove返回的id交给remove；确认前不发送GET。' })
    steps.push({ role: 'cancel', when: '用户取消删除确认', instruction: '丢弃id，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-variety-list', mapping: {}, instruction: '重新调用list确认同一Parameter id不再出现；不要把GET改成DELETE。' })

  const output = isList
    ? listOutput
    : isPrepareCreate
      ? createDraftOutput
      : isPrepareUpdate
        ? updateDraftOutput
        : isPrepareRemove
          ? { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的Parameter记录ID。')], empty: 'id为空或不是字符串/整数时抛错，且不发请求。' }
          : trueOutput
  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'

  return {
    purpose: isList ? '按Portal公共分页条件读取预案品种。' : isPrepareCreate ? '按Portal新建弹窗规则准备预案品种草稿。' : isCreate ? '按Portal当前页面请求保存新建预案品种。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备预案品种草稿。' : isUpdate ? '按Portal当前页面请求保存编辑后的预案品种。' : isPrepareRemove ? '准备一个经过用户确认的Parameter记录ID。' : '按Portal当前页面GET接口软删预案品种。',
    whenToUse: `需要在${PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用；不要把它与标准设置、方法设置或独立生产业务菜单混用。`,
    boundaries: commonBoundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户会话token，并确认用户拥有页面菜单权限；新建/编辑需要program:variety:submit，删除需要program:variety:delete。', ...(isCreate || isPrepareCreate || isUpdate || isPrepareUpdate || isRemove || isPrepareRemove ? ['写操作目标应来自当前页面最近一次list结果或同一次prepare结果。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isList
      ? ['用list[].id进入编辑/删除流程；用list[].name、caption、icon、genName和varietyName展示表格，total用于分页终止判断。']
      : isPrepareCreate
        ? ['把draft展示给用户；确认后交给create，不自行补充Java实体中页面没有的字段。']
        : isCreate
          ? ['true只表示请求未抛错；必须list回查实际Parameter记录。']
          : isPrepareUpdate
            ? ['把draft展示给用户；确认后原样交给update，注意SDK不会透传列表行其它扩展字段。']
            : isUpdate
              ? ['true只表示请求未抛错；必须list回查名字、编码、说明和字典展示值。']
              : isPrepareRemove
                ? ['用户确认前只保存id；取消只丢弃本地草稿。']
                : ['请求成功或响应不确定后调用list回查，不把删除接口返回消息当作记录已消失的证据。'],
    steps,
    completion: isList ? '获得与Portal列表customLoad消费形状一致的list和total。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal页面的URL、HTTP方法、参数和表单字段完成；业务终态仍需list回查。',
    failures: ['表单必填、ID、分页、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功；suiteId是否被后端使用不由SDK自行推断。'],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；写请求超时或响应不确定时先list回查，确认目标记录后再决定是否重试，避免重复新增或重复删除。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingHatchManageVarietyCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置预案品种契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_HATCH_MANAGE_VARIETY_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS).map(([id, method]) => [
    `productSettingHatchManageVariety.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingHatchManageVariety.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
