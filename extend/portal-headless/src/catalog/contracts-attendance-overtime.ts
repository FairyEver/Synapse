import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { ATTENDANCE_OVERTIME_METHODS, attendanceOvertimeCapabilities } from '../capabilities/attendance-overtime.js'

const definitions = new Map(attendanceOvertimeCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('applicantId', 'string | number | null', '申请人用户 ID；查看已调休日期时作为 userId', { nullable: true, nullMeaning: '后端未返回申请人 ID' }),
  field('applicantName', 'string | null', '申请人姓名；applicantName 筛选按此字段模糊匹配', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('staffCode', 'string | null', '申请人工号；后端用户 username', { nullable: true, nullMeaning: '后端未返回工号' }),
  field('organizationName', 'string | null', '申请人所属组织完整路径', { nullable: true, nullMeaning: '后端未返回组织' }),
  field('postName', 'string | null', '申请人岗位名称', { nullable: true, nullMeaning: '后端未返回岗位' }),
  field('overtimeHours', 'string | number | null', '通过审批且 subsidyType=0 的加班总时长；单位小时', { nullable: true, nullMeaning: '后端未返回或没有符合条件的加班记录', unit: '小时' }),
  field('remainingRestHours', 'string | number | null', '剩余调休时长；加班总时长减已审批调休时长，负数按0处理并保留两位小数', { nullable: true, nullMeaning: '后端未返回剩余时长', unit: '小时' }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前筛选和分页的加班记录汇总'), field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有记录；total=0 才表示当前筛选没有记录。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('year', 'number | null', '查询使用的年份', { nullable: true, nullMeaning: '后端未回填年份' }),
    field('applicantName', 'string | null', '申请人姓名', { nullable: true, nullMeaning: '用户不存在或后端未返回' }),
    field('organizationName', 'string | null', '申请人所属组织完整路径', { nullable: true, nullMeaning: '用户没有组织或后端未返回' }),
    field('postName', 'string | null', '申请人岗位名称', { nullable: true, nullMeaning: '用户没有岗位或后端未返回' }),
    field('usedRestHours', 'string | number | null', '该用户在查询年份已审批调休的总时长', { nullable: true, nullMeaning: '后端未返回', unit: '小时' }),
    field('restDates', 'string | null', '查询年份已调休日期去重、升序后用“、”连接的展示文本；无记录时为“无”', { nullable: true, nullMeaning: '后端未返回展示文本' }),
    field('restDateList', 'string[] | null', '查询年份已审批调休明细日期列表；同一日期可能因半天记录出现多次', { nullable: true, nullMeaning: '没有调休明细或后端未设置' }),
  ],
  empty: '后端对缺失年份或不存在的用户返回带 year、usedRestHours=0 和 restDates=无的空详情；这不表示存在调休记录。权限、会话、网络或字段形状错误仍抛出。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ bbcfc35154: app/portal/menus/hr.js、views/dashboard/hr/attendance/attendance-overtime/list.vue、components/view-overtime-dates.vue', kind: 'reference', note: '逐页核对姓名/组织筛选、分页 body、列表列、详情弹窗、默认当前年份、年份切换和 detail query。' },
  { source: 'CodeReview_Mall_Platform_Java @ b7a359adc9e: OvertimeApplicationController、OvertimeApplicationServiceImpl、OvertimeApplicationMapper.xml、OvertimeRecordPageReqVO、OvertimeRecordRespVO、OvertimeRecordDetailRespVO', kind: 'reference', note: '核对记录分页和详情端点、审批状态/subsidyType 条件、调休扣减、数据范围和返回字段。' },
  { source: 'src/capabilities/attendance-overtime.ts 与 test/attendance-overtime.test.ts', kind: 'implementation', note: '锁定 Portal 请求体、响应形状、年份/分页反证和静态源码核对；未替代真实环境读请求冒烟。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「组织管理 → 考勤管理 → 加班记录」页面的列表或“查看已调休日期”入口。',
  boundaries: [
    '页面权限是/dashboard/attendance/attendance-overtime；请求使用 platform HTTP 实例和 module-type=11。',
    '页面只有列表和已调休日期详情，没有创建、编辑、删除或审批入口；列表 POST 是读取操作，不要报告成业务写入。',
    'organizationIdList 必须来自 contractSupport.roleOrganizationSearch({ scope: "attendance", keyword }) 的候选 ID；候选搜索必须有关键字，不能无头照搬 Portal 全量组织树。',
    'remainingRestHours 是后端按通过审批的加班小时减已审批调休小时计算的剩余值，单位为小时、负数归零；不要把它解释成工资或加班申请单状态。',
  ],
  prerequisites: ['使用当前用户会话、租户和加班记录页面权限创建 SDK；组织 ID 必须是当前用户角色可见范围内的组织；详情 userId 必须来自列表行 applicantId。'],
  failures: ['年份格式、用户 ID、组织 ID、分页、权限、租户、网络或响应形状错误原样抛出；列表不能以空页替代权限失败。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行加班列表、详情及数据范围拒绝冒烟。'],
})

