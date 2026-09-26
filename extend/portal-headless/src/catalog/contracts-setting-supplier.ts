import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_SUPPLIER_METHODS, settingSupplierCapabilities } from '../capabilities/setting-supplier.js'

const definitions = new Map(settingSupplierCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const supplierFields: AiField[] = [
  field('id', 'string | number', '供应商主键；Long 可能序列化为字符串，后续删除和平台添加保留该 ID'),
  field('supplierCode', 'string | null', '供应商号；新建时可为空，由后端按类型生成', { nullable: true, nullMeaning: '后端未返回供应商号' }),
  field('supplierName', 'string | null', '供应商名称；新建页面必填', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('supplierAbbreviation', 'string | null', '供应商简称；Portal 新建页面必填', { nullable: true, nullMeaning: '后端未返回简称' }),
  field('type', 'integer | null', '供应商类型；1=外部供应商，2=内部供应商', { nullable: true, nullMeaning: '后端未返回类型', values: { '1': '外部供应商', '2': '内部供应商' } }),
  field('category', 'integer | null', '供应商分类；当前页面不展示也不提交', { nullable: true, nullMeaning: '未配置分类' }),
  field('address', 'string | null', '供应商地址', { nullable: true, nullMeaning: '未填写地址' }),
  field('qualificationCode', 'string | null', '纳税人识别号/资质证照编码', { nullable: true, nullMeaning: '未填写资质证照编码' }),
  field('createTime', 'string | number | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('updateTime', 'string | number | null', '修改时间原值', { nullable: true, nullMeaning: '后端未返回修改时间' }),
  field('updaterName', 'string | null', '修改人名称', { nullable: true, nullMeaning: '后端未返回修改人' }),
  field('addedByTenant', 'boolean | number | null', '平台供应商是否已被当前租户添加的标记', { nullable: true, nullMeaning: '后端未返回标记' }),
  field('selectable', 'boolean | null', '平台选择弹窗是否可勾选；false 时 Portal 禁用该行', { nullable: true, nullMeaning: '后端未返回可选标记' }),
  field('sysBrandIds', 'string | null', '系统品牌 ID 的逗号字符串', { nullable: true, nullMeaning: '未关联系统品牌' }),
  field('sysBrandNames', 'string | null', '系统品牌名称的逗号字符串', { nullable: true, nullMeaning: '后端未填充品牌名称' }),
]

const page = (label: string): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', label), field('total', 'number', '符合筛选条件的总条数，不是当前页长度'), ...supplierFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页无记录；total=0 才表示条件下无记录，权限、网络或后端错误会抛出，不能降级为空页。',
})

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端 CommonResult<Boolean> 的成功值')],
  empty: '没有 true 或请求抛错都不能报告操作成功；删除和平台添加必须按后续步骤回查。',
}

const idsOutput: AiContract['output'] = {
  shape: '(string | number)[]',
  fields: [field('[]', 'string | number', '批量创建成功后按请求顺序返回的供应商 ID')],
  empty: '空数组只表示后端接受了空结果；本能力拒绝空 suppliers，不把请求失败降级成空数组。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string | null, base64: string, byteLength: number }',
  fields: [
    field('fileName', 'string', '响应 Content-Disposition 中的文件名；缺失时为系统供应商.xls'),
    field('contentType', 'string | null', '响应 Content-Type', { nullable: true, nullMeaning: '响应没有 Content-Type' }),
    field('base64', 'string', '导出文件二进制内容的 base64 编码'),
    field('byteLength', 'number', '原始文件字节数'),
  ],
  empty: '空文件会抛错；base64 只能作为文件内容解码，不能当作列表数据。',
}

const gaps = ['已核对 Portal 菜单、列表、平台选择组件、新建表单、Java Controller/DTO/Service、SDK 实现和离线请求断言；尚未在真实测试环境执行本页浏览器读请求及写入回查。']

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Setting supplier contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.name === 'pageNo' || parameter.name === 'pageSize' ? 'number' : parameter.name === 'type' ? 'string | number | null' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: '当前租户供应商列表、平台供应商选择表或 Portal 新建表单；按能力参数契约填写。',
  }]))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Setting supplier contract has no capability: ${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只覆盖 Portal“系统设置 → 供应商管理”及其当前页面可达的分页、导出、平台供应商选择、批量新建和删除；后端 get/update 虽存在，但当前 Portal 页面没有可达入口，不发布为本页能力。',
      '所有请求使用 platform HTTP 实例；页面路径不命中 module-type 规则，SDK 与 Portal 一样不发送 module-type，租户范围由绑定会话决定。',
      '新建表单的 supplierName、supplierAbbreviation、type 是 Portal 必填项；postalCode 为空或必须为六位数字，supplierCode 空字符串交给后端自动生成，sysBrandIds 按 Portal 规则从数组转为逗号字符串，isSysCreate 固定为true。',
      '页面里的品牌选择列和相关全量品牌预取已经注释/不可见，不作为当前用户可达能力；不要把它当作新建供应商的必需前置步骤。',
      '平台供应商添加请求体会带 tenantId 以复刻 Portal，但 Java Controller 忽略该字段并使用 TenantContextHolder 当前租户；不能用它切换或扩大权限。',
      '删除前端只传一个 id；后端有采购属性时拒绝，平台供应商只移除当前租户的 useTenant，系统创建供应商才会物理删除，true 不等于所有情况下物理删除。',
      '导出后端把 pageSize 固定为1000，能力只复刻筛选条件，不宣称导出超过后端上限的全部记录。',
    ],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用当前用户会话 token、当前租户和页面对应权限；供应商/平台供应商 ID 必须来自当前列表或用户已核实的结果，不按名称猜 ID。'],
    inputs: { ...inputsOf(id), ...extra.inputs },
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力结构；写操作还必须按步骤回查最终供应商列表。',
    failures: ['表单校验、供应商类型/编码生成、采购属性删除限制、权限、租户范围、网络或后端业务错误原样报告；不能降级为空页、空 ID 或假成功。'],
    idempotency: definition.write ? '后端没有 requestId 幂等协议；创建或添加响应超时先回查列表，未确认前不要盲目重试。删除重复执行可能再次返回成功但不改变已达终态。' : null,
    evidence: [
      { source: 'app/portal/menus/common.js、app/portal/views/dashboard/hr/setting/supplier/list.vue、[mode]/[id].vue、components/portal/supply/platform-table-select/supplier.vue @ bbcfc35154', kind: 'reference', note: '证明菜单权限、列表默认筛选、导出、删除、平台选择、批量表单字段及提交形状。' },
      { source: 'SysSupplierController、SysSupplierBaseVO、SysSupplierSaveReqVO、SysSupplierRespVO、SysSupplierServiceImpl、PlatformSupplierServiceImpl @ b7a359adc9e', kind: 'reference', note: '证明分页/导出/批量创建/删除/平台租户关联端点、字段校验、采购属性限制和当前租户语义。' },
      { source: 'src/capabilities/setting-supplier.ts 与 test/setting-supplier.test.ts', kind: 'implementation', note: '证明 SDK 最终请求形状、表单校验、导出二进制封装、响应校验和离线反证；不替代真实环境写入回查。' },
    ],
    gaps: [...gaps],
    ...extra,
  }
}

