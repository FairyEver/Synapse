#!/usr/bin/env node
/**
 * 冒烟：请假申请（`qingjia`）在真实测试环境上的完整链路。
 *
 * 两种模式：
 *
 * ```bash
 * # 只读（默认）：定义 / 我是谁 / 类型字典 / 时长 / 年假 / prepare，一个字节都不写
 * smoke/with-portal-token.sh node smoke/leave-application.mjs
 *
 * # 完整链路：多跑 submit → 独立证实 → cancel → 再证实
 * smoke/with-portal-token.sh node smoke/leave-application.mjs --submit
 *
 * # 带附件（要 OSS 凭据，走另一条取凭据的路；两条可以套起来）
 * smoke/with-portal-token.sh smoke/with-oss-credentials.sh node smoke/leave-application.mjs --submit
 * ```
 *
 * ## ⚠️ `--submit` 会**真的给真人推待办**
 *
 * 用户 2026-09-20 的授权原文：「**允许在测试环境提交，接受打扰真人。**」
 * 但授权不是"随便提交"，脚本按下面几条自我约束：
 *
 * 1. **事由强制带 `SDK-TEST-` 前缀**（`assertTestData()`），不满足当场退出。
 *    请假表单**没有标题字段**，`reason` 是收到待办的人唯一能看出这是测试数据的地方。
 * 2. **时长压到 `restDay < 3`**（默认就是当天上午→下午 = 1 天）。这是**本流程特有**的一条：
 *    `qingjia` 的 BPMN 里 `请假审批` 之后有一个 `${restDay >= 3 }` 的网关分支，
 *    ≥3 天会**多推一个「领导审核」节点的待办**（多打扰一个人）。
 *    真要跑长请假，显式设 `PORTAL_SMOKE_ALLOW_LONG_LEAVE=yes`。
 * 3. **登录的人不能是审批人本人。** qingjia 的审批人是 BPMN 里**写死的用户 id**
 *    （15012 / 15170 / 17063），不是调用方能选的 —— 所以"避开"只能靠"别用这些账号跑"。
 *    后端有一条「流程发起人与审批人相同，自动审核通过」（`BpmTaskServiceImpl:913-916`）：
 *    发起人一旦是某个节点的审批人，那个节点会**当场通过**；三个全中则整条流程走完，
 *    `cancel-by-start-user` 就撤不掉了，会**永久留下一条撤不掉的单据**。
 *    这条写成了**提交之前**的一次拒绝。
 * 4. **提交成功后一定会尝试撤销**（`finally` 里）：`submit` 成功的分支上，无论后面哪步炸了
 *    都会去 `cancel`。
 * 5. **绝不碰别人的单据**：只操作本脚本自己刚建的那一条（按 submit 返回的 businessKey
 *    找流程实例，找不到就报错，不会"顺手取消列表里的第一条"）。
 * 6. **附件用完会删掉**（签名 DELETE，照 `smoke/upload.mjs` 那套做法）。删不掉会明确
 *    打印 objectKey 让**人**去清，不会假装干净。
 *
 * ## 为什么这个脚本直接 import `src/` 下的 .ts
 *
 * 它做两件事：拿 HTTP 管道（`createPortalHeadless`）与拿能力实现。
 *
 * - **管道**取自 `dist/index.js`（已构建产物）。HTTP 层本单没动过，dist 是 HEAD 构建的。
 * - **能力实现**取自 `../src/capabilities/leave-application.ts`——Node 22 的类型剥离
 *   直接认它。⚠️ 前提是这个文件**只 import type**，不能 import 别的能力模块的**值**：
 *   Node 的类型剥离**不会**把 `./x.js` 改写成 `./x.ts`（实测
 *   `ERR_MODULE_NOT_FOUND: .../general-approval.js`）。所以
 *   `assertAssigneesForTasks` 在能力文件里有一份本地复刻 —— 那条约束的由来写在
 *   能力文件头的导入注释里。
 *
 * ## 环境变量
 *
 * 必需（`smoke/with-portal-token.sh` 自动注入）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 *
 * 可选（`smoke/with-oss-credentials.sh` 自动注入；**给全了才会传附件**）：
 *   OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET / OSS_ENDPOINT / OSS_REGION
 *
 * 可选（调参；名字不进仓库）：
 *   PORTAL_SMOKE_LEAVE_START_DATE   开始日期 YYYY-MM-DD（默认：21 天后的那个周一）
 *   PORTAL_SMOKE_LEAVE_TYPE         请假类型（默认 3 = 事假；**事假要求附件**）
 *   PORTAL_SMOKE_ALLOW_LONG_LEAVE   设成 yes 才允许 restDay >= 3（会多推一个待办）
 */

