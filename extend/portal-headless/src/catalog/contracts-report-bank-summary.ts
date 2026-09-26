import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_BANK_SUMMARY_METHODS, reportBankSummaryCapabilities } from '../capabilities/report-bank-summary.js'

const definitions = new Map(reportBankSummaryCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })
const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '银行汇总分页结果'),
    field('list', 'object[]', '当前页记录'),
    field('total', 'number', '筛选结果总数'),
    field('list[].cardIssuingBank', 'string | null', '银行名称'),
    field('list[].number', 'number | string | null', '人数'),
    field('list[].salaryMonth', 'string | null', '发放月份'),
    field('list[].realPaySalary', 'number | string | null', '代发金额；按服务端原值消费'),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录。',
}
const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [field('$', 'object', '导出文件内存表示'), field('fileName', 'string', '文件名'), field('contentType', 'string | null', '响应Content-Type'), field('base64', 'string', '文件内容Base64'), field('byteLength', 'number', '文件字节数')],
  empty: '空文件响应会抛错。',
}
const gaps = [
  '尚未在真实测试环境执行浏览器读请求与导出；当前证据来自固定源码、Java Controller/DTO和离线请求断言。',
  '组织树和账套下拉由Portal自动加载，SDK不复制全量候选；调用方必须提供已核实ID。',
]

function inputOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`银行汇总契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal 银行汇总页面条件或分页状态；SDK按页面真实字段顺序发送。',
  }]))
}

const queryInputs: Record<string, AiParameter> = {
  organization: { type: 'string | number', required: false, nullable: true, meaning: '角色组织树选中的组织ID', source: 'Portal角色组织树已选节点ID', omitted: '页面清空时发送空字符串' },
  cardIssuingBank: { type: 'string', required: false, default: "空字符串 ''", meaning: '银行名称模糊筛选', source: 'Portal银行名称输入框' },
  salaryMonth: { type: 'string', required: false, format: 'YYYY-MM', default: '当前月份', meaning: '发放月份', source: 'Portal月份选择器', omitted: '页面清空时发送空字符串' },
  ledgerIds: { type: '(string | number)[]', required: false, default: '[]', meaning: '薪资账套ID数组；请求时连接为逗号字符串', source: 'Portal账套多选候选中的已核实ID', omitted: '空数组转换为空字符串' },
}

function base (id: string, purpose: string, output: AiContract['output'], consume: string[]): AiContract {
  return {
    purpose, whenToUse: purpose,
    boundaries: ['只操作当前用户在 /dashboard/report/bank-summary 权限范围内的只读报表；使用platform实例并发送module-type=14。', '不把当前页统计值当成跨页全量合计。'],
    effect: 'read', prerequisites: ['已用会话token和租户创建SDK；筛选组织/账套ID需先核实。'],
    inputs: { ...inputOf(id), ...queryInputs }, output, consume, steps: [],
    completion: '返回分页结构或非空导出文件。', failures: ['非法ID、月份、页码或页大小在请求前失败；权限、网络和后端错误原样抛出。', '坏分页或空文件响应会抛错。'], idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-bank-summary.ts', kind: 'implementation', note: '锁定页面筛选、月份/账套转换、接口、权限与module-type。' },
      { source: 'test/report-bank-summary.test.ts', kind: 'test', note: '离线锁定查询与导出参数顺序和坏响应。' },
      { source: 'docs/pages/银行汇总.md', kind: 'reference', note: '记录页面与Java证据及真实环境验证边界。' },
    ], gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'report-bank-summary-list': base('report-bank-summary-list', '查询银行汇总列表。', pageOutput, ['按list展示银行名称、人数、发放月份和代发金额；total只用于分页。']),
  'report-bank-summary-export': base('report-bank-summary-export', '按银行汇总页面筛选条件导出Excel。', fileOutput, ['保存为银行汇总.xlsx；导出只发送表单字段，不发送排序和分页字段。']),
}

export const REPORT_BANK_SUMMARY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_BANK_SUMMARY_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_BANK_SUMMARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_BANK_SUMMARY_METHODS).map(([id, method]) => [`reportBankSummary.${method}`, REPORT_BANK_SUMMARY_AI_CONTRACTS[id]!]))
