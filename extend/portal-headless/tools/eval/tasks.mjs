/**
 * 评测任务定义（纯数据，无副作用）。
 *
 * 每个任务 = 一句用户原话 + 期望落点 + 可接受的其他落点 + 判分规则。
 * 这里刻意不引用任何 SDK 内部类型：任务是「人写的期望」，与实现解耦，
 * 将来批量生成的页面接进来后，只改这个文件就能复跑。
 *
 * 难度分类（kind）：
 *   direct      目录里能直接回答的
 *   drilldown   要串起多个能力、中间结果当下一步入参的
 *   missing     用户没说全，正确行为是回来问，不是猜
 *   slang       用菜单上没有的说法（黑话 / 同义词）
 *   unsupported 目录里根本没有这个能力，正确行为是明确说「没有」
 */

/** 本题评测跑在哪个基准日（影响「明天」这类相对时间的解析）。 */
export const EVAL_TODAY = '2026-09-20'

export const TASKS = [
  {
    id: 'T1-direct-lookup',
    kind: 'direct',
    utterance: '查一下会议室有哪些',
    goal: '列出会议室清单',
    why: '最普通的一跳：一个读能力就能回答。用来检验 recommend 的排序能不能把「读列表」排到「查占用」前面。',
    expect: {
      outcome: 'call',
      // 唯一正确答案。meeting-room-usage（查占用）虽然同域、分更高，但不是用户要的。
      acceptableCapabilityIds: ['meeting-room-list'],
      argRules: [
        { kind: 'nonEmpty', arg: 'pageNo' },
        { kind: 'nonEmpty', arg: 'pageSize' },
        { kind: 'range', arg: 'pageSize', min: 1, max: 500 },
      ],
    },
  },
  {
    id: 'T2-drilldown-booking',
    kind: 'drilldown',
    utterance: '帮我订明天下午2点到3点的会议室，开周会，2个人',
    goal: '把会议室预定提交出去',
    why: '全链路下钻：先拿会议室 id，再看占用挑空闲的，再 prepare 问审批人，最后 submit。中间结果必须是下一步的入参。',
    expect: {
      outcome: 'call',
      // 终点就是提交能力；accept 只允许它。
      acceptableCapabilityIds: ['meeting-application-submit'],
      // 必须出现过的中间步骤（顺序不强制，但都得到过场）。
      requiredChain: ['meeting-room-list', 'meeting-room-usage', 'meeting-application-prepare'],
      argRules: [
        { kind: 'minuteIn', arg: 'startTime', allow: ['00', '30'] },
        { kind: 'minuteIn', arg: 'endTime', allow: ['00', '30'] },
        { kind: 'secondsZero', arg: 'startTime' },
        { kind: 'secondsZero', arg: 'endTime' },
        { kind: 'before', arg: 'startTime', other: 'endTime' },
        { kind: 'maxLength', arg: 'meetingName', max: 30 },
        { kind: 'range', arg: 'attendeeCount', min: 1, max: 500 },
      ],
    },
  },
  {
    id: 'T3-missing-info',
    kind: 'missing',
    utterance: '订个会议室',
    goal: '识别信息不足，回来问用户',
    why: '只给了意图没给参数。D15 明确说「宁可多问一次，也不要替用户猜参数」——检验 describe().params 的 required 标记能不能直接翻译成一份「要问用户什么」的清单。',
    expect: {
      outcome: 'clarify',
      // 这几个字段用户确实没说、也推不出来，必须问。
      missingAnyOf: ['startTime', 'endTime', 'meetingRoomId'],
      // 不允许在信息不足时直接提交。
      forbiddenCapabilityIds: ['meeting-application-submit', 'meeting-application-prepare'],
    },
  },
  {
    id: 'T4-slang-pay-adjust',
    kind: 'slang',
    utterance: '帮我调薪',
    goal: '用黑话命中「工资找齐」，并说清它有没有能力',
    why: '「调薪」在菜单上不存在，别名表把它映射到「工资找齐」。难点不在命中，而在命中之后：那是个页面、没有登记能力，正确行为是给出页面 + 明确说做不了，而不是编一个能力出来。',
    expect: {
      outcome: 'unsupported',
      // 命中的页面（id 或 menuPath 任一即可）
      acceptablePageRefs: ['3e7333', '/dashboard/salary/adjust/list', '工资找齐'],
      forbiddenCapabilityIds: [],
    },
  },
  {
    id: 'T5-unsupported',
    kind: 'unsupported',
    utterance: '报销差旅费',
    goal: '目录里没有就明确说没有',
    why: '整条话术在别名表与字面检索里都是零命中。检验「失败」是明确的（ok:false / total:0），还是需要模型自己从「空数组」里猜。',
    expect: {
      outcome: 'unsupported',
      // 零命中：连页面都不该给。
      acceptablePageRefs: [],
      forbiddenCapabilityIds: [],
      expectZeroSearchHits: true,
    },
  },
]

/** 按 id 取任务，未知 id 直接抛——避免拼错 id 静默跑空。 */
export function getTask(taskId) {
  const task = TASKS.find((t) => t.id === taskId)
  if (!task) {
    throw new Error(`未知评测任务「${taskId}」（已知：${TASKS.map((t) => t.id).join('、')}）`)
  }
  return task
}