const env = process.env

// ---------------------------------------------------------------------------
// 闸先跑，import 放在后面 —— 见 smoke/upload.mjs 里的同一段理由：
// 静态 import 会在任何一行代码之前求值，环境不完整时守卫反而一行都不执行。
// ---------------------------------------------------------------------------

const missing = Object.entries({
  PORTAL_BASE_URL: env.PORTAL_BASE_URL,
  PORTAL_TOKEN: env.PORTAL_TOKEN,
  PORTAL_TENANT_ID: env.PORTAL_TENANT_ID,
}).filter(([, value]) => !value).map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法（推荐，token 由脚本自己取）：\n' +
      '  smoke/with-portal-token.sh node smoke/leave-application.mjs [--submit]\n' +
      '带附件（再套一层 OSS 凭据）：\n' +
      '  smoke/with-portal-token.sh smoke/with-oss-credentials.sh node smoke/leave-application.mjs --submit\n',
  )
  process.exit(1)
}

const doSubmit = process.argv.includes('--submit')
const line = (text = '') => process.stdout.write(`${text}\n`)
const step = (n, text) => line(`\n[${n}] ${text}`)

/** 一眼能看出是测试数据 */
const TEST_PREFIX = 'SDK-TEST-'

function stamp () {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

/**
 * qingjia 的审批人是**写死的用户 id**（BPMN 的 `flowable:candidateParam`，
 * `candidateStrategy = 30 = USER`）。
 *
 * ⚠️ 这份表是**实测**出来的（`GET /system/user/simple-list` 全量 4225 人里按 id 反查），
 * 不是猜的。同时抄下来的还有 BPMN 里的两个网关条件。**流程改版这份表就会过期** ——
 * 所以脚本每次都会把自己读到的 `getRequiredStartUserSelectTasks` 结果打出来对照。
 */
const APPROVERS = [
  { node: '请假审批', userId: 15012, name: '乔娜', when: "creatorOrgFullPath 含「博创」" },
  { node: '直属上级', userId: 15012, name: '乔娜', when: "creatorOrgFullPath 不含「博创」" },
  { node: '领导审核', userId: 15170, name: '刘爱巧', when: 'restDay >= 3' },
  { node: 'HR', userId: 17063, name: '王威', when: '总是' },
]
const APPROVER_IDS = new Set(APPROVERS.map((a) => a.userId))

/** 这条请假会落到哪几个节点 / 打扰谁（按 BPMN 的网关条件推） */
function expectedRoute (restDay) {
  const route = [{ node: '请假审批', userId: 15012, name: '乔娜' }]
  if (Number(restDay) >= 3) route.push({ node: '领导审核', userId: 15170, name: '刘爱巧' })
  route.push({ node: 'HR', userId: 17063, name: '王威' })
  return route
}

/**
 * 默认开始日期：`offsetDays` 天后的那个周一。
 *
 * 为什么默认是 **70 天**而不是"下周一"：这个测试账号在测试环境里已经有一百多个
 * 日期的请假记录（大量是历次冒烟与人工测试留下的 `测试` / `去` / `2222`）。
 * 后端 `createAttendanceUserRel` 有一条「同一人 + 同一日期 + 同一上午/下午 已有
 * **运行中或已通过**的请假 ⇒ 报『已经有相同的请假在流程中了！』」的硬校验，
 * 所以离得远一点才不容易撞上。撞上了也不怕：见 `submitWithFreeDate()`。
 */
function defaultStartDate (offsetDays = 70) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * 日期被别人占用时**换一天再试**，最多 3 次。
 *
 * ⚠️ 这不是"批量提交"：后端那条冲突校验是**在插入任何数据、起任何流程之前**
 * 就 `return error(500, ...)` 的（`AttendanceUserRelServiceImpl` 里那个循环只做判定），
 * 所以被拒的那几次**一条记录都没建、一个待办都没推**。重试只是换一个日期，
 * 不是把同一件事发两遍。
 */
const DATE_TAKEN = '已经有相同的请假在流程中了'

async function submitWithFreeDate (submitOnce, firstDate) {
  let date = firstDate
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await submitOnce(date)
    } catch (error) {
      const message = String(error?.message ?? '')
      if (!message.includes(DATE_TAKEN) || attempt === 3) throw error
      const next = defaultStartDate((Number(process.env.PORTAL_SMOKE_LEAVE_DATE_OFFSET ?? 70)) + attempt * 7)
      line(`    ↻ ${date} 已经被这个账号的另一条流程占用了（后端硬校验），换 ${next} 再试一次`)
      line('      ↑ 被拒的这一次**没有建任何记录、没有推任何待办**（后端在插入前就返回了）')
      date = next
    }
  }
  throw new Error('不可能到这里')
}

