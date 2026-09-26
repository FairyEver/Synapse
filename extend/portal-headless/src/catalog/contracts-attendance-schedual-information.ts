import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { ATTENDANCE_SCHEDUAL_INFORMATION_METHODS, attendanceSchedualInformationCapabilities } from '../capabilities/attendance-schedual-information.js'

const definitions = new Map(attendanceSchedualInformationCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('userId', 'string | number | null', '员工用户 ID；打开考勤日历使用该字段', { nullable: true, nullMeaning: '后端未关联系统用户' }),
  field('name', 'string | null', '员工姓名；name 筛选按此字段模糊匹配', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('staffCode', 'string | number | null', '员工工号；staffCode 筛选按此字段模糊匹配', { nullable: true, nullMeaning: '后端未返回工号' }),
  field('postName', 'string | null', '员工岗位名称', { nullable: true, nullMeaning: '后端未返回岗位' }),
  field('organizationName', 'string | null', '员工所属组织名称或路径', { nullable: true, nullMeaning: '后端未返回组织' }),
  field('totalSeniority', 'number | null', '累计工龄原值；页面列表不直接展示', { nullable: true, nullMeaning: '后端未返回工龄' }),
  field('leaveTime', 'string | number | null', '离职时间原值', { nullable: true, nullMeaning: '未离职或后端未返回' }),
  field('retireTime', 'string | number | null', '退休时间原值', { nullable: true, nullMeaning: '未退休或后端未返回' }),
  field('entryTime', 'string | number | null', '入职时间原值', { nullable: true, nullMeaning: '后端未返回入职时间' }),
  field('attendanceGroupStartDate', 'string | null', '考勤组生效日期', { nullable: true, nullMeaning: '后端未返回考勤组日期' }),
  field('shouldAttendanceDays', 'number | null', '按所选月份/年份、入职、离职、退休、考勤组起始日和节假日计算的应出勤天数', { nullable: true, nullMeaning: '后端未计算' }),
  field('actualAttendanceDays', 'number | null', '扣除考勤异常并补回年休等规则后的实际出勤天数', { nullable: true, nullMeaning: '后端未计算' }),
  field('attendanceDays', 'number | null', '所选期间休假/节假日天数', { nullable: true, nullMeaning: '后端未计算' }),
  field('absentListGroupByType', 'object[]', '按 absent_type 标签汇总的异常情况；页面 tooltip 用 typeStr 和 count 展示'),
  field('absentListGroupByType[].typeStr', 'string | null', '异常类型字典标签', { nullable: true, nullMeaning: '字典未找到标签' }),
  field('absentListGroupByType[].count', 'number | null', '该类型异常天数；后端半天记录按2条折算1天', { nullable: true, nullMeaning: '后端未计算', unit: '天' }),
  field('status', 'number | null', '员工状态原码', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('processInstanceId', 'string | null', '异常/审批流程实例 ID（若后端返回）', { nullable: true, nullMeaning: '没有关联流程或后端未返回' }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前月度/年度、组织和人员筛选的员工考勤汇总'), field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有员工；total=0 才表示当前筛选没有员工。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
}

const attendanceFields: AiField[] = [
  field('id', 'string | number | null', '考勤明细记录 ID', { nullable: true, nullMeaning: '节假日虚拟记录或后端未返回' }),
  field('userId', 'string | number | null', '员工用户 ID', { nullable: true, nullMeaning: '节假日虚拟记录或后端未返回' }),
  field('startDate', 'string | null', '考勤/节假日期，YYYY-MM-DD', { nullable: true, nullMeaning: '后端未返回日期' }),
  field('type', 'string | number | null', '异常类型原码；展示时用 absent_type 字典', { nullable: true, nullMeaning: '正常/节假日记录或后端未返回' }),
  field('typeStr', 'string | null', '异常类型标签', { nullable: true, nullMeaning: '字典未找到标签' }),
  field('amPm', 'number | null', '班次时段；1上午、2下午', { nullable: true, nullMeaning: '后端未返回时段' }),
  field('isHoliday', 'number | null', '是否节假日；1是假期、0是非假期', { nullable: true, nullMeaning: '后端未标记' }),
  field('absentResourceId', 'string | null', '异常附件资源 ID 串', { nullable: true, nullMeaning: '没有附件' }),
  field('processInstanceId', 'string | null', '关联流程实例 ID', { nullable: true, nullMeaning: '没有流程或后端未返回' }),
]

const calendarOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('name', 'string | null', '员工姓名', { nullable: true, nullMeaning: '后端未返回' }),
    field('postName', 'string | null', '员工岗位', { nullable: true, nullMeaning: '后端未返回' }),
    field('organizationName', 'string | null', '员工所属组织', { nullable: true, nullMeaning: '后端未返回' }),
    field('finaStartDate', 'string | null', '按入职、考勤组生效日和查询期间裁剪后的日历起始日', { nullable: true, nullMeaning: '后端未计算' }),
    field('finalEndDate', 'string | null', '按离职、退休、查询期间和当前日期裁剪后的日历结束日', { nullable: true, nullMeaning: '后端未计算' }),
    field('attendanceInfoDTOList', 'object[]', '考勤异常、正常关联记录和节假日虚拟记录；日历渲染按 startDate、type、amPm、isHoliday 消费'),
    ...attendanceFields.map(item => ({ ...item, path: `attendanceInfoDTOList[].${item.path}` })),
  ],
  empty: 'attendanceInfoDTOList=[] 表示当前查询月份没有可渲染的考勤记录；不存在员工、未绑定考勤组、未来月份或权限/网络/响应错误仍按异常处理，不降级为空日历。',
}

const absenceOutput: AiContract['output'] = {
  shape: 'undefined (Promise<void>)',
  fields: [field('$', 'undefined', '保存完成后 Portal 接口没有业务回执')],
  empty: 'undefined 是 absenceUser 成功响应的正常 SDK 表示，不是没有保存或失败。必须刷新列表或日历核实写入。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ bbcfc35154: app/portal/menus/hr.js、views/dashboard/hr/attendance/attendance-schedual-information/list.vue、calendar.vue、components/schedual-issues.vue、components/upload-files.vue、components/month-picker.vue', kind: 'reference', note: '逐页核对月度/年度切换、未来日期禁用、列表 body、日历 query、异常处理表单必填/冲突/附件规则、用户选择和提交入口。' },
  { source: 'CodeReview_Mall_Platform_Java @ b7a359adc9e: HrWorkScheduleController、HrWorkScheduleServiceImpl、HrWorkScheduleDao.xml、SelectAttendanceDTO、AbsentUserDTO、AbsentUserByType、UserAttendanceInfoByMonth、UserAttendanceDTO、HrAttendanceUserRelEntity', kind: 'reference', note: '核对月度/年度列表数据范围和计算、日历字段、异常处理逻辑删除/插入、半天拆分、附件资源保存及考勤组约束。' },
  { source: 'src/capabilities/attendance-schedual-information.ts 与 test/attendance-schedual-information.test.ts', kind: 'implementation', note: '锁定 Portal 请求体、日期/班次/附件校验、响应字段、写操作反证和静态源码核对；未替代真实环境读写回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「组织管理 → 考勤管理 → 排班信息」页面的月度/年度查询、员工考勤日历或考勤异常处理入口。',
  boundaries: [
    '页面权限是/dashboard/attendance/attendance-schedual-information；请求使用 platform HTTP 实例和 module-type=11。',
    'timePeriod=1 时调用月度接口并发送 YYYY-MM 对应的 year 与两位 month；timePeriod=2 时调用年度接口并发送 month=null。两种接口由后端同一个服务按 month 是否为空计算期间。',
    'year 和 month 不能选择未来期间；organizationIdList 必须来自 contractSupport.roleOrganizationSearch({ scope: "attendance", keyword }) 的候选 ID。',
    '异常类型展示使用 absent_type 字典；users[].absentUserByTypeList[].type 必须是该字典的真实值，不要猜数字含义。',
    'absenceUser 是实际写操作：后端先逻辑删除同一用户同一天旧记录，再保存新记录；全天会拆成上午、下午两条记录。接口没有 requestId，响应没有业务回执。',
  ],
  prerequisites: ['使用当前用户会话、租户和排班信息页面权限创建 SDK；组织候选先用考勤角色组织搜索；异常处理人员 ID 先用带关键字的 base-user-search；附件先用 base-upload-file 上传到 HR/risk 且页面只接受 application/pdf。'],
  failures: ['未来月份/年份、分页、日期、班次冲突、必需附件、用户 ID、权限、未绑定考勤组、网络或响应形状错误原样抛出；不把空列表当作权限成功。', 'absenceUser 完成后必须重新调用 list 或 calendar 核实；超时先回查，未确认前不要直接重复提交。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行月度/年度列表、日历、异常处理写入及回查。'],
})

