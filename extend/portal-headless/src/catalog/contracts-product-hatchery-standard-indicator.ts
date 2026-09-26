import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_HATCHERY_STANDARD_INDICATOR_DELETE_PERMISSION,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_PERMISSION,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_QUERY_PERMISSION,
  PRODUCT_HATCHERY_STANDARD_INDICATOR_SUBMIT_PERMISSION,
  productHatcheryStandardIndicatorCapabilities,
} from '../capabilities/product-hatchery-standard-indicator.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productHatcheryStandardIndicatorCapabilities.map(definition => [definition.id, definition]))

const traitOptionsOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '按当前指标归类返回的指标名称候选；SDK保留ProgramUnit原始扩展字段并补齐Portal下拉字段。'),
    field('[].label', 'string | null', 'Portal指标名称下拉展示文本，来自ProgramUnit.name。', { nullable: true, nullMeaning: '后端没有返回指标名称。' }),
    field('[].value', 'string', 'Portal指标名称下拉提交值，来自ProgramUnit.code；不能用label代替。'),
    field('[].contentType', 'integer | null', '选中指标后用于决定文本、富文本或数值表单；1文本、2富文本、3数值。', { nullable: true, values: { '1': '文本', '2': '富文本', '3': '数值' } }),
    field('[].unit', 'string | null', '选中指标的单位；Portal回填到编辑/新建弹窗。', { nullable: true, nullMeaning: '指标没有单位。' }),
    field('[].scale', 'integer | null', '选中指标的小数位数；Portal回填到数值表单。', { nullable: true, nullMeaning: '指标没有小数位数。' }),
  ],
  empty: '[]表示该指标归类下没有候选；缺少traitType、权限、网络或响应字段错误会抛出，不伪造候选。',
}

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', 'Portal product响应解包后的标准指标分页结果。'),
    field('list', 'array', '当前标准库、指标归类、指标名称、日龄和分页条件下的当前页记录。'),
    field('list[]', 'object', '标准指标记录；保留Java返回的扩展字段，并规范页面编辑/删除需要的字段。'),
    field('list[].id', 'string | null', '标准指标记录ID；编辑和删除的目标标识。', { nullable: true, nullMeaning: '后端没有返回ID，不能安全执行编辑或删除。' }),
    field('list[].suiteCode', 'string | null', '来源标准库业务编码；当前隐藏页查询和导出使用的标准库范围。', { nullable: true, nullMeaning: '后端没有返回标准库编码。' }),
    field('list[].traitCode', 'string | null', '指标编码；进入动态候选和创建时作为traitCode。', { nullable: true, nullMeaning: '后端没有返回指标编码。' }),
    field('list[].traitName', 'string | null', '指标名称展示文本。', { nullable: true, nullMeaning: '后端没有返回指标名称。' }),
    field('list[].traitType', 'string | number | null', '指标归类字典值；展示归类或作为后续筛选输入。', { nullable: true, nullMeaning: '后端没有返回归类值。' }),
    field('list[].traitTypeName', 'string | null', 'Java按指标归类值翻译后的展示文本。', { nullable: true, nullMeaning: '后端没有返回归类标签。' }),
    field('list[].age', 'integer | null', '标准生效日龄；编辑时页面不允许修改日龄。', { nullable: true, nullMeaning: '后端没有返回日龄。' }),
    field('list[].ageType', 'integer | null', '日龄类型；Java查询固定为1，页面不让用户选择。', { nullable: true, nullMeaning: '后端没有返回日龄类型。' }),
    field('list[].contentType', 'integer | null', '内容类型；1文本、2富文本、3数值。', { nullable: true, values: { '1': '文本', '2': '富文本', '3': '数值' } }),
    field('list[].contentTypeName', 'string | null', 'Java翻译后的内容类型标签。', { nullable: true, nullMeaning: '后端没有返回内容类型标签。' }),
    field('list[].scale', 'integer | null', '数值指标的小数位数；来源指标定义。', { nullable: true, nullMeaning: '非数值指标或后端没有返回。' }),
    field('list[].unit', 'string | null', '指标单位。', { nullable: true, nullMeaning: '指标没有单位。' }),
    field('list[].min', 'number | null', '数值标准下限；固定值时通常与max相同。', { nullable: true, nullMeaning: '文本标准没有数值下限。' }),
    field('list[].max', 'number | null', '数值标准上限。', { nullable: true, nullMeaning: '文本标准没有数值上限。' }),
    field('list[].txt', 'string | null', '页面展示和提交的标准内容；数值标准仍保留Java生成的文本。', { nullable: true, nullMeaning: '后端没有返回标准内容。' }),
    field('list[].flag', 'integer | null', 'Java扩展字段；当前隐藏页列表不据此判断写入成功。', { nullable: true, nullMeaning: '列表响应没有返回覆盖标记。' }),
    field('total', 'integer', '符合筛选条件的标准指标总数，不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页没有记录；total=0表示筛选范围没有记录。权限、网络或分页响应结构错误会抛出，不降级为空列表。',
}

const draftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '通过Portal指标弹窗校验、尚未发送请求的标准指标草稿。'),
    field('draft.id', 'string | undefined', '标准指标记录ID；新建时为undefined，编辑时来自list[].id。', { optional: true, nullMeaning: '新建没有已有记录ID；不是null。' }),
    field('draft.suiteCode', 'string', '来源标准库业务编码；来自列表页进入隐藏指标页的路由query。'),
    field('draft.traitType', 'string | number', '指标归类字典值；来自standard_class字典或当前记录。'),
    field('draft.traitCode', 'string', '指标编码；来自trait-options[].value。'),
    field('draft.contentType', 'integer', '内容类型；1文本、2富文本、3数值。', { values: { '1': '文本', '2': '富文本', '3': '数值' } }),
    field('draft.unit', 'string', '指标单位；来自动态指标候选或当前记录。'),
    field('draft.scale', 'number | null', '指标小数位数；来自动态指标候选或当前记录。', { nullable: true, nullMeaning: '后端没有提供小数位。' }),
    field('draft.age', 'integer', '标准日龄，范围1至700。'),
    field('draft.min', 'number | undefined', '数值型标准下限；只有contentType=3时提交。', { optional: true, nullMeaning: '非数值型不提交该字段。' }),
    field('draft.max', 'number | undefined', '数值型标准上限；只有contentType=3时提交。', { optional: true, nullMeaning: '非数值型不提交该字段。' }),
    field('draft.txt', 'string', '标准内容；Portal富文本编辑器提交前已转换为txt。'),
    field('draft.flag', 'integer', '编辑草稿固定为1，表示按Portal编辑动作提交；新建draft不带此字段。', { optional: true, values: { '1': '覆盖/编辑提交' } }),
  ],
  empty: '表单校验失败时抛出且不发送请求；取消只丢弃draft。',
}

const removeOutput: AiContract['output'] = {
  shape: '{ id: string }',
  fields: [field('id', 'string', '待用户确认后删除的标准指标记录ID；来自list[].id。')],
  empty: 'ID为空时抛出且不发送删除请求。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的标准指标记录。')],
  empty: '权限、网络或Java业务错误会抛出；true不等于已通过回查确认业务终态。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string | null, base64: string, byteLength: integer }',
  fields: [
    field('fileName', 'string', '响应Content-Disposition中的文件名；缺失时为标准库标准.xlsx。'),
    field('contentType', 'string | null', '响应Content-Type。', { nullable: true, nullMeaning: '响应没有Content-Type。' }),
    field('base64', 'string', '导出Excel二进制的标准Base64；调用方保存为fileName，不当作业务字段解析。'),
    field('byteLength', 'integer', '导出文件二进制字节数；必须大于0。'),
  ],
  empty: '响应为空文件、权限错误、网络错误或文件头解析失败时抛出。',
}

