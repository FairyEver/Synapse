import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_INDICATOR_LIB_METHODS,
  PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH,
  PRODUCT_SETTING_INDICATOR_LIB_PERMISSION,
  productSettingIndicatorLibCapabilities,
} from '../capabilities/product-setting-indicator-lib.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingIndicatorLibCapabilities.map(definition => [definition.id, definition]))

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer, latestCount: integer, historyCount: integer }',
  fields: [
    field('$', 'object', 'Portal指标库分页结果；SDK已解包平台响应并规范版本字段。'),
    field('list', 'array', '当前筛选和版本范围下的指标库版本列表。'),
    field('list[]', 'object', '指标库版本记录；保留后端扩展字段并补齐页面实际消费字段。'),
    field('list[].id', 'string', '当前行版本ID；详情、复制、删除和版本操作使用此ID。'),
    field('list[].versionId', 'string', '当前行版本ID的规范别名。'),
    field('list[].libraryId', 'string', '指标库维度ID；新建版本时使用。'),
    field('list[].generation', 'string', '代次编码；页面筛选和维度展示使用。'),
    field('list[].variety', 'string', '品种编码；曾祖代可能为空。', { nullable: true, nullMeaning: '后端没有返回品种，或该代次不要求品种。' }),
    field('list[].strain', 'string', '品系编码；商品代等代次可能为空。', { nullable: true, nullMeaning: '后端没有返回品系，或该代次不启用品系。' }),
    field('list[].versionName', 'string', '版本名称，例如V1；版本编辑和切换使用。'),
    field('list[].effectiveStart', 'string | null', '版本生效开始时间。', { nullable: true, nullMeaning: '后端未返回开始时间。' }),
    field('list[].effectiveEnd', 'string | null', '版本生效结束时间；null表示当前最新版本。', { nullable: true, nullMeaning: '当前版本没有结束时间。' }),
    field('list[].latest', 'boolean', '是否为当前最新版本；SDK也按effectiveEnd为空复刻Portal语义。'),
    field('list[].operatorName', 'string', '最近操作人展示名称。'),
    field('list[].operationTime', 'string | null', '最近操作时间。', { nullable: true, nullMeaning: '后端未返回操作时间。' }),
    field('total', 'integer', '筛选后的版本总数，不是当前页长度。'),
    field('latestCount', 'integer', '筛选结果中的最新版本数量。'),
    field('historyCount', 'integer', '筛选结果中的历史版本数量。'),
  ],
  empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录。权限、网络或响应结构错误会抛出，不降级为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: '{ id, versionId, libraryId, dimensions, versions, definitions, rows }',
  fields: [
    field('$', 'object', '指标库版本详情；包含版本切换、指标定义和日龄数据。'),
    field('id', 'string', '当前详情版本ID。'),
    field('versionId', 'string', '当前详情版本ID的规范别名。'),
    field('libraryId', 'string', '指标库维度ID。'),
    field('generation', 'string', '当前版本代次编码。'),
    field('variety', 'string', '当前版本品种编码；曾祖代可能为空。', { nullable: true, nullMeaning: '该代次不要求品种或后端没有返回。' }),
    field('strain', 'string', '当前版本品系编码；未启用时为空。', { nullable: true, nullMeaning: '该代次不启用品系或后端没有返回。' }),
    field('versionName', 'string', '当前版本名称。'),
    field('effectiveStart', 'string | null', '当前版本生效开始时间。', { nullable: true, nullMeaning: '后端未返回开始时间。' }),
    field('effectiveEnd', 'string | null', '当前版本生效结束时间；null代表最新版本。', { nullable: true, nullMeaning: '当前版本仍是最新版本。' }),
    field('latest', 'boolean', '当前版本是否最新。'),
    field('versions', 'array', '同一指标库维度可切换的版本列表。'),
    field('versions[]', 'object', '可切换版本记录，字段语义与当前版本相同。'),
    field('versions[].versionId', 'string', '可切换版本ID。'),
    field('versions[].versionName', 'string', '可切换版本名称。'),
    field('definitions', 'array', '指标定义列表；配置页和数据单元格校验使用。'),
    field('definitions[]', 'object', '指标定义记录。'),
    field('definitions[].id', 'string', '指标定义ID；配置更新/删除使用，新增定义为空字符串。'),
    field('definitions[].name', 'string', '指标展示名称。'),
    field('definitions[].code', 'string', '指标代码；数据行values的动态键和快速录入indicatorCode使用。'),
    field('definitions[].category', 'string', '指标分类编码。'),
    field('definitions[].tempBandCode', 'string | null', '关联温度带编码；无温度关联时为null。', { nullable: true, nullMeaning: '该指标不关联温度带。' }),
    field('definitions[].unit', 'string', '指标单位。'),
    field('definitions[].decimalPlaces', 'integer', '允许的小数位数，范围0-3；数据保存和快速录入按此校验。'),
    field('definitions[].sortOrder', 'integer', '指标在配置页的排序位置。'),
    field('rows', 'array', '当前版本按日龄保存的指标数据行。'),
    field('rows[]', 'object', '日龄数据行。'),
    field('rows[].dayAge', 'integer', '日龄，范围1-700。'),
    field('rows[].values', 'object', '按definitions[].code索引的结构化指标值。'),
    field('rows[].values.*', 'object | null', '单元格值；可为EXACT、RANGE、LT、GT结构，null表示空单元格。', { nullable: true, nullMeaning: '该日龄的该指标为空。' }),
  ],
  empty: '版本不存在、响应缺少详情结构或请求失败时抛出；不会把空详情伪造成可编辑版本。',
}

const definitionsOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('$', 'array', '全局指标定义列表。'),
    field('[]', 'object', '指标定义记录。'),
    field('[].id', 'string', '指标定义ID；配置更新/删除使用。'),
    field('[].name', 'string', '指标展示名称。'),
    field('[].code', 'string', '指标代码；必须以小写字母开头，只能含小写字母、数字和下划线。'),
    field('[].category', 'string', '指标分类编码。'),
    field('[].tempBandCode', 'string | null', '关联温度带编码。', { nullable: true, nullMeaning: '没有绑定温度带。' }),
    field('[].unit', 'string', '指标单位。'),
    field('[].decimalPlaces', 'integer', '指标数值允许的小数位数，范围0-3。'),
    field('[].sortOrder', 'integer', '配置页展示顺序。'),
  ],
  empty: '[]表示尚未配置指标；请求或响应错误会抛出。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const idOutput: AiContract['output'] = {
  shape: 'string',
  fields: [field('$', 'string', '服务端返回的新建版本或复制版本ID。')],
  empty: '请求成功但没有返回有效ID时抛出，避免把未确认的空ID交给后续操作。',
}

const fileOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('$', 'object', '下载文件的内存表示。'),
    field('fileName', 'string', '响应Content-Disposition中的文件名；缺失时使用指标库默认文件名。'),
    field('contentType', 'string | null', '响应Content-Type。', { nullable: true, nullMeaning: '服务端没有返回Content-Type。' }),
    field('base64', 'string', '文件二进制的标准Base64内容。'),
    field('byteLength', 'integer', '文件字节数。'),
  ],
  empty: '文件响应为空或不是可读取的二进制时抛出。',
}

const importOutput: AiContract['output'] = {
  shape: 'integer',
  fields: [field('$', 'integer', 'Portal导入接口返回的成功导入条数。')],
  empty: '响应没有有效的导入条数或请求失败时抛出。',
}

