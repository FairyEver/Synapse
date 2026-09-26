import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { PERF_MANAGE_TEMPLATE_METHODS, perfManageTemplateCapabilities } from '../capabilities/perf-manage-template.js'

const definitions = new Map(perfManageTemplateCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/views/dashboard/hr/manage/profit/list.vue、profit/[mode]/[id].vue、profit/profit-data.vue', kind: 'reference', note: '逐页核对利润树、表单、导入、公式同步、利润数据及使用情况请求。' },
  { source: 'app/portal/views/dashboard/hr/manage/salary-structure/list.vue、salary-structure/[mode]/[id].vue、salary-structure/salary-structure-config.vue、components/view-usage.vue', kind: 'reference', note: '核对薪资结构按层分页、表单、状态门禁、配置、薪资标准候选和使用情况请求。' },
  { source: 'app/portal/views/dashboard/hr/manage/template-content/list.vue、template-content/[mode]/[id].vue、template-content/template/[mode]/[id].vue、components/view-usage.vue', kind: 'reference', note: '核对模板内容基础表单、深层详情、年度候选、月度信息、递归删除和使用情况请求。' },
  { source: 'app/portal/views/dashboard/hr/manage/template-structure/list.vue、template-structure/[mode]/[id].vue、template-structure/template/[mode]/[id].vue、components/view-usage.vue', kind: 'reference', note: '核对模板结构基础表单、深层详情、组件类型归一化、递归删除和使用情况请求。' },
  { source: 'KpiProfitController.java、KpiSalaryStructureController.java、HrSalaryStandardController.java、KpiTemProtocolController.java、KpiTemStructureController.java、KpiMonthProtocolController.java、KpiTaskConfigController.java', kind: 'reference', note: '核对Portal实际调用的Java端点、方法、请求体和响应类型。' },
  { source: 'src/capabilities/perf-manage-template.ts、test/perf-manage-template.test.ts', kind: 'implementation', note: '锁定SDK参数归一化、状态门禁、请求形状和坏输入反证；不替代真实环境写回查。' },
]

const boundaries = [
  '范围只覆盖Portal菜单/dashboard/manage下的六个绩效模板/基础配置页及其页面实际跳转的详情；所有请求使用绩效页面上下文，module-type按页面规则为13。',
  '列表页的树形返回、本地名称过滤、薪资结构按层分页、templateType、selection=false和年度/月度字段均按Portal源码保留；SDK不增加页面没有的筛选。',
  '写能力必须使用prepare→submit→cancel；prepare不发请求，submit只接受对应草稿，取消只丢弃本地草稿。接口成功后仍要按同一ID或唯一业务字段回查。',
  '模板下载等打开浏览器页面的动作不注册为JSON能力；模板内容/结构深层保存与列表基础信息保存是不同端点，不能混用。',
]

function typeOfKind (kind: string): string {
  if (kind === 'number') return 'number'
  if (kind === 'boolean') return 'boolean'
  if (kind === 'date' || kind === 'text' || kind === 'search' || kind === 'enum') return 'string | number'
  if (kind === 'array') return 'object[]'
  return 'object'
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`绩效模板契约缺少能力定义：${id}`)
  return Object.fromEntries((definition.params ?? []).map(item => {
    const isDraft = item.name === 'draft' || item.name === 'form' || item.name === 'record' || item.name === 'file'
    const extra = item.options ? { constraints: item.options.map(option => `允许值${String(option.value)}=${option.label}`) } : {}
    return [item.name, param(
      isDraft ? `${item.name}对象；必须来自同一页面的Portal表单或对应prepare结果。` : `${item.name}；按Portal页面字段传入。`,
      isDraft ? 'Portal表单或对应prepare结果' : 'Portal页面参数',
      { required: item.required, type: item.name === 'draft' || item.name === 'form' || item.name === 'record' || item.name === 'file' ? 'object' : typeOfKind(item.kind), ...extra },
    )]
  }))
}