const commonBoundaries = [
  `这是从${PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH}进入的隐藏页，不是菜单独立节点；入口菜单权限为${PRODUCT_HATCHERY_STANDARD_INDICATOR_PERMISSION}。`,
  `查询按钮需要${PRODUCT_HATCHERY_STANDARD_INDICATOR_QUERY_PERMISSION}，新建/编辑需要${PRODUCT_HATCHERY_STANDARD_INDICATOR_SUBMIT_PERMISSION}，删除需要${PRODUCT_HATCHERY_STANDARD_INDICATOR_DELETE_PERMISSION}；SDK不绕过Portal或服务端权限。`,
  '列表、动态指标候选、JSON写请求和导出都按页面实际使用的product实例请求；页面没有可推导的module-type，因此不发送该请求头。',
  '指标归类候选不是本页独立接口，而是Portal平台字典standard_class；需要候选时使用已有base-dict-get，不凭印象写死字典标签。',
  'Portal列表固定发送order=""、orderField=""、scope=1，并使用pageNo/pageSize；省略筛选字段时SDK保留页面的空字符串/undefined形状。',
  '写请求没有requestId幂等包装；响应不确定时先按步骤list回查，再决定是否重试。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/hatchery-manage/lib.vue、hatchery-manage/lib/list.vue', kind: 'reference', note: '证明孵化预案标准库菜单/包装路由权限，以及入口列表通过复用组件到达隐藏指标页。' },
  { source: 'app/portal/views/dashboard/product/setting/hatch-manage/lib/list.vue、lib/indicator/list.vue、lib/indicator/modal-form-content.vue', kind: 'reference', note: '核对隐藏页路径、product实例、路由query、筛选字段、按钮权限、动态候选、JSON字段、冲突覆盖、删除和导出请求。' },
  { source: 'app/portal/utils/http/product.js、app/portal/utils/system.js', kind: 'reference', note: '核对product响应解包、会话请求和页面权限/平台字典来源；本节点没有提取凭据或启动浏览器。' },
  { source: 'erp-module-fm/.../program/programNew/StandardLibController.java、ProgramNewStandardLibTraitDTO.java、ProgramNewStandardLibTraitVO.java', kind: 'reference', note: '核对getTraitPage/createTrait/editTrait/deleteTrait/exportStandardLib端点、age范围、ageType/searchType固定值和导出只按suiteCode。' },
  { source: 'erp-module-fm/.../ProgramNewServiceImpl.java、ProgramLibMapper.xml、ProgramUnitLayController.java、ProgramUnitMapper.xml', kind: 'reference', note: '核对指标查询字段、内容类型/归类翻译、动态指标候选classification参数、软删除和min/max/txt处理。' },
  { source: 'src/capabilities/product-hatchery-standard-indicator.ts 与 test/product-hatchery-standard-indicator.test.ts', kind: 'implementation', note: '锁定SDK最终返回、请求形状、权限上下文和离线反证；不替代真实环境写入验证。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行动态候选、列表、新建冲突二阶段、编辑、删除、导出以及写后回查闭环；当前证据为Portal/Java源码和离线请求形状测试。',
  'standard_class的当前租户候选标签未在真实请求中复测；契约只要求调用base-dict-get读取当前值，不静态猜测标签。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-hatchery-standard-indicator-', '')
  if (suffix === 'trait-options') return {
    traitType: param('指标归类字典值；用于限制指标名称候选。', 'base-dict-get(dictType="standard_class").result.entries[].value', { type: 'string | number', required: true, lookup: { capabilityId: 'base-dict-get', args: { dictType: 'standard_class' }, valueField: 'entries[].value', labelField: 'entries[].label' } }),
  }
  if (suffix === 'list') return {
    traitType: param('指标归类字典值；Portal正常加载时取standard_class首项，SDK发送为traitType。', 'base-dict-get(dictType="standard_class").result.entries[].value', { type: 'string | number', required: false, lookup: { capabilityId: 'base-dict-get', args: { dictType: 'standard_class' }, valueField: 'entries[].value', labelField: 'entries[].label' } }),
    traitCode: param('指标编码筛选；来自trait-options[].value，省略时发送空字符串。', 'productHatcheryStandardIndicator.traitOptions.result[].value', { type: 'string', required: false, default: '空字符串' }),
    age: param('标准日龄筛选；省略时不按日龄筛选。', '用户当前筛选表单', { type: 'integer', required: false, nullable: true, nullMeaning: '不按日龄筛选', constraints: ['SDK和Java页面接口要求1至700；非法值在本地抛错。'] }),
    suiteCode: param('来源标准库业务编码；来自标准库列表行或当前隐藏页路由query。', '产品设置标准库list[].suiteCode或路由query.suiteCode', { type: 'string', required: false, default: '空字符串' }),
    pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-create' || suffix === 'prepare-update') return { form: param('Portal指标弹窗提交表单；指标归类、指标编码、文本类型、日龄和标准内容必填，数值型还需min/max且min不大于max。', '用户确认的指标弹窗提交对象；traitCode、unit、scale来自trait-options或当前列表行', { type: 'object', required: true }) }
  if (suffix === 'create') return {
    draft: param('prepareCreate返回的标准指标草稿；确认后原样提交。', 'productHatcheryStandardIndicator.prepareCreate.result.draft', { type: 'object', required: true }),
    'draft.suiteCode': param('新建草稿中的标准库业务编码；用于写后按同一标准库回查。', 'productHatcheryStandardIndicator.prepareCreate.result.draft.suiteCode', { type: 'string', required: true }),
    flag: param('冲突处理标记；首次省略或传0，收到conflict后只能由用户明确确认覆盖并传1。', 'Java createTrait返回的flag或用户确认', { type: '0 | 1', required: false, default: '0' }),
  }
  if (suffix === 'update') return {
    draft: param('prepareUpdate返回的标准指标草稿；包含已有记录id和flag=1。', 'productHatcheryStandardIndicator.prepareUpdate.result.draft', { type: 'object', required: true }),
    'draft.suiteCode': param('编辑草稿中的标准库业务编码；用于写后按同一标准库回查。', 'productHatcheryStandardIndicator.prepareUpdate.result.draft.suiteCode', { type: 'string', required: true }),
  }
  if (suffix === 'prepare-remove' || suffix === 'remove') return { id: param('标准指标记录ID；不能用指标名称、编码或suiteCode代替。', 'productHatcheryStandardIndicator.list.result.list[].id', { type: 'string', required: true }) }
  if (suffix === 'export') return {
    suiteCode: param('来源标准库业务编码；后端导出接口按此标识标准库。', '产品设置标准库list[].suiteCode或当前隐藏页路由query.suiteCode', { type: 'string', required: true }),
    traitType: param('当前指标归类筛选；按页面原样带出，后端当前导出Controller不使用它。', 'base-dict-get(dictType="standard_class").result.entries[].value', { type: 'string | number', required: false }),
    traitCode: param('当前指标名称筛选；按页面原样带出，后端当前导出Controller不使用它。', 'trait-options[].value', { type: 'string', required: false }),
    age: param('当前日龄筛选；按页面原样带出，后端当前导出Controller不使用它。', '当前列表筛选表单', { type: 'integer', required: false, nullable: true, nullMeaning: '不按日龄筛选' }),
  }
  return {}
}