const commonBoundaries = [
  `页面范围是${PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH}，详情页和指标配置页是该页面的同一操作单元；三页共用菜单权限${PRODUCT_SETTING_INDICATOR_LIB_PERMISSION}。SDK不绕过页面或服务端权限。`,
  '所有请求使用Portal platform HTTP实例并执行其admin-api前缀和generateHttpHeaders规则；platform.js不额外补devicetype，且该页面没有module-type推导，不发送module-type。',
  '列表默认versionScope=latest，Portal把它转换为latestOnly=true；versionScope=all才发送latestOnly=false。筛选字段generation、variety、strain分别对应页面的代次、品种、品系。',
  '新建、编辑和复制复刻Portal的动态表单：generation必填；展示值不是“曾祖代”时variety必填；仅“祖代/曾祖代”启用strain，其他代次提交空字符串。generation是字典value时必须同时提供generationLabel，SDK不会猜字典展示值。',
  '复制固定提交versionName=V1和当前时间effectiveStart；版本编辑/新建版本遵循最新版本结束时间为空、历史版本必须有结束时间且结束时间晚于开始时间的Portal规则。',
  '指标配置应用时按Portal顺序先更新已有定义、再创建新增定义、删除已移除定义，顺序变化时最后调用definition/sort；Code必须匹配^[a-z][a-z0-9_]{0,63}$且不可重复，小数位只能0-3。',
  '数据增量保存只提交发生变化的rows；日龄必须是1-700且不重复，单元格支持EXACT/RANGE/LT/GT，null表示清空；小数位按当前definitions校验。快速录入只提交EXACT具体值，最多50组。',
  '详情页数据写入端点是PUT /flockSimu/rearingPlan/indicator/data/partial-update和PUT /flockSimu/rearingPlan/indicator/data/quick-entry；配置页端点是GET/POST/PUT/DELETE /definition/list、/definition/create、/definition/update、/definition/delete和PUT /definition/sort。',
  '导入只接受.xlsx，并以multipart字段file和versionId提交；下载模板和导出返回二进制文件描述。写操作成功或响应不确定后必须重新get/list回查，不能把true或导入条数直接当作业务终态。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/indicator-lib/list.vue', kind: 'reference', note: '逐页核对菜单路径、平台HTTP实例、共用权限、列表筛选、latestOnly、分页、创建/编辑/复制/删除、详情和配置跳转。' },
  { source: 'app/portal/views/dashboard/product/setting/indicator-lib/detail.vue、configure.vue、components/StandardModalContent.vue、CopyModalContent.vue、ConfigureModalContent.vue、QuickEntryModalContent.vue、utils.js', kind: 'reference', note: '逐字段核对动态表单、版本时间、定义配置、数据结构、快速录入、草稿确认、导入导出和回查规则。' },
  { source: 'app/portal/utils/http/platform.js、app/portal/utils/product/rearing-plan-excel.js', kind: 'reference', note: '核对platform实例的admin-api前缀、devicetype、multipart文件字段和二进制下载方式。' },
  { source: 'erp-module-fm/.../RearingPlanIndicatorController.java、vo/RearingPlanIndicator*ReqVO.java、service/rearingplan/impl/RearingPlanIndicatorServiceImpl.java', kind: 'reference', note: '核对控制器端点、字段校验、日龄/小数位/版本重叠/定义绑定和导入响应。' },
  { source: 'src/capabilities/product-setting-indicator-lib.ts 与 test/product-setting-indicator-lib.test.ts', kind: 'implementation', note: '锁定逐页请求形状、表单和权限规则、平台上下文、前后端端点以及关键反证；不替代真实环境写入冒烟。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行指标库列表、详情、配置、版本切换、新建/复制/编辑/删除、数据保存、快速录入、导入导出闭环；当前证据为Portal/Java源码与离线请求形状测试。',
  '平台接口的实际租户数据和服务端导入文件内容未在本节点复测；写操作仍必须在真实环境按prepare→submit→回查执行。',
]

