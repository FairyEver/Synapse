import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { MONTH_TASK_REVIEW_SCORE_PATH, backlogTaskExamineCapabilities } from '../capabilities/backlog-task-examine.js'

/**
 * 待办事项页**下钻的「任务评分」页**那条写请求的 AI 契约。
 *
 * 待办/已办列表与撤销审批的契约在 `contracts-business.ts`（上一轮做的）。
 * 这一份是**自包含**的本轮增量，由主线接进权威目录。
 *
 * 为什么原来漏了：判据是「页面只要有**任一**能力指向它就算完成」，
 * 而这条请求由**隐藏路由** `task-score/[id].vue` 发出（从待办列表行的「办理」进入，
 * 没有独立菜单项），于是整条写请求没有落进任何页面的能力集合。
 */

const definitions = new Map(backlogTaskExamineCapabilities.map(definition => [definition.id, definition]))

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
  if (!definitions.has(id)) throw new Error(`Backlog task examine contract has no capability definition: ${id}`)
  return {
    ...value,
    whenToUse:
      '用户要在「待办事项」里办理一条**月度任务评分**（审批分类 5=任务评分）时使用：把审核分与说明写回该月度任务。它不是"审批通过"——页面在这一步之后还会走一次 bpm 审批动作，所以调用完这里待办不会消失。',
    boundaries: [
      `写端点 POST ${MONTH_TASK_REVIEW_SCORE_PATH}（platform 实例；建议页面不发送 module-type，SDK 与浏览器一致不发）；body 是 MonthTaskScoreDTO。`,
      '**只做算分落库这一段**：页面 `handleSubmit()` 紧跟其后还会打 `POST /bpm/hr/task/approve`（body `{id: bpm任务id, type: 4, reason: ""}`）把审批推下去。本能力不覆盖那一步，也不能替代它。',
      '入参里的 `taskId` 是**月度任务 id**（`kpi_month_protocol_task.id`），不是流程实例 id、不是 bpm 任务 id、也不是协议 id —— 后端用 `getProtocolByTaskId(id)` 反查协议。',
      '后端在这一条路径上**只读五个字段**（id、reviewScore、reviewScoreEvaluation、excessReviewScore、excessReviewEvaluation）；SDK 因此也只发这五个，不把页面顺带回传的自评分/领导分当成这个动作的一部分。',
      '后端 `@Transactional`：先锁评分流程（协议 + 任务行），再校验分数区间并写回，最后盖 `reviewerScoreTime`。校验/写入失败整笔回滚。',
      '「客户拜访」类任务的分数由后端公式算出，不读传入的 reviewScore；页面在客户拜访公式失败或事实未就绪时也会禁用评分按钮。这类任务的差异属于后端业务规则，SDK 不判定。',
    ],
    prerequisites: [
      '使用当前用户、当前租户的会话 token 创建 SDK；被评分的任务必须由当前用户有权办理（后端按登录用户与协议数据范围裁决）。',
      '先由用户在页面上确认要评的任务与分数：SDK 不提供"读回该任务当前分数"的入口（见 gaps），所以打分依据要来自页面/用户，不要凭空猜。',
      '只有确属需要超额评分的任务才提供 excessReviewScore；没有超额分的任务不要传它。',
    ],
    failures: [
      '缺 taskId、或 reviewScore 为空会在发请求前抛错；后端对空的完成审核分返回「完成审核评分不能为空」。',
      '后端业务失败原样抛出：找不到月度协议时是「没有找到月度协议」；分数超上限时是「完成审核评分不能超过任务完成分」/「超额审核评分不能超过任务超额分数」。这些错误**不是**网络问题，重试没有意义。',
      '401/403、租户/数据范围与网络错误原样抛出；写操作超时后先按 taskId 回查任务当前分数（见 gaps 说明的回查限制），确认没写进去再决定是否重发。',
    ],
    evidence: [
      {
        source: 'CodeReview_Projects_Js@test/portal/main:82651c98c5 app/portal/views/dashboard/hr/backlog/task-examine/task-score/[id].vue（130-166 行）',
        kind: 'reference',
        note: '确认 handleSubmit 的两步：先 POST taskReviewScore（body 取 monthTaskList[0] 的 13 个字段），再 POST /bpm/hr/task/approve；并确认客户拜访公式未就绪时按钮禁用（blockedVisitFormula）。固定检出源码证据，未在真实环境调用。',
      },
      {
        source: 'CodeReview_Mall_Platform_Java@test/test:998ce8223fa KpiMonthProtocolController#taskReviewScore、KpiMonthProtocolTaskServiceImpl#taskReviewScore、MonthTaskScoreDTO',
        kind: 'reference',
        note: '确认 @Transactional、lockScoreProtocol/lockScoreTasks、只读五个字段、reviewScore 空值与超上限的两条业务错误、reviewerScoreTime 落库；静态源码证据，未在真实环境执行写操作。',
      },
      {
        source: 'src/capabilities/backlog-task-examine.ts',
        kind: 'implementation',
        note: '锁定能力 ID、body 键序、必填校验与只发五个字段的取舍。',
      },
    ],
    gaps: [
      '没有浏览器基准（`baseline/backlog-task-examine.browser.json` 只抓了待办/已办列表与撤销审批）。',
      '**没有配套的读回入口**：SDK 目前没有"按 taskId 读该月度任务当前分数"的能力，所以 completion 要求的人工核对只能在 Portal 页面上做，或另开能力。',
      '尚未在真实测试环境执行过这条写请求（prepare→submit→回查闭环未做）。',
      '页面顺带回传的 8 个自评/领导分字段本能力**不发**，取舍依据是后端只读五个字段（静态结论）；若 smart-layer/后端后续改成读全量，需要重新评估。',
      '「客户拜访」类任务的公式分支与 `blockedVisitFormula` 的判定条件没有在 SDK 侧复刻（那是页面组件与绩效公式的职责）。',
    ],
  }
}

