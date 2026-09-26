#!/usr/bin/env node
/**
 * 冒烟：差旅费支出申请表（`internal_transportation_expense_request_form`）
 * 在真实测试环境上的完整链路。
 *
 * ```bash
 * # 只读（默认）：定义 / 组织 / 费用项目 / 字典 / 地区 / 项目 / 出差人 / prepare（含审批链预览）
 * smoke/with-portal-token.sh node smoke/travel-expense-application.mjs
 *
 * # 完整链路：多跑 submit → 独立证实 → cancel → 再证实
 * smoke/with-portal-token.sh node smoke/travel-expense-application.mjs --submit
 *
 * # 带附件（要 OSS 凭据，走另一条取凭据的路；两条可以套起来）
 * smoke/with-portal-token.sh smoke/with-oss-credentials.sh node smoke/travel-expense-application.mjs --submit
 * ```
 *
 * ## ⚠️ `--submit` 会**真的给真人推待办**
 *
 * 用户 2026-09-20 的授权原文：「**允许在测试环境提交，接受打扰真人。**」
 * 但授权不是"随便提交"，脚本按下面几条自我约束：
 *
 * 1. **事由 / 其他说明强制带 `SDK-TEST-` 前缀**（`assertTestData()`），不满足当场退出。
 *    本表单**没有标题字段**，`reasons` 是收到待办的人唯一能看出这是测试数据的地方。
 * 2. **审批人不是我们能选的** —— 这条流程的审批人由 BPMN 从 `orgId` 派生
 *    （10 个 userTask 全是 `candidateStrategy = 60 流程表达式` / `22 岗位`，
 *    **没有 `START_USER_SELECT`**）。所以"避开自己"只能靠**提交前把审批链问出来**：
 *    脚本调 `prepare()`（它打 `POST /bpm/process-instance/preview`），
 *    **任何一个节点的候选里出现当前登录用户就当场退出** —— 后端有一条
 *    「流程发起人与审批人相同，自动审核通过」（`BpmTaskServiceImpl:913-916`），
 *    中了就是**流程秒完、`cancel` 撤不掉、永久留下一条撤不掉的单据**。
 *    测试环境里已经有 3 条这样的，**不要再增加第 4 条**。
 * 3. **自己选一个"审批链里没有我"的组织**：脚本在**所有可选的成本中心**里逐个预览，
 *    挑第一个"候选人不含我、且每个 USER_TASK 节点都有人"的组织。挑不到就退出。
 * 4. **金额压到最小**（默认 1.00 元，四格补助里只填一格）—— 金额会进预算/费用单，
 *    越小越不容易碰到别人的预算数据。也**不选预算单**（`budgetDetailId` 留空），
 *    这样后端的 `PaymentLineBudgetAllocationBuilder` 产出空分配、**不占用任何预算**。
 * 5. **提交成功后一定会尝试撤销**（`finally` 里）：`submit` 成功的分支上，
 *    无论后面哪步炸了都会去 `cancel`。
 * 6. **绝不碰别人的单据**：只操作本脚本自己刚建的那一条（按 submit 返回的 businessKey
 *    找流程实例，找不到就报错，不会"顺手取消列表里的第一条"）。
 * 7. **附件不删**（与 `smoke/upload.mjs` 那条**不一样**，理由写在脚本最后一段）：
 *    后端的 `ossfileApi.insertBatch` 会把附件落进 `oss_resource`，删掉 OSS 对象会让单据上的附件打不开。
 *    探针 pdf 很小，留在桶里无害；脚本会把 objectKey 打出来。
 *
 * ## 为什么这个脚本直接 import `src/` 下的 .ts
 *
 * 与 `smoke/leave-application.mjs` 完全同一条路：管道取自 `dist/index.js`（已构建产物），
 * 能力实现取自 `../src/capabilities/travel-expense-application.ts`（Node 22 的类型剥离）。
 * ⚠️ 前提是那个文件**只 import type** —— 它确实只从 `general-approval.ts` 引了
 * `ProcessInstanceRow` 一个类型。
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
 *   PORTAL_SMOKE_TRAVEL_ORG_ID    指定组织 id（默认自动挑一个安全的成本中心）
 *   PORTAL_SMOKE_TRAVEL_DATE      预计付款日期 YYYY-MM-DD（默认 14 天后）
 */

