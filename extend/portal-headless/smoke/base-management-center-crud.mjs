#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境跑一遍「组织结构」的**写链路**
 * （新建 → 重名 → 改名 → 启用/禁用 → 删除），页面
 * `/dashboard/base/management-center/list`。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 *
 * 运行：smoke/with-portal-token.sh node smoke/base-management-center-crud.mjs
 *
 * ## 它会真的写数据，所以规矩写在这里
 *
 * - 记录名一律 `SDK-TEST-` 前缀。**这一页的名称有 10 字上限（页面规则），
 *   `SDK-TEST-` 就用掉 9 个字符，所以只剩最后 1 位可用**。
 * - **只碰自己建的**：全程只对 `create` 回报的那两个 id（`idA` / `idB`，都是本脚本
 *   刚建出来的）做改名 / 改状态 / 删除。测试环境里原有的 18 条组织一条都不碰
 *   （改别人的组织会连带改掉它的班级、以及一堆人的数据权限——这是硬红线）。
 * - **不删任何不是自己建的记录**。
 * - 收尾复核：按用过的两个名字各查一次列表，都必须是 0 条。
 *
 * ## 名字槽位是怎么被消耗的（这一步不做对，脚本第二次跑就会撞车）
 *
 * 后端 `saveInfo` 的重名检查是 `eq("name", dto.getName())` 且**不过滤 `is_del`**，
 * 所以一条记录哪怕已经被逻辑删除，它的名字仍然占着。第 10 步会**实测**这一点。
 *
 * ⚠️ **所以「探测可用名字」不能用 `list()` 探**：`list` 过滤 `is_del = 0`，
 * 被删掉却仍然占着名字的记录它根本看不见（第一版就是这么写的，于是每一轮都以为
 * `SDK-TEST-1` / `SDK-TEST-2` 是空的）。正确做法是**直接试探 `create`**：
 * 后端在写库之前就 `return new Result().error(...)` 了，**失败的 create 没有任何副作用**。
 *
 * 本脚本每轮只**永久消耗 1 个槽位**（`nameB`）；`nameA` 那一侧最后会被改名回 `nameB`，
 * 所以 `SDK-TEST-1` 每轮都能复用。9 个槽位 ⇒ 大约能干净地跑 8 轮，
 * 跑满之后需要把下面的 `PREFIX` 换成别的短前缀，或人工清理。
 *
 * ## 「独立证实」是什么
 *
 * 这一页**没有第二个视图**，所以证实只能靠**同一接口的两次独立读取**：
 * 建完按名字查列表、再按 id 取详情，且提交值与读回值逐项比对。
 * 与作业管理 / 图库管理那条线同一条思路。
 *
 * ## 步骤
 *
 *   0. 用 `create` 试探两个可用名字（失败的 create 无副作用）→ 得到 idA / idB
 *   1. create(nameA) 再试一次 → 期望「组织结构名称不能相同」（create 有重名检查）
 *   2. 独立证实①：按名字查列表恰好 1 条，拿到 idA
 *   3. 独立证实②：按 id 取详情，name / commander / status / 两个姓名逐项比对
 *   4. 同一个 requestId 重试 —— 列表仍 1 条，且第二次 POST **根本没发出去**
 *   5. **update 没有重名检查**：把 idB 改名成 nameA → 成功，列表里出现 2 条同名活记录
 *   6. 把 idB 的名字改回去、再删掉（收尾，不留第二条）
 *   7. checkStatus 两个方向都调一次，status / updateTime 一个字没变（只读的证据）
 *   8. update(idA → nameB) → get：名字变了，commander / creator / createTime 没被动过
 *   9. update 原样重发一次 —— 业务字段终态不变（update 不需要 requestId 的实测依据）
 *  10. 删完之后再拿 nameB 建一次 —— 期望「名称不能相同」（重名检查不看 is_del）
 *  11. setStatus 三个方向各一次，每次都回 get 读绝对值
 *  12. remove(idA) → 列表查不到；get 仍返回这一行、isDel=1 —— 逻辑删除的现场
 *  13. 收尾：按两个名字各查一次 —— 0 条
 */
import axios from 'axios'

