import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_DICT_PLATFORM_METHODS } from '../capabilities/setting-dict-platform.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const typeId = param('字典类型主键；根列表用于识别记录，但进入字典数据子页必须使用 type 字符串。', 'setting-dict-type-list 返回的 list[].id', { type: 'string | number', required: true, constraints: ['正整数；长 ID 保留字符串，不要与字典数据条目 ID 混用。'] })
const dataId = param('字典数据条目主键。', 'setting-dict-data-list 返回的 list[].id 或 setting-dict-data-get 的 id', { type: 'string | number', required: true, constraints: ['正整数；必须来自当前租户视角可见数据。'] })
const dictType = param('字典类型代码；必须来自根列表 list[].type 或当前字典数据子页路由。', 'setting-dict-type-list 返回的 list[].type', { type: 'string', required: true, constraints: ['不能传字典类型主键 id；后端按该代码校验类型存在、启用和 tenant_editable。'] })

const typeFields: AiField[] = [
  field('list[]', 'object', '字典类型记录'),
  field('list[].id', 'string | number', '字典类型主键；本页“字典数据”入口使用同一行的 type，不使用该 id', { constraints: ['长整数可能以字符串返回'] }),
  field('list[].name', 'string | null', '字典名称；用于展示和名称筛选', { nullable: true, nullMeaning: '后端未返回名称，不能据此构造有效类型' }),
  field('list[].type', 'string | null', '字典类型英文代码；点击“字典数据”时作为子页路由和 dictType', { nullable: true, nullMeaning: '没有类型代码，不能进入该记录的字典数据子页' }),
  field('list[].status', '0 | 1 | null', '字典类型状态；0=开启、1=关闭', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('list[].remark', 'string | null', '字典类型备注', { nullable: true, nullMeaning: '未填写备注或后端返回空值' }),
  field('list[].createTime', 'string | number | null', '字典类型创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('list[].useSystem', 'integer | null', '字典所属系统：0公共、1人力、2财务、3资产、4生产、5采购、6销售、7门户、8科技、10平台', { nullable: true, nullMeaning: '后端未返回所属系统' }),
  field('list[].tenantEditable', '0 | 1 | null', '是否允许租户维护该类型的字典数据；租户接口查询会强制为1', { nullable: true, nullMeaning: '后端未返回该权限标记' }),
]

const dataFields: AiField[] = [
  field('list[]', 'object', '字典数据记录'),
  field('list[].id', 'string | number', '字典数据主键；编辑和删除使用它', { constraints: ['长整数可能以字符串返回'] }),
  field('list[].sort', 'integer | null', '显示排序；页面新建默认0，页面输入控件不允许负数', { nullable: true, nullMeaning: '后端未返回排序值' }),
  field('list[].label', 'string | null', '字典标签；页面显示文本', { nullable: true, nullMeaning: '后端未返回标签，不能把它当成有效提交值' }),
  field('list[].value', 'string | null', '字典值；业务数据实际保存的值', { nullable: true, nullMeaning: '后端未返回字典值，不能据此提交修改' }),
  field('list[].dictType', 'string | null', '所属字典类型代码；应与当前子页 dictType 一致', { nullable: true, nullMeaning: '后端未返回类型代码' }),
  field('list[].status', '0 | 1 | null', '字典数据状态；0=开启、1=关闭', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('list[].colorType', 'string | null', '颜色语义类型；当前 Portal 表单不展示，但编辑回显可能携带', { nullable: true, nullMeaning: '未设置颜色类型' }),
  field('list[].cssClass', 'string | null', 'CSS 样式类；当前 Portal 表单不展示', { nullable: true, nullMeaning: '未设置样式类' }),
  field('list[].remark', 'string | null', '字典数据备注', { nullable: true, nullMeaning: '未填写备注或后端返回空值' }),
  field('list[].createTime', 'string | number | null', '字典数据创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('list[].tenantId', 'string | number | null', '数据归属租户；0=平台共享，正数=租户私有', { nullable: true, nullMeaning: '后端未返回归属' }),
  field('list[].platform', 'boolean | null', '是否平台共享数据；true 时 Portal 禁用编辑和删除', { nullable: true, nullMeaning: '后端未返回来源标记' }),
]

const typePageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', '字典类型分页结果'), field('list', 'object[]', '当前页字典类型'), ...typeFields, field('total', 'number', '符合名称/类型筛选条件的记录总数，不是当前页条数')],
  empty: 'list=[] 表示当前页无类型；total=0 才表示筛选无记录，权限/网络/后端错误会抛出，不能降级为空页。',
}

const dataPageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', '字典数据分页结果'), field('list', 'object[]', '当前 dictType 的租户视角数据'), ...dataFields, field('total', 'number', '符合标签/状态筛选条件的记录总数，不是当前页条数')],
  empty: 'list=[] 表示当前页无数据；total=0 才表示筛选无记录，权限/网络/后端错误会抛出。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端 CommonResult<Boolean> 的业务成功值；不包含更新后的记录')],
  empty: '没有 true 或请求抛错都不能报告写入成功；成功后必须分页回查。',
}

const idOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', '后端返回的新字典数据 ID；保留原始 ID 形态')],
  empty: '没有有效 ID 时先按 dictType、label、value 回查，不能盲目重建。',
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/common.js 与 app/portal/views/dashboard/common/setting/dict-platform/all/list.vue、all/data/[type]/items.vue、all/data/[type]/[mode]/[id].vue @ bbcfc35154', kind: 'reference', note: '证明根菜单权限、platform 实例、分页参数、根页 type 导航、子页筛选/分页/平台行禁用、表单默认值、bridge 映射和请求路径。' },
  { source: 'DictTypeController、DictTypePageReqVO、DictTypeRespVO、DictTypeServiceImpl、DictTypeMapper @ b7a359adc9e', kind: 'reference', note: '证明租户字典类型查询强制 tenant_editable=1，类型 create/update/delete/export 明确拒绝，返回字段和分页筛选字段。' },
  { source: 'DictDataController、DictDataSaveReqVO、DictDataPageReqVO、DictDataRespVO、DictDataServiceImpl、DictDataMapper @ b7a359adc9e', kind: 'reference', note: '证明数据查询合并平台与当前租户，写入必须有当前租户、类型启用且 tenant_editable=1，只能编辑/删除租户自有数据，表单必填和状态规则。' },
  { source: 'src/capabilities/setting-dict-platform.ts 与 test/setting-dict-platform.test.ts', kind: 'implementation', note: '证明 SDK 最终请求形状、Portal 默认值、平台行写禁用、返回校验和离线反证；不替代真实环境写入回查。' },
]

const common = (effect: AiContract['effect'], purpose: string, inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries: [
    '只覆盖门户“系统设置 → 字典管理”根列表和从“字典数据”按钮可达的字典数据子页；不覆盖平台设置下的字典管理页面。',
    '根列表使用 platform HTTP 实例和 /admin-api/system/dict-type/page；页面模块类型为空，浏览器不发送 module-type。',
    '字典类型由平台维护：租户接口只返回 tenant_editable=1 的类型，Portal 根页的新增、编辑、删除按钮是注释掉的，Java 租户 Controller 对这些写接口明确拒绝。',
    '字典数据查询返回平台共享 + 当前租户自有数据；platform=true 的行在 Portal 禁止编辑和删除，写入还必须通过当前租户和可维护字典类型校验。',
    '当前证据来自固定 Portal/Java 源码和离线请求夹具，尚未在真实测试环境执行本页浏览器读请求及安全测试数据上的写入回查。',
  ],
  effect,
  prerequisites: ['使用带当前用户会话 token、tenantId 的 SDK；dictType、id 和更新字段来自当前页面读取，不能凭名称或猜测构造。'],
  inputs,
  output,
  consume,
  steps: [],
  completion: '交付本能力真实返回的数据；写操作返回 true/新 ID 仍需回查分页结果核实终态。',
  failures: ['参数、字典类型状态、tenant_editable、平台数据只读、租户归属、权限、网络或后端业务错误原样抛出；不能把失败降级为空结果或成功。'],
  idempotency: effect === 'write' ? '没有后端 requestId 幂等保证；请求超时先查询核实，不能盲目重复创建、修改或删除。' : null,
  evidence,
  gaps: ['未启动真实 Portal 页面完成读操作；未在安全测试数据上记录字典数据 create/update/delete 的 prepare → submit → verify → cleanup 闭环。当前后端没有通用 cancel 接口。'],
  ...extra,
})

