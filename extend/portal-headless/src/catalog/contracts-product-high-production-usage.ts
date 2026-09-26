import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_HIGH_PRODUCTION_USAGE_METHODS,
  productHighProductionUsageCapabilities,
} from '../capabilities/product-high-production-usage.js'

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

const definitions = new Map(productHighProductionUsageCapabilities.map(definition => [definition.id, definition]))

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
    field('[].child[].type', 'integer | string | null', '下级组织节点类型；type=4表示可直接提交的栋舍。', { nullable: true, nullMeaning: 'Portal未返回节点类型' }),
    field('[].child[].child', 'object[]', '下级节点的下一层；继续按同一递归结构读取。'),
  ],
  empty: '[]表示Portal当前用户在高产用户使用分析范围内没有可见公司、场区或栋舍；权限、会话、网络和响应形状错误会抛出。',
}

const rowOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '一条高产用户使用情况统计记录；列表和图表共用，SDK不添加页面为表格生成的随机id。'),
    field('[].officeName', 'string | null', '公司/组织名称展示值。', { nullable: true, nullMeaning: '后端未返回公司名称' }),
    field('[].farmName', 'string | null', '场区名称展示值。', { nullable: true, nullMeaning: '后端未返回场区名称' }),
    field('[].buildingName', 'string | null', '栋舍名称展示值。', { nullable: true, nullMeaning: '后端未返回栋舍名称' }),
    field('[].dateStr', 'string | null', '统计分组对应的日期、周或月份展示值；SDK保留后端原字符串。', { nullable: true, nullMeaning: '后端未返回统计日期' }),
    field('[].flockCount', 'number | string | null', '统计范围内的批次/栋舍数量原值；不要把字符串数字擅自转换成整数。', { nullable: true, nullMeaning: '后端未返回数量' }),
    field('[].openingQty', 'number | string | null', '期初数量；Java DTO为Long，SDK同时保留服务端可能返回的数字或字符串。', { nullable: true, nullMeaning: '后端未返回期初数量' }),
    field('[].programCount', 'number | string | null', '计划/程序记录数量原值。', { nullable: true, nullMeaning: '后端未返回数量' }),
    field('[].dailyRecord', 'string | null', '日记录展示值；按Portal原字符串消费。', { nullable: true, nullMeaning: '后端未返回日记录' }),
    field('[].weightRecord', 'string | null', '称重记录展示值；按Portal原字符串消费。', { nullable: true, nullMeaning: '后端未返回称重记录' }),
    field('[].tibiaRecord', 'string | null', '胫骨记录展示值；按Portal原字符串消费。', { nullable: true, nullMeaning: '后端未返回胫骨记录' }),
    field('[].inChickenCount', 'number | string | null', '进鸡数量原值。', { nullable: true, nullMeaning: '后端未返回进鸡数量' }),
    field('[].transferCount', 'number | string | null', '转群数量原值。', { nullable: true, nullMeaning: '后端未返回转群数量' }),
  ],
  empty: '[]表示本次组织、日期和分组条件没有统计记录；页面会显示空图表/空表格。权限、业务校验、网络和响应形状错误会抛出。',
}

