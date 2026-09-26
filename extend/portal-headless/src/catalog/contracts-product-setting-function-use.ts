import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_FUNCTION_USE_METHODS,
  PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH,
  productSettingFunctionUseCapabilities,
} from '../capabilities/product-setting-function-use.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingFunctionUseCapabilities.map(definition => [definition.id, definition]))

const rowFields: AiField[] = [
  field('id', 'string | number | null', '当前租户功能覆盖记录ID；系统功能尚未建立租户覆盖时为null。', { nullable: true, nullMeaning: '该功能当前沿用系统功能名单的默认停用状态；提交启用/停用时必须保留null，后端会按Portal规则新建租户覆盖记录。' }),
  field('functionCode', 'string | null', '功能编码；提交时作为后端校验和新建租户记录的业务键。', { nullable: true, nullMeaning: '后端没有返回功能编码，不能执行切换。' }),
  field('functionName', 'string | null', '功能名称；页面展示文本，提交新建租户覆盖时随请求发送。', { nullable: true, nullMeaning: '后端没有返回功能名称；Java接口不以它做必填校验。' }),
  field('remarks', 'string | null', '功能备注；只读展示字段，切换请求不会发送。', { nullable: true, nullMeaning: '没有备注。' }),
  field('status', '0 | 1 | null', '当前状态：0停用、1启用；页面显示“停用/启用”并把下一次操作设为相反值。', { nullable: true, values: { '0': '停用', '1': '启用' }, nullMeaning: '响应没有可识别的状态，不能准备切换。' }),
]

const draftFields: AiField[] = [
  field('$', 'object', '尚未写入的功能开关启停草稿；来自prepareSwitch。'),
  field('draft', 'object', '确认后原样交给switchStatus的请求参数。'),
  field('draft.id', 'string | number | null', '当前租户覆盖记录ID；没有覆盖记录时保持null，不能改成系统功能ID或任意新ID。', { nullable: true, nullMeaning: 'openOrClose会按functionCode和当前租户新建覆盖记录。' }),
  field('draft.functionCode', 'string', '功能编码；后端openOrClose的必填业务参数。'),
  field('draft.functionName', 'string | null', '功能名称；从当前列表行透传给后端，允许为null。', { nullable: true, nullMeaning: 'Portal也会发送当前行的空名称。' }),
  field('draft.status', '0 | 1', '绝对目标状态：0停用、1启用；由当前行status反转，不是“加一/减一”。', { values: { '0': '停用', '1': '启用' } }),
  field('previous', 'object', 'prepareSwitch记录的当前状态摘要，用于展示确认信息或在提交后核对。'),
  field('previous.id', 'string | number | null', 'prepare时列表行的租户覆盖记录ID。', { nullable: true, nullMeaning: 'prepare时没有租户覆盖记录。' }),
  field('previous.functionCode', 'string', 'prepare时列表行的功能编码。'),
  field('previous.functionName', 'string | null', 'prepare时列表行的功能名称。', { nullable: true, nullMeaning: 'prepare时没有功能名称。' }),
  field('previous.status', '0 | 1', 'prepare时列表行的当前状态；用于判断目标状态是否为反转值。', { values: { '0': '停用', '1': '启用' } }),
]

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含后端更新后的功能开关行。')],
  empty: '请求、权限或响应错误时抛错；true不等于列表已回查确认。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH}，菜单权限是/dashboard/frame/business/function-use；页面声明查询权限management:function-use:query和操作权限management:function-use:submit。SDK不绕过页面或服务端权限。`,
  '所有请求使用Portal product HTTP实例并补devicetype=PC；该页面module-type推导结果为null，因此不发送module-type。',
  '列表customLoad没有筛选表单，useListPageModule只传order=""和orderField=""；getDataListIsPage=false，所以SDK返回功能开关数组，不伪造分页字段。',
  'Portal操作按钮只有在permissionCheck(\'management:function-use:submit\')通过时才显示；确认弹窗点击确定后才发送GET /config/functionUse/openOrClose，取消只丢弃本地动作。',
  'openOrClose发送id、functionCode、functionName、status四个params，其中status是Number(!record.status)得到的绝对目标值。id为null时保留null：Java服务会为当前租户新建覆盖记录；id非空时按ID更新状态。',
  'Java列表先读取tenant_id=0的系统功能名单；非管理用户再叠加当前租户覆盖，未找到覆盖时把id置null、status置0。因此null-id行是页面可达的“首次启用”路径，不是坏数据。',
  '页面没有独立取消接口、删除入口或详情入口；写入后的恢复只能重新读取列表并再次按当前行反转，不能把true回执解释为后端记录已独立核实。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/business-manage/function-use.vue 与 list.vue', kind: 'reference', note: '逐页核对菜单路径、页面权限、query/submit权限、非分页列表、列字段、确认弹窗、按钮可见性和实际GET参数。' },
  { source: 'common/libs/renren/list.js 与 app/portal/utils/http/product.js', kind: 'reference', note: '核对order/orderField默认值、非分页customLoad消费形状、product实例和响应解包规则。' },
  { source: 'TenantFunctionUseController、TenantFunctionUseServiceImpl、TenantFunctionUseMapperExt.xml、TenantFunctionUse.java', kind: 'reference', note: '核对系统功能/租户覆盖列表合并、null-id新建分支、按ID更新分支、functionCode/status校验和字段类型。' },
  { source: 'src/capabilities/product-setting-function-use.ts 与 test/product-setting-function-use.test.ts', kind: 'implementation', note: '锁定Portal请求、null-id提交、状态反转、权限边界和离线反证；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置功能开关.md', kind: 'reference', note: '记录页面四件套、权限、请求映射、null-id业务语义和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行查询、对一条id=null系统功能确认启用、回查租户覆盖并执行反向停用；离线请求与源码证据不替代真实页面写闭环。',
  '后端openOrClose返回空成功包络，不返回更新后的记录；SDK只能返回true，必须用list按functionCode回查，且当前未完成真实环境回查。',
]