function outputFor (suffix: string): AiContract['output'] {
  if (suffix === 'trait-options') return traitOptionsOutput
  if (suffix === 'list') return listOutput
  if (suffix === 'prepare-create' || suffix === 'prepare-update') return draftOutput
  if (suffix === 'prepare-remove') return removeOutput
  if (suffix === 'export') return fileOutput
  if (suffix === 'create') return { shape: '{ status: "submitted" } | { status: "conflict", flag: 1 }', fields: [field('status', 'string', 'submitted表示本次请求完成；conflict表示Java检测到同日龄同指标已存在，需要用户确认后再次提交。', { values: { submitted: '请求完成', conflict: '存在冲突，尚未覆盖' } }), field('flag', 'integer', '冲突时固定为1，表示下一次覆盖提交；submitted时不返回。', { optional: true })], empty: '权限、网络或Java业务错误会抛出；conflict不是新建成功。' }
  return trueOutput
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-hatchery-standard-indicator-', '')
  const isPrepare = suffix.startsWith('prepare-')
  const isRead = suffix === 'trait-options' || suffix === 'list' || suffix === 'export'
  const steps: AiContract['steps'] = []
  const prepareTarget = suffix === 'prepare-create' ? 'product-hatchery-standard-indicator-create'
    : suffix === 'prepare-update' ? 'product-hatchery-standard-indicator-update'
      : suffix === 'prepare-remove' ? 'product-hatchery-standard-indicator-remove' : undefined

  if (isPrepare && prepareTarget) {
    const mapping: Record<string, string> = suffix === 'prepare-remove' ? { id: 'result.id' } : { draft: 'result.draft' }
    steps.push({ role: 'required', when: '用户确认提交prepare返回的草稿', capabilityId: prepareTarget, mapping, instruction: '把prepare结果原样交给对应写能力；用户取消时只丢弃草稿，不发送写请求。' })
    steps.push({ role: 'cancel', when: '用户取消当前表单或删除确认', instruction: '只丢弃本地draft或id，不调用写能力。' })
  }
  if (suffix === 'create') {
    steps.push({ role: 'recovery', when: '返回status=submitted或请求响应不确定', capabilityId: 'product-hatchery-standard-indicator-list', mapping: { suiteCode: 'args.draft.suiteCode' }, instruction: '重新按同一suiteCode和指标条件调用list，确认记录是否出现；submitted只代表请求完成。' })
    steps.push({ role: 'required', when: '返回status=conflict', capabilityId: 'product-hatchery-standard-indicator-create', mapping: { draft: 'args.draft', flag: 'literal:1' }, instruction: '向用户说明同一suiteCode、指标和日龄已有记录；只有用户明确选择覆盖后，才用同一draft再次传flag=1。' })
  }
  if (suffix === 'update') steps.push({ role: 'recovery', when: '请求成功或响应不确定', capabilityId: 'product-hatchery-standard-indicator-list', mapping: { suiteCode: 'args.draft.suiteCode' }, instruction: '重新调用list回查标准指标；不能只依据true宣布已落库。' })
  if (suffix === 'remove') steps.push({ role: 'recovery', when: '请求成功或响应不确定', capabilityId: 'product-hatchery-standard-indicator-list', mapping: {}, instruction: '使用最近一次列表的suiteCode和筛选条件重新调用list，确认目标ID不再出现；不能只依据true宣布已删除。' })

  const effect: AiContract['effect'] = isRead ? 'read' : isPrepare ? 'prepare' : 'write'
  const purpose = suffix === 'trait-options' ? '按指标归类读取Portal指标名称及其内容类型、单位、小数位候选。'
    : suffix === 'list' ? '按隐藏指标页筛选条件分页读取标准库中的标准指标。'
      : suffix === 'prepare-create' ? '按Portal新建指标弹窗规则准备本地草稿。'
        : suffix === 'create' ? '按Portal新建指标接口创建标准内容，并在同日龄同指标冲突时等待用户决定是否覆盖。'
          : suffix === 'prepare-update' ? '按Portal编辑指标弹窗规则准备本地草稿。'
            : suffix === 'update' ? '按Portal编辑指标接口更新已有标准内容。'
              : suffix === 'prepare-remove' ? '准备一个经过ID校验、等待用户确认的标准指标删除草稿。'
                : suffix === 'remove' ? '按Portal GET接口软删除一条标准指标记录。'
                  : '按Portal导出按钮下载当前标准库的Excel标准数据。'

  return {
    purpose,
    whenToUse: `需要从${PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH}执行对应${isRead ? '查询' : isPrepare ? '准备' : '写入'}时使用；该页由孵化预案标准库的“查看标准”进入。`,
    boundaries: commonBoundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token；suiteCode、记录ID和指标编码必须来自当前页面结果，不凭名称猜测。', ...(suffix === 'create' || suffix === 'update' || suffix === 'remove' || isPrepare ? ['写操作还需要对应的program:suite-indicator权限，并在用户确认后执行。'] : [])],
    inputs: inputFor(id),
    output: outputFor(suffix),
    consume: suffix === 'trait-options'
      ? ['把value传回list或准备表单的traitCode；把contentType/unit/scale回填到页面字段，不用label作为提交ID。']
      : suffix === 'list'
        ? ['用list[].id进入编辑/删除，用list[].suiteCode作为导出和回查范围；用traitCode、age、min/max、txt解释页面标准内容。', 'total用于判断是否继续分页，不把当前页长度当作完整记录数。']
        : isPrepare
          ? ['把draft展示给用户；确认后原样交给对应写能力，取消只丢弃本地草稿。']
          : suffix === 'export'
            ? ['把base64保存为fileName对应的Excel文件；导出接口当前Java实现只按suiteCode决定范围。']
            : ['写入成功或响应不确定后按steps回查list；true、submitted或ID不等于已经独立确认的业务终态。'],
    steps,
    completion: isRead ? '获得与Portal隐藏页消费形状一致的动态候选、分页结果或可保存文件。' : isPrepare ? '获得尚未改变服务端的本地标准指标草稿。' : suffix === 'create' ? '返回submitted且list回查确认记录出现；返回conflict时尚未完成创建。' : '请求按Portal URL、HTTP方法、参数和权限上下文完成，并通过list回查最终状态。',
    failures: ['指标归类/编码、日龄、数值范围、标准内容、记录ID、分页、文件响应、权限、网络或Java业务错误均抛出；不降级为空列表、不假成功、不自动选择覆盖。'],
    idempotency: isRead || isPrepare ? null : '页面没有requestId幂等协议；新建冲突、网络超时或响应不确定时先list回查，再决定是否重试，避免重复写入或重复删除。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productHatcheryStandardIndicatorCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`孵化预案隐藏标准指标契约没有对应能力定义：${id}`)

export const PRODUCT_HATCHERY_STANDARD_INDICATOR_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_HATCHERY_STANDARD_INDICATOR_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS).map(([id, method]) => [
    `productHatcheryStandardIndicator.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productHatcheryStandardIndicator.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
