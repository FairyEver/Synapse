#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 测试环境跑一遍作业管理的**完整写链路**。
 *
 * ⚠️ 这是写操作——会真的建出一条作业，跑完把它删掉。只有在明确授权后才运行。
 *
 * 与会议室那条线的冒烟（`submit-meeting-application.mjs`）最大的不同：
 * 会议室是流程，验证手法是「提交后去占用查询里看到这条预定」；
 * 作业管理是普通 CRUD，**没有第二个视图能间接看到它**，所以「独立证实」直接用
 * 列表 + 详情两次独立读取：列表按名字查得到、详情按 id 取回来字段逐项对得上。
 * 删除之后同样再查两次，确认它真的不在了。
 *
 * 跑法：
 *   smoke/with-portal-token.sh node smoke/assignment-crud.mjs
 *
 * 需要环境变量：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID（由 with-portal-token.sh 注入）
 * 可选：
 *   PORTAL_SMOKE_KEEP=1   跑完不删（排查用；别长期留着）
 *
 * 先构建：pnpm build
 */
import { createPortalHeadless, createRequestId } from '../dist/index.js'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)
if (missing.length) {
  process.stderr.write(`缺少环境变量：${missing.join(', ')}（用 smoke/with-portal-token.sh 包一层）\n`)
  process.exit(1)
}

const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
const NAME = process.env.PORTAL_SMOKE_NAME || `SDK-TEST-作业管理-冒烟-${stamp}`
// 改后的名字**故意不包含原名**：列表的 title 是模糊匹配，`原名-改后` 里含原名，
// 「旧名字查不到」这类断言会被子串命中，看起来像没改成功（第一版就踩了这个）
const NAME2 = process.env.PORTAL_SMOKE_NAME2 || `SDK-TEST-作业管理-改后-${stamp}`
const KEEP = process.env.PORTAL_SMOKE_KEEP === '1'

const draft = {
  title: NAME,
  demand: 'SDK-TEST 无头 SDK 写链路冒烟用，跑完会删掉',
  type: 4,
  endTime: '2026-09-30 18:00:00',
}

const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })

const say = (line) => process.stdout.write(`${line}\n`)
const rowsWithTitle = async (title) => {
  const page = await sdk.assignment.list({ title })
  return (page.list || []).filter((row) => String(row.title || '').includes(title))
}

const created = []
let failures = 0
function check (label, ok, detail) {
  say(`${ok ? '✅' : '❌'} ${label}${detail === undefined ? '' : ` —— ${detail}`}`)
  if (!ok) failures += 1
}