const listInputs: Record<string, AiParameter> = {}
const currentInput = param('来自同一次list调用的完整功能开关行；必须保留id、functionCode、functionName和status，尤其不能把id=null改成任意ID。', 'productSettingFunctionUse.list.result[]', { type: 'object', required: true, constraints: ['status必须为0或1', 'functionCode必须为非空字符串'] })
const draftInput = param('prepareSwitch返回的draft；确认后原样交给switchStatus，不要重新计算status或丢弃null id。', 'productSettingFunctionUse.prepareSwitch.result.draft', { type: 'object', required: true })

function contractFor (id: string): AiContract {
  const isList = id === 'product-setting-function-use-list'
  const isPrepare = id === 'product-setting-function-use-prepare-switch'
  const steps: AiContract['steps'] = []
  if (isPrepare) {
    steps.push({ role: 'required', when: '用户明确确认对当前行执行页面显示的启用或停用动作', capabilityId: 'product-setting-function-use-switch-status', mapping: { draft: 'result.draft' }, instruction: '把同一份draft原样提交；不要把id=null替换成新ID，也不要把目标status改成当前status。' })
    steps.push({ role: 'cancel', when: '用户取消确认或只想查看当前状态', instruction: '丢弃draft，不调用switchStatus。' })
  }
  if (!isList && !isPrepare) {
    steps.push({ role: 'required', when: '提交请求成功或响应超时后需要确认当前功能状态', capabilityId: 'product-setting-function-use-list', mapping: {}, instruction: '重新读取列表，按同一functionCode定位行并核对status；id=null的新建分支应在回查中出现非空租户覆盖ID。' })
    steps.push({ role: 'cancel', when: '用户在确认前撤销操作', instruction: '不要调用switchStatus；丢弃prepareSwitch返回的draft。' })
  }
  return {
    purpose: isList ? '读取Portal功能开关表格。' : isPrepare ? '按当前列表行准备一次与Portal按钮相同的启用/停用反转请求。' : '按Portal确认后的功能开关目标状态执行启用或停用。',
    whenToUse: `需要在${PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH}页面${isList ? '读取功能开关' : isPrepare ? '准备启用或停用动作' : '提交已确认的启用或停用动作'}时使用。`,
    effect: isList ? 'read' : isPrepare ? 'prepare' : 'write',
    inputs: isList ? listInputs : isPrepare ? { current: currentInput } : { draft: draftInput },
    output: isList
      ? { shape: 'object[]', fields: [field('$', 'object[]', '非分页功能开关数组。'), ...rowFields.map(item => ({ ...item, path: `[].${item.path}` }))], empty: '[]表示当前Portal列表没有功能行；权限、网络或后端错误会抛出。' }
      : isPrepare
        ? { shape: '{ draft: object, previous: object }', fields: draftFields, empty: 'current缺少非空functionCode、可识别status或对象形状错误时抛错，且不发请求。' }
        : trueOutput,
    consume: isList
      ? ['保留每行的functionCode、functionName、status和id；id=null表示首次为当前租户建立覆盖记录的可达页面状态。']
      : isPrepare
        ? ['先向用户展示previous.status对应的启用/停用确认；用户取消只丢弃draft。', '确认后把draft原样交给switchStatus；status=0表示停用，status=1表示启用。']
        : ['true只表示GET没有抛错；必须调用list并按同一functionCode核对最终status。', '若原draft.id为null，回查应重点确认该功能出现当前租户覆盖ID；若超时无法确认，不要盲目重复提交。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认拥有页面菜单权限；写操作还必须拥有management:function-use:submit。', ...(isPrepare || !isList ? ['current/draft必须来自最近一次list/prepare，避免用旧status或旧id覆盖当前状态。'] : [])],
    steps,
    completion: isList ? '获得与Portal表格消费形状一致的功能开关数组。' : isPrepare ? '获得一个尚未发送、目标status已经按Portal规则反转的草稿。' : 'GET请求受理且通过list回查确认同一functionCode的目标status；true本身不代表回查完成。',
    failures: ['current、draft、functionCode或status校验失败时不发请求；页面菜单/query/submit权限不足、网络错误或Java业务错误均抛出，不能降级为空数组或假成功。', ...(!isList && !isPrepare ? ['请求超时或true后状态不确定时先list回查；只有回查仍未生效且用户明确要求才按最新行重新prepare，不能重复提交旧的null-id草稿。'] : [])],
    idempotency: isList || isPrepare ? null : '后端没有requestId；非空id的同一目标status更新可重复，但id=null时重复提交旧草稿可能重复创建租户覆盖记录。响应不确定时必须先list按functionCode回查，再决定是否用最新行重新prepare。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingFunctionUseCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`功能开关契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_FUNCTION_USE_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_FUNCTION_USE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_FUNCTION_USE_METHODS).map(([id, method]) => [
    `productSettingFunctionUse.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingFunctionUse.${method}；启停写操作遵循prepareSwitch→switchStatus→list回查步骤。`] },
  ]),
)
