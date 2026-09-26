import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_CONFIGURATION_METHODS, reportConfigurationCapabilities } from '../capabilities/report-configuration.js'

const definitions = new Map(reportConfigurationCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })
const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '报表配置分页结果'),
    field('list', 'object[]', '当前页报表配置；不是筛选结果全量'),
    field('total', 'number', '符合名称和类型筛选的总记录数；用于继续翻页'),
    field('list[].id', 'string | number', '报表模板主键；编辑、详情和删除使用此ID'),
    field('list[].name', 'string | null', '报表名称'),
    field('list[].type', 'string | number | null', '报表分类字典值；Portal编辑表单会转成字符串'),
    field('list[].tag', 'string | number | null', '报表属性原值；1明细表、2汇总表'),
    field('list[].description', 'string | null', '报表说明'),
    field('list[].lockTopColumnsCount', 'integer | null', '详情/编辑使用的冻结前置列数量'),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
}

const templateOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('$', 'object', '单个报表模板详情'),
    field('id', 'string | number', '报表模板主键；可传给动态明细查询、导出、编辑和删除'),
    field('name', 'string | null', '报表名称；创建/编辑要求非空且最多50字符'),
    field('type', 'string | number | null', '报表分类字典值；编辑提交按原值转字符串'),
    field('tag', 'string | number | null', '报表属性原值；1明细表、2汇总表'),
    field('description', 'string | null', '报表说明；当前页面详情未单独编辑此字段'),
    field('lockTopColumnsCount', 'integer | null', '冻结前置列数量；页面默认0'),
    field('detailList', 'object[]', '报表字段配置，顺序就是列顺序和动态查询字段定义'),
    field('detailList[].id', 'string | number', '字段配置主键；只读回显字段'),
    field('detailList[].templateId', 'string | number', '所属报表模板ID'),
    field('detailList[].tableName', 'string | null', '字段来源表名'),
    field('detailList[].columnName', 'string | null', '字段来源列名'),
    field('detailList[].name', 'string | null', '字段展示名称'),
    field('detailList[].sort', 'integer | null', '字段排序值'),
    field('detailList[].fieldName', 'string | null', '动态明细结果中的字段键名；由tableName和columnName转换生成'),
    field('detailList[].filterType', 'string | null', '动态筛选比较符；Portal页面提交为='),
    field('detailList[].isFilterable', 'integer | null', '是否作为动态筛选字段；1是、0否'),
    field('detailList[].isSortable', 'integer | null', '服务端返回的可排序标记；当前页面不编辑'),
    field('detailList[].isGrouped', 'integer | null', '服务端返回的分组标记；当前页面不编辑'),
    field('detailList[].type', 'integer | null', '字段来源类型原值'),
  ],
  empty: '详情请求通常返回对象；非法ID或权限错误抛出，不用空对象伪装成不存在。',
}

const fieldsOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '一个可加入报表模板的字段候选'),
    field('[].name', 'string', '字段展示名称；也用于filterFieldNames和动态结果映射'),
    field('[].tableName', 'string', '字段来源表名；创建/编辑原样提交'),
    field('[].columnName', 'string', '字段来源列名；创建/编辑原样提交'),
    field('[].type', 'integer | null', '字段来源类型原值'),
  ],
  empty: '[]表示当前type范围没有字段候选；不要手写不存在的tableName/columnName。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '一条动态报表明细记录；键由对应模板detailList[].fieldName运行时决定'),
  ],
  empty: '[]表示该模板和筛选条件没有明细记录；不能据此判断模板不存在或没有权限。',
  dynamic: {
    sdkPath: 'reportConfiguration.get',
    args: { id: 'args.id' },
    instructions: '先调用get读取detailList；每个detailList[].fieldName是明细行中可能出现的真实键，detailList[].name是展示名，detailList[].isFilterable=1的字段才可作为filters键。不要把展示名、tableName或columnName直接当作返回键。',
  },
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('$', 'object', '动态报表导出文件的内存表示'),
    field('fileName', 'string', 'Content-Disposition文件名；缺失时SDK回退为报表明细.xls'),
    field('contentType', 'string | null', '响应Content-Type'),
    field('base64', 'string', '文件内容Base64；保存时先解码，不把它当业务文本'),
    field('byteLength', 'integer', '原始文件字节数；必须大于0'),
  ],
  empty: '空文件响应抛错；非空文件只证明下载完成，不证明筛选字段全部生效。',
}

const preparedOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('$', 'object', '本地准备结果容器'),
    field('draft', 'object', '按Portal表单校验后生成的实际请求草稿；尚未发请求'),
    field('draft.name', 'string', '报表名称；非空且最多50字符'),
    field('draft.type', 'string', '报表分类字典值；省略时按空字符串提交'),
    field('draft.tag', 'string', '报表属性：1明细表、2汇总表'),
    field('draft.lockTopColumnsCount', 'integer', '冻结前置列数量；缺省为0'),
    field('draft.detailList', 'object[]', '最终提交的字段配置，顺序来自fields'),
    field('draft.detailList[].name', 'string', '字段展示名称'),
    field('draft.detailList[].tableName', 'string', '字段来源表名'),
    field('draft.detailList[].columnName', 'string', '字段来源列名'),
    field('draft.detailList[].type', 'integer | null', '字段来源类型'),
    field('draft.detailList[].isFilterable', 'integer', '由filterFieldNames按字段名映射出的0/1'),
    field('draft.detailList[].filterType', 'string', '固定为='),
  ],
  empty: '非法表单输入直接抛错，不返回半成品草稿；合法输入返回完整字段映射。',
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [],
  empty: '成功没有业务回执；必须用list或get重新核实写入结果。',
}

const gaps = [
  '本轮已核对Portal菜单、列表页、复制弹窗、创建/编辑页、动态详情页、Java Controller/DTO/Service、SDK实现和离线请求断言；尚未在真实测试环境执行本页浏览器读请求。',
  'Portal列表的“权限”按钮当前只有TODO提交逻辑，没有真实请求；SDK不伪造权限能力。',
  '详情查询Controller会把hrStaffName、hrStaffStaffCode、hrStaffMobile、hrOrganizationName、hrPostName强制置null；SDK忠实发送这些筛选键，但不能承诺这些五个筛选在后端生效。',
  'Portal删除动作源码存在确认前先发DELETE的重复请求风险；SDK采用prepareRemove后由调用方确认再调用remove，不复制该风险。',
  '页面没有字段、类型和标签的完整必填校验；SDK保留页面可提交边界，后端可能因字段为空或SQL生成失败拒绝请求，不能把prepare成功当成保存成功。',
  '创建、编辑、复制和删除没有后端requestId或页面撤销接口；本轮没有真实环境的prepare→submit→cancel/回滚记录，写入后必须核实。',
]

