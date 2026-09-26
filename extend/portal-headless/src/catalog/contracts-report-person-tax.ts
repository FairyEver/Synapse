import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_PERSON_TAX_METHODS, reportPersonTaxCapabilities } from '../capabilities/report-person-tax.js'

const definitions = new Map(reportPersonTaxCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })

const moneyFields = [
  ['baseSalary', '基本工资'],
  ['evaluateWages', '考核工资'],
  ['overtimeWages', '加班工资'],
  ['overtimePay', '节日加班费'],
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
  ['shouldPay', '应发工资'],
  ['pension', '养老个人扣缴'],
  ['jobLess', '失业个人扣缴'],
  ['medical', '医疗个人扣缴'],
  ['personalProvidentFund', '个人公积金'],
  ['taxableWages', '应税工资'],
  ['incomeTax', '个税'],
  ['purchaseHouse', '购房扣款'],
  ['purchaseCar', '购车扣款'],
  ['otherChargebacks', '其他扣款'],
  ['healthDeduction', '安康扣款'],
  ['totalDeductions', '扣款合计'],
  ['houseInterestPrice', '住房贷款利息专项附加扣除'],
  ['houseRentPrice', '住房租金专项附加扣除'],
  ['childEducationPrice', '子女教育专项附加扣除'],
  ['infantCarePrice', '婴幼儿照护专项附加扣除'],
  ['supportOldPrice', '赡养老人专项附加扣除'],
  ['adultEducationPrice', '继续教育专项附加扣除'],
  ['seriousIllness', '大病医疗专项附加扣除'],
  ['bigMedical', '大额医疗；Java DTO可返回但当前Portal表格没有列出'],
  ['totalAdultEducationPrice', '累计继续教育扣除'],
  ['totalSupportOldPrice', '累计赡养老人扣除'],
  ['totalHouseInterestPrice', '累计住房贷款利息扣除'],
  ['totalHouseRentPrice', '累计住房租金扣除'],
  ['totalChildEducationPrice', '累计子女教育扣除'],
  ['totalInfantCarePrice', '累计婴幼儿照护扣除'],
  ['totalAdditionalPrice', '累计专项附加扣除'],
  ['totalPayableTax', '累计应纳税所得额'],
  ['totalPaidTax', '累计已缴纳个税'],
  ['netSalary', '实发工资'],
] as const

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '个人所得税代扣代缴明细分页结果'),
    field('list', 'object[]', '当前页员工月度明细；不是筛选结果全量'),
    field('total', 'number', '符合筛选条件的记录总数；只用于分页'),
    field('list[].index', 'number | null', '服务端DTO可承载的序号；当前Portal使用表格index渲染序号'),
    field('list[].deptPath', 'string | null', '组织全路径'),
    field('list[].name', 'string | null', '员工姓名'),
    field('list[].idCard', 'string | null', '证件号码；敏感字段，按原值消费且不写入日志'),
    field('list[].monthPay', 'string | null', '工资月份；服务端按YYYY-M拼接，页面按年月展示'),
    field('list[].ledgerName', 'string | null', '所属账套；页面声明了该列，但当前Java PersonTaxDetailsDTO未声明此属性，后端未返回时字段缺失或为空'),
    field('list[].post', 'string | null', '岗位'),
    ...moneyFields.map(([name, meaning]) => field(`list[].${name}`, 'number | string | null', `${meaning}；服务端BigDecimal按原值返回`)),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('$', 'object', '导出文件的内存表示'),
    field('fileName', 'string', '服务端Content-Disposition文件名；服务端会按年月、组织和账套动态拼接，缺失响应文件名时回退为页面默认名'),
    field('contentType', 'string | null', '响应Content-Type'),
    field('base64', 'string', '文件内容Base64'),
    field('byteLength', 'number', '原始文件字节数'),
  ],
  empty: '空文件响应会抛错。',
}

