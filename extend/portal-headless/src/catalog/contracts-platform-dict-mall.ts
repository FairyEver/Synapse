import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_DICT_PLATFORM_AI_CONTRACTS } from './contracts-setting-dict-platform.js'
import { PLATFORM_DICT_MALL_COMMON_METHODS, PLATFORM_DICT_MALL_FINANCE_METHODS, PLATFORM_DICT_MALL_HR_METHODS, PLATFORM_DICT_MALL_MATERIAL_METHODS, PLATFORM_DICT_MALL_METHODS, PLATFORM_DICT_MALL_PRODUCT_METHODS, PLATFORM_DICT_MALL_SALE_METHODS, PLATFORM_DICT_MALL_SUPPLY_METHODS, type PlatformDictMallCapability } from '../capabilities/platform-dict-mall.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const typeFields: AiField[] = [
  field('list[]', 'object', '平台字典类型记录'),
  field('list[].id', 'string | number', '字典类型主键；进入字典数据子页时必须使用同一行的 type，不使用该 id', { constraints: ['长整数可能以字符串返回'] }),
  field('list[].name', 'string | null', '字典名称；用于展示和名称筛选', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('list[].type', 'string | null', '字典类型代码；作为子页路由和后续 dictType', { nullable: true, nullMeaning: '没有类型代码，不能进入该类型的字典数据子页' }),
  field('list[].status', '0 | 1 | null', '字典类型状态：0=开启、1=关闭', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('list[].remark', 'string | null', '字典类型备注', { nullable: true, nullMeaning: '未填写备注或后端返回空值' }),
  field('list[].createTime', 'string | number | null', '字典类型创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('list[].useSystem', 'integer | null', '所属系统值：0公共、1人力、2财务、3资产、4生产、5采购、6销售、7门户、8科技、10平台；这是字典类型属性，不是 SDK 的顶级模块范围', { nullable: true, nullMeaning: '后端未返回所属系统' }),
  field('list[].tenantEditable', '0 | 1 | null', '是否允许租户维护该类型的字典数据；平台管理列表可按该字段筛选', { nullable: true, nullMeaning: '后端未返回该权限标记' }),
]

const typePageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', '平台字典类型分页结果'), ...typeFields, field('total', 'number', '符合名称、类型和租户自定义筛选条件的记录总数，不是当前页条数')],
  empty: 'list=[] 表示当前页无类型；total=0 才表示筛选无记录，权限/网络/后端错误会抛出，不能降级为空页。',
}

const typeDetailOutput: AiContract['output'] = {
  shape: 'object | null',
  fields: [
    field('$', 'object | null', '平台字典类型详情', { nullable: true, nullMeaning: '没有该类型，不能继续编辑或进入其数据子页' }),
    field('id', 'string | number', '字典类型主键；长整数可能以字符串返回'),
    field('name', 'string | null', '字典名称', { nullable: true, nullMeaning: '后端未返回名称' }),
    field('type', 'string | null', '字典类型代码；后续数据操作使用它', { nullable: true, nullMeaning: '没有类型代码，不能提交字典数据' }),
    field('status', '0 | 1 | null', '字典类型状态：0=开启、1=关闭', { nullable: true, nullMeaning: '后端未返回状态' }),
    field('remark', 'string | null', '字典类型备注', { nullable: true, nullMeaning: '未填写备注' }),
    field('createTime', 'string | number | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
    field('useSystem', 'integer | null', '所属系统值；仅是字典属性', { nullable: true, nullMeaning: '后端未返回所属系统' }),
    field('tenantEditable', '0 | 1 | null', '是否允许租户维护数据', { nullable: true, nullMeaning: '后端未返回权限标记' }),
  ],
  empty: 'null 表示未找到或不可见的类型；不能用空对象代替。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端 CommonResult<Boolean> 的业务成功值；不包含更新后的记录')],
  empty: '没有 true 或请求抛错都不能报告写入成功；成功后必须回查。',
}

const idOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', '后端返回的新记录 ID；保留原始 ID 形态')],
  empty: '没有有效 ID 时不能报告创建成功；先按唯一业务字段回查。',
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/mall.v2.js 与 app/portal/views/dashboard/platform/setting/dict-mall/all/list.vue @ test/portal/main', kind: 'reference', note: '证明页面属于平台设置下的平台字典，菜单 permission 为 /dashboard/platform-v2/setting/dict-mall/all；不属于独立生产顶级模块。' },
  { source: 'app/portal/views/dashboard/common/setting/dict-platform-mall/all/list.vue、all/[mode]/[id].vue、all/data/[type]/items.vue、all/data/[type]/[mode]/[id].vue', kind: 'reference', note: '证明 adminmanage-api 请求路径、根类型和数据子页的分页、默认值、bridge 映射、表单提交与删除参数。' },
  { source: 'ManageDictTypeController、ManageDictDataController、DictTypeSaveReqVO、DictDataSaveReqVO、DictTypeServiceImpl、DictDataServiceImpl、DictDataMapper @ test/test', kind: 'reference', note: '证明平台管理接口允许类型写入，平台数据写入固定 tenant_id=0，及状态/必填/唯一性校验与平台归属限制；租户侧 /admin-api Controller 是另一套接口，不是本页请求。' },
  { source: 'src/capabilities/platform-dict-mall.ts 与 test/platform-dict-mall.test.ts', kind: 'implementation', note: '证明 SDK 最终请求形状、表单默认值、权限错误透传、响应校验和离线反证；不替代真实测试环境写入回查。' },
]

const boundaries = [
  '只覆盖门户“平台设置 → 平台字典 → 字典管理”根页和从该根页可达的字典数据子页；不覆盖同一菜单组下的公共字典、人力字典、财务字典、资产字典、生产字典、采购字典或销售字典 sibling 页面。',
  '根页和子页使用 platform HTTP 实例、/adminmanage-api/system/dict-* 路径；页面 module-type 为 null，浏览器不发送 module-type。',
  '类型列表走平台管理接口，支持按 useSystem/name/type/tenantEditable 筛选；平台管理 Controller 允许类型 create/update/delete，服务层校验存在性、名称/类型唯一性和子数据约束，SDK 不把菜单可见性误当作成功授权。租户侧 /admin-api Controller 的 tenant_editable 过滤和类型拒绝规则不适用于本页。',
  '字典数据查询和写入走平台管理接口：查询只看 tenant_id=0 的平台共享数据，创建固定 tenant_id=0，更新/删除必须验证平台归属；当前页面没有按 platform 字段在前端禁用操作，最终由平台服务校验裁决。',
  '根页的批量类型删除按钮没有配置有效 deleteURL；数据子页批量删除会发送 ids，但当前 Java Controller 只声明 Long id，SDK 将该页面请求单独登记为批量能力并如实返回后端结果。',
]

const common = (effect: AiContract['effect'], purpose: string, inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries,
  effect,
  prerequisites: ['使用带当前用户会话 token 和 tenantId 的 SDK；id、dictType 和更新字段来自当前页面读取，不能凭名称或猜测构造。'],
  inputs,
  output,
  consume,
  steps: [],
  completion: '交付 SDK 的真实返回值；写操作返回 true/新 ID 后仍需回查确认终态。',
  failures: ['参数、菜单/接口权限、平台归属、类型状态、唯一性、网络或后端业务错误原样抛出；不能把失败降级为空结果或成功。'],
  idempotency: effect === 'write' ? '没有后端 requestId 幂等保证；请求超时先查询核实，不能盲目重复创建、修改或删除。' : null,
  evidence,
  gaps: ['未在真实测试环境执行本页浏览器读请求；尚未用安全测试数据记录写入后的独立回查与清理证据。'],
  ...extra,
})

const typeId = param('字典类型主键；编辑/删除使用它，进入数据子页仍必须使用 type。', 'platform-dict-mall-type-list 返回的 list[].id', { type: 'string | number', required: true, constraints: ['正整数；长 ID 保留字符串。'] })
const dataId = param('字典数据条目主键。', 'platform-dict-mall-data-list 返回的 list[].id 或 platform-dict-mall-data-get 的 id', { type: 'string | number', required: true, constraints: ['正整数；保留长整数的字符串形态。'] })
const dictType = param('字典类型代码；必须来自平台字典类型 list[].type 或当前数据子页路由。', 'platform-dict-mall-type-list 返回的 list[].type', { type: 'string', required: true, constraints: ['不能传类型主键 id；后端按类型代码处理。'] })

const transformedIds: Record<string, string> = {
  'setting-dict-data-list': 'platform-dict-mall-data-list',
  'setting-dict-data-get': 'platform-dict-mall-data-get',
  'setting-dict-data-create': 'platform-dict-mall-data-create',
  'setting-dict-data-update': 'platform-dict-mall-data-update',
  'setting-dict-data-remove': 'platform-dict-mall-data-remove',
}

