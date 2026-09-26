#!/usr/bin/env node
/**
 * 冒烟：调休申请（`hr_rest_leave_application`）在真实测试环境上的完整链路。
 *
 * 三种模式：
 *
 * ```bash
 * # 只读（默认）：定义 / 当前用户 / 剩余加班时长 / prepare / 审批链预览，一个字节都不写
 * smoke/with-portal-token.sh node smoke/rest-leave-application.mjs
 *
 * # 完整链路：多跑 submit → 独立证实 → cancel → 再证实
 * smoke/with-portal-token.sh node smoke/rest-leave-application.mjs --submit
 *
 * # 带附件的那一轮：再叠一层 OSS 凭据（真传一个文件当附件）
 * smoke/with-portal-token.sh smoke/with-oss-credentials.sh \
 *   node smoke/rest-leave-application.mjs --submit --attach
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
 * 本流程的审批人不是选出来的、是后端按「直属上级」算的，所以判据只能是
 * **真实审批链**：`POST /bpm/process-instance/preview` 的 `nodes[].candidateUsers`。
 * 提交前先算一遍，命中就抛错、一个写请求都不发 —— 这正是
 * `assertNotSelfApprover()` 做的事（能力里也内置了同一条，这里再显式跑一次并打印）。
 *
 * ## ⚠️ 余量门槛：本流程有一条 SDK 本地复刻不了的硬门槛
 *
 * 后端 `RestLeaveApplicationServiceImpl.createApplication()` 会重算
 * 「剩余加班时长」并在 `调休时长 > 剩余加班时长` 时抛
 * 「**调休时长不能大于剩余加班时长**」。**那个值与本脚本打印的
 * `GET /hr/overtime-application/record/remaining-hours` 是两套算法**（见能力文件头 §三），
 * 所以脚本**不拿页面那个值当门槛**，只是把它打印出来供人核对；真被后端拒了就如实报错。
 *
 * ## 为什么这个脚本直接 import `src/` 下的 .ts
 *
 * **管道**取自 `dist/index.js`（已构建产物）；**能力实现**取自
 * `../src/capabilities/rest-leave-application.ts`——Node 22 的类型剥离直接认它
 * （这个文件只 import type，运行时没有别的依赖）。这样脚本**不需要先 `pnpm build`**。
 * 组装点接上 `sdk.restLeaveApplication` 之后会自动优先用它。
 *
 * 需要三个环境变量（凭据不落盘、不进代码；用 `smoke/with-portal-token.sh` 自动注入）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 * `--attach` 还要四个（用 `smoke/with-oss-credentials.sh` 注入）：
 *   OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET / OSS_ENDPOINT
 */

import { createPortalHeadless } from '../dist/index.js'
import {
  ATTACHMENT_OSS_FOLDER,
  REST_LEAVE_APPLICATION_FORM_PATH,
  REST_LEAVE_APPLICATION_PROCESS_KEY,
  assertNotSelfApprover,
  createRestLeaveApplicationCapability,
  findSelfInApprovalChain,
} from '../src/capabilities/rest-leave-application.ts'

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
      '  smoke/with-portal-token.sh node smoke/rest-leave-application.mjs [--submit] [--attach]\n',
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
const doAttach = process.argv.includes('--attach')
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

/** 门户时区的今天 + n 天，`YYYY-MM-DD` */
function portalDate (offsetDays = 0) {
  const ms = Date.now() + offsetDays * 86_400_000
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms))
}

/** 事由必须带前缀 —— 不满足就退出，不发写请求 */
function assertTestData (draft) {
  if (!String(draft.reason ?? '').startsWith(TEST_PREFIX)) {
    throw new Error(`reason 必须以 ${TEST_PREFIX} 开头（收到 ${JSON.stringify(draft.reason)}）`)
  }
}

// ---- 可选的附件：真传一个文件到 OSS，把返回的 url 当附件提交 ---------------

