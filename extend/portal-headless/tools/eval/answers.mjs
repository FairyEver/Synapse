/**
 * 本轮（2026-09-20）的作答。
 *
 * 这就是「作答者」的位置：将来把真实模型接进来时，换掉这个文件即可，
 * tasks / scoring / consumer-view 都不用动。
 *
 * 每条作答的 `trace` 记录了黑盒过程中真实发生的 SDK 调用与当时的判断，
 * `decision` 是最终决定。参数值一律带 `from`（出处）。
 *
 * 约定：`deferred: true` 表示这个值只有真调一次后端才能拿到，
 * 本轮不发请求，但把「我会怎么取」写清楚。
 */

export const ANSWERS = {
  'T1-direct-lookup': {
    decision: {
      outcome: 'call',
      capabilityId: 'meeting-room-list',
      chain: ['meeting-room-list'],
      args: {
        pageNo: { value: 1, from: 'describe(meeting-room-list).params.pageNo 默认 1；用户没指定页码' },
        pageSize: { value: 20, from: 'describe(meeting-room-list).params.pageSize 默认 10；取 20 少翻一次页' },
      },
      notes: 'recommend 的首位是 meeting-room-usage（110.2）而非 meeting-room-list（89.8），靠读 title 人工纠正。',
    },
    trace: [
      { call: "recommend('查一下会议室有哪些')", saw: 'capabilities 5 条，首位 meeting-room-usage(110.2)，meeting-room-list 仅第二(89.8)' },
      { call: 'describe(meeting-room-usage)', saw: 'params 只有 date；title 是「查询各会议室的预定占用情况」——不是用户要的' },
      { call: 'describe(meeting-room-list)', saw: 'params name/authorizedOrgId/pageNo/pageSize；title「查询会议室列表」——这才对' },
      { call: 'describePage(/dashboard/meeting-room/list)', saw: 'capabilities 只有 meeting-room-list 一条，确认该页就这一个能力' },
    ],
  },

  'T2-drilldown-booking': {
    decision: {
      outcome: 'call',
      capabilityId: 'meeting-application-submit',
      chain: ['meeting-room-list', 'meeting-room-usage', 'meeting-application-prepare', 'meeting-application-submit'],
      args: {
        meetingName: { value: '周会', from: '用户原话「开周会」' },
        meetingRoomId: {
          value: '<运行时才拿得到>',
          from: '第 3 步 roomUsage("2026-09-21") 返回 meetingRooms[].meetingRoomId —— 挑 timeSlots 里 14:00~15:00 无占用的那间',
          deferred: true,
        },
        startTime: { value: '2026-09-21 14:00:00', from: '用户「明天下午2点」+ 基准日 2026-09-20' },
        endTime: { value: '2026-09-21 15:00:00', from: '用户「到3点」' },
        attendeeCount: { value: 2, from: '用户原话「2个人」' },
      },
      notes: 'prepare 是只读的、submit 才写；先 prepare 拿 tasks（会议室流程实测为空）再 submit。',
    },
    trace: [
      { call: "recommend('帮我订明天下午2点到3点的会议室，开周会，2个人')", saw: '首位 meeting-room-usage(122.2)；submit 排第三(81.5)' },
      { call: 'describe(meeting-room-usage)', saw: 'params 只有 date；keyFields 指向 meetingRooms[].meetingRoomId；next 指向 meeting-application-definition' },
      { call: 'describe(meeting-application-definition)', saw: 'params 只有 key(固定 meeting_application)——对「订会议室」这一步没用，是岔路' },
      { call: 'describe(meeting-application-prepare)', saw: '六个必填参数；keyFields=tasks；next 才指向 submit' },
      { call: 'describe(meeting-application-submit)', saw: 'write=true；参数同 prepare + startUserSelectAssignees；keyFields=id' },
      { call: 'describe(meeting-room-list)', saw: 'keyFields=list[].id —— 但它没链到 meetingRoomId 这个参数' },
    ],
  },

  'T3-missing-info': {
    decision: {
      outcome: 'clarify',
      chain: [],
      args: {},
      missing: ['startTime', 'endTime', 'meetingRoomId', 'meetingName', 'attendeeCount'],
      notes: 'describe(meeting-application-submit).params 里 required:true 的共 5 个，用户一个都没给全，照 D15 全问。',
    },
    trace: [
      { call: "recommend('订个会议室')", saw: 'capabilities 5 条，第一位 meeting-room-usage；但用户意图是「订」，终点应是 submit' },
      { call: 'describe(meeting-application-submit)', saw: 'required 参数 5 个：meetingName/meetingRoomId/startTime/endTime/attendeeCount' },
      { call: 'describe(meeting-room-list)', saw: 'meetingRoomId 是 search 型长选项 → 得先有会议室候选才能选' },
    ],
  },

  'T4-slang-pay-adjust': {
    decision: {
      outcome: 'unsupported',
      chain: [],
      args: {},
      pageRef: '工资找齐',
      notes: '别名表把「调薪」映射到「工资找齐」（via alias），但该页 hasCapabilities=false，能力清单为空 → 明确说做不了。',
    },
    trace: [
      { call: "recommend('帮我调薪')", saw: 'interpretations 命中 alias:jargon-salary-findqi；domains=salary(53.4)；pages 首位「工资找齐」(73)；capabilities 为空数组' },
      { call: "search('调薪')", saw: 'terms 展开出「工资找齐」「工资」「薪酬」「薪资」；首位命中 page 工资找齐(179)，via alias' },
      { call: 'describePage(/dashboard/salary/adjust/list)', saw: 'ok:true，page.title=工资找齐，capabilities=[]，pending:true' },
    ],
  },

  'T5-unsupported': {
    decision: {
      outcome: 'unsupported',
      chain: [],
      args: {},
      notes: 'recommend 与 search 都零命中：search.total=0，recommend.capabilities/domains/pages 全空。没有能力可给，也没有页面可指。',
    },
    trace: [
      { call: "recommend('报销差旅费')", saw: 'interpretations 只剩 literal；domains/pages/capabilities 全空；next 退化成 search(无 args)+listDomains' },
      { call: "search('报销差旅费')", saw: 'total:0，hits:[]，truncated:false' },
      { call: "search('报销')", saw: 'total:0 —— 不是话术太长，是这个词整张目录都没有' },
      { call: "search('差旅')", saw: 'total:0' },
    ],
  },
}
