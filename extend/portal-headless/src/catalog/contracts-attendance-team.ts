import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { ATTENDANCE_TEAM_HOLIDAY_PATH, attendanceTeamCapabilities } from '../capabilities/attendance-team.js'

/**
 * 排班管理页**弹窗**里那条请求的 AI 契约：考勤组表单上的「法定节假日日历」。
 *
 * 考勤组本体与排班那六条能力的契约在 `contracts-business.ts`（上一轮做的）。
 * 这一份是**自包含**的本轮增量，由主线接进权威目录。
 *
 * 为什么它原来漏了：判据是「页面只要有**任一**能力指向它就算完成」，
 * 而这条请求由 `components/calendar.vue` 在**考勤组表单页**里发出（那个表单页是隐藏路由
 * `[mode]/[id].vue`，没有菜单项），于是整条请求没有落进任何页面的能力集合。
 */

const definitions = new Map(attendanceTeamCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const parameter = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const base = (
  id: string,
  value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>,
): AiContract => {
  if (!definitions.has(id)) throw new Error(`Attendance team contract has no capability definition: ${id}`)
  return {
    ...value,
    whenToUse:
      '用户要在「人力 → 考勤 → 排班管理」的新建/编辑考勤组表单上看某个**月份的法定节假日日历**（哪天休、哪天班）时使用。它不是排班本身：考勤组的排班是 attendance-team-schedule-get / save，节假日是平台级的统一配置，只读。',
    boundaries: [
      '只读：节假日是平台统一配置，这一页没有任何节假日写入口（页面上只有日历展示）。',
      `端点是 GET ${ATTENDANCE_TEAM_HOLIDAY_PATH}（platform 实例，module-type=11 组织管理；页面上下文由 SDK 绑定），参数只有 year 与 month。`,
      '它返回的是**该月全部已登记的行**（休与班都在里面），不是「某一天是不是假期」的单点查询；按月取一次、再按 holidayDate 比对。',
      '它是「第几月」的精确匹配（后端 `WHERE year = ? AND month = ?`），不做跨月或跨年范围查询：要相邻两个月就调两次。',
      '这一页的日历只是展示，不参与考勤组的新建/修改载荷 —— 不要把它当成排班或考勤组字段的取值来源。',
    ],
    prerequisites: [
      '使用当前用户、当前租户的会话 token 创建 SDK，并拥有排班管理页权限。',
      'year 与 month 都必须由用户明确给出（或取当前年月）；缺一个后端不会报错，而是静默返回空日历。',
    ],
    failures: [
      'year / month 缺失或不是整数形状时在发请求前抛错（后端对 null 不报错，只会生成匹配不到行的条件、返回空数组）。',
      '响应不是数组时抛错：不把形状变化降级成空的日历（那会被读成"这个月没有假期"）。',
      '401/403、租户/数据范围、网络错误原样抛出；只读查询可以重试，重试时保留同一组年月。',
    ],
    evidence: [
      {
        source: 'CodeReview_Projects_Js@test/portal/main:82651c98c5 app/portal/views/dashboard/hr/attendance/attendance-team/components/calendar.vue（37 行）与 [mode]/[id].vue（57 行引入该组件）',
        kind: 'reference',
        note: '确认请求的实例、URL、参数名（year/month 来自 dayjs 的 YYYY / MM）、翻月时重新请求、以及页面按 holidayDate + isHoliday===1 画「休」、月内其余日子画「班」；固定检出源码证据，未在真实环境调用。',
      },
      {
        source: 'CodeReview_Mall_Platform_Java@test/test:998ce8223fa HrHolidayController#getHoliday、SysHolidayServiceImpl#getHoliday、SysHolidayEntity',
        kind: 'reference',
        note: '确认 `WHERE year = ? AND month = ?` 的精确匹配、无分页、holidayDate 序列化成 yyyy-MM-dd、isHoliday 为 Integer；静态源码证据，未在真实环境调用。',
      },
      {
        source: 'src/capabilities/attendance-team.ts',
        kind: 'implementation',
        note: '锁定参数装配顺序、必填校验、返回数组的形状校验与字段归一。',
      },
    ],
    gaps: [
      '没有浏览器基准（`baseline/attendance-team.browser.json` 只抓了考勤组 CRUD 与排班读写，不含节假日日历）。',
      '尚未在真实测试环境调用过这个端点，返回行里的 name 是否总是有值、以及是否存在 isHoliday 之外的状态值都未核实。',
      'isHoliday 的取值域只按页面的 `=== 1` 判据记录为「1=休、其余按班展示」，后端有没有别的值没有证据。',
    ],
  }
}

const holidayFields: AiField[] = [
  field('[]', 'object', '一条假期登记记录。'),
  field('[].id', 'string | number | null', '记录 ID；页面不消费。Java Long 可能序列化成字符串，按原样保留。', { nullable: true, nullMeaning: '后端未返回' }),
  field('[].name', 'string | null', '假期名称（如「元旦」「春节」）。⚠️ 页面上的日历**不显示它**，只画「休 / 班」。', { nullable: true, nullMeaning: '后端未返回' }),
  field('[].holidayDate', 'string | null', '日期，后端固定按 `yyyy-MM-dd` 序列化；页面用它和当前格子的日期逐字比对。', { nullable: true, nullMeaning: '后端未返回' }),
  field('[].isHoliday', 'number | null', '是否休息：**1 = 休**（页面画「休」）；0 = 班（页面画「班」，判据其实是"不是 1"）。', { nullable: true, values: { '1': '休', '0': '班' }, nullMeaning: '后端未返回' }),
  field('[].year', 'number | null', '年份；与请求参数同年时是这一批数据的归属年。', { nullable: true, nullMeaning: '后端未返回' }),
  field('[].month', 'number | null', '月份 1~12；与请求参数同月时是这一批数据的归属月。', { nullable: true, nullMeaning: '后端未返回' }),
]

export const ATTENDANCE_TEAM_AI_CONTRACTS: Record<string, AiContract> = {
  'attendance-team-holiday-list': base('attendance-team-holiday-list', {
    purpose: '按月读取平台登记的法定节假日日历：返回该月全部记录，含「休」与「班」两种行。',
    effect: 'read',
    inputs: {
      year: parameter('年份（如 2026）。页面传 dayjs 的 `YYYY` 字符串，后端按 Integer 绑定。', '页面日历当前面板的年份，或用户明确给出的年份', {
        type: 'integer',
        constraints: ['必填：后端对 null 不报错，只会返回空数组。', '四位整数（或四位数字字符串）。'],
      }),
      month: parameter('月份 1~12。页面传**零填充**的 `MM`（如 `09`），后端按 Integer 绑定，`9` 与 `09` 都可以。', '页面日历当前面板的月份，或用户明确给出的月份', {
        type: 'integer',
        constraints: ['必填：同 year，缺了会静默返回空。', '1~12。'],
      }),
    },
    output: {
      shape: 'object[]',
      fields: [field('$', 'object[]', '该月的节假日记录数组；**不是分页结构**（端点没有 pageNo/pageSize，页面直接对数组 find）。'), ...holidayFields],
      empty: '[] 表示这个月没有登记任何假期/调休记录；响应不是数组会抛错，不降级为空日历。',
    },
    consume: [
      '按 holidayDate 逐日比对：命中 `isHoliday === 1` 的是「休」，同一月内没有命中的自然日按页面的口径是「班」（页面就是这么画的）。',
      '不要用 name 判断休/班：页面根本不显示 name，休与班都靠 isHoliday 与日期。',
      '需要连续几个月时逐月调用；本能力不做跨月查询，也不返回"未登记"的日子的补齐结果（缺的日子就是没有记录）。',
    ],
    steps: [],
    completion: '返回该月全部节假日记录；读取本身不修改任何配置，也不需要回查。',
    idempotency: null,
  }),
}
