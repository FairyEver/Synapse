#!/usr/bin/env node
/**
 * 冒烟：加班申请（`hr_overtime_application`）在真实测试环境上的完整链路。
 *
 * 两种模式：
 *
 * ```bash
 * # 只读（默认）：定义 / 当前用户 / prepare / 审批链预览，一个字节都不写
 * smoke/with-portal-token.sh node smoke/overtime-application.mjs
 *
 * # 完整链路：多跑 submit → 独立证实 → cancel → 再证实
 * smoke/with-portal-token.sh node smoke/overtime-application.mjs --submit
 * ```
 *
 * ## ⚠️ `--submit` 会**真的给真人推待办**
 *
 * 用户 2026-09-20 的授权原文：「**允许在测试环境提交，接受打扰真人。**」
 * 但授权不是"随便提交"，脚本按下面几条自我约束：
 *
 * 1. **事由强制带 `SDK-TEST-` 前缀**，脚本自己先断言一次（`assertTestData()`），
 *    不满足就当场退出——收到待办的人一眼能看出这是测试数据。
 * 2. **审批人不由脚本选，也选不了**：本流程没有「发起人自选」节点（实测
 *    `getRequiredStartUserSelectTasks` 返回 `[]`），审批人是后端按
 *    `candidateStrategy=23`（直属上级）算出来的。脚本能做的是**在提交前把会打扰谁打印出来**，
 *    并在**审批人就是发起人本人时拒绝提交**（见下）。
 * 3. **提交成功后一定会尝试撤销**（在 `finally` 里）：无论后面第几步炸了，都会去 `cancel`。
 * 4. **绝不碰别人的单据**：只操作本脚本自己刚建的那一条（按 submit 返回的 businessKey
 *    找流程实例，找不到就报错，不会"顺手取消列表里的第一条"）。
 * 5. **绝不在生产环境跑**：只对 `biz-api-test.wodecorp.cn` / `webtest01.wodecorp.cn`。
 *
 * ## ⚠️ 为什么这条脚本**必须**先跑一次审批链预览
 *
 * 后端有一条「流程发起人与审批人相同，自动审核通过」：命中时流程当场走完，
 * `cancel-by-start-user` 从此必然报「流程取消失败，流程不处于运行中」——
 * **那条单据永远撤不掉**（测试环境里已经因此留了 3 条）。
 *
 * 前几条流程线的脚本靠"别把审批人选成自己"防住它；**本流程防不了那一条**，
 * 因为审批人不是选出来的、是后端按「直属上级」算的。所以这里的判据换成
 * **真实审批链**：`POST /bpm/process-instance/preview` 的 `nodes[].candidateUsers`。
 * 提交前先算一遍，命中就抛错、一个写请求都不发 —— 这正是
 * `assertNotSelfApprover()` 做的事（能力里也内置了同一条，这里再显式跑一次并打印）。
 *
 * ## 为什么这个脚本直接 import `src/` 下的 .ts
 *
 * **管道**取自 `dist/index.js`（已构建产物）；**能力实现**取自
 * `../src/capabilities/overtime-application.ts`——Node 22 的类型剥离直接认它
 * （这个文件只 import type，运行时没有别的依赖）。这样脚本**不需要先 `pnpm build`**。
 * 组装点接上 `sdk.overtimeApplication` 之后会自动优先用它。
 *
 * 需要三个环境变量（凭据不落盘、不进代码；用 `smoke/with-portal-token.sh` 自动注入）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 */

import { createPortalHeadless } from '../dist/index.js'
import {
  OVERTIME_APPLICATION_FORM_PATH,
  OVERTIME_APPLICATION_PROCESS_KEY,
  assertNotSelfApprover,
  createOvertimeApplicationCapability,
  findSelfInApprovalChain,
} from '../src/capabilities/overtime-application.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法（推荐，token 由脚本自己取）：\n' +
      '  smoke/with-portal-token.sh node smoke/overtime-application.mjs [--submit]\n',
  )
  process.exit(1)
}

