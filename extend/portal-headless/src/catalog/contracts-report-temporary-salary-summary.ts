import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_TEMPORARY_SALARY_SUMMARY_METHODS, reportTemporarySalarySummaryCapabilities } from '../capabilities/report-temporary-salary-summary.js'

const definitions = new Map(reportTemporarySalarySummaryCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })

const summaryFields: AiField[] = [
  field('list[].id', 'string | number', '临时工工资汇总表主键；打开详情时作为summaryId使用'),
  field('list[].useYearMonth', 'string | null', '工资月份，页面按YYYY-MM展示'),
  field('list[].staffCount', 'number | string | null', '本汇总表包含的临时工人数'),
  field('list[].organizationId', 'string | number | null', '汇总所属组织ID；服务端会与当前用户角色组织范围求交集'),
  field('list[].organizationName', 'string | null', '汇总所属部门名称'),
  field('list[].grossSalaryTotal', 'number | string | null', '应发工资总额；服务端BigDecimal按原值返回'),
  field('list[].individualIncomeTaxTotal', 'number | string | null', '个税总额；服务端BigDecimal按原值返回'),
  field('list[].netSalaryTotal', 'number | string | null', '实发工资总额；服务端BigDecimal按原值返回'),
  field('list[].paymentDate', 'string | null', '付款日期；服务端LocalDate序列化文本'),
  field('list[].status', 'number | null', '汇总状态：0待提交、1待审核、2待付款、3已驳回、4已付款', { values: { '0': '待提交', '1': '待审核', '2': '待付款', '3': '已驳回', '4': '已付款' } }),
]

const detailFields: AiField[] = [
  field('list[].id', 'string | number', '临时工工资发放明细主键'),
  field('list[].useYearMonth', 'string | null', '工资月份'),
  field('list[].name', 'string | null', '临时工姓名'),
  field('list[].idCard', 'string | null', '身份证号；敏感字段，按原值处理且不写日志'),
  field('list[].organizationId', 'string | number | null', '明细所属组织ID'),
  field('list[].organizationName', 'string | null', '明细所属部门名称'),
  field('list[].entryDate', 'string | null', '入场日期；服务端LocalDate序列化文本'),
  field('list[].bankAccount', 'string | null', '银行卡号；敏感字段，按原值处理且不写日志'),
  field('list[].openingBank', 'string | null', '开户行'),
  field('list[].attendanceDays', 'number | string | null', '出勤天数'),
  field('list[].dailyValue', 'number | string | null', '日值；服务端金额/数值原值'),
  field('list[].attendanceSalary', 'number | string | null', '出勤工资；服务端金额原值'),
  field('list[].otherSalary', 'number | string | null', '其他工资；服务端金额原值'),
  field('list[].grossSalary', 'number | string | null', '应发工资；服务端金额原值'),
  field('list[].individualIncomeTax', 'number | string | null', '个税；服务端金额原值'),
  field('list[].netSalary', 'number | string | null', '实发工资；服务端金额原值'),
  field('list[].status', 'number | null', '明细使用状态：0未使用、1已使用', { values: { '0': '未使用', '1': '已使用' } }),
]

const pageOutput = (meaning: string, fields: AiField[]): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', meaning), field('total', 'number', '符合当前筛选条件的总记录数，用于翻页'), ...fields],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
})

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`临时工工资发放汇总契约缺少能力：${id}`)
  const inputs: Record<string, AiParameter> = Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'enum' ? 'number' : parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : parameter.kind === 'tree' ? 'string | number' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal临时工工资发放汇总表筛选表单或详情弹窗；请求投影按页面表单规则执行。',
    ...(parameter.options ? { options: parameter.options } : {}),
  }]))
  if (inputs.organizationIdList) {
    inputs.organizationIdList = {
      ...inputs.organizationIdList,
      type: '(string | number)[]',
      nullable: true,
      omitted: '发送[]',
      meaning: '角色组织树多选的组织ID数组；空数组不增加额外组织筛选，但服务端仍按角色组织权限收敛。',
      source: 'Portal角色组织树中已核实的组织ID数组',
    }
  }
  if (inputs.summaryId) {
    inputs.summaryId = {
      ...inputs.summaryId,
      type: 'string | number',
      meaning: '汇总列表返回的list[].id；详情请求映射到temporaryWorkerSalarySummaryId。',
      source: '临时工工资发放汇总列表的list[].id',
    }
  }
  return inputs
}

