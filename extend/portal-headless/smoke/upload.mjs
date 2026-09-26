#!/usr/bin/env node
/**
 * 冒烟：对**真实 OSS** 上传一个探针对象，验证「上传 → 公开可读 → 清理」整条链。
 *
 * ## ⚠️ 这是本仓库唯一一个会**真写外部存储**的冒烟脚本
 *
 * 别的冒烟（`read-*.mjs`）全是只读。这条不是：它往桶里写一个几 KB 的文本探针。
 * 所以它有两道闸：
 *
 * 1. **没有凭据直接拒绝运行** —— 与其它冒烟一样，缺环境变量就退出码 1，
 *    不会「试一下看行不行」。
 * 2. **必须显式确认** —— 还要设 `OSS_SMOKE_CONFIRM=yes`。少这一个就拒绝，
 *    防止有人在 CI 或本地随手跑起来就往生产桶里写东西。
 *
 * ## 这个脚本要回答的问题
 *
 * - 我们自己实现的 V1 签名，**OSS 到底认不认**（本地测只能证明"与 ali-oss 的构造一致"）；
 * - `PutObjectACL` 那一步是不是真的必需（省了以后 url 能不能被匿名读）；
 * - `?acl=` 这个带等号的子资源写法 OSS 收不收。
 *
 * 这三条**已经于 2026-09-20 在测试环境跑通并记入 `docs/base/上传.md` §6**
 * ——但**不是用这个脚本跑的**：本脚本 import 的是 `dist/`，而那次验证走的是
 * `test/base-upload.test.ts` 的 LIVE 组（vitest 直接编译 TS，不需要先构建），
 * 两者跑的是同一份能力实现。本脚本是给"没有 vitest 的场合"留的入口，
 * **自身尚未被执行过**（见 `docs/base/上传.md` §6.5 的说明）。
 *
 * 它不只"传上去看看 200"，而是做一次**独立证实**：
 * 用一次**不带任何签名头**的 GET 去打返回的 url。200 + 字节对得上，
 * 才说明这个 url 真的对匿名读者可用 —— 而不是"OSS 收下了我们的请求"。
 * 这是本项目「接口返回成功不算验证」那条规矩在上传链上的落地。
 *
 * ## 用法
 *
 * 先构建：`pnpm build`
 *
 * ```bash
 * OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com \
 * OSS_BUCKET=<桶名> \
 * OSS_ACCESS_KEY_ID=<...> \
 * OSS_ACCESS_KEY_SECRET=<...> \
 * OSS_REGION=cn-hangzhou \
 * OSS_SMOKE_CONFIRM=yes \
 * node smoke/upload.mjs
 * ```
 *
 * ⚠️ **不要把凭据写进文件、shell 历史或任何提交**。上面这种"当次环境变量"是下限，
 * 生产上应当从密钥管理里取。本脚本只把凭据放进进程内存，打印时一律经 `redactOssConfig`。
 *
 * ## 清理
 *
 * 脚本在验证完之后会**用签名 DELETE 删掉自己传的对象**，然后在末尾打印 `cleanup` 一行。
 * 如果那一步失败（网络、权限），对象会留在桶里 —— 脚本会明确告诉你 objectKey，
 * 请人工清掉。**不要把一个探针对象留在桶里。**
 */
import { randomUUID } from 'node:crypto'

/**
 * ⚠️ 能力模块是**动态 import** 的，不是顶部的静态 import —— 这是刻意的。
 *
 * 静态 import 会在**本文件任何一行代码之前**被求值：若 `dist/` 不存在（没构建过）
 * 或构建产物过期，node 直接抛 `ERR_MODULE_NOT_FOUND` 退出，
 * **下面那两道闸（缺凭据拒绝 / 未确认拒绝）一行都不会执行**。
 * 一个"没凭据就拒跑"的脚本，绝不能因为一个 import 失败就绕过自己的守卫
 * —— 那正是守卫最该起作用的场景（环境不完整）。
 *
 * 所以守卫先跑，import 放在它们后面。
 */