export const BACKLOG_TASK_EXAMINE_AI_CONTRACTS: Record<string, AiContract> = {
  'backlog-task-examine-review-score': base('backlog-task-examine-review-score', {
    purpose: '提交月度任务的审核评分与说明（写回该任务的 reviewScore / reviewScoreEvaluation，超额分一并写入），由后端在事务内锁流程后落库。',
    effect: 'write',
    inputs: {
      taskId: parameter(
        '**月度任务 id**（kpi_month_protocol_task.id），页面取的是任务评分页读到的 `monthTaskList[0].id`。不是流程实例 id、不是 bpm 任务 id、不是协议 id。',
        '任务评分页 GET /performance/protocol/kpimonthprotocol/getTaskInfo 返回的 monthTaskList[0].id',
        { type: 'string | number', constraints: ['安全正整数或无前导零的正整数字符串；不要用协议名、任务标题或 bpm 任务 id 代替'] },
      ),
      reviewScore: parameter(
        '完成审核评分，**绝对值**（不是增量、不是相对分）。后端对非客户拜访类任务必填，且不能超过该任务的完成分（completeScore）。',
        '用户在任务评分页给出的审核分，或按页面评分公式算出并确认的值',
        { type: 'number | string', constraints: ['不能为空', '不能超过该任务的完成分（后端校验，超了报「完成审核评分不能超过任务完成分」）', '页面上的评分公式与档位由前端组件+绩效配置决定，SDK 不重算'] },
      ),
      reviewScoreEvaluation: parameter('完成审核评分说明。', '任务评分页的评分说明输入框', {
        type: 'string | null',
        required: false,
        nullable: true,
        nullMeaning: '不填说明；后端会把 null 原样写入说明列',
        omitted: 'SDK 发 null（页面在没有说明时也是空值）',
      }),
      excessReviewScore: parameter(
        '超额审核评分。只在任务确有超额分时提供；有值时不能超过任务的超额分（excessScore）。',
        '任务评分页在 isExceed 时有值的超额评分',
        {
          type: 'number | string | null',
          required: false,
          requiredWhen: '任务有超额分（页面 isExceed 为真、excessTask 存在）且用户要对超额部分打分时',
          nullable: true,
          nullMeaning: '这次评分不涉及超额分；SDK 不发这个字段',
          omitted: '不发该字段（与页面在没有超额任务时的行为一致）',
        },
      ),
      excessReviewEvaluation: parameter('超额评分说明。', '任务评分页的超额评分说明输入框', {
        type: 'string | null',
        required: false,
        nullable: true,
        nullMeaning: '不填超额说明',
        omitted: '不发该字段',
      }),
    },
    output: {
      shape: 'void',
      fields: [
        field('$', 'void', 'SDK 不返回业务数据：Portal 提交后不读响应体（它只关心有没有抛错），所以这里不伪造任务 ID 或分数回执。'),
      ],
      empty: '请求失败（含后端两条业务校验）会抛错；成功没有返回值，是否真的写进去必须靠独立回查确认。',
    },
    consume: [
      '请求 body 只有五个键：id、reviewScore、reviewScoreEvaluation，以及有值时的 excessReviewScore/excessReviewEvaluation。**不要补上页面会发的自评分与领导分**（那是别的环节写的）。',
      '把提交的分数与任务 id 一起回显给用户：这是写操作，分数写进去后页面没有"撤销评分"入口（本能力也不提供）。',
      '⚠️ 提交成功后**待办不会消失**：页面随后还会走一步 bpm 审批（`/bpm/hr/task/approve`，本能力不覆盖）。要完成整条办理流程，需要在 Portal 页面上继续，或另行接入那一步。',
    ],
    steps: [
      { role: 'optional', when: '用户要确认这次评分是否已经落库', instruction: '目前没有配套的按 taskId 读分数的 SDK 能力：请在 Portal 的任务评分页/待办列表上核对该任务的审核分与说明（或先补一个读回能力）。不要用"请求没抛错"当成落库证据。' },
    ],
    completion: '请求未抛错且用户（在 Portal 页面上）确认该任务的审核分与说明已更新，才能报告评分已落库；**审批是否通过由后续 bpm 动作决定，本能力不作结论**。',
    idempotency: '端点没有 requestId 或其它防重键；写的是绝对值，同一份载荷重发终态相同，但后端的分数校验会随任务当前状态（是否已被别人评分、协议状态）变化 —— 超时后先回查任务当前分数再决定是否重发。',
  }),
}