// 防重那三个从**门面**取（`dist/index.js` 已经导出它们），不从 `src/idempotency/` 直接 import：
// `.mjs` import TS 源码时 Node 不会把源码里的 `./xxx.js` 重新映射到 `.ts`，
// 而 `src/idempotency/index.ts` 有一堆**值**导入（不是 type-only），解析不了。
// 本页的能力文件之所以能从 `../src/` 直接 import，是因为它内部只有 `import type`，会被整句擦掉。
import { IdempotencyStore, createPortalHeadless, createRequestId, withIdempotency } from '../dist/index.js'
import {
  BASE_MANAGEMENT_CENTER_PAGE_PATH,
  buildCreatePayload,
  createBaseManagementCenterCapability,
} from '../src/capabilities/base-management-center.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/base-management-center-crud.mjs\n',
  )
  process.exit(1)
}

const PAGE = BASE_MANAGEMENT_CENTER_PAGE_PATH
const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })

/** 手工接线：能力实现与门面用的是同一个 `call`（门面接线后这一段可以删掉） */
const centerBase = createBaseManagementCenterCapability((config) => sdk.call(PAGE, config))

/**
 * `createIdempotent` 的接线与 `src/index.ts` 里其它页那段**逐字同构**，
 * 只是 capabilityId 换成本页的。
 */
const center = {
  ...centerBase,
  createIdempotent: withIdempotency({
    store: new IdempotencyStore({}),
    capabilityId: 'base-management-center-create',
    identity: () => ({ userId: 'smoke', tenantId }),
    payload: (params) => buildCreatePayload(params),
    send: (_params, { payload }) => centerBase.create(payload),
  }),
}

const sent = []
const innerAdapter = axios.getAdapter(axios.defaults.adapter)
sdk.http.defaults.adapter = async (config) => {
  sent.push(`${String(config.method).toUpperCase()} ${String(config.url)}`)
  return innerAdapter(config)
}
const strip = (url) => url.replace(/([?&]_t=)\d+/, '$1<ts>')

const resolved = sdk.resolveModuleType(PAGE)
process.stdout.write(
  `页面：${PAGE}\n` +
    `module-type：${resolved.moduleType} ${resolved.label}\n` +
    `写链路：create → 重名 → checkStatus(只读) → update → setStatus → remove（名字一律 SDK-TEST- 前缀）\n\n`,
)

// 页面规则：名称 ≤ 10 字。`SDK-TEST-` 占 9 个字符，只剩 1 位可用。
const PREFIX = 'SDK-TEST-'
const COMMANDER = '2023040108' // 员工工号形式的 username（页面下拉给的就是这个形态）

