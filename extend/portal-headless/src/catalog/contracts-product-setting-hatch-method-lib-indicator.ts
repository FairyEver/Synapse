import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_METHODS,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PAGE_PATH,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PERMISSION,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_SUBMIT_PERMISSION,
  productSettingHatchMethodLibIndicatorCapabilities,
} from '../capabilities/product-setting-hatch-method-lib-indicator.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingHatchMethodLibIndicatorCapabilities.map(definition => [definition.id, definition]))

const rowFields: AiField[] = [
  field('list[].id', 'string | number | null', '方法指标记录ID；编辑和删除使用此ID。', { nullable: true, nullMeaning: '响应没有可操作的指标ID。' }),
  field('list[].suiteCode', 'string | null', '所属方法库预案业务编码；列表查询和写后回查使用。', { nullable: true, nullMeaning: '响应没有所属预案编码。' }),
  field('list[].traitType', 'string | number | null', '方法归类字典值；来自Portal的method_class字典。', { nullable: true, nullMeaning: '后端没有返回方法归类值。' }),
  field('list[].traitTypeName', 'string | null', '方法归类展示名称。', { nullable: true, nullMeaning: '后端没有返回展示名称。' }),
  field('list[].traitCode', 'string | null', '方法名称编码；动态方法名称选项的value，也是Java写入的code。', { nullable: true, nullMeaning: '后端没有返回方法编码。' }),
  field('list[].traitName', 'string | null', '方法名称展示文本。', { nullable: true, nullMeaning: '后端没有返回方法名称。' }),
  field('list[].title1', 'string | null', '方法一级标题；由方法名称选项带回并展示。', { nullable: true, nullMeaning: '该级标题为空或后端未返回。' }),
  field('list[].title2', 'string | null', '方法二级标题。', { nullable: true, nullMeaning: '该级标题为空或后端未返回。' }),
  field('list[].title3', 'string | null', '方法三级标题。', { nullable: true, nullMeaning: '该级标题为空或后端未返回。' }),
  field('list[].age', 'integer | null', '方法指标日龄；旧版Java ProgramNewStandardLibTraitDTO和Portal都使用该字段。', { nullable: true, nullMeaning: '后端没有返回日龄。' }),
  field('list[].ageType', 'integer | null', '日龄类型；Java查询固定为1，页面不单独编辑。', { nullable: true, nullMeaning: '列表响应没有返回日龄类型。' }),
  field('list[].contentType', 'integer | null', '方法内容类型；由动态方法名称选项补齐并随表单发送。', { nullable: true, nullMeaning: '动态选项或后端未返回内容类型。' }),
  field('list[].contentTypeName', 'string | null', '内容类型展示名称。', { nullable: true, nullMeaning: '后端没有返回内容类型名称。' }),
  field('list[].scale', 'integer | null', 'Java返回的数值精度字段；当前Portal表单不展示。', { nullable: true, nullMeaning: '后端没有返回精度。' }),
  field('list[].unit', 'string | null', '方法指标单位；原值返回，不做换算。', { nullable: true, nullMeaning: '该方法没有单位或后端未返回。' }),
  field('list[].min', 'number | null', 'Java返回的最小值；当前Portal表单不展示。', { nullable: true, nullMeaning: '没有最小值。' }),
  field('list[].max', 'number | null', 'Java返回的最大值；当前Portal表单不展示。', { nullable: true, nullMeaning: '没有最大值。' }),
  field('list[].txt', 'string | null', '方法内容文本；编辑时可修改。', { nullable: true, nullMeaning: '后端没有返回方法内容。' }),
  field('list[].flag', 'integer | null', '后端保留的覆盖标记；当前列表页面不使用。', { nullable: true, nullMeaning: '列表查询未返回该字段。' }),
]

const optionOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('$', 'array', '按方法归类查询得到的Portal方法名称候选数组。'),
    field('[]', 'object', '方法名称候选；保留后端字段并补齐Portal下拉需要的label/value。'),
    field('[].code', 'string', '方法名称编码；作为traitCode提交。'),
    field('[].name', 'string', '方法名称展示文本；作为label展示。'),
    field('[].label', 'string', 'Portal下拉展示值，等于name。'),
    field('[].value', 'string', 'Portal下拉提交值，等于code。'),
    field('[].contentType', 'integer | null', '方法内容类型；新建/编辑表单回填。', { nullable: true, nullMeaning: '后端没有返回内容类型。' }),
    field('[].title1', 'string | null', '选择方法后回填的一级标题。', { nullable: true, nullMeaning: '该级标题为空。' }),
    field('[].title2', 'string | null', '选择方法后回填的二级标题。', { nullable: true, nullMeaning: '该级标题为空。' }),
    field('[].title3', 'string | null', '选择方法后回填的三级标题。', { nullable: true, nullMeaning: '该级标题为空。' }),
  ],
  empty: '没有方法归类时Portal本地返回[]且不发请求；有归类但后端返回空数组表示没有可选方法。响应错误或结构错误会抛出，不伪造选项。',
}

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [field('$', 'object', '旧版方法库指标分页结果；SDK已解包Portal响应。'), ...rowFields, field('total', 'integer', '当前suiteCode和筛选条件下的结果总数，不是当前页长度。')],
  empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录。权限、网络或响应结构错误会抛出，不降级为空列表。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: '权限、网络、参数或Java业务错误会抛出；true不等于业务终态已回查确认。',
}

const createOutput: AiContract['output'] = {
  shape: '{ status: "submitted" | "conflict", flag?: 1 }',
  fields: [
    field('status', '"submitted" | "conflict"', 'submitted表示本次JSON请求未抛错；conflict表示首次请求返回flag=1，必须等待用户确认后再覆盖提交。'),
    field('flag', '1', '冲突标记；固定为1，不是用户可自由填写的业务值。', { optional: true, values: { '1': '同一suiteCode下该方法和日龄已存在，需要确认覆盖' } }),
  ],
  empty: '响应不是可识别的Portal成功/冲突包络或请求失败时抛出；不会自动覆盖。',
}

const fileOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('$', 'object', '导出文件的内存表示。'),
    field('fileName', 'string', '响应文件名；缺失时为方法库方法.xlsx。'),
    field('contentType', 'string | null', '响应Content-Type。', { nullable: true, nullMeaning: '服务端没有返回Content-Type。' }),
    field('base64', 'string', '导出二进制的标准Base64内容。'),
    field('byteLength', 'integer', '导出文件字节数。'),
  ],
  empty: '响应为空或不是可读取的二进制文件时抛出。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PAGE_PATH}，由${PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PERMISSION}父方法库页面的“查看方法”进入；页面动作权限分别是${PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_QUERY_PERMISSION}、${PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_SUBMIT_PERMISSION}、${PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_DELETE_PERMISSION}。SDK不绕过权限。`,
  '页面使用product HTTP实例；页面没有module-type规则命中，SDK不发送module-type。product实例的baseUrl必须由调用方显式配置为与Portal VITE_FM_API一致的地址；当前Portal test env为https://fmtest.zhihuidanji.com/flockSimu，SDK离线夹具使用的测试后端地址为https://biz-api-test.wodecorp.cn/flockSimu，二者都保留/flockSimu前缀。',
  '方法名称选项只在traitType有值时调用/programUnit/getTraitList，并固定searchType=2；traitType来自Portal的method_class字典实际value，不在本能力中伪造完整枚举。',
  '列表固定发送scope=1、age默认1、pageNo默认1和pageSize默认20；导出复用筛选条件但不发送分页参数。suiteCode来自父方法库列表行或路由query。',
  '指标页新建/编辑是JSON请求，不是父方法库导入页的multipart FormData；父页面的/importMethodLib三选一冲突流程不属于本隐藏页面。',
  '新建首次发送flag=0；Java返回flag=1时只返回conflict，用户明确确认后同一草稿再次发送flag=1。取消时不发送第二次请求。',
  '旧版Portal和Java ProgramNewStandardLibTraitDTO都使用age；不要把旧版age改名为孵化新版的hour。',
  '编辑按Portal发送页面字段和flag=1；suiteCode只保留在SDK草稿中用于回查，不发送到editTrait。删除是GET /deleteTrait?id=...，导出是GET /exportMethodLib并返回二进制。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/views/dashboard/product/setting/hatch-manage/method-lib/indicator/list.vue、.../indicator/modal-form-content.vue', kind: 'reference', note: '核对旧版隐藏路由、/programNew/methodLib端点、method_class字典分支、权限码、查询字段、JSON写入、冲突和导出。' },
  { source: 'app/portal/views/dashboard/product/setting/hatch-manage/list.vue、.../method-lib/list.vue', kind: 'reference', note: '核对父权限、查看方法跳转和suiteCode来源；页面实际使用的父路径是breeding-plan。' },
  { source: 'app/portal/utils/http/product.js、erp-module-fm/.../programNew/MethodLibController.java、ProgramNewStandardLibTraitDTO.java、ProgramNewServiceImpl.java、ProgramLibMapper.xml', kind: 'reference', note: '核对product baseURL、flockSimu/programNew服务端路径、age/ageType/trait字段、分页包络、flag冲突及导出要求。' },
  { source: 'src/capabilities/product-setting-hatch-method-lib-indicator.ts、test/product-setting-hatch-method-lib-indicator.test.ts', kind: 'implementation', note: '锁定SDK请求形状、响应规范化、参数校验、冲突二阶段、文件返回和反证；不替代真实环境证据。' },
  { source: 'docs/pages/方法库指标-生产设置.md', kind: 'reference', note: '记录旧版隐藏页面四件套、与孵化新版的差异和验证边界。' },
]