function endpointOf (id: string): string {
  if (id.includes('prepare-') || id.includes('cancel-')) return '无HTTP请求；只在本地校验或丢弃草稿。'
  if (id === 'perf-manage-profit-list') return 'GET /performance/basedata/kpiprofit/page，order/orderField为空串。'
  if (id === 'perf-manage-profit-detail') return 'GET /performance/basedata/kpiprofit/{id}。'
  if (id.includes('profit-line-list')) return 'GET /performance/basedata/kpiprofit/getLineList，query lineType。'
  if (id.includes('profit-variable-list')) return 'GET /performance/basedata/kpiprofit/getVariableList，query lineType。'
  if (id.includes('profit-years')) return 'GET /performance/basedata/kpiprofit/getProfitYear，query profitId。'
  if (id.includes('profit-data-by-year')) return 'GET /performance/basedata/kpiprofit/getProfitDataByYearAndDataType，query dataType/year/profitId。'
  if (id.endsWith('profit-data')) return 'GET /performance/basedata/kpiprofit/getProfitData，query profitId。'
  if (id.includes('profit-usage-template')) return 'POST /performance/basedata/kpiprofit/usedInfo，body含subassemblyType=1。'
  if (id.includes('profit-usage-people')) return 'POST /performance/basedata/kpiprofit/PeopleYearUsedInfo或PeopleMonthUsedInfo，body按templateType分支。'
  if (id.includes('profit-import')) return 'POST /performance/basedata/kpiprofit/import，multipart字段file/type/parentId。'
  if (id.includes('profit-sync-formula')) return 'GET /performance/basedata/kpiprofit/formulaUpdates，query name/year/month。'
  if (id.includes('profit-save-data')) return 'POST /performance/basedata/kpiprofit/saveData，body为forecastProfit/actualProfit数据对象。'
  if (id.includes('profit-create') || id.includes('profit-update') || id.includes('profit-delete')) return 'POST/PUT/DELETE /performance/basedata/kpiprofit；删除body为{ids:[...]}。'
  if (id === 'perf-manage-salary-structure-list') return 'GET /performance/basedata/kpisalarystructure/treePage或searchPage；query parentId/keyword/dataType/selection/pageNo/pageSize。'
  if (id === 'perf-manage-salary-structure-detail') return 'GET /performance/basedata/kpisalarystructure/{id}，可选specialProportion。'
  if (id.includes('salary-standard-list')) return 'GET /performance/basedata/hrsalarystandard/selectPage，query pageNo/pageSize/keyword。'
  if (id.includes('salary-standard-detail')) return 'GET /performance/basedata/hrsalarystandard/{id}。'
  if (id.includes('salary-structure-usage')) return 'POST /performance/basedata/kpisalarystructure/usedInfo，body含subassemblyType=2。'
  if (id.includes('salary-structure-status')) return 'PUT /performance/basedata/kpisalarystructure/updateStatus，body为{id,status}。'
  if (id.includes('salary-structure-config-update')) return 'PUT /performance/basedata/kpisalarystructure，body为配置完整字段。'
  if (id.includes('salary-structure-create') || id.includes('salary-structure-update') || id.includes('salary-structure-delete')) return 'POST/PUT/DELETE /performance/basedata/kpisalarystructure；删除body为{ids:[...]}。'
  if (id === 'perf-manage-template-content-list') return 'GET /performance/temcontent/kpitemprotocol/page，query order/orderField/templateType。'
  if (id === 'perf-manage-template-content-detail') return 'GET /performance/temcontent/kpitemprotocol/{id}。'
  if (id.includes('template-content-detail-get')) return 'GET /performance/temcontent/kpitemprotocol/getProtocolInfo，query id。'
  if (id.includes('template-content-detail-save')) return 'POST /performance/temcontent/kpitemprotocol/saveProtocolInfo，body为详情对象。'
  if (id.includes('template-content-protocol-options')) return 'GET /performance/temcontent/kpitemprotocol/getProtocolList，query templateType=0/salaryId。'
  if (id.includes('template-content-month-info')) return 'GET /performance/temcontent/kpitemprotocol/getMonthInfoByYearProtocol，query id。'
  if (id.includes('template-content-usage')) return 'POST /performance/temcontent/kpitemprotocol/YearUsedInfo或MonthUsedInfo。'
  if (id.includes('template-content-create') || id.includes('template-content-update') || id.includes('template-content-delete')) return 'POST/PUT/DELETE /performance/temcontent/kpitemprotocol；删除body为裸ID数组。'
  if (id === 'perf-manage-template-structure-list') return 'GET /performance/temstructure/kpitemstructure/page，query order/orderField/templateType。'
  if (id === 'perf-manage-template-structure-detail') return 'GET /performance/temstructure/kpitemstructure/{id}。'
  if (id.includes('template-structure-detail-get')) return 'GET /performance/temstructure/kpitemstructure/getStructureInfo，query id。'
  if (id.includes('template-structure-detail-save')) return 'POST /performance/temstructure/kpitemstructure/saveStructure，body为结构详情。'
  if (id.includes('template-structure-options')) return 'GET /performance/temstructure/kpitemstructure/page，query templateType。'
  if (id.includes('template-structure-usage')) return 'POST /performance/temstructure/kpitemstructure/usedInfo，body含subassemblyType=3。'
  if (id.includes('template-structure-create') || id.includes('template-structure-update') || id.includes('template-structure-delete')) return 'POST/PUT/DELETE /performance/temstructure/kpitemstructure；删除body为裸ID数组。'
  if (id.includes('study-task-config')) return 'GET/POST /performance/protocol/kpimonthprotocol/study-task-config；无查询参数。'
  if (id.includes('task-type-config')) return id.endsWith('list') ? 'GET /performance/task-type-config/list，params={}。' : 'PUT /performance/task-type-config/update，body为任务类型配置字段。'
  return '按对应Portal页面实际端点发送；SDK不扩展未被页面调用的参数。'
}

