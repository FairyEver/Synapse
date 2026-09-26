import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_PREVENTION_USAGE_ANALYSIS_METHODS,
  productPreventionUsageAnalysisCapabilities,
} from '../capabilities/product-prevention-usage-analysis.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  ...extra,
})

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  ...extra,
})

const definitions = new Map(productPreventionUsageAnalysisCapabilities.map(definition => [definition.id, definition]))

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '一个公司、场区或栋舍组织节点；SDK保留Portal响应中的其它节点字段。'),
    field('[].id', 'string | number', '组织节点ID；提交统计时只使用当前树中type=4或叶节点的ID。', { constraints: ['保留长ID字符串，不改用名称或数组下标'] }),
    field('[].name', 'string | null', '组织节点名称；仅用于让调用方识别和选择节点。', { nullable: true, nullMeaning: 'Portal未返回节点名称' }),
    field('[].type', 'integer | string | null', 'Portal组织节点类型；type=4是可选栋舍标记，其它类型通常通过child继续展开。', { nullable: true, nullMeaning: 'Portal未返回节点类型' }),
    field('[].child', 'object[]', '下级组织节点；空数组表示当前节点没有下级。'),
    field('[].child[]', 'object', '递归的下级组织节点；其id/name/type/child语义与当前节点相同。'),
    field('[].child[].id', 'string | number', '下级组织节点ID；递归节点仍须保留原始ID。'),
    field('[].child[].name', 'string | null', '下级组织节点名称。', { nullable: true, nullMeaning: 'Portal未返回节点名称' }),
    field('[].child[].type', 'integer | string | null', '下级节点类型；type=4表示可直接提交的栋舍。', { nullable: true, nullMeaning: 'Portal未返回节点类型' }),
    field('[].child[].child', 'object[]', '下级节点的下一层；继续按同一递归结构读取。'),
  ],
  empty: '[]表示Portal当前用户在防疫功能使用分析范围内没有可见公司、场区或栋舍；权限、会话、网络和响应形状错误会抛出。',
}

const rowFields = [
  ['officeName', '公司名称展示值。'],
  ['farmName', '场区名称展示值。'],
  ['buildingName', '栋舍名称展示值。'],
  ['dateStr', '统计时间分组展示值；可能是单日、周或月份范围字符串。'],
  ['whiteDysentery', '白痢功能使用情况展示值，Portal按未记录或记录状态展示。'],
  ['necropsyRecord', '剖检记录使用情况展示值，包含记录数量/状态的后端文本。'],
  ['necropsyImage', '剖检图片使用情况展示值，包含上传数量/状态的后端文本。'],
  ['auscultation', '听诊功能使用情况展示值。'],
  ['other', '其它剖检记录使用情况展示值。'],
  ['microorganismSubmit', '微生物送检使用情况展示值。'],
  ['microorganismAssay', '微生物化验使用情况展示值。'],
  ['antibodySubmit', '抗体送检使用情况展示值。'],
  ['antibodyAssay', '抗体化验使用情况展示值。'],
  ['etiologySubmit', '病原送检使用情况展示值。'],
  ['etiologyAssay', '病原化验使用情况展示值。'],
  ['immunity', '免疫功能使用情况展示值。'],
  ['medication', '投药功能使用情况展示值。'],
  ['disinfection', '消毒功能使用情况展示值。'],
  ['diagnosis', '诊断功能使用情况展示值。'],
] as const

const rowOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '一条防疫功能使用分析统计记录；SDK保留Java PreventionUseSituationDTO字段，不添加Portal页面生成的随机id。'),
    ...rowFields.map(([name, meaning]) => field(`[].${name}`, 'string | null', meaning, { nullable: true, nullMeaning: `后端未返回${name}，或该统计范围没有对应记录` })),
  ],
  empty: '[]表示当前组织、日期和分组条件没有统计记录；权限、业务校验、网络和响应形状错误会抛出。',
}

