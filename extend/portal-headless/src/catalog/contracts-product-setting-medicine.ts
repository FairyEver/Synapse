import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_MEDICINE_METHODS,
  PRODUCT_SETTING_MEDICINE_PAGE_PATH,
  PRODUCT_SETTING_MEDICINE_PERMISSION,
  PRODUCT_SETTING_MEDICINE_QUERY_PERMISSION,
  PRODUCT_SETTING_MEDICINE_SUBMIT_PERMISSION,
  productSettingMedicineCapabilities,
} from '../capabilities/product-setting-medicine.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingMedicineCapabilities.map(definition => [definition.id, definition]))

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('list', 'object[]', '当前页药品记录。'),
    field('list[].id', 'string | number | null', '药品记录ID；编辑和删除使用。', { nullable: true, nullMeaning: '后端没有返回可操作ID，不能把该行交给写操作。' }),
    field('list[].type', 'integer | null', '药物类型；1为兽药，2为消毒药。', { nullable: true, nullMeaning: '后端没有返回类型。', values: { '1': '兽药', '2': '消毒药' } }),
    field('list[].purpose', 'string | null', '使用途径。', { nullable: true, nullMeaning: '后端没有返回使用途径。' }),
    field('list[].medicineGroup', 'string | null', '药物分组。', { nullable: true, nullMeaning: '后端没有返回药物分组。' }),
    field('list[].element', 'string | null', '药物成份。', { nullable: true, nullMeaning: '后端没有返回成份。' }),
    field('list[].factory', 'string | null', '生产厂家。', { nullable: true, nullMeaning: '后端没有返回生产厂家。' }),
    field('list[].supplier', 'string | null', '供应商。', { nullable: true, nullMeaning: '后端没有返回供应商。' }),
    field('list[].name', 'string | null', '药物名称。', { nullable: true, nullMeaning: '后端没有返回名称。' }),
    field('list[].measureUnit', 'string | null', '兼容后端DTO的计量单位字段；当前表格不直接展示。', { nullable: true, nullMeaning: '后端没有返回计量单位。' }),
    field('list[].unit', 'string | null', '兼容后端实体的单位字段；当前表格不直接展示。', { nullable: true, nullMeaning: '后端没有返回单位。' }),
    field('total', 'integer', '符合当前筛选条件的总记录数，不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页没有记录；total=0才表示筛选条件下没有记录，权限、网络或后端错误会抛出。',
}

const draftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal药品弹窗校验、可交给save的完整草稿。'),
    field('draft.id', 'string | number', '编辑时的药品ID；新建时为空字符串。', { optional: true }),
    field('draft.type', 'integer', '药物类型；1兽药、2消毒药。'),
    field('draft.purpose', 'string', '使用途径；非空。'),
    field('draft.medicineGroup', 'string', '药物分组；页面允许为空，提交时保留空字符串。'),
    field('draft.element', 'string', '成份；页面允许为空，提交时保留空字符串。'),
    field('draft.factory', 'string', '生产厂家；非空。'),
    field('draft.supplier', 'string', '供应商；页面允许为空，提交时保留空字符串。'),
    field('draft.name', 'string', '药物名称；非空。'),
  ],
  empty: '输入不满足Portal校验时直接抛错，不返回草稿，也不发送网络请求。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求完成后的本地成功确认；接口没有返回最终药品对象。')],
  empty: '请求抛错时没有成功结果；true也不等于写入已完成，必须按步骤回查列表。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_MEDICINE_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_MEDICINE_PERMISSION}；列表查询受页面内${PRODUCT_SETTING_MEDICINE_QUERY_PERMISSION}控制，新建、编辑和删除按钮受${PRODUCT_SETTING_MEDICINE_SUBMIT_PERMISSION}控制。SDK不绕过服务端权限。`,
  '请求使用Portal product实例，业务URL不额外拼接admin-api；该路径不推导module-type，因此不发送module-type，product实例会补devicetype=PC。',
  '列表customLoad把useListPageModule产生的order、orderField、type、factory、name、pageNo和pageSize整体交给GET /config/medicine/page；默认type是字符串1，默认厂家和名称是空字符串。',
  '药品弹窗提交只发送id、type、purpose、medicineGroup、element、factory、supplier、name八个键；medicineGroup、element和supplier虽可为空也不能从body中删除。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/setting/base-setting/medicine/list.vue', kind: 'reference', note: '逐页核对菜单路径、菜单权限、product实例、默认筛选、列表请求、按钮权限、保存和DELETE请求。' },
  { source: 'app/portal/views/dashboard/product/setting/base-setting/medicine/modal-form-content.vue', kind: 'reference', note: '逐字段核对编辑/新建默认值、type禁改规则、四项必填和八字段提交。' },
  { source: 'MedicineController、Medicine、MedicineDTO、MedicineVO、MedicineServiceImpl', kind: 'reference', note: '核对page包络、分页字段、保存按ID更新/无ID新建、软删除和后端类型定义。' },
  { source: 'src/capabilities/product-setting-medicine.ts 与 test/product-setting-medicine.test.ts', kind: 'implementation', note: '锁定SDK请求、表单校验、product实例和离线反证；不替代真实环境浏览器证据。' },
  { source: 'docs/pages/产品设置药品管理.md', kind: 'reference', note: '记录页面能力、参数、字段基准、权限和真实环境缺口。' },
]