function typeOf (kind: string): string {
  if (kind === 'number') return 'number'
  if (kind === 'enum') return 'string | number'
  return 'string'
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`报表配置契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: typeOf(parameter.kind),
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: '用户提供的Portal报表配置筛选、动态明细参数或表单；按能力参数契约提交。',
  }]))
}

const queryInputs: Record<string, AiParameter> = {
  name: { type: 'string', required: false, nullable: true, meaning: '报表名称模糊查询；Portal未填写时发送空字符串', source: 'Portal列表名称输入框', omitted: '省略时SDK发送空字符串' },
  type: { type: 'string | number', required: false, nullable: true, meaning: '报表分类字典值；null表示不筛选，不能传分类名称', source: 'Portal salary_report_type字典选择', omitted: '省略或显式null时发送null' },
  pageNo: { type: 'integer', required: false, meaning: '页码，从1开始', source: 'Portal分页器', default: '1', constraints: ['SDK校验为正整数'] },
  pageSize: { type: 'integer', required: false, meaning: '每页条数', source: 'Portal分页器', default: '20', constraints: ['SDK只接受10、20、50、100、200、500'] },
}

const fieldInput: AiParameter = {
  type: 'array<object>',
  required: true,
  meaning: '按reportFields返回值选择并保留顺序的字段候选数组；每项至少包含name、tableName、columnName、type',
  source: 'reportConfiguration.reportFields({ type: 0 })返回的字段候选与用户选择',
  constraints: ['不能凭展示名手写来源表/列', '页面没有字段必选规则；空数组可能被后端拒绝，调用方应以实际业务要求确认'],
}

const detailInput: AiParameter = {
  type: 'object',
  required: false,
  nullable: true,
  meaning: '按get返回detailList[].fieldName组织的动态筛选键值；不是展示名称映射',
  source: 'reportConfiguration.get返回的detailList中isFilterable=1字段与用户筛选值',
  omitted: '省略表示不额外加入动态筛选参数',
  constraints: ['键名必须是字母开头的字母数字字段键；undefined值会被省略', '五个hrStaff/hrOrganization/hrPost相关键虽可发送，Java详情接口当前会强制置null'],
}

const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`报表配置契约缺少能力定义：${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前用户在 /dashboard/report/report-configuration 权限范围内的报表配置；使用platform实例并发送module-type=14。',
      '页面实际可达动作包含列表、字段候选、全部报表候选、详情、动态明细、导出、复制、新建、编辑和删除；权限按钮没有真实请求，不在SDK能力中。',
    ],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用会话token和租户创建SDK；ID必须来自当前用户可见的list/all/get结果，动态字段必须先读取模板detailList。'],
    inputs: { ...inputsOf(id), ...extra.inputs },
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力结构；写入能力还必须用读取能力核实服务端终态，不能把空回执当作已生效。',
    failures: [
      'SDK本地校验失败时按错误指向修正ID、名称、字段映射、动态键或分页参数；不发送不完整请求。',
      '权限、会话、网络和后端业务错误不能用空列表、空详情或空文件代替；写请求超时先读取核实，不盲目重试。',
    ],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-configuration.ts', kind: 'implementation', note: '锁定页面路径、权限、module-type、请求投影、字段映射、动态参数、文件返回和写入校验。' },
      { source: 'test/report-configuration.test.ts', kind: 'test', note: '离线逐项锁定Portal菜单/页面/详情页、Java接口、默认参数、提交体、动态筛选、文件和负例。' },
      { source: 'docs/pages/报表配置.md', kind: 'reference', note: '记录页面四件套、权限边界、动态字段规则、后端硬编码筛选缺口和真实验证范围。' },
    ],
    gaps: [...gaps],
    ...extra,
  }
}

