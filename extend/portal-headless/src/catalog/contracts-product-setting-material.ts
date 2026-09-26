import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_MATERIAL_METHODS,
  PRODUCT_SETTING_MATERIAL_PAGE_PATH,
  PRODUCT_SETTING_MATERIAL_PERMISSION,
  PRODUCT_SETTING_MATERIAL_QUERY_PERMISSION,
  PRODUCT_SETTING_MATERIAL_SUBMIT_PERMISSION,
  productSettingMaterialCapabilities,
} from '../capabilities/product-setting-material.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingMaterialCapabilities.map(definition => [definition.id, definition]))

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('list', 'object[]', '当前页物料记录。'),
    field('list[].id', 'string | number | null', '物料记录ID；删除、启用和停用都使用这个值。', { nullable: true, nullMeaning: '后端没有返回可操作ID，不能把该行交给写操作。' }),
    field('list[].materialDescription', 'string | null', '物料名称。', { nullable: true, nullMeaning: '后端没有返回物料名称。' }),
    field('list[].type', 'string | number | null', '物料类型字典值；不是展示名称。', { nullable: true, nullMeaning: '后端没有返回类型值。' }),
    field('list[].typeStr', 'string | null', '物料类型展示名称。', { nullable: true, nullMeaning: '后端没有返回展示名称。' }),
    field('list[].supplier', 'string | null', '供应商名称。', { nullable: true, nullMeaning: '后端没有返回供应商。' }),
    field('list[].image', 'string | null', '物料图片地址；为空时页面不展示图片。', { nullable: true, nullMeaning: '没有图片。' }),
    field('list[].measureUnit', 'string | null', '物料规格/计量单位文本。', { nullable: true, nullMeaning: '后端没有返回规格。' }),
    field('list[].status', 'integer | null', '物料状态；1表示启用，其他值在页面显示为停用。', { nullable: true, nullMeaning: '后端没有返回状态。', values: { '1': '启用', 'other': '停用' } }),
    field('total', 'integer', '符合当前筛选条件的总记录数，不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页没有记录；total=0才表示筛选条件下没有记录，权限、网络或后端错误会抛出。',
}

const draftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal弹窗校验、可交给save的完整草稿。'),
    field('draft.id', 'string | number', '编辑时的物料ID；新建时固定为空字符串。', { optional: true }),
    field('draft.materialDescription', 'string', '物料名称；非空。'),
    field('draft.supplier', 'string', '供应商名称；非空。'),
    field('draft.type', 'string', '物料类型字典值；非空，数字输入会按Portal表单转换为字符串。'),
    field('draft.image', 'string', '图片地址；没有图片时保留空字符串。'),
    field('draft.measureUnit', 'string', '物料规格；非空且最多10个字符。'),
  ],
  empty: '输入不满足Portal校验时直接抛错，不返回草稿，也不发送网络请求。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求完成后的本地成功确认；接口没有返回最终物料对象。')],
  empty: '请求抛错时没有成功结果；true也不等于写入已完成，必须按步骤回查列表。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_MATERIAL_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_MATERIAL_PERMISSION}；列表查询还受页面内${PRODUCT_SETTING_MATERIAL_QUERY_PERMISSION}控制，删除、新建、编辑和启停按钮受${PRODUCT_SETTING_MATERIAL_SUBMIT_PERMISSION}控制。SDK不绕过服务端权限。`,
  '请求使用Portal product实例，业务URL不额外拼接admin-api；该产品设置路径不推导module-type，因此不发送module-type，product实例会补devicetype=PC。',
  '列表customLoad把useListPageModule产生的order、orderField、表单字段、pageNo和pageSize整体交给GET /base/material/page/external；空的物料名称和类型必须保留为空字符串。',
  'Portal表单提交只发送id、materialDescription、supplier、type、image、measureUnit六个键；SDK不把列表展示字段、Java实体的其它字段或页面注释掉的字段偷偷加入body。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/setting/base-setting/material/list.vue', kind: 'reference', note: '逐页核对菜单路径、菜单权限、product实例、筛选默认值、列表请求、按钮权限和删除/启停参数。' },
  { source: 'app/portal/views/dashboard/product/setting/base-setting/material/modal-form-content.vue', kind: 'reference', note: '逐字段核对新建/编辑默认值、四项必填、规格最多10字符、图片空值和六字段提交。' },
  { source: 'MaterialController、Material、MaterialVO、MaterialServiceImpl', kind: 'reference', note: '核对分页包装、保存按ID更新/无ID新建、删除按逗号拆分后的ID列表、租户边界和已使用物料停用限制。' },
  { source: 'src/capabilities/product-setting-material.ts 与 test/product-setting-material.test.ts', kind: 'implementation', note: '锁定SDK请求、表单校验、响应字段、product实例和离线反证；不替代真实环境浏览器证据。' },
  { source: 'docs/pages/产品设置物料管理.md', kind: 'reference', note: '记录页面能力、参数、字段基准、权限和真实环境缺口。' },
]

