import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_BUSINESS_AGE_DIVISION_BATCH_QUERY_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_BATCH_SUBMIT_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_METHODS,
  PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH,
  PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_QUERY_PERMISSION,
  PRODUCT_BUSINESS_AGE_DIVISION_SUBMIT_PERMISSION,
  productBusinessAgeDivisionCapabilities,
} from '../capabilities/product-business-age-division.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productBusinessAgeDivisionCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于写入已经回查确认。',
}

const bulkFields: AiField[] = [
  field('$', 'object', '批量设置列表分页结果；list是当前页，total是筛选条件下总记录数。'),
  field('list', 'array', '当前页的批量日龄分割记录。'),
  field('list[]', 'object', '批量设置列表行；SDK保留后端扩展字段。'),
  field('list[].id', 'string | number | null', '日龄分割配置ID；编辑和删除目标。', { nullable: true, nullMeaning: '没有可用配置ID，不能安全执行编辑或删除。' }),
  field('list[].line', 'string | null', '品系编码。', { nullable: true, nullMeaning: '未设置品系。' }),
  field('list[].gen', 'string | null', '代次编码。', { nullable: true, nullMeaning: '未设置代次。' }),
  field('list[].variety', 'string | null', '品种编码。', { nullable: true, nullMeaning: '未设置品种。' }),
  field('list[].moult', 'integer | null', '蛋鸡类型：0正常蛋鸡、1换羽蛋鸡。', { nullable: true, values: { '0': '正常蛋鸡', '1': '换羽蛋鸡' } }),
  field('list[].ageDiv', 'integer | null', '日龄分割点，单位为日龄天数。', { nullable: true, unit: '天', nullMeaning: '后端未返回分割日龄。' }),
  field('list[].lineName', 'string | null', '页面展示的品系名称。', { nullable: true }),
  field('list[].genName', 'string | null', '页面展示的代次名称。', { nullable: true }),
  field('list[].varietyName', 'string | null', '页面展示的品种名称。', { nullable: true }),
  field('total', 'integer', '筛选条件下的总记录数，不是当前页长度。'),
]

const batchFields: AiField[] = [
  field('$', 'object', '批次设置列表分页结果；list是当前页，total是筛选条件下总记录数。'),
  field('list', 'array', '当前页的批次日龄分割记录。'),
  field('list[]', 'object', '批次设置列表行；SDK保留后端扩展字段。'),
  field('list[].id', 'string | number | null', '批次日龄分割配置ID；编辑和删除目标。', { nullable: true, nullMeaning: '没有可用配置ID，不能安全执行编辑或删除。' }),
  field('list[].batch', 'string | null', '批次号。', { nullable: true, nullMeaning: '后端未返回批次号。' }),
  field('list[].ageDiv', 'integer | null', '该批次的日龄分割点，单位为日龄天数。', { nullable: true, unit: '天' }),
  field('total', 'integer', '筛选条件下的总记录数，不是当前页长度。'),
]

const draftFields = (batch: boolean, update: boolean): AiField[] => batch
  ? [
      field('$', 'object', '经过Portal表单校验、尚未发送请求的批次设置草稿。'),
      field('draft', 'object', '批次设置请求体。'),
      field('draft.batch', 'string', '批次号；非空。'),
      field('draft.ageDiv', 'integer', '日龄分割点，单位为日龄天数；Portal输入框允许0，但Java批次VO要求大于等于1，0会由服务端拒绝。', { unit: '天' }),
      ...(update ? [field('draft.id', 'string | number', '当前批次日龄分割列表行ID；编辑请求必须带上。')] : []),
    ]
  : [
      field('$', 'object', '经过Portal表单校验、尚未发送请求的批量设置草稿。'),
      field('draft', 'object', '批量设置请求体。'),
      field('draft.line', 'string', '品系编码；可为空字符串，但品系和品种至少一个非空。'),
      field('draft.gen', 'string', '代次编码；非空。'),
      field('draft.variety', 'string', '品种编码；可为空字符串，但品种和品系至少一个非空。'),
      field('draft.moult', 'integer', '蛋鸡类型：0正常、1换羽。', { values: { '0': '正常蛋鸡', '1': '换羽蛋鸡' } }),
      field('draft.ageDiv', 'integer', '日龄分割点，单位为日龄天数；Portal允许不小于0。', { unit: '天' }),
      ...(update ? [field('draft.id', 'string | number', '当前批量设置列表行ID；编辑请求必须带上。')] : []),
    ]