export const SETTING_DICT_PLATFORM_AI_CONTRACTS: Record<string, AiContract> = {
  'setting-dict-type-list': common('read', '分页查询门户系统设置可维护的字典类型。', {
    name: param('字典名称筛选片段；页面按名称模糊匹配。', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串表示不筛选' }),
    type: param('字典类型英文代码筛选片段；页面按类型模糊匹配。', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串表示不筛选' }),
    pageNo: param('页码，从1开始。', '调用方分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数。', '调用方分页状态', { type: 'integer', required: false, default: '20', constraints: ['只能使用 Portal 下拉支持的10、20、50、100。'] }),
  }, typePageOutput, ['展示 list[].name、list[].type、list[].status、list[].remark、list[].useSystem 和 list[].tenantEditable。', '用户进入“字典数据”时必须从同一行取得 type 作为后续 dataList 的 dictType；不要把 id 当作 dictType。'], {
    completion: '交付当前筛选页；根列表空页不是权限失败。',
    steps: [{ role: 'optional', when: '用户点击某一类型的“字典数据”', capabilityId: 'setting-dict-data-list', mapping: { dictType: 'result.list[].type' }, instruction: '沿用所选行的 type 打开子页并查询数据；先确认 type 非空。' }],
  }),
  'setting-dict-data-list': common('read', '查询某个可维护字典类型的字典数据，复刻子页的标签、状态和分页筛选。', {
    dictType,
    label: param('字典标签筛选片段；页面按标签模糊匹配。', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串表示不筛选' }),
    status: param('字典数据状态：0=开启、1=关闭。', '用户筛选', { type: '0 | 1', required: false, nullable: true, omitted: 'Portal 清空选择时发送 undefined' }),
    pageNo: param('页码，从1开始。', '调用方分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数。', '调用方分页状态', { type: 'integer', required: false, default: '20', constraints: ['只能使用 Portal 下拉支持的10、20、50、100。'] }),
  }, dataPageOutput, ['展示 label、value、sort、status、remark 和 platform；platform=true 的平台行不能编辑或删除。', '创建/修改前保留 dictType、id、platform 和完整字段；不要用 label 代替 value 或 id。'], {
    steps: [{ role: 'optional', when: '用户要编辑一条非平台字典数据', capabilityId: 'setting-dict-data-get', mapping: { id: 'result.list[].id' }, instruction: '先读取同一条详情，再用详情中的完整字段提交。' }],
  }),
  'setting-dict-data-get': common('read', '读取一条字典数据的编辑详情。', { id: dataId }, { shape: 'object | null', fields: [field('$', 'object | null', '字典数据详情', { nullable: true, nullMeaning: '没有该条目，不能继续修改' }), ...dataFields.filter(item => item.path !== 'list[]').map(item => ({ ...item, path: item.path.replace(/^list\[\]\.?/, '') }))], empty: 'null 表示未找到数据；不能用列表缓存中的不完整行代替详情。' }, ['读取 dictType、label、value、sort、status、remark 和 platform；platform=true 时只读。'], {
    completion: '获得当前字典数据详情；尚未产生修改。',
    steps: [{ role: 'optional', when: '用户确认保存修改', capabilityId: 'setting-dict-data-update', mapping: { id: 'result.id', dictType: 'result.dictType', label: 'result.label', value: 'result.value', sort: 'result.sort', status: 'result.status', remark: 'result.remark' }, instruction: '保留当前未修改字段；平台数据不提交更新。' }],
  }),
  'setting-dict-data-create': common('write', '在当前租户可维护的字典类型下创建一个租户私有字典数据条目。', {
    dictType,
    label: param('字典标签。', '用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；最长100字符。'] }),
    value: param('字典值；业务数据实际保存的值。', '用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；最长100字符；同一 dictType 下必须唯一。'] }),
    sort: param('显示排序。', '用户输入', { type: 'integer', required: false, default: '0', constraints: ['Portal 输入控件不允许负数。'] }),
    status: param('状态：0=开启、1=关闭。', '用户选择', { type: '0 | 1', required: false, default: '0' }),
    remark: param('备注。', '用户输入', { type: 'string | null', required: false, default: "''" }),
  }, idOutput, ['保留新建 ID，并用 dataList 按 dictType、label、value 回查；成功回查后才能报告创建完成。'], {
    completion: 'POST 返回有效 ID 且分页回查确认新条目出现并字段一致后，才算创建已验证。',
    steps: [{ role: 'required', when: '创建成功或超时需要核实', capabilityId: 'setting-dict-data-list', mapping: { dictType: 'args.dictType', label: 'args.label' }, instruction: '分页查找同一 dictType 下唯一匹配的 label/value，核对 sort、status、remark；没有或多个匹配时报告结果不确定。' }],
  }),
  'setting-dict-data-update': common('write', '按 Portal 字典数据表单修改一个当前租户自有条目。', {
    id: dataId,
    dictType,
    label: param('字典标签。', '当前详情或用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；最长100字符。'] }),
    value: param('字典值。', '当前详情或用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；最长100字符；同一 dictType 下必须唯一。'] }),
    sort: param('显示排序。', '当前详情或用户输入', { type: 'integer', required: false, default: '0' }),
    status: param('状态：0=开启、1=关闭。', '当前详情或用户选择', { type: '0 | 1', required: false }),
    remark: param('备注。', '当前详情或用户输入', { type: 'string | null', required: false }),
  }, trueOutput, ['先用 dataGet 读取同一 id；提交完整 dictType、label、value、sort、status、remark。成功后用 dataList 按 id 回查。'], {
    completion: 'PUT 返回 true 且分页回查确认同一 id 的字段均为新值后，才算修改已验证。',
    steps: [{ role: 'required', when: '修改成功或超时需要核实', capabilityId: 'setting-dict-data-list', mapping: { dictType: 'args.dictType' }, instruction: '跨页查找同一 id，核对 dictType、label、value、sort、status、remark；不能只看 true 回执。' }],
  }),
  'setting-dict-data-remove': common('write', '删除一个当前租户自有、非平台共享的字典数据条目。', { id: dataId, platform: param('当前列表行是否平台共享；true 时 Portal 按钮禁用。', 'setting-dict-data-list 的 list[].platform', { type: 'boolean', required: false, nullable: true }) }, trueOutput, ['删除请求只传 id 查询参数；平台数据和其他租户数据由页面/后端拒绝。成功或超时后用 dataList 跨页核对目标 ID 已消失。'], {
    completion: 'DELETE 返回 true 且分页回查确认目标 ID 不再出现后，才算删除已验证。',
    steps: [{ role: 'required', when: '删除成功或超时需要核实', capabilityId: 'setting-dict-data-list', mapping: { dictType: 'user.dictType' }, instruction: '按原 dictType 跨页查找目标 ID；不能只检查第一页，也不能把删除类型解释成清理了字典类型。' }],
  }),
}

export const SETTING_DICT_PLATFORM_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_METHODS).map(([id, method]) => [`settingDictPlatform.${method}`, { ...SETTING_DICT_PLATFORM_AI_CONTRACTS[id]!, boundaries: [...SETTING_DICT_PLATFORM_AI_CONTRACTS[id]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，根 list 仍可省略参数对象。'] }]),
)