function replaceText (value: string): string {
  let result = value
  for (const [from, to] of Object.entries(transformedIds)) result = result.replaceAll(from, to)
  return result
    .replaceAll('settingDictPlatform.', 'platformDictMall.')
    .replaceAll('app/portal/menus/common.js', 'app/portal/menus/mall.v2.js')
    .replaceAll('app/portal/views/dashboard/common/setting/dict-platform', 'app/portal/views/dashboard/common/setting/dict-platform-mall')
    .replaceAll('/dashboard/setting/dict-platform/all/list', '/dashboard/platform/setting/dict-mall/all/list')
    .replaceAll('/dashboard/setting/dict-platform/all', '/dashboard/platform-v2/setting/dict-mall/all')
    .replaceAll('/admin-api/system/dict-', '/adminmanage-api/system/dict-')
    .replaceAll('门户“系统设置 → 字典管理”', '门户“平台设置 → 平台字典 → 字典管理”')
    .replaceAll('系统设置 → 字典管理', '平台设置 → 平台字典 → 字典管理')
    .replaceAll('门户系统设置', '平台设置下的平台字典')
    .replaceAll('平台设置下的字典管理页面', '其他平台字典 sibling 页面')
    .replaceAll('当前 dictType 的租户视角数据', '当前 dictType 的平台管理视角数据')
    .replaceAll('字典类型由平台维护：租户接口只返回 tenant_editable=1 的类型，Portal 根页的新增、编辑、删除按钮是注释掉的，Java 租户 Controller 对这些写接口明确拒绝。', '字典类型由平台维护：平台管理接口可按 useSystem、name、type、tenantEditable 筛选，并提供类型新增、编辑、删除；服务层校验记录存在、名称/类型唯一性和子数据约束。租户侧 /admin-api Controller 是另一套接口，不适用于本页。')
    .replaceAll('字典数据查询返回平台共享 + 当前租户自有数据；platform=true 的行在 Portal 禁止编辑和删除，写入还必须通过当前租户和可维护字典类型校验。', '字典数据查询只返回 tenant_id=0 的平台共享数据；平台管理页面未按 platform 字段提前禁用编辑/删除，写入由平台服务校验平台归属和字典类型启用状态。')
    .replaceAll('证明租户字典类型查询强制 tenant_editable=1，类型 create/update/delete/export 明确拒绝，返回字段和分页筛选字段。', '证明平台管理类型分页和类型写接口，以及返回字段和分页筛选字段；租户侧 /admin-api Controller 的拒绝规则不适用于本页。')
    .replaceAll('证明数据查询合并平台与当前租户，写入必须有当前租户、类型启用且 tenant_editable=1，只能编辑/删除租户自有数据，表单必填和状态规则。', '证明平台数据分页只返回 tenant_id=0，平台写入固定 tenant_id=0，并校验类型启用、平台归属、表单必填和状态规则。')
    .replaceAll('数据归属租户；0=平台共享，正数=租户私有', '数据归属租户；平台管理页只返回 tenant_id=0 的平台共享数据')
    .replaceAll('是否平台共享数据；true 时 Portal 禁用编辑和删除', '是否平台共享数据；平台管理子页未按该字段提前禁用编辑和删除，由平台服务校验')
    .replaceAll('展示 label、value、sort、status、remark 和 platform；platform=true 的平台行不能编辑或删除。', '展示 label、value、sort、status、remark 和 platform；平台管理子页不按 platform 字段提前禁用操作，最终由平台服务校验。')
    .replaceAll('读取 dictType、label、value、sort、status、remark 和 platform；platform=true 时只读。', '读取 dictType、label、value、sort、status、remark 和 platform；平台管理子页不因 platform 字段预先设为只读。')
    .replaceAll('平台数据不提交更新。', '保留平台行字段并提交平台管理接口。')
    .replaceAll('删除请求只传 id 查询参数；平台数据和其他租户数据由页面/后端拒绝。成功或超时后用 dataList 跨页核对目标 ID 已消失。', '删除请求只传 id 查询参数；平台管理服务会校验平台归属。成功或超时后用 dataList 跨页核对目标 ID 已消失。')
    .replaceAll('在当前租户可维护的字典类型下创建一个租户私有字典数据条目。', '在平台可维护的字典类型下创建一个平台共享字典数据条目。')
    .replaceAll('按 Portal 字典数据表单修改一个当前租户自有条目。', '按 Portal 字典数据表单修改一个平台共享条目。')
    .replaceAll('删除一个当前租户自有、非平台共享的字典数据条目。', '删除一个平台共享字典数据条目。')
    .replaceAll('参数、字典类型状态、tenant_editable、平台数据只读、租户归属、权限、网络或后端业务错误原样抛出；不能把失败降级为空结果或成功。', '参数、字典类型状态、平台归属、权限、网络或后端业务错误原样抛出；不能把失败降级为空结果或成功。')
    .replaceAll('当前租户视角', '平台管理视角')
    .replaceAll('当前租户可维护', '平台可维护')
    .replaceAll('当前租户自有', '平台共享')
    .replaceAll('租户私有字典数据', '平台共享字典数据')
    .replaceAll('租户私有', '平台共享')
    .replaceAll('tenant_editable', '字典类型启用状态')
    .replaceAll('平台数据只读', '平台数据由平台管理接口维护')
    .replaceAll('platform=true 时 Portal 禁止编辑和删除', 'platform=true 表示 tenant_id=0 的平台共享数据，页面不提前禁用，平台服务裁决可写性')
    .replaceAll('平台数据不提交更新', '保留平台行字段并提交给平台管理接口')
    .replaceAll('当前租户和可维护字典类型校验', '平台归属和字典类型启用校验')
    .replaceAll('平台数据和其他租户数据由后端拒绝', '非平台归属数据由平台后端拒绝')
}

