import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_VACCINE_METHODS,
  PRODUCT_SETTING_VACCINE_PAGE_PATH,
  productSettingVaccineCapabilities,
} from '../capabilities/product-setting-vaccine.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingVaccineCapabilities.map(definition => [definition.id, definition]))

const pageFields: AiField[] = [
  field('$', 'object', '疫苗分页结果；list是当前页，total是筛选后的总记录数。'),
  field('list', 'object[]', '当前页的疫苗记录。'),
  field('list[].id', 'string | number | null', '疫苗记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回可用ID，不能执行编辑或删除。' }),
  field('list[].diseaseName', 'string | null', '疾病名称；Java列表服务可能已将存储的疾病字典ID映射为展示文本。', { nullable: true, nullMeaning: '后端没有返回疾病名称。' }),
  field('list[].vaccineName', 'string | null', '疫苗名称。', { nullable: true, nullMeaning: '后端没有返回疫苗名称。' }),
  field('list[].imported', '0 | 1 | null', '国产/进口标记：0国产、1进口。', { nullable: true, nullMeaning: '后端没有返回进口国产标记。' }),
  field('list[].strain', 'string | null', '毒株。', { nullable: true, nullMeaning: '后端没有返回毒株。' }),
  field('list[].manufacturer', 'string | null', '生产厂家。', { nullable: true, nullMeaning: '后端没有返回生产厂家。' }),
  field('list[].antibody', 'string | null', '抗体；页面提交时可为空。', { nullable: true, nullMeaning: '没有抗体值。' }),
  field('list[].updateDate', 'string | null', '最近修改时间；表格展示字段。', { nullable: true, nullMeaning: '后端没有返回修改时间。' }),
  field('list[].createDate', 'string | null', '创建时间；后端实体字段，页面当前不直接展示。', { nullable: true, nullMeaning: '后端没有返回创建时间。' }),
  field('list[].sapDescription', 'string | null', 'SAP物料描述；后端实体字段，页面当前不直接展示。', { nullable: true, nullMeaning: '后端没有返回SAP描述。' }),
  field('list[].sapCode', 'string | null', 'SAP物料编码；后端实体字段，页面当前不直接展示。', { nullable: true, nullMeaning: '后端没有返回SAP编码。' }),
  field('list[].unit', 'string | null', '疫苗单位；后端实体字段，页面当前不直接展示。', { nullable: true, nullMeaning: '后端没有返回单位。' }),
  field('total', 'integer', '当前筛选条件下的总记录数，不是当前页长度。'),
]

const draftFields: AiField[] = [
  field('$', 'object', '通过Portal弹窗校验、可交给save的七字段草稿。'),
  field('draft', 'object', '已通过Portal表单校验、尚未写入的完整七字段草稿。'),
  field('draft.id', 'string | number', '编辑时的疫苗记录ID；新建时固定为空字符串。', { optional: true }),
  field('draft.diseaseName', 'string', '疾病名称；非空。'),
  field('draft.vaccineName', 'string', '疫苗名称；非空。'),
  field('draft.imported', '0 | 1', '国产/进口：0国产、1进口；该字段必填，0不能当作未填。'),
  field('draft.strain', 'string', '毒株；非空。'),
  field('draft.manufacturer', 'string', '生产厂家；非空。'),
  field('draft.antibody', 'string', '抗体；可为空，但提交body固定保留该字段。'),
]

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求完成后的本地成功确认；接口没有返回最终疫苗对象。')],
  empty: '请求抛错时没有成功结果；true不等于写入已完成，必须按步骤回查列表。',
}

const commonBoundaries = [
  '页面路径是/dashboard/product/setting/base-setting/vaccine/list，菜单权限是/dashboard/frame/base-setting/vaccine；列表查询受base:vaccine:query控制，新建、编辑和删除受base:vaccine:submit控制。SDK不绕过页面或服务端权限。',
  '请求使用Portal product实例，补devicetype=PC；该产品设置页面不发送module-type。',
  '列表customLoad把useListPageModule产生的order、orderField、diseaseName、vaccineName、antibody、pageNo和pageSize整体交给GET /config/vaccine/page；页面styleV2默认pageSize=20。',
  '保存body严格只有id、diseaseName、vaccineName、imported、strain、manufacturer、antibody七个字段；抗体可为空但不能从body删除，0国产是有效值不能按空值过滤。',
  'Java保存有ID时更新、无ID时新建，并带防重复提交限制；删除是按ID软删除。页面没有单独详情读取、导入或启停动作，SDK不扩展不可达端点。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/setting/base-setting/vaccine/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、product实例、筛选默认值、分页、查询、保存和删除请求。' },
  { source: 'app/portal/views/dashboard/product/setting/base-setting/vaccine/modal-form-content.vue', kind: 'reference', note: '逐字段核对新建/编辑默认值、国产/进口0/1候选、五项必填、抗体可空和七字段提交。' },
  { source: 'VaccineController、Vaccine、VaccineDTO、VaccineVO、VaccineMapperExt.xml、VaccineServiceImpl', kind: 'reference', note: '核对分页包络、列表字段、疾病名称服务层映射、按ID保存和软删除。' },
  { source: 'src/capabilities/product-setting-vaccine.ts 与 test/product-setting-vaccine.test.ts', kind: 'implementation', note: '锁定SDK请求、表单校验、0值、响应字段、product实例和离线反证；不替代真实环境浏览器证据。' },
  { source: 'docs/pages/产品设置疫苗管理.md', kind: 'reference', note: '记录页面四件套、权限和真实环境缺口。' },
]