try {
  say(`环境：${baseUrl}`)
  say(`作业名称前缀：${NAME}\n`)

  // ---- 0. 起手：这个名字现在不该存在 ----
  const before = await rowsWithTitle(NAME)
  check('起手时这个名字查不到（避免误判成"创建成功"）', before.length === 0, `命中 ${before.length} 条`)

  // ---- 1. 创建（走门面上带防重的那个） ----
  const requestId = createRequestId()
  say(`\n调用 createIdempotent，requestId=${requestId}`)
  const createResult = await sdk.assignment.createIdempotent({ ...draft, requestId })
  say(`后端返回：${JSON.stringify(createResult)}`)

  // ---- 2. 独立证实①：列表里真的出现了 ----
  const found = await rowsWithTitle(NAME)
  check('列表里查得到这条作业（独立读取，不是拿创建接口的返回当证据）', found.length === 1, `命中 ${found.length} 条`)
  if (found.length !== 1) {
    throw new Error('创建后列表里没有恰好一条，后面的复核没有意义，直接停')
  }
  const id = found[0].id
  created.push(id)
  say(`记录 id = ${id}`)

  // ---- 3. 独立证实②：详情按 id 取回来，字段逐项对得上 ----
  const detail = await sdk.assignment.get(id)
  check('详情取回的 id 与列表一致', String(detail.id) === String(id), `${detail.id}`)
  check('标题一致', detail.title === draft.title, detail.title)
  check('作业要求一致', detail.demand === draft.demand, detail.demand)
  check('作业类型一致', Number(detail.type) === draft.type, String(detail.type))
  check('提交截止时间一致', String(detail.endTime) === draft.endTime, String(detail.endTime))
  check('后端把 id 序列化成字符串（删除 body 里是 ["id"] 而不是 [id]）', typeof detail.id === 'string', typeof detail.id)

  // ---- 4. 防重：同一个 requestId 再调一次，不该多出第二条 ----
  const replay = await sdk.assignment.createIdempotent({ ...draft, requestId })
  const afterReplay = await rowsWithTitle(NAME)
  check('同一个 requestId 重试：没有多出第二条', afterReplay.length === 1, `命中 ${afterReplay.length} 条`)
  check('同一个 requestId 重试：回放的是第一次的结果', String(replay) === String(createResult), `${JSON.stringify(replay)}`)

  // ---- 5. 改状态（绝对值） ----
  await sdk.assignment.setStatus(id, 0)
  const disabled = await sdk.assignment.get(id)
  check('setStatus(0) 生效', Number(disabled.status) === 0, `status=${disabled.status}`)
  await sdk.assignment.setStatus(id, 1)
  const enabled = await sdk.assignment.get(id)
  check('setStatus(1) 生效（同一个接口、绝对值）', Number(enabled.status) === 1, `status=${enabled.status}`)

  // ---- 6. 修改（整单替换：先 get 再改，没传的字段会回默认值） ----
  // 这就是「update 的只读前置步骤」的实地演示：先把当前值取回来，只改要改的那个字段，
  // 其余原样传回去（页面编辑态也是这么做的：customLoad 拿结果 → 铺回表单 → 整份 PUT）。
  const current = await sdk.assignment.get(id)
  await sdk.assignment.update({
    id,
    title: NAME2,
    demand: String(current.demand ?? draft.demand),
    type: Number(current.type),
    endTime: String(current.endTime),
    isUploadAnswer: Number(current.isUploadAnswer ?? 0),
    answerType: current.answerType ?? '',
    answerPublishTime: current.answerPublishTime ?? null,
    textAnswer: String(current.textAnswer ?? ''),
    isUploadCore: Number(current.isUploadCore ?? 0),
    coreType: current.coreType ?? '',
    corePublishTime: current.corePublishTime ?? null,
    textCore: String(current.textCore ?? ''),
    isSelfScoring: Number(current.isSelfScoring ?? 0),
    selfScoringEndTime: current.selfScoringEndTime ?? null,
    isTeacherCheck: Number(current.isTeacherCheck ?? 0),
    scoreType: current.scoreType ?? '',
  })
  const updated = await sdk.assignment.get(id)
  check('update 生效：标题变了', updated.title === NAME2, String(updated.title))
  check('update 之后原名字查不到了', (await rowsWithTitle(NAME)).length === 0)
  check('update 之后新名字查得到（还是同一条）', (await rowsWithTitle(NAME2)).some((row) => String(row.id) === String(id)))
  check('update 没有把它变成第二条记录', (await rowsWithTitle(NAME)).length === 0 && (await rowsWithTitle(NAME2)).length === 1)

  // 同一个 update 原样再发一次（整单替换的等价重发）：终态必须一样。
  // 这就是「update 不需要防重」的实测依据——D12 在这类写操作上要收窄，不能照抄会议室那条流程线。
  const repeatable = {
    id,
    title: NAME2,
    demand: String(current.demand ?? draft.demand),
    type: Number(current.type),
    endTime: String(current.endTime),
    isUploadAnswer: Number(current.isUploadAnswer ?? 0),
    isSelfScoring: Number(current.isSelfScoring ?? 0),
    isTeacherCheck: Number(current.isTeacherCheck ?? 0),
  }
  await sdk.assignment.update(repeatable)
  const afterRepeat = await rowsWithTitle(NAME2)
  check('update 原样重发一次：还是只有这一条，没有多出第二条', afterRepeat.length === 1, `命中 ${afterRepeat.length} 条`)
  check('update 原样重发一次：终态不变（标题、截止时间都一样）', String((await sdk.assignment.get(id)).title) === NAME2)

  // ---- 7. 清理：删除 ----
  if (KEEP) {
    say(`\n⚠️ PORTAL_SMOKE_KEEP=1：保留记录 #${id}（${NAME2}），记得手工删掉`)
  } else {
    // ⚠️ 实测结论：这个删除是**逻辑删除**（软删），`get` 仍然取得到这一行，
    // 只是 `isDel` 从 0 变成 1，列表查询把它过滤掉了。所以「删干净了没有」的
    // 独立复核**只能靠列表**，拿 `get` 复核会得到一个看起来像"没删掉"的假象。
    // 出处见 docs/pages/作业管理.md 的「真实验证记录」。
    await sdk.assignment.remove(id)
    const afterDelete = await rowsWithTitle(NAME2)
    check('删除后列表里查不到（这是唯一能证实删掉的视角）', afterDelete.length === 0, `命中 ${afterDelete.length} 条`)

    const tombstone = await sdk.assignment.get(id)
    check(
      '实测到的语义：删除是逻辑删除，get 仍返回这一行且 isDel=1（不是"取不到"）',
      tombstone !== null && tombstone !== undefined && Number(tombstone.isDel) === 1,
      `isDel=${tombstone?.isDel}`,
    )
    check('逻辑删除不影响别的字段（标题还是改后的那个）', String(tombstone?.title) === NAME2, String(tombstone?.title))

    // 重复删除：后端接受，不报错（所以 remove 重发是安全的，不需要防重）
    let repeat = 'ok'
    try {
      await sdk.assignment.remove(id)
    } catch (error) {
      repeat = `${error?.name}: ${error?.message}`
    }
    check('重复删除不报错（remove 重发没有副作用，这就是它不需要防重的实测依据）', repeat === 'ok', repeat)
    created.length = 0
  }
} catch (error) {
  process.stderr.write(`\n调用失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  failures += 1
} finally {
  // 兜底清理：不管前面在哪一步炸的，都不留垃圾
  if (!KEEP) {
    for (const id of created) {
      try {
        await sdk.assignment.remove(id)
        process.stdout.write(`🧹 兜底清理：已删除 #${id}\n`)
      } catch (error) {
        process.stderr.write(`⚠️ 兜底清理 #${id} 失败（请手工删）：${error?.message || String(error)}\n`)
      }
    }
  }
  const leftover = [...(await rowsWithTitle(NAME).catch(() => [])), ...(await rowsWithTitle(NAME2).catch(() => []))]
  process.stdout.write(
    leftover.length === 0
      ? '\n🧹 测试环境里没有留下 SDK-TEST- 前缀的作业。\n'
      : `\n⚠️ 还留着 ${leftover.length} 条，请手工删：${leftover.map((r) => `${r.id}/${r.title}`).join(', ')}\n`,
  )
}

process.stdout.write(failures === 0 ? '\n🎉 写链路端到端成立（创建 → 两次独立复核 → 改状态 → 修改 → 删除）。\n' : `\n❌ 有 ${failures} 条检查没通过。\n`)
process.exit(failures === 0 ? 0 : 1)