const draftFields: AiField[] = [
  field('draft', 'object', '通过Portal表单校验、尚未发送请求的指标库维度草稿。'),
  field('draft.generation', 'string', '代次编码。'),
  field('draft.variety', 'string', '品种编码；曾祖代可为空。', { nullable: true, nullMeaning: '代次展示值为曾祖代。' }),
  field('draft.strain', 'string', '品系编码；未启用品系时由SDK清空。'),
  field('draft.generationLabel', 'string', 'Portal代次字典展示值；用于prepare结果再次提交时保持动态必填规则，实际HTTP body不发送。', { optional: true }),
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-indicator-lib-', '')
  if (suffix === 'list') return {
    gen: param('代次筛选；SDK发送为generation，省略时不发送。', '指标库列表筛选表单', { type: 'string', required: false }),
    variety: param('品种筛选；省略时不发送。', '指标库列表筛选表单', { type: 'string', required: false }),
    line: param('品系筛选；SDK发送为strain，省略时不发送。', '指标库列表筛选表单', { type: 'string', required: false }),
    versionScope: param('版本范围；latest只查最新版本，all查询全部版本，默认latest。', '指标库列表筛选表单', { type: 'all | latest', required: false, default: 'latest', options: [{ value: 'latest', label: '最新版本' }, { value: 'all', label: '全部版本' }] }),
    pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50，默认10。', 'Portal分页状态', { type: '10 | 20 | 50', required: false, default: '10' }),
  }
  if (suffix === 'prepare-create' || suffix === 'prepare-update') return {
    form: param('指标库维度表单；generation必填，generationLabel用于复刻Portal动态必填，variety/strain按代次规则填写。', '用户确认的指标库新建或编辑表单', { type: 'object', required: true }),
  }
  if (suffix === 'create' || suffix === 'update' || suffix === 'copy' || suffix === 'version-update' || suffix === 'version-create' || suffix === 'apply-definition-config' || suffix === 'data-update' || suffix === 'quick-entry') return {
    draft: param('对应prepare方法返回的完整草稿；提交前保持草稿字段和校验结果不变。', `productSettingIndicatorLib.${suffix.replace(/-/g, '') === suffix ? suffix : 'prepare'}.result.draft`, { type: 'object', required: true }),
  }
  if (suffix === 'get' || suffix === 'export') return { versionId: param('指标库版本ID；来自list[].versionId或get结果。', '指标库列表/详情结果', { type: 'string', required: true }) }
  if (suffix === 'prepare-copy') return { form: param('复制弹窗表单；sourceVersionId和generation必填，其余维度按Portal动态规则填写。', '用户确认的指标库复制表单', { type: 'object', required: true }) }
  if (suffix === 'prepare-remove') return {
    versionId: param('单个版本ID；与versionIds二选一。', '指标库列表行.versionId', { type: 'string', required: false }),
    versionIds: param('批量删除版本ID数组；Portal逐个发送删除请求。', '用户在列表中选择的版本ID', { type: 'array', required: false }),
  }
  if (suffix === 'remove') return { versionIds: param('prepareRemove返回的版本ID数组；删除前必须已经取得用户确认。', 'productSettingIndicatorLib.prepareRemove.result.versionIds', { type: 'array', required: true }) }
  if (suffix === 'prepare-version-update') return { form: param('版本编辑表单；id、versionName、effectiveStart必填，历史版本需effectiveEnd，最新版本effectiveEnd必须为空。', '用户确认的版本编辑表单', { type: 'object', required: true }) }
  if (suffix === 'prepare-version-create') return { form: param('新建版本表单；libraryId、versionName和effectiveStart必填。', '用户确认的新建版本表单', { type: 'object', required: true }) }
  if (suffix === 'prepare-definition-config') return { form: param('配置页全部指标行；名称、Code、分类必填，Code格式和小数位按Portal规则。', '指标配置页面用户确认的完整表格', { type: 'object', required: true }) }
  if (suffix === 'prepare-data-update') return { form: param('版本ID、detail.definitions和发生变化的rows；definitions用于按页面定义校验，提交时不会放入HTTP body。', '当前详情页和用户编辑后的指标数据', { type: 'object', required: true }) }
  if (suffix === 'prepare-quick-entry') return { form: param('版本ID、detail.definitions和最多50组快速录入entries；只接受EXACT数值。', '当前详情页和用户确认的快速录入表单', { type: 'object', required: true }) }
  if (suffix === 'import') return {
    versionId: param('当前版本ID。', '指标库详情结果.versionId', { type: 'string', required: true }),
    fileName: param('xlsx文件名；只接受.xlsx扩展名。', '用户选择的导入文件', { type: 'string', required: true }),
    base64: param('xlsx文件二进制的标准Base64。', '用户选择的导入文件', { type: 'string', required: true }),
    contentType: param('文件MIME类型；省略时使用xlsx默认值。', '用户选择的导入文件', { type: 'string', required: false }),
  }
  return {}
}