function outputOf (id: string): AiContract['output'] {
  if (id.includes('prepare-')) return { shape: '{ draft: object }', fields: [field('draft', 'object', '已按Portal页面规则校验、尚未发请求的草稿。')], empty: '校验失败时抛错且不发请求。' }
  if (id.includes('cancel-')) return { shape: '{ cancelled: boolean }', fields: [field('cancelled', 'boolean', '固定为true，表示本地草稿已丢弃。')], empty: '不发请求。' }
  if (id === 'perf-manage-profit-list') return { shape: 'object[]', fields: [field('[]', 'object', '利润树节点'), field('[].id', 'string | number', '利润或目录ID'), field('[].name', 'string', '节点名称'), field('[].type', '1 | 2', '节点类型；1文件夹、2利润', { values: { '1': '文件夹', '2': '利润' } }), field('[].children', 'object[]', '递归子节点；可能缺省')], empty: '[]表示当前筛选没有利润树节点。' }
  if (id === 'perf-manage-salary-structure-list') return { shape: '{ list: object[], total: number }', fields: [field('list', 'object[]', '当前层或关键字搜索命中的薪资结构记录'), field('total', 'number', '当前层或搜索结果总数'), field('list[].id', 'string | number', '目录或薪资结构ID'), field('list[].dataType', '1 | 2', '节点类型；1文件夹、2薪资结构', { values: { '1': '文件夹', '2': '薪资结构' } }), field('list[].name', 'string', '节点名称')], empty: 'list=[]且total=0表示当前查询没有记录。' }
  if (id === 'perf-manage-template-content-list' || id === 'perf-manage-template-structure-list') return { shape: 'object[]', fields: [field('[]', 'object', '模板树节点'), field('[].id', 'string | number', '节点ID'), field('[].name', 'string', '节点名称'), field('[].type', '0 | 1', '节点类型；0文件夹、1业务模板', { values: { '0': '文件夹', '1': '业务模板' } }), field('[].templateType', '0 | 1', '模板周期；0年度、1月度', { values: { '0': '年度', '1': '月度' } }), field('[].children', 'object[]', '递归子节点；可能缺省')], empty: '[]表示当前模板类型没有节点。' }
  if (id.endsWith('line-list')) return { shape: 'object[]', fields: [field('[]', 'object', '一条利润公式行'), field('[].id', 'string | number | null', '公式行ID；没有ID时为null', { nullable: true }), field('[].name', 'string | null', '公式行名称', { nullable: true }), field('[].lineType', 'number | null', '公式行类型字典值', { nullable: true }), field('[].code', 'string | null', '公式行编码', { nullable: true }), field('[].value', 'string | number | null', '公式行表达式或服务端值', { nullable: true })], empty: '[]表示当前lineType没有利润公式行。' }
  if (id.endsWith('variable-list')) return { shape: 'object[]', fields: [field('[]', 'object', '一条利润公式变量'), field('[].id', 'string | number | null', '变量ID；没有ID时为null', { nullable: true }), field('[].name', 'string | null', '变量名称', { nullable: true }), field('[].code', 'string | null', '变量编码', { nullable: true }), field('[].value', 'string | number | null', '变量值或表达式', { nullable: true }), field('[].lineType', 'number | null', '变量适用公式类型', { nullable: true })], empty: '[]表示当前lineType没有公式变量。' }
  if (id.endsWith('years')) return { shape: '(string | number)[]', fields: [field('[]', 'string | number', '利润可用年份；只作筛选值，不是利润ID')], empty: '[]表示该利润没有可用年份。' }
  if (id.endsWith('protocol-options') || id.endsWith('structure-options')) return { shape: 'object[]', fields: [field('[]', 'object', '模板候选或结构候选'), field('[].id', 'string | number', '候选ID'), field('[].name', 'string | null', '候选名称', { nullable: true }), field('[].templateType', '0 | 1 | null', '年度/月份模板类型', { nullable: true }), field('[].parent', 'string | number | null', '父节点ID', { nullable: true })], empty: '[]表示当前模板类型没有可用候选。' }
  if (id.endsWith('task-config-list')) return { shape: 'object[]', fields: [field('[]', 'object', '一条任务类型评分配置'), field('[].taskType', 'number | null', '任务类型编码', { nullable: true }), field('[].taskTypeName', 'string | null', '任务类型名称', { nullable: true }), field('[].selfEditable', 'boolean | null', '是否允许本人编辑', { nullable: true }), field('[].leaderEditable', 'boolean | null', '是否允许上级编辑', { nullable: true }), field('[].progressScoring', 'boolean | null', '是否按完成进度评分', { nullable: true }), field('[].formulaEnabled', 'boolean | null', '是否启用公式评分', { nullable: true }), field('[].buttonCount', 'number | null', '按钮数量', { nullable: true })], empty: '[]表示当前会话没有任务类型配置。' }
  if (id.endsWith('-list')) return { shape: 'object[]', fields: [field('[]', 'object', 'Portal返回的当前候选或列表记录'), field('[].id', 'string | number | null', '业务记录或候选ID；没有ID时为null', { nullable: true }), field('[].name', 'string | null', '名称或显示文本', { nullable: true }), field('[].code', 'string | null', '编码；端点未返回时为null', { nullable: true }), field('[].type', 'string | number | null', '节点或业务类型原码', { nullable: true }), field('[].templateType', '0 | 1 | null', '年度/月份模板类型；不适用时为null', { nullable: true }), field('[].status', 'number | null', '启停或业务状态原码；不适用时为null', { nullable: true })], empty: '[]表示当前筛选没有记录；权限、网络或响应结构错误会抛出。' }
  if (id.includes('create') || id.endsWith('profit-import')) return { shape: 'string | number | string[]', fields: [field('$', 'string | number | string[]', '创建返回的业务ID，或导入接口返回的导入结果数组。', { optional: false })], empty: '响应形状不符合对应Java端点时抛错。' }
  if (id.includes('sync-formula')) return { shape: 'true', fields: [field('$', 'boolean', '公式同步成功标志，严格为true。')], empty: '响应不是true时抛错。' }
  if (id.includes('update') || id.includes('delete') || id.includes('save') || id.endsWith('-status')) return { shape: 'true | undefined', fields: [field('$', 'true | undefined', 'Portal/Java写端点的成功结果；SDK不把HTTP状态码当业务数据。', { nullable: true })], empty: '失败或响应形状不符时抛错。' }
  if (id === 'perf-manage-study-task-config-get') return { shape: 'object', fields: [field('$', 'object', '学习任务配置'), field('weeklyProgressPercent', 'number | null', '周课堂每节进度比例', { nullable: true }), field('morningProgressPercent', 'number | null', '晨课堂每节进度比例', { nullable: true }), field('weeklyFlowerBaseline', 'number | null', '周课堂基准花朵', { nullable: true }), field('weeklyBonusScoreLimit', 'number | null', '周课堂自动超额上限', { nullable: true }), field('status', 'number | null', '配置启停状态', { nullable: true })], empty: '没有配置对象或响应字段缺失时按端点错误处理。' }
  if (id.includes('detail') || id.includes('config-get')) return { shape: 'object', fields: [field('$', 'object', '对应Portal详情或配置对象'), field('id', 'string | number | null', '业务记录ID；配置端点没有该字段时为null', { nullable: true }), field('name', 'string | null', '名称或标题', { nullable: true }), field('type', 'string | number | null', '节点/业务类型原码', { nullable: true }), field('dataType', 'number | null', '薪资结构节点类型：1目录、2薪资结构', { nullable: true }), field('templateType', '0 | 1 | null', '年度/月份模板类型', { nullable: true }), field('parent', 'string | number | null', '父节点ID', { nullable: true }), field('status', 'number | null', '启停或业务状态', { nullable: true }), field('subsectionList', 'object[] | null', '模板内容/结构深层分段；未返回时为null', { nullable: true })], empty: '没有记录或响应不是对象时按端点错误处理。' }
  if (id.endsWith('-data')) return { shape: 'object', fields: [field('$', 'object', '利润预测/实际数据响应'), field('forecastProfit', 'object | null', '预测数据；未返回时为null', { nullable: true }), field('actualProfit', 'object | null', '实际数据；未返回时为null', { nullable: true }), field('year', 'number | string | null', '数据年份', { nullable: true }), field('targetDataList', 'object[] | null', '目标数据行数组', { nullable: true })], empty: '没有利润数据时按端点返回的空业务对象处理；不将其解释为权限成功。' }
  if (id.endsWith('month-info')) return { shape: 'object', fields: [field('$', 'object', '年度模板对应的月度信息'), field('id', 'string | number | null', '年度模板ID', { nullable: true }), field('year', 'number | string | null', '年度值', { nullable: true }), field('month', 'number | string | null', '月份值', { nullable: true }), field('list', 'object[] | null', '月度明细', { nullable: true })], empty: '没有月度信息或响应不是对象时按端点错误处理。' }
  if (id.endsWith('usage')) return { shape: '{ list: object[], total: number }', fields: [field('$', 'object', '模板/结构/利润使用情况分页响应'), field('list', 'object[]', '当前页使用记录'), field('total', 'number', '使用记录总数'), field('list[].id', 'string | number | null', '使用记录ID或关联业务ID', { nullable: true }), field('list[].name', 'string | null', '使用对象名称', { nullable: true }), field('list[].realName', 'string | null', '使用人员姓名', { nullable: true }), field('list[].year', 'number | string | null', '使用年份', { nullable: true }), field('list[].month', 'number | string | null', '使用月份', { nullable: true }), field('list[].templateType', '0 | 1 | null', '年度/月份模板类型', { nullable: true })], empty: 'list=[]且total=0表示当前筛选没有使用记录；请求或响应结构错误会抛出。' }
  return { shape: 'object', fields: [field('$', 'object', 'Portal端点返回的业务对象'), field('id', 'string | number | null', '业务记录ID；端点未返回时为null', { nullable: true }), field('name', 'string | null', '名称或显示文本', { nullable: true }), field('status', 'number | null', '业务状态；端点未返回时为null', { nullable: true })], empty: '响应形状不符合端点契约时抛错。' }
}

