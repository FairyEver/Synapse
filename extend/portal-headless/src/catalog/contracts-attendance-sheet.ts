import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SHEET_STATISTIC_FIELDS } from '../capabilities/attendance-sheet.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, type: 'string | number', required: true, ...extra })
const id = input('考勤表主单ID，不是班组或人员ID', 'attendance-statistics-list.list[].id 或 attendance-archive-sheet-list.list[].id')
const archivedInput = input('刚刷新考勤列表同一行的归档状态；0未归档、1已归档，不猜值', 'attendance-statistics-list.list[].isArchived，档案页行固定1', { type: 'integer', options: [{value:0,label:'未归档'},{value:1,label:'已归档'}] })
const nil = { nullable: true, nullMeaning: '页面接口未提供此显示值，不猜测' }
const base = (purpose: string, inputs: Record<string, AiParameter>, output: AiContract['output'], effect: AiContract['effect'] = 'read'): AiContract => ({
  purpose, whenToUse: purpose,
  boundaries: ['仅当前会话租户下考勤表；各请求绑定组织管理页面上下文。未显示且操作不使用的后端字段不返回。'],
  effect, prerequisites: ['已建立用户会话及租户上下文；ID从真实列表或候选取，不猜ID。'], inputs, output,
  consume: ['按当前考勤表ID处理，人员用户ID、部门ID与班组ID不能互换。'], steps: [],
  completion: effect === 'write' ? '请求回执成功，仅表示该动作已受理；用考勤统计/档案列表独立核对结果。' : '交付本次查询的考勤资料；没有修改考勤表。',
  failures: ['参数或响应形状错误直接拒绝；权限/会话/后端业务错误原样抛出。', '保存人员必须全部关联考勤组，后端拒绝时先更正人员或其排班；不能把业务失败解释成空列表。', '写请求超时结果不确定，先查列表核实，不生成新防重ID盲目重发。'],
  idempotency: effect === 'write' ? '除saveIdempotent外无本地防重；归档会保存快照、取消归档会移除快照，不能假定重复执行无副作用。' : null,
  evidence: [
    { source: 'web@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/hr/attendance/attendance-sheet/[mode]/[id].vue, list.vue, detail/[id]/item.vue', kind: 'reference', note: '页面输入、人员候选、GET归档与统计簿可见列；静态源码依据。' },
    { source: 'Java@test/test:dcb3f360194 HrAttendanceSheetController / HrAttendanceSheetServiceImpl', kind: 'reference', note: '保存整组替换、空成功回执、归档和取消归档副作用；不证明测试环境已部署。' },
    { source: 'smoke/pc-coverage.mjs attendance', kind: 'smoke', note: '2026-09-22测试环境SDK：当前部门/班组101，复制只读来源144的一名成员创建155；独立详情和列表核对→编辑保存→未归档统计1行→归档并出现在档案→归档统计→取消归档且档案消失→删除后列表无155，已清理。来源144未修改。' },
    { source: 'test/attendance-sheet.test.ts', kind: 'test', note: '离线验证请求、归档保护、年月转换与AI契约，不代替线上写验证。' },
  ],
  gaps: ['SDK保存、编辑、归档、取消归档、删除及统计已完成真实环境回查和清理；新增写动作尚无浏览器逐字段基准，考勤簿默认预览及打印仍未覆盖，不能宣称整页全覆盖。'],
})
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [field('$', 'undefined', 'SDK等待后端成功后返回undefined，不是新单ID或审批结果')], empty: '成功无返回值；失败抛出异常。' }
const C: Record<string, AiContract> = {}
export const ATTENDANCE_SHEET_CONTRACTS = C
C['attendance-sheet-get'] = base('读取考勤表当前编辑内容和归档状态，供编辑前完整保留人员。', { id }, { shape: '{ id, departmentId, organizationId, yearMonth, isArchived, users }', fields: [
  field('$', 'object', '考勤表编辑资料'), field('id', 'string | number', '考勤表ID'), field('departmentId', 'string | number', '所属部门ID；保存时页面使用当前用户部门'), field('organizationId', 'string | number', '班组ID', { nullable: true, nullMeaning: '未选择班组' }), field('yearMonth', 'string', '考勤年月，由year/month拼为YYYY-MM', { format: 'YYYY-MM' }), field('isArchived', 'integer', '归档状态；已归档页面禁用编辑、归档、删除', { values: { '0': '未归档', '1': '已归档' } }), field('users', 'array', '完整当前已选人员'), field('users[]', 'object', '一名已选人员'), field('users[].id', 'string | number', '用户ID，编辑映射到userIdList[]'), field('users[].name', 'string', 'realName，显示人员姓名', nil),
], empty: '不存在或缺少userList时失败；users=[]表示尚无已选人员，不可直接保存空数组。' })
C['attendance-sheet-get'].steps = [{ role: 'optional', when: '用户要修改且isArchived为0', capabilityId: 'attendance-sheet-save', mapping: { id: 'result.id', isArchived: 'result.isArchived', yearMonth: 'result.yearMonth', organizationId: 'result.organizationId', userIdList: 'result.users[].id' }, instruction: '把全部保留人员id组成userIdList，再应用用户指定增删；另取当前用户部门departmentId并生成本次requestId。' }]
C['attendance-sheet-department'] = base('查询页面新建/编辑考勤表自动使用的当前用户部门。', {}, { shape: '{ id, fullPath }', fields: [field('$', 'object', '当前用户部门'), field('id', 'string | number', '部门实体ID，传departmentId', { nullable: true, nullMeaning: '当前用户无部门，不能继续保存' }), field('fullPath', 'string', '部门完整显示路径', nil)], empty: 'id=null表示没有取得部门，不能编造departmentId。' })
C['attendance-sheet-department'].consume = ['显示fullPath；id传班组候选departmentId及保存departmentId，不能拿fullPath当ID。']
C['attendance-sheet-group-search'] = base('按关键字搜索当前部门下班组路径，供考勤表选择班组。', { departmentId: input('当前用户部门ID', 'attendance-sheet-department.id'), keyword: input('班组路径关键字，去空白后不许空；本地忽略大小写包含匹配', '用户提供名称片段', { type: 'string' }) }, { shape: '{ list, total }', fields: [field('$', 'object', '班组候选切片'), field('list', 'array', '匹配前50条'), field('list[]', 'object', '班组候选'), field('list[].id', 'string | number', '班组ID，传organizationId'), field('list[].fullPath', 'string', '页面候选显示路径', nil), field('total', 'integer', '本地匹配总数；大于50需缩小关键字')], empty: 'list=[]表示当前部门下无匹配班组；后端读取部门下全部班组，keyword只限制SDK输出。' })
C['attendance-sheet-user-search'] = base('按姓名分页搜索考勤表人员管理弹窗的可选用户。', {
  keyword: input('姓名关键字，对应后端name；不允许空关键字', '用户提供姓名片段', { type: 'string' }),
  organizationId: input('人员所属组织筛选ID', 'contract-support-role-organization-search(scope=attendance)已选id', { required: false, omitted: '发送空串，不限定组织筛选' }),
  pageNo: input('从1开始的页码', '调用方翻页', { type: 'integer', required: false, omitted: '1', default: '1' }),
  pageSize: input('每页人数，1至100', '调用方', { type: 'integer', required: false, omitted: '5', default: '5' }),
}, { shape: '{ list, total }', fields: [field('$', 'object', '用户分页'), field('list', 'array', '当前页人员'), field('list[]', 'object', '可选用户'), field('list[].id', 'string | number', '系统用户ID，不是工号；传userIdList[]'), field('list[].name', 'string', 'realName映射的人员姓名', nil), field('list[].staffCode', 'string', 'username映射工号，保留前导零，不用于userIdList', nil), field('list[].organizationName', 'string', '人员组织显示路径', nil), field('total', 'integer', '后端匹配总人数')], empty: 'list=[]为本页无结果；total非零可能页码过大。' })
C['attendance-sheet-user-search'].consume = ['显示姓名、工号、组织消歧，用户选中的id收集为userIdList；候选不证明人员已关联考勤组，保存仍可被后端拒绝。']
C['attendance-sheet-save'] = base('新建或完整编辑考勤表及所选人员，保存不会自动归档。', {
  isArchived: { ...archivedInput, required: false, requiredWhen: '提供id编辑原表时必填', omitted: '新建不使用；编辑缺少则拒绝' },
  id: { ...id, required: false, omitted: '发送null创建新表；传id编辑原表' },
  departmentId: input('当前用户部门ID，页面进入编辑也按当前用户部门回填', 'attendance-sheet-department.id'),
  organizationId: input('当前部门下班组ID', 'attendance-sheet-group-search.list[].id', { required: false, nullable: true, nullMeaning: '不选择班组', omitted: '发送null' }),
  yearMonth: input('考勤月份；SDK按运行环境本地年月拒绝未来月份，调用环境应与PC日期一致', '用户选择或attendance-sheet-get.yearMonth', { type: 'string', format: 'YYYY-MM；不作时区时间戳转换' }),
  userIdList: input('至少一人的完整用户ID数组；替换全部成员，非增量追加', 'attendance-sheet-user-search.list[].id，编辑保留attendance-sheet-get.users[].id', { type: 'array' }),
  'userIdList[]': input('所选系统用户ID，不是工号staffCode', '人员候选或当前users[].id'),
  requestId: input('本次保存意图的短窗口防重ID', 'SDK createRequestId()或调用方生成；同意图重试沿用', { type: 'string' }),
}, voidOutput, 'write')
C['attendance-sheet-save'].consume = ['后端按年月和部门自动生成名称，不接收用户自编名称。新建成功不返回ID，按部门/班组刷新attendance-statistics-list并核对月份、人员；不要把undefined当失败重建。', '编辑先读取完整人员，保留未删除项；SDK按刚刷新列表状态拒绝已归档编辑。取消本次新建需先找到唯一新表ID，再remove；已编辑表没有自动恢复历史内容。']
C['attendance-sheet-save'].idempotency = 'invoke绑定saveIdempotent，同用户/租户/能力/requestId在内存短窗口防重；requestId不发后端。进程重启或过期不保证防重，超时先核对列表。直接save没有防重。'
for (const [suffix, purpose] of [['archive', '归档未归档考勤表，生成归档考勤快照。'], ['unarchive', '取消考勤表归档并删除该表归档快照；不是恢复此前历史快照。'], ['remove', '删除未归档考勤表及人员关联；逻辑删除，不提供恢复入口。']] as const) {
  C[`attendance-sheet-${suffix}`] = base(purpose, suffix === 'unarchive' ? { id } : { id, isArchived: archivedInput }, voidOutput, 'write')
  C[`attendance-sheet-${suffix}`]!.consume = [suffix === 'unarchive' ? '成功后考勤统计列表对应isArchived应为0，档案列表不再包含该表；不自动重新归档。' : suffix === 'archive' ? '成功后档案列表应出现该ID；若用户要求撤销归档才调用unarchive，不把撤销当成功后必做步骤。' : '成功后列表不再出现该ID；不能用info仍返回旧数据判定删除失败。']
}
const labels: Record<string, string> = { dayWork: '日勤', publicLeave: '公差', saturdaySunday: '周六日', injury: '工伤假', leave: '事假', sick: '病假', miner: '旷工', yearRest: '年休假', visit: '探亲假', wedding: '婚假', maternity: '产假', late: '迟到', early: '早退', total: '小计' }
C['attendance-sheet-statistics'] = base('读取指定考勤表统计簿，按当前归档状态选择实时或归档统计。', { id, isArchived: archivedInput }, { shape: 'Array<StatisticRow>', fields: [field('$', 'array', '每名人员一行的统计簿'), field('[]', 'object', '人员统计行'), field('[].userName', 'string', '人员姓名', nil), ...SHEET_STATISTIC_FIELDS.map(key => field(`[].${key}`, 'number', `${labels[key]}；页面空值显示0，SDK将null/未提供归一为0`, { unit: '天' }))], empty: '[]表示该表没有统计行；不是分页，不发pageNo/pageSize。' })
C['attendance-sheet-statistics'].consume = ['展示每人的日勤、假期及小计，单位天；total保留后端小计，不把各列重新相加（部分字段重叠）。', '只包含页面可见列；没有生成打印文件，考勤簿及合并双面打印仍需另行补齐。']
export const ATTENDANCE_SHEET_METHOD_CONTRACTS: Record<string, AiContract> = {
  'attendanceSheet.save': { ...C['attendance-sheet-save']!, inputs: Object.fromEntries(Object.entries(C['attendance-sheet-save']!.inputs).filter(([name]) => name !== 'requestId')), idempotency: '直接save无短窗口防重；AI使用attendance-sheet-save绑定的saveIdempotent。' },
}