function transformContract (contract: AiContract): AiContract {
  const cloned = JSON.parse(JSON.stringify(contract)) as AiContract
  const transform = (value: unknown): unknown => {
    if (typeof value === 'string') return replaceText(value)
    if (Array.isArray(value)) return value.map(transform)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item)]))
    return value
  }
  return transform(cloned) as AiContract
}

const inheritedDataContracts: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_DICT_PLATFORM_AI_CONTRACTS)
    .filter(([id]) => id !== 'setting-dict-type-list')
    .map(([id, contract]) => [transformedIds[id] ?? id, transformContract(contract)]),
)

inheritedDataContracts['platform-dict-mall-data-remove-batch'] = common('write', '按 Portal 数据子页批量删除入口提交一组字典数据 ID。', {
  ids: param('待删除的字典数据主键数组；页面 customDelete 会以 ids 查询参数发送。', '用户当前勾选的行', { type: '(string | number)[]', required: true, constraints: ['数组不能为空；每项必须是正整数。'] }),
}, trueOutput, ['当前 Java 平台管理 Controller 只声明单个 Long id；如果后端报参数或权限错误，不能把批量操作解释成已完成。'], {
  completion: '仅当后端返回 true 且按每个原 dictType 分页回查确认所有 ID 消失，才算批量删除已验证。',
  failures: ['空数组、非法 ID、Java 端不接受 ids、权限、平台归属、网络或后端错误均应报告失败。'],
  gaps: ['Portal 批量请求与当前 Java Controller 的单 ID 签名存在协议差距，尚未在真实环境验证其是否有网关转换。'],
})

