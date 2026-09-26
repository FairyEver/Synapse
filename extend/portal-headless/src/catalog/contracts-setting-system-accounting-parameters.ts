import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_SYSTEM_ACCOUNTING_PARAMETERS_METHODS, settingSystemAccountingParametersCapabilities } from '../capabilities/setting-system-accounting-parameters.js'

const definitions = new Map(settingSystemAccountingParametersCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: false, omitted, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '系统核算参数主键；Long 可能序列化为字符串，不能当作行号或名称'),
  field('name', 'string | null', '参数名称', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('source', 'integer | null', '参数来源；1=组织系统，2=绩效系统，3=薪酬系统', { nullable: true, nullMeaning: '后端未返回来源', values: { '1': '组织系统', '2': '绩效系统', '3': '薪酬系统' } }),
  field('remark', 'string | null', '参数备注', { nullable: true, nullMeaning: '未填写备注或后端未返回' }),
  field('tableName', 'string | null', '薪资计算读取的数据表或来源表达式', { nullable: true, nullMeaning: '后端未返回表名' }),
  field('columnName', 'string | null', '薪资计算读取的数据列或表达式', { nullable: true, nullMeaning: '后端未返回列名' }),
  field('staffCodeName', 'string | null', '来源表中员工号字段名', { nullable: true, nullMeaning: '后端未返回员工号字段名' }),
  field('filterSql', 'string | null', '薪资计算读取数据时使用的筛选片段', { nullable: true, nullMeaning: '后端未返回筛选片段' }),
  field('isDel', 'integer | null', '删除标记；0=未删除，1=已删除', { nullable: true, nullMeaning: '后端未返回删除标记', values: { '0': '未删除', '1': '已删除' } }),
  field('creator', 'string | number | null', '创建人主键；Long 可能序列化为字符串', { nullable: true, nullMeaning: '后端未返回创建人' }),
  field('createTime', 'string | number | null', '创建时间原值；SDK 不做时区转换', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('updater', 'string | number | null', '修改人主键；Long 可能序列化为字符串', { nullable: true, nullMeaning: '后端未返回修改人' }),
  field('updateTime', 'string | number | null', '修改时间原值；SDK 不做时区转换', { nullable: true, nullMeaning: '后端未返回修改时间' }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页系统核算参数记录'), field('total', 'number', '符合后端查询条件的总条数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 且 total=0 表示接口返回空分页；权限、网络或响应形状错误会抛出，不能降级为空页。',
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/hr.js、app/portal/views/dashboard/hr/setting/system-accounting-parameters.vue、list.vue @ bbcfc35154', kind: 'reference', note: '证明菜单路径和权限、crud 列表外壳、query1 表单、/salary/parameter/page、分页和页面实际展示列。' },
  { source: 'SalarySysCalculateParameterController、SalarySysCalculateParameterSelectDTO、SalarySysCalculateParameterDTO、SalarySysCalculateParameterServiceImpl @ b7a359adc9e', kind: 'reference', note: '证明 page 端点、name/source 后端 DTO 字段、响应完整字段和服务端分页语义；当前 Portal 页面实际只提交 query1。' },
  { source: 'src/capabilities/setting-system-accounting-parameters.ts 与 test/setting-system-accounting-parameters.test.ts', kind: 'implementation', note: '证明 SDK 复刻 Portal 请求、完整行字段、分页校验和错误传播；不替代真实环境读请求。' },
]

const contracts: Record<string, AiContract> = {}
const queryInputs: Record<string, AiParameter> = {
  query1: optional('Portal 页面唯一的条件1文本。', '用户在系统核算参数页面输入框中的文本', 'SDK 发送空字符串；Portal 当前并未把它改名为后端 DTO 的name字段', { type: 'string', nullable: true }),
  pageNo: optional('从1开始的页码。', 'Portal 分页状态', 'SDK 使用1', { type: 'number', constraints: ['正整数'] }),
  pageSize: optional('当前页条数。', 'Portal 分页状态', 'SDK 使用20', { type: 'number', constraints: ['只能是10、20、50或100'] }),
}

function add (id: string, contract: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Setting system accounting parameters contract has no definition: ${id}`)
  contracts[id] = contract
}

add('setting-system-accounting-parameters-list', {
  purpose: '读取 Portal“系统设置 → 系统核算参数”页面的分页记录。',
  whenToUse: '用户需要查看该页面当前显示的系统核算参数、来源或备注时使用。',
  boundaries: [
    '只覆盖当前 Portal 页面可达的只读分页；虽然 Java Controller 还存在 list、get、save、update、delete、export，但当前页面没有这些按钮或调用，不发布为本页能力。',
    '页面通过 platform HTTP 实例请求，页面路径不命中 module-type 规则，SDK 与 Portal 一样不发送 module-type；租户和权限由绑定会话决定。',
    'Portal 表单字段名是 query1，SDK 保留这个真实请求形状；后端分页 DTO 只声明 name、source，当前页面没有把 query1 映射到它们，SDK 不擅自宣称 query1 会过滤 name。',
    '返回行保留 Java DTO 的完整字段；页面当前主要展示 name、source、remark，tableName 等内部计算字段不能从空值或页面未展示推断。',
  ],
  effect: 'read',
  prerequisites: ['使用当前用户会话 token、当前租户和 `/dashboard/setting/system-accounting-parameters` 权限；不能把空页当作权限成功。'],
  inputs: queryInputs,
  output: listOutput,
  consume: [
    '按 total 和 pageNo/pageSize 翻页；展示 source 时按值解释1=组织系统、2=绩效系统、3=薪酬系统。',
    '保留 list[].id；本页没有可达编辑、删除、导出或详情动作，不要仅凭返回字段自行调用 Java Controller 的隐藏端点。',
    'query1 只是 Portal 实际发送的字段；若用户要求按名称/来源筛选，应先说明当前页面请求没有提供对应 name/source 参数，不把 query1 的回包误报为已过滤。',
  ],
  steps: [],
  completion: '返回当前 Portal 请求形状对应的一页和 total；这只证明读取成功，不证明后端 name/source 筛选已生效。',
  failures: ['分页响应缺 list/total、行字段类型错误、权限、网络或后端错误原样报告；不能降级为空页。'],
  idempotency: null,
  evidence,
  gaps: ['已完成 Portal 菜单、路由外壳、列表源码与 Java Controller/DTO/Service 的逐页静态核对，并用离线 request stub 锁定请求形状；尚未在真实测试环境执行本页浏览器读请求。'],
})

export const SETTING_SYSTEM_ACCOUNTING_PARAMETERS_AI_CONTRACTS = contracts
export const SETTING_SYSTEM_ACCOUNTING_PARAMETERS_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_SYSTEM_ACCOUNTING_PARAMETERS_METHODS).map(([id, method]) => [`settingSystemAccountingParameters.${method}`, { ...SETTING_SYSTEM_ACCOUNTING_PARAMETERS_AI_CONTRACTS[id]!, boundaries: [...SETTING_SYSTEM_ACCOUNTING_PARAMETERS_AI_CONTRACTS[id]!.boundaries, '直接方法签名使用单个查询对象参数；query1、pageNo、pageSize 的省略语义见 inputs。'] }]),
)
