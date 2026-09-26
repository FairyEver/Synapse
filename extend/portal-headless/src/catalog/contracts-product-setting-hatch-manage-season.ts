import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_SEASON_SUBMIT_PERMISSION,
  productSettingHatchManageSeasonCapabilities,
} from '../capabilities/product-setting-hatch-manage-season.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingHatchManageSeasonCapabilities.map(definition => [definition.id, definition]))

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '温度设置分页结果；Portal product响应解包后的page对象。'),
    field('list', 'array', '当前筛选和分页下的内外温度对照记录。'),
    field('list[]', 'object', '温度设置记录；SDK保留后端原始扩展字段，并规范页面实际消费字段。'),
    field('list[].id', 'string | number | null', '外界温度记录ID；删除时作为id发送。', { nullable: true, nullMeaning: '后端没有返回外界温度记录ID，不能安全删除。' }),
    field('list[].tempId', 'string | number | null', '舍内温度记录ID；编辑时作为tempId发送，删除时也必须发送。', { nullable: true, nullMeaning: '后端没有返回舍内温度记录ID，不能安全编辑或删除。' }),
    field('list[].inMin', 'number | null', '舍内温度下限；页面显示为“最低(不包含)”。', { nullable: true, nullMeaning: '后端没有舍内温度下限。' }),
    field('list[].inMax', 'number | null', '舍内温度上限；页面显示为“最高(包含)”。', { nullable: true, nullMeaning: '后端没有舍内温度上限。' }),
    field('list[].inTitle', 'string | null', '舍内温度展示文本。', { nullable: true, nullMeaning: '后端没有舍内温度展示文本。' }),
    field('list[].outMin', 'number | null', '外界温度下限；页面显示为“最低(不包含)”。', { nullable: true, nullMeaning: '后端没有外界温度下限。' }),
    field('list[].outMax', 'number | null', '外界温度上限；页面显示为“最高(包含)”。', { nullable: true, nullMeaning: '后端没有外界温度上限。' }),
    field('list[].outTitle', 'string | null', '外界温度展示文本。', { nullable: true, nullMeaning: '后端没有外界温度展示文本。' }),
    field('total', 'integer', '当前min、max和固定scope=1条件下的记录总数，不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录。权限、网络或响应结构错误会抛出，不降级为空列表。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的温度设置记录。')],
  empty: 'Portal/Java返回业务错误、权限错误、网络错误或响应无法解包时抛出；true不等于已经回查确认。',
}

const createDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal新建弹窗四项必填校验后、尚未发送请求的草稿。'),
    field('draft.id', 'undefined', 'Portal新建表单状态中的id；JSON序列化时不会发送。', { optional: true, nullMeaning: '不适用；该字段不是null。' }),
    field('draft.tempId', 'undefined', 'Portal新建表单状态中的tempId；Java创建接口会自行生成舍内温度记录ID，JSON序列化时不会发送。', { optional: true, nullMeaning: '不适用；该字段不是null。' }),
    field('draft.inMin', 'number', '舍内温度下限；必填且在-99到99之间。'),
    field('draft.inMax', 'number', '舍内温度上限；必填且在-99到99之间。'),
    field('draft.outMin', 'number', '外界温度下限；必填且在-99到99之间。'),
    field('draft.outMax', 'number', '外界温度上限；必填且在-99到99之间。'),
  ],
  empty: '任一温度边界为空、不是有限数字或超出Portal输入控件的-99到99范围时抛错，且不发送POST。',
}

const updateDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal编辑弹窗校验后的提交对象；保留当前行raw对象中的扩展字段。'),
    field('draft.id', 'string | number | null | undefined', '外界温度记录ID；Portal显式覆盖raw.id后发送。', { optional: true, nullable: true, nullMeaning: '当前行没有外界温度记录ID；服务端可能拒绝更新。' }),
    field('draft.tempId', 'string | number | null | undefined', '舍内温度记录ID；Portal显式覆盖raw.tempId后发送。', { optional: true, nullable: true, nullMeaning: '当前行没有舍内温度记录ID；服务端可能拒绝更新。' }),
    field('draft.inMin', 'number', '编辑后的舍内温度下限；必填且在-99到99之间。'),
    field('draft.inMax', 'number', '编辑后的舍内温度上限；必填且在-99到99之间。'),
    field('draft.outMin', 'number', '编辑后的外界温度下限；必填且在-99到99之间。'),
    field('draft.outMax', 'number', '编辑后的外界温度上限；必填且在-99到99之间。'),
  ],
  empty: '任一编辑字段为空、不是有限数字或超出-99到99范围时抛错，且不发送POST；扩展字段不作为本页展示契约。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_HATCH_MANAGE_SEASON_PERMISSION}；页面声明查询权限${PRODUCT_SETTING_HATCH_MANAGE_SEASON_QUERY_PERMISSION}、写权限${PRODUCT_SETTING_HATCH_MANAGE_SEASON_SUBMIT_PERMISSION}和删除权限${PRODUCT_SETTING_HATCH_MANAGE_SEASON_DELETE_PERMISSION}。SDK不绕过页面或服务端权限。`,
  '请求使用Portal product HTTP实例并补devicetype=PC；当前页面没有module-type匹配规则，因此不发送module-type。',
  '列表请求固定发送scope=1、min和max，并由公共列表模块加入order、orderField、pageNo和pageSize；省略min/max时复刻页面默认-99/99。',
  '新建和编辑四个温度边界字段都由Portal表单规则声明必填，输入控件范围是-99到99；SDK不擅自添加“最小值必须小于最大值”等页面没有声明的规则。',
  '新建请求会保留Portal表单状态里的undefined id/tempId（JSON序列化时省略）；编辑会展开raw后覆盖id、tempId和四个边界字段。',
  '删除必须同时发送外界温度记录id和舍内温度记录tempId这两个ID；缺一不可，且请求方法保持GET。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/hatch-manage/season.vue 与 list.vue', kind: 'reference', note: '核对菜单路径、路由权限、product实例、筛选默认值、固定scope、分页、按钮权限和四个实际接口。' },
  { source: 'app/portal/views/dashboard/product/setting/hatch-manage/season/modal-form-content.vue、common/libs/renren/list.js、app/portal/utils/http/product.js', kind: 'reference', note: '核对四项必填、-99到99输入范围、raw透传、字段覆盖、分页默认值和响应解包。' },
  { source: 'erp-module-fm/.../programNew/BaseSettingTempController.java、ProgramNewTempInOutDTO.java、ProgramNewTempInOutVO.java', kind: 'reference', note: '核对分页、JSON创建/编辑、双ID删除和Java DTO字段。' },
  { source: 'erp-module-fm/.../ProgramSuiteServiceImpl.java、ProgramSuiteMapper.xml', kind: 'reference', note: '核对内外温度查询条件、两张表的更新/软删/新建映射和返回字段。' },
  { source: 'src/capabilities/product-setting-hatch-manage-season.ts 与 test/product-setting-hatch-manage-season.test.ts', kind: 'implementation', note: '锁定页面请求、表单范围/必填、raw扩展字段、双ID删除、权限上下文和离线反证；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置温度设置.md', kind: 'reference', note: '记录逐页四件套、字段含义、权限、请求顺序和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境通过浏览器会话执行温度设置列表、新建、编辑、回查和双ID删除闭环；当前证据为Portal/Java源码与离线请求形状测试。',
  'Java创建会生成新的舍内温度ID并新增外界温度行；编辑按tempId更新舍内温度、按id更新外界温度，删除同时软删两张表。SDK保留Portal提交对象和双ID删除规则，业务终态仍须list回查。',
]