export const PLATFORM_DICT_MALL_AI_CONTRACTS: Record<string, AiContract> = {
  'platform-dict-mall-type-list': common('read', '分页查询平台设置下平台字典的可维护字典类型。', {
    name: param('字典名称筛选片段；按名称模糊匹配。', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串表示不筛选' }),
    type: param('字典类型代码筛选片段；按类型模糊匹配。', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串表示不筛选' }),
    useSystem: param('所属系统筛选值；根页可按公共、人力、财务、资产、生产、采购、销售、门户、科技或平台筛选。', '用户筛选', { type: '0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10', required: false, nullable: true, omitted: '根页不选择系统时不发送该筛选值' }),
    tenantEditable: param('是否支持租户自定义：0=否、1=是。', '用户筛选', { type: '0 | 1', required: false, nullable: true, omitted: 'Portal 清空选择时不发送有效筛选值' }),
    pageNo: param('页码，从1开始。', '调用方分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数。', '调用方分页状态', { type: 'integer', required: false, default: '20', constraints: ['只能使用 Portal 支持的10、20、50、100。'] }),
  }, typePageOutput, ['展示类型字段；用户进入“字典数据”时必须把同一行的 type 映射给 platform-dict-mall-data-list 的 dictType。'], {
    completion: '交付当前筛选页；空页不是权限失败。',
    steps: [{ role: 'optional', when: '用户点击某一类型的“字典数据”', capabilityId: 'platform-dict-mall-data-list', mapping: { dictType: 'result.list[].type' }, instruction: '沿用所选行的 type 打开数据子页；先确认 type 非空。' }],
  }),
  'platform-dict-mall-type-get': common('read', '读取平台设置下一个可维护字典类型的编辑详情。', { id: typeId }, typeDetailOutput, ['读取完整类型字段后再决定是否提交编辑；null 不能当作空表单继续保存。'], {
    completion: '获得当前类型详情，尚未产生修改。',
    steps: [{ role: 'optional', when: '用户确认保存类型编辑', capabilityId: 'platform-dict-mall-type-update', mapping: { id: 'result.id', name: 'result.name', type: 'result.type', useSystem: 'result.useSystem', tenantEditable: 'result.tenantEditable', remark: 'result.remark', status: 'result.status' }, instruction: '保留未修改字段并提交完整类型表单；后端权限错误必须原样报告。' }],
  }),
  'platform-dict-mall-type-create': common('write', '按 Portal 根页类型表单创建一个平台字典类型。', {
    name: param('字典名称。', '用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；最长100字符。'] }),
    type: param('字典类型代码。', '用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；最长100字符。'] }),
    useSystem: param('所属系统值；Portal 新建默认0公共。', '用户选择', { type: '0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10', required: false, default: '0' }),
    tenantEditable: param('是否支持租户自定义；Portal 新建默认0。', '用户选择', { type: '0 | 1', required: false, default: '0' }),
    remark: param('备注。', '用户输入', { type: 'string | null', required: false, default: "''" }),
    status: param('状态：0=开启、1=关闭；Portal 新建默认0。', '用户选择', { type: '0 | 1', required: false, default: '0' }),
  }, idOutput, ['平台管理 Controller 会调用平台字典类型创建服务；只有收到有效 ID 并回查确认后才能报告成功。'], {
    completion: 'POST 返回有效 ID 且类型分页回查确认记录出现并字段一致后，才算创建已验证。',
    steps: [{ role: 'required', when: '创建成功或超时需要核实', capabilityId: 'platform-dict-mall-type-list', mapping: { name: 'args.name', type: 'args.type' }, instruction: '回查同名同类型记录；权限失败或没有唯一匹配时报告失败或结果不确定。' }],
    gaps: ['尚未在真实环境用安全测试数据完成创建后的独立回查和清理；源码已确认平台管理 Controller 存在该写入口。'],
  }),
  'platform-dict-mall-type-update': common('write', '按 Portal 类型编辑表单或租户自定义开关提交平台字典类型修改。', {
    id: typeId,
    name: param('完整字典名称。', '当前类型详情或用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；最长100字符。'] }),
    type: param('完整字典类型代码。', '当前类型详情或用户输入', { type: 'string', required: true, constraints: ['不能为空或全为空格；最长100字符。'] }),
    useSystem: param('所属系统值。', '当前类型详情或用户选择', { type: '0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10', required: false, default: '0' }),
    tenantEditable: param('是否支持租户自定义。', '当前类型详情或用户选择', { type: '0 | 1', required: false }),
    remark: param('备注。', '当前类型详情或用户输入', { type: 'string | null', required: false }),
    status: param('状态：0=开启、1=关闭。', '当前类型详情或用户选择', { type: '0 | 1', required: false }),
  }, trueOutput, ['Portal 行内修改会把整行记录与变更字段一起 PUT；平台管理服务会校验目标存在、名称/类型唯一性并更新记录，不能只看 true 回执。'], {
    completion: 'PUT 返回 true 且类型分页回查确认同一 ID 字段均为新值后，才算修改已验证。',
    steps: [{ role: 'required', when: '修改成功或超时需要核实', capabilityId: 'platform-dict-mall-type-list', mapping: { name: 'args.name', type: 'args.type' }, instruction: '回查同一类型 ID；权限失败或找不到目标时报告失败或结果不确定。' }],
    gaps: ['尚未在真实环境用安全测试数据完成修改后的独立回查和清理；平台管理 Controller 的写入口已由源码确认。'],
  }),
  'platform-dict-mall-type-remove': common('write', '按 Portal 根页行操作删除一个平台字典类型。', { id: typeId }, trueOutput, ['类型存在子数据时平台服务会拒绝删除；平台管理 Controller 提供该删除入口。'], {
    completion: 'DELETE 返回 true 且回查确认类型不再出现后，才算删除已验证。',
    steps: [{ role: 'required', when: '删除成功或超时需要核实', capabilityId: 'platform-dict-mall-type-list', instruction: '回查原类型 ID；不能把删除失败当成空列表。' }],
    gaps: ['根页批量删除按钮没有有效 deleteURL，SDK 仅登记 Portal 行删除请求；尚未在真实环境验证平台管理接口的角色权限和删除回查。'],
  }),
  ...inheritedDataContracts,
}

