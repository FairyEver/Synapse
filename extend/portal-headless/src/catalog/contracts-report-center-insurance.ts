import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_CENTER_INSURANCE_METHODS, reportCenterInsuranceCapabilities } from '../capabilities/report-center-insurance.js'

const definitions = new Map(reportCenterInsuranceCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })
const amountFields = ['pensionUnitCost', 'unemploymentUnitCost', 'workInjuryUnitCost', 'maternityUnitCost', 'medicalUnitCost', 'fiveInsuranceUnitCostTotal', 'providentFundUnitCost', 'pensionPersonalCost', 'unemploymentPersonalCost', 'medicalPersonalCost', 'majorMedicalPersonalCost', 'fiveInsurancePersonalCostTotal', 'providentFundPersonalCost']
const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', '中心五险一金汇总分页结果'), field('list', 'object[]', '当前页记录'), field('total', 'number', '筛选结果总数'), field('list[].costCenterName', 'string | null', '成本中心名称'), field('list[].costMonth', 'string | null', '费用归属月份；页面按YYYY-MM显示'), field('list[].fiveInsurancePersonNum', 'number | string | null', '五险人数'), field('list[].providentFundPersonNum', 'number | string | null', '公积金人数'), ...amountFields.map(name => field(`list[].${name}`, 'number | string | null', `${name}金额；服务端BigDecimal按原值返回`))],
  empty: 'list=[]且total=0表示当前筛选无记录。',
}
const fileOutput: AiContract['output'] = { shape: '{ fileName, contentType, base64, byteLength }', fields: [field('$', 'object', '导出文件内存表示'), field('fileName', 'string', '文件名'), field('contentType', 'string | null', '响应Content-Type'), field('base64', 'string', '文件内容Base64'), field('byteLength', 'number', '文件字节数')], empty: '空文件响应会抛错。' }
const gaps = ['尚未在真实测试环境执行浏览器读请求与导出；当前证据来自Portal页面、Java Controller/DTO和离线请求断言。', '组织树和成本中心候选由Portal自动加载，SDK不复制全量候选；调用方需提供已核实ID。']
const queryInputs: Record<string, AiParameter> = {
  organizationId: { type: 'string | number', required: false, nullable: true, meaning: '角色组织树选中的组织ID', source: 'Portal角色组织树已选节点ID', omitted: '页面清空时发送空字符串' },
  costMonth: { type: 'string', required: false, format: 'YYYY-MM', default: '当前月份', meaning: '费用归属月份', source: 'Portal月份选择器，后端DTO按日期解析', omitted: '页面清空时发送空字符串' },
  costCenterId: { type: 'string | number', required: false, nullable: true, meaning: '成本中心ID', source: 'Portal成本中心下拉已选ID', omitted: '页面清空时发送空字符串' },
}
function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`中心五险一金契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, { type: parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : 'string', required: parameter.required, meaning: parameter.description ?? parameter.name, source: 'Portal 中心五险一金汇总页面条件或分页状态。' }]))
}
function base (id: string, purpose: string, output: AiContract['output'], consume: string[]): AiContract {
  return { purpose, whenToUse: purpose, boundaries: ['只操作当前用户在 /dashboard/report/center-insurance 权限范围内的只读报表；使用platform实例并发送module-type=14。', '金额按服务端原值解释；页面合计只针对当前页，不能当作全量合计。'], effect: 'read', prerequisites: ['已用会话token和租户创建SDK；组织和成本中心ID需先核实。'], inputs: { ...inputsOf(id), ...queryInputs }, output, consume, steps: [], completion: '返回分页结果或非空导出文件。', failures: ['非法ID、月份、页码或页大小在请求前失败；权限、网络和后端错误原样抛出。', '坏分页或空文件响应会抛错。'], idempotency: null, evidence: [{ source: 'src/capabilities/report-center-insurance.ts', kind: 'implementation', note: '锁定页面筛选转换、接口、权限、module-type和金额列表。' }, { source: 'test/report-center-insurance.test.ts', kind: 'test', note: '离线锁定查询/导出参数、日期格式和坏响应。' }, { source: 'docs/pages/中心五险一金汇总.md', kind: 'reference', note: '记录Portal可见列、Java DTO和真实环境验证边界。' }], gaps }
}
const contracts: Record<string, AiContract> = {
  'report-center-insurance-list': base('report-center-insurance-list', '查询中心五险一金汇总。', pageOutput, ['展示成本中心、月份、人数和单位/个人缴纳金额；total只用于分页。']),
  'report-center-insurance-export': base('report-center-insurance-export', '按中心五险一金汇总筛选条件导出Excel。', fileOutput, ['保存为中心五险一金汇总.xlsx；导出不发送排序和分页字段。']),
}
export const REPORT_CENTER_INSURANCE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_CENTER_INSURANCE_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_CENTER_INSURANCE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_CENTER_INSURANCE_METHODS).map(([id, method]) => [`reportCenterInsurance.${method}`, REPORT_CENTER_INSURANCE_AI_CONTRACTS[id]!]))