let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1
  process.stdout.write(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}\n`)
}

/** 按名字查列表，返回 {list, total}（这一页的独立证实只能用同一接口的两次读） */
async function byName (name) {
  return center.list({ name, pageNo: 1, pageSize: 20 })
}

const ids = []
/** 只删本脚本自己建出来的 id（硬红线：绝不碰别人的记录） */
async function cleanupOwn () {
  for (const ownId of ids) {
    await center.remove(ownId).then(
      () => process.stdout.write(`   已删除自己建的 id=${ownId}\n`),
      (e) => process.stdout.write(`   清理 id=${ownId} 失败（需人工看一下）：${e?.message || e}\n`),
    )
  }
  ids.length = 0
}

let idA
let idB
let nameA
let nameB
let firstRequestId

try {
  // 0 用 create 试探两个可用名字
  //   ⚠️ 不能用 list() 探：list 过滤 is_del=0，看不见"已删除但名字还占着"的记录（见文件头）。
  //   ⚠️ 也不能用裸 create 探：那一条建出来之后脚本就管不到它的 requestId 了，
  //      第 4 步的防重复放就没法做。所以试探本身就走 createIdempotent，每次换一个 requestId。
  process.stdout.write(`0. 用 create 试探两个可用名字（${PREFIX}1 … ${PREFIX}9）\n`)
  const tryCreate = async (name) => {
    const requestId = createRequestId()
    try {
      await center.createIdempotent({ name, commander: COMMANDER, requestId })
      return { ok: true, requestId }
    } catch (error) {
      return { ok: false, requestId, err: error?.message || String(error) }
    }
  }

  const slots = []
  for (let n = 1; n <= 9 && slots.length < 2; n += 1) {
    const candidate = `${PREFIX}${n}`
    const attempt = await tryCreate(candidate)
    if (attempt.ok) slots.push({ name: candidate, requestId: attempt.requestId })
    else process.stdout.write(`   · ${candidate} 建不了（${String(attempt.err).slice(0, 40)}），试下一个\n`)
  }
  if (slots.length < 2) {
    process.stderr.write(
      `\n✗ 找不到两个能用的名字（${PREFIX}1 … ${PREFIX}9）。占用的名字里包含**已逻辑删除**的记录\n` +
        '  —— 后端重名检查不过滤 is_del。不做任何写操作就退出，请换一个 PREFIX。\n',
    )
    process.exit(1)
  }
  nameA = slots[0].name
  firstRequestId = slots[0].requestId
  nameB = slots[1].name
  const listA = await byName(nameA)
  const listB = await byName(nameB)
  idA = listA.list[0]?.id
  idB = listB.list[0]?.id
  if (idA) ids.push(idA)
  if (idB) ids.push(idB)
  check(
    listA.total === 1 && listB.total === 1,
    `选定 ${nameA}（idA=${JSON.stringify(idA)}）/ ${nameB}（idB=${JSON.stringify(idB)}）`,
    `list 条数 ${listA.total} / ${listB.total}`,
  )
  check(
    typeof idA === 'string' && typeof idB === 'string',
    'id 是**字符串**（后端把 Long 序列化成字符串）',
    `typeof idA=${typeof idA} typeof idB=${typeof idB}`,
  )

  // 1 create 的重名检查
  process.stdout.write(`\n1. 拿已被 idA 占着的名字再 create 一次\n`)
  const dupCreate = await center.create({ name: nameA, commander: COMMANDER }).then(
    () => 'created',
    (error) => `err: ${error?.message || String(error)}`,
  )
  check(/组织结构名称不能相同/.test(dupCreate), 'create 有重名检查（撞上就什么都不建）', dupCreate.slice(0, 80))
  const afterDupCreate = await byName(nameA)
  check(afterDupCreate.total === 1, '列表仍然只有 1 条', `实际 ${afterDupCreate.total} 条`)

  // 2 独立证实①
  process.stdout.write(`\n2. 独立证实① 按名字查列表\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  check(afterDupCreate.total === 1, `「${nameA}」恰好 1 条`, `实际 ${afterDupCreate.total} 条`)

  // 3 独立证实②
  const one = await center.get(idA)
  process.stdout.write(`\n3. 独立证实② 按 id 取详情\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  check(one?.name === nameA, 'name 与提交值一致', `读回 ${one?.name}`)
  check(String(one?.commander) === COMMANDER, 'commander 与提交值一致', `读回 ${JSON.stringify(one?.commander)}`)
  check(one?.status === 0, '新建时后端把 status 固定写成 0', `读回 ${one?.status}`)
  check(one?.isDel === 0, '新记录 isDel=0', `读回 ${one?.isDel}`)
  check(one?.commanderName === null, 'get 不填 commanderName（只有列表接口填）',
    `读回 ${JSON.stringify(one?.commanderName)}`)
  check(one?.creatorName === null, 'get 不填 creatorName（只有列表接口填）',
    `读回 ${JSON.stringify(one?.creatorName)}`)
  check(!!afterDupCreate.list[0]?.commanderName, '列表接口**填了** commanderName',
    `读回 ${JSON.stringify(afterDupCreate.list[0]?.commanderName)}`)

  // 4 同一个 requestId 重试
  //    真正的证据是"第二次有没有真的发出去"——只比对返回值是**恒真**的
  //    （saveInfo 返回空 Result，两次都是 null，null === null 说明不了任何事）。
  const postsBefore = sent.filter((line) => line.startsWith('POST ') && line.endsWith('/studymanagementcenter')).length
  const replay = await center.createIdempotent({ name: nameA, commander: COMMANDER, requestId: firstRequestId })
  const postsAfter = sent.filter((line) => line.startsWith('POST ') && line.endsWith('/studymanagementcenter')).length
  const afterReplay = await byName(nameA)
  process.stdout.write(`\n4. 同一个 requestId 重试一次（nameA 那次试探用的就是 createIdempotent）\n`)
  check(afterReplay.total === 1, '列表仍然只有 1 条（没有建出第二条）', `实际 ${afterReplay.total} 条`)
  check(postsAfter === postsBefore,
    '第二次 POST 根本没发出去（防重命中，不是"发了但后端没重复建"）',
    `POST 次数 ${postsBefore} → ${postsAfter}`)
  check(JSON.stringify(replay) === 'null',
    '回放的是第一次的返回值（两边都是 null —— 这条本身证明力很弱）', JSON.stringify(replay))

  // 5 ⚠️ update 没有重名检查（与 create 的**不对称**）
  //    这一步用的是"活记录撞活记录"：idA 正占着 nameA，把 idB 改成 nameA。
  //    不能用"删掉的那条占着的名字"来试——那样就算改名真的做了检查、只是跳过了
  //    is_del 的行，观察结果也一模一样（有混淆）。
  process.stdout.write(`\n5. update 有没有重名检查？（把 idB 改成 idA 正占着的 ${nameA}）\n`)
  const dupRename = await center.update({ id: idB, name: nameA }).then(
    () => 'renamed',
    (error) => `err: ${error?.message || String(error)}`,
  )
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterDupRename = await byName(nameA)
  check(dupRename === 'renamed',
    '改名**成功了** —— update 里没有重名检查（saveInfo 里才有）', dupRename.slice(0, 80))
  check(afterDupRename.total === 2,
    `于是列表里出现了 **2 条同名活记录**（create 拒掉的事，update 放过去了）`,
    `实际 ${afterDupRename.total} 条`)

  // 6 收尾：把 idB 的名字改回去再删掉
  process.stdout.write(`\n6. 收尾：把 idB 的名字改回 ${nameB}，再删掉\n`)
  await center.update({ id: idB, name: nameB })
  const afterRestore = await byName(nameA)
  check(afterRestore.total === 1, `${nameA} 回到 1 条`, `实际 ${afterRestore.total} 条`)
  await center.remove(idB)
  ids.splice(ids.indexOf(idB), 1)
  const idBGone = await center.get(idB)
  check(idBGone?.isDel === 1, `idB 已删除（isDel=1），只删了自己建的那一条`, `isDel=${idBGone?.isDel}`)

  // 7 checkStatus 是只读的
  //    用**当前状态的反面**去预检：如果它真的会写，状态就会被翻过去。
  process.stdout.write(`\n7. checkStatus（名字叫 updateStatus，但它一个字段都不写）\n`)
  const beforeCheck = await center.get(idA)
  const checkEnable = await center.checkStatus(idA, 1)
  process.stdout.write(`   PUT .../updateStatus {id,status:1} → ${JSON.stringify(checkEnable)}\n`)
  const checkDisable = await center.checkStatus(idA, 0)
  process.stdout.write(`   PUT .../updateStatus {id,status:0} → ${JSON.stringify(checkDisable)}\n`)
  const afterCheck = await center.get(idA)
  check(beforeCheck?.status === afterCheck?.status, 'status 一个字没变（接口确实只读）',
    `${beforeCheck?.status} → ${afterCheck?.status}`)
  check(beforeCheck?.updateTime === afterCheck?.updateTime, 'updateTime 也没变',
    `${beforeCheck?.updateTime} → ${afterCheck?.updateTime}`)
  check(checkDisable === null || checkDisable === undefined || typeof checkDisable === 'string',
    '返回值是 null 或提示语字符串（本记录下面没有班级，所以是 null）', JSON.stringify(checkDisable))

  // 8 update（只发 {id, name}）
  await center.update({ id: idA, name: nameB })
  process.stdout.write(`\n8. update（只发 {id, name}）\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterUpdate = await center.get(idA)
  check(afterUpdate?.name === nameB, '名称已改', `读回 ${afterUpdate?.name}`)
  check(String(afterUpdate?.commander) === String(one?.commander),
    'commander 没被这次 PUT 动过（部分更新的实测依据）', `${one?.commander} → ${afterUpdate?.commander}`)
  check(afterUpdate?.creator === one?.creator && afterUpdate?.createTime === one?.createTime,
    'creator / createTime 没被动过', `${one?.createTime} → ${afterUpdate?.createTime}`)
  check(afterUpdate?.status === one?.status, 'status 没被动过（update 的契约里没有它）',
    `${one?.status} → ${afterUpdate?.status}`)
  const oldName = await byName(nameA)
  check(oldName.total === 0, `旧名字「${nameA}」查不到了（新名字不含原名，这条才可信）`,
    `实际 ${oldName.total} 条`)

  // 9 update 原样重发
  await center.update({ id: idA, name: nameB })
  const afterUpdateTwice = await byName(nameB)
  const reread = await center.get(idA)
  process.stdout.write(`\n9. update 原样重发一次\n`)
  check(afterUpdateTwice.total === 1, '仍然只有 1 条', `实际 ${afterUpdateTwice.total} 条`)
  // ⚠️ 这里**不能拿 updateTime 当"终态不变"的判据**（第一版就是这么写错的，跑出来是红的）：
  // 后端 `updateInfo` 第一件事就是 `dto.setUpdateTime(now)`，**每次 PUT 都会刷新它**。
  // 所以"重发终态相同"说的是**业务字段**相同，不是整行逐字节相同。
  check(reread?.name === nameB && String(reread?.commander) === String(afterUpdate?.commander) &&
    reread?.status === afterUpdate?.status,
    '业务字段终态不变（update 不需要 requestId 的实测依据）',
    `${reread?.name} / ${reread?.commander} / ${reread?.status}`)
  check(reread?.updateTime >= afterUpdate?.updateTime,
    '⚠️ 但 updateTime **每次 PUT 都会被刷新**（后端 updateInfo 里写死的），所以它不是幂等的判据',
    `${afterUpdate?.updateTime} → ${reread?.updateTime}`)

  // 10 重名检查不过滤 is_del
  process.stdout.write(`\n10. 拿一个**已删除记录仍占着**的名字（${nameB}，现在 idA 也占着它）再 create\n`)
  const dup = await center.create({ name: nameB, commander: COMMANDER }).then(
    () => 'created',
    (error) => `err: ${error?.message || String(error)}`,
  )
  check(/组织结构名称不能相同/.test(dup), 'create 拒绝 —— 重名检查**不过滤 is_del**', dup.slice(0, 80))
  const stillOne = await byName(nameB)
  check(stillOne.total === 1, '列表仍然只有 1 条（这一条没有建出任何东西）', `实际 ${stillOne.total} 条`)

  // 11 setStatus：写的是绝对值，不是 toggle
  process.stdout.write(`\n11. setStatus 三个方向各一次，每次都回 get 读绝对值\n`)
  await center.setStatus(idA, 1)
  const s1 = await center.get(idA)
  check(s1?.status === 1, 'setStatus(1) → get 读回 status=1', `读回 ${s1?.status}`)
  await center.setStatus(idA, 0)
  const s0 = await center.get(idA)
  check(s0?.status === 0, 'setStatus(0) → get 读回 status=0', `读回 ${s0?.status}`)
  await center.setStatus(idA, 1)
  const s1again = await center.get(idA)
  check(s1again?.status === 1, 'setStatus(1) 再来一次 → 仍是 1（重发终态相同，不需要 requestId）',
    `读回 ${s1again?.status}`)

  // 12 remove（逻辑删除）
  await center.remove(idA)
  ids.splice(ids.indexOf(idA), 1)
  process.stdout.write(`\n12. remove\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterRemove = await byName(nameB)
  check(afterRemove.total === 0, '列表查不到了', `实际 ${afterRemove.total} 条`)
  const gone = await center.get(idA)
  check(gone?.isDel === 1, 'get 仍返回这一行且 isDel=1 —— **逻辑删除**的现场', `isDel=${gone?.isDel}`)
  check(gone?.name === nameB, '（所以"删干净了没有"只能看列表，看 get 会以为没删掉）',
    `get 读回 name=${gone?.name}`)

  // 13 收尾
  const finalA = await byName(nameA)
  const finalB = await byName(nameB)
  process.stdout.write(`\n13. 收尾：按两个名字各查一次\n`)
  check(finalA.total === 0 && finalB.total === 0,
    `「${nameA}」/「${nameB}」都是 0 条`, `实际 ${finalA.total} / ${finalB.total}`)
  check(ids.length === 0, '本轮建出来的记录全部已删除，没有留下需要清理的 id', `剩余 ${ids.join(',') || '无'}`)
  // idA / idB 是**本轮唯一被写过的两个 id**；写请求的完整清单也打出来，好核对没碰别人
  process.stdout.write(
    `\n   本轮发出去的写请求（全部指向 idA=${idA} / idB=${idB}）：\n` +
      sent.filter((line) => !line.startsWith('GET ')).map((line) => `     ${strip(line)}`).join('\n') + '\n',
  )
} catch (error) {
  failures += 1
  process.stdout.write(`\n✗ 抛异常了：${error?.stack || error}\n`)
} finally {
  // 失败路径也要清理，且**只删本脚本自己建出来的 id**
  if (ids.length && !process.env.PORTAL_SMOKE_KEEP) {
    process.stdout.write('\n尽力清理（只删本脚本建的 id，失败也不影响结论）\n')
    await cleanupOwn()
  }
}

process.stdout.write(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