add('setting-supplier-list', '读取当前租户可见的供应商分页列表。', page('当前租户供应商列表'), ['消费 list[].id、supplierName、supplierCode、type 和供应商归属字段；删除或新建回查以当前租户列表为准。'])
add('setting-supplier-export', '按当前供应商筛选条件下载 Portal 列表的系统供应商 Excel。', fileOutput, ['将 base64 解码为文件；文件只代表后端最多导出的1000条当前筛选结果，不把下载成功当作写入证据。'])
add('setting-supplier-create', '按 Portal 新建供应商表格一次批量创建一个或多个当前租户供应商。', idsOutput, ['按返回 ID 顺序逐行回查当前租户列表；名称、简称、类型和生成的 supplierCode 都要核对，不能只看 ID 数组。'], { inputs: {
  suppliers: param('供应商表单行数组。每行必须有非空 supplierName、supplierAbbreviation、type；address、qualificationCode 可为空；postalCode 为空或六位数字；supplierCode 缺省按 Portal 发送空字符串；sysBrandIds 是 ID 数组，提交时转换为逗号字符串，isSysCreate 缺省为true。', '用户填写的 Portal 新建表格；类型来自 supplier_type 字典，ID 来自已核实候选', { type: 'object[]', required: true, constraints: ['数组非空；每行 supplierName、supplierAbbreviation 不能全空格；type 必填；postalCode 只能为空或六位数字；页面当前品牌列已注释，通常 sysBrandIds=[]。'] }),
}, steps: [{ capabilityId: 'setting-supplier-list', role: 'required', when: '批量创建返回 ID 或响应超时', instruction: '按每行名称、简称、类型和返回 ID 回查；后端事务失败时不要把任何行报告为已创建。' }] })
add('setting-supplier-remove', '删除当前供应商列表中的一条供应商或解除当前租户对平台供应商的使用。', trueOutput, ['成功或响应超时后重新调用 list；若目标是平台供应商，确认当前租户不再可见或归属标记已经变化；若有采购属性，交付后端拒绝原因。'], { inputs: { id: param('供应商 ID。', 'setting-supplier-list.list[].id 或 setting-supplier-platform-list.list[].id', { type: 'string | number', required: true }) }, steps: [{ capabilityId: 'setting-supplier-list', role: 'required', when: '删除成功或响应超时', instruction: '按同一 ID 回查当前租户列表，区分物理删除、解除租户使用和采购属性阻止。' }] })
add('setting-supplier-platform-list', '查询 Portal“平台供应商库中选择”弹窗中的平台供应商分页。', page('平台供应商列表'), ['只把 selectable=true 的行交给 addPlatform；保留 row.id，不把平台列表行直接当作当前租户供应商。'])
add('setting-supplier-add-platform', '把平台供应商选择弹窗中可选的供应商加入当前租户。', trueOutput, ['提交后重新 list，核对每个 supplierId 已进入当前租户可见列表；请求体 tenantId 只用于复刻页面，不作为权限凭据。'], { inputs: { supplierIds: param('用户选中的 selectable=true 平台供应商 ID 数组。', 'setting-supplier-platform-list 返回值', { type: '(string | number)[]', required: true, constraints: ['必须非空；不要提交 selectable=false 的行'] }), tenantId: param('当前会话租户 ID；Portal 会提交此字段，但后端以会话 TenantContextHolder 为准。', 'SDK 会话租户上下文', { type: 'string | number', required: true }) }, steps: [{ capabilityId: 'setting-supplier-list', role: 'required', when: '添加成功或响应超时', instruction: '逐 ID 回查当前租户列表，确认已可见；不能仅凭 true 判定已添加。' }] })

export const SETTING_SUPPLIER_AI_CONTRACTS = contracts
export const SETTING_SUPPLIER_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_SUPPLIER_METHODS).map(([id, method]) => [`settingSupplier.${method}`, { ...SETTING_SUPPLIER_AI_CONTRACTS[id]!, boundaries: [...SETTING_SUPPLIER_AI_CONTRACTS[id]!.boundaries, '直接方法签名使用单个对象参数；批量表单字段按 inputs 中的嵌套结构填写。'] }]),
)