/** 红线：这个脚本只对测试环境成立 */
if (!/biz-api-test\.wodecorp\.cn/.test(baseUrl)) {
  process.stderr.write(
    `拒绝执行：baseUrl 是 ${baseUrl}，不是测试后端 biz-api-test.wodecorp.cn。\n` +
      '本脚本会真的发起流程、给真人推待办，**只允许在测试环境**跑。\n',
  )
  process.exit(2)
}

const doSubmit = process.argv.includes('--submit')
const line = (text = '') => process.stdout.write(`${text}\n`)
const step = (n, text) => line(`\n[${n}] ${text}`)

/** 一眼能看出是测试数据 */
const TEST_PREFIX = 'SDK-TEST-'

/** 带 `SDK-TEST-` 前缀的、一眼看出是测试数据的唯一后缀（用门户时区，免得看起来像日期错了） */
function stamp () {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date())
  return parts.replace(/[-:]/g, '').replace(', ', '')
}

/** 事由必须带前缀 —— 不满足就退出，不发写请求 */
function assertTestData (draft) {
  if (!String(draft.reason ?? '').startsWith(TEST_PREFIX)) {
    throw new Error(`reason 必须以 ${TEST_PREFIX} 开头（收到 ${JSON.stringify(draft.reason)}）`)
  }
}

const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })

const capability =
  sdk.overtimeApplication ??
  createOvertimeApplicationCapability((requestConfig) => sdk.call(OVERTIME_APPLICATION_FORM_PATH, requestConfig))

line(`环境 ${baseUrl}，模式：${doSubmit ? '完整链路（含 submit，会打扰真人）' : '只读'}`)
line(
  `能力来源：${sdk.overtimeApplication ? 'sdk.overtimeApplication（组装点已接线）' : 'createOvertimeApplicationCapability + sdk.call（组装点尚未接线）'}`,
)

let createdBusinessKey
let cancelled = false
/** 提交与撤销的时刻，用来算"打扰了多久" */
let submittedAt
let cancelledAt

