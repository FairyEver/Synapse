import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_MATERIAL_METHODS, settingMaterialCapabilities } from '../capabilities/setting-material.js'

const definitions = new Map(settingMaterialCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '物料主键；长整数可能返回字符串，后续详情、删除和换算都使用该 ID'),
  field('matCode', 'string | null', '物料号；批量新建时可为空，由后端按分类、供应商和流水生成', { nullable: true, nullMeaning: '后端尚未生成物料号' }),
  field('matName', 'string | null', '物料名称；新增页面按分类名称、供应商简称和规格型号拼接', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('matDescribe', 'string | null', '物料描述；门户新增表单必填', { nullable: true, nullMeaning: '后端未返回描述' }),
  field('categoryId', 'string | number | null', '物料分类 ID', { nullable: true, nullMeaning: '没有分类' }),
  field('categoryName', 'string | null', '物料分类完整路径', { nullable: true, nullMeaning: '后端未返回分类名称' }),
  field('unit', 'string | null', '基本单位；单位换算页把它作为等式右侧基本单位', { nullable: true, nullMeaning: '后端未返回单位' }),
  field('supplierId', 'string | number | null', '供应商 ID', { nullable: true, nullMeaning: '没有供应商' }),
  field('supplierName', 'string | null', '供应商名称', { nullable: true, nullMeaning: '后端未返回供应商名称' }),
  field('supplierCode', 'string | null', '供应商编码', { nullable: true, nullMeaning: '没有供应商编码' }),
  field('supplierAbbreviation', 'string | null', '供应商简称；新增名称拼接使用该值', { nullable: true, nullMeaning: '没有供应商简称' }),
  field('specDes', 'string | null', '规格型号说明；新增页面限制最多20字符', { nullable: true, nullMeaning: '没有规格说明' }),
  field('status', 'integer | null', '物料状态；后端约定0=禁用、1=启用、2=冻结', { nullable: true, nullMeaning: '后端未返回状态', values: { '0': '禁用', '1': '启用', '2': '冻结' } }),
  field('isEntry', 'boolean | null', '是否预准入', { nullable: true, nullMeaning: '后端未返回预准入标记' }),
  field('viewSalesList', 'object[] | null', '按租户开通系统填充的采购、销售、库存视图属性；可能包含 status=false 的空视图', { nullable: true, nullMeaning: '后端未填充视图' }),
  field('typeName', 'string | null', '已启用视图名称拼接结果', { nullable: true, nullMeaning: '没有启用视图' }),
  field('addedByTenant', 'integer | null', '平台物料是否已被当前租户添加的标记', { nullable: true, nullMeaning: '后端未返回标记' }),
  field('selectable', 'boolean | null', '平台物料选择弹窗是否允许勾选；false 时 Portal 禁用该行', { nullable: true, nullMeaning: '后端未返回可选标记' }),
]

const page = (label: string, fields = rowFields): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', label), field('total', 'number', '符合当前筛选条件的总条数，不是当前页长度'), ...fields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页无记录；total=0 才表示条件下无记录，权限、网络或后端错误会抛出，不能降级为空页。',
})

const object = (fields: AiField[], empty = '字段缺失或null按返回原值处理，不把空值猜成默认业务值。'): AiContract['output'] => ({ shape: 'object', fields, empty })
const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'true', '后端 CommonResult<Boolean> 的成功值')], empty: '不是true或请求抛错都不能报告操作成功；写操作必须按后续步骤回查。' }
const gaps = ['已核对 Portal 页面、Java Controller/DTO、SDK 实现和离线请求断言；尚未在真实测试环境执行本页浏览器请求及写入回查。']

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Setting material contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'number' ? 'number' : parameter.kind === 'boolean' ? 'boolean' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: '用户提供的物料列表筛选、表单或从当前页面结果取得的 ID；按能力参数契约填写。',
  }]))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Setting material contract has no capability: ${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只覆盖门户“系统设置 → 物料管理”及其当前页面可达的详情、平台物料选择、采购视图收货配置和单位换算动作；不是独立的采购、销售或库存菜单入口。',
      '页面使用 platform 实例且页面路径不命中 module-type 规则；销售品类树的展示辅助请求显式使用 platform-mall-admin，调用方必须为该实例配置 base URL。',
      '新增物料页面的类型、采购方式等部分字段在源码中被注释，不把注释内容扩展成 SDK 参数；实际提交以页面当前 materials 表格为准。',
      '平台物料添加提交 tenantId 只是复刻 Portal 请求体，Java Controller 实际以当前会话 TenantContextHolder 为准；不能借此越权切换租户。',
      '单位换算保存是按物料 ID 删除旧规则后批量重建，属于整组替换，没有页面可达的撤销接口；调用前必须确认完整 groups。',
    ],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用当前用户、当前租户的会话 token；所有 ID 来自当前页面返回，不凭名称猜 ID。'],
    inputs: { ...inputsOf(id), ...extra.inputs },
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力结构；写操作还必须按步骤回查最终状态。',
    failures: ['表单校验、平台物料可选性、平台物料只读、租户归属、权限、网络或后端业务错误均原样报告，不能以空结果或假成功掩盖。'],
    idempotency: definition.write ? '页面请求没有 requestId 幂等协议；超时先读取列表/详情或换算上下文核实，不能盲目重复创建、删除或整组替换。' : null,
    evidence: [
      { source: 'app/portal/menus/common.js、app/portal/views/dashboard/hr/setting/material/*.vue @ bbcfc35154', kind: 'reference', note: '证明菜单权限、platform 实例、列表筛选、写动作、详情视图、平台物料选择和单位换算请求形状。' },
      { source: 'SysMaterielController、SysMaterielServiceImpl、SysMaterielUnitConversionController、SysMaterielUnitConversionServiceImpl、相关 VO @ b7a359adc9e', kind: 'reference', note: '证明租户/平台物料边界、批量创建字段校验、删除语义、视图填充和单位换算整组替换语义。' },
      { source: 'src/capabilities/setting-material.ts 与 test/setting-material.test.ts', kind: 'implementation', note: '证明 SDK 最终请求形状、校验、错误边界和离线反证；不替代真实环境验证。' },
    ],
    gaps: [...gaps],
    ...extra,
  }
}