const queryInputs: Record<string, AiParameter> = {
  buildingList: param('组织树中选中的栋舍ID数组；只提交type=4或叶节点ID，不能为空。', 'product-prevention-usage-analysis-tree[].id，由用户选择可提交栋舍', { type: 'array<string | number>', required: true, constraints: ['不能为空', '按时间分组最多100/200/300个栋舍'] }),
  startDate: param('统计开始日期，含当天，格式YYYY-MM-DD。', '用户选择或页面默认当天', { type: 'string', required: true, format: 'YYYY-MM-DD' }),
  endDate: param('统计结束日期，含当天，格式YYYY-MM-DD且不能早于startDate。', '用户选择或页面默认当天', { type: 'string', required: true, format: 'YYYY-MM-DD' }),
  timeGroup: param('时间分组：1按天、2按周、3按月；Portal选择器发送字符串，SDK也接受对应数字并规范为字符串。', '用户选择', { type: 'string | number', required: true, options: [{ value: '1', label: '按天' }, { value: '2', label: '按周' }, { value: '3', label: '按月' }] }),
  orgGroup: param('组织分组：1按公司、2按场区、3按栋号；Portal选择器发送字符串，SDK也接受对应数字并规范为字符串。', '用户选择', { type: 'string | number', required: true, options: [{ value: '1', label: '按公司' }, { value: '2', label: '按场区' }, { value: '3', label: '按栋号' }] }),
}