try {
  // ---- 1. 流程定义 ----
  step(1, `流程定义（只读）GET /bpm/process-definition/get?key=${OVERTIME_APPLICATION_PROCESS_KEY}`)
  const definition = await capability.definition()
  line(`    名称=${definition.name} category=${definition.category} version=${definition.version}`)
  line(
    `    formFields=${JSON.stringify(definition.formFields)} formCustomCreatePath=${JSON.stringify(definition.formCustomCreatePath)}`,
  )
  line('    ↑ 两个都是 null：字段契约拿不到，所以本能力的字段是从 042 的前端源码逐条抄的')
  // 审批链的来源：bpmnXml 里那条 userTask
  const userTask = /<userTask[^>]*candidateStrategy="(\d+)"[^>]*/.exec(String(definition.bpmnXml ?? ''))
  const taskName = /<userTask[^>]*name="([^"]*)"[^>]*/.exec(String(definition.bpmnXml ?? ''))
  line(
    `    bpmnXml 里的审批节点：name=${JSON.stringify(taskName?.[1] ?? null)} candidateStrategy=${userTask?.[1] ?? null}` +
      '（23 = DIRECT_LEADER「直属上级」⇒ 审批人由后端算，不是发起人选的）',
  )

  // ---- 2. 当前用户 ----
  step(2, '当前用户（只读）GET /sys/user/info —— 申请人/申请时间/申请部门那几个只读字段的来源')
  const me = await capability.currentUser()
  line(`    id=${me.id}（字符串）realName=${me.realName} organizationId=${me.organizationId}(${me.organizationName})`)
  line(`    白名单收敛后的字段：${Object.keys(me).sort().join(', ')}`)
  if (JSON.stringify(me).match(/password2|salt/)) {
    throw new Error('★ 当前用户的返回值里出现了 password2 / salt —— 白名单失效了')
  }
  line('    ✓ 返回值里没有 password2 / salt（这两个字段 /sys/user/info 原响应里是有的）')

  // ---- 3. 草稿 ----
  const draft = {
    reason: `${TEST_PREFIX}加班申请冒烟 ${stamp()}`,
    overtimeType: 0,
    subsidyType: 0,
    // 用一个**已经过去**的工作日晚间（真实场景就是这样：昨晚加了班，今天来补单）
    startTime: '2026-09-20 18:00:00',
    endTime: '2026-09-20 21:00:00',
    breakHours: 0.5,
  }
  assertTestData(draft)
  step(3, '本次草稿（只读，还没提交）')
  line(`    载荷：${JSON.stringify(draft)}`)
  line(`    加班时长由 SDK 按页面算法算出（页面那个框是 disabled 的，用户改不了）`)

  // ---- 4. prepare ----
  step(4, 'prepare（只读）POST /hr/overtime-application/getRequiredStartUserSelectTasks')
  const prepared = await capability.prepare(draft)
  line(`    只读联动算出来的：${JSON.stringify(prepared.derived)}`)
  line(`    需要人工指定的审批人节点：${prepared.tasks.length} 个`)
  for (const task of prepared.tasks) line(`      - ${task.name}（${task.id}）`)
  line('    ↑ 实测恒为 0 个：本流程没有 candidateStrategy=35「发起人自选」节点')
  line(`    submit 会发的 body（不含 startUserSelectAssignees）：${JSON.stringify(prepared.payload)}`)

  // ---- 5. ★ 审批链预览（守卫的判据） ----
  step(5, '★ 审批链预览（只读）POST /bpm/process-instance/preview —— 看清会打扰谁')
  const preview = await capability.approvalChain(prepared.payload)
  line(`    流程=${preview.processDefinitionName} state=${preview.state}`)
  for (const node of preview.nodes ?? []) {
    const users = (node.candidateUsers ?? []).map((u) => `${u.nickname ?? ''}(${u.id})`).join(', ')
    line(
      `      - ${node.type} ${node.name ?? node.nodeId}` +
        `${node.candidateStrategy ? ` [strategy=${node.candidateStrategy} ${node.candidateStrategyName ?? ''}]` : ''}` +
        `${users ? ` → 候选人 ${users}` : ''}`,
    )
  }
  const hits = findSelfInApprovalChain(preview, me.numericId)
  if (hits.length > 0) {
    // 这一条**必须在 submit 之前**抛：命中时流程会当场走完，单据永远撤不掉
    assertNotSelfApprover(preview, me.numericId)
  }
  line(`    ✓ 审批链里没有发起人本人（${me.realName} ${me.numericId}）—— 可以提交`)

  if (!doSubmit) {
    step('完', '只读模式到此为止：没有创建任何单据、没有推任何待办。')
    process.exit(0)
  }

  // ---- 6. submit ----
  step(6, '★ submit（写操作：真的起流程、给上面那些候选人推待办）POST /hr/overtime-application/create')
  submittedAt = Date.now()
  let submitResult
  try {
    submitResult = await capability.submit(draft)
    createdBusinessKey = Number(submitResult)
    line(`    提交成功，业务单据 id（businessKey）= ${submitResult}`)
  } catch (error) {
    line(`    ✗ 提交失败：${error?.name || 'Error'} — ${error?.message || String(error)}`)
    if (error?.code !== undefined) line(`      code=${error.code} ret=${error.ret}`)
    throw error
  }

  try {
    // ---- 7. 独立证实 ①：按 id 查单据 ----
    step(7, '独立证实 ①（只读）GET /hr/overtime-application/get?id=')
    const record = await capability.detail(createdBusinessKey)
    line(
      `    id=${record.id} status=${record.status}(${record.statusName}) ` +
        `加班时长=${record.overtimeHours} 类型=${record.overtimeType} 补贴=${record.subsidyType}`,
    )
    line(`    时段 ${record.startTime} → ${record.endTime} 休息 ${record.breakHours} 小时`)
    line(
      `    ⚠️ 详情里没有 processInstanceId（OvertimeApplicationRespVO 就没这个字段）—— 撤销要走「我的流程」`,
    )
    if (record.reason !== draft.reason) {
      throw new Error(`详情里的事由与提交的不一致：${JSON.stringify(record.reason)}`)
    }
    if (Number(record.overtimeHours) !== Number(prepared.derived.overtimeHours)) {
      throw new Error(
        `详情里的加班时长 ${record.overtimeHours} 与 SDK 算的 ${prepared.derived.overtimeHours} 不一致`,
      )
    }
    if (String(record.applicantId) !== me.id) {
      throw new Error(`详情里的申请人 ${record.applicantId} 不是当前用户 ${me.id}`)
    }
    line('    ✓ 事由 / 加班时长 / 申请人 与提交的逐字段一致')

    // ---- 8. 独立证实 ②：在「我的流程」里找到它 ----
    step(8, '独立证实 ②（只读）GET /bpm/process-instance/my-page → findInstanceByBusinessKey')
    const instance = await capability.findInstanceByBusinessKey(createdBusinessKey)
    line(`    流程实例 id=${instance.id} key=${instance.processDefinitionKey} status=${instance.status}`)
    line(`    title=${JSON.stringify(instance.title)} 发起人=${JSON.stringify(instance.startUser?.nickname ?? null)}`)
    if (instance.processDefinitionKey !== OVERTIME_APPLICATION_PROCESS_KEY) {
      throw new Error(`找回来的实例 key 不对：${instance.processDefinitionKey}`)
    }
    if (instance.status !== 1) {
      throw new Error(
        `流程实例 status=${instance.status}，不是 1（审批中）—— 说明流程没在跑，可能撞上了` +
          '「发起人与审批人相同，自动审核通过」。那样就撤不掉了，见文档。',
      )
    }
    line('    ✓ status=1（审批中），它确实在等上面那位审批人')

    // ---- 9. cancel ----
    step(9, '★ cancel（写操作）DELETE /bpm/process-instance/cancel-by-start-user')
    const reason = `${TEST_PREFIX}冒烟脚本收尾撤销（自动）`
    await capability.cancel({ processInstanceId: instance.id, reason })
    cancelled = true
    cancelledAt = Date.now()
    line(`    已发出取消，reason=${JSON.stringify(reason)}`)
  } finally {
    if (!cancelled && createdBusinessKey !== undefined) {
      step('!', '中间某步失败了 —— 兜底再撤一次，绝不留一条活的待办在别人的箱子里')
      try {
        const instance = await capability.findInstanceByBusinessKey(createdBusinessKey)
        await capability.cancel({
          processInstanceId: instance.id,
          reason: `${TEST_PREFIX}兜底撤销（前一步失败）`,
        })
        cancelled = true
        cancelledAt = Date.now()
        line('    兜底撤销成功')
      } catch (error) {
        line(`    ✗ 兜底撤销也失败了，请手工处理 businessKey=${createdBusinessKey}：${error?.message}`)
      }
    }
  }

  // ---- 10. 撤销后的独立证实（**证据，不是"接口返回成功"**） ----
  step(10, '撤销后的独立证实（只读）—— 这是"真的撤掉了"的证据')
  const after = await capability.detail(createdBusinessKey)
  line(`    单据 status=${after.status}(${after.statusName})  ← 期望 4（已取消）`)
  const afterInstance = await capability.findInstanceByBusinessKey(createdBusinessKey)
  line(`    流程实例 status=${afterInstance.status} endTime=${afterInstance.endTime ?? '-'}  ← 期望 status=4`)
  if (after.status !== 4) {
    throw new Error(`撤销后单据 status=${after.status}，不是 4（已取消）—— 撤销没有真的落地`)
  }
  if (afterInstance.status !== 4) {
    throw new Error(`撤销后流程实例 status=${afterInstance.status}，不是 4（已取消）`)
  }
  line('    ✓ 两条读接口都确认已取消（不是靠 cancel 的返回值下结论）')

  const seconds = ((cancelledAt ?? Date.now()) - (submittedAt ?? Date.now())) / 1000
  step('完', `完整链路跑通：businessKey=${createdBusinessKey}，已撤销，待办存活 ${seconds.toFixed(2)}s。`)
  line(`    实际打扰：${(preview.nodes ?? [])
    .filter((n) => n.type === 'USER_TASK')
    .flatMap((n) => (n.candidateUsers ?? []).map((u) => `${u.nickname ?? ''}(${u.id})`))
    .join('、') || '（没有解析出候选人）'}`)
} catch (error) {
  process.stderr.write(`\n失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.stack) process.stderr.write(`${error.stack.split('\n').slice(1, 4).join('\n')}\n`)
  process.exit(1)
}
