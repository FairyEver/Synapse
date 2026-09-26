import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { REPORT_SALARY_ITEM_AMOUNT_FIELDS, REPORT_SALARY_ITEM_METHODS, reportSalaryItemCapabilities } from '../capabilities/report-salary-item.js'

const definitions = new Map(reportSalaryItemCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '工资项目统计分页结果'),
    field('list', 'object[]', '当前页的员工工资项目汇总记录；页面序号是当前页行下标，不是后端返回字段'),
    field('total', 'number', '符合筛选条件的记录总数；只用于翻页'),
    field('list[].orgName', 'string | null', '员工所属组织名称'),
    field('list[].name', 'string | null', '员工姓名'),
    field('list[].staffCode', 'number | string | null', '员工号；Java DTO按Long接收，按原始数字或字符串消费'),
    field('list[].startYearMonth', 'string | null', '汇总起始年月，通常为YYYY-MM'),
    field('list[].endYearMonth', 'string | null', '汇总结束年月，通常为YYYY-MM'),
    ...REPORT_SALARY_ITEM_AMOUNT_FIELDS.map(([name, label]) => field(`list[].${name}`, 'number | string | null', `${label}；服务端BigDecimal按原值返回`)),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；当前网页可见账套集合为空时服务端也返回空页。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('$', 'object', '工资项目统计Excel导出的内存表示'),
    field('fileName', 'string', '响应Content-Disposition文件名；服务端通常为部门员工工资项目汇总表.xlsx'),
    field('contentType', 'string | null', '响应Content-Type'),
    field('base64', 'string', '原始文件内容Base64'),
    field('byteLength', 'number', '原始文件字节数；必须大于0'),
  ],
  empty: '空文件响应会抛错。',
}

const queryInputs: Record<string, AiParameter> = {
  organizationId: { type: 'string | number', required: false, nullable: true, meaning: '角色组织树选中的部门ID；服务端展开为该组织及后代组织范围，并叠加数据权限', source: 'Portal角色组织树中已核实的组织ID', omitted: '发送空字符串' },
  name: { type: 'string', required: false, nullable: true, meaning: '员工姓名模糊查询', source: 'Portal姓名输入框', omitted: '发送空字符串' },
  staffCode: { type: 'string | number', required: false, nullable: true, meaning: '员工号；页面输入为文本但Java按Long接收', source: 'Portal员工号输入框', omitted: '发送空字符串', constraints: ['只能是非负数字员工号'] },
  yearMonth: { type: '[string, string] | null', required: false, nullable: true, format: 'YYYY-MM', default: '上月到本月', meaning: '工资项目汇总的起止年月；list显式传空值时遵守Portal的yearMonth required规则，export可按页面无校验行为发送空起止年月', source: 'Portal年月范围选择器', omitted: '省略使用上月到本月；list不能显式省略范围后再提交空值' },
  ledgerIds: { type: '(string | number)[]', required: false, nullable: true, default: '[]', meaning: '薪资账套ID数组；请求前按页面顺序连接为逗号字符串', source: 'Portal薪资账套多选候选中的已核实ID', omitted: '空数组转换为空字符串；服务端随后使用当前网页可见账套集合' },
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`工资项目统计契约缺少能力：${id}`)
  return {
    ...Object.fromEntries(definition.params.map(parameter => [parameter.name, {
      type: parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : parameter.kind === 'tree' ? 'string | number' : 'string',
      required: parameter.required,
      meaning: parameter.description ?? parameter.name,
      source: 'Portal工资项目统计页面筛选条件或分页状态。',
    }])),
    ...queryInputs,
  }
}

const gaps = [
  '尚未在真实测试环境执行本页列表和导出请求；当前证据来自Portal菜单/页面、Java Controller/DTO/Service/Mapper/Excel和离线请求断言。',
  '组织树和账套候选由Portal自动加载；SDK不复制全量长候选，调用方必须使用当前会话已核实的ID。',
  '列表没有后端index字段，Portal序号由当前页行下标渲染；服务端导出会额外生成序号并追加汇总行，不能把导出汇总行当成list记录。',
]

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只查询当前用户在 /dashboard/report/salary-item 权限范围内的工资项目统计；使用platform实例并发送module-type=14。',
      '本页没有创建、编辑、删除、审批或提交动作；SDK不把查询/导出成功解释成工资数据变更。',
      'organizationId由Java服务端展开为后代组织并叠加@DataScope；省略ledgerIds时服务端使用当前网页可见账套集合，不能把空筛选解释成全租户数据。',
      '列表路径是 /salary/report/staffSalaryItemPage，导出路径是 /admin-api/salary/report/exportStaffSalaryItem；两者不能互换。',
    ],
    effect: 'read',
    prerequisites: ['使用会话token和租户创建SDK；组织和账套ID必须来自当前用户可见候选。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: '分页通过list/total校验，或导出得到非空Excel文件；空列表只代表当前筛选无记录。',
    failures: ['非法年月、员工号、ID、页码或页大小在请求前失败；list显式空年月违反Portal required规则时不发请求；401/403、网络和后端业务错误原样抛出。', '分页缺少list/total或导出为空文件会抛错。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/report-salary-item.ts', kind: 'implementation', note: '锁定Portal起止年月、组织/姓名/员工号/账套转换、列表与导出路径、分页、文件和platform/module-type。' },
      { source: 'test/report-salary-item.test.ts', kind: 'test', note: '离线锁定Portal页面、Java Controller/DTO/Service/Mapper/Excel、参数映射、返回字段、表单required规则和坏输入。' },
      { source: 'docs/pages/工资项目统计.md', kind: 'reference', note: '记录页面字段、组织/账套权限、列表与导出差异、汇总行和真实环境证据边界。' },
    ],
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'report-salary-item-list': base('report-salary-item-list', '按部门、姓名、员工号、年月范围和账套条件查询工资项目统计。', pageOutput, [
    '按list逐行消费组织、员工、起止年月和各工资项目汇总金额；金额按服务端原值消费，不擅自转换浮点精度。',
    'total只用于分页；页面序号仅是当前页行下标，不能把当前页金额相加当成全量汇总。',
  ]),
  'report-salary-item-export': base('report-salary-item-export', '按工资项目统计筛选条件导出部门员工工资项目汇总Excel。', fileOutput, [
    '导出只发送organizationId、name、staffCode、startYearMonth、endYearMonth、ledgerIds，不发送order、orderField、pageNo、pageSize；下载完成后用byteLength确认文件非空。',
    '优先使用服务端fileName保存文件；服务端导出会给每行生成序号并追加汇总行，不能把这些汇总行与list分页记录混用。',
  ], { inputs: inputsOf('report-salary-item-export') }),
}

export const REPORT_SALARY_ITEM_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(REPORT_SALARY_ITEM_METHODS).map(id => [id, contracts[id]!]))
export const REPORT_SALARY_ITEM_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(REPORT_SALARY_ITEM_METHODS).map(([id, method]) => [`reportSalaryItem.${method}`, REPORT_SALARY_ITEM_AI_CONTRACTS[id]!]))
