import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_SALARY_BILL_METHODS, REPORT_SALARY_BILL_PAYROLL_FIELDS, reportSalaryBillCapabilities } from '../capabilities/report-salary-bill.js'

const definitions = new Map(reportSalaryBillCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })

const identityFields: AiField[] = [
  field('list[].name', 'string | null', '员工姓名'),
  field('list[].staffCode', 'number | string | null', '员工号；后端DTO按Long接收，页面按文本展示'),
  field('list[].idCard', 'string | null', '身份证号；敏感字段，按原值消费且不写日志'),
  field('list[].costCenterName', 'string | null', '成本中心名称'),
  field('list[].legalPersonName', 'string | null', '纳税单位名称'),
  field('list[].payrollUnit', 'string | null', '发薪单位名称'),
  field('list[].postName', 'string | null', '岗位名称'),
  field('list[].orgName', 'string | null', '部门全路径'),
  field('list[].documentName', 'string | null', '工资单据名称'),
  field('list[].ledgerName', 'string | null', '所属账套名称'),
  field('list[].salaryYearMonth', 'string | null', '工资年月'),
  field('list[].bankAccount', 'string | null', '银行账号；敏感字段，按原值消费且不写日志'),
  field('list[].bankName', 'string | null', '开户行'),
  field('list[].shouldAttendanceDays', 'number | null', '当月应出勤天数'),
  field('list[].actualAttendanceDays', 'number | null', '实际出勤天数'),
  field('list[].month', 'number | null', '后端DTO附带的工资月份数字；页面不单独展示'),
]

const output: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前页工资单记录；不是筛选结果全量'),
    field('total', 'number', '符合筛选条件的记录总数；只用于翻页'),
    ...identityFields,
    ...REPORT_SALARY_BILL_PAYROLL_FIELDS.map(([name, label]) => field(`list[].${name}`, 'number | string | null', label)),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('$', 'object', '工资单Excel导出的内存表示'),
    field('fileName', 'string', '服务端Content-Disposition文件名；包含年月、组织或账套时由服务端拼接'),
    field('contentType', 'string | null', '响应Content-Type'),
    field('base64', 'string', '原始文件内容Base64'),
    field('byteLength', 'number', '原始文件字节数；必须大于0'),
  ],
  empty: '空文件响应会抛错。',
}

const queryInputs: Record<string, AiParameter> = {
  yearMonth: { type: 'string | null', required: false, nullable: true, format: 'YYYY-MM', default: '当前月', meaning: '工资年月；Portal先用月份控件选择，SDK随后拆成year=YYYY和month=MM', source: 'Portal年月选择器', omitted: '省略使用当前月；显式null或空串时year/month都发送空串' },
  name: { type: 'string', required: false, nullable: true, meaning: '员工姓名模糊查询', source: 'Portal姓名输入框', omitted: '发送空字符串' },
  staffCode: { type: 'string | number', required: false, nullable: true, meaning: '员工号；页面输入文本但Java ReportPayrollSelectDTO按Long接收', source: 'Portal员工号输入框', constraints: ['只能是数字员工号'] },
  costCenterId: { type: 'string | number', required: false, nullable: true, meaning: '成本中心ID；页面formState保留该字段但当前模板没有可见输入控件', source: '页面隐藏表单状态或已核实ID' },
  legalPersonId: { type: 'string | number', required: false, nullable: true, meaning: '纳税单位ID，不是单位名称', source: 'Portal法人候选中的已核实ID' },
  payrollUnitId: { type: 'string | number', required: false, nullable: true, meaning: '发薪单位组织ID，不是组织名称', source: 'Portal角色组织树中的已核实ID' },
  postId: { type: 'string | number', required: false, nullable: true, meaning: '岗位ID；岗位组件内部先选择组织岗位节点，再把节点的postId作为此字段提交', source: 'Portal岗位组件update:select事件' },
  organizationId: { type: 'string | number', required: false, nullable: true, meaning: '部门组织ID；服务端将其展开为后代组织范围并叠加数据权限', source: 'Portal角色组织树中的已核实ID' },
  documentName: { type: 'string', required: false, nullable: true, meaning: '工资单据名称模糊查询', source: 'Portal单据名称输入框', omitted: '发送空字符串' },
  ledgerId: { type: 'string | number', required: false, nullable: true, meaning: '所属账套ID，不是账套名称；省略时后端按当前网页可见账套集合查询', source: 'Portal薪资账套候选中的已核实ID' },
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`工资单查询契约缺少能力：${id}`)
  return {
    ...Object.fromEntries(definition.params.map(parameter => [parameter.name, {
      type: parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : parameter.kind === 'tree' ? 'string | number' : 'string',
      required: parameter.required,
      meaning: parameter.description ?? parameter.name,
      source: 'Portal工资单查询页面筛选条件或分页状态。',
    }])),
    ...queryInputs,
  }
}

