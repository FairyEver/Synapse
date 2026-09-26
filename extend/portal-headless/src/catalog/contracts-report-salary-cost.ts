import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_SALARY_COST_METHODS, reportSalaryCostCapabilities } from '../capabilities/report-salary-cost.js'

const definitions = new Map(reportSalaryCostCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })

const amountFields: Array<[string, string]> = [
  ['baseSalary', '基本工资'],
  ['evaluateWages', '考核工资'],
  ['overtimeWages', '加班工资'],
  ['educationalSubsidy', '学历补贴'],
  ['seniorityAllowance', '工龄补贴'],
  ['communicationsSubsidy', '通讯补贴'],
  ['closureFee', '封场费'],
  ['laborCosts', '劳动费'],
  ['dutyPay', '值班费'],
  ['otherWages', '其他工资'],
  ['heatFee', '防暑费'],
  ['heat', '取暖费'],
  ['rentalSubsidy', '租房补贴'],
  ['oneChildAllowance', '独生子女补贴'],
  ['otherBenefits', '其他福利'],
  ['bonusSalary', '奖金'],
  ['shouldPay', '应发工资'],
  ['pension', '养老个人'],
  ['jobLess', '失业个人'],
  ['medical', '医疗个人'],
  ['seriousIllness', '大病医疗'],
  ['personalSocialSecurity', '个人社保'],
  ['personalProvidentFund', '个人公积金'],
  ['taxableWages', '应税工资'],
  ['incomeTax', '代扣税'],
  ['otherChargebacks', '其他扣款'],
  ['healthDeduction', '安康扣款'],
  ['totalDeductions', '扣款合计'],
  ['netSalary', '实发工资'],
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '薪资成本汇总分页结果'),
    field('list', 'object[]', '当前页的部门和工资月份汇总记录；不是导出汇总行'),
    field('total', 'number', '符合筛选条件的记录总数；只用于翻页'),
    field('list[].index', 'number | null', '服务端DTO保留的序号字段；Portal表格序号由当前页行下标渲染，不依赖它'),
    field('list[].orgName', 'string | null', '部门名称'),
    field('list[].deptPath', 'string | null', '部门全称/完整路径'),
    field('list[].monthPay', 'string | null', '工资月份，通常为YYYY-M或YYYY-MM的服务端文本'),
    field('list[].level', 'number | null', '部门层级'),
    field('list[].staffNum', 'number | string | null', '该部门和月份的去重员工数'),
    ...amountFields.map(([name, label]) => field(`list[].${name}`, 'number | string | null', `${label}；服务端BigDecimal按原值返回`)),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；账套可见集合为空时服务端也会返回空页。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('$', 'object', '薪资成本汇总Excel导出的内存表示'),
    field('fileName', 'string', '响应Content-Disposition文件名；服务端固定为薪资成本汇总表.xlsx'),
    field('contentType', 'string | null', '响应Content-Type'),
    field('base64', 'string', '原始文件内容Base64'),
    field('byteLength', 'number', '原始文件字节数；必须大于0'),
  ],
  empty: '空文件响应会抛错。',
}

const queryInputs: Record<string, AiParameter> = {
  orgId: { type: 'string | number', required: false, nullable: true, meaning: '角色组织树选中的组织ID；服务端展开为该组织及后代组织范围', source: 'Portal角色组织树中已核实的组织ID', omitted: '发送空字符串；仅叠加服务端DataScope' },
  monthPay: { type: 'string | null', required: false, nullable: true, format: 'YYYY-MM', default: '当前月', meaning: '工资月份；Portal日期控件转换为YYYY-MM', source: 'Portal月份选择器', omitted: '省略使用当前月；显式null或空串发送空字符串' },
  level: { type: 'number | null', required: false, nullable: true, meaning: '部门层级上限；服务端查询level小于等于该值', source: 'Portal层级数字输入框', omitted: '省略或清空发送空字符串，服务端不增加层级条件' },
  ledgerIds: { type: '(string | number)[]', required: false, nullable: true, default: '[]', meaning: '薪资账套ID数组；请求前按页面顺序连接为逗号字符串', source: 'Portal薪资账套多选候选中的已核实ID', omitted: '空数组转换为空字符串；服务端随后使用当前网页可见账套集合' },
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`薪资成本汇总契约缺少能力：${id}`)
  return {
    ...Object.fromEntries(definition.params.map(parameter => [parameter.name, {
      type: parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : parameter.kind === 'tree' ? 'string | number' : 'string',
      required: parameter.required,
      meaning: parameter.description ?? parameter.name,
      source: 'Portal薪资成本汇总页面筛选条件或分页状态。',
    }])),
    ...queryInputs,
  }
}