add('report-configuration-list', '按名称和分类分页查询报表配置，取得后续编辑、详情、复制或删除所需的模板ID。', pageOutput, ['展示list[].id、name、type、tag；按total继续翻页，不把当前页当作全部模板。'], { inputs: queryInputs })
add('report-configuration-all', '读取当前用户可见的全部报表配置候选。', { shape: 'object[]', fields: [field('[]', 'object', '一个报表配置候选'), field('[].id', 'string | number', '报表模板ID'), field('[].name', 'string | null', '报表名称'), field('[].type', 'string | number | null', '报表分类字典值'), field('[].tag', 'string | number | null', '报表属性')], empty: '[]表示当前权限范围没有可见报表候选。' }, ['显示候选名称时始终保留对应id；不能用名称代替后续详情/复制参数。'])
add('report-configuration-report-fields', '读取创建/编辑自定义报表时可选的字段候选。', fieldsOutput, ['先按候选name让用户选择，再把同一项的tableName、columnName、type原样交给prepareCreate或prepareUpdate；不要只传展示名。'], { inputs: { type: { type: 'integer', required: false, default: '0', meaning: '字段来源范围；页面固定使用0获取全部候选', source: 'Portal select-key组件', options: [{ value: 0, label: '全部字段' }, { value: 1, label: '人员信息字段' }, { value: 2, label: '账套字段' }] } } })
add('report-configuration-get', '读取一个报表模板的编辑字段、筛选标记和列顺序；用于编辑或解释动态明细结果。', templateOutput, ['以detailList顺序解释列；以detailList[].isFilterable=1的fieldName生成getDetail/export的filters；不要把name当fieldName。'], { steps: [{ role: 'optional', when: '用户确认修改当前模板', capabilityId: 'report-configuration-prepare-update', mapping: { id: 'result.id' }, instruction: '保留同一次get的完整模板和字段选择，按用户意图修改后准备更新。' }] })
add('report-configuration-get-detail', '按报表模板ID和运行时动态字段筛选查询报表明细。', detailOutput, ['先get模板并建立fieldName→name映射；逐行展示动态返回键。空数组只表示本次模板/筛选没有行。'], { inputs: { id: { type: 'string | number', required: true, meaning: '报表模板ID', source: 'reportConfiguration.get.$.id或list[].id' }, year: { type: 'string', required: false, nullable: true, format: 'YYYY', meaning: '明细查询年份；省略由后端使用当前年份', source: '用户筛选或当前业务月份', omitted: '后端使用当前年份' }, month: { type: 'string', required: false, nullable: true, format: 'M或MM', meaning: '非汇总报表明细查询月份；省略由后端使用当前月份', source: '用户筛选或当前业务月份', omitted: '后端使用当前月份' }, filters: detailInput }, steps: [{ role: 'required', when: '尚未取得当前模板字段定义', capabilityId: 'report-configuration-get', mapping: { id: 'args.id' }, instruction: '读取detailList后才决定可用动态过滤键和返回列。' }] })
add('report-configuration-export', '按同一动态模板和筛选条件导出Excel报表明细。', fileOutput, ['把getDetail使用的同一id、year、month和filters传给export；优先用fileName保存，并用byteLength确认得到非空文件。'], { inputs: { id: { type: 'string | number', required: true, meaning: '报表模板ID', source: 'reportConfiguration.get.$.id或list[].id' }, year: { type: 'string', required: false, nullable: true, format: 'YYYY', meaning: '导出年份；省略由后端使用当前年份', source: '用户筛选', omitted: '后端使用当前年份' }, month: { type: 'string', required: false, nullable: true, format: 'M或MM', meaning: '导出月份；省略由后端使用当前月份', source: '用户筛选', omitted: '后端使用当前月份' }, filters: detailInput }, steps: [{ role: 'required', when: '用户需要离线文件且已确认模板筛选', capabilityId: 'report-configuration-export', mapping: { id: 'args.id', year: 'args.year', month: 'args.month', filters: 'args.filters' }, instruction: '原样使用已经核对过的动态字段筛选；下载完成后检查fileName和byteLength。' }] })