const treeContract: AiContract = {
  purpose: '读取防疫功能使用分析页面可见的公司、场区和栋舍组织树，供后续统计查询选择栋舍。',
  whenToUse: '进入防疫功能使用分析页面或需要重新选择统计范围时调用；先取得组织树，再从type=4或叶节点中选择buildingList。',
  effect: 'read',
  inputs: {},
  output: treeOutput,
  consume: [
    '递归展示child；只把type=4或没有child的节点作为可提交栋舍，不能把公司或场区ID直接当作buildingList。',
    '保留返回的ID原值；把用户选择的节点ID交给productPreventionUsageAnalysis.list，并让list重新按Portal和Java规则验证。',
  ],
  boundaries: [
    '页面路径是/dashboard/product/operation/veterinarians/usage-analysis/list，权限码是/dashboard/frame/veterinarians/usage-analysis。',
    '请求使用Portal product axios实例，发送GET /config/farm/getOfficeFarmBuildingTreeByTag?types=1,2，并由product实例补devicetype=PC和module-type=45（防疫管理）；不能省略该数据范围头。',
    'Portal从响应的tree字段或数组读取组织树；SDK保留递归节点和原始ID，不把统计接口的空响应伪造成组织树。',
    '页面的组织树选择、日期、时间分组和组织分组是同一个统计表单；图表/表格切换是本地视图操作，没有额外网络能力。',
  ],
  prerequisites: ['当前会话用户拥有防疫功能使用分析权限，且组织树节点属于当前租户可见范围。'],
  steps: [{
    role: 'optional',
    when: '用户已从组织树选择一个或多个type=4/叶节点并要查询统计',
    capabilityId: 'product-prevention-usage-analysis-list',
    mapping: { buildingList: 'result.[].id' },
    instruction: '只筛选type=4或叶节点的ID组成buildingList，再补齐日期和两个分组参数调用list；不能把公司或场区父节点直接提交。',
  }],
  completion: '返回递归组织树；没有数据时返回空数组，权限、网络或节点形状错误必须抛出。',
  failures: ['会话、权限、网络或响应结构错误原样抛出；不要把请求失败当成空组织树。'],
  idempotency: null,
  evidence: [
    { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/operation/veterinarians/usage-analysis/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、组织树types=1,2、默认值、叶节点选择和统计请求字段。' },
    { source: 'FarmController.getOfficeFarmBuildingTreeByTag', kind: 'reference', note: '核对types参数、PC设备头、权限树返回值和child组织结构。' },
    { source: 'src/capabilities/product-prevention-usage-analysis.ts 与 test/product-prevention-usage-analysis.test.ts', kind: 'implementation', note: '核对SDK请求实例、树响应归一化、字段形状和离线请求断言；不替代真实环境浏览器读请求。' },
    { source: 'docs/pages/防疫功能使用分析.md', kind: 'reference', note: '记录页面四件套和证据边界。' },
  ],
  gaps: ['已逐页核对Portal列表、菜单、Java Controller/VO/Service、SDK实现和离线反证测试；尚未在真实测试环境执行浏览器读请求。'],
}

const listContract: AiContract = {
  purpose: '按选中的栋舍、日期范围、时间分组和组织分组读取防疫功能使用情况统计。',
  whenToUse: 'tree返回并选定合法栋舍、日期和两个分组后调用；一次调用对应Portal点击“查询”，返回结果可同时用于表格和图表。',
  effect: 'read',
  inputs: queryInputs,
  output: rowOutput,
  consume: [
    '使用officeName、farmName、buildingName和dateStr作为分组展示维度；使用其余防疫功能字段填充表格或图表。',
    '[]表示当前条件无统计数据；不要根据某一个字段为空就丢弃整行，按字段的nullMeaning消费。',
  ],
  boundaries: [
    '请求使用product axios实例，发送POST /use/statistics/preventionUseSituation；product实例补devicetype=PC和module-type=45（防疫管理）。',
    '请求体必须包含buildingList、startDate、endDate、timeGroup、orgGroup，并固定附加scope=1、menuName=用户使用情况报表；不能把页面标题或组织名称替换这两个字段。',
    'Portal表单五项均必填；Java还限制按天/周/月日期跨度分别不超过366/1096/1827天、栋舍数分别不超过100/200/300，并限制预计统计数据不超过10000条。',
    'Portal查询前只提交筛选后的type=4或叶节点ID；页面捕获请求异常显示空结果，但SDK保留协议/权限/网络错误，只有后端null/undefined才归一为空数组。',
    '图表与表格切换、表格行的随机id和默认日期是页面本地行为；SDK不生成随机id，也不提供页面不存在的导出或写入能力。Java存在独立导出Controller，但当前Web页没有调用它。',
  ],
  prerequisites: ['已取得当前租户可见的组织树和合法栋舍ID；用户拥有防疫功能使用分析权限。'],
  steps: [],
  completion: '返回与Java PreventionUseSituationDTO字段对齐的统计数组；调用方应按选定条件展示，空数组是合法业务结果。',
  failures: ['日期、分组、栋舍数量或预计数据量超出Portal/Java边界时SDK在发请求前拒绝；会话、权限、网络或后端业务错误抛出。'],
  idempotency: null,
  evidence: [
    { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/operation/veterinarians/usage-analysis/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、默认值、五项必填规则、convertFetchForm请求体、统计字段、错误边界及本地图表/表格切换。' },
    { source: 'UseStatisticsController、PreventionUseVO、PreventionUseSituationDTO、UseStatisticsServiceImpl', kind: 'reference', note: '核对POST路径、scope/menuName字段、Java字段类型、日期/栋舍/10000条边界和统计分组语义。' },
    { source: 'src/capabilities/product-prevention-usage-analysis.ts 与 test/product-prevention-usage-analysis.test.ts', kind: 'implementation', note: '核对SDK请求体、输入边界、结果字段投影和离线反证测试；不替代真实环境浏览器读请求。' },
    { source: 'docs/pages/防疫功能使用分析.md', kind: 'reference', note: '记录页面四件套和证据边界。' },
  ],
  gaps: ['已逐页核对Portal列表、菜单、Java Controller/VO/DTO/Service、SDK实现和离线反证测试；尚未在真实测试环境执行浏览器统计读请求。'],
}

const contracts: Record<string, AiContract> = {
  'product-prevention-usage-analysis-tree': treeContract,
  'product-prevention-usage-analysis-list': listContract,
}

for (const id of Object.keys(contracts)) {
  if (!definitions.has(id)) throw new Error(`防疫功能使用分析契约没有对应能力定义：${id}`)
}

export const PRODUCT_PREVENTION_USAGE_ANALYSIS_AI_CONTRACTS = contracts
export const PRODUCT_PREVENTION_USAGE_ANALYSIS_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_PREVENTION_USAGE_ANALYSIS_METHODS).map(([id, method]) => [
    `productPreventionUsageAnalysis.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为 productPreventionUsageAnalysis.${method}；该页面只有只读能力，不存在prepare、submit、cancel或导出动作。`] },
  ]),
)