export const PLATFORM_DICT_MALL_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PLATFORM_DICT_MALL_METHODS).map(([id, method]) => [`platformDictMall.${method}`, { ...PLATFORM_DICT_MALL_AI_CONTRACTS[id]!, boundaries: [...PLATFORM_DICT_MALL_AI_CONTRACTS[id]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，typeList 仍可省略参数对象。'] }]),
)

type ScopedContractConfig = {
  scope: string
  hostName: string
  title: string
  pagePath: string
  permission: string
  fixedUseSystem: number
}

function cloneScopedContract (id: string, contract: AiContract, config: ScopedContractConfig): AiContract {
  const transform = (value: unknown): unknown => {
    if (typeof value !== 'string') {
      if (Array.isArray(value)) return value.map(transform)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item)]))
      return value
    }
    return value
      .replaceAll('platform-dict-mall-', `platform-dict-mall-${config.scope}-`)
      .replaceAll('platformDictMall.', `${config.hostName}.`)
      .replaceAll('平台字典', `${config.title}字典`)
      .replaceAll('/dashboard/platform/setting/dict-mall/all/list', config.pagePath)
      .replaceAll('/dashboard/platform-v2/setting/dict-mall/all', config.permission)
  }
  const result = transform(JSON.parse(JSON.stringify(contract))) as AiContract
  if (id.endsWith('-type-create') || id.endsWith('-type-update')) delete result.inputs.useSystem
  if (id.endsWith('-type-get')) {
    for (const step of result.steps) if (step.mapping) delete step.mapping.useSystem
  }
  result.boundaries = [...result.boundaries, `固定使用系统值${config.fixedUseSystem}（${config.title}）；页面没有让调用方选择或修改 useSystem 的入口。`]
  return result
}

function scopedContracts (config: ScopedContractConfig): Record<string, AiContract> {
  return Object.fromEntries(
    Object.entries(PLATFORM_DICT_MALL_AI_CONTRACTS).map(([id, contract]) => [id.replace('platform-dict-mall-', `platform-dict-mall-${config.scope}-`), cloneScopedContract(id, contract, config)]),
  )
}

export const PLATFORM_DICT_MALL_COMMON_AI_CONTRACTS: Record<string, AiContract> = scopedContracts({
  scope: 'common',
  hostName: 'platformDictMallCommon',
  title: '公共',
  pagePath: '/dashboard/platform/setting/dict-mall/common/list',
  permission: '/dashboard/platform-v2/setting/dict-mall/common',
  fixedUseSystem: 0,
})

function scopedMethodContracts (methods: Record<string, keyof PlatformDictMallCapability>, contracts: Record<string, AiContract>, hostName: string, note: string): Record<string, AiContract> {
  return Object.fromEntries(
    Object.entries(methods).map(([id, method]) => [`${hostName}.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法签名为单个参数对象；${note}`] }]),
  )
}

export const PLATFORM_DICT_MALL_COMMON_METHOD_CONTRACTS: Record<string, AiContract> = scopedMethodContracts(
  PLATFORM_DICT_MALL_COMMON_METHODS,
  PLATFORM_DICT_MALL_COMMON_AI_CONTRACTS,
  'platformDictMallCommon',
  '公共字典页面自动固定 useSystem=0。',
)

export const PLATFORM_DICT_MALL_FINANCE_AI_CONTRACTS: Record<string, AiContract> = scopedContracts({
  scope: 'finance',
  hostName: 'platformDictMallFinance',
  title: '财务',
  pagePath: '/dashboard/platform/setting/dict-mall/finance/list',
  permission: '/dashboard/platform-v2/setting/dict-mall/finance',
  fixedUseSystem: 2,
})