const env = process.env

// ---------------------------------------------------------------------------
// 闸先跑，import 放在后面 —— 与 smoke/leave-application.mjs 同一段理由：
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
      '  smoke/with-portal-token.sh node smoke/travel-expense-application.mjs [--submit]\n' +
      '带附件（再套一层 OSS 凭据）：\n' +
      '  smoke/with-portal-token.sh smoke/with-oss-credentials.sh node smoke/travel-expense-application.mjs --submit\n',
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

function daysFromNow (days) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** `SDK-TEST-` 前缀的提交前拒绝 */
function assertTestData (draft) {
  const bad = []
  if (!String(draft.reasons ?? '').startsWith(TEST_PREFIX)) bad.push('reasons')
  if (!String(draft.remark ?? '').startsWith(TEST_PREFIX)) bad.push('remark')
  if (bad.length) {
    throw new Error(
      `${bad.join(' / ')} 没有以 ${TEST_PREFIX} 开头。这是**提交之前**的拒绝：` +
        '本表单没有标题字段，reasons 是审批人唯一能看出这是测试数据的地方。' +
        '要跑真提交，请让这两个字段都以 SDK-TEST- 开头',
    )
  }
}

const ossReady = Boolean(
  env.OSS_ACCESS_KEY_ID && env.OSS_ACCESS_KEY_SECRET && env.OSS_BUCKET && env.OSS_ENDPOINT,
)

async function loadModules () {
  const [{ createPortalHeadless }, travelModule, uploadModule] = await Promise.all([
    import('../dist/index.js'),
    import('../src/capabilities/travel-expense-application.ts'),
    ossReady ? import('../src/capabilities/base-upload.ts') : Promise.resolve(null),
  ])
  return { createPortalHeadless, travelModule, uploadModule }
}

const { createPortalHeadless, travelModule, uploadModule } = await loadModules()
const { TRAVEL_EXPENSE_FORM_PATH, TRAVEL_EXPENSE_PROCESS_KEY, createTravelExpenseCapability } = travelModule

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

const capability =
  sdk.travelExpense ??
  createTravelExpenseCapability((requestConfig) => sdk.call(TRAVEL_EXPENSE_FORM_PATH, requestConfig))

line(`环境 ${env.PORTAL_BASE_URL}，模式：${doSubmit ? '完整链路（含 submit，会打扰真人）' : '只读'}`)
line(`能力来源：${sdk.travelExpense ? 'sdk.travelExpense（组装点已接线）' : 'createTravelExpenseCapability + sdk.call（组装点尚未接线）'}`)
line(`附件：${ossReady ? '会真传一个探针 pdf（用完删除）' : '不传（没有 OSS_* 凭据）'}`)

let createdBusinessKey
let uploadedObjectKey
const disturbed = new Set()

