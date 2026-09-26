import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_DICT_PLATFORM_COMMON_METHODS } from '../capabilities/setting-dict-platform-common.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const dataId = param('公共字典数据条目主键；用于读取详情、编辑或删除。', 'setting-dict-platform-common-data-list 返回的 list[].id 或 data-get 的 id', { type: 'string | number', required: true, constraints: ['正整数；后端 Long 可能以字符串返回，保留原始值。'] })
const dictType = param('公共字典类型代码；不是字典类型主键 id。', 'setting-dict-platform-common-type-list 返回的 list[].type', { type: 'string', required: true, constraints: ['必须使用当前公共字典类型行的 type；不能把类型 id 传入 dictType。'] })

const typeFields: AiField[] = [
  field('list[]', 'object', '公共字典类型记录'),
  field('list[].id', 'string | number', '字典类型主键；公共字典数据入口使用同一行的 type，不使用该 id', { constraints: ['长整数可能以字符串返回'] }),
  field('list[].name', 'string | null', '字典名称；用于展示和名称筛选', { nullable: true, nullMeaning: '后端未返回名称，不能据此构造有效类型' }),
  field('list[].type', 'string | null', '字典类型代码；进入字典数据子页时传给 dictType', { nullable: true, nullMeaning: '没有类型代码，不能进入该记录的字典数据子页' }),
  field('list[].status', '0 | 1 | null', '字典类型状态；0=开启、1=关闭', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('list[].remark', 'string | null', '字典类型备注', { nullable: true, nullMeaning: '未填写备注或后端返回空值' }),
  field('list[].createTime', 'string | number | null', '字典类型创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('list[].useSystem', 'integer | null', '所属系统；本页固定筛选 0，0 表示公共', { nullable: true, nullMeaning: '后端未返回所属系统' }),
  field('list[].tenantEditable', '0 | 1 | null', '是否允许租户维护该类型的字典数据；1 才能通过租户数据接口写入', { nullable: true, nullMeaning: '后端未返回维护权限标记' }),
]

const dataFields: AiField[] = [
  field('list[]', 'object', '公共字典数据记录'),
  field('list[].id', 'string | number', '字典数据主键；编辑和删除使用它', { constraints: ['长整数可能以字符串返回'] }),
  field('list[].sort', 'integer | null', '显示排序；新建默认 0，页面输入不允许负数', { nullable: true, nullMeaning: '后端未返回排序值' }),
  field('list[].label', 'string | null', '字典标签；页面显示文本，也用于筛选', { nullable: true, nullMeaning: '后端未返回标签，不能当作有效提交值' }),
  field('list[].value', 'string | null', '字典值；业务数据实际保存的值', { nullable: true, nullMeaning: '后端未返回字典值，不能当作有效提交值' }),
  field('list[].dictType', 'string | null', '所属公共字典类型代码；应与当前子页 dictType 一致', { nullable: true, nullMeaning: '后端未返回类型代码' }),
  field('list[].status', '0 | 1 | null', '字典数据状态；0=开启、1=关闭', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('list[].colorType', 'string | null', '颜色类型；页面列表和表单不展示，但详情回显可能携带', { nullable: true, nullMeaning: '未设置颜色类型' }),
  field('list[].cssClass', 'string | null', 'CSS 样式类；页面不展示', { nullable: true, nullMeaning: '未设置样式类' }),
  field('list[].remark', 'string | null', '字典数据备注', { nullable: true, nullMeaning: '未填写备注或后端返回空值' }),
  field('list[].createTime', 'string | number | null', '字典数据创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('list[].tenantId', 'string | number | null', '数据归属租户；0 表示平台共享，正数表示租户私有', { nullable: true, nullMeaning: '后端未返回归属' }),
  field('list[].platform', 'boolean | null', '是否平台共享数据；true 时 Portal 禁用编辑和删除', { nullable: true, nullMeaning: '后端未返回平台标记' }),
]

const typePageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', '公共字典类型分页结果'), field('list', 'object[]', '当前页公共字典类型'), ...typeFields, field('total', 'number', '符合名称/类型筛选条件且 useSystem=0 的记录总数，不是当前页条数')],
  empty: 'list=[] 表示当前页无类型；total=0 才表示筛选无记录，权限/网络/后端错误会抛出，不能降级为空页。',
}

const dataPageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', '公共字典数据分页结果'), field('list', 'object[]', '当前 dictType 的租户视角数据；包含平台共享和当前租户自有数据'), ...dataFields, field('total', 'number', '符合 dictType、标签和状态筛选条件的记录总数，不是当前页条数')],
  empty: 'list=[] 表示当前页无数据；total=0 才表示筛选无记录；权限/网络/后端错误会抛出。',
}

const detailFields = dataFields.filter(item => item.path !== 'list[]').map(item => ({ ...item, path: item.path.replace(/^list\[\]\.?/, '') }))
const detailOutput: AiContract['output'] = {
  shape: 'object | null',
  fields: [field('$', 'object | null', '公共字典数据详情', { nullable: true, nullMeaning: '后端没有返回记录；不能继续编辑' }), ...detailFields],
  empty: 'null 表示响应没有详情；不能把空详情当作可编辑草稿。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端 CommonResult<Boolean> 的业务成功值；不包含更新后的记录')],
  empty: '没有 true 或请求抛错都不能报告写入成功；成功后必须分页回查。',
}

const idOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', '后端返回的新建公共字典数据 ID；保留原始 ID 形态')],
  empty: '没有有效 ID 时先按原 dictType、label、value 回查，不能盲目重建。',
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/common.js、app/portal/views/dashboard/common/setting/dict-platform/common/list.vue、all/list.vue、all/data/[type]/items.vue、all/data/[type]/[mode]/[id].vue @ acab69acc7', kind: 'reference', note: '证明公共字典菜单路径/权限、SYSTEM_COMMON_VALUE=0、platform 实例、根页筛选与导航、数据子页筛选/分页/新增/编辑/单删、平台行禁用和 bridge 提交映射。' },
  { source: 'DictTypeController、DictTypePageReqVO、DictTypeRespVO @ 0f1a55718eb；DictTypeMapper', kind: 'reference', note: '证明类型分页的 useSystem/name/type 筛选、强制 tenant_editable=1，以及租户类型 create/update/delete/export 接口拒绝。' },
  { source: 'DictDataController、DictDataPageReqVO、DictDataRespVO、DictDataSaveReqVO、DictDataServiceImpl、DictDataMapper @ 0f1a55718eb', kind: 'reference', note: '证明数据分页/详情/新增/更新/单删路径、租户视角查询、当前租户写入、平台共享只读、表单必填/状态/排序校验和返回字段。' },
  { source: 'src/capabilities/setting-dict-platform-common.ts 与 test/setting-dict-platform-common.test.ts', kind: 'implementation', note: '证明 SDK 最终请求形状、固定 useSystem=0、返回校验、平台数据写入拒绝和离线反证；不替代真实环境 smoke。' },
]

const base = (effect: AiContract['effect'], purpose: string, inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries: [
    '只覆盖 /dashboard/setting/dict-platform/common/list 公共字典及其“字典数据”子页；不覆盖同名的平台设置 /dashboard/platform/setting/dict-mall/common/list，也不覆盖人力、财务、资产、生产、采购、销售字典页。',
    '类型列表固定使用 platform HTTP 实例、/admin-api/system/dict-type/page 和 useSystem=0；该固定值不是调用参数，module-type 无法推导时不发送。',
    '类型根页的新增、编辑、删除按钮在 Portal 中被注释；Java 租户 DictTypeController 的写接口和导出接口也明确拒绝，因此本页面不提供类型写入或导出能力。',
    '数据子页只显示标签/状态筛选、分页、新增、编辑和单条删除；没有批量删除、导入或导出按钮。查询是平台共享 + 当前租户自有数据，写入必须是当前租户且类型 tenant_editable=1。',
    '本页写操作没有 prepare/cancel 协议；写请求超时或回执异常时必须先回查，不得把请求受理当成业务已生效。',
  ],
  effect,
  prerequisites: ['使用带当前用户会话 token、tenantId 的 SDK；写操作的 dictType/id 来自当前公共字典页面可见数据，用户已确认要提交的标签、值、排序、状态和备注。'],
  inputs,
  output,
  consume,
  steps: [],
  completion: '交付本能力真实返回的数据；写操作返回 true/新 ID 仍需按后续步骤回查，不能把请求成功解释为审批或其他业务流程已完成。',
  failures: ['参数校验、类型不存在/未启用、tenant_editable 不满足、平台数据只读、当前租户缺失、权限、网络或后端业务错误均原样抛出；不能把失败降级为空页或 true。'],
  idempotency: effect === 'write' ? '后端没有 requestId 幂等包装；同一创建请求重试可能因 (dictType,value) 唯一约束报冲突，更新/删除超时先按 ID 回查，再决定是否重试。' : null,
  evidence,
  gaps: ['未启动真实 Portal 页面或 smoke；未在安全测试数据上执行并记录新增/编辑/删除的真实写后回查。由于本页没有 prepare/cancel 接口，不适用会议申请式 prepare → submit → cancel 闭环。'],
  ...extra,
})

