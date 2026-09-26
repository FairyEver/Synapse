import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { ATTENDANCE_ANNUAL_LEAVE_METHODS, attendanceAnnualLeaveCapabilities } from '../capabilities/attendance-annual-leave.js'

const definitions = new Map(attendanceAnnualLeaveCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('userId', 'string | number | null', '员工用户 ID；只读识别字段，不是提交参数', { nullable: true, nullMeaning: '后端未返回用户 ID' }),
  field('name', 'string | null', '员工姓名；列表筛选 name 也是按该字段匹配', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('staffCode', 'string | number | null', '员工工号；后端返回，但 Portal 当前“工号”列误用了 dataIndex=name，页面实际重复显示姓名', { nullable: true, nullMeaning: '后端未返回工号' }),
  field('organizationName', 'string | null', '员工所属组织名称；只读展示', { nullable: true, nullMeaning: '后端未返回组织名称' }),
  field('postName', 'string | null', '员工岗位名称；只读展示', { nullable: true, nullMeaning: '后端未返回岗位名称' }),
  field('workDate', 'string | number | null', '工作日期或工作年限原值；SDK 不擅自转换时区/单位', { nullable: true, nullMeaning: '后端未返回该值' }),
  field('entryTime', 'string | number | null', '入职时间原值；SDK 不擅自转换时区', { nullable: true, nullMeaning: '后端未返回入职时间' }),
  field('year', 'string | number | null', '后端计算使用的年假年份', { nullable: true, nullMeaning: '后端未回填年份' }),
  field('startDate', 'string | number | null', '本年度年假计算起始日期原值', { nullable: true, nullMeaning: '后端未回填起始日期' }),
  field('endDate', 'string | number | null', '本年度年假计算结束日期原值', { nullable: true, nullMeaning: '后端未回填结束日期' }),
  field('shouldYearRestDays', 'number | null', '本年度应休年假天数；单位天', { nullable: true, nullMeaning: '后端未计算应休天数' }),
  field('actualYearRestDays', 'number | null', '本年度已休年假天数；后端按已休半天记录数除以 2 计算，单位天', { nullable: true, nullMeaning: '后端未计算已休天数' }),
  field('remainingAnnualLeaveDays', 'number | null', 'Portal 列表本地计算值：shouldYearRestDays - actualYearRestDays，单位天；不是后端独立字段', { nullable: true, nullMeaning: '应休或已休天数缺失，SDK 不伪造为 0' }),
  field('absentListByYearRest', 'object[]', '点击“查看已休日期”时由 Portal 弹窗直接消费的已休日期快照；SDK 不为该弹窗另发请求'),
  field('absentListByYearRest[].startDate', 'string | null', '已休日期；Portal 弹窗按该原值展示', { nullable: true, nullMeaning: '后端未返回日期' }),
  field('absentListByYearRest[].amPm', 'string | number | null', '半天标记；Portal 仅 amPm===1 显示“上午”，其它非空值按“下午”显示', { nullable: true, nullMeaning: '后端未返回上午/下午标记' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前筛选和页码的年假记录'),
    field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'),
    ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` })),
  ],
  empty: 'list=[] 表示当前页没有记录；total=0 才表示当前筛选没有记录。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string, base64: string, byteLength: number }',
  fields: [
    field('fileName', 'string', '下载文件名；Portal 默认是年假管理表.xlsx，响应有合法 content-disposition 时保留服务端文件名'),
    field('contentType', 'string', '响应 Content-Type；缺失时回退为 XLSX MIME'),
    field('base64', 'string', '导出二进制内容的 Base64；调用方负责保存为文件，不把它当作业务 JSON'),
    field('byteLength', 'number', '原始二进制字节数；必须大于 0'),
  ],
  empty: '空文件、非二进制响应或文件头形状异常会抛出；导出成功只代表生成了文件，不代表修改了年假数据。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ bbcfc35154: app/portal/menus/hr.js、views/dashboard/hr/attendance/attendance-annual-leave.vue、attendance-annual-leave/list.vue、components/view-leave.vue、common/libs/renren/list.js', kind: 'reference', note: '逐页核对菜单路径/权限、姓名/组织/年份表单、分页请求体、列表字段、剩余天数本地计算、已休日期弹窗和导出表单体。' },
  { source: 'CodeReview_Mall_Platform_Java @ b7a359adc9e: HrHolidayController、HrAttendanceGroupServiceImpl、HrWorkScheduleDao.xml、UserAttendanceInfoByMonth、HrAttendanceUserRelEntity', kind: 'reference', note: '核对 getYearRest/exportYearRest POST 端点、数据权限、组织过滤、年份计算、半天折算和导出分页行为。' },
  { source: 'src/capabilities/attendance-annual-leave.ts 与 test/attendance-annual-leave.test.ts', kind: 'implementation', note: '锁定 Portal 请求体、平台 HTTP 上下文、响应校验、导出二进制返回及剩余年假推导；当前是离线反证，不替代真实环境冒烟。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「组织管理 → 考勤管理 → 年假管理」页面的查询或导出入口。',
  boundaries: [
    '页面权限是/dashboard/attendance/attendance-annual-leave；请求使用 platform HTTP 实例和页面 module-type=11，调用方不要另拼权限头或把组织管理范围改成其它页面范围。',
    '列表接口虽然是 POST，但页面没有新建、编辑、删除或审批动作；导出 POST 也只是读取文件，不能按 HTTP 方法把它报告成业务写入。',
    'organizationIdList 必须来自 contractSupport.roleOrganizationSearch({ scope: "attendance", keyword }) 的候选 ID；候选搜索必须有关键字，不能无头照搬 Portal 全量组织树。',
    'Portal 的“工号”列当前错误使用 name；SDK 同时保留后端 staffCode 和页面实际重复姓名的事实，不擅自修正页面显示语义。',
  ],
  prerequisites: ['使用当前用户会话 token、当前租户和年假页面权限创建 SDK；年份不得晚于当前年份，组织 ID 必须是当前用户角色可见范围内的组织。'],
  failures: ['权限、租户、网络或响应形状错误原样抛出；非法年份、组织 ID、分页、空文件和缺少 list/total 不降级为空结果。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行本页浏览器读请求和文件下载冒烟。'],
})

const inputsFor = (id: string): Record<string, AiParameter> => {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Attendance annual leave contract has no definition: ${id}`)
  const result: Record<string, AiParameter> = {}
  for (const parameter of definition.params) {
    if (parameter.name === 'name') result.name = param('姓名模糊筛选；页面初始值为 null，传入字符串时保留用户输入，不自动把空字符串改成其它条件。', '用户明确提供的姓名筛选', { type: 'string', required: false, nullable: true, omitted: '省略时按 Portal 初始表单发送 null' })
    else if (parameter.name === 'organizationIdList') result.organizationIdList = param('角色组织树选中的组织 ID 数组；未筛选时发送 []，不是单个组织 ID。', 'contractSupport.roleOrganizationSearch({ scope: "attendance", keyword }) 的 list[].id；用户确认选择后组成数组', { type: '(string | number)[]', required: false, default: '[]', lookup: { capabilityId: 'contract-support-role-organization-search', args: { keyword: '$keyword', scope: 'attendance', limit: 20 }, valueField: 'list[].id', labelField: 'list[].name' } })
    else if (parameter.name === 'year') result.year = param('年份选择器值，YYYY 字符串；页面默认当前年份且禁止未来年份。', '用户明确选择的年份', { type: 'string', format: 'YYYY', required: false, default: '当前年份', constraints: ['四位年份', '不晚于当前年份'] })
    else if (parameter.name === 'pageNo') result.pageNo = param('从 1 开始的分页页码；Portal 默认 1。', '调用方分页状态', { type: 'number', required: false, default: '1', constraints: ['正整数'] })
    else if (parameter.name === 'pageSize') result.pageSize = param('每页条数；Portal 分页器支持 10、20、50、100，默认 20。', '调用方分页状态', { type: 'number', required: false, default: '20', constraints: ['只能是10、20、50或100'] })
  }
  return result
}

const contracts: Record<string, AiContract> = {}
function add (id: string, contract: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Attendance annual leave contract has no capability: ${id}`)
  contracts[id] = contract
}

add('attendance-annual-leave-list', base({
  purpose: '按 Portal 年份、姓名和角色组织筛选读取年假管理分页列表。',
  effect: 'read',
  inputs: inputsFor('attendance-annual-leave-list'),
  output: pageOutput,
  consume: [
    '用 total 判断是否需要继续翻页；list[].shouldYearRestDays、actualYearRestDays 和 remainingAnnualLeaveDays 的单位都是天。',
    '查看已休日期时直接消费 list[].absentListByYearRest；amPm===1 是上午，其它非空值按 Portal 规则显示下午。',
    '需要文件时将同一组 name、organizationIdList、year 映射给 attendance-annual-leave-export；不要把 pageNo、pageSize 或 order/orderField 传给导出。',
  ],
  steps: [{ role: 'optional', when: '用户要求下载当前筛选的年假表', capabilityId: 'attendance-annual-leave-export', mapping: { name: 'args.name', organizationIdList: 'args.organizationIdList', year: 'args.year' }, instruction: '沿用当前筛选条件调用导出；导出请求不带列表分页参数，返回文件后保存 base64 内容。' }],
  completion: '返回当前筛选的一页和 total；读取成功不等于拥有任何写权限。',
  idempotency: null,
}))

add('attendance-annual-leave-export', base({
  purpose: '按 Portal 当前筛选条件导出年假管理 Excel 文件。',
  effect: 'read',
  inputs: inputsFor('attendance-annual-leave-export'),
  output: fileOutput,
  consume: ['把 base64 解码保存为 fileName；用 byteLength 判断是否获得非空文件。', '这是文件读取能力，不创建、不修改、不删除年假记录；不能用导出成功代替业务写入成功。'],
  steps: [],
  completion: '获得非空年假管理表.xlsx 或服务端提供的合法文件名。',
  idempotency: null,
}))

export const ATTENDANCE_ANNUAL_LEAVE_AI_CONTRACTS = contracts
export const ATTENDANCE_ANNUAL_LEAVE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(ATTENDANCE_ANNUAL_LEAVE_METHODS).map(([id, method]) => [
    `attendanceAnnualLeave.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法接收一个可选 query 对象；注册能力 invoke 也接收同一参数对象。'] },
  ]),
)