const boundaries = [
  `只覆盖页面${PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH}，菜单权限是${PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION}；不扩展到其他生产设置页面。`,
  `Portal声明查询权限${PRODUCT_BUSINESS_AGE_DIVISION_QUERY_PERMISSION}/${PRODUCT_BUSINESS_AGE_DIVISION_BATCH_QUERY_PERMISSION}和提交权限${PRODUCT_BUSINESS_AGE_DIVISION_SUBMIT_PERMISSION}/${PRODUCT_BUSINESS_AGE_DIVISION_BATCH_SUBMIT_PERMISSION}。新增、编辑、删除按钮由各自tab的submit权限控制；SDK不把前端按钮隐藏等同于服务端授权。`,
  '所有请求使用Portal product HTTP实例；页面没有可推导的module-type，因此不发送module-type。',
  '批量设置按品系/代次/品种/蛋鸡类型分页查询，也可按批次号调用flock_info接口；批次设置单独使用flock/page列表。两个tab不是同一组数据。',
  '批量设置表单要求品种和品系至少填一项、代次/蛋鸡类型/日龄分割必填；批次设置要求批次号和日龄分割必填。取消只丢弃本地草稿，没有取消接口。',
  'Java批次VO对ageDiv有@Min(1)，而Portal输入框min为0；SDK保留Portal允许输入0的边界，让后端业务校验产生真实失败，不把服务端规则伪装成页面校验。',
]

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main：app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/business-manage/age-division/list.vue及两个tab组件/弹窗组件', kind: 'reference', note: '逐页核对路径、菜单权限、tab、查询表单、按钮权限、端点、提交体和取消行为。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test：AgeDivisionController.java、AgeDivisionFlockVO.java、AgeDivisionDTO.java、AgeDivisionFlockDTO.java', kind: 'reference', note: '核对批量/批次端点、分页、批次号查询、保存/编辑/删除HTTP方法和批次日龄服务端校验。' },
  { source: 'src/capabilities/product-business-age-division.ts、test/product-business-age-division.test.ts', kind: 'implementation', note: '锁定请求参数、返回投影、prepare草稿、权限上下文和语义变异反证；未替代真实环境写入闭环。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐tab执行列表、prepare→submit→回查及删除闭环；当前证据是固定源码和离线请求测试。',
  '未取得真实租户的品系/代次/品种选择器候选及真实后端错误文案；SDK仅按页面提交的编码字段传值。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-business-age-division-', '')
  const batch = suffix.includes('batch') && !suffix.includes('bulk-by-flock-info')
  if (suffix === 'list-bulk') return {
    line: param('品系编码筛选；省略时发送空字符串。', 'Portal批量设置查询表单', { type: 'string', required: false, nullable: true, nullMeaning: '不按品系筛选。' }),
    gen: param('代次编码筛选；省略时发送空字符串。', 'Portal批量设置查询表单', { type: 'string', required: false, nullable: true, nullMeaning: '不按代次筛选。' }),
    variety: param('品种编码筛选；省略时发送空字符串。', 'Portal批量设置查询表单', { type: 'string', required: false, nullable: true, nullMeaning: '不按品种筛选。' }),
    moult: param('蛋鸡类型：0正常、1换羽；省略时按Portal初始值发送0。', 'Portal批量设置查询表单', { type: '0 | 1', required: false, default: '0', options: [{ value: 0, label: '正常蛋鸡' }, { value: 1, label: '换羽蛋鸡' }] }),
    pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'get-bulk-by-flock-info') return { flockInfo: param('要查询的批次号；省略或传空字符串时按Portal返回空列表且不发送请求。', '用户在批次搜索模式输入的批次号', { type: 'string', required: false, nullable: true }) }
  if (suffix === 'list-batch') return {
    flockInfo: param('批次号筛选；省略时发送空字符串。', 'Portal批次设置查询表单', { type: 'string', required: false, nullable: true }),
    ageDiv: param('日龄分割整数筛选；省略时发送空字符串。', 'Portal批次设置查询表单', { type: 'string | number', required: false, nullable: true, unit: '天' }),
    pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  const form = batch ? '批次设置' : '批量设置'
  const isRemove = suffix.includes('remove')
  const isUpdate = suffix.includes('update')
  if (isRemove) return { id: param(`当前${form}列表行ID。`, `productBusinessAgeDivision.list${batch ? 'Batch' : 'Bulk'}.result.list[].id`, { type: 'string | number', required: true }) }
  if (suffix.includes('prepare-')) return { form: param(`Portal${form}弹窗表单；准备阶段只做本地校验，不发请求。`, `用户填写的Portal${form}弹窗表单`, { type: 'object', required: true }) }
  if (suffix === `create-${batch ? 'batch' : 'bulk'}`) return { draft: param(`prepareCreate${batch ? 'Batch' : 'Bulk'}返回的请求草稿。`, `productBusinessAgeDivision.prepareCreate${batch ? 'Batch' : 'Bulk'}.result.draft`, { type: 'object', required: true }) }
  if (isUpdate) return { draft: param(`prepareUpdate${batch ? 'Batch' : 'Bulk'}返回的含ID请求草稿。`, `productBusinessAgeDivision.prepareUpdate${batch ? 'Batch' : 'Bulk'}.result.draft`, { type: 'object', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-business-age-division-', '')
  const batch = suffix.includes('batch') && !suffix.includes('bulk-by-flock-info')
  const read = suffix.startsWith('list-') || suffix === 'get-bulk-by-flock-info'
  const prepare = suffix.startsWith('prepare-')
  const write = !read && !prepare
  const operation = batch ? '批次设置' : '批量设置'
  const steps: AiContract['steps'] = []
  if (prepare && suffix.includes('create')) {
    steps.push({ role: 'required', when: '用户确认草稿', capabilityId: `product-business-age-division-create-${batch ? 'batch' : 'bulk'}`, mapping: { draft: 'result.draft' }, instruction: '把prepare结果中的draft原样交给对应create能力。' })
    steps.push({ role: 'cancel', when: '用户取消新建', instruction: '丢弃本地draft，不发送保存请求。' })
  } else if (prepare && suffix.includes('update')) {
    steps.push({ role: 'required', when: '用户确认草稿', capabilityId: `product-business-age-division-update-${batch ? 'batch' : 'bulk'}`, mapping: { draft: 'result.draft' }, instruction: '把prepare结果中的draft原样交给对应update能力，保留当前行ID。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '丢弃本地draft，不发送保存请求。' })
  } else if (prepare && suffix.includes('remove')) {
    steps.push({ role: 'required', when: '用户确认删除当前列表行', capabilityId: `product-business-age-division-remove-${batch ? 'batch' : 'bulk'}`, mapping: { id: 'result.id' }, instruction: '确认后把prepare结果中的ID交给remove；确认前不发删除请求。' })
    steps.push({ role: 'cancel', when: '用户取消删除', instruction: '丢弃ID，不调用remove。' })
  } else if (write) {
    const listId = batch ? 'product-business-age-division-list-batch' : 'product-business-age-division-list-bulk'
    steps.push({ role: 'required', when: '保存/删除请求成功或响应不确定', capabilityId: listId, mapping: {}, instruction: `重新调用${listId}回查${operation}的业务终态；true只表示请求未抛错。` })
  }
  let output: AiContract['output'] = trueOutput
  if (suffix === 'list-bulk' || suffix === 'get-bulk-by-flock-info') output = { shape: '{ list: object[], total: integer }', fields: bulkFields, empty: 'list=[]表示当前查询没有记录；get-bulk-by-flock-info的total等于返回数组长度；权限、网络或结构错误会抛出，不降级为空列表。' }
  else if (suffix === 'list-batch') output = { shape: '{ list: object[], total: integer }', fields: batchFields, empty: 'list=[]表示当前筛选没有记录；权限、网络或结构错误会抛出，不降级为空列表。' }
  else if (prepare) output = suffix.includes('remove') ? { shape: '{ id: string | number }', fields: [field('id', 'string | number', `待确认后用于删除的${operation}记录ID。`)], empty: 'ID无效时抛错且不发送删除请求。' } : { shape: '{ draft: object }', fields: draftFields(batch, suffix.includes('update')), empty: '表单校验失败时抛错且不发送写请求。' }
  return {
    purpose: read ? `按Portal${operation}页面规则读取日龄分割数据。` : prepare ? `按Portal${operation}弹窗规则准备日龄分割写请求草稿。` : `按Portal${operation}页面端点提交日龄分割写操作。`,
    whenToUse: `需要在${PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH}对应的${operation}tab执行${read ? '查询' : '操作'}时使用；批量设置和批次设置的记录不能混用。`,
    boundaries,
    effect: read ? 'read' : prepare ? 'prepare' : 'write',
    prerequisites: ['使用当前用户/租户绑定的product会话；确认当前页面菜单权限和对应tab的查询/提交权限。', ...(write ? ['成功或响应不确定后必须按steps回查列表，不能把请求成功当作业务终态。'] : [])],
    inputs: inputFor(id),
    output,
    consume: read ? ['用list[].id和字段确认目标记录；将当前页list与total分别用于展示明细和分页，不把total当页长。'] : prepare ? ['把draft展示给用户确认；取消时丢弃草稿。'] : ['按steps重新查询确认保存或删除后的记录状态；不要把true当作已回查的业务结果。'],
    steps,
    completion: read ? '获得当前筛选和分页范围内的日龄分割记录。' : prepare ? '获得尚未改变服务端的本地请求草稿。' : '请求按Portal端点和表单字段完成；保存/删除是否生效仍以回查结果为准。',
    failures: ['ID、必填字段、枚举、整数、分页或响应结构不合法时在发请求前失败；401/403、网络错误和Java业务校验错误原样失败。', '写请求超时或响应不确定时先回查再决定是否重试；页面没有撤销已提交写请求的接口。'],
    idempotency: read || prepare ? null : '页面没有requestId幂等包装；重复保存或删除可能产生重复/重复错误，超时必须先回查。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productBusinessAgeDivisionCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`日龄分割契约没有对应能力定义：${id}`)

export const PRODUCT_BUSINESS_AGE_DIVISION_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_BUSINESS_AGE_DIVISION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_BUSINESS_AGE_DIVISION_METHODS).map(([id, method]) => [
    `productBusinessAgeDivision.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productBusinessAgeDivision.${method}；写操作按prepare→submit→回查执行。`] },
  ]),
)