const ossReady = Boolean(
  env.OSS_ACCESS_KEY_ID && env.OSS_ACCESS_KEY_SECRET && env.OSS_BUCKET && env.OSS_ENDPOINT,
)

async function loadModules () {
  const [{ createPortalHeadless }, leaveModule, uploadModule] = await Promise.all([
    import('../dist/index.js'),
    import('../src/capabilities/leave-application.ts'),
    ossReady ? import('../src/capabilities/base-upload.ts') : Promise.resolve(null),
  ])
  return { createPortalHeadless, leaveModule, uploadModule }
}

const { createPortalHeadless, leaveModule, uploadModule } = await loadModules()
const {
  LEAVE_APPLICATION_FORM_PATH,
  assertAssigneesForTasks,
  createLeaveApplicationCapability,
} = leaveModule

const sdk = createPortalHeadless({
  baseUrl: env.PORTAL_BASE_URL,
  credential: { token: env.PORTAL_TOKEN, tenantId: env.PORTAL_TENANT_ID },
  ...(ossReady
    ? {
        oss: {
          accessKeyId: env.OSS_ACCESS_KEY_ID,
          accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
          bucket: env.OSS_BUCKET,
          endpoint: env.OSS_ENDPOINT,
          region: env.OSS_REGION,
        },
      }
    : {}),
})

// 组装点接上之后就用它（那是真正对外的那一份）；还没接上时自己造一份，
// 走的是同一条 createPageCall（module-type 与 http 实例的推导完全一样）。
const capability =
  sdk.leaveApplication ??
  createLeaveApplicationCapability((requestConfig) => sdk.call(LEAVE_APPLICATION_FORM_PATH, requestConfig))

line(`环境 ${env.PORTAL_BASE_URL}，模式：${doSubmit ? '完整链路（含 submit，会打扰真人）' : '只读'}`)
line(`能力来源：${sdk.leaveApplication ? 'sdk.leaveApplication（组装点已接线）' : 'createLeaveApplicationCapability + sdk.call（组装点尚未接线）'}`)
line(`附件：${ossReady ? '会真传一个探针 pdf（用完删除）' : '不传（没有 OSS_* 凭据）'}`)

let createdBusinessKey
let uploadedObjectKey
let cancelled = false