const gaps = [
  '已逐页核对Portal菜单、列表、弹窗、Java Controller/Entity/DTO/VO/Mapper/Service、SDK实现和离线反证测试；尚未在真实测试环境使用浏览器会话执行列表、prepare → save → 回查及删除闭环。',
]

const queryInputs: Record<string, AiParameter> = {
  diseaseName: param('疾病名称筛选；省略时发送空字符串。', '用户筛选或页面默认值', { type: 'string', required: false, default: '' }),
  vaccineName: param('疫苗名称筛选；省略时发送空字符串。', '用户筛选或页面默认值', { type: 'string', required: false, default: '' }),
  antibody: param('抗体筛选；省略时发送空字符串。', '用户筛选或页面默认值', { type: 'string', required: false, default: '' }),
  pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: '1' }),
  pageSize: param('页面支持的每页条数。', '调用方分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
}

const formInput = param('Portal疫苗弹窗表单；diseaseName、vaccineName、imported、strain、manufacturer必填，antibody可为空。', '用户确认的页面表单', { type: 'object', required: true, constraints: ['imported必须为数字0或1；0国产是有效值', 'id省略或空字符串表示新建，编辑时沿用列表行id'] })

function inputFor (id: string): Record<string, AiParameter> {
  if (id.endsWith('list')) return queryInputs
  if (id.endsWith('prepare-save')) return { form: formInput }
  if (id.endsWith('save')) return { draft: param('prepareSave返回的完整七字段草稿；不要自行删除antibody空字段。', 'productSettingVaccine.prepareSave.result.draft', { type: 'object', required: true }) }
  return { id: param('当前列表行record.id；不是疫苗名称。', 'productSettingVaccine.list.result.list[].id', { type: 'string | number', required: true }) }
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-vaccine-', '')
  const isList = suffix === 'list'
  const isPrepare = suffix === 'prepare-save'
  const isSave = suffix === 'save'
  const steps: AiContract['steps'] = []
  if (isSave) {
    steps.push({ role: 'required', when: '用户确认保存新建或编辑表单', capabilityId: 'product-setting-vaccine-prepare-save', mapping: { form: 'args.draft' }, instruction: '先用同一表单执行prepareSave；只有prepare成功且用户确认后，才调用save。' })
    steps.push({ role: 'cancel', when: '用户在提交前取消', instruction: '丢弃本地draft，不调用保存接口。' })
  }
  if (isPrepare) {
    steps.push({ role: 'required', when: '用户确认提交准备好的草稿', capabilityId: 'product-setting-vaccine-save', mapping: { draft: 'result.draft' }, instruction: '只把result.draft原样交给save；成功或超时后调用list按ID回查。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用写接口。' })
  }
  if (isSave || suffix === 'remove') {
    steps.push({ role: 'required', when: '请求成功或超时需要确认最终状态', capabilityId: 'product-setting-vaccine-list', instruction: '重新读取列表并按疫苗ID核对疾病、疫苗名称、进口国产、毒株、厂家和抗体；不要只把true回执当作已落库。' })
  }
  return {
    purpose: isList ? '按疾病名称、疫苗名称和抗体分页读取产品设置疫苗。' : isPrepare ? '按Portal疫苗弹窗规则准备新建或编辑草稿。' : isSave ? '保存一条产品设置疫苗记录。' : '删除当前列表行对应的产品设置疫苗记录。',
    whenToUse: `需要在${PRODUCT_SETTING_VACCINE_PAGE_PATH}页面执行${isList ? '查询' : isPrepare ? '准备保存' : isSave ? '保存' : '删除'}时使用。`,
    effect: isList || isPrepare ? (isPrepare ? 'prepare' : 'read') : 'write',
    inputs: inputFor(id),
    output: isList ? { shape: '{ list: object[], total: integer }', fields: pageFields, empty: 'list=[]表示当前页没有记录；total=0才表示筛选条件下没有记录，权限、网络或后端错误会抛出。' } : isPrepare ? { shape: '{ draft: object }', fields: draftFields, empty: '输入不满足Portal校验时直接抛错，不返回草稿，也不发送网络请求。' } : trueOutput,
    consume: isList ? ['按list[].id选择编辑或删除目标；imported是数字0/1，0代表国产，不能当成缺省。', 'total是筛选后的总数；不要用当前页list长度代替全量结果。'] : isPrepare ? ['用户取消时丢弃draft；确认保存时把同一draft交给save。'] : ['写操作返回true只代表请求完成；保存和删除都必须调用list回查最终状态。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面及对应后端权限。', ...(isSave ? ['已通过prepareSave，且用户明确确认保存。'] : []), ...(suffix === 'remove' ? ['id来自最新列表行，用户已明确确认删除。'] : [])],
    steps,
    completion: isList ? '获得与Portal customLoad消费形状一致的list和total。' : isPrepare ? '获得完整七字段本地草稿，尚未改变服务端。' : '请求按Portal HTTP方法、URL和参数完成，并在列表回查后确认业务终态。',
    failures: ['字段校验、ID校验、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功。'],
    idempotency: isList || isPrepare ? null : '页面没有requestId幂等协议；保存或删除超时先按ID回查，再决定是否重试，避免重复写入或误判。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingVaccineCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置疫苗契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_VACCINE_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_VACCINE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_VACCINE_METHODS).map(([id, method]) => [
    `productSettingVaccine.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingVaccine.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