export const SETTING_DICT_PLATFORM_COMMON_AI_CONTRACTS: Record<string, AiContract> = {
  'setting-dict-platform-common-type-list': base('read', '查询系统设置下的公共字典类型分页。', {
    name: param('字典名称筛选片段；页面按名称模糊匹配。', '用户输入', { type: 'string', required: false, omitted: '省略时 SDK 发送空字符串，不按名称筛选' }),
    type: param('字典类型代码筛选片段；页面按类型模糊匹配。', '用户输入', { type: 'string', required: false, omitted: '省略时 SDK 发送空字符串，不按类型筛选' }),
    pageNo: param('页码，从 1 开始。', '调用方分页状态', { type: 'integer', required: false, default: '1；由 SDK 补齐', constraints: ['正整数'] }),
    pageSize: param('每页条数。', '调用方分页状态', { type: 'integer', required: false, default: '20；由 SDK 补齐', constraints: ['只能使用 Portal 支持的 10、20、50、100'] }),
  }, typePageOutput, ['展示 list[].name、type、status、remark、createTime；保留 list[].type 作为进入字典数据子页的 dictType。', '只消费 useSystem=0 的公共类型；tenantEditable=1 是 Java 租户数据写入的前置条件，不能把类型 id 代替 type。'], {
    completion: '返回当前筛选条件下的公共字典类型当前页和 total；空页是查询结果，不是权限失败。',
  }),
  'setting-dict-platform-common-data-list': base('read', '查询某个公共字典类型下的平台共享与当前租户自有字典数据分页。', {
    dictType,
    label: param('字典标签筛选片段；页面按标签模糊匹配。', '用户输入', { type: 'string', required: false, omitted: '省略时 SDK 发送空字符串，不按标签筛选' }),
    status: param('字典数据状态。', '用户筛选；0=开启，1=关闭', { type: '0 | 1 | null', required: false, nullable: true, omitted: '省略或传 null 时发送 undefined，不按状态筛选', nullMeaning: '不限制状态', options: [{ value: 0, label: '开启' }, { value: 1, label: '关闭' }] }),
    pageNo: param('页码，从 1 开始。', '调用方分页状态', { type: 'integer', required: false, default: '1；由 SDK 补齐' }),
    pageSize: param('每页条数。', '调用方分页状态', { type: 'integer', required: false, default: '20；由 SDK 补齐', constraints: ['只能使用 Portal 支持的 10、20、50、100'] }),
  }, dataPageOutput, ['展示 value、label、status、sort、remark、createTime；platform=true 的行只读，不能编辑或删除。', '翻页回查时继续使用同一个 dictType；不要用 label 替代 value 或 id。'], {
    steps: [{ role: 'optional', when: '用户要编辑某条非平台共享数据', capabilityId: 'setting-dict-platform-common-data-get', mapping: { id: 'result.list[].id' }, instruction: '从用户选中的当前页行取得 id，读取详情后保留完整字段再提交。' }],
  }),
  'setting-dict-platform-common-data-get': base('read', '读取一条当前公共字典数据的编辑详情。', { id: dataId }, detailOutput, ['读取 dictType、label、value、sort、status、remark 和 platform；platform=true 时不得继续写入。', '详情接口按 id 读取，调用方仍必须只使用当前公共字典列表中可见的 id，不要猜测或跨范围枚举 ID。'], {
    completion: '获得指定 ID 的详情；本能力本身不产生修改。',
    steps: [{ role: 'optional', when: '用户确认修改且详情中的 platform 不为 true', capabilityId: 'setting-dict-platform-common-data-update', mapping: { id: 'result.id', dictType: 'result.dictType', label: 'result.label', value: 'result.value', sort: 'result.sort', status: 'result.status', remark: 'result.remark' }, instruction: '使用详情字段作为未修改值，按用户意图替换要修改的字段；不要提交平台共享记录。' }],
  }),
  'setting-dict-platform-common-data-create': base('write', '在一个允许租户维护的公共字典类型下创建当前租户私有字典数据。', {
    dictType,
    label: param('字典标签。', '用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；Java 后端长度上限 100 个字符'] }),
    value: param('字典值；同一 dictType 下必须唯一。', '用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；Java 后端长度上限 100 个字符'] }),
    sort: param('显示排序。', '用户输入', { type: 'integer', required: false, default: '0；由 SDK 补齐', constraints: ['非负整数；Java 后端要求非空'] }),
    status: param('状态：0=开启，1=关闭。', '用户选择', { type: '0 | 1', required: false, default: '0；由 SDK 补齐', options: [{ value: 0, label: '开启' }, { value: 1, label: '关闭' }] }),
    remark: param('备注。', '用户输入', { type: 'string | null', required: false, default: "''；由 SDK 将省略值转为空字符串", nullable: true, nullMeaning: '按 Portal 表单映射为空备注' }),
  }, idOutput, ['保留返回的新 ID；按原 dictType 分页查找唯一匹配的 label/value，核对 sort、status、remark。'], {
    completion: 'POST 返回有效 ID 且 dataList 回查确认新条目出现并字段一致后，才算创建已验证；这不代表平台或其他业务流程审批完成。',
    steps: [{ role: 'required', when: '创建成功或请求超时需要核实', capabilityId: 'setting-dict-platform-common-data-list', mapping: { dictType: 'args.dictType', label: 'args.label' }, instruction: '查找同一 dictType 下的 label/value 唯一匹配；没有匹配或出现多个匹配时报告结果不确定，禁止盲目重试。' }],
  }),
  'setting-dict-platform-common-data-update': base('write', '按公共字典数据表单修改一条当前租户自有数据。', {
    id: dataId,
    dictType,
    label: param('字典标签。', 'data-get 返回值或用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；Java 后端长度上限 100 个字符'] }),
    value: param('字典值。', 'data-get 返回值或用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；同一 dictType 下必须唯一；Java 后端长度上限 100 个字符'] }),
    sort: param('显示排序。', 'data-get 返回值或用户输入', { type: 'integer', required: false, default: '0', constraints: ['非负整数'] }),
    status: param('状态：0=开启，1=关闭。', 'data-get 返回值或用户选择', { type: '0 | 1', required: false, options: [{ value: 0, label: '开启' }, { value: 1, label: '关闭' }] }),
    remark: param('备注。', 'data-get 返回值或用户输入', { type: 'string | null', required: false, nullable: true, nullMeaning: '按空备注处理' }),
  }, trueOutput, ['先读取同一 id 的详情；提交完整 dictType、label、value、sort、status、remark。platform=true 时 Portal 直接禁用，后端也会拒绝非当前租户数据。', '成功后按 dictType 跨页回查同一 id，逐字段核对。'], {
    completion: 'PUT 返回 true 且 dataList 回查确认同一 ID 的字段均为新值后，才算修改已验证。',
    steps: [{ role: 'required', when: '修改成功或请求超时需要核实', capabilityId: 'setting-dict-platform-common-data-list', mapping: { dictType: 'args.dictType' }, instruction: '跨页查找同一 id，核对 dictType、label、value、sort、status、remark；不能只看 true 回执。' }],
  }),
  'setting-dict-platform-common-data-remove': base('write', '删除一条当前租户自有且非平台共享的公共字典数据。', {
    id: dataId,
    platform: param('当前列表行是否平台共享；true 时 Portal 禁用删除。', 'setting-dict-platform-common-data-list 返回的 list[].platform', { type: 'boolean | null', required: false, nullable: true, nullMeaning: '后端未返回标记；不能据此证明可删除' }),
  }, trueOutput, ['只提交 id 查询参数；删除前确认列表行 platform 不为 true。成功或超时后使用原 dictType 分页回查，确认目标 ID 已消失。'], {
    completion: 'DELETE 返回 true 且 dataList 回查确认目标 ID 不再出现后，才算删除已验证；不表示删除了字典类型或关联业务数据。',
    steps: [{ role: 'required', when: '删除成功或请求超时需要核实', capabilityId: 'setting-dict-platform-common-data-list', mapping: { dictType: 'user.dictType' }, instruction: '从原数据子页路由或用户当前上下文取得 dictType，跨页检查目标 id；若仍存在或查询失败，报告结果不确定。' }],
  }),
}

export const SETTING_DICT_PLATFORM_COMMON_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_COMMON_METHODS).map(([id, method]) => [`settingDictPlatformCommon.${method}`, { ...SETTING_DICT_PLATFORM_COMMON_AI_CONTRACTS[id]!, boundaries: [...SETTING_DICT_PLATFORM_COMMON_AI_CONTRACTS[id]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，根 list 可省略参数对象。'] }]),
)