const ossEnv = {
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID,
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET,
  OSS_BUCKET: process.env.OSS_BUCKET,
  OSS_ENDPOINT: process.env.OSS_ENDPOINT,
}
if (doAttach) {
  const missingOss = Object.entries(ossEnv).filter(([, v]) => !v).map(([k]) => k)
  if (missingOss.length) {
    process.stderr.write(
      `--attach 需要 OSS 凭据，缺：${missingOss.join(', ')}\n` +
        '  用：smoke/with-portal-token.sh smoke/with-oss-credentials.sh node smoke/rest-leave-application.mjs --submit --attach\n',
    )
    process.exit(1)
  }
}

/** 一个**真的** 1x1 PNG（不是随便几个字节改了扩展名）——本表单的 accept 只收 pdf/jpg/jpeg/png */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const sdk = createPortalHeadless({
  baseUrl,
  credential: { token, tenantId },
  ...(doAttach
    ? {
        oss: {
          accessKeyId: ossEnv.OSS_ACCESS_KEY_ID,
          accessKeySecret: ossEnv.OSS_ACCESS_KEY_SECRET,
          bucket: ossEnv.OSS_BUCKET,
          endpoint: ossEnv.OSS_ENDPOINT,
        },
      }
    : {}),
})

const capability =
  sdk.restLeaveApplication ??
  createRestLeaveApplicationCapability((requestConfig) => sdk.call(REST_LEAVE_APPLICATION_FORM_PATH, requestConfig))

line(`环境 ${baseUrl}，模式：${doSubmit ? '完整链路（含 submit，会打扰真人）' : '只读'}${doAttach ? ' + 附件' : ''}`)
line(
  `能力来源：${sdk.restLeaveApplication ? 'sdk.restLeaveApplication（组装点已接线）' : 'createRestLeaveApplicationCapability + sdk.call（组装点尚未接线）'}`,
)

let createdBusinessKey
let cancelled = false
/** 提交与撤销的时刻，用来算"打扰了多久" */
let submittedAt
let cancelledAt
let uploadedAttachment