const treeContract: AiContract = {
  purpose: '读取高产用户使用分析页面可见的公司、场区和栋舍组织树，供后续统计查询选择栋舍。',
  whenToUse: '进入高产用户使用分析页面或需要重新选择统计范围时调用；先取得组织树，再从type=4或叶节点中选择buildingList。',
  effect: 'read',
  inputs: {},
  output: treeOutput,
  consume: [
    '递归展示child；只把type=4或没有child的节点作为可提交栋舍，不能把公司或场区ID直接当作buildingList。',
    '保留返回的ID原值；把用户选择的节点ID交给productHighProductionUsage.list，并让list重新按Portal规则验证。',
  ],
  boundaries: [
    '页面路径是/dashboard/product/operation/business/usage-chicken/list，权限码是/dashboard/product/operation/business/usage-chicken。',
    '请求使用Portal product axios实例，发送GET /config/farm/getOfficeFarmBuildingTreeByTag?types=1，并由product实例补devicetype=PC；本页面没有module-type。',
    'Portal从响应的tree字段或数组读取组织树；SDK只接受同等数组结构，不把统计接口的空响应伪造成组织树。',
    '页面的组织树选择、日期、时间分组和组织分组是同一个统计表单；图表/表格切换是本地视图操作，没有额外网络能力。',
  ],
  prerequisites: ['当前会话用户拥有高产用户使用分析权限，且组织树节点属于当前租户可见范围。'],
  steps: [{
    role: 'optional',
    when: '用户已从组织树选择一个或多个type=4/叶节点并要查询统计',
    capabilityId: 'product-high-production-usage-list',
    mapping: { buildingList: 'result.[].id' },
    instruction: '只筛选type=4或叶节点的ID组成buildingList，再补齐日期和两个分组参数调用list；不能把公司或场区父节点直接提交。',
  }],
  completion: '返回递归组织树；没有数据时返回空数组，权限、网络或节点形状错误必须抛出。',
  failures: ['会话、权限、网络或响应结构错误原样抛出；不要把请求失败当成空组织树。'],
  idempotency: null,
  evidence: [
    { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/operation/business/usage-chicken/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、组织树types=1、筛选默认值、叶节点选择和统计请求字段。' },
    { source: 'FarmController.getOfficeFarmBuildingTreeByTag', kind: 'reference', note: '核对types参数、PC设备头、权限树返回值和child组织结构。' },
    { source: 'src/capabilities/product-high-production-usage.ts 与 test/product-high-production-usage.test.ts', kind: 'implementation', note: '核对SDK请求实例、树响应归一化、字段形状和离线请求断言；不替代真实环境浏览器读请求。' },
    { source: 'docs/pages/高产用户使用分析.md', kind: 'reference', note: '记录页面四件套和证据边界。' },
  ],
  gaps: ['已逐页核对Portal列表、Java Controller/VO/Service、SDK实现和离线请求断言；尚未在真实测试环境执行浏览器读请求。'],
}

const listContract: AiContract = {
  purpose: '按选中的栋舍、日期范围、时间分组和组织分组读取高产用户使用情况统计。',
  whenToUse: 'tree返回并选定合法栋舍、日期和两个分组后调用；一次调用对应Portal点击“查询”，返回结果可同时用于表格和图表。',
  effect: 'read',
  inputs: {
    buildingList: param('要统计的栋舍ID数组；必须来自tree结果中的type=4或叶节点，不能为空。', 'product-high-production-usage-tree[].id，由用户选择可提交栋舍', { type: 'array', required: true, constraints: ['不能为空', '按Portal时间分组限制：按天最多100个、按周最多200个、按月最多300个栋舍'] }),
    startDate: param('统计开始日期，含当天，格式为YYYY-MM-DD。', '用户选择或页面默认当天', { type: 'string', required: true, format: 'YYYY-MM-DD' }),
    endDate: param('统计结束日期，含当天，格式为YYYY-MM-DD且不能早于startDate。', '用户选择或页面默认当天', { type: 'string', required: true, format: 'YYYY-MM-DD' }),
    timeGroup: param('时间分组：1按天、2按周、3按月；Portal选择器发送字符串，SDK也接受对应数字并规范为字符串。', '用户选择', { type: 'string | number', required: true, options: [{ value: '1', label: '按天' }, { value: '2', label: '按周' }, { value: '3', label: '按月' }] }),
    orgGroup: param('组织分组：1按公司、2按场区、3按栋号；Portal选择器发送字符串，SDK也接受对应数字并规范为字符串。', '用户选择', { type: 'string | number', required: true, options: [{ value: '1', label: '按公司' }, { value: '2', label: '按场区' }, { value: '3', label: '按栋号' }] }),
  },
  output: rowOutput,
  consume: [
    '使用officeName、farmName、buildingName和dateStr作为分组展示维度；使用其余数量/记录字段填充表格或图表。',
    '[]表示当前条件无统计数据；不要根据某一个字段为空就丢弃整行，按字段的nullMeaning消费。',
  ],
  boundaries: [
    '请求使用product axios实例，发送POST /use/statistics/highProductionRecordSituation；product实例补devicetype=PC，页面不发送module-type。',
    '请求体必须包含buildingList、startDate、endDate、timeGroup、orgGroup，并固定附加scope=1、menuName=用户使用情况报表；不能把页面标签或组织名称替换这两个字段。',
    'Portal前端表单五项均必填；Java后端还限制按天/周/月日期跨度分别不超过366/1096/1827天、栋舍数分别不超过100/200/300，并限制预计统计数据不超过10000条。',
    'Portal查询前只提交筛选后的type=4或叶节点ID；页面捕获请求异常显示空结果，但SDK保留协议/权限/网络错误，只有后端返回null/undefined才归一为空数组。',
    '图表与表格切换、表格行的随机id和默认日期是页面本地行为；SDK不生成随机id，也不提供不存在的导出或写入能力。',
  ],
  prerequisites: ['已取得当前租户可见的组织树和合法栋舍ID；用户拥有高产用户使用分析权限。'],
  steps: [],
  completion: '返回与Java ProductionRecordSituationDTO字段对齐的统计数组；调用方应按选定条件展示，空数组是合法业务结果。',
  failures: ['日期、分组、栋舍数量/预计数据量超出Portal/Java边界时SDK在发请求前拒绝；会话、权限、网络或后端业务错误抛出。'],
  idempotency: null,
  evidence: [
    { source: 'app/portal/views/dashboard/product/operation/business/usage-chicken/list.vue', kind: 'reference', note: '逐页核对表单默认值和必填规则、convertFetchForm请求体、统计字段、错误边界及本地图表/表格切换。' },
    { source: 'UseStatisticsController、PreventionUseVO、ProductionRecordSituationDTO、UseStatisticsServiceImpl', kind: 'reference', note: '核对POST路径、scope/menuName字段、Java类型、日期/栋舍/10000条边界和按天/周/月统计语义。' },
    { source: 'src/capabilities/product-high-production-usage.ts 与 test/product-high-production-usage.test.ts', kind: 'implementation', note: '核对SDK请求体顺序、输入边界、结果字段投影和离线反证测试；不替代真实环境浏览器读请求。' },
    { source: 'docs/pages/高产用户使用分析.md', kind: 'reference', note: '记录页面四件套和证据边界。' },
  ],
  gaps: ['已逐页核对Portal列表、Java Controller/VO/Service、SDK实现和离线请求断言；尚未在真实测试环境执行浏览器读请求。'],
}

const contracts: Record<string, AiContract> = {
  'product-high-production-usage-tree': treeContract,
  'product-high-production-usage-list': listContract,
}

for (const id of Object.keys(contracts)) {
  if (!definitions.has(id)) throw new Error(`高产用户使用分析契约没有对应能力定义：${id}`)
}

export const PRODUCT_HIGH_PRODUCTION_USAGE_AI_CONTRACTS = contracts
export const PRODUCT_HIGH_PRODUCTION_USAGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_HIGH_PRODUCTION_USAGE_METHODS).map(([id, method]) => [
    `productHighProductionUsage.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为 productHighProductionUsage.${method}；该页面只有只读能力，不存在prepare、submit、cancel或导出动作。`] },
  ]),
)