const gaps = [
  '已逐页核对Portal菜单、列表、弹窗、Java Controller/Entity/DTO/VO/Service、SDK实现和离线反证测试；尚未在真实测试环境执行本页列表、保存、删除请求。',
]

function inputsFor (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`产品设置药品契约没有对应能力定义：${id}`)
  return Object.fromEntries(definition.params.map(item => [item.name, {
    type: item.kind === 'number' ? 'number' : item.kind === 'enum' ? 'enum' : 'string',
    required: item.required,
    meaning: item.description ?? item.name,
    source: '用户筛选、Portal表单或当前列表行；按本能力参数契约填写。',
  }]))
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-medicine-', '')
  const effect: AiContract['effect'] = suffix === 'prepare-save' ? 'prepare' : suffix === 'list' ? 'read' : 'write'
  const output = suffix === 'list' ? pageOutput : suffix === 'prepare-save' ? draftOutput : trueOutput
  const steps: AiContract['steps'] = []
  if (suffix === 'save') {
    steps.push({ role: 'required', when: '用户确认保存新建或编辑表单', capabilityId: 'product-setting-medicine-prepare-save', mapping: { form: 'args.draft' }, instruction: '先用同一表单执行prepareSave；只有prepare成功且用户确认后，才调用save。' })
    steps.push({ role: 'cancel', when: '用户在提交前取消', instruction: '丢弃本地draft，不调用保存接口；Portal没有保存前取消请求。' })
  }
  if (suffix === 'prepare-save') {
    steps.push({ role: 'required', when: '用户确认提交准备好的草稿', capabilityId: 'product-setting-medicine-save', mapping: { draft: 'result.draft' }, instruction: '只把result.draft原样交给save；成功或超时后调用list回查。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用写接口。' })
  }
  if (suffix === 'save' || suffix === 'remove') {
    steps.push({ role: 'required', when: '请求成功或超时需要确认最终状态', capabilityId: 'product-setting-medicine-list', instruction: '用当前type、factory和name重新分页读取，按药品ID和八个关键字段核对；不要只把true回执当成已落库。' })
  }
  return {
    purpose: suffix === 'list' ? '按Portal筛选条件分页读取产品设置药品。' : suffix === 'prepare-save' ? '按Portal药品弹窗规则准备新建或编辑草稿。' : suffix === 'save' ? '保存一条产品设置药品记录。' : '删除当前列表中的一条产品设置药品记录。',
    whenToUse: `需要在${PRODUCT_SETTING_MEDICINE_PAGE_PATH}页面执行对应动作时使用。`,
    effect,
    inputs: inputsFor(id),
    output,
    consume: suffix === 'list'
      ? ['按list[].id选择编辑或删除目标；type是数字类型值，不能把中文类型标签当ID或请求值。', 'total是筛选后的总数；不要用当前页list长度代替全量结果。']
      : ['写操作返回true只代表请求完成；保存和删除都必须调用list回查最终状态。', '写操作必须使用最新列表行的非空id或prepare返回的草稿。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面及对应后端权限。'],
    steps,
    completion: suffix === 'list' ? '获得与Portal customLoad消费形状一致的list和total。' : suffix === 'prepare-save' ? '获得完整八字段本地草稿，尚未改变服务端。' : '请求按Portal页面的HTTP方法、URL和参数完成，并在列表回查后确认业务终态。',
    failures: ['字段校验、ID校验、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功。', 'type只能是1（兽药）或2（消毒药）；Portal编辑时不允许改变类型。'],
    idempotency: suffix === 'list' || suffix === 'prepare-save' ? null : '保存接口虽带后端RepeatSubmitLimit，但没有可由SDK传入的requestId；请求超时先按ID/关键字段回查，再决定是否重试。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingMedicineCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置药品契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_MEDICINE_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_MEDICINE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_MEDICINE_METHODS).map(([id, method]) => [
    `productSettingMedicine.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingMedicine.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
