import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_METHOD_LIB_METHODS,
  PRODUCT_SETTING_METHOD_LIB_PAGE_PATH,
  PRODUCT_SETTING_METHOD_LIB_PERMISSION,
  productSettingMethodLibCapabilities,
} from '../capabilities/product-setting-method-lib.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingMethodLibCapabilities.map(definition => [definition.id, definition]))

const rowFields: AiField[] = [
  field('id', 'string', '方法ID；编辑、详情和删除都使用它。'),
  field('methodName', 'string', '方法名称；服务端按名称判重。'),
  field('methodDescription', 'string', '方法描述。'),
  field('methodCategory', 'string', 'rearing_plan_category字典value，不是分类展示名称。'),
  field('methodType', '1 | 2', '方法类型：1=普通方法，2=程序方法。'),
  field('keyPoint', 'boolean', '是否为要点。'),
  field('ruleCount', 'integer', '适用规则数量；程序方法通常为0。'),
  field('rules', 'object[]', '普通方法的适用规则列表；程序方法为空数组。'),
  field('rules[]', 'object', '适用范围和频次规则。'),
  field('rules[].id', 'string', '规则ID；来自服务端时存在。', { optional: true }),
  field('rules[].generation', 'string', '代次编码；空字符串表示全部代次。'),
  field('rules[].variety', 'string', '品种编码；空字符串表示全部品种。'),
  field('rules[].strain', 'string', '品系编码；空字符串表示全部品系。'),
  field('rules[].startDayAge', 'integer | undefined', '开始日龄；缺失时为undefined。', { nullable: true, nullMeaning: '服务端没有返回开始日龄。' }),
  field('rules[].intervalDays', 'integer | undefined', '间隔天数；缺失时为undefined。', { nullable: true, nullMeaning: '服务端没有返回间隔天数。' }),
  field('creatorName', 'string', '创建人展示名称；后端未返回时为空字符串。'),
  field('updateTime', 'string', '更新时间；后端未返回时为空字符串。'),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', 'Portal方法库分页结果；SDK已解包响应并规范方法与规则字段。'),
    field('list', 'array', '当前筛选和分页下的方法记录。'),
    field('list[]', 'object', '方法记录。'),
    ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` })),
    field('total', 'integer', '筛选条件下的方法总数，不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有方法。权限、网络或响应结构错误会抛出，不降级为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [field('$', 'object', '方法详情；字段语义与list[].记录一致。'), ...rowFields],
  empty: '方法不存在、响应缺少详情结构或请求失败时抛出。',
}

const draftFields: AiField[] = [
  field('draft', 'object', '通过Portal表单校验、尚未发送请求的方法草稿。'),
  field('draft.id', 'string', '编辑草稿的方法ID。', { optional: true }),
  field('draft.methodName', 'string', 'trim后的方法名称，长度不超过100。'),
  field('draft.methodDescription', 'string', 'trim后的方法描述，长度不超过2000。'),
  field('draft.methodCategory', 'string', 'rearing_plan_category字典value，长度不超过32。'),
  field('draft.methodType', '1 | 2', '1=普通方法，2=程序方法。'),
  field('draft.keyPoint', 'boolean', '是否为要点。'),
  field('draft.rules', 'object[]', '提交给Java的规则；程序方法固定为空数组。'),
  field('draft.rules[].generation', 'string', '代次编码；空字符串表示全部代次。'),
  field('draft.rules[].variety', 'string', '品种编码；没有代次时必须为空字符串。'),
  field('draft.rules[].strain', 'string', '品系编码；没有代次时必须为空字符串。'),
  field('draft.rules[].startDayAge', 'integer', '1-500的开始日龄；页面上限是500，低于Java接口允许的700。'),
  field('draft.rules[].intervalDays', 'integer', '1-100的间隔天数。'),
]

const fileOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('$', 'object', '下载文件的内存表示。'),
    field('fileName', 'string', '响应文件名；缺失时使用方法库默认文件名。'),
    field('contentType', 'string | null', '响应Content-Type。', { nullable: true, nullMeaning: '服务端没有返回Content-Type。' }),
    field('base64', 'string', '文件二进制的标准Base64内容。'),
    field('byteLength', 'integer', '文件字节数。'),
  ],
  empty: '文件响应为空或不是可读取的二进制时抛出。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const idOutput: AiContract['output'] = {
  shape: 'string',
  fields: [field('$', 'string', '服务端返回的新建方法ID。')],
  empty: '请求成功但没有返回有效方法ID时抛出。',
}

const countOutput: AiContract['output'] = {
  shape: 'integer',
  fields: [field('$', 'integer', 'Portal导入接口返回的成功导入方法数量；Java按方法名称分组计数。')],
  empty: '响应没有有效导入条数或请求失败时抛出。',
}

const commonBoundaries = [
  `页面范围是${PRODUCT_SETTING_METHOD_LIB_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_METHOD_LIB_PERMISSION}；这是系统设置→生产设置下的“方法库-新”，不是旧路径/dashboard/product/setting/hatch-manage/method-lib/list。`,
  '所有请求使用Portal platform HTTP实例，执行admin-api前缀和会话头规则；本页没有module-type推导，不发送module-type。SDK不绕过页面或服务端权限。',
  '列表筛选字段是generation、variety、strain、methodName、methodType；默认pageNo=1、pageSize=10，只支持10、20、50。导出复用相同筛选但不发送分页参数。',
  '方法名称、描述、分类分别按Portal限制必填且最大100、2000、32个字符；methodCategory必须是当前租户rearing_plan_category字典value，SDK不把展示名称猜成value。',
  'methodType=1普通方法必须至少一条规则；每条规则的开始日龄是1-500整数、间隔天数是1-100整数，同一代次/品种/品系和开始日龄不能重复；没有代次时不能指定品种或品系。methodType=2程序方法固定提交空rules。',
  '模板下载是GET /flockSimu/rearingPlan/method/import-template，导出是GET /export-excel且服务端最多处理1000条规则；导入是multipart字段file的POST /import-excel，Portal控件只接受.xlsx，Java最多读取1000行并按方法名称分组返回方法数量。',
  'create/update/delete/import成功或响应不确定后必须list/get回查；返回的ID、true或导入条数只代表请求层结果，不代表业务终态。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/method-lib/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、platform实例、筛选字段、分页、创建/编辑/删除、导入、导出和回查。' },
  { source: 'app/portal/views/dashboard/product/setting/method-lib/components/MethodModalContent.vue、utils.js、app/portal/utils/product/rearing-plan-excel.js、ExcelImportModalContent.vue', kind: 'reference', note: '逐字段核对方法表单、规则动态校验、程序方法空rules、xlsx扩展名、模板和multipart字段。' },
  { source: 'RearingPlanMethodController.java、RearingPlanMethodSaveReqVO.java、RearingPlanMethodPageReqVO.java、RearingPlanMethodRespVO.java、RearingPlanMethodExcelVO.java、RearingPlanMethodServiceImpl.java', kind: 'reference', note: '核对Java端点、字段约束、字典校验、重复规则、导入分组、1000行上限和导出过滤。' },
  { source: 'src/capabilities/product-setting-method-lib.ts 与 test/product-setting-method-lib.test.ts', kind: 'implementation', note: '锁定逐页请求形状、表单/规则/文件边界、platform上下文、AI说明注册以及故意改坏会失败的反证。' },
  { source: 'docs/pages/产品设置方法库-新.md', kind: 'reference', note: '记录页面四件套、逐字段基准、权限和提交顺序。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行方法库列表、创建、编辑、删除、模板下载、导入导出及逐页回查闭环；当前证据为Portal/Java源码与离线请求形状测试。',
  '尚未使用真实租户字典value验证methodCategory和规则代次/品种/品系选项；SDK不会伪造字典候选值，写入前必须使用当前页面的有效value。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-method-lib-', '')
  if (suffix === 'list' || suffix === 'export') return {
    generation: param('代次筛选；省略时不发送。', '方法库列表筛选表单', { type: 'string', required: false }),
    variety: param('品种筛选；省略时不发送。', '方法库列表筛选表单', { type: 'string', required: false }),
    strain: param('品系筛选；省略时不发送。', '方法库列表筛选表单', { type: 'string', required: false }),
    methodName: param('方法名称筛选；SDK发送trim后的值。', '方法库列表筛选表单', { type: 'string', required: false }),
    methodType: param('方法类型筛选：1=普通方法，2=程序方法。', '方法库列表筛选表单', { type: '1 | 2', required: false, options: [{ value: 1, label: '普通方法' }, { value: 2, label: '程序方法' }] }),
    ...(suffix === 'list' ? {
      pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
      pageSize: param('每页条数；只支持10、20、50，默认10。', 'Portal分页状态', { type: '10 | 20 | 50', required: false, default: '10' }),
    } : {}),
  }
  if (suffix === 'prepare-create' || suffix === 'prepare-update') return { form: param('方法表单；名称、描述、分类、类型必填，普通方法传规则，编辑表单还需id。', '用户确认的方法库表单', { type: 'object', required: true }) }
  if (suffix === 'create' || suffix === 'update') return { draft: param('对应prepare方法返回的完整draft；提交前不要改写。', suffix === 'create' ? 'productSettingMethodLib.prepareCreate.result.draft' : 'productSettingMethodLib.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'get' || suffix === 'prepare-remove') return { id: param('方法ID；来自最近一次list结果。', 'productSettingMethodLib.list.result.list[].id', { type: 'string', required: true }) }
  if (suffix === 'remove') return { id: param('prepareRemove返回的方法ID；用户确认后提交。', 'productSettingMethodLib.prepareRemove.result.id', { type: 'string', required: true }) }
  if (suffix === 'import') return {
    fileName: param('xlsx文件名；Portal导入控件只接受.xlsx扩展名。', '用户选择的导入文件', { type: 'string', required: true }),
    base64: param('xlsx文件二进制的标准Base64。', '用户选择的导入文件', { type: 'string', required: true }),
    contentType: param('文件MIME类型；省略时使用xlsx默认值。', '用户选择的导入文件', { type: 'string', required: false }),
  }
  return {}
}

function outputFor (suffix: string): AiContract['output'] {
  if (suffix === 'list') return listOutput
  if (suffix === 'get') return detailOutput
  if (suffix === 'prepare-create' || suffix === 'prepare-update') return { shape: '{ draft: object }', fields: draftFields, empty: '表单、方法类型或规则不满足Portal校验时抛错，且不发送请求。' }
  if (suffix === 'prepare-remove') return { shape: '{ id: string }', fields: [field('id', 'string', '尚未发送删除请求的当前方法ID。')], empty: '方法ID为空时抛错，且不发送删除请求。' }
  if (suffix === 'create') return idOutput
  if (suffix === 'download-template' || suffix === 'export') return fileOutput
  if (suffix === 'import') return countOutput
  return trueOutput
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-method-lib-', '')
  const isRead = ['list', 'get', 'download-template', 'export'].includes(suffix)
  const isPrepare = suffix.startsWith('prepare-')
  const steps: AiContract['steps'] = []
  const prepareTarget = suffix === 'prepare-create' ? 'product-setting-method-lib-create'
    : suffix === 'prepare-update' ? 'product-setting-method-lib-update'
      : suffix === 'prepare-remove' ? 'product-setting-method-lib-remove' : undefined
  if (isPrepare && prepareTarget) {
    const mapping: Record<string, string> = suffix === 'prepare-remove' ? { id: 'result.id' } : { draft: 'result.draft' }
    steps.push({ role: 'required', when: '用户确认提交prepare返回的结果', capabilityId: prepareTarget, mapping, instruction: '把prepare结果原样交给对应写能力；用户取消时只丢弃本地草稿，不发送请求。' })
    steps.push({ role: 'cancel', when: '用户取消当前表单或删除确认', instruction: '只丢弃draft或id，不调用写能力。' })
  }
  if (!isRead && !isPrepare) {
    steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: suffix === 'get' ? undefined : 'product-setting-method-lib-list', instruction: suffix === 'import' ? '重新调用list，核对导入方法数量、名称和规则；导入条数不是业务终态。' : suffix === 'remove' ? '重新调用list确认目标id不再出现。' : '重新调用list或get回查目标方法，确认服务端业务终态；不要只依据true或ID宣布已落库。' })
  }
  const effect: AiContract['effect'] = isRead ? 'read' : isPrepare ? 'prepare' : 'write'
  return {
    purpose: suffix === 'list' ? '按Portal筛选条件分页读取方法库。' : suffix === 'get' ? '读取方法详情和适用规则。' : suffix === 'download-template' ? '下载Portal方法库xlsx导入模板。' : suffix === 'export' ? '按当前筛选条件导出方法库Excel。' : suffix === 'import' ? '按Portal导入控件上传方法库xlsx。' : `执行Portal方法库${suffix}操作。`,
    whenToUse: `需要在${PRODUCT_SETTING_METHOD_LIB_PAGE_PATH}页面执行对应${isRead ? '查询' : isPrepare ? '准备' : '写入'}时使用。`,
    boundaries: commonBoundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有方法库页面权限；methodCategory和规则范围值必须来自当前租户Portal字典。', ...(isPrepare || (!isRead && suffix !== 'download-template') ? ['写操作目标必须来自当前页面最新list/get结果或同一次prepare结果。'] : [])],
    inputs: inputFor(id),
    output: outputFor(suffix),
    consume: isRead ? ['按字段含义消费列表、详情或文件；编辑/删除使用list[].id，不从方法名称猜ID。'] : isPrepare ? ['把draft或id展示/保存为待确认结果；用户取消只丢弃本地结果。'] : ['写请求成功或不确定后按steps回查list/get；ID、true和导入条数不是完整业务终态。'],
    steps,
    completion: isRead ? '获得与Portal页面消费形状一致的结果。' : isPrepare ? '获得尚未改变服务端的本地草稿或删除ID。' : '请求按Portal的URL、HTTP方法、参数、权限上下文和表单规则完成，并按步骤回查业务终态。',
    failures: ['表单、方法类型、规则范围、字典value、分页、文件格式、权限、网络或Java业务错误均抛出；不降级为空结果、不假成功、不自动选择用户未确认的写入动作。'],
    idempotency: isRead || isPrepare ? null : '页面没有统一requestId幂等协议；写请求响应不确定时先list/get回查，再决定是否重试，避免重复创建、导入或删除。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingMethodLibCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置方法库-新契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_METHOD_LIB_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_METHOD_LIB_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_METHOD_LIB_METHODS).map(([id, method]) => [
    `productSettingMethodLib.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingMethodLib.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
