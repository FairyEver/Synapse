import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_RETIREMENT_SALARY_SUMMARY_METHODS, reportRetirementSalarySummaryCapabilities } from '../capabilities/report-retirement-salary-summary.js'

const definitions = new Map(reportRetirementSalarySummaryCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })

const summaryFields: AiField[] = [
  field('list[].id', 'string | number', '退休工资汇总表主键；打开详情时作为summaryId使用'),
  field('list[].organizationId', 'string | number', '组织ID；来自角色组织范围'),
  field('list[].organizationName', 'string | null', '部门名称/路径快照'),
  field('list[].staffCount', 'number | string | null', '本汇总表包含的退休人员人数'),
  field('list[].useYearMonth', 'string | null', '工资月份，页面按YYYY-MM展示'),
  field('list[].enterpriseSalary', 'number | string | null', '企业工资合计'),
  field('list[].heatingFee', 'number | string | null', '取暖费合计'),
  field('list[].holidayAllowance', 'number | string | null', '节日补贴合计'),
  field('list[].additionalInsurance', 'number | string | null', '附加保险合计'),
  field('list[].subsidy', 'number | string | null', '补助合计'),
  field('list[].transportFee', 'number | string | null', '交通费合计'),
  field('list[].bookFee', 'number | string | null', '书报费合计'),
  field('list[].laborFee', 'number | string | null', '工龄合计'),
  field('list[].laundryFee', 'number | string | null', '洗理费合计'),
  field('list[].medicineFee', 'number | string | null', '药费合计'),
  field('list[].otherFee', 'number | string | null', '其他扣款合计'),
  field('list[].actualAmount', 'number | string | null', '实发金额合计'),
  field('list[].status', 'number | null', '汇总状态：0待提交（草稿）、1已提交审批中、2已审批通过、3已驳回、4已取消'),
]

const detailFields: AiField[] = [
  field('list[].id', 'string | number', '退休人员工资明细主键'),
  field('list[].useYearMonth', 'string | null', '工资月份'),
  field('list[].name', 'string | null', '退休人员姓名'),
  field('list[].idCard', 'string | null', '身份证号；敏感字段，按原值处理'),
  field('list[].organizationName', 'string | null', '部门名称'),
  ...['enterpriseSalary', 'heatingFee', 'holidayAllowance', 'additionalInsurance', 'subsidy', 'transportFee', 'bookFee', 'laborFee', 'laundryFee', 'medicineFee', 'otherFee', 'actualAmount'].map(name => field(`list[].${name}`, 'number | string | null', `退休人员${name}金额；按服务端原值消费`)),
  field('list[].status', 'number | null', '明细状态：0未使用、1已使用'),
]

const pageOutput = (meaning: string, fields: AiField[]): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', meaning), field('total', 'number', '符合当前筛选条件的总记录数，用于翻页'), ...fields],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
})

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`退休人员工资汇总契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'enum' ? 'number' : parameter.kind === 'number' ? 'number' : parameter.kind === 'tree' ? 'string | number' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal 退休人员工资发放汇总表及详情弹窗；请求投影按页面表单规则执行。',
    ...(parameter.options ? { options: parameter.options } : {}),
  }]))
}

const gaps = [
  '尚未在真实测试环境执行本页列表与详情浏览器读请求；当前证据来自Portal页面/组件源码、Java Controller/VO/Service/Mapper和离线请求断言。',
  '页面的角色组织树由Portal组件加载；SDK不复制长候选，organizationId必须来自当前用户已核实的角色组织候选。',
]

const base = (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries: [
    '只查询当前用户在 /dashboard/report/retirement-salary-summary 权限范围内的退休工资汇总；使用platform实例并发送module-type=14。',
    '页面“工资支出”按钮只打开已有 simple/hr/form/015 流程页，本页源码没有对应HTTP请求；SDK不把它伪造成汇总表写能力。',
  ],
  effect: 'read',
  prerequisites: ['使用会话token和租户创建SDK；组织ID必须来自当前用户可见的角色组织树。'],
  inputs: inputsOf(id),
  output,
  consume,
  steps: [],
  completion: '返回结构校验通过；按list/total分页消费，total只表示符合筛选条件的总数。',
  failures: ['非法组织ID、月份、状态、页码或页大小在发请求前失败；401/403、网络和后端业务错误原样抛出。', '分页响应缺少list/total会抛错；空列表不是权限判定。'],
  idempotency: null,
  evidence: [
    { source: 'src/capabilities/report-retirement-salary-summary.ts', kind: 'implementation', note: '锁定页面权限、module-type、platform实例、列表/详情端点、参数转换和响应形状。' },
    { source: 'test/report-retirement-salary-summary.test.ts', kind: 'test', note: '离线锁定Portal表单参数顺序、状态/月格式、详情ID映射和坏响应。' },
    { source: 'docs/pages/退休人员工资发放汇总表.md', kind: 'reference', note: '记录页面字段、当前页合计、组织数据范围和真实环境证据边界。' },
  ],
  gaps,
  ...extra,
})

const contracts: Record<string, AiContract> = {
  'report-retirement-salary-summary-list': base('report-retirement-salary-summary-list', '查询退休人员工资发放汇总表。', pageOutput('当前页退休人员工资汇总记录', summaryFields), [
    '展示部门、人数、工资月份、各金额合计和状态；金额按服务端原值消费。',
    '页面底部合计是当前页list的逐字段合计，不能把SDK分页结果直接解释成筛选结果全量合计。',
  ]),
  'report-retirement-salary-summary-detail': base('report-retirement-salary-summary-detail', '查看某张退休人员工资发放汇总表的人员明细。', pageOutput('当前页退休人员工资明细', detailFields), [
    '先从汇总列表取得list[].id，再把该ID作为summaryId调用详情；name只筛选姓名。',
    '展示身份证号等敏感字段时按原值处理，不写日志；total只用于详情分页。',
  ], {
    inputs: inputsOf('report-retirement-salary-summary-detail'),
    steps: [{ role: 'required', when: '需要查看汇总行详情', capabilityId: 'report-retirement-salary-summary-detail', mapping: { summaryId: 'list[].id' }, instruction: '将汇总列表行id映射为summaryId；不要把organizationId或显示名称当作汇总ID。' }],
  }),
}

export const REPORT_RETIREMENT_SALARY_SUMMARY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_RETIREMENT_SALARY_SUMMARY_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_RETIREMENT_SALARY_SUMMARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_RETIREMENT_SALARY_SUMMARY_METHODS).map(([id, method]) => [`reportRetirementSalarySummary.${method}`, REPORT_RETIREMENT_SALARY_SUMMARY_AI_CONTRACTS[id]!]))
