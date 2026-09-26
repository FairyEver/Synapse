import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_STANDARD_UNIT_INSURANCE_METHODS, reportStandardUnitInsuranceCapabilities } from '../capabilities/report-standard-unit-insurance.js'

const definitions = new Map(reportStandardUnitInsuranceCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })

const amountFields = [
  ['pensionUnitCost', '养老单位缴纳金额'],
  ['unemploymentUnitCost', '失业单位缴纳金额'],
  ['workInjuryUnitCost', '工伤单位缴纳金额'],
  ['maternityUnitCost', '生育单位缴纳金额'],
  ['medicalUnitCost', '医疗单位缴纳金额'],
  ['fiveInsuranceUnitCostTotal', '五险单位合计金额；由服务端DTO按五项单位金额计算'],
  ['providentFundUnitCost', '公积金单位缴纳金额'],
  ['pensionPersonalCost', '养老个人缴纳金额'],
  ['unemploymentPersonalCost', '失业个人缴纳金额'],
  ['medicalPersonalCost', '医疗个人缴纳金额'],
  ['majorMedicalPersonalCost', '大额医疗个人缴纳金额'],
  ['fiveInsurancePersonalCostTotal', '五险个人合计金额；由服务端DTO按四项个人金额计算'],
  ['providentFundPersonalCost', '公积金个人缴纳金额'],
] as const

const output: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '标准化单元五险一金汇总分页结果'),
    field('list', 'object[]', '当前页标准化单元汇总记录'),
    field('total', 'number', '筛选结果总数'),
    field('list[].standardUnitName', 'string | null', '标准化经营单元名称'),
    field('list[].standardUnitId', 'string | number | null', '标准化经营单元ID'),
    field('list[].costMonth', 'string | null', '费用归属月份；页面按YYYY-MM显示'),
    field('list[].fiveInsurancePersonNum', 'number | string | null', '五险人数；服务端按该标准化单元下社保费用记录数统计'),
    field('list[].providentFundPersonNum', 'number | string | null', '公积金人数；服务端按该标准化单元下公积金费用记录数统计'),
    ...amountFields.map(([name, meaning]) => field(`list[].${name}`, 'number | string | null', `${meaning}；服务端BigDecimal按原值返回`)),
    field('list[].costCenterName', 'string | null', '成本中心名称；当前查询SQL未必返回'),
    field('list[].costCenterId', 'string | number | null', '成本中心ID；当前查询SQL未必返回'),
    field('list[].companyBase', 'number | string | null', '单位基数；DTO可承载字段，当前查询SQL未必返回'),
    field('list[].individualBase', 'number | string | null', '个人基数；DTO可承载字段，当前查询SQL未必返回'),
    field('list[].companyRatio', 'number | string | null', '单位比例；DTO可承载字段，当前查询SQL未必返回'),
    field('list[].individualRatio', 'number | string | null', '个人比例；DTO可承载字段，当前查询SQL未必返回'),
    field('list[].month', 'number | null', '月份数值；DTO可承载字段，当前查询SQL未必返回'),
    field('list[].staffCode', 'string | null', '工号；DTO可承载字段，当前查询SQL未必返回'),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断无权限。',
}

const queryInputs: Record<string, AiParameter> = {
  standardUnitId: { type: 'string | number', required: false, nullable: true, meaning: '角色组织树选中的标准化经营单元ID', source: 'Portal角色组织树已选节点ID', omitted: '未选择时发送null' },
  costMonth: { type: 'string', required: false, nullable: true, format: 'YYYY-MM', default: '当前月份', meaning: '费用归属月份', source: 'Portal月份选择器；提交请求前格式化为YYYY-MM', omitted: '清空时发送null；省略参数时按Portal默认当前月份' },
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`标准化单元五险一金契约缺少能力：${id}`)
  return {
    ...queryInputs,
    pageNo: { type: 'number', required: false, meaning: '页码，从1开始', source: 'Portal分页器', omitted: '默认1' },
    pageSize: { type: 'number', required: false, meaning: '每页条数，仅支持Portal页大小选项', source: 'Portal分页器', omitted: '默认20' },
  }
}

const contract: AiContract = {
  purpose: '查询标准化单元维度的五险一金汇总。',
  whenToUse: '需要按Portal的标准化经营单元和费用月份查看五险一金人数及单位/个人金额时使用。',
  boundaries: ['只操作当前用户在 /dashboard/report/insurance-summary 权限范围内的只读报表；使用platform实例并发送module-type=14。', '页面没有导出、创建或修改动作；不要把SDK未提供的写操作臆造为本页能力。'],
  effect: 'read',
  prerequisites: ['使用会话token和租户创建SDK；standardUnitId必须来自当前用户可见的角色组织树。'],
  inputs: inputsOf('report-standard-unit-insurance-list'),
  output,
  consume: ['展示list中的标准化单元、月份、五险人数、公积金人数和各项单位/个人金额；total只用于分页，不把当前页合计误读成全量合计。'],
  steps: [],
  completion: '返回Portal对应的分页结果；空列表表示当前筛选没有可见记录。',
  failures: ['非法标准化单元ID、月份、页码或页大小在请求前失败；权限、网络和后端错误原样抛出。', '后端按标准化单元下级组织聚合社保记录，并按标准化单元成本中心连接公积金记录；数据缺失时相应金额可能为空或为零。'],
  idempotency: null,
  evidence: [
    { source: 'src/capabilities/report-standard-unit-insurance.ts', kind: 'implementation', note: '锁定Portal表单默认值、年月转换、分页参数、返回字段、权限和module-type。' },
    { source: 'test/report-standard-unit-insurance.test.ts', kind: 'test', note: '离线锁定源码、Java DTO/SQL、请求参数、默认月份和坏响应。' },
    { source: 'docs/pages/五险一金汇总表（标准化单元维度）.md', kind: 'reference', note: '记录Portal页面列、Java Controller/DTO/SQL和真实环境验证边界。' },
  ],
  gaps: ['尚未在真实测试环境执行浏览器读请求；当前证据来自Portal页面、Java Controller/DTO/Service/Mapper SQL与离线请求断言。', '标准化经营单元候选由Portal角色组织树加载，SDK不复制候选树；调用方需先取得并核实ID。'],
}

export const REPORT_STANDARD_UNIT_INSURANCE_AI_CONTRACTS: Record<string, AiContract> = {
  'report-standard-unit-insurance-list': contract,
}
export const REPORT_STANDARD_UNIT_INSURANCE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_STANDARD_UNIT_INSURANCE_METHODS).map(([id, method]) => [`reportStandardUnitInsurance.${method}`, REPORT_STANDARD_UNIT_INSURANCE_AI_CONTRACTS[id]!]))