const draftInputs: Record<string, AiParameter> = {
  name: { type: 'string', required: true, meaning: '报表名称；页面规则为非空且最多50字符', source: 'Portal创建/编辑表单', constraints: ['不能全为空格', 'SDK按页面规则限制最多50字符'] },
  type: { type: 'string | number', required: false, nullable: true, meaning: 'salary_report_type字典值；页面按原值提交', source: 'Portal报表分类字典选择', omitted: '页面初始空字符串，SDK按空字符串提交' },
  tag: { type: 'string | number', required: true, meaning: '报表属性；1明细表、2汇总表', source: 'Portal salary_report_tag字典选择', constraints: ['只能是1或2'] },
  lockTopColumnsCount: { type: 'integer', required: false, meaning: '冻结前置列数量；Portal默认0', source: 'Portal表单', default: '0', constraints: ['非负整数'] },
  fields: fieldInput,
  filterFieldNames: { type: 'string[]', required: false, nullable: true, meaning: '要作为动态筛选条件的字段name数组；每项必须来自fields[].name', source: '用户选择的可筛选字段或get详情的isFilterable字段', omitted: '省略按空数组，所有detailList项isFilterable=0' },
}
add('report-configuration-prepare-create', '按Portal新建自定义报表表单校验并生成实际POST请求草稿，不发请求。', preparedOutput, ['核对draft.detailList的顺序、来源表列、isFilterable和filterType；确认后按同一表单输入调用create，取消时丢弃草稿。'], { effect: 'prepare', inputs: draftInputs, steps: [{ role: 'required', when: '用户确认创建', capabilityId: 'report-configuration-create', mapping: { name: 'args.name', type: 'args.type', tag: 'args.tag', lockTopColumnsCount: 'args.lockTopColumnsCount', fields: 'args.fields', filterFieldNames: 'args.filterFieldNames' }, instruction: '提交与prepare使用的同一份表单输入；prepare返回的detailList是请求预览，create会重新按同一规则生成请求体。' }, { role: 'cancel', when: '用户取消新建表单', instruction: '丢弃本地draft，不调用create。' }] })
add('report-configuration-create', '提交Portal新建自定义报表表单，创建报表模板及其字段配置。', voidOutput, ['请求成功或超时后list翻页核对唯一的name、type、tag和detailList字段顺序；空回执不代表页面已刷新。'], { inputs: draftInputs, idempotency: '后端没有requestId或撤销接口；同名/同字段表单重复提交可能创建重复模板，超时必须先list/get核实，不能盲目重试。', steps: [{ role: 'required', when: 'POST成功或结果不确定', capabilityId: 'report-configuration-list', mapping: { name: 'args.name', type: 'args.type', pageNo: 'literal:1', pageSize: 'literal:20' }, instruction: '按完整名称和分类查找候选，再get逐项核对detailList；无法唯一定位时向用户报告结果不确定。' }] })
add('report-configuration-prepare-update', '按Portal编辑表单规则校验并生成实际PUT请求草稿，不发请求。', preparedOutput, ['必须使用最新get详情的id和字段候选；核对draft.detailList后确认，再调用update；取消时不发PUT。'], { effect: 'prepare', inputs: { id: { type: 'string | number', required: true, meaning: '待编辑报表模板ID', source: 'reportConfiguration.get.$.id或list[].id' }, ...draftInputs }, steps: [{ role: 'required', when: '用户确认保存编辑', capabilityId: 'report-configuration-update', mapping: { id: 'args.id', name: 'args.name', type: 'args.type', tag: 'args.tag', lockTopColumnsCount: 'args.lockTopColumnsCount', fields: 'args.fields', filterFieldNames: 'args.filterFieldNames' }, instruction: '提交同一份已核对的表单输入；update会重新生成包含id的detailList请求体。' }, { role: 'cancel', when: '用户取消编辑表单', instruction: '丢弃本地draft，不调用update。' }] })
add('report-configuration-update', '提交Portal编辑表单，整体替换一个报表模板的名称、属性、冻结列和字段配置。', voidOutput, ['成功或超时后get同一id，逐字段核对name、type、tag、lockTopColumnsCount、detailList及isFilterable。'], { inputs: { id: { type: 'string | number', required: true, meaning: '待编辑报表模板ID', source: '最新get.$.id' }, ...draftInputs }, idempotency: '后端没有requestId或撤销接口；PUT是绝对值整体提交，超时先get核实，不要用旧草稿覆盖他人后续修改。', steps: [{ role: 'required', when: 'PUT成功或结果不确定', capabilityId: 'report-configuration-get', mapping: { id: 'args.id' }, instruction: '读取同一模板并逐字段比较；确认detailList顺序和筛选标记。' }] })
add('report-configuration-prepare-remove', '校验用户选中的报表模板ID数组并生成批量删除草稿，不发请求。', { shape: '{ ids: (string | number)[] }', fields: [field('$', 'object', '删除草稿'), field('ids', '(string | number)[]', '去重后的待删除报表模板ID')], empty: '空数组、非法ID或重复ID抛错；取消时不发送DELETE。' }, ['向用户展示待删除ID对应的最新列表行，并等待明确确认；prepare成功不代表已经删除。'], { effect: 'prepare', inputs: { ids: { type: '(string | number)[]', required: true, meaning: '用户选中的报表模板ID数组，不能传行号', source: 'reportConfiguration.list返回的list[].id', constraints: ['至少一项', '不允许重复'] } }, steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'report-configuration-remove', mapping: { ids: 'result.ids' }, instruction: '只提交同一批用户确认过的ID。' }, { role: 'cancel', when: '用户取消删除确认', instruction: '丢弃ids草稿，不调用remove。' }] })
add('report-configuration-remove', '批量软删除用户确认的报表模板。', voidOutput, ['成功或超时后list翻页，确认所有原ID都不再出现；不要把页面源码确认前重复DELETE当作成功证据。'], { inputs: { ids: { type: '(string | number)[]', required: true, meaning: '待删除报表模板ID数组', source: 'prepare-remove.ids或最新list[].id' } }, idempotency: '后端没有requestId或撤销接口；删除结果不确定时先list核实全部ID是否消失，再决定是否重试。', steps: [{ role: 'required', when: 'DELETE成功或结果不确定', capabilityId: 'report-configuration-list', mapping: { pageNo: 'literal:1', pageSize: 'literal:20' }, instruction: '持续翻页查找原ID；全部不再出现才报告删除已核实。' }] })
add('report-configuration-prepare-copy', '校验复制报表的源模板ID和新名称，生成multipart复制草稿，不发请求。', { shape: '{ draft: { id: string | number, name: string } }', fields: [field('$', 'object', '复制草稿容器'), field('draft.id', 'string | number', '源报表模板ID'), field('draft.name', 'string', '复制后的报表名称；最多30字符')], empty: '源ID非法或名称为空/超过30字符抛错；取消时不复制。' }, ['展示源模板名称和复制后的新名称，等待用户确认；prepare成功只代表本地校验通过。'], { effect: 'prepare', inputs: { id: { type: 'string | number', required: true, meaning: '源报表模板ID', source: 'reportConfiguration.list[].id或get.$.id' }, name: { type: 'string', required: true, meaning: '复制后的报表名称；最多30字符且不能全为空格', source: 'Portal复制弹窗', constraints: ['不能全为空格', '最多30字符'] } }, steps: [{ role: 'required', when: '用户确认复制', capabilityId: 'report-configuration-copy', mapping: { id: 'result.draft.id', name: 'result.draft.name' }, instruction: '将draft的id和name交给copy；copy使用multipart字段id/name。' }, { role: 'cancel', when: '用户取消复制弹窗', instruction: '丢弃draft，不调用copy。' }] })
add('report-configuration-copy', '复制一个已有报表模板并用用户指定名称创建新模板。', voidOutput, ['成功或超时后list按完整新名称查找，再get核对字段顺序和筛选标记；复制响应没有新模板ID时不能直接报告已定位。'], { inputs: { id: { type: 'string | number', required: true, meaning: '源报表模板ID', source: 'prepare-copy.draft.id或最新list[].id' }, name: { type: 'string', required: true, meaning: '复制后的报表名称；最多30字符', source: 'prepare-copy.draft.name或用户确认名称' } }, idempotency: '后端没有requestId或撤销接口；重复调用可能生成多个同名模板，超时必须先list/get核实，不能盲目重试。', steps: [{ role: 'required', when: 'POST copyReport成功或结果不确定', capabilityId: 'report-configuration-list', mapping: { name: 'args.name', pageNo: 'literal:1', pageSize: 'literal:20' }, instruction: '按完整新名称查找候选；如有多个同名结果，逐个get并向用户报告无法唯一归因。' }] })

export const REPORT_CONFIGURATION_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_CONFIGURATION_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_CONFIGURATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_CONFIGURATION_METHODS).map(([id, method]) => [`reportConfiguration.${method}`, REPORT_CONFIGURATION_AI_CONTRACTS[id]!]))