const queryInputs: Record<string, AiParameter> = {
  monthPayRange: { type: '[string | null, string | null]', required: false, nullable: true, format: 'YYYY-MM', default: '上月到本月', meaning: '工资年月闭区间；服务端按monthPay>=起始月且endmonthPay<=结束月筛选', source: 'Portal年月范围选择器', omitted: '省略时按页面初始值取上月和本月；显式清空时两个请求字段发送空字符串' },
  orgId: { type: 'string | number', required: false, nullable: true, meaning: '角色组织树选中的组织ID；服务端会扩展该组织的下级组织并叠加数据权限', source: 'Portal角色组织树已选节点ID', omitted: '未选择时发送空字符串，只取消组织筛选，不绕过服务端数据权限' },
  ledgerIds: { type: '(string | number)[]', required: false, default: '[]', meaning: '薪资账套ID数组；按Portal选中顺序连接为逗号字符串', source: 'Portal薪资账套多选候选中的已核实ID', omitted: '空数组发送空字符串；后端会把空值展开为当前可见的全部网页账套' },
}

const fileGaps = [
  '尚未在真实测试环境执行本页浏览器读请求与导出；当前证据来自Portal页面、菜单、Java Controller/DTO/Service/Mapper/Excel类与离线请求断言。',
  '组织树和账套候选由Portal自动加载；SDK不复制全量候选，orgId与ledgerIds必须使用调用方已核实的ID。',
  'Portal页面声明ledgerName列，但当前Java PersonTaxDetailsDTO未声明ledgerName；SDK保留后端未知字段，不能承诺该列一定有值。',
]

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`个人所得税代扣代缴明细契约缺少能力：${id}`)
  return {
    ...Object.fromEntries(definition.params.map(parameter => [parameter.name, {
      type: parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : 'string',
      required: parameter.required,
      meaning: parameter.description ?? parameter.name,
      source: 'Portal个人所得税代扣代缴明细页面筛选条件或分页状态。',
    }])),
    ...queryInputs,
  }
}

function base (id: string, purpose: string, output: AiContract['output'], consume: string[]): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前用户在 /dashboard/report/person-tax 权限范围内的个人所得税只读报表；使用platform实例并发送module-type=14。',
      '页面没有写入或审批动作；SDK不把列表请求或导出成功解释成工资/个税业务状态变更。',
      '页面底部合计由Portal按当前页记录逐字段求和并保留两位小数；SDK返回原始list/total，不伪造跨页合计。',
    ],
    effect: 'read',
    prerequisites: ['使用会话token和租户创建SDK；组织和账套ID必须来自当前用户可见候选。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: '分页结果通过list/total校验，或导出得到非空文件；空列表只代表当前筛选无记录。',
    failures: ['非法组织ID、账套ID、月份、页码或页大小在请求前失败；权限、网络和后端业务错误原样抛出。', '分页缺少list/total或导出为空文件会抛错。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-person-tax.ts', kind: 'implementation', note: '锁定Portal默认月份、monthPayRange转换、账套/组织参数、列表分页、导出文件和权限module-type。' },
      { source: 'test/report-person-tax.test.ts', kind: 'test', note: '离线锁定Portal页面、Java DTO/SQL、请求键序、默认值、导出和坏响应。' },
      { source: 'docs/pages/个人所得税代扣代缴明细.md', kind: 'reference', note: '记录页面逐列基准、服务端数据范围和真实环境验证边界。' },
    ],
    gaps: fileGaps,
  }
}

const contracts: Record<string, AiContract> = {
  'report-person-tax-list': base('report-person-tax-list', '查询个人所得税代扣代缴明细。', pageOutput, [
    '按list逐行展示组织、姓名、证件、年月、账套、岗位及工资/扣除/累计个税字段；金额按服务端原值消费。',
    'total只用于分页；Portal表格底部合计只覆盖当前返回页，不能把它当成筛选条件下的全量合计。',
  ]),
  'report-person-tax-export': base('report-person-tax-export', '按个人所得税代扣代缴明细筛选条件导出Excel。', fileOutput, [
    '导出请求只发送页面表单字段，不发送排序和分页；月份、组织、账套投影与list完全一致。',
    '优先使用返回的fileName保存文件；服务端会把动态筛选条件写入文件名，不能强行覆盖为固定名称。',
  ]),
}

export const REPORT_PERSON_TAX_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_PERSON_TAX_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_PERSON_TAX_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_PERSON_TAX_METHODS).map(([id, method]) => [`reportPersonTax.${method}`, REPORT_PERSON_TAX_AI_CONTRACTS[id]!]))