try {
  // ---- 1. 流程定义 ----
  step(1, '流程定义（只读）GET /bpm/process-definition/get?key=qingjia')
  const definition = await capability.definition()
  line(`    名称=${definition.name} category=${definition.category} version=${definition.version}`)
  line(`    formFields=${JSON.stringify(definition.formFields)} formCustomCreatePath=${JSON.stringify(definition.formCustomCreatePath)}`)
  line('    ↑ 两个都是 null：字段契约拿不到，这也是本能力只能读前端源码的原因')

  // ---- 2. 我是谁 ----
  step(2, '我是谁（只读）GET /sys/user/info —— 载荷里那四个字段的唯一来源')
  const who = await capability.profile()
  line(`    id=${who.id} userName=${who.userName} staffCode=${who.staffCode}`)
  line(`    fullPath=${JSON.stringify(who.fullPath)}   ← organizationName，不是全路径`)
  if (Object.keys(who).some((k) => /password|salt|mobile/i.test(k))) {
    throw new Error('profile() 里出现了敏感字段 —— 它必须只投影 id/userName/staffCode/fullPath 四项')
  }
  line('    只投影了四项：password2 / salt / mobile 都没进来')

  // ---- 3. 类型字典 ----
  step(3, '请假类型字典（只读）GET /system/dict-data/grouped-list')
  const types = await capability.types()
  line(`    absent_type 实测 ${types.length} 个：${types.map((t) => `${t.value}=${t.label}`).join(' ')}`)
  const dictValue = types.find((t) => t.label === '事假')?.value
  line(`    ↑ 「事假」在字典里是 ${dictValue}（页面 checkType = [3,4,7,8,9] 里就有它 —— 它要求附件）`)

  /**
   * 默认类型取决于**有没有附件**：
   * - 有 OSS 凭据 → 3（事假），它是 `checkType = [3,4,7,8,9]` 里最日常的那个，
   *   正好把「附件必填」那条规则与整条上传链路一起跑到；
   * - 没有凭据 → 6（探亲假），它**不要求附件**，否则 `assertAttachmentRequired()`
   *   会在第一步就把这条只读冒烟拦下来（这是好事：规则真的在）。
   */
  const type = Number(env.PORTAL_SMOKE_LEAVE_TYPE ?? (ossReady && doSubmit ? 3 : 6))
  const runStamp = stamp()

  // ---- 4~5. 与日期无关的两步（放在换日期重试之外，免得重复上传 / 重复查询） ----
  step(4, '年假余额（只读）GET /hr/attendance-user-rel/getYearRest —— 只有 type=13 会拦提交')
  const yearRest = await capability.yearRest()
  line(`    rest=${yearRest.rest} unRest=${yearRest.unRest}（${type === 13 ? '本次就是年休假，余额会拦' : '本次不是年休假，它只是展示' }）`)

  let attachments = []
  if (ossReady && doSubmit) {
    // ⚠️ 只读模式**不传**：传了就会在桶里留一个孤儿对象，而只读模式下面
    // `process.exit(0)` 会把最后的清理那段跳过（这是第一版真写错的地方）。
    // 只读挡的是"发请求"，不是"写存储"——两者不是一回事。
    step(5, '传一个探针附件（写 OSS）POST base-upload-file，目录 HR/approval')
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n' +
        `% ${TEST_PREFIX}leave smoke ${runStamp}\n`,
      'utf8',
    )
    const uploaded = await sdk.baseUpload.upload({
      content: pdf,
      folder: 'HR/approval',
      fileName: `${TEST_PREFIX}leave-${runStamp}.pdf`,
    })
    uploadedObjectKey = uploaded.objectKey
    line(`    url=${uploaded.url}`)
    line(`    objectKey=${uploaded.objectKey} acl=${uploaded.acl ?? '(读不到)'}`)
    attachments = [{ url: uploaded.url, name: `${TEST_PREFIX}leave-${runStamp}.pdf` }]
  } else {
    step(5, ossReady ? '跳过附件（只读模式不写 OSS）' : '跳过附件（没有 OSS_* 凭据）')
    line('    ⚠️ 本表单的 accept 是 .pdf .jpg .jpeg .png，且事假/病假/婚假/丧假/产假**要求**附件')
    line(`    ⚠️ 因此本次用 type=${type}（不要求附件的类型），带附件的提交要走 with-oss-credentials.sh`)
  }

  /**
   * 一个日期的完整尝试：时长 → prepare → 几道拒绝 → submit。
   *
   * 抽成函数是为了**换日期重试**（见 `submitWithFreeDate`）：后端那条
   * 「同一人同一天同一半天已有运行中的请假」的冲突是按日期判的，
   * 撞上了只能换一天，而换了日期 `restDay` 与载荷都得跟着重算。
   */
  async function submitOnDate (startDate) {
    const period = { startDate, startType: 1, endDate: startDate, endType: 2 }

    step(6, `请假时长（只读）POST /hr/attendance-user-rel/getRestDuration —— ${startDate} 上午→下午`)
    const restDay = await capability.duration(period)
    line(`    restDay=${restDay} 天（这个数是**流程变量**：>= 3 会多走一个「领导审核」节点）`)
    line(`    本地 calculateDays 算的是 ${leaveModule.calculateLeaveDays(period.startDate, 1, period.endDate, 2)} 天；接口那个扣了法定节假日，两者不同是正常的`)

    // ---- 7. prepare ----
    const draft = {
      type,
      reason: `${TEST_PREFIX}请假冒烟 ${runStamp}（脚本会在同一轮里撤销它）`,
      ...period,
      attachments,
    }

    step(7, 'prepare（只读）POST /hr/attendance-user-rel/getRequiredStartUserSelectTasks')
    line(`    载荷：${JSON.stringify(draft)}`)
    const prepared = await capability.prepare(draft)
    line(`    restDay（现算）=${prepared.restDay}`)
    line(`    需要人工指定的审批人节点：${prepared.tasks.length} 个 ${JSON.stringify(prepared.tasks)}`)
    line('    ↑ 本流程实测**恒为空数组**：审批人是 BPMN 里写死的 3 个用户 id（candidateStrategy=30 USER）')

    if (!doSubmit) {
      step('完', '只读模式到此为止：没有创建任何单据、没有推任何待办。')
      process.exit(0)
    }

    // ---- 8. 提交前的几道拒绝 ----
    step(8, '提交前的几道拒绝（都在**发出 create 之前**）')

    if (!String(draft.reason).startsWith(TEST_PREFIX)) {
      throw new Error(`reason 必须以 ${TEST_PREFIX} 开头（收到 ${JSON.stringify(draft.reason)}）`)
    }
    line(`    ✓ 事由带 ${TEST_PREFIX} 前缀（本表单没有标题字段，事由就是唯一能看出是测试数据的地方）`)

    if (APPROVER_IDS.has(Number(who.id))) {
      throw new Error(
        `当前登录用户 id=${who.id}（${who.userName}）**就是本流程的审批人之一**` +
          `（${APPROVERS.map((a) => `${a.userId}=${a.name}(${a.node})`).join('、')}）。` +
          '后端有「流程发起人与审批人相同，自动审核通过」的规则，那个节点会当场通过；' +
          '三个节点全中时整条流程直接走完，`cancel-by-start-user` 必然报「流程不处于运行中」，' +
          '**会永久留下一条撤不掉的单据**。换一个不是这几个 id 的账号再跑。',
      )
    }
    line(`    ✓ 登录用户 id=${who.id} 不是审批人（审批人固定是 ${[...APPROVER_IDS].join(' / ')}）`)

    const route = expectedRoute(prepared.restDay)
    if (Number(prepared.restDay) >= 3 && env.PORTAL_SMOKE_ALLOW_LONG_LEAVE !== 'yes') {
      throw new Error(
        `restDay=${prepared.restDay} >= 3：BPMN 的 \${restDay >= 3 } 分支会多推一个` +
          '「领导审核」节点的待办，比必要多打扰一个人。' +
          '确实要跑长请假就显式设 PORTAL_SMOKE_ALLOW_LONG_LEAVE=yes。',
      )
    }
    line(
      `    ✓ restDay=${prepared.restDay}，这条流程会依次经过 ${route.length} 个节点：` +
        route.map((r) => `${r.node}→${r.name}(${r.userId})`).join('、'),
    )
    line('      ⚠️ 但**真正的待办只有第一个节点的那个**：后面的节点要等前一个办完才创建。')
    line(`      本次实际会打扰的是 ${route[0].name}(${route[0].userId}) 一个人（除非有人去审批，否则流程不会往下走）`)

    const assignees = {}
    for (const task of prepared.tasks) assignees[task.id] = []
    assertAssigneesForTasks(prepared.tasks, assignees)
    line(`    ✓ startUserSelectAssignees=${JSON.stringify(assignees)} 通过本地预检（本流程没有自选节点）`)

    // ---- 9. submit ----
    step(9, '★ submit（写操作：真的起流程、给上面那几个人推待办）POST /hr/attendance-user-rel/create')
    try {
      const submitResult = await capability.submit(draft, assignees)
      line(`    提交成功，业务单据 id（businessKey）= ${submitResult}`)
      return { businessKey: Number(submitResult), draft, restDay: prepared.restDay, route }
    } catch (error) {
      line(`    ✗ 提交失败：${error?.name || 'Error'} — ${error?.message || String(error)}`)
      if (error?.code !== undefined) line(`      code=${error.code} ret=${error.ret}`)
      throw error
    }
  }

  const firstDate = env.PORTAL_SMOKE_LEAVE_START_DATE || defaultStartDate()
  const submitted = await submitWithFreeDate(submitOnDate, firstDate)
  createdBusinessKey = submitted.businessKey
  const draft = submitted.draft
  const route = submitted.route

  try {
    // ---- 10. 独立证实 ①：按 id 查单据 ----
    step(10, '独立证实 ①（只读）GET /hr/attendance-user-rel/get?id=')
    const record = await capability.detail(createdBusinessKey)
    line(`    id=${record.id}（**恒为 null**：后端 getAttendanceUserRel 没 setId）typeName=${record.typeName}`)
    line(`    userId=${record.userId} startDate=${record.startDate}${record.startType} → endDate=${record.endDate}${record.endType}`)
    line(`    reason=${JSON.stringify(record.reason)} 附件=${(record.attachments ?? []).length} 件`)
    if (record.reason !== draft.reason) {
      throw new Error('详情里的事由与提交的不一致 —— 提交很可能没落地')
    }
    if (record.startDate !== draft.startDate || record.endDate !== draft.endDate) {
      throw new Error('详情里的起止日期与提交的不一致 —— 提交很可能没落地')
    }
    if ((record.attachments ?? []).length !== attachments.length) {
      throw new Error(
        `详情里的附件条数（${(record.attachments ?? []).length}）与提交的（${attachments.length}）不一致`,
      )
    }
    if (attachments.length) {
      const got = (record.attachments ?? [])[0]
      line(`    ↑ 附件真的回来了：${got.name} ${got.url}`)
      if (String(got.url) !== String(attachments[0].url)) {
        throw new Error('详情里的附件 url 与上传返回的不一致')
      }
    }

    // ---- 11. 独立证实 ②：在「我的流程」里找到它 ----
    step(11, '独立证实 ②（只读）GET /bpm/process-instance/my-page → findInstanceByBusinessKey')
    const instance = await capability.findInstanceByBusinessKey(createdBusinessKey)
    line(`    流程实例 id=${instance.id} key=${instance.processDefinitionKey} status=${instance.status}`)
    line(`    title=${JSON.stringify(instance.title)}`)
    if (instance.status !== 1) {
      throw new Error(
        `流程实例 status=${instance.status}，不是「审批中」（1）—— 可能被自动通过规则终结了，` +
          '接下来多半撤不掉，请人工看一眼',
      )
    }

    // ---- 12. cancel ----
    step(12, '★ cancel（写操作）DELETE /bpm/process-instance/cancel-by-start-user')
    const reason = `${TEST_PREFIX}冒烟脚本收尾撤销（自动）`
    await capability.cancel({ processInstanceId: instance.id, reason })
    cancelled = true
    line(`    已发出取消，reason=${JSON.stringify(reason)}`)
  } finally {
    if (!cancelled && createdBusinessKey !== undefined) {
      step('!', '中间某步失败了 —— 兜底再撤一次，绝不留一条活的待办在别人（或你自己的）箱子里')
      try {
        const instance = await capability.findInstanceByBusinessKey(createdBusinessKey)
        await capability.cancel({
          processInstanceId: instance.id,
          reason: `${TEST_PREFIX}兜底撤销（前一步失败）`,
        })
        cancelled = true
        line('    兜底撤销成功')
      } catch (error) {
        line(`    ✗ 兜底撤销也失败了，请手工处理 businessKey=${createdBusinessKey}：${error?.message}`)
      }
    }
  }

  // ---- 13. 撤销后的独立证实 ----
  step(13, '撤销后的独立证实（只读）')
  const afterInstance = await capability.findInstanceByBusinessKey(createdBusinessKey)
  line(`    流程实例 status=${afterInstance.status} endTime=${afterInstance.endTime ?? '-'}`)
  if (Number(afterInstance.status) !== 4) {
    line(`    ⚠️ status 不是 4（已取消），请人工确认 businessKey=${createdBusinessKey}`)
  } else {
    line('    ✓ status=4（已取消）')
  }
  const afterRecord = await capability.detail(createdBusinessKey)
  line(`    单据 typeName=${afterRecord.typeName} reason=${JSON.stringify(afterRecord.reason)}`)
  line('    ↑ 请假记录行**不会**随取消被删掉（后端没有这样的监听器）—— 取消的是流程，不是那两行半天记录')

  /**
   * 独立证实 ③：**审批链路**里到底有没有那条待办、落在谁头上。
   *
   * ⚠️ 这一步**不是能力的一部分**（`getWorkflowPath` 只读、但本能力没把它做成能力，
   * 理由写在 `docs/pages/请假申请.md` 的「尚未覆盖」），这里直接用 SDK 的 HTTP 管道
   * 打一次，目的是给「实际打扰了谁」留一条**可独立复核**的证据 ——
   * 光看「提交成功」说明不了那个人的待办箱里真的进过东西。
   */
  try {
    const path = await sdk.call(LEAVE_APPLICATION_FORM_PATH, {
      url: '/bpm/process-instance/getWorkflowPath',
      method: 'get',
      params: { processInstanceId: afterInstance.id },
    })
    for (const node of path ?? []) {
      line(
        `    审批链路节点「${node.name}」status=${node.status} ` +
          `审批人=${node.assigneeUser ? `${node.assigneeUser.id}/${node.assigneeUser.nickname}` : '(无)'} ` +
          `耗时=${node.durationInMillis ?? '-'}ms reason=${JSON.stringify(node.reason ?? '')}`,
      )
    }
    line('    ↑ 这就是「到底打扰了谁」的铁证：待办真的落到了上面这些人头上，然后被这次取消终结')
  } catch (error) {
    line(`    (审批链路没取到：${error?.message || String(error)} —— 不影响本轮的结论)`)
  }

  step('完', `完整链路跑通：提交 businessKey=${createdBusinessKey}，已撤销。`)
} catch (error) {
  process.stderr.write(`\n失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.stack) process.stderr.write(`${error.stack.split('\n').slice(1, 4).join('\n')}\n`)
  process.exitCode = 1
}

// ---------------------------------------------------------------------------
// 清理：删掉自己传的探针对象（签名 DELETE，照 smoke/upload.mjs 那套）
// ---------------------------------------------------------------------------

if (uploadedObjectKey) {
  step('清', `删掉探针对象 DELETE ${uploadedObjectKey}`)
  let cleaned = false
  try {
    const { assertOssConfig, prepareOssRequest } = uploadModule
    const config = assertOssConfig({
      accessKeyId: env.OSS_ACCESS_KEY_ID,
      accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
      bucket: env.OSS_BUCKET,
      endpoint: env.OSS_ENDPOINT,
      region: env.OSS_REGION,
    })
    const request = prepareOssRequest({ config, method: 'DELETE', objectKey: uploadedObjectKey })
    const response = await fetch(request.url, { method: request.method, headers: request.headers })
    cleaned = response.ok
    line(`    HTTP ${response.status}`)
  } catch (error) {
    line(`    ✗ 清理失败：${error?.message || String(error)}`)
  }
  if (!cleaned) {
    process.stderr.write(
      `\n⚠️ 自动清理失败，桶里留了一个探针对象，请人工删掉：\n   ${uploadedObjectKey}\n`,
    )
    process.exitCode = 1
  }
}