const inputsFor = (id: string): Record<string, AiParameter> => {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Attendance overtime contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => {
    if (parameter.name === 'applicantName') return [parameter.name, param('姓名模糊筛选；页面初始值为空字符串，省略时按 Portal 表单发送空字符串。', '用户明确提供的姓名筛选', { type: 'string', required: false, default: '空字符串' })]
    if (parameter.name === 'organizationIdList') return [parameter.name, param('角色组织树多选结果的组织 ID 数组；未筛选时发送 []。', 'contractSupport.roleOrganizationSearch({ scope: "attendance", keyword }) 的 list[].id；用户确认选择后组成数组', { type: '(string | number)[]', required: false, default: '[]', lookup: { capabilityId: 'contract-support-role-organization-search', args: { keyword: '$keyword', scope: 'attendance', limit: 20 }, valueField: 'list[].id', labelField: 'list[].name' } })]
    if (parameter.name === 'year') return [parameter.name, param('年份选择器值，YYYY 字符串；页面默认当前年份，用户可以切换到其它年份。', '用户明确选择的年份', { type: 'string', format: 'YYYY', required: false, default: '当前年份', constraints: ['必须是四位年份'] })]
    if (parameter.name === 'userId') return [parameter.name, param('申请人用户 ID；来自 attendance-overtime-list.list[].applicantId。', 'attendance-overtime-list.list[].applicantId', { type: 'string | number', required: true })]
    if (parameter.name === 'pageNo') return [parameter.name, param('从1开始的页码；页面默认1。', '调用方分页状态', { type: 'number', required: false, default: '1', constraints: ['正整数'] })]
    return [parameter.name, param('每页条数；Portal 分页器支持10、20、50、100，默认20。', '调用方分页状态', { type: 'number', required: false, default: '20', constraints: ['只能是10、20、50或100'] })]
  }))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Attendance overtime contract has no capability: ${id}`)
  contracts[id] = value
}

add('attendance-overtime-list', base({
  purpose: '按姓名和角色组织筛选读取当前用户数据范围内的加班记录汇总分页列表。',
  effect: 'read',
  inputs: inputsFor('attendance-overtime-list'),
  output: listOutput,
  consume: ['用 total 判断是否继续翻页；list[].applicantId 是查看已调休日期所需的 userId。', 'remainingRestHours 和 overtimeHours 的单位是小时；它们是汇总值，不是单条申请明细。'],
  steps: [{ role: 'optional', when: '用户要查看某行的已调休日期且 list[].applicantId 非空', capabilityId: 'attendance-overtime-detail', mapping: { userId: 'result.list[].applicantId', year: 'user.selectedYear ?? currentYear' }, instruction: '打开 Portal 同款详情时默认使用当前年份；用户切换年份后重新查询 detail。' }],
  completion: '返回当前筛选的一页加班记录和 total；读取列表不修改加班或调休数据。',
  idempotency: null,
}))

add('attendance-overtime-detail', base({
  purpose: '按申请人和年份读取已审批调休时长及调休日期，供加班记录详情弹窗展示。',
  effect: 'read',
  inputs: inputsFor('attendance-overtime-detail'),
  output: detailOutput,
  consume: ['用 usedRestHours 读取该年份已调休小时数；restDates 直接作为 Portal 展示文本，restDateList 用于需要逐日期处理的调用方。', '年份切换后必须以相同 userId 重新调用 detail；不要复用上一年的日期。'],
  steps: [],
  completion: '取得指定用户和年份的详情快照；restDates=无表示没有已审批调休日期，不是请求失败。',
  idempotency: null,
}))

export const ATTENDANCE_OVERTIME_AI_CONTRACTS = contracts
export const ATTENDANCE_OVERTIME_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(ATTENDANCE_OVERTIME_METHODS).map(([id, method]) => [
    `attendanceOvertime.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法接收一个 query 或 detail input 对象；detail 需要 userId，year 可省略以使用当前年份。'] },
  ]),
)
