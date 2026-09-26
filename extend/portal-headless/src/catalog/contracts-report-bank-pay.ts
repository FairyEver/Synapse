import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_BANK_PAY_METHODS, reportBankPayCapabilities } from '../capabilities/report-bank-pay.js'

const definitions = new Map(reportBankPayCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })

const listFields = [
  field('list[].salaryMonth', 'string | null', '工资月份；页面按YYYY-MM展示'),
  field('list[].name', 'string | null', '员工姓名'),
  field('list[].fullPath', 'string | null', '部门全路径；页面原样展示'),
  field('list[].idCard', 'string | null', '证件号码；敏感字段，按服务端原值消费'),
  field('list[].cardIssuingBank', 'string | null', '开卡银行'),
  field('list[].bankAccount', 'string | null', '银行账号；敏感字段，按服务端原值消费'),
  field('list[].realPaySalary', 'number | string | null', '实发工资；页面合计按当前页数值求和，不跨页推算'),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '银行代发分页结果'),
    field('list', 'object[]', '当前页记录；不是全量结果'),
    field('total', 'number', '符合筛选条件的记录总数，用于分页'),
    ...listFields,
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；权限或响应形状错误会抛错。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('$', 'object', '导出文件的内存表示'),
    field('fileName', 'string', '服务端文件名；没有响应文件名时使用页面默认名'),
    field('contentType', 'string | null', '响应Content-Type'),
    field('base64', 'string', '文件内容Base64'),
    field('byteLength', 'number', '原始文件字节数'),
  ],
  empty: '空文件响应会抛错。',
}

const gaps = [
  '尚未在真实测试环境执行本页浏览器读请求与导出；当前证据来自Portal页面源码、Java Controller/DTO和离线请求断言。',
  '页面的角色组织树和账套候选由Portal自动加载；SDK不复制全量长候选，orgId与ledgerIds必须使用调用方已核实的ID。',
]

function inputOf (definitionId: string): Record<string, AiParameter> {
  const definition = definitions.get(definitionId)
  if (!definition) throw new Error(`银行代发契约缺少能力定义：${definitionId}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'number' ? 'number' : parameter.kind === 'enum' ? 'number' : parameter.kind === 'date' ? 'string' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal 银行代发页面筛选项或导出弹窗；请求投影按页面 form/convertFetchForm 规则执行。',
    ...(parameter.options ? { options: parameter.options } : {}),
  }]))
}

const queryInputOverrides: Record<string, AiParameter> = {
  orgId: { type: 'string | number', required: false, nullable: true, omitted: "页面清空时发送空字符串，不限制组织", meaning: '角色组织树选中的组织ID；不是组织名称', source: 'Portal 角色组织树已选节点ID' },
  salaryMonth: { type: 'string', required: false, format: 'YYYY-MM', default: '当前月份', omitted: "页面清空时发送空字符串", meaning: '工资月份', source: 'Portal 月份选择器，SDK按页面格式发送' },
  ledgerIds: { type: '(string | number)[]', required: false, default: '[]', omitted: '页面空数组转换为空字符串', meaning: '薪资账套ID数组；请求时按选中顺序连接为逗号字符串', source: 'Portal 账套多选候选中已核实的ID' },
}

function base (id: string, purpose: string, output: AiContract['output'], extra: Partial<AiContract> = {}): AiContract {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`银行代发契约缺少能力：${id}`)
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前Portal用户在 /dashboard/report/bank-pay 权限范围内的银行代发报表；请求使用platform实例并发送module-type=14。',
      '页面是只读查询/导出；SDK不把导出成功当作业务数据写入，也不替调用方推断跨页合计。',
    ],
    effect: 'read',
    prerequisites: ['已用会话token和租户创建SDK；组织与账套ID必须来自调用方已核实的候选。'],
    inputs: { ...inputOf(id), ...queryInputOverrides, ...extra.inputs },
    output,
    consume: ['按返回的list、total或文件字段消费；敏感工资与账号字段按原值处理，不在日志中输出。'],
    steps: [],
    completion: '返回结构校验通过；分页结果交付list/total，导出结果交付非空文件。',
    failures: ['非法月份、ID、页码或页大小在发请求前失败；401/403、网络和后端业务错误原样抛出。', '分页缺少list/total或导出为空文件会抛错。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-bank-pay.ts', kind: 'implementation', note: '锁定页面权限、module-type、form转换、三条GET接口、分页顺序和导出文件处理。' },
      { source: 'test/report-bank-pay.test.ts', kind: 'test', note: '离线锁定Portal真实查询参数、导出参数、银行模式和坏响应。' },
      { source: 'docs/pages/银行代发.md', kind: 'reference', note: '记录Portal页面字段、Java DTO和未进行真实环境smoke的边界。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'report-bank-pay-list': base('report-bank-pay-list', '查询银行代发列表。', pageOutput, {
    inputs: { ...inputOf('report-bank-pay-list'), ...queryInputOverrides },
    consume: ['读取当前页员工姓名、部门、证件、银行账号与实发工资；total只用于分页。', '页面底部合计只针对当前页，不能把它当成筛选结果全量合计。'],
  }),
  'report-bank-pay-export': base('report-bank-pay-export', '按银行代发筛选条件导出普通银行代发表。', fileOutput, {
    inputs: { ...inputOf('report-bank-pay-export'), ...queryInputOverrides },
    consume: ['保存为银行代发表.xlsx；导出请求只发送页面表单字段，不发送分页字段。'],
  }),
  'report-bank-pay-export-by-bank': base('report-bank-pay-export-by-bank', '按页面导出弹窗选择农业银行或建设银行代发表。', fileOutput, {
    inputs: { ...inputOf('report-bank-pay-export-by-bank'), ...queryInputOverrides, mode: { type: 'number', required: true, meaning: '银行导出模式：2农业、3建设', source: 'Portal 导出弹窗', options: [{ value: 2, label: '农业' }, { value: 3, label: '建设' }] } },
    consume: ['mode=2时保存中国农业银行代发表.xlsx；mode=3时保存中国建设银行代发表.xlsx。', 'SDK按Portal规则把模式转换成cardIssuingBank=农业或建设，不把2/3直接发给后端。'],
  }),
}

export const REPORT_BANK_PAY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_BANK_PAY_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_BANK_PAY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_BANK_PAY_METHODS).map(([id, method]) => [`reportBankPay.${method}`, REPORT_BANK_PAY_AI_CONTRACTS[id]!]))