try {
  // ---- 1. 流程定义 ----
  step(1, `流程定义（只读）GET /bpm/process-definition/get?key=${REST_LEAVE_APPLICATION_PROCESS_KEY}`)
  const definition = await capability.definition()
  line(`    名称=${definition.name} category=${definition.category} version=${definition.version}`)
  line(
    `    formFields=${JSON.stringify(definition.formFields)} formCustomCreatePath=${JSON.stringify(definition.formCustomCreatePath)}`,
  )
  line('    ↑ 两个都是 null：字段契约拿不到，所以本能力的字段是从 043 的前端源码逐条抄的')
  const userTask = /<userTask[^>]*candidateStrategy="(\d+)"[^>]*/.exec(String(definition.bpmnXml ?? ''))
  const taskName = /<userTask[^>]*name="([^"]*)"[^>]*/.exec(String(definition.bpmnXml ?? ''))
  line(
    `    bpmnXml 里的审批节点：name=${JSON.stringify(taskName?.[1] ?? null)} candidateStrategy=${userTask?.[1] ?? null}` +
      '（23 = DIRECT_LEADER「直属上级」⇒ 审批人由后端算，不是发起人选的）',
  )

  // ---- 2. 当前用户 ----
  step(2, '当前用户（只读）GET /sys/user/info —— 姓名/工号/部门那几个只读字段的来源')
  const me = await capability.currentUser()
  line(`    id=${me.id}（字符串）realName=${me.realName} username=${me.username}（★ 工号就是它）`)
  line(`    organizationId=${me.organizationId}（字符串）organizationName=${me.organizationName}`)
  line(`    白名单收敛后的字段：${Object.keys(me).sort().join(', ')}`)
  if (JSON.stringify(me).match(/password2|salt/)) {
    throw new Error('★ 当前用户的返回值里出现了 password2 / salt —— 白名单失效了')
  }
  line('    ✓ 返回值里没有 password2 / salt（这两个字段 /sys/user/info 原响应里是有的）')

  // ---- 3. 剩余加班时长（本表单独有的那一格） ----
  step(3, '剩余加班时长（只读）GET /hr/overtime-application/record/remaining-hours')
  const remaining = await capability.remainingOvertimeHours(me.id)
  line(`    页面上「剩余加班时长」那一格 = ${remaining} 小时`)
  line(
    '    ⚠️ 这只是**页面显示的那个值**；后端 create 的门槛用的是另一套算法（限当年、且只减已审批），' +
      '两者可以不等 —— 见能力文件头 §三',
  )

  // ---- 4. 草稿 ----
  const draft = {
    reason: `${TEST_PREFIX}调休申请冒烟 ${stamp()}`,
    leaveDateItems: [
      // 用**未来**的两个工作日（调休是先去休息，真实场景就是这样）；两行是为了让
      // "多行明细"这条形态也被真实链路走到，而不是只测单行
      { leaveDate: portalDate(2), leaveHours: 1 },
      { leaveDate: portalDate(3), leaveHours: 0.5 },
    ],
  }
  assertTestData(draft)
  step(4, '本次草稿（只读，还没提交）')
  line(`    载荷：${JSON.stringify(draft)}`)

  // ---- 5. 附件（可选）----
  if (doAttach) {
    step(5, `附件上传（写 OSS）sdk.baseUpload.upload() → 目录 ${ATTACHMENT_OSS_FOLDER}`)
    uploadedAttachment = await sdk.baseUpload.upload({
      content: ONE_PIXEL_PNG,
      fileName: `sdk-test-${stamp()}.png`,
      folder: ATTACHMENT_OSS_FOLDER,
    })
    line(`    已上传 url=${uploadedAttachment.url}`)
    line(`    objectKey=${uploadedAttachment.objectKey} size=${uploadedAttachment.size} contentType=${uploadedAttachment.contentType}`)
    draft.attachments = [{ url: uploadedAttachment.url, name: `sdk-test-${stamp()}.png`, size: uploadedAttachment.size }]
    line(`    作为附件放进草稿：${JSON.stringify(draft.attachments)}`)
  }

  // ---- 6. prepare ----
  step(6, 'prepare（只读）POST /hr/rest-leave-application/getRequiredStartUserSelectTasks')
  const prepared = await capability.prepare(draft)
  line(`    只读联动算出来的：${JSON.stringify(prepared.derived)}`)
  line(`    需要人工指定的审批人节点：${prepared.tasks.length} 个`)
  for (const task of prepared.tasks) line(`      - ${task.name}（${task.id}）`)
  line('    ↑ 实测恒为 0 个：本流程没有 candidateStrategy=35「发起人自选」节点')
  line(`    调休时长（明细行合计）= ${prepared.derived.leaveHours} 小时`)
  line(`    submit 会发的 body（不含 startUserSelectAssignees）：${JSON.stringify(prepared.payload)}`)

  // ---- 7. ★ 审批链预览（守卫的判据） ----
  step(7, '★ 审批链预览（只读）POST /bpm/process-instance/preview —— 看清会打扰谁')
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

  // ---- 8. submit ----
  step(8, '★ submit（写操作：真的起流程、给上面那些候选人推待办）POST /hr/rest-leave-application/create')
  submittedAt = Date.now()
  let submitResult
  try {
    submitResult = await capability.submit(draft)
    createdBusinessKey = Number(submitResult)
    line(`    提交成功，业务单据 id（businessKey）= ${submitResult}`)
  } catch (error) {
    line(`    ✗ 提交失败：${error?.name || 'Error'} — ${error?.message || String(error)}`)
    if (error?.code !== undefined) line(`      code=${error.code} ret=${error.ret}`)
    if (/调休时长不能大于剩余加班时长/.test(String(error?.message ?? ''))) {
      line('      ↑ 这是后端那条硬门槛（§三）：页面显示的剩余时长与后端门槛用的不是同一套算法')
    }
    throw error
  }

  try {
    // ---- 9. 独立证实 ①：按 id 查单据 ----
    step(9, '独立证实 ①（只读）GET /hr/rest-leave-application/get?id=')
    const record = await capability.detail(createdBusinessKey)
    line(
      `    id=${record.id} status=${record.status}(${record.statusName}) ` +
        `调休时长=${record.leaveHours} 类型=${record.leaveType} 申请人=${record.applicantName}`,
    )
    line(`    汇总日期 ${record.startDate} → ${record.endDate}  剩余加班时长=${record.remainingOvertimeHours}`)
    line(`    明细行：${JSON.stringify(record.leaveDateItems)}`)
    line(`    附件：${JSON.stringify(record.attachments)}`)
    line(
      '    ⚠️ 详情里没有 processInstanceId（RestLeaveApplicationRespVO 就没这个字段）—— 撤销要走「我的流程」',
    )
    if (record.reason !== draft.reason) {
      throw new Error(`详情里的事由与提交的不一致：${JSON.stringify(record.reason)}`)
    }
    if (Number(record.leaveHours) !== Number(prepared.derived.leaveHours)) {
      throw new Error(
        `详情里的调休时长 ${record.leaveHours} 与 SDK 算的 ${prepared.derived.leaveHours} 不一致`,
      )
    }
    if (String(record.applicantName) !== me.realName) {
      throw new Error(`详情里的申请人 ${record.applicantName} 不是当前用户 ${me.realName}`)
    }
    // 明细行：**逐行**对回去（不是只看条数）——多行用例才有意义
    const submittedItems = prepared.payload.leaveDateItems
    const returnedItems = (record.leaveDateItems ?? []).map((row) => ({
      leaveDate: row.leaveDate,
      leaveHours: Number(row.leaveHours),
    }))
    const expectedItems = submittedItems
      .map((row) => ({ leaveDate: row.leaveDate, leaveHours: row.leaveHours }))
      .sort((a, b) => (a.leaveDate < b.leaveDate ? -1 : 1))
    if (JSON.stringify(returnedItems) !== JSON.stringify(expectedItems)) {
      throw new Error(
        `详情里的明细行与提交的不一致：提交 ${JSON.stringify(expectedItems)}，回读 ${JSON.stringify(returnedItems)}`,
      )
    }
    line(`    ✓ 事由 / 调休时长 / 申请人 / ${returnedItems.length} 行明细 与提交的逐字段一致`)

    if (doAttach) {
      // 附件的独立证实：回读的 url/name 必须与真传上去的那个一致
      const back = (record.attachments ?? [])[0]
      if (!back || back.url !== uploadedAttachment.url) {
        throw new Error(
          `详情里回读的附件 url 与上传的不一致：上传 ${uploadedAttachment.url}，回读 ${JSON.stringify(back?.url)}`,
        )
      }
      line(`    ✓ 附件也回读到了（url 与真传上去的那一个逐字符一致）：${back.name}`)
    }

    // ---- 10. 独立证实 ②：在「我的流程」里找到它 ----
    step(10, '独立证实 ②（只读）GET /bpm/process-instance/my-page → findInstanceByBusinessKey')
    const instance = await capability.findInstanceByBusinessKey(createdBusinessKey)
    line(`    流程实例 id=${instance.id} key=${instance.processDefinitionKey} status=${instance.status}`)
    line(`    title=${JSON.stringify(instance.title)} 发起人=${JSON.stringify(instance.startUser?.nickname ?? null)}`)
    if (instance.processDefinitionKey !== REST_LEAVE_APPLICATION_PROCESS_KEY) {
      throw new Error(`找回来的实例 key 不对：${instance.processDefinitionKey}`)
    }
    if (instance.status !== 1) {
      throw new Error(
        `流程实例 status=${instance.status}，不是 1（审批中）—— 说明流程没在跑，可能撞上了` +
          '「发起人与审批人相同，自动审核通过」。那样就撤不掉了，见文档。',
      )
    }
    line('    ✓ status=1（审批中），它确实在等上面那位审批人')

    // ---- 11. cancel ----
    step(11, '★ cancel（写操作）DELETE /bpm/process-instance/cancel-by-start-user')
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

  // ---- 12. 撤销后的独立证实（**证据，不是"接口返回成功"**） ----
  step(12, '撤销后的独立证实（只读）—— 这是"真的撤掉了"的证据')
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
  if (uploadedAttachment) line(`    OSS 上留下了对象（附件本身不会被撤销带走）：${uploadedAttachment.objectKey}`)
} catch (error) {
  process.stderr.write(`\n失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.stack) process.stderr.write(`${error.stack.split('\n').slice(1, 4).join('\n')}\n`)
  process.exit(1)
}