function outputFor (suffix: string): AiContract['output'] {
  if (suffix === 'list') return listOutput
  if (suffix === 'get') return detailOutput
  if (suffix === 'definition-list') return definitionsOutput
  if (suffix === 'download-template' || suffix === 'export') return fileOutput
  if (suffix === 'import') return importOutput
  if (suffix === 'create' || suffix === 'copy' || suffix === 'version-create') return idOutput
  if (suffix === 'prepare-create' || suffix === 'prepare-update') return { shape: '{ draft: object }', fields: draftFields, empty: '表单不满足Portal动态校验时抛错，且不发送请求。' }
  if (suffix === 'prepare-copy') return { shape: '{ draft: object }', fields: [...draftFields, field('draft.sourceVersionId', 'string', '复制来源版本ID。'), field('draft.versionName', 'string', '固定为V1。'), field('draft.effectiveStart', 'string', '按Portal当前时间生成的复制版本生效开始时间。')], empty: '来源版本或维度表单不满足规则时抛错，且不发送请求。' }
  if (suffix === 'prepare-remove') return { shape: '{ versionIds: string[] }', fields: [field('versionIds', 'array', '经过ID校验、等待用户确认的版本ID数组。'), field('versionIds[]', 'string', '待删除版本ID。')], empty: '没有有效versionId时抛错，且不发送删除请求。' }
  if (suffix === 'prepare-version-update') return { shape: '{ draft: object }', fields: [field('draft', 'object', '经过版本号和生效时间校验的版本编辑草稿。'), field('draft.id', 'string', '版本ID。'), field('draft.versionName', 'string', '版本名称。'), field('draft.effectiveStart', 'string', '生效开始时间。'), field('draft.effectiveEnd', 'string | null', '生效结束时间；最新版本为null。', { nullable: true, nullMeaning: '该版本仍为最新版本。' })], empty: '时间为空、重叠规则不满足或最新/历史结束时间语义错误时抛错。' }
  if (suffix === 'prepare-version-create') return { shape: '{ draft: object }', fields: [field('draft', 'object', '经过新建版本表单校验的草稿。'), field('draft.libraryId', 'string', '指标库维度ID。'), field('draft.versionName', 'string', '新版本名称。'), field('draft.effectiveStart', 'string', '新版本生效开始时间。')], empty: 'libraryId、版本名称或开始时间缺失时抛错。' }
  if (suffix === 'prepare-definition-config') return { shape: '{ draft: object }', fields: [field('draft', 'object', '经过指标配置表格校验的完整配置草稿。'), field('draft.definitions', 'array', '按页面顺序排列的指标定义。'), field('draft.definitions[].id', 'string', '已有定义ID；新增定义为空字符串。'), field('draft.definitions[].name', 'string', '指标名称。'), field('draft.definitions[].code', 'string', '指标Code。'), field('draft.definitions[].category', 'string', '指标分类。'), field('draft.definitions[].tempBandCode', 'string | null', '温度带Code。', { nullable: true, nullMeaning: '不关联温度带。' }), field('draft.definitions[].unit', 'string', '指标单位。'), field('draft.definitions[].decimalPlaces', 'integer', '0-3的小数位数。'), field('draft.definitions[].sortOrder', 'integer', '页面顺序。')], empty: '字段缺失、Code格式错误、Code重复或小数位超出0-3时抛错。' }
  if (suffix === 'prepare-data-update') return { shape: '{ draft: object }', fields: [field('draft', 'object', '经过日龄、单元格类型和小数位校验的数据保存草稿。'), field('draft.versionId', 'string', '指标库版本ID。'), field('draft.definitions', 'array', '用于校验的详情指标定义；提交时不会发送。'), field('draft.rows', 'array', '发生变化的数据行。'), field('draft.rows[].dayAge', 'integer', '1-700的日龄。'), field('draft.rows[].values', 'object', '按指标Code索引的单元格变更。'), field('draft.rows[].values.*', 'object | null', 'EXACT/RANGE/LT/GT结构或null清空。', { nullable: true, nullMeaning: '清空对应单元格。' })], empty: '没有数据行、日龄重复、单元格为空或数值小数位不符合定义时抛错。' }
  if (suffix === 'prepare-quick-entry') return { shape: '{ draft: object }', fields: [field('draft', 'object', '经过快速录入校验的草稿。'), field('draft.versionId', 'string', '指标库版本ID。'), field('draft.definitions', 'array', '用于校验的详情指标定义；提交时不会发送。'), field('draft.entries', 'array', '最多50组日龄区间和EXACT数值。'), field('draft.entries[].indicatorCode', 'string', '指标Code。'), field('draft.entries[].startDayAge', 'integer', '起始日龄。'), field('draft.entries[].endDayAge', 'integer', '结束日龄。'), field('draft.entries[].indicatorValue', 'object', '固定为EXACT具体数值。'), field('draft.entries[].indicatorValue.valueType', 'EXACT', 'Portal快速录入固定提交EXACT。'), field('draft.entries[].indicatorValue.value', 'number', '按指标小数位校验的数值。')], empty: '数量超过50、日龄越界、指标不存在、类型不是EXACT或小数位不符合定义时抛错。' }
  if (suffix === 'apply-definition-config') return definitionsOutput
  if (suffix === 'data-update' || suffix === 'quick-entry' || suffix === 'update' || suffix === 'version-update' || suffix === 'remove') return trueOutput
  return trueOutput
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-indicator-lib-', '')
  const isPrepare = suffix.startsWith('prepare-')
  const isRead = ['list', 'get', 'definition-list', 'download-template', 'export'].includes(suffix)
  const steps: AiContract['steps'] = []
  const prepareTarget = suffix === 'prepare-create' ? 'product-setting-indicator-lib-create'
    : suffix === 'prepare-update' ? 'product-setting-indicator-lib-update'
      : suffix === 'prepare-copy' ? 'product-setting-indicator-lib-copy'
        : suffix === 'prepare-remove' ? 'product-setting-indicator-lib-remove'
          : suffix === 'prepare-version-update' ? 'product-setting-indicator-lib-version-update'
            : suffix === 'prepare-version-create' ? 'product-setting-indicator-lib-version-create'
              : suffix === 'prepare-definition-config' ? 'product-setting-indicator-lib-apply-definition-config'
                : suffix === 'prepare-data-update' ? 'product-setting-indicator-lib-data-update'
                  : suffix === 'prepare-quick-entry' ? 'product-setting-indicator-lib-quick-entry' : undefined

  if (isPrepare && prepareTarget) {
    const mapping: Record<string, string> = suffix === 'prepare-remove' ? { versionIds: 'result.versionIds' } : { draft: 'result.draft' }
    steps.push({ role: 'required', when: '用户确认提交prepare返回的草稿', capabilityId: prepareTarget, mapping, instruction: '把prepare结果原样交给对应写能力；用户取消时只丢弃草稿，不发送请求。' })
    steps.push({ role: 'cancel', when: '用户取消当前表单或确认弹窗', instruction: '只丢弃本地draft，不调用写能力。' })
  }
  if (!isRead && !isPrepare && !['prepare-remove'].includes(suffix)) {
    const recovery = suffix === 'create' || suffix === 'copy' || suffix === 'version-create' || suffix === 'update' || suffix === 'version-update' || suffix === 'remove' || suffix === 'apply-definition-config' || suffix === 'data-update' || suffix === 'quick-entry' || suffix === 'import'
    if (recovery) {
      const recoveryCapability = suffix === 'apply-definition-config' || suffix === 'data-update' || suffix === 'quick-entry' || suffix === 'import'
        ? 'product-setting-indicator-lib-get'
        : 'product-setting-indicator-lib-list'
      steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: recoveryCapability, instruction: suffix === 'apply-definition-config' || suffix === 'data-update' || suffix === 'quick-entry' || suffix === 'import' ? '重新调用get读取当前版本详情并核对definitions/rows；写入返回值只代表请求完成。' : '重新调用list或get回查目标版本、数量或定义，确认服务端业务终态；不要只依据true或ID宣布已落库。' })
    }
  }

  const effect: AiContract['effect'] = isRead ? 'read' : isPrepare ? 'prepare' : 'write'
  const purpose = suffix === 'list' ? '按Portal筛选条件分页读取指标库版本。'
    : suffix === 'get' ? '读取指标库版本详情、版本列表、指标定义和日龄数据。'
      : suffix === 'definition-list' ? '读取指标库全局指标定义。'
        : suffix === 'download-template' ? '下载Portal指标库Excel导入模板。'
          : suffix === 'export' ? '导出当前指标库版本的Excel数据。'
            : suffix === 'import' ? '按Portal导入控件上传当前指标库版本的xlsx数据。'
              : `执行Portal指标库${suffix}操作。`

  return {
    purpose,
    whenToUse: `需要在${PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH}及其详情/配置子页执行对应${isRead ? '查询' : isPrepare ? '准备' : '写入'}时使用。`,
    boundaries: commonBoundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有指标库页面权限；写操作目标必须来自当前list/get结果或同一次prepare结果。'],
    inputs: inputFor(id),
    output: outputFor(suffix),
    consume: isRead
      ? ['按字段含义消费列表、详情、指标定义或文件结果；写入前使用返回的ID和Code，不从展示名称猜ID。']
      : isPrepare
        ? ['把draft展示给用户，得到明确确认后再交给对应写能力；取消只丢弃草稿。']
        : ['写请求成功或不确定后按steps回查list/get；true、ID和导入条数不是完整业务终态。'],
    steps,
    completion: isRead ? '获得与Portal页面消费形状一致的结果。' : isPrepare ? '获得尚未改变服务端的本地草稿。' : '请求按Portal的URL、HTTP方法、参数、权限上下文和表单规则完成，并按步骤回查业务终态。',
    failures: ['表单、动态代次规则、版本时间、指标Code、小数位、日龄、文件格式、权限、网络或Java业务错误均抛出；不降级为空结果、不假成功、不自动选择用户未确认的写入动作。'],
    idempotency: isRead || isPrepare ? null : '页面没有统一requestId幂等协议；写请求响应不确定时先list/get回查，再决定是否重试，避免重复创建版本、复制、导入或重复应用配置。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingIndicatorLibCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置指标库契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_INDICATOR_LIB_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_INDICATOR_LIB_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_INDICATOR_LIB_METHODS).map(([id, method]) => [
    `productSettingIndicatorLib.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingIndicatorLib.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
