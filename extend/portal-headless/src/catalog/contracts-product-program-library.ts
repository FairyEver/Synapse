import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_PROGRAM_PAGE_RULES,
  PRODUCT_PROGRAM_LIBRARY_PAGE_PATH,
  PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH,
  PRODUCT_PROGRAM_LIBRARY_METHODS,
  PRODUCT_PROGRAM_LIBRARY_NEW_METHODS,
  productProgramLibraryCapabilities,
  productProgramLibraryNewCapabilities,
  type ProductProgramPageKey,
} from '../capabilities/product-program-library.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const allDefinitions = [...productProgramLibraryCapabilities, ...productProgramLibraryNewCapabilities]
const definitions = new Map(allDefinitions.map(definition => [definition.id, definition]))
const methodsById: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PRODUCT_PROGRAM_LIBRARY_METHODS)),
  ...Object.fromEntries(Object.entries(PRODUCT_PROGRAM_LIBRARY_NEW_METHODS)),
}

const PAGE_KEY_LABELS: Record<ProductProgramPageKey, string> = Object.fromEntries(
  Object.entries(PRODUCT_PROGRAM_PAGE_RULES).map(([key, rule]) => [key, rule.label]),
) as Record<ProductProgramPageKey, string>

function valueType (type: string): string {
  if (type === 'number' || type === 'day-age') return 'number'
  if (type === 'dict' || type === 'supply') return 'string | number'
  if (type === 'day-age-range' || type === 'time' || type === 'text' || type === 'textarea') return 'string'
  return 'unknown'
}

function pageKeyInput (): AiParameter {
  return param('程序子页键；必须取tabs.children[].code映射到SDK静态键，不要把中文标题直接当pageKey。', '程序库tabs.children[].code', {
    type: 'enum',
    required: true,
    options: Object.entries(PAGE_KEY_LABELS).map(([value, label]) => ({ value, label })),
  })
}

function draftFields (pageKey: ProductProgramPageKey, root: string): AiField[] {
  return PRODUCT_PROGRAM_PAGE_RULES[pageKey].fields.map(rule => field(`${root}.${rule.dataIndex}`, rule.multiple ? `(${valueType(rule.type)})[]` : valueType(rule.type), `${rule.title}；${rule.required ? '必填' : '可选'}${rule.max === undefined ? '' : `，最多${rule.max}个字符`}${rule.type === 'day-age' ? '，整数且绝对值不超过700' : ''}${rule.type === 'day-age-range' ? '，日龄或日龄区间且绝对值不超过700' : ''}`, {
    optional: !rule.required,
    constraints: [
      ...(rule.min === undefined ? [] : [`最小值${rule.min}`]),
      ...(rule.max !== undefined && rule.type === 'number' ? [`最大值${rule.max}`] : []),
      ...(rule.type === 'supply' ? ['提交时转换为正整数ID'] : []),
      ...(rule.submit === false ? ['Portal页面显示但不提交该字段'] : []),
    ],
  }))
}

function genericDraftFields (root: string): AiField[] {
  const seen = new Set<string>()
  const result: AiField[] = []
  for (const [pageKey] of Object.entries(PRODUCT_PROGRAM_PAGE_RULES) as Array<[ProductProgramPageKey, (typeof PRODUCT_PROGRAM_PAGE_RULES)[ProductProgramPageKey]]>) {
    for (const item of draftFields(pageKey, root)) {
      if (seen.has(item.path)) continue
      seen.add(item.path)
      result.push(item)
    }
  }
  return result
}