export const PLATFORM_DICT_MALL_FINANCE_METHOD_CONTRACTS: Record<string, AiContract> = scopedMethodContracts(
  PLATFORM_DICT_MALL_FINANCE_METHODS,
  PLATFORM_DICT_MALL_FINANCE_AI_CONTRACTS,
  'platformDictMallFinance',
  '财务字典页面自动固定 useSystem=2。',
)

export const PLATFORM_DICT_MALL_HR_AI_CONTRACTS: Record<string, AiContract> = scopedContracts({
  scope: 'hr',
  hostName: 'platformDictMallHr',
  title: '人力',
  pagePath: '/dashboard/platform/setting/dict-mall/hr/list',
  permission: '/dashboard/platform-v2/setting/dict-mall/hr',
  fixedUseSystem: 1,
})

export const PLATFORM_DICT_MALL_HR_METHOD_CONTRACTS: Record<string, AiContract> = scopedMethodContracts(
  PLATFORM_DICT_MALL_HR_METHODS,
  PLATFORM_DICT_MALL_HR_AI_CONTRACTS,
  'platformDictMallHr',
  '人力字典页面自动固定 useSystem=1。',
)

export const PLATFORM_DICT_MALL_MATERIAL_AI_CONTRACTS: Record<string, AiContract> = scopedContracts({
  scope: 'material',
  hostName: 'platformDictMallMaterial',
  title: '资产',
  pagePath: '/dashboard/platform/setting/dict-mall/material/list',
  permission: '/dashboard/platform-v2/setting/dict-mall/material',
  fixedUseSystem: 3,
})

export const PLATFORM_DICT_MALL_MATERIAL_METHOD_CONTRACTS: Record<string, AiContract> = scopedMethodContracts(
  PLATFORM_DICT_MALL_MATERIAL_METHODS,
  PLATFORM_DICT_MALL_MATERIAL_AI_CONTRACTS,
  'platformDictMallMaterial',
  '资产字典页面自动固定 useSystem=3。',
)

export const PLATFORM_DICT_MALL_PRODUCT_AI_CONTRACTS: Record<string, AiContract> = scopedContracts({
  scope: 'product',
  hostName: 'platformDictMallProduct',
  title: '生产',
  pagePath: '/dashboard/platform/setting/dict-mall/product/list',
  permission: '/dashboard/platform-v2/setting/dict-mall/product',
  fixedUseSystem: 4,
})

export const PLATFORM_DICT_MALL_PRODUCT_METHOD_CONTRACTS: Record<string, AiContract> = scopedMethodContracts(
  PLATFORM_DICT_MALL_PRODUCT_METHODS,
  PLATFORM_DICT_MALL_PRODUCT_AI_CONTRACTS,
  'platformDictMallProduct',
  '生产字典页面自动固定 useSystem=4。',
)

export const PLATFORM_DICT_MALL_SALE_AI_CONTRACTS: Record<string, AiContract> = scopedContracts({
  scope: 'sale',
  hostName: 'platformDictMallSale',
  title: '销售',
  pagePath: '/dashboard/platform/setting/dict-mall/sale/list',
  permission: '/dashboard/platform-v2/setting/dict-mall/sale',
  fixedUseSystem: 6,
})

export const PLATFORM_DICT_MALL_SALE_METHOD_CONTRACTS: Record<string, AiContract> = scopedMethodContracts(
  PLATFORM_DICT_MALL_SALE_METHODS,
  PLATFORM_DICT_MALL_SALE_AI_CONTRACTS,
  'platformDictMallSale',
  '销售字典页面自动固定 useSystem=6。',
)

export const PLATFORM_DICT_MALL_SUPPLY_AI_CONTRACTS: Record<string, AiContract> = scopedContracts({
  scope: 'supply',
  hostName: 'platformDictMallSupply',
  title: '采购',
  pagePath: '/dashboard/platform/setting/dict-mall/supply/list',
  permission: '/dashboard/platform-v2/setting/dict-mall/supply',
  fixedUseSystem: 5,
})

export const PLATFORM_DICT_MALL_SUPPLY_METHOD_CONTRACTS: Record<string, AiContract> = scopedMethodContracts(
  PLATFORM_DICT_MALL_SUPPLY_METHODS,
  PLATFORM_DICT_MALL_SUPPLY_AI_CONTRACTS,
  'platformDictMallSupply',
  '采购字典页面自动固定 useSystem=5。',
)
