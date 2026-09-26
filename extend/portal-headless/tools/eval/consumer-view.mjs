/**
 * 调用方视角（黑盒投影）。
 *
 * 这是整台评测装置的「眼」：它内部调 `sdk.catalog.*`，但对外只交出
 * **一个真实调用方读文档 + 调公开协议能拿到的信息**。
 *
 * 两条硬纪律：
 *   1. 只走 catalog 的公开方法（recommend / search / describe / describePage /
 *      listDomains / listPages）。**不碰 `catalog.index`**——那是未文档化的原始转储，
 *      里面是生成期内部结构（definitions / primary / conflict / pageById …）。
 *   2. 输出前统一走 `redact()`，按 DENYLIST 剥掉构建元数据。剥的是「这份目录是怎么
 *      生成出来的」，不是「这个能力怎么调」——前者调用方看不见，也不该依赖。
 *
 * 用法：
 *   node tools/eval/consumer-view.mjs "帮我调薪"
 *   import { consumerView, describeCapability } from './consumer-view.mjs'
 */

/**
 * 公开入口有**两条候选清单，用哪条由调用方显式给定**，不靠猜。
 *
 * - `ENTRY_CANDIDATES`（默认，命令行用）：优先 dist（构建产物，与 docs/usage.md
 *   的口径一致），只有在 dist 根本不存在（新克隆的仓库，dist/ 是 gitignore 的）
 *   时才回落到 src/index.ts —— 回落的只是**公开入口**，拿到的 API 面完全一样，
 *   不多读一行实现。
 * - `SOURCE_ENTRY_CANDIDATES`（测试用）：只认 src/index.ts。
 *
 * 为什么测试必须只认源码：`dist/` 是构建产物，而 `.githooks/pre-commit` 每次提交前
 * 都会 `pnpm build` **重建整个工作区**——并行代理改到一半的代码照样会被编进去。
 * 测试若读 dist，断言钉住的就是「上一次构建时的世界」：同一个 commit，全绿还是红三条
 * 取决于刚才谁提交过、构建落到哪一版。测试要断言的是源码，不是会被别的东西重建的产物。
 *
 * 刻意只在 ERR_MODULE_NOT_FOUND 时回落：dist 存在但坏掉要原样报错，
 * 不能让回落把真问题盖掉。
 */
export const ENTRY_CANDIDATES = ['../../dist/index.js', '../../src/index.ts']

/** 测试专用入口：只认源码，绝不回落到 dist。 */
export const SOURCE_ENTRY_CANDIDATES = ['../../src/index.ts']

export async function loadEntry(candidates = ENTRY_CANDIDATES) {
  let lastError
  for (const rel of candidates) {
    try {
      return await import(new URL(rel, import.meta.url).href)
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
      lastError = error
    }
  }
  throw new Error(
    `拿不到 portal-headless 公开入口（试过 ${candidates.join('、')}）。` +
      `新克隆的仓库请先跑 pnpm build。最后一个错误：${lastError?.message}`,
  )
}

/**
 * 构建期元数据，不是调用契约。出现即视为泄露。
 * 前四项来自 `catalog.index`，后五项来自页面对象。
 */
export const INTERNAL_KEYS = [
  'generatedAt',
  'duplicateCapabilityIds',
  'capabilityById',
  'pageById',
  'pageByPath',
  'definitions',
  'primary',
  'conflict',
  'routeFile',
  'menuSource',
  'source',
  'status',
  'permission',
]

const INTERNAL = new Set(INTERNAL_KEYS)

/** 递归剥掉内部字段。数组保序，对象保键序。 */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (INTERNAL.has(k)) continue
    out[k] = redact(v)
  }
  return out
}

/** 假凭据：目录是静态的，这条链路一次网络都不发。每次现造一份，不共享可变对象。 */
function fakeConfig() {
  return {
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'eval-consumer-view', tenantId: 1 },
  }
}

/**
 * 用假凭据建实例。
 *
 * `candidates` 显式给出用哪份入口：默认是命令行的 dist 优先，**测试请传
 * `SOURCE_ENTRY_CANDIDATES`（或直接用 `makeSourceSdk()`）**，否则断言就被钉在了
 * 会被 pre-commit 重建的 dist 上。
 */
export async function makeSdk(candidates = ENTRY_CANDIDATES) {
  const { createPortalHeadless } = await loadEntry(candidates)
  return createPortalHeadless(fakeConfig())
}

/** 测试用：建一个**钉死在源码**上的实例。评测自检一律走这个。 */
export function makeSourceSdk() {
  return makeSdk(SOURCE_ENTRY_CANDIDATES)
}

/**
 * 一句话话术 → 调用方能看到的全套信息。
 *
 * @param {string} utterance 用户原话
 * @param {string[]} [candidates] 用哪份入口；测试传 `SOURCE_ENTRY_CANDIDATES`
 * @returns {Promise<object>} 已脱敏的视图
 */
export async function consumerView(utterance, candidates = ENTRY_CANDIDATES) {
  const sdk = await makeSdk(candidates)
  return consumeViewWith(sdk, utterance)
}

/**
 * 同上，但复用外部传入的 sdk（省掉重复建实例）。
 */
export function consumeViewWith(sdk, utterance) {
  const recommend = sdk.catalog.recommend(utterance)
  const search = sdk.catalog.search(utterance)
  return redact({
    utterance,
    recommend,
    search,
    // 「目录里到底有哪些能力」这件事，调用方是能知道的：describe 一个不存在的 id
    // 就会把已注册能力全列出来。这里直接取用，不算内部信息。
    registeredCapabilityIds: listRegisteredCapabilityIds(sdk),
  })
}

/**
 * 已注册能力 id 清单。来源是公开失败路径（describe 一个不存在的 id 的回执），
 * 不是内部注册表。
 */
export function listRegisteredCapabilityIds(sdk) {
  const miss = sdk.catalog.describe('__eval_probe_不存在的能力__')
  const reason = String(miss?.reason ?? '')
  const inner = reason.slice(reason.indexOf('：') + 1, reason.lastIndexOf('）'))
  return inner
    .split('、')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** describe 一个能力，脱敏后再交出去。 */
export async function describeCapability(capabilityId, candidates = ENTRY_CANDIDATES) {
  const sdk = await makeSdk(candidates)
  return redact(sdk.catalog.describe(capabilityId))
}

/** describePage 一个页面，脱敏后再交出去。 */
export async function describePageRef(pageId, candidates = ENTRY_CANDIDATES) {
  const sdk = await makeSdk(candidates)
  return redact(sdk.catalog.describePage(pageId))
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const utterance = process.argv[2] ?? '帮我订个会议室'
  const view = await consumerView(utterance)
  console.log(JSON.stringify(view, null, 1))
}