add('setting-material-list', '分页查询门户系统设置中的物料。', page('物料列表'), ['展示 matCode、matName、matDescribe、categoryName、unit、supplierName、supplierCode、specDes 和视图摘要；需要完整结果时按 pageNo/pageSize 翻页。'])
add('setting-material-prepare-create', '加载新增物料表格所需的单位、供应商和物料分类选项。', object([
  field('units', 'object[]', '物料单位下拉选项'),
  field('suppliers', '{ list: object[], total: number }', '供应商全量分页结果；页面通过loopFetch以pageSize=500、最多100页聚合'),
  field('categories', 'object[]', '物料分类树；新增只允许选择页面要求的末级分类'),
]), ['用 units、suppliers 和 categories 准备 materials；分类选中后页面会带出物料描述，供应商变化会带出 supplierCode。'], { effect: 'prepare' })
add('setting-material-create', '按物料新增页面的多行表格一次创建一个或多个系统物料。', { shape: 'string[]', fields: [field('[]', 'string | number', '后端批量创建返回的物料 ID')], empty: '空数组表示后端没有创建记录；请求失败不能解释为空数组。' }, ['保存返回的 ID，并用 list 按名称、分类、供应商和规格回查逐行确认；批量请求是事务语义，任一行校验失败不能报告部分成功。'], {
  inputs: { materials: param('物料行数组；每行至少包含 matName、matDescribe、categoryId、unit、supplierId，页面当前请求还会提交 matCode、supplierCode、specDes、isEntry、entryTime。', '用户表单与 prepareCreate 的选项联动', { type: 'object[]', required: true, constraints: ['matDescribe 必填；specDes 最多20字符；categoryId、unit、supplierId 必填。'] }) },
  steps: [{ capabilityId: 'setting-material-list', role: 'required', when: '创建成功或响应超时需要核实', instruction: '按每行的业务字段分页查找并核对全部创建记录；不能只看返回 ID。' }],
})
add('setting-material-remove', '删除当前列表中的一个物料。', trueOutput, ['删除成功或超时后重新 list 回查目标 ID；平台物料可能只是移除当前租户 useTenant，存在采购属性时后端会拒绝。'], { inputs: { id: param('要删除的物料 ID。', 'setting-material-list 返回的 list[].id', { type: 'string | number', required: true }) }, steps: [{ capabilityId: 'setting-material-list', role: 'required', when: '删除成功或结果不确定时', instruction: '跨页确认目标 ID 不再作为当前租户物料返回；不要仅以true回执判断物理删除。' }] })
add('setting-material-platform-list', '查询平台物料库中可供当前租户选择的物料。', page('平台物料列表'), ['只选择 selectable=true 的行；跨页选择后把所选 ID 交给 addPlatform，不把平台行直接当作当前租户物料。'], { inputs: { matName: param('平台物料名称筛选。', '用户输入', { type: 'string', required: false, omitted: 'Portal 发送空字符串' }), matDescribe: param('平台物料描述筛选。', '用户输入', { type: 'string', required: false, omitted: 'Portal 发送空字符串' }), supplierId: param('供应商筛选 ID。', '当前平台物料选择上下文', { type: 'string | number', required: false, nullable: true }), categoryId: param('物料分类筛选 ID。', '当前平台物料选择上下文', { type: 'string | number', required: false, nullable: true }), pageNo: param('页码。', '分页状态', { type: 'integer', required: false, default: '1' }), pageSize: param('每页条数。', '分页状态', { type: 'integer', required: false, default: '20' }) } })
add('setting-material-add-platform', '把平台物料选择弹窗中可选的物料添加到当前租户。', trueOutput, ['提交后重新 list，核对目标物料已进入当前租户可见列表；后端按当前会话租户更新 useTenant。'], { inputs: { materielIds: param('用户选中的 selectable=true 平台物料 ID 数组。', 'setting-material-platform-list 返回值', { type: '(string | number)[]', required: true }), tenantId: param('当前会话租户 ID；仅复刻 Portal 请求体，后端以会话租户为准。', 'SDK 会话租户上下文', { type: 'string | number', required: true }) }, steps: [{ capabilityId: 'setting-material-list', role: 'required', when: '添加成功或响应超时需要核实', instruction: '按 materielIds 回查当前租户物料列表，确认每个 ID 已可见。' }] })
add('setting-material-get', '读取物料详情以及后端按租户开通系统填充的采购、销售、库存视图。', object(rowFields.map(item => ({ ...item, path: item.path }))), ['先读取详情再解释 viewSalesList；status=false 的视图是后端返回的未配置占位，不应当当作已配置。'])
add('setting-material-view-lookups', '加载物料详情页展示采购、销售视图所需的店铺、品牌、品类和规格组名称。', object([
  field('shops', 'object[]', '当前租户店铺列表，用 shopId 映射销售视图 shopId'),
  field('brands', 'object[]', '物料关联品牌列表，用 brandId 映射 brandId'),
  field('categories', 'object[]', '销售品类树，用 catId 映射 catId'),
  field('specGroups', 'object[]', '物料规格组名称，用 propValueIds 映射销售视图规格组'),
]), ['只把 lookup 结果用于解释详情中的 ID；缺失名称时保留原始 ID，不猜测标签。'])
add('setting-material-receive-config-list', '在物料详情的采购视图中按组织分页查询收货配置。', page('收货配置', [field('id', 'string | number', '收货配置主键'), field('orgFullPath', 'string | null', '组织全路径', { nullable: true }), field('orgType', 'string | null', '组织类型', { nullable: true }), field('areaName', 'string | null', '收货地区', { nullable: true }), field('receiver', 'string | null', '收货人', { nullable: true }), field('contactInformation', 'string | null', '收货人电话', { nullable: true }), field('deliveryAddress', 'string | null', '收货地址', { nullable: true }), field('invoiceName', 'string | null', '收货公司发票名称', { nullable: true })]), ['orgId 是页面筛选条件；materielId 固定来自当前详情页，按分页消费 list/total。'])
add('setting-material-conversion-context', '读取单位换算页的物料基本单位、可选规格组、已有换算规则和单位选项。', object([
  field('materiel', 'object', '物料详情；至少消费 id、matName、matCode、unit'),
  field('specGroups', 'object[]', '规格组 ID 与名称；不同换算组不能重复选同一规格'),
  field('rules', 'object[]', '后端按 propValueIds 分组的已有规则'),
  field('units', 'object[]', '单位选项；基本单位在辅助单位选择器中禁用'),
]), ['先消费 materiel.unit 作为 baseUnit；把 rules 转换成 groups 后编辑，不能把后端规则数组当作仍可直接提交的页面表单。'])
add('setting-material-conversion-save', '保存物料单位换算页的全部换算组。', { shape: 'string[]', fields: [field('[]', 'string | number', '后端批量重建返回的换算规则 ID')], empty: '空数组表示本次保存清空了全部辅助单位规则；不能当作网络失败。' }, ['保存前确保每组辅助单位数量和单位完整、最多一个空规格组；保存成功后再次读取 conversionContext 核对完整规则。'], { inputs: { materielId: param('物料 ID。', 'setting-material-conversion-context.materiel.id', { type: 'string | number', required: true }), baseUnit: param('物料基本单位。', 'setting-material-conversion-context.materiel.unit', { type: 'string', required: true }), groups: param('按规格分组的辅助单位数组；每项包含 targetUnit、targetCoefficient，可选已有 id 和 coefficient。', '用户编辑的换算表单', { type: 'object[]', required: true, constraints: ['最多一个未选择规格的组；辅助单位数量必须为正数；不能选择基本单位或在同组重复。'] }) }, steps: [{ capabilityId: 'setting-material-conversion-context', role: 'required', when: '保存前和保存后', mapping: { materielId: 'args.materielId' }, instruction: '保存前获取当前基本单位和规格；成功后重新读取并逐项核对。' }] })
add('setting-material-conversion-remove', '删除单位换算页中已有的一条辅助单位规则。', trueOutput, ['删除成功后重新读取 conversionContext；若之后点击保存，页面会用剩余表单整组替换后端规则。'], { inputs: { id: param('换算规则 ID。', 'setting-material-conversion-context.rules[].list[].id', { type: 'string | number', required: true }) }, steps: [{ capabilityId: 'setting-material-conversion-context', role: 'required', when: '删除成功或结果不确定时', instruction: '确认目标规则 ID 已不在当前物料的规则分组中。' }] })

export const SETTING_MATERIAL_AI_CONTRACTS = contracts
export const SETTING_MATERIAL_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_MATERIAL_METHODS).map(([id, method]) => [`settingMaterial.${method}`, { ...SETTING_MATERIAL_AI_CONTRACTS[id]!, boundaries: [...SETTING_MATERIAL_AI_CONTRACTS[id]!.boundaries, '直接方法签名使用单个对象参数；复杂表单字段按 inputs 中的嵌套结构填写。'] }]),
)