async function loadCapabilityModule () {
  try {
    return await import('../dist/capabilities/base-upload.js')
  } catch (error) {
    process.stderr.write(
      '加载不了构建产物 dist/capabilities/base-upload.js。\n' +
        '先跑 `pnpm build`（这个冒烟脚本用的是 dist，不是 src）。\n' +
        `原始错误：${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  }
}

const env = {
  OSS_ENDPOINT: process.env.OSS_ENDPOINT,
  OSS_BUCKET: process.env.OSS_BUCKET,
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID,
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET,
}

const missing = Object.entries(env)
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length > 0) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法（先 pnpm build）：\n' +
      '  OSS_ENDPOINT=<oss-cn-xxx.aliyuncs.com> \\\n' +
      '  OSS_BUCKET=<桶名> \\\n' +
      '  OSS_ACCESS_KEY_ID=<...> \\\n' +
      '  OSS_ACCESS_KEY_SECRET=<...> \\\n' +
      '  OSS_REGION=<region，可选> \\\n' +
      '  OSS_SMOKE_CONFIRM=yes \\\n' +
      '  node smoke/upload.mjs\n\n' +
      '⚠️ 这是写操作（往真实桶里传一个探针对象，验完自行删除）。\n' +
      '⚠️ 凭据不要写进文件、shell 历史或提交。\n',
  )
  process.exit(1)
}

if (process.env.OSS_SMOKE_CONFIRM !== 'yes') {
  process.stderr.write(
    '这个脚本会**真写**外部对象存储。确认要跑就加上 OSS_SMOKE_CONFIRM=yes。\n' +
      '（它只传一个几 KB 的文本探针，并在验证后删掉自己。）\n',
  )
  process.exit(1)
}

// 两道闸都过了，这时才去加载能力模块（见文件上方 loadCapabilityModule 的说明）
const {
  assertOssConfig,
  createBaseUploadCapability,
  prepareOssRequest,
  redactOssConfig,
} = await loadCapabilityModule()

const config = assertOssConfig({
  accessKeyId: env.OSS_ACCESS_KEY_ID,
  accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
  bucket: env.OSS_BUCKET,
  endpoint: env.OSS_ENDPOINT,
  region: process.env.OSS_REGION,
})

const FOLDER = 'Public/public'
const PROBE_BODY = `portal-headless upload smoke ${randomUUID()}\n`

/** 探针的固定名：带 uuid，不会撞上任何已有对象，也一眼看得出是冒烟留下的 */
const PROBE_NAME = `smoke-${randomUUID()}`

function say (label, value) {
  process.stdout.write(`${label.padEnd(22)} ${value}\n`)
}

say('config', JSON.stringify(redactOssConfig(config)))
say('folder', FOLDER)
say('probe', PROBE_NAME)

const capability = createBaseUploadCapability(config)

// ---------------------------------------------------------------------------
// ① 上传（PutObject + PutObjectACL + GetObjectACL 复核）
// ---------------------------------------------------------------------------
say('---', '')
const uploaded = await capability.upload({
  content: Buffer.from(PROBE_BODY, 'utf8'),
  folder: FOLDER,
  fixedName: PROBE_NAME,
  fileName: 'probe.txt',
  contentType: 'text/plain',
})

say('upload.url', uploaded.url)
say('upload.objectKey', uploaded.objectKey)
say('upload.size', uploaded.size)
say('upload.acl', uploaded.acl ?? '<读不出来>')

if (uploaded.acl !== 'public-read') {
  process.stderr.write(
    `\n⚠️ ACL 读回来是 ${JSON.stringify(uploaded.acl)}，不是 public-read。\n` +
      '   这通常意味着 PutObjectACL 那一步没生效 —— 下面的匿名读大概率会失败。\n',
  )
}

// ---------------------------------------------------------------------------
// ② 独立证实：**不带任何签名头**地匿名读这个 url
//    这一步才是本脚本存在的理由。"上传返回 200" 只说明 OSS 收下了请求。
// ---------------------------------------------------------------------------
say('---', '')
const anonymous = await fetch(uploaded.url)
const anonymousBody = await anonymous.text()

say('anon.status', anonymous.status)
say('anon.bytes', anonymousBody.length)

if (anonymous.status !== 200) {
  process.stderr.write(
    `\n❌ 匿名 GET 返回 ${anonymous.status}：url 传上去了但**读不出来**。\n` +
      '   最可能的原因是 PutObjectACL 那一步没生效（桶不是默认公共读）。\n',
  )
} else if (anonymousBody !== PROBE_BODY) {
  process.stderr.write(
    '\n❌ 匿名 GET 拿到了字节，但与发上去的不一致 —— 内容被改过或读到了别的对象。\n',
  )
} else {
  say('anon.content', '与上传的字节逐字节一致 ✓')
}

// ---------------------------------------------------------------------------
// ③ 清理：签名 DELETE 掉自己传的对象
// ---------------------------------------------------------------------------
say('---', '')
let cleaned = false
try {
  const del = prepareOssRequest({
    config,
    method: 'DELETE',
    objectKey: uploaded.objectKey,
  })
  const response = await fetch(del.url, { method: del.method, headers: del.headers })
  cleaned = response.ok
  say('cleanup.status', response.status)
} catch (error) {
  say('cleanup.error', error instanceof Error ? error.message : String(error))
}

if (!cleaned) {
  process.stderr.write(
    `\n⚠️ 自动清理失败，桶里留了一个探针对象，请人工删掉：\n   ${uploaded.objectKey}\n`,
  )
}

say('---', '')
process.stdout.write(
  cleaned && anonymous.status === 200 && anonymousBody === PROBE_BODY
    ? '结论：上传链路走通，且 url 对匿名读者可用。\n'
    : '结论：链路**没有**完全走通，看上面的 ❌ / ⚠️。\n',
)

process.exit(cleaned && anonymous.status === 200 && anonymousBody === PROBE_BODY ? 0 : 1)