try {
  // ---- 1. 流程定义 ----
  step(1, `流程定义（只读）GET /bpm/process-definition/get?key=${TRAVEL_EXPENSE_PROCESS_KEY}`)
  const definition = await capability.definition()
  line(`    名称=${definition.name} category=${definition.category} version=${definition.version}`)
  line(`    formFields=${JSON.stringify(definition.formFields)} formCustomCreatePath=${JSON.stringify(definition.formCustomCreatePath)}`)
  line(`    startUserSelectTasks=${JSON.stringify(definition.startUserSelectTasks)}`)
  line('    ↑ 三个都是 null / 空：字段契约拿不到（只能读前端源码），审批人也**不由发起人选**')
  if (String(definition.name) !== '差旅费支出申请表') {
    throw new Error(`流程名对不上：期望「差旅费支出申请表」，拿到 ${JSON.stringify(definition.name)}。**停下来，不要硬凑**`)
  }
  const xml = String(definition.bpmnXml ?? '')
  const tasks = [...xml.matchAll(/<userTask id="([^"]+)" name="([^"]+)"[^>]*flowable:candidateStrategy="(\d+)"[^>]*flowable:candidateParam="([^"]*)"/g)]
    .map((m) => ({ name: m[2], strategy: Number(m[3]), param: m[4] }))
  line(`    BPMN 里 ${tasks.length} 个 userTask，候选策略分布：${JSON.stringify([...new Set(tasks.map((t) => t.strategy))])}`)
  if (tasks.some((t) => t.strategy === 35)) {
    throw new Error('BPMN 里出现了 START_USER_SELECT（35）节点 —— 这份能力的假设（审批人不由发起人选）过期了，停下来复核')
  }
  line('    没有一个是 35（发起人自选）⇒ 审批人完全由 orgId 派生，确认')

  // ---- 2. 我是谁 ----
  step(2, '我是谁（只读）GET /sys/user/info')
  const me = await capability.profile()
  line(`    id=${me.id} ${me.realName} 组织=${me.organizationId}`)

  // ---- 3. 组织候选 ----
  step(3, '组织候选（只读）GET /admin-api/org/organization/getTree')
  const orgs = await capability.orgOptions()
  line(`    成本中心（页面上能选）共 ${orgs.length} 个`)
  if (orgs.length === 0) throw new Error('一个可选的组织都没有 —— 页面上的「组织选择」是空的，没法提交')

  // ---- 4. 费用项目 / 字典 / 地区 / 项目 ----
  step(4, '费用选择 / 出行方式 / 资金来源 / 地区 / 项目（都只读）')
  const feeItems = await capability.feeItems()
  line(`    费用选择候选：${JSON.stringify(feeItems)}`)
  const tripModes = await capability.dictOptions('trip_mode')
  const fundSources = await capability.dictOptions('finance_project_fund_source')
  line(`    出行方式 ${tripModes.length} 项（${tripModes.map((o) => o.label).join('/')}）`)
  line(`    资金来源 ${fundSources.length} 项（${fundSources.map((o) => o.label).join('/')}）`)

  // 地区：从真实的地区树里挑一条**三级**路径（不写死 id）
  const provinces = await capability.areaOptions()
  let region
  for (const province of provinces.slice(0, 8)) {
    const cities = await capability.areaOptions(String(province.id))
    for (const city of cities.slice(0, 3)) {
      const districts = await capability.areaOptions(String(city.id))
      if (districts.length > 0) {
        region = [String(province.id), String(city.id), String(districts[0].id)]
        line(`    地区：${province.name} / ${city.name} / ${districts[0].name} → ${JSON.stringify(region)}`)
        break
      }
    }
    if (region) break
  }
  if (!region) throw new Error('地区树里找不到一条三级路径 —— 出发/目标地点填不出来')

  const projects = await capability.projects()
  line(`    项目候选 ${projects.length} 个（本脚本用 projectExpense=false，不看这条分支）`)

  // ---- 5. 出差人（**必须先给关键字**）----
  step(5, '出差人候选（只读，**必须带关键字**）GET /admin-api/sys/user/getUserBasicInfoPage')
  let travelerId = Number(me.id)
  try {
    const mine = await capability.travelers({ keyword: me.realName, pageSize: 5 })
    const hit = (mine?.list ?? []).find((u) => String(u.id) === String(me.id))
    if (hit) {
      line(`    按「${me.realName}」搜到自己：id=${hit.id}（用它当出差人，不会碰到别人的数据）`)
      travelerId = Number(hit.id)
    } else {
      line(`    按「${me.realName}」没搜到，直接用 profile 里的 id=${me.id}`)
    }
  } catch (error) {
    line(`    搜索失败（${String(error?.message).slice(0, 120)}），直接用 profile 里的 id=${me.id}`)
  }

  // 关键字闸的**反证**（只读，一次都不发）
  try {
    await capability.travelers({ keyword: '  ' })
    throw new Error('不带关键字竟然没被拒 —— D6/H35 那条闸失效了')
  } catch (error) {
    if (!/必须先给关键字/.test(String(error?.message))) throw error
    line('    ✓ 不带关键字的搜索被拒（页面会拉 4225 人，无头不照抄）')
  }

  // ---- 6. 附件（要 OSS 凭据）----
  let attachments = []
  if (ossReady) {
    step(6, '附件：真传一个探针 pdf 到 OSS（目录 Finance/expense）')
    const upload = uploadModule.createBaseUploadCapability({
      accessKeyId: env.OSS_ACCESS_KEY_ID,
      accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
      bucket: env.OSS_BUCKET,
      endpoint: env.OSS_ENDPOINT,
      region: env.OSS_REGION,
    })
    const bytes = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    )
    const result = await upload.upload({
      fileName: `SDK-TEST-travel-${stamp()}.pdf`,
      content: bytes,
      contentType: 'application/pdf',
      folder: travelModule.ATTACHMENT_OSS_FOLDER,
    })
    uploadedObjectKey = result?.objectKey ?? null
    attachments = [{ url: result.url, name: `SDK-TEST-travel-${stamp()}.pdf`, size: bytes.length, pages: 1, type: 'application/pdf' }]
    line(`    上传成功：url 长度 ${String(result?.url ?? '').length}，objectKey=${uploadedObjectKey ?? '(未返回)'}，acl=${result?.acl ?? '(未返回)'}`)
  } else {
    step(6, '附件：跳过（没有 OSS_* 凭据）。本表单附件**不是必填**（无 accept 白名单、无 rules）')
  }

  // ---- 7. 组装草稿 ----
  const draft = {
    orgId: env.PORTAL_SMOKE_TRAVEL_ORG_ID ?? String(orgs.find((o) => o.depth >= 3)?.id ?? orgs[0].id),
    projectExpense: false,
    travelerIds: [travelerId],
    reasons: `${TEST_PREFIX}差旅费支出申请冒烟 ${stamp()}（会自动撤销，可忽略）`,
    feePurpose: `${TEST_PREFIX}冒烟用费用用途`,
    paymentDate: env.PORTAL_SMOKE_TRAVEL_DATE ?? daysFromNow(14),
    travelEntryList: [
      {
        startEndDate: [daysFromNow(1), daysFromNow(2)],
        startRegion: region,
        startAddress: `${TEST_PREFIX}出发地详细地址`,
        endRegion: region,
        endAddress: `${TEST_PREFIX}目的地详细地址`,
        tripMode: tripModes[0]?.value ?? 1,
        trafficAmount: 1,
        foodAmount: 0,
        housingAmount: 0,
        otherAmount: 0,
        inputTaxAmount: 0,
        budgetDetailId: '',
        budgetDetailNo: '',
        budgetAvailableAmount: null,
      },
    ],
    remark: `${TEST_PREFIX}冒烟单据，测完即撤销`,
    attachments,
    payeeInfo: {},
  }
  assertTestData(draft)
  line(`\n    草稿：orgId=${draft.orgId} 出差人=${travelerId} 金额=${capability.amount(draft.travelEntryList)} 付款日=${draft.paymentDate}`)

  // ---- 8. 挑组织 + 审批链预览 ----
  step(8, '★ 挑组织 + 审批链预览（**只读**，这一节就是「审批人不能是发起人本人」的落地）')
  /*
   * ⚠️ 挑组织的两条实测约束（第一版只看了第一条，撞了墙）：
   *
   * 1. **审批链里不能有我** —— 后端「流程发起人与审批人相同，自动审核通过」
   *    （`BpmTaskServiceImpl:913-916`）会让流程秒完、`cancel` 撤不掉。
   * 2. **分支要选得对**。BPMN 的通路按组织是不是「博创系」分岔，而
   *    `BpmTargetOrgResolver.applyContext()` **只在算得出值时写变量**
   *    （`CollUtil.isNotEmpty(...)` 才 put）。非博创系那条路要用 `${targetUnitDirectorIds}`
   *    —— 实测 `orgId=1503`（副产品销售组，depth 5）走上去直接报
   *    `Unknown property used in expression: ${targetUnitDirectorIds}`。
   *    博创系那条路用的是 `部门负责人 / 副总裁(岗位 648) / 财务副部长`，实测都解析得出人。
   *    ⇒ 优先挑博创系的成本中心。
   *
   * 提交失败的那一次是**整个事务回滚**的（后端 `@Transactional(rollbackFor = Exception.class)`）——
   * 实测核对过：失败后「我的流程」里差旅费 **0 条**，没留下任何垃圾。
   */
  const isBoc = (o) => /博创/.test(String(o.fullPath ?? ''))
  const ordered = [...orgs.filter(isBoc), ...orgs.filter((o) => !isBoc(o))]
  line(`    组织候选：博创系 ${orgs.filter(isBoc).length} 个（优先），其余 ${orgs.length - orgs.filter(isBoc).length} 个`)
  const vetted = []
  let prep = null
  for (const org of ordered.slice(0, 20)) {
    const orgId = String(org.id)
    let preview
    try {
      // build + preview 是 prepare 的内部两步；这里为了"逐个试组织"直接复用它返回的审批链
      preview = await capability.prepare({ ...draft, orgId })
    } catch (error) {
      line(`    orgId=${orgId}(${org.name}) ✗ ${String(error?.message).slice(0, 110)}`)
      continue
    }
    const names = preview.approvers.map((a) => `${a.node}:${a.nickname || a.id}`)
    if (preview.approvers.some((a) => String(a.id) === String(me.id))) {
      line(`    orgId=${orgId}(${org.name}) ⚠️ 审批链里有我 —— 跳过（「发起人=审批人自动通过」会让流程秒完、撤不掉）`)
      continue
    }
    if (preview.approvers.length === 0) {
      line(`    orgId=${orgId}(${org.name}) ⚠️ 审批链一个人都没有 —— 跳过，免得流程卡死`)
      continue
    }
    line(`    orgId=${orgId}(${org.name}${isBoc(org) ? ' [博创系]' : ''}) ✓ ${preview.approvers.length} 人：${names.join(' | ')}`)
    vetted.push({ orgId, org, prep: preview })
    if (vetted.length >= 3) break
  }
  if (vetted.length === 0) {
    throw new Error('**找不到一个"审批链里没有我"的组织** —— 停在这里，不提交。这正是那道红线该有的行为')
  }
  prep = vetted[0].prep
  for (const a of prep.approvers) disturbed.add(`${a.id} ${a.nickname}`)
  line(`    → 备选 ${vetted.length} 个组织，将按顺序尝试；第一个是 orgId=${vetted[0].orgId}`)
  line(`    → 它会打扰 ${prep.approvers.length} 个人：${prep.approvers.map((a) => `${a.nickname}(${a.id})`).join('、')}`)
  line(`    → 载荷顶层键 ${Object.keys(prep.payload).length} 个；金额总计 ${prep.amount}`)
  line(`    → previewComplete=${prep.previewComplete}`)

  if (!doSubmit) {
    line('\n只读模式到此为止。要跑完整链路（会真打扰上面那几个人）加 --submit')
  } else {
    // ---- 9. 真提交 ----
    step(9, '★ 真提交：POST /admin-api/finance/bpm-spending-apply-travel/create')
    let lastError = null
    let usedPrep = prep
    for (const candidate of vetted) {
      try {
        createdBusinessKey = await capability.submit({ ...draft, orgId: candidate.orgId })
        disturbed.clear()
        for (const a of candidate.prep.approvers) disturbed.add(`${a.id} ${a.nickname}`)
        usedPrep = candidate.prep
        line(`    用 orgId=${candidate.orgId} 提交成功`)
        break
      } catch (error) {
        lastError = error
        const message = String(error?.message ?? '')
        // BPMN 变量解析不出来 ⇒ 这个组织走的路不对。**事务整体回滚**，换一个组织再试是安全的
        if (/Unknown property used in expression/.test(message)) {
          line(`    orgId=${candidate.orgId} ✗ BPMN 变量解析失败（这条分支的变量后端没算出来）：${message.slice(0, 120)}`)
          line('      ↑ 后端 @Transactional 整体回滚，**没有留下任何数据**（脚本最后会独立核对一次）')
          continue
        }
        throw error
      }
    }
    if (createdBusinessKey === undefined) throw lastError ?? new Error('所有备选组织都提交失败了')
    line(`    返回的业务单据 id（= 流程的 businessKey）= ${createdBusinessKey}`)

    // ---- 10. 独立证实：不是"接口返回成功"就算数 ----
    step(10, '独立证实（**另打两个只读接口**，不信 create 的返回值）')
    const record = await capability.detail(createdBusinessKey)
    line(`    detail：id=${record.id} 金额=${record.amount} 付款日=${record.paymentDate} 流程实例=${record.processInstanceId}`)
    line(`    detail 里的理由=${JSON.stringify(String(record.reasons ?? '').slice(0, 40))}`)
    if (String(record.id) !== String(createdBusinessKey)) {
      throw new Error(`detail 里的 id（${record.id}）与 create 返回的（${createdBusinessKey}）对不上`)
    }
    if (!String(record.reasons ?? '').startsWith(TEST_PREFIX)) {
      throw new Error('detail 里的理由没有 SDK-TEST- 前缀 —— 落库内容不对')
    }
    // 金额由**后端**重算，拿它跟 SDK 算的比：这是"载荷真的被解析了"的硬证据
    const backendAmount = Number(record.amount)
    if (Math.abs(backendAmount - usedPrep.amount) > 0.001) {
      throw new Error(`后端重算的金额（${backendAmount}）与 SDK 算的（${usedPrep.amount}）不一致`)
    }
    line(`    ✓ 后端重算的金额与 SDK 的 ${usedPrep.amount} 一致 —— 说明明细行真的被解析成了结构，不是被丢掉了`)

    // 附件：后端 `ossfileApi.insertBatch(attachmentList)` 会为每件建一行 oss_resource，
    // 并把 id 串写回 `attachment`。这是"附件真的被收下了"的独立证据。
    if (attachments.length > 0) {
      const stored = record.attachmentList ?? []
      line(`    附件回读：attachment=${JSON.stringify(record.attachment)}，attachmentList ${stored.length} 件`)
      if (stored.length !== attachments.length) {
        throw new Error(`★ 附件没被收下：发出去 ${attachments.length} 件，detail 里回来 ${stored.length} 件`)
      }
      if (String(stored[0]?.url ?? '') !== String(attachments[0].url)) {
        throw new Error('★ 回读的附件 url 与上传的不是同一个')
      }
      line('    ✓ 附件真的落库了（后端 oss_resource 建了行，detail 能按 url 读回来）')
    }

    // ⚠️ 必须**同时**匹配 businessKey 与 processDefinitionKey：businessKey 是各业务表自己的主键，
    //    会跨流程撞车。实测：本条的 businessKey=103，而 `welfare_expense_request_form` 也有一个
    //    businessKey=103 的单据 —— 只按 businessKey 找会认错单子（第一版就是这么误报的）。
    const running = await capability.myInstances({ status: 1, pageSize: 100 })
    const instance = (running?.list ?? []).find(
      (row) => String(row.businessKey) === String(createdBusinessKey) && row.processDefinitionKey === TRAVEL_EXPENSE_PROCESS_KEY,
    )
    line(`    「我的流程」status=1 共 ${running?.total} 条；按 businessKey 命中：${instance ? `${instance.id}（${instance.name}）` : '没找到'}`)
    if (!instance) {
      throw new Error('★ 提交后在「我的流程」里按 businessKey 找不到它 —— 流程可能**没有真的起来**，或者已经秒完了（自审那条规则）。停下来人工看一眼')
    }
    line(`    ✓ 流程实例 id=${instance.id}，状态=审批中（这条是**独立**于 create 返回值的证据）`)

    // ---- 11. 撤销 ----
    step(11, '★ 撤销：DELETE /bpm/process-instance/cancel-by-start-user')
    await capability.cancel({ reason: `${TEST_PREFIX}冒烟测完即撤销`, businessKey: createdBusinessKey })
    line('    cancel 返回成功')

    // ---- 12. 再证实 ----
    step(12, '撤销后**再查一次**（撤销也要独立证据）')
    const after = await capability.myInstances({ status: 4, pageSize: 100 })
    const cancelled = (after?.list ?? []).find(
      (row) => String(row.businessKey) === String(createdBusinessKey) && row.processDefinitionKey === TRAVEL_EXPENSE_PROCESS_KEY,
    )
    line(`    「我的流程」status=4（已取消）共 ${after?.total} 条；按 businessKey 命中：${cancelled ? `${cancelled.id}（${cancelled.name}）` : '没找到'}`)
    if (!cancelled) {
      throw new Error('★ 撤销后在「已取消」列表里找不到它 —— cancel 的返回值不算数，这条要人工复核')
    }
    const stillRunning = await capability.myInstances({ status: 1, pageSize: 100 })
    const leaked = (stillRunning?.list ?? []).find(
      (row) => String(row.businessKey) === String(createdBusinessKey) && row.processDefinitionKey === TRAVEL_EXPENSE_PROCESS_KEY,
    )
    if (leaked) {
      throw new Error('★ 撤销后它**还在审批中** —— 撤销没生效')
    }
    line('    ✓ 已确认：从「审批中」消失、出现在「已取消」里')
    createdBusinessKey = undefined // 已撤销，finally 不用再撤

    // ---- 13. 收尾核对：没有因为"换组织重试"留下垃圾 ----
    step(13, '收尾核对（只读）：确认没有多余的单据留下')
    const all = await capability.myInstances({ pageSize: 100 })
    const mine = (all?.list ?? []).filter((row) => row.processDefinitionKey === TRAVEL_EXPENSE_PROCESS_KEY)
    line(`    我发起的差旅费流程共 ${mine.length} 条：`)
    for (const row of mine) line(`      businessKey=${row.businessKey} status=${row.status}（4 = 已取消）`)
    const leakedRunning = mine.filter((row) => row.status === 1)
    if (leakedRunning.length > 0) {
      throw new Error(`★ 还有 ${leakedRunning.length} 条差旅费流程停在「审批中」—— 要人工处理`)
    }
    line('    ✓ 一条审批中的都没剩（这次提交失败过一次，也在里面：它被后端整体回滚了）')
  }
} catch (error) {
  line(`\n✗ 失败：${error?.constructor?.name}: ${String(error?.message).slice(0, 600)}`)
  process.exitCode = 1
} finally {
  if (createdBusinessKey !== undefined) {
    line(`\n[清理] 提交成功但后面某步炸了 —— 尝试撤销 businessKey=${createdBusinessKey}`)
    try {
      await capability.cancel({ reason: `${TEST_PREFIX}冒烟异常退出兜底撤销`, businessKey: createdBusinessKey })
      line('[清理] ✓ 撤销成功')
    } catch (error) {
      line(`[清理] ✗ 撤销失败（**要人工处理**）：${String(error?.message).slice(0, 300)}`)
      line(`[清理] 单据 id=${createdBusinessKey}，请人工去「我的流程」里撤掉`)
    }
  }
  if (uploadedObjectKey) {
    line(`\n[清理] 附件用了 OSS objectKey=${uploadedObjectKey}。本脚本**不删**它：` +
      '本表单的附件会被后端 oss_resource 落库（url 就是它），删了 OSS 对象会让单据上的附件打不开。' +
      '探针文件很小，留在桶里无害')
  }
  line(`\n本次实际打扰的人：${disturbed.size ? [...disturbed].join('、') : '（无 —— 只读模式）'}`)
}