const listInputs = (): Record<string, AiParameter> => ({
  timePeriod: param('查询模式；1按月度，2按年度，页面默认1。', '用户明确选择的页面模式', { type: 'number', required: false, default: '1', options: [{ value: 1, label: '按月度' }, { value: 2, label: '按年度' }] }),
  year: param('年份选择器值，YYYY；默认当前年份且不能晚于当前年份。', '用户明确选择的年份', { type: 'string', format: 'YYYY', required: false, default: '当前年份', constraints: ['四位年份', '不晚于当前年份'] }),
  month: param('月度模式的月份值，MM；默认当前月份且不能晚于当前月份；年度模式会发送null。', '用户明确选择的月份；年度模式省略', { type: 'string | null', format: 'MM', required: false, default: '当前月份（年度模式为null）', constraints: ['月度模式01至12', '不能晚于当前月份'] }),
  organizationIdList: param('角色组织树多选结果的组织 ID 数组；未筛选时发送 []。', 'contractSupport.roleOrganizationSearch({ scope: "attendance", keyword }) 的 list[].id；用户确认选择后组成数组', { type: '(string | number)[]', required: false, default: '[]', lookup: { capabilityId: 'contract-support-role-organization-search', args: { keyword: '$keyword', scope: 'attendance', limit: 20 }, valueField: 'list[].id', labelField: 'list[].name' } }),
  name: param('姓名模糊筛选；页面初始值为 null。', '用户输入的姓名', { type: 'string', required: false, nullable: true, omitted: '省略时发送null' }),
  staffCode: param('工号模糊筛选；页面初始值为 null，后端按工号匹配。', '用户输入的工号文本', { type: 'string', required: false, nullable: true, omitted: '省略时发送null' }),
  pageNo: param('从1开始的页码；页面默认1。', '调用方分页状态', { type: 'number', required: false, default: '1' }),
  pageSize: param('每页条数；Portal 分页器支持10、20、50、100，默认20。', '调用方分页状态', { type: 'number', required: false, default: '20', constraints: ['只能是10、20、50或100'] }),
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Attendance schedual information contract has no definition: ${id}`)
  contracts[id] = value
}

add('attendance-schedual-information-list', base({
  purpose: '按月度或年度、组织、姓名和工号读取当前用户数据范围内的员工考勤汇总分页列表。',
  effect: 'read',
  inputs: listInputs(),
  output: listOutput,
  consume: ['用 total 判断是否继续翻页；list[].userId 是考勤日历和异常处理的用户目标。', 'absentListGroupByType[].typeStr/count 只用于页面 tooltip 汇总，不要用它代替 calendar 的逐日明细。'],
  steps: [
    { role: 'optional', when: '用户点击某行“查看考勤日历”且 list[].userId 非空', capabilityId: 'attendance-schedual-information-calendar', mapping: { userId: 'result.list[].userId', yearMonth: 'user.selectedYearMonth' }, instruction: '把列表当前模式的 year-month 快照和同一行 userId 传给日历；日历切换月份后重新调用。' },
    { role: 'optional', when: '用户在月度模式打开“考勤异常处理”', capabilityId: 'attendance-schedual-information-absence-user', mapping: { users: 'user.confirmedUsers' }, instruction: '先让用户用 base-user-search 选定人员并填写每个时段，再提交；列表查询本身不修改异常。' },
  ],
  completion: '返回当前模式和筛选的一页员工考勤汇总；列表读取不修改考勤数据。',
  idempotency: null,
}))

add('attendance-schedual-information-calendar', base({
  purpose: '读取一名员工某月的考勤日历、节假日和异常时段明细。',
  effect: 'read',
  inputs: {
    yearMonth: param('考勤月份 YYYY-MM；来自列表当前选择的年和月，默认当前月份且不能是未来月份。', 'attendance-schedual-information-list 的用户选择', { type: 'string', format: 'YYYY-MM', required: false, default: '当前月份' }),
    userId: param('员工用户 ID；来自列表行 userId，不是工号或 staffCode。', 'attendance-schedual-information-list.list[].userId', { type: 'string | number', required: true }),
  },
  output: calendarOutput,
  consume: ['按 attendanceInfoDTOList[].startDate 绘制日期；isHoliday=1 显示休，isHoliday=0 且没有异常时显示班。', '用 absent_type 将 type/typeStr 显示成异常标签，用 amPm=1/2 显示上午/下午；finaStartDate/finalEndDate 限制有效工作日期范围。'],
  steps: [{ role: 'optional', when: '用户要处理当前员工或其它员工的考勤异常', capabilityId: 'attendance-schedual-information-absence-user', mapping: { users: 'user.confirmedUsers' }, instruction: '异常处理不是日历接口的隐式副作用；单独准备 users 并显式提交。' }],
  completion: '取得指定用户和月份的日历快照；attendanceInfoDTOList 为空才表示没有可渲染明细。',
  idempotency: null,
}))

add('attendance-schedual-information-absence-user', base({
  purpose: '为一名或多名已绑定考勤组的员工保存考勤异常日期、班次和附件。',
  effect: 'write',
  inputs: {
    users: param('人员数组；每项含 userId、可选姓名快照和至少一个 absentUserByTypeList 时段。每个时段含 type、YYYY-MM-DD absentDate、workShiftType 1上午/2下午/3全天和已上传的 absentFileList。', 'base-user-search 返回的用户候选与 base-upload-file 返回的 OSS url/name；用户逐项确认异常类型、日期和班次', { type: '{ userId: string | number, name?: string, absentUserByTypeList: { type: string | number, absentDate: string, workShiftType: 1 | 2 | 3, absentFileList?: { url: string, name: string }[] }[] }[]', required: true, lookup: { capabilityId: 'base-user-search', args: { keyword: '$keyword' }, valueField: 'list[].id', labelField: 'list[].realName' } }),
  },
  output: absenceOutput,
  consume: ['请求完成后必须刷新 attendance-schedual-information-list 或 attendance-schedual-information-calendar 回查；成功响应没有业务回执。', '后端会逻辑删除同一用户同一天旧记录；workShiftType=3 会保存上午和下午两条记录，不能把它当一条半天记录。'],
  steps: [
    { role: 'required', when: '需要选择异常处理人员', capabilityId: 'base-user-search', mapping: { keyword: 'user.keyword' }, instruction: '必须先提供姓名/工号关键字，让用户确认候选 id；不要猜 userId 或把工号传成 userId。' },
    { role: 'required', when: '某个异常时段需要附件', capabilityId: 'base-upload-file', mapping: { path: 'user.localFilePath', folder: 'literal:"HR/risk"', fileName: 'user.fileName', contentType: 'literal:"application/pdf"' }, instruction: '使用返回的 url/name 组成该时段 absentFileList；不要提交本地路径或只提交文件名。' },
    { role: 'required', when: '所有时段校验通过且用户确认保存', capabilityId: 'attendance-schedual-information-absence-user', mapping: { users: 'args.users' }, instruction: '提交后先回查列表或日历；超时先回查，未确认前不要直接重试。' },
  ],
  completion: '列表/日历回查确认新增异常记录和附件已生效；Promise 完成本身不构成写入证据。',
  idempotency: '无 requestId；重复提交会先逻辑删除同用户同日旧记录、再次创建资源和异常记录，超时必须先回查再决定是否重试。Portal 的取消只是关闭弹窗，没有取消接口。',
}))

export const ATTENDANCE_SCHEDUAL_INFORMATION_AI_CONTRACTS = contracts
export const ATTENDANCE_SCHEDUAL_INFORMATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(ATTENDANCE_SCHEDUAL_INFORMATION_METHODS).map(([id, method]) => [
    `attendanceSchedualInformation.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法接收 query、calendar query 或 { users } 对象；absenceUser 不自动添加用户、上传文件或回查。'] },
  ]),
)