const gaps = [
  '尚未在真实测试环境执行本页列表和导出请求；当前证据来自Portal菜单/列表源码、Java Controller/DTO/Service/Mapper/Excel和离线请求断言。',
  '纳税单位、发薪单位、岗位、部门和账套候选由Portal组件或页面状态加载；SDK不复制全量长候选，调用方必须使用当前会话已核实的ID。',
  '页面底部合计只对当前页记录逐字段求和并格式化；SDK不把该展示值伪造为服务端全量汇总字段。',
]

function base (id: string, purpose: string, outputValue: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只查询当前用户在 /dashboard/report/salary-bill 权限范围内的工资单；使用platform实例并发送module-type=14。',
      '本页没有创建、编辑、删除、审批或提交动作；SDK不把列表/导出成功解释成工资状态变更。',
      'organizationId由Java服务端展开为后代组织并叠加DataScope；省略ledgerId时服务端使用当前网页可见账套集合，不能把空筛选解释成全租户数据。',
    ],
    effect: 'read',
    prerequisites: ['使用会话token和租户创建SDK；组织、法人、岗位和账套ID必须来自当前用户可见候选。'],
    inputs: inputsOf(id),
    output: outputValue,
    consume,
    steps: [],
    completion: '分页通过list/total校验，或导出得到非空文件；空列表只代表当前筛选无记录。',
    failures: ['非法年月、员工号、ID、页码或页大小在请求前失败；401/403、网络和后端业务错误原样抛出。', '分页缺少list/total或导出为空文件会抛错。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-salary-bill.ts', kind: 'implementation', note: '锁定Portal年月拆分、隐藏状态字段、筛选参数、分页、导出文件和platform/module-type。' },
      { source: 'test/report-salary-bill.test.ts', kind: 'test', note: '离线锁定Portal页面、Java Controller/DTO/Service/Mapper/Excel、参数映射、响应和坏输入。' },
      { source: 'docs/pages/工资单查询.md', kind: 'reference', note: '记录页面字段、筛选权限、当前页合计和真实环境证据边界。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'report-salary-bill-list': base('report-salary-bill-list', '按年月和组织/人员/单据/账套条件查询工资单。', output, [
    '按list逐行展示员工身份、组织、单据、账套、银行信息、出勤天数和工资/扣款字段；金额按服务端原值消费。',
    'total只用于分页；页面底部合计仅覆盖当前页，不能把SDK返回的total或当前页求和当成全量合计。',
  ]),
  'report-salary-bill-export': base('report-salary-bill-export', '按工资单查询筛选条件导出Excel。', fileOutput, [
    '导出只发送筛选字段和拆分后的year/month，不发送order、orderField、pageNo、pageSize；下载完成后用byteLength确认文件非空。',
    '优先使用服务端fileName保存文件；服务端文件名可能包含年月、组织和账套名称，不能强行覆盖为固定名称。',
  ], { inputs: inputsOf('report-salary-bill-export') }),
}

export const REPORT_SALARY_BILL_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_SALARY_BILL_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_SALARY_BILL_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_SALARY_BILL_METHODS).map(([id, method]) => [`reportSalaryBill.${method}`, REPORT_SALARY_BILL_AI_CONTRACTS[id]!]))