function inputFor (id: string): Record<string, AiParameter> {
  if (id.endsWith('-list')) return {
    min: param('外界温度最小筛选值；省略时按Portal默认发送-99，可传null取消下限。', '温度设置列表筛选表单', { type: 'number | null', required: false, default: '-99' }),
    max: param('外界温度最大筛选值；省略时按Portal默认发送99，可传null取消上限。', '温度设置列表筛选表单', { type: 'number | null', required: false, default: '99' }),
    pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (id.endsWith('-prepare-create')) return { form: param('Portal新建弹窗表单；inMin、inMax、outMin、outMax全部必填且在-99到99之间。', '用户填写的温度设置新建表单', { type: 'object', required: true }) }
  if (id.endsWith('-create')) return { draft: param('prepareCreate返回的四字段新建草稿；确认后原样交给create。', 'productSettingHatchManageSeason.prepareCreate.result.draft', { type: 'object', required: true }) }
  if (id.endsWith('-prepare-update')) return { form: param('当前列表行raw对象与用户修改后的四个温度边界字段；Portal会保留raw扩展字段并覆盖id、tempId及四个边界字段。', '当前温度设置列表行和用户编辑结果', { type: 'object', required: true }) }
  if (id.endsWith('-update')) return { draft: param('prepareUpdate返回的编辑草稿；确认后原样交给update。', 'productSettingHatchManageSeason.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (id.endsWith('-prepare-remove') || id.endsWith('-remove')) return {
    id: param('当前列表行的外界温度记录ID；来自list[].id。', 'productSettingHatchManageSeason.list.result.list[].id', { type: 'string | number', required: true }),
    tempId: param('当前列表行的舍内温度记录ID；来自list[].tempId。', 'productSettingHatchManageSeason.list.result.list[].tempId', { type: 'string | number', required: true }),
  }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-hatch-manage-season-', '')
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认提交新建表单', capabilityId: 'product-setting-hatch-manage-season-create', mapping: { draft: 'result.draft' }, instruction: '把result.draft原样交给create；不要自行补id或tempId。' })
    steps.push({ role: 'cancel', when: '用户取消新建弹窗', instruction: '丢弃draft，不发送create请求。' })
  }
  if (isCreate) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-season-list', mapping: {}, instruction: '重新调用list并按四个温度边界回查；true只表示请求未抛错。' })
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认提交编辑草稿', capabilityId: 'product-setting-hatch-manage-season-update', mapping: { draft: 'result.draft' }, instruction: '把result.draft原样交给update，保留id、tempId和raw扩展字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不发送update请求。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-season-list', mapping: {}, instruction: '重新调用list确认内外温度上下限和展示文本；不能只依据true宣布已落库。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前温度设置行', capabilityId: 'product-setting-hatch-manage-season-remove', mapping: { id: 'result.id', tempId: 'result.tempId' }, instruction: '只把prepareRemove返回的双ID交给remove；确认前不发送GET。' })
    steps.push({ role: 'cancel', when: '用户取消删除确认', instruction: '丢弃id和tempId，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-season-list', mapping: {}, instruction: '重新调用list确认同一内外温度对照记录不再出现；不要把GET改成DELETE。' })

  const output = isList
    ? listOutput
    : isPrepareCreate
      ? createDraftOutput
      : isPrepareUpdate
        ? updateDraftOutput
        : isPrepareRemove
          ? { shape: '{ id: string | number, tempId: string | number }', fields: [field('id', 'string | number', '待用户确认后用于删除的外界温度记录ID。'), field('tempId', 'string | number', '待用户确认后用于删除的舍内温度记录ID。')], empty: 'id或tempId为空时抛错，且不发请求。' }
          : trueOutput
  const effect: AiContract['effect'] = isList ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'

  return {
    purpose: isList ? '按Portal外界温度范围分页读取温度设置。' : isPrepareCreate ? '按Portal新建弹窗规则准备温度设置草稿。' : isCreate ? '按Portal当前页面请求创建内外温度对照。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备温度设置草稿。' : isUpdate ? '按Portal当前页面请求编辑内外温度对照。' : isPrepareRemove ? '准备一个经过用户确认的内外温度双ID删除草稿。' : '按Portal当前页面GET接口删除内外温度对照。',
    whenToUse: `需要在${PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH}页面执行对应${isList ? '查询' : '操作'}时使用。`,
    effect,
    inputs: inputFor(id),
    output,
    consume: isList
      ? ['用list[].id和list[].tempId进入删除流程；用list[].inTitle/outTitle展示当前温度范围；total用于分页终止判断。']
      : isPrepareCreate
        ? ['把draft展示给用户；确认后交给create，不补写入接口未要求的ID。']
        : isCreate
          ? ['true只表示请求未抛错；必须list回查实际记录。']
          : isPrepareUpdate
            ? ['把draft展示给用户；确认后原样交给update，扩展字段只用于复刻Portal raw透传。']
            : isUpdate
              ? ['true只表示请求未抛错；必须list回查四个温度边界和展示文本。']
              : isPrepareRemove
                ? ['用户确认前只保存双ID；取消只丢弃本地草稿。']
                : ['请求成功或响应不确定后调用list回查，不把删除接口返回消息当作记录已消失的证据。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户会话token，并确认用户拥有页面菜单权限；新建/编辑需要program:season:submit，删除需要program:season:delete。', ...(isCreate || isPrepareCreate || isUpdate || isPrepareUpdate || isRemove || isPrepareRemove ? ['写操作目标应来自当前页面最近一次list结果或同一次prepare结果。'] : [])],
    steps,
    completion: isList ? '获得与Portal列表customLoad消费形状一致的list和total。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : '请求按Portal页面的URL、HTTP方法、参数和表单字段完成；业务终态仍需list回查。',
    failures: ['表单必填、温度范围、双ID、分页、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功。'],
    idempotency: isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove ? null : '页面没有requestId幂等协议；写请求超时或响应不确定时先list回查，确认目标记录后再决定是否重试，避免重复写入或重复删除。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingHatchManageSeasonCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置温度设置契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_HATCH_MANAGE_SEASON_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS).map(([id, method]) => [
    `productSettingHatchManageSeason.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingHatchManageSeason.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