function stepsOf (id: string): AiContract['steps'] {
  if (id.includes('prepare-')) {
    const submitId = id.replace('-prepare-', '-')
    const cancelId = id.replace('-prepare-', '-cancel-')
    const steps: AiContract['steps'] = [{ role: 'required', when: '用户确认提交', capabilityId: submitId, mapping: { draft: 'result.draft' }, instruction: '把同一份prepare返回的draft交给submit；不要改写或补充页面未提交字段。' }]
    if (definitions.has(cancelId)) steps.push({ role: 'cancel', when: '用户取消表单或动作', capabilityId: cancelId, mapping: { draft: 'result.draft' }, instruction: '提交前只丢弃draft，不发写请求。' })
    return steps
  }
  return []
}

function contractOf (id: string): AiContract {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`绩效模板契约没有定义：${id}`)
  const isPrepare = id.includes('prepare-')
  const isCancel = id.includes('cancel-')
  return {
    purpose: `${definition.title}；按Portal页面实际请求和表单规则执行。`,
    whenToUse: `需要${definition.title}时使用；先确认当前页面权限、记录ID和最新状态。`,
    boundaries,
    effect: isPrepare ? 'prepare' : isCancel ? 'local' : definition.write ? 'write' : 'read',
    prerequisites: ['使用当前用户会话、当前租户和绩效页面权限；ID、组织、薪资标准、模板结构等候选必须来自当前会话的Portal读取结果。'],
    inputs: inputsOf(id),
    output: outputOf(id),
    consume: [endpointOf(id), isPrepare ? '提交前向用户展示草稿；取消时不发请求。' : definition.write ? '写入成功或响应不确定时按同一ID/业务字段回查，不能只凭HTTP成功。' : '按返回字段继续Portal页面的下一步；空结果不等同于权限成功。'],
    steps: stepsOf(id),
    completion: isPrepare ? '得到已校验、尚未写入的草稿。' : isCancel ? '返回cancelled=true且没有HTTP请求。' : definition.write ? '请求未抛错；完成声明前还需按契约回查业务状态。' : '返回与Portal端点一致的业务结果。',
    failures: ['Portal表单校验、状态/权限门禁、组织数据范围、后端业务错误、网络错误或响应形状变化会抛出；SDK不静默返回空结果。'],
    idempotency: definition.write ? '这些端点没有统一requestId幂等协议；响应不确定时先回查再决定是否重试。' : null,
    evidence,
    gaps: ['已完成Portal/Java静态核对与离线请求测试；尚未在真实测试环境执行所有绩效页面的读请求和写入prepare→submit→cancel闭环。'],
  }
}

export const PERF_MANAGE_TEMPLATE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  perfManageTemplateCapabilities.map(definition => [definition.id, contractOf(definition.id)]),
)

export const PERF_MANAGE_TEMPLATE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PERF_MANAGE_TEMPLATE_METHODS).map(([id, method]) => [`perfManageTemplate.${method}`, { ...PERF_MANAGE_TEMPLATE_AI_CONTRACTS[id]!, boundaries: [...PERF_MANAGE_TEMPLATE_AI_CONTRACTS[id]!.boundaries, `直接方法路径为perfManageTemplate.${method}；写操作保持prepare→submit→cancel。`] }]),
)
