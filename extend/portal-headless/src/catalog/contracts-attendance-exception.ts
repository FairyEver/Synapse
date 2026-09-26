import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { ATTENDANCE_EXCEPTION_METHODS, attendanceExceptionCapabilities } from '../capabilities/attendance-exception.js'

const definitions = new Map(attendanceExceptionCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const attachmentFields = [
  field('url', 'string', 'OSS 文件访问地址；由 base-upload-file 上传后的 url 提供，不能传本地路径'),
  field('name', 'string', '附件文件名；Portal 上传组件保存的 fileName'),
]

const rowFields: AiField[] = [
  field('userId', 'string | number | null', '异常员工用户 ID；只读识别字段', { nullable: true, nullMeaning: '后端关联用户缺失' }),
  field('name', 'string | null', '员工姓名；name 筛选按此字段模糊匹配', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('staffCode', 'string | number | null', '员工工号；staffCode 筛选按此字段模糊匹配', { nullable: true, nullMeaning: '后端未返回工号' }),
  field('organizationName', 'string | null', '员工所属组织名称', { nullable: true, nullMeaning: '后端未返回组织名称' }),
  field('leaveTime', 'string | number | null', '员工离职时间原值；页面列表不直接展示但后端可能返回', { nullable: true, nullMeaning: '未离职或后端未返回' }),
  field('retireTime', 'string | number | null', '员工退休时间原值；页面列表不直接展示但后端可能返回', { nullable: true, nullMeaning: '未退休或后端未返回' }),
  field('entryTime', 'string | number | null', '本单位入职时间原值', { nullable: true, nullMeaning: '后端未返回入职时间' }),
  field('absentId', 'string | number | null', '缺勤记录 ID；查看详情和上传附件都使用该 ID', { nullable: true, nullMeaning: '行没有可操作的缺勤记录' }),
  field('absentResourceId', 'string | null', '附件资源 ID 串；Portal 用是否为空判断“是否上传附件”', { nullable: true, nullMeaning: '未上传附件' }),
  field('type', 'string | number | null', '考勤异常类型原码；页面用 absent_type 字典翻译', { nullable: true, nullMeaning: '后端未返回类型' }),
  field('processInstanceId', 'string | null', '关联审批流程实例 ID；不等于 absentId，存在时上传附件会同步该流程的相关异常记录', { nullable: true, nullMeaning: '该异常不是流程实例记录或后端未返回' }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前筛选和分页的异常员工记录'), field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有记录；total=0 才表示筛选范围没有记录。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('id', 'string | number | null', '异常记录 ID；当前后端详情实现可能不回填该字段', { nullable: true, nullMeaning: '后端只用 absentId 查询，没有回填 id' }),
    field('name', 'string | null', '异常员工姓名', { nullable: true, nullMeaning: '异常记录不存在或后端未返回' }),
    field('amPm', 'number | null', '半天标记；Portal 仅值1显示上午，其它非空值显示下午', { nullable: true, nullMeaning: '后端未返回时段' }),
    field('type', 'number | null', '异常类型原码；与 absent_type 字典 value 对应', { nullable: true, nullMeaning: '异常记录不存在或后端未返回' }),
    field('typeName', 'string | null', '后端实时用 absent_type 字典翻译的异常类型名称', { nullable: true, nullMeaning: '后端未找到字典标签或记录不存在' }),
    field('startDate', 'string | number | null', '异常日期原值', { nullable: true, nullMeaning: '异常记录不存在或后端未返回' }),
    field('absentFileList', 'object[] | null', '已保存的附件；详情弹窗直接展示 name 并用 url 预览', { nullable: true, nullMeaning: '没有 absentResourceId，后端不设置该字段' }),
    ...attachmentFields.map(item => ({ ...item, path: `absentFileList[].${item.path}`, optional: true })),
  ],
  empty: '后端对不存在的 absentId 可能返回空对象；SDK 将其解释为字段均为 null/absentFileList=null，不把它报告为已有异常详情。权限、会话、网络或字段形状错误仍抛出。',
}

const trueOutput: AiContract['output'] = {
  shape: 'undefined (Promise<void>)',
  fields: [field('$', 'undefined', '上传请求完成后没有业务回执；不能凭 undefined 判断数据库附件已写入')],
  empty: 'undefined 是 Portal uploadAbsentFile 成功响应的正常 SDK 表示，不是空列表或失败。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ bbcfc35154: app/portal/menus/hr.js、views/dashboard/hr/attendance/attendance-exception/list.vue、components/detail.vue、components/upload-files.vue', kind: 'reference', note: '逐页核对月份/组织/姓名/工号/附件状态筛选、分页 body、详情 GET、上传附件按钮条件、PDF/最多10项规则和流程详情跳转。' },
  { source: 'CodeReview_Mall_Platform_Java @ b7a359adc9e: HrWorkScheduleController、HrWorkScheduleServiceImpl、HrWorkScheduleDao.xml、SelectAttendanceDTO、UserAttendanceInfoByMonth、UserAttendanceInfo、AbsentFileDTO、AttachmentDTO', kind: 'reference', note: '核对列表数据范围与过滤、详情字段、附件资源保存、流程实例同步副作用和 dataScope。' },
  { source: 'src/capabilities/attendance-exception.ts 与 test/attendance-exception.test.ts', kind: 'implementation', note: '锁定 Portal 请求体、响应形状、附件投影、页面校验反证和静态源码核对；未替代真实环境读写冒烟。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「组织管理 → 考勤管理 → 异常统计」页面的列表、详情和异常附件入口。',
  boundaries: [
    '页面权限是/dashboard/attendance/attendance-exception；请求使用 platform HTTP 实例和 module-type=11。',
    '列表的“考勤异常情况”只返回类型原码；要展示中文标签，使用 base-dict-get(dictType=absent_type)，不要猜枚举。',
    '组织筛选复用 contractSupport.roleOrganizationSearch({ scope: "attendance", keyword })；无头调用必须先按关键字取得候选，不能直接拉全量角色组织树。',
    '上传能力只提交已上传 OSS 的 { url, name }；页面上的本地 id8 是前端列表 key，不是后端附件资源 ID，SDK 不把它伪造成业务 ID。',
    '上传是实际写操作，后端会创建 OSS 资源记录并替换缺勤记录的 absent_resource_id；若该记录有 processInstanceId，后端还会同步同流程的相关异常记录。',
  ],
  prerequisites: ['使用当前用户会话、租户和异常统计页面权限创建 SDK；组织 ID 来自考勤角色组织候选；上传前用 base-upload-file 以 HR/risk 目录和 application/pdf 上传文件并取得 url。'],
  failures: ['月份格式/未来月份、附件数量/字段、ID、分页、权限、租户、网络或响应形状错误原样抛出；列表不能以空页替代权限失败。', '上传响应没有业务回执；请求完成后必须调用 detail 或重新 list 核实附件资源，不把 HTTP 成功当作数据库已生效。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行异常列表、详情、PDF上传及流程记录同步回查。'],
})

const input = (id: string): Record<string, AiParameter> => {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Attendance exception contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => {
    if (parameter.name === 'yearMonth') return [parameter.name, param('月份选择器值，YYYY-MM；页面默认当前月份且禁选未来月份。', '用户明确选择的月份', { type: 'string', format: 'YYYY-MM', required: false, default: '当前月份', constraints: ['必须是YYYY-MM', '不能晚于当前月份'] })]
    if (parameter.name === 'organizationIdList') return [parameter.name, param('角色组织树多选结果的组织 ID 数组；未筛选时发送 []。', 'contractSupport.roleOrganizationSearch({ scope: "attendance", keyword }) 的 list[].id；用户确认选择后组成数组', { type: '(string | number)[]', required: false, default: '[]', lookup: { capabilityId: 'contract-support-role-organization-search', args: { keyword: '$keyword', scope: 'attendance', limit: 20 }, valueField: 'list[].id', labelField: 'list[].name' } })]
    if (parameter.name === 'name') return [parameter.name, param('姓名模糊筛选；初始值为 null，保留用户输入。', '用户输入的姓名', { type: 'string', required: false, nullable: true, omitted: '省略时发送null' })]
    if (parameter.name === 'staffCode') return [parameter.name, param('工号模糊筛选；页面是文本输入，后端把可解析值绑定为 Long。', '用户输入的工号文本', { type: 'string', required: false, nullable: true, omitted: '省略时发送null' })]
    if (parameter.name === 'isUploadFile') return [parameter.name, param('附件状态筛选；null不筛选、0只看未上传、1只看已上传。', '用户选择的页面下拉值', { type: 'number | null', required: false, nullable: true, default: 'null', options: [{ value: 1, label: '已上传' }, { value: 0, label: '未上传' }], nullMeaning: '不按附件状态筛选' })]
    if (parameter.name === 'pageNo') return [parameter.name, param('从1开始的页码；页面默认1。', '调用方分页状态', { type: 'number', required: false, default: '1' })]
    return [parameter.name, param('每页条数；页面支持10、20、50、100，默认20。', '调用方分页状态', { type: 'number', required: false, default: '20', constraints: ['只能是10、20、50或100'] })]
  }))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Attendance exception contract has no capability: ${id}`)
  contracts[id] = value
}

add('attendance-exception-list', base({
  purpose: '按月份、角色组织、姓名、工号和附件状态查询当前用户数据范围内的异常考勤员工分页列表。',
  effect: 'read',
  inputs: input('attendance-exception-list'),
  output: listOutput,
  consume: ['用 total 判断继续翻页；absentId 是详情/上传的目标 ID，processInstanceId 是流程实例 ID，二者不可互换。', '用 absentResourceId 是否为空展示附件状态；用 base-dict-get(dictType=absent_type) 将 type 原码映射成标签。'],
  steps: [
    { role: 'optional', when: '用户要看某条异常详情且 list[].absentId 非空', capabilityId: 'attendance-exception-detail', mapping: { absentId: 'result.list[].absentId' }, instruction: '用同一行的 absentId 查询详情，不要把 userId 或 processInstanceId 当作 absentId。' },
    { role: 'optional', when: '用户要查看流程异常的审批表单且 list[].processInstanceId 非空', capabilityId: 'task-action-instance', mapping: { processInstanceId: 'result.list[].processInstanceId' }, instruction: '把流程实例 ID 交给流程实例详情能力；不要用它调用上传接口。' },
  ],
  completion: '返回当前筛选的一页异常记录和 total；列表读取本身没有修改业务数据。',
  idempotency: null,
}))

add('attendance-exception-detail', base({
  purpose: '读取一条异常考勤记录的姓名、类型、日期和已保存附件，供详情弹窗展示。',
  effect: 'read',
  inputs: { absentId: param('缺勤记录 ID；来自 attendance-exception-list.list[].absentId。', 'attendance-exception-list', { type: 'string | number', required: true }) },
  output: detailOutput,
  consume: ['typeName 是后端按 absent_type 字典翻译的标签；amPm===1 显示上午，其它非空值显示下午。', 'absentFileList=null 表示没有已保存附件；有附件时用每项 url 预览、name 展示。'],
  steps: [],
  completion: '取得该 absentId 的详情快照；空对象只能报告为没有可展示的详情，不能报告异常记录存在。',
  idempotency: null,
}))

add('attendance-exception-upload-file', base({
  purpose: '为一条异常考勤记录保存已经上传到 OSS 的 PDF 附件列表。',
  effect: 'write',
  inputs: {
    absentId: param('缺勤记录 ID；来自列表行的 absentId，不是流程实例 ID。', 'attendance-exception-list.list[].absentId', { type: 'string | number', required: true }),
    absentFileList: param('待保存附件数组，1至10项，每项只有页面提交需要的 url/name；文件字节需先由 base-upload-file 上传。', 'base-upload-file 返回的 url 与用户确认的文件名', { type: '{ url: string, name: string }[]', required: true, constraints: ['不能为空', '最多10项', '页面上传入口只接受PDF MIME', '上传目录HR/risk'] }),
  },
  output: trueOutput,
  consume: ['请求完成后必须调用 attendance-exception-detail 回查 absentFileList，或重新调用列表确认 absentResourceId 非空。', '同一条有 processInstanceId 的异常记录可能同时更新该流程包含的其它异常记录；需要逐条回查时不能只看当前行。'],
  steps: [
    { role: 'required', when: '附件还没有 OSS url', capabilityId: 'base-upload-file', mapping: { path: 'user.localFilePath', folder: 'literal:"HR/risk"', fileName: 'user.fileName', contentType: 'literal:"application/pdf"' }, instruction: '逐个上传 PDF，使用实际返回的 url；不要把本地路径直接放入 absentFileList。' },
    { role: 'required', when: 'POST 完成或响应超时', capabilityId: 'attendance-exception-detail', mapping: { absentId: 'args.absentId' }, instruction: '回查同一异常记录，确认 absentFileList 中出现本次附件；超时不确定时先回查，未确认前不要重复提交。' },
  ],
  completion: '请求已完成且详情回查确认附件资源已保存；不能仅凭 Promise 完成报告数据库写入成功。',
  idempotency: '无 requestId；重复提交会新建 OSS 资源记录并覆盖缺勤记录的 absent_resource_id，且可能同步覆盖同流程记录。响应超时先 detail 回查，确认未生效后再决定是否重试。',
}))

export const ATTENDANCE_EXCEPTION_AI_CONTRACTS = contracts
export const ATTENDANCE_EXCEPTION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(ATTENDANCE_EXCEPTION_METHODS).map(([id, method]) => [
    `attendanceException.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法接收一个参数对象（list 可省略 query；detail 仍需 absentId；uploadFile 需 absentId 与 absentFileList）。'] },
  ]),
)