const gaps = [
  '未执行浏览器基准或真实测试环境冒烟；当前证据来自当前只读源码锚点acab69acc7/0f1a55718eb与离线夹具。',
  '未在线独立验证写入后的数据库/列表终态；SDK写请求成功只代表响应未抛错，调用方必须回查。',
  'method_class字典的全部取值未在SDK内静态登记；调用方必须使用Portal字典实际value。',
  '导出未做真实文件流验证；SDK只验证离线二进制响应并返回内存文件。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-hatch-method-lib-indicator-', '')
  if (suffix === 'trait-code-options') return {
    traitType: param('方法归类字典值；不是中文展示名，必须来自Portal的method_class下拉实际value。省略时本地返回空数组。', '用户选择或页面字典项.value', { type: 'string | number', required: false }),
  }
  if (suffix === 'list' || suffix === 'export') return {
    traitType: param('方法归类筛选值；省略时发送空字符串。', '页面方法归类筛选表单', { type: 'string | number', required: false, default: '' }),
    traitCode: param('方法名称编码；应来自traitCodeOptions.result[].value，省略时发送空字符串。', '页面方法名称筛选表单或traitCodeOptions.result[].value', { type: 'string', required: false, default: '' }),
    age: param('页面日龄筛选；Portal默认1，原值发送。', '页面日龄筛选表单', { type: 'integer', required: false, default: '1', constraints: ['SDK要求正整数；页面输入控件最小值为1。'] }),
    suiteCode: param('父方法库预案业务编码；必须来自父方法库列表的list[].suiteCode，缺省时发送空字符串。', 'productSettingHatchMethodLib.list.result.list[].suiteCode 或路由query.suiteCode', { type: 'string', required: false, default: '' }),
    ...(suffix === 'list' ? { pageNo: param('从1开始的页码。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }), pageSize: param('每页条数；只接受Portal支持的10、20、50、100。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }) } : {}),
  }
  if (suffix === 'prepare-create') return { form: param('新建方法指标表单；traitType、traitCode、age和txt必填，标题/contentType通常由动态方法名称选项回填，suiteCode来自父列表行。', '用户填写的页面表单 + traitCodeOptions.result[] + 父方法库列表行', { type: 'object', required: true, constraints: ['txt去除首尾空白后不能为空，原始长度不得超过3000。', 'age必须为正整数。'] }) }
  if (suffix === 'create') return {
    draft: param('prepareCreate返回的同一份方法指标草稿；冲突后不能改写。', 'productSettingHatchMethodLibIndicator.prepareCreate.result.draft', { type: 'object', required: true }),
    flag: param('仅二次覆盖提交使用1；首次调用省略，SDK实际发送0。', '用户在Portal“数据已存在，是否覆盖？”提示中的明确确认', { type: '1', required: false, options: [{ value: 1, label: '覆盖' }] }),
  }
  if (suffix === 'prepare-update') return { form: param('当前列表行的编辑表单；id、traitType、traitCode、age和txt必填，suiteCode仅供写后回查。', 'productSettingHatchMethodLibIndicator.list.result.list[] + 用户修改的方法内容', { type: 'object', required: true }) }
  if (suffix === 'update') return { draft: param('prepareUpdate返回的同一份编辑草稿；suiteCode是回查上下文，不进入请求体。', 'productSettingHatchMethodLibIndicator.prepareUpdate.result.draft', { type: 'object', required: true }) }
  if (suffix === 'prepare-remove') return { form: param('当前指标列表行的id；可附带suiteCode用于回查。', 'productSettingHatchMethodLibIndicator.list.result.list[]', { type: 'object', required: true }) }
  if (suffix === 'remove') return { draft: param('prepareRemove返回的删除草稿；确认前不得调用删除。', 'productSettingHatchMethodLibIndicator.prepareRemove.result.draft', { type: 'object', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-hatch-method-lib-indicator-', '')
  const isOptions = suffix === 'trait-code-options'
  const isList = suffix === 'list'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const isExport = suffix === 'export'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认新建草稿', capabilityId: 'product-setting-hatch-method-lib-indicator-create', mapping: { draft: 'result.draft' }, instruction: '首次调用create时省略flag；若返回conflict，向用户询问是否覆盖。' })
    steps.push({ role: 'cancel', when: '用户取消新建或拒绝覆盖', instruction: '只丢弃本地draft，不调用create。' })
  }
  if (isCreate) {
    steps.push({ role: 'required', when: '首次返回status=conflict', capabilityId: 'product-setting-hatch-method-lib-indicator-create', mapping: { draft: 'args.draft', flag: 'literal:1' }, instruction: '只有用户明确确认覆盖，才把同一draft再次交给create并传flag=1；不要自动覆盖。' })
    steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-method-lib-indicator-list', mapping: { suiteCode: 'context.suiteCode' }, instruction: '从同一draft.suiteCode或当前路由上下文取得suiteCode，按traitCode和age重新查询，核对记录是否出现；请求受理不等于业务记录已确认。' })
    steps.push({ role: 'cancel', when: '用户取消覆盖确认', instruction: '只丢弃draft，不发送flag=1的第二次请求。' })
  }
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认编辑草稿', capabilityId: 'product-setting-hatch-method-lib-indicator-update', mapping: { draft: 'result.draft' }, instruction: '把同一draft交给update；不要把suiteCode手工追加进editTrait请求体。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃本地draft，不调用update。' })
  }
  if (isUpdate) steps.push({ role: 'required', when: '编辑请求成功或响应不确定且draft.suiteCode存在', capabilityId: 'product-setting-hatch-method-lib-indicator-list', mapping: { suiteCode: 'context.suiteCode' }, instruction: '从draft.suiteCode或当前路由上下文取得suiteCode，并从draft读取traitCode和age作为筛选条件，重新查询核对方法内容；不要只把true当成业务终态。' })
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前指标', capabilityId: 'product-setting-hatch-method-lib-indicator-remove', mapping: { draft: 'result.draft' }, instruction: '只把prepareRemove返回的draft交给remove。' })
    steps.push({ role: 'cancel', when: '用户取消删除确认', instruction: '只丢弃本地draft，不调用remove。' })
  }
  if (isRemove) steps.push({ role: 'required', when: '删除请求成功或响应不确定且draft.suiteCode存在', capabilityId: 'product-setting-hatch-method-lib-indicator-list', mapping: { suiteCode: 'context.suiteCode' }, instruction: '从draft.suiteCode或当前路由上下文取得suiteCode，重新查询并确认同一id不再出现；不要把GET请求受理当成删除已核实。' })

  const draftFields: AiField[] = [
    field('draft', 'object', '经过页面表单校验、尚未发送到服务端的本地草稿。'),
    field('draft.traitType', 'string | number', '方法归类值。'),
    field('draft.traitCode', 'string', '方法名称编码。'),
    field('draft.contentType', 'integer | null', '方法内容类型；来自动态选项。', { nullable: true, nullMeaning: '未返回内容类型。' }),
    field('draft.title1', 'string | null', '一级标题。', { nullable: true, nullMeaning: '标题为空。' }),
    field('draft.title2', 'string | null', '二级标题。', { nullable: true, nullMeaning: '标题为空。' }),
    field('draft.title3', 'string | null', '三级标题。', { nullable: true, nullMeaning: '标题为空。' }),
    field('draft.age', 'integer', '页面日龄。'),
    field('draft.txt', 'string', '方法内容。'),
  ]
  if (isPrepareCreate) draftFields.push(field('draft.suiteCode', 'string', '父方法库业务编码；新建请求发送此字段。'))
  if (isPrepareUpdate) {
    draftFields.push(field('draft.id', 'string | number', '待编辑的方法指标ID。'))
    draftFields.push(field('draft.suiteCode', 'string | null', '仅供写后回查，不发送到editTrait。', { nullable: true, nullMeaning: '调用方未提供回查上下文。' }))
  }
  const prepareOutput: AiContract['output'] = { shape: '{ draft: object }', fields: draftFields, empty: '校验失败时抛出且不发请求；prepare不会改变服务端。' }
  const removePrepareOutput: AiContract['output'] = {
    shape: '{ draft: object }',
    fields: [field('draft', 'object', '经过ID校验、尚未发送删除请求的本地草稿。'), field('draft.id', 'string | number', '待删除的方法指标ID。'), field('draft.suiteCode', 'string | null', '仅供删除后回查的父方法库编码。', { nullable: true, nullMeaning: '调用方未提供回查上下文。' })],
    empty: 'id为空或非法时抛出且不发请求；prepare不会改变服务端。',
  }
  const output = isOptions ? optionOutput : isList ? listOutput : isPrepareCreate || isPrepareUpdate ? prepareOutput : isPrepareRemove ? removePrepareOutput : isCreate ? createOutput : isExport ? fileOutput : trueOutput
  const purpose = isOptions ? '按方法归类查询旧版方法库可选的方法名称及表单回填元数据。' : isList ? '按父方法库预案、方法归类、方法名称和日龄分页查询旧版方法库指标。' : isPrepareCreate ? '按Portal新建表单规则准备一个尚未写入的方法库指标草稿。' : isCreate ? '按Portal冲突二阶段规则新建或覆盖一个方法库指标。' : isPrepareUpdate ? '按Portal编辑表单规则准备一个尚未写入的方法库指标草稿。' : isUpdate ? '按Portal JSON请求编辑方法库指标内容。' : isPrepareRemove ? '准备一个经过用户确认的方法库指标删除草稿。' : isRemove ? '按Portal GET接口删除一个方法库指标。' : '按Portal筛选条件导出方法库方法文件。'
  const effect: AiContract['effect'] = isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : isCreate || isUpdate || isRemove ? 'write' : 'read'
  return {
    purpose,
    whenToUse: `当用户要在${PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PAGE_PATH}执行对应的${isOptions || isList ? '查询' : isExport ? '导出' : '方法指标操作'}时使用；它只服务于从养殖预案父方法库行进入的旧版场景。`,
    boundaries: commonBoundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的Portal会话；调用方必须有父方法库页面权限和本动作所需的indicator权限。', ...(isList || isCreate || isUpdate || isRemove || isExport ? ['suiteCode应来自父方法库最近一次列表或路由query，不能从品种/代次/名称自行拼接。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isOptions ? ['把value作为traitCode提交，把label展示给用户；选择后把contentType和title1/title2/title3回填到表单。'] : isList ? ['用list[].id进入编辑或删除；用list[].traitCode、age和suiteCode做写后回查。'] : isPrepareCreate ? ['把draft展示给用户，确认后首次create省略flag；取消只丢弃draft。'] : isCreate ? ['submitted只表示请求未抛错；conflict必须由用户明确确认后再传flag=1，随后list回查。'] : isPrepareUpdate ? ['把draft展示给用户，确认后原样交给update；取消不发请求。'] : isUpdate ? ['true只表示请求未抛错；按suiteCode、traitCode和age回查最终内容。'] : isPrepareRemove ? ['确认前只保存draft；取消不发删除请求。'] : isRemove ? ['删除后按suiteCode回查并确认目标id消失。'] : ['将base64按fileName保存；不要把文件内容当作指标记录。'],
    steps,
    completion: isOptions ? '获得与Portal方法名称下拉一致的候选和标题元数据。' : isList ? '获得当前页list和筛选结果total。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : isExport ? '获得可保存的方法库方法文件。' : '请求未抛错，并在后续list回查确认业务记录终态。',
    failures: ['权限拒绝、网络错误、Java参数/业务错误或响应结构不符合预期均抛出；不能把失败降级为空列表或true。', ...(isCreate ? ['首次返回flag=1只表示冲突；没有用户确认不得发送第二次flag=1请求。'] : [])],
    idempotency: isOptions || isList || isPrepareCreate || isPrepareUpdate || isPrepareRemove || isExport ? null : '页面没有requestId幂等协议；写请求响应不确定时先按suiteCode、traitCode、age或id回查，再决定是否重试，避免重复创建/覆盖。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingHatchMethodLibIndicatorCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`生产设置方法库指标契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_METHODS).map(([id, method]) => [
    `productSettingHatchMethodLibIndicator.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingHatchMethodLibIndicator.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