function genericListFields (): AiField[] {
  const seen = new Set<string>()
  const result: AiField[] = [
    field('$', 'object', '程序库分页结果；list是当前页记录，total是筛选后的总条数；通风页额外有temperatures。'),
    field('list', 'object[]', '当前pageKey的程序记录；返回字段按二级程序页动态变化。'),
    field('list[].id', 'string | number | null', '后端记录ID；更新和删除使用；本地未保存行没有后端ID。', { nullable: true }),
  ]
  seen.add('list[].id')
  for (const [pageKey] of Object.entries(PRODUCT_PROGRAM_PAGE_RULES) as Array<[ProductProgramPageKey, (typeof PRODUCT_PROGRAM_PAGE_RULES)[ProductProgramPageKey]]>) {
    for (const item of draftFields(pageKey, 'list[]')) {
      if (seen.has(item.path)) continue
      seen.add(item.path)
      result.push({ ...item, optional: true, meaning: `${item.meaning}；仅当pageKey=${pageKey}的字段表包含它时出现。` })
    }
  }
  result.push(field('total', 'integer', '当前筛选条件下的总记录数。'))
  result.push(field('temperatures', 'number[]', '仅通风矩阵返回的温度列；其它pageKey不返回。', { optional: true }))
  return result
}

function outputFor (definitionId: string): { shape: string; fields: AiField[]; empty: string } {
  const suffix = definitionId.replace(/^product-program-library(?:-new)?-/, '')
  if (suffix === 'tabs') return { shape: 'object[]', fields: [field('[]', 'object', '程序库一级目录。'), field('[].code', 'string', '程序库一级Tab编码。'), field('[].name', 'string', '程序库一级Tab名称。'), field('[].children', 'object[]', '二级程序Tab。'), field('[].children[].code', 'string', '程序库二级Tab编码；可映射到pageKey或作为downloadTemplate的programCode。'), field('[].children[].name', 'string', '程序二级Tab名称。')], empty: '[]表示后端没有返回可用的程序目录。' }
  if (suffix === 'list') return { shape: 'object', fields: genericListFields(), empty: 'list为空表示当前程序和筛选条件没有记录；不要把它当成请求失败。' }
  if (suffix === 'suppliers' || suffix === 'materials') return { shape: 'object[]', fields: [field('[]', 'object', '启用的厂家或物料原始记录；SDK保留Portal编辑器需要的展示和关联字段。'), field('[].id', 'string | number', '供程序表单提交的ID。'), field('[].status', 'string | number', 'Portal只保留status=1的启用项。'), field('[].supplierId', 'string | number | null', '物料所属厂家ID；药物页按它联动筛选厂家。', { nullable: true })], empty: '[]表示没有启用的选项；不能把它伪造成任意可提交ID。' }
  if (suffix === 'prepare-create' || suffix === 'prepare-update') return { shape: 'object', fields: [field('draft', 'object', '已按当前pageKey对应Portal表单规则归一化、可提交的草稿。'), ...genericDraftFields('draft')], empty: '不会返回空草稿；输入不满足页面规则时直接抛错且不发请求。' }
  if (suffix === 'prepare-ventilation') return { shape: 'object', fields: [field('draft', 'object', '已按通风矩阵Portal规则归一化的草稿。'), field('draft.dayAge', 'number', '矩阵行日龄，0-700整数。'), field('draft.frequencyCode', 'string', '执行频次编码。'), field('draft.cells', 'object[]', '至少一个通风率大于0的温度单元，temperature不能重复。'), field('draft.cells[].temperature', 'number', '环境温度。'), field('draft.cells[].ventilationRate', 'number', '通风率，必须大于0。')], empty: '不会返回空草稿；输入不满足矩阵规则时直接抛错且不发请求。' }
  if (suffix === 'create') return { shape: 'string | number', fields: [field('$', 'string | number', '后端创建接口返回的新程序记录ID。')], empty: '不返回空ID；响应缺失或非ID时视为协议错误。' }
  if (suffix === 'export' || suffix === 'download-template') return { shape: 'object', fields: [field('fileName', 'string', '响应Content-Disposition解析出的文件名；缺失时使用页面默认名。'), field('contentType', 'string | null', '响应Content-Type；缺失时为null。', { nullable: true, nullMeaning: '服务端没有返回Content-Type' }), field('base64', 'string', '文件二进制的标准Base64内容。'), field('byteLength', 'integer', '文件字节数。')], empty: '文件为空或响应不是二进制时抛错。' }
  if (suffix === 'prepare-import') return { shape: 'object', fields: [field('fileName', 'string', '待导入xlsx文件名。'), field('contentType', 'string', '上传使用的MIME类型。'), field('byteLength', 'integer', '文件字节数。'), field('maxRows', 'integer', `Portal后端单次最多导入${1000}行；SDK不解析Excel行数。`)], empty: '输入为空、扩展名不是.xlsx或Base64非法时不返回预览。' }
  if (suffix === 'import') return { shape: 'integer', fields: [field('$', 'integer', '后端导入成功新增的记录数；接口返回CommonResult<Integer>的data。')], empty: '不返回空值；响应必须是非负整数。' }
  return { shape: 'true', fields: [field('$', 'boolean', 'Portal请求成功；SDK归一化为true。')], empty: '不适用；失败会抛出。' }
}