const gaps = [
  '尚未在真实测试环境执行本页列表和导出请求；当前证据来自Portal菜单/页面、Java Controller/DTO/Service/Mapper/Excel和离线请求断言。',
  '组织树和账套候选由Portal自动加载；SDK不复制全量长候选，调用方必须使用当前会话已核实的ID。',
  '列表返回的是部门/月份分页记录；导出服务端还会按层级追加汇总行，这些汇总行不出现在list响应中。',
]

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只查询当前用户在 /dashboard/report/salary-cost 权限范围内的薪资成本报表；使用platform实例并发送module-type=14。',
      '本页没有创建、编辑、删除、审批或提交动作；SDK不把查询/导出成功解释成工资数据变更。',
      'orgId在Java服务端展开为后代组织，并叠加@DataScope组织权限；省略账套时服务端使用当前网页可见账套集合，不能把空筛选解释成全租户数据。',
    ],
    effect: 'read',
    prerequisites: ['使用会话token和租户创建SDK；组织和账套ID必须来自当前用户可见候选。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: '分页通过list/total校验，或导出得到非空Excel文件；空列表只代表当前筛选无记录。',
    failures: ['非法月份、层级、ID、页码或页大小在请求前失败；401/403、网络和后端业务错误原样抛出。', '分页缺少list/total或导出为空文件会抛错。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-salary-cost.ts', kind: 'implementation', note: '锁定Portal请求路径、年月/层级/账套转换、分页、导出文件和platform/module-type。' },
      { source: 'test/report-salary-cost.test.ts', kind: 'test', note: '离线锁定Portal页面、Java Controller/DTO/Service/Mapper/Excel、参数映射、返回字段和坏输入。' },
      { source: 'docs/pages/薪资成本汇总.md', kind: 'reference', note: '记录页面字段、账套/组织权限、导出汇总行为和真实环境证据边界。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'report-salary-cost-list': base('report-salary-cost-list', '按组织、工资月份、层级和账套条件查询薪资成本汇总。', pageOutput, [
    '按list逐行消费部门名称、部门路径、月份、层级、人数和各项工资/扣款金额；金额按服务端原值消费，不擅自转换浮点精度。',
    'total只用于分页；当前页面没有服务端全量合计行，不能把一页记录相加当成全量成本。',
  ]),
  'report-salary-cost-export': base('report-salary-cost-export', '按薪资成本汇总筛选条件导出Excel。', fileOutput, [
    '导出只发送orgId、monthPay、level、ledgerIds，不发送order、orderField、pageNo、pageSize；下载完成后用byteLength确认文件非空。',
    '导出Excel包含服务端按层级计算的汇总行；用fileName保存为薪资成本汇总表.xlsx，并把这些汇总行与列表分页记录区分。',
  ], { inputs: inputsOf('report-salary-cost-export') }),
}

export const REPORT_SALARY_COST_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_SALARY_COST_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_SALARY_COST_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_SALARY_COST_METHODS).map(([id, method]) => [`reportSalaryCost.${method}`, REPORT_SALARY_COST_AI_CONTRACTS[id]!]))