const gaps = [
  '已逐页核对Portal菜单、列表、弹窗、Java Controller/Entity/VO/Service、SDK实现和离线反证测试；尚未在真实测试环境执行本页列表、保存、删除、启用或停用请求。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`产品设置物料契约没有对应能力定义：${id}`)
  return Object.fromEntries(definition.params.map(item => [item.name, {
    type: item.kind === 'number' ? 'number' : item.kind === 'boolean' ? 'boolean' : 'string',
    required: item.required,
    meaning: item.description ?? item.name,
    source: '用户筛选、Portal表单或当前列表行；按本能力参数契约填写。',
  }]))
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-material-', '')
  const effect: AiContract['effect'] = suffix === 'prepare-save' ? 'prepare' : suffix === 'list' ? 'read' : 'write'
  const output = suffix === 'list' ? pageOutput : suffix === 'prepare-save' ? draftOutput : trueOutput
  const steps: AiContract['steps'] = []
  if (suffix === 'save') {
    steps.push({ role: 'required', when: '用户确认保存新建或编辑表单', capabilityId: 'product-setting-material-prepare-save', mapping: { form: 'args.draft' }, instruction: '先用同一表单执行prepareSave；只有prepare成功且用户确认后，才调用save。' })
    steps.push({ role: 'cancel', when: '用户在提交前取消', instruction: '丢弃本地draft，不调用保存接口；Portal没有保存前取消请求。' })
  }
  if (suffix === 'prepare-save') {
    steps.push({ role: 'required', when: '用户确认提交准备好的草稿', capabilityId: 'product-setting-material-save', mapping: { draft: 'result.draft' }, instruction: '只把result.draft原样交给save；成功或超时后调用list回查。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用写接口。' })
  }
  if (['save', 'remove-batch', 'enable', 'deactivate'].includes(suffix)) {
    steps.push({ role: 'required', when: '请求成功或超时需要确认最终状态', capabilityId: 'product-setting-material-list', instruction: '重新分页读取并按物料ID、名称、类型、供应商、规格和状态核对；不要只把true回执当成已落库。' })
  }
  return {
    purpose: suffix === 'list' ? '按Portal筛选条件分页读取产品设置物料。' : suffix === 'prepare-save' ? '按Portal物料弹窗规则准备新建或编辑草稿。' : `执行产品设置物料的${suffix === 'save' ? '保存' : suffix === 'remove-batch' ? '批量删除' : suffix === 'enable' ? '启用' : '停用'}动作。`,
    whenToUse: `需要在${PRODUCT_SETTING_MATERIAL_PAGE_PATH}页面执行对应动作时使用。`,
    effect,
    inputs: inputFor(id),
    output,
    consume: suffix === 'list'
      ? ['按list[].id选择后续写操作目标；type是字典值，typeStr才是展示文本。', 'total是筛选后的总数；不要用当前页list长度代替全量结果。']
      : ['写操作返回true只代表请求完成；保存、批量删除、启用和停用都必须调用list回查最终状态。', '删除、启用和停用必须使用最新列表行的非空id；不要用名称或显示文本猜ID。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面及对应后端权限。', ...(suffix === 'remove-batch' ? ['ids来自用户明确勾选的列表行，并在提交前确认删除。'] : [])],
    steps,
    completion: suffix === 'list' ? '获得与Portal customLoad消费形状一致的list和total。' : suffix === 'prepare-save' ? '获得完整六字段本地草稿，尚未改变服务端。' : '请求按Portal页面的HTTP方法、URL和参数完成，并在列表回查后确认业务终态。',
    failures: ['字段校验、ID校验、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功。', ...(suffix === 'deactivate' ? ['Java会拒绝已被使用的物料停用；收到该业务错误时不要自动改用删除。'] : [])],
    idempotency: suffix === 'list' || suffix === 'prepare-save' ? null : '页面没有requestId幂等协议；请求超时先按ID回查，再决定是否重试，避免重复保存或重复切换状态。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingMaterialCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置物料契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_MATERIAL_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_MATERIAL_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_MATERIAL_METHODS).map(([id, method]) => [
    `productSettingMaterial.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingMaterial.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