function inputsFor (definitionId: string, definition: (typeof allDefinitions)[number], pageKey: ProductProgramPageKey | null): Record<string, AiParameter> {
  const inputs: Record<string, AiParameter> = {}
  for (const item of definition.params) {
    if (item.name === 'pageKey') inputs.pageKey = pageKeyInput()
    else if (item.name === 'draft') inputs.draft = param('当前程序子页的对象草稿；字段以对应pageKey的字段表为准，先调用prepareCreate或prepareUpdate再提交。', '当前程序库列表行或用户提供的程序记录', { type: 'object', required: true })
    else if (item.name === 'row') inputs.row = param('通风矩阵行对象；包含dayAge、frequencyCode、cells，cells中每个temperature不能重复且至少一个ventilationRate大于0。', '程序库tongfeng矩阵列表行', { type: 'object', required: true })
    else if (item.name === 'filters') inputs.filters = param('页面筛选对象；只能发送当前pageKey的filters字段，空值会被Portal省略。', '程序库当前二级Tab的筛选表单', { type: 'object', required: false, omitted: '未填写的字段不发送；不支持的字段会被拒绝' })
    else if (item.name === 'ids') inputs.ids = param('已保存记录的ID数组；只对支持delete-list的页面有效。', 'list[].id', { type: 'array', required: true })
    else if (item.name === 'id') inputs.id = param('已保存程序记录的ID。', 'list[].id', { type: 'string | number', required: true })
    else if (item.name === 'dayAge') inputs.dayAge = param('通风矩阵要删除的日龄，0-700整数。', '通风矩阵list[].dayAge', { type: 'integer', required: true })
    else if (item.name === 'fileName') inputs.fileName = param('上传文件名；Portal选择控件只接受.xlsx。', '用户选择的文件名', { type: 'string', required: true })
    else if (item.name === 'base64') inputs.base64 = param('xlsx文件二进制的标准Base64。', '用户选择的文件内容', { type: 'string', required: true })
    else if (item.name === 'contentType') inputs.contentType = param('文件MIME类型；省略使用xlsx MIME。', '文件元数据', { type: 'string', required: false })
    else if (item.name === 'programCode') inputs.programCode = param('程序库二级Tab的code；省略时由pageKey使用静态映射。', 'tabs().children[].code', { type: 'string', required: false })
    else inputs[item.name] = param(item.description || item.name, '调用方输入', { type: item.kind, required: item.required })
  }
  if (pageKey && inputs.draft) inputs.draft.constraints = [...(inputs.draft.constraints || []), `字段规则见${PRODUCT_PROGRAM_PAGE_RULES[pageKey].label}页面；提交时只发送Portal标记submit=true的字段。`]
  return inputs
}