const gaps = [
  '尚未在真实测试环境执行本页列表与详情浏览器读请求；当前证据来自Portal页面/组件源码、Java Controller/VO/Service/Mapper和离线请求断言。',
  '角色组织树由Portal组件加载；SDK不复制长候选，organizationIdList必须来自当前用户已核实的角色组织候选。',
  '页面“工资支出”只导航到独立流程表单simple/hr/form/016，本页没有对应HTTP请求；该流程表单的提交能力不在本只读页面能力内。',
]

const base = (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries: [
    '只查询当前用户在 /dashboard/report/temporary-salary-summary 权限范围内的临时工工资发放汇总；使用platform实例并发送module-type=14。',
    'organizationIdList为空时只表示不增加额外组织筛选；服务端仍通过getOrgIdListByModuleType并把roleOrganizationIdList与查询条件求交集，不能据此绕过权限。',
    '本页面没有导出按钮；Java存在export-excel端点但Portal没有触发它，SDK不发布不属于当前页面UI的导出能力。',
    '页面“工资支出”按钮只打开simple/hr/form/016流程表单；本页源码没有对应HTTP请求，SDK不把导航伪造成写能力。',
  ],
  effect: 'read',
  prerequisites: ['使用会话token和租户创建SDK；组织ID必须来自当前用户可见的角色组织树。'],
  inputs: inputsOf(id),
  output,
  consume,
  steps: [],
  completion: '返回结构校验通过；按list/total分页消费，total只表示符合筛选条件的总数。',
  failures: ['非法组织ID、月份、状态、页码、页大小或汇总ID在发请求前失败；401/403、网络和后端业务错误原样抛出。', '分页响应缺少list/total会抛错；空列表不是权限判定。', 'idCard和bankAccount属于敏感字段，不应写入日志或无关输出。'],
  idempotency: null,
  evidence: [
    { source: 'src/capabilities/report-temporary-salary-summary.ts', kind: 'implementation', note: '锁定页面权限、module-type、platform实例、列表/详情端点、组织多选/月份/状态参数和响应字段。' },
    { source: 'test/report-temporary-salary-summary.test.ts', kind: 'test', note: '逐项锁定Portal表单、详情弹窗、Java权限范围、请求映射、字段和坏输入。' },
    { source: 'docs/pages/临时工工资发放汇总表.md', kind: 'reference', note: '记录页面字段、状态、组织权限、导航边界和真实环境证据边界。' },
  ],
  gaps,
  ...extra,
})

const contracts: Record<string, AiContract> = {
  'report-temporary-salary-summary-list': base('report-temporary-salary-summary-list', '查询临时工工资发放汇总表。', pageOutput('当前页临时工工资发放汇总记录', summaryFields), [
    '展示部门、人数、工资月份、应发/个税/实发总额、付款日期和状态；金额按服务端原值消费。',
    '页面底部合计只对当前页list的staffCount、grossSalaryTotal、individualIncomeTaxTotal、netSalaryTotal求和，不能把SDK分页结果解释成筛选结果全量合计。',
  ]),
  'report-temporary-salary-summary-detail': base('report-temporary-salary-summary-detail', '查看某张临时工工资发放汇总表的人员明细。', pageOutput('当前页临时工工资发放明细', detailFields), [
    '先从汇总列表取得list[].id，再把该ID作为summaryId调用详情；name只筛选姓名。',
    '展示身份证号、银行卡号等敏感字段时按原值处理，不写日志；total只用于详情分页。',
  ], {
    inputs: inputsOf('report-temporary-salary-summary-detail'),
    steps: [{ role: 'required', when: '需要查看汇总行详情', capabilityId: 'report-temporary-salary-summary-detail', mapping: { summaryId: 'list[].id' }, instruction: '将汇总列表行id映射为summaryId；不要把organizationId或显示名称当作汇总ID。' }],
  }),
}

export const REPORT_TEMPORARY_SALARY_SUMMARY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_TEMPORARY_SALARY_SUMMARY_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_TEMPORARY_SALARY_SUMMARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_TEMPORARY_SALARY_SUMMARY_METHODS).map(([id, method]) => [`reportTemporarySalarySummary.${method}`, REPORT_TEMPORARY_SALARY_SUMMARY_AI_CONTRACTS[id]!]))
