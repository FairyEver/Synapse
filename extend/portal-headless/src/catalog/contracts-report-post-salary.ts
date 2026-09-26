import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_POST_SALARY_METHODS, reportPostSalaryCapabilities } from '../capabilities/report-post-salary.js'

const definitions = new Map(reportPostSalaryCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })

const monthlyFields = Array.from({ length: 12 }, (_, index) => {
  const month = index + 1
  return [
    [`basicSalary${month}`, `(${month}月)基本工资`],
    [`assessmentSalary${month}`, `(${month}月)考核工资`],
    [`departmentAssessmentSalary${month}`, `(${month}月)部门考核工资`],
    [`profitAssessmentSalary${month}`, `(${month}月)利润考核工资`],
  ] as const
}).flat()

const output: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '岗位工资统计分页结果'),
    field('list', 'object[]', '当前页员工年度岗位工资统计记录；不是筛选结果全量'),
    field('total', 'number', '符合筛选条件的记录总数；只用于分页'),
    field('list[].sort', 'string | null', '服务端按姓名、年份、所属单位、部门路径、员工号、证件号码排序生成的序号'),
    field('list[].name', 'string | null', '员工姓名'),
    field('list[].year', 'string | null', '工资年份，格式YYYY'),
    field('list[].organizationName', 'string | null', '所属单位名称；注意请求参数同名organizationName实际承载组织ID'),
    field('list[].fullPath', 'string | null', '员工所属部门全路径'),
    field('list[].staffCode', 'string | null', '员工号'),
    field('list[].idCard', 'string | null', '证件号码；敏感字段，按原值消费且不写入日志'),
    ...monthlyFields.map(([name, meaning]) => field(`list[].${name}`, 'number | string | null', `${meaning}；服务端BigDecimal按原值返回，未发生该月工资记录时服务端补零`)),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('$', 'object', '导出文件的内存表示'),
    field('fileName', 'string', '服务端Content-Disposition文件名；服务端按年份、所属单位和账套拼接，缺失时回退为页面默认名'),
    field('contentType', 'string | null', '响应Content-Type'),
    field('base64', 'string', '文件内容Base64'),
    field('byteLength', 'number', '原始文件字节数'),
  ],
  empty: '空文件响应会抛错。',
}

const queryInputs: Record<string, AiParameter> = {
  name: { type: 'string', required: false, nullable: true, meaning: '员工姓名模糊查询；Portal未填写时发送空字符串', source: 'Portal姓名输入框', omitted: '省略时按页面默认空字符串' },
  year: { type: 'string', required: false, nullable: true, format: 'YYYY', default: '当前年份', meaning: '工资年份；Portal年份选择器提交前格式化为YYYY，不能选择晚于当前年份', source: 'Portal年份选择器', omitted: '省略时使用当前年份；显式清空时发送空字符串' },
  organizationId: { type: 'string | number', required: false, nullable: true, meaning: '角色组织树选中的组织ID；Portal/Java请求键名为organizationName，不能传组织名称', source: 'Portal角色组织树已选节点ID', omitted: '未选择时发送空字符串；列表查询不增加组织筛选' },
  ledgerIds: { type: '(string | number)[]', required: false, default: '[]', meaning: '薪资账套ID数组；按Portal选中顺序连接为逗号字符串', source: 'Portal薪资账套多选候选中的已核实ID', omitted: '空数组发送空字符串；列表后端会展开为当前可见的全部网页账套' },
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`岗位工资统计契约缺少能力：${id}`)
  return {
    ...Object.fromEntries(definition.params.map(parameter => [parameter.name, {
      type: parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : 'string',
      required: parameter.required,
      meaning: parameter.description ?? parameter.name,
      source: 'Portal岗位工资统计页面筛选条件或分页状态。',
    }])),
    ...queryInputs,
  }
}

function base (id: string, purpose: string, outputValue: AiContract['output'], consume: string[]): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前用户在 /dashboard/report/post-salary 权限范围内的岗位工资只读报表；使用platform实例并发送module-type=14。',
      '页面没有写入、审批或提交动作；SDK不把列表请求或导出成功解释成工资业务状态变更。',
      'Portal页面底部合计按当前页逐项求和并保留两位小数；SDK返回原始list/total，不伪造跨页合计。',
    ],
    effect: 'read',
    prerequisites: ['使用会话token和租户创建SDK；组织和账套ID必须来自当前用户可见候选。'],
    inputs: inputsOf(id),
    output: outputValue,
    consume,
    steps: [],
    completion: '分页结果通过list/total校验，或导出得到非空文件；空列表只代表当前筛选无记录。',
    failures: [
      '非法组织ID、账套ID、姓名、年份、页码或页大小在请求前失败；权限、网络和后端业务错误原样抛出。',
      '分页缺少list/total或导出为空文件会抛错。',
    ],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-post-salary.ts', kind: 'implementation', note: '锁定Portal默认年份、年份上限、组织字段映射、账套连接、列表分页、导出文件和权限module-type。' },
      { source: 'test/report-post-salary.test.ts', kind: 'test', note: '离线锁定Portal页面、Java Controller/DTO/Service/Mapper/Excel、请求键序、默认值、导出和坏响应。' },
      { source: 'docs/pages/岗位工资统计.md', kind: 'reference', note: '记录页面逐列基准、列表与导出的权限差异、真实环境验证边界。' },
    ],
    gaps: [
      '尚未在真实测试环境执行本页浏览器读请求与导出；当前证据来自Portal页面、菜单、Java Controller/DTO/Service/Mapper/Excel类与离线请求断言。',
      '组织树和账套候选由Portal自动加载；SDK不复制全量候选，organizationId与ledgerIds必须使用调用方已核实的ID。',
      'Java导出服务当前直接把请求里的organizationName当作文件名文本，且未像列表服务一样展开organizationIdList；SDK忠实发送Portal表单，不能承诺带组织筛选的导出一定按组织过滤，需以真实环境核验。',
    ],
  }
}

const contracts: Record<string, AiContract> = {
  'report-post-salary-list': base('report-post-salary-list', '查询岗位工资统计。', output, [
    '按list逐行展示员工身份、单位/部门路径、员工号、证件号码和1至12月每月四项岗位工资；金额按服务端原值消费。',
    'total只用于分页；Portal页面合计只覆盖当前页，不把它当成筛选条件下的全量合计。',
  ]),
  'report-post-salary-export': base('report-post-salary-export', '按岗位工资统计筛选条件导出Excel。', fileOutput, [
    '导出请求只发送name、year、organizationName、ledgerIds四个表单字段，不发送排序和分页；SDK的organizationId会按Portal映射到organizationName。',
    '优先使用返回的fileName保存文件；服务端会把筛选值写入文件名，不能强行覆盖为固定名称。',
    'Java导出实现目前没有复用列表的组织后代展开逻辑；选择组织后若必须保证导出范围，先用列表逐页核对结果并在真实环境验证导出内容。',
  ]),
}

export const REPORT_POST_SALARY_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_POST_SALARY_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_POST_SALARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_POST_SALARY_METHODS).map(([id, method]) => [`reportPostSalary.${method}`, REPORT_POST_SALARY_AI_CONTRACTS[id]!]))