function contractFor (definition: (typeof allDefinitions)[number]): AiContract {
  const suffix = definition.id.replace(/^product-program-library(?:-new)?-/, '')
  const namespace = definition.pagePath === PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH ? 'productProgramLibraryNew' : 'productProgramLibrary'
  const method = methodsById[definition.id] || suffix
  const effect: AiContract['effect'] = suffix.startsWith('prepare-') ? 'prepare' : definition.write ? 'write' : suffix === 'prepare-import' ? 'prepare' : suffix === 'tabs' || suffix === 'list' || suffix === 'suppliers' || suffix === 'materials' || suffix === 'export' || suffix === 'download-template' ? 'read' : 'local'
  const output = outputFor(definition.id)
  const commonBoundaries = [
    `页面路径是${definition.pagePath}，权限码是${definition.permission}；Portal只有permissionCheck(${definition.permission})为真时才显示新建、保存、导入、导出和删除按钮，SDK不绕过服务端权限。`,
    `请求使用Portal默认platform实例，路径不额外拼接admin-api；${definition.moduleType === null ? '该菜单路径无法从Portal规则推导module-type，因此不发送该头。' : `该菜单路径按Portal规则发送module-type=${definition.moduleType}（防疫管理）。`}`,
    '程序库由一个组件承载17个二级程序；必须先通过tabs确认动态目录，再用children.code映射pageKey。不要按Java Controller名称猜页面字段。',
    '页面显示的字典值、厂家ID和物料ID按Portal编码提交；名称只用于展示。投药页厂家是联动物料的展示字段，medicationSupplierId在Portal页面显示但submit=false，SDK不会把它提交给create/update。',
    `直接方法路径为 ${namespace}.${method}；参数是一个对象，键名与本能力的inputs一致。通用invoke入口使用同一实现，不要另猜位置参数。`,
  ]
  const steps: AiContract['steps'] = []
  if (suffix === 'create' || suffix === 'update' || suffix === 'create-ventilation' || suffix === 'update-ventilation') {
    const ventilation = suffix.includes('ventilation')
    const prepareId = ventilation
      ? definition.id.replace(/-(?:create|update)-ventilation$/, '-prepare-ventilation')
      : definition.id.replace(/-(?:create|update)$/, suffix === 'create' ? '-prepare-create' : '-prepare-update')
    steps.push({ role: 'required', when: '提交写入前', capabilityId: prepareId, mapping: ventilation ? { row: 'args.row' } : { draft: 'args.draft' }, instruction: '先执行对应prepare，让SDK按Portal字段必填、日龄、数字、长度和跨字段范围规则拒绝非法草稿；prepare失败时不得发写请求。' })
    steps.push({ role: 'cancel', when: 'prepare完成但用户取消', instruction: '只丢弃本地draft，不调用Portal接口；Portal没有保存前的取消请求。已提交的记录没有事务回滚接口，若用户确认清理，只能另行调用删除能力。' })
  }
  if (suffix === 'prepare-create' || suffix === 'prepare-update') {
    const submitId = definition.id.replace(/-prepare-(create|update)$/, '-$1')
    steps.push({ role: 'required', when: '用户确认提交已准备草稿', capabilityId: submitId, mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的draft；写入完成后按pageKey重新list回查ID和关键字段。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用写接口。' })
  }
  if (suffix === 'prepare-ventilation') {
    steps.push({ role: 'optional', when: '用户确认新建通风矩阵行', capabilityId: definition.id.replace(/-prepare-ventilation$/, '-create-ventilation'), mapping: { row: 'result.draft' }, instruction: '将prepare返回的draft作为row调用createVentilation。' })
    steps.push({ role: 'optional', when: '用户确认更新通风矩阵行', capabilityId: definition.id.replace(/-prepare-ventilation$/, '-update-ventilation'), mapping: { row: 'result.draft' }, instruction: '保留originalDayAge后将prepare返回的draft作为row调用updateVentilation。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用矩阵写接口。' })
  }
  if (suffix === 'import') steps.push({ role: 'required', when: '导入前', capabilityId: definition.id.replace(/-import$/, '-prepare-import'), instruction: '先校验文件为.xlsx且Base64可解码；Portal后端单次最多1000行，导入成功返回新增条数。' })
  const evidence: AiContract['evidence'] = [
    { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/prevention/plan/program-library/list.vue、app/portal/views/dashboard/product/setting/program-lib/list.vue', kind: 'reference', note: '逐页核对两个菜单入口、权限、按钮可见性、Tab切换、筛选、保存、删除、通风矩阵、导入导出和供应商/物料联动。' },
    { source: 'app/portal/views/dashboard/product/prevention/plan/program-library/program-api.js、program-day-age.js、components/program-inline-table.vue、components/program-ventilation-matrix.vue、app/portal/utils/product/rearing-plan-excel.js', kind: 'reference', note: '核对17个pageKey的字段submit规则、请求参数、日龄/数字/跨字段校验、矩阵请求、重复ID序列化、模板和xlsx导入限制。' },
    { source: 'CodeReview_Mall_Platform_Java erp-module-fm/.../controller/admin/rearingplan/*Controller.java 与 vo/*', kind: 'reference', note: '核对各页面create/update/delete/page/export/import端点、DTO字段、delete-list能力和后端导入上限。' },
    { source: 'src/capabilities/product-program-library.ts 与 test/product-program-library.test.ts', kind: 'implementation', note: '锁定SDK请求、页面规则、权限上下文、返回文件契约和离线反证；不替代真实测试环境浏览器证据。' },
    { source: 'docs/pages/程序库.md', kind: 'reference', note: '记录页面四件套、两个入口、17个子页字段矩阵和外部验证边界。' },
  ]
  return {
    purpose: definition.title,
    whenToUse: `需要在${definition.pagePath}对应的程序库页面执行“${definition.title}”时使用；${suffix === 'list' ? '先tabs再按pageKey逐页查询。' : '按当前pageKey和Portal表单规则调用。'}`,
    effect,
    inputs: inputsFor(definition.id, definition, null),
    output,
    consume: [
      '只把返回的id当作后续更新/删除的记录ID；不要把_display、Name或随机UI字段当作提交字段。',
      '分页接口的total是总条数；空list是合法业务结果。文件返回的base64需要由调用方保存为fileName对应文件。',
      '写入成功只表示Portal接口接受请求；要确认结果，重新调用同pageKey的list并按返回id/关键字段回查。',
    ],
    boundaries: commonBoundaries,
    prerequisites: ['当前会话凭据有效，且用户拥有当前菜单权限。', '写入前已取得tabs中的合法pageKey；涉及投药、消毒或免疫的供应商/物料字段，先加载suppliers/materials并提交实际ID。'],
    steps,
    completion: suffix === 'list' ? '返回严格包含list和total的程序库分页结果；通风额外返回temperatures和矩阵行。' : '请求按Portal页面对应的HTTP方法、路径、查询参数或multipart字段成功完成，并按契约返回结果。',
    failures: ['权限不足、会话失效、后端业务校验失败或网络错误原样抛出；不要把它们当成空列表。', 'pageKey、筛选字段、必填字段、日龄区间、数字范围、数组和长度不符合Portal规则时，SDK在发请求前拒绝。', ...(suffix === 'remove-batch' ? ['不支持批量删除的页面必须逐条调用remove；通风矩阵必须调用专用removeVentilation。'] : [])],
    idempotency: definition.write ? 'Portal没有提供请求幂等键；重复create/import可能重复写入。update按id重放通常覆盖同一记录，remove重复调用由后端决定。' : null,
    evidence,
    gaps: ['已逐页核对两个菜单入口、Portal源码、Java Controller/VO、SDK请求和离线反证测试；尚未在真实测试环境执行17个子页的浏览器读请求、写入回查及prepare→submit→cleanup记录。'],
  }
}

const contracts = Object.fromEntries(allDefinitions.map(definition => [definition.id, contractFor(definition)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`程序库契约没有对应能力定义：${id}`)

export const PRODUCT_PROGRAM_LIBRARY_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_PROGRAM_LIBRARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  allDefinitions.map(definition => {
    const namespace = definition.pagePath === PRODUCT_PROGRAM_LIBRARY_NEW_PAGE_PATH ? 'productProgramLibraryNew' : 'productProgramLibrary'
    const contract = contracts[definition.id]
    if (!contract) throw new Error(`程序库方法契约没有对应能力定义：${definition.id}`)
    return [`${namespace}.${methodsById[definition.id]}`, contract]
  }),
)
